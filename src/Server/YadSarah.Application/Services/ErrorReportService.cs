using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>
/// Captures runtime errors (client crashes + unhandled server exceptions) into the
/// <see cref="ErrorReport"/> table for after-the-fact investigation. A render-loop / outage can
/// produce an error "storm", so identical errors are collapsed into one row + an occurrence
/// counter (see <see cref="Fingerprint"/>). Every persist clips each field to its column cap so a
/// pathological payload can never throw on save.
///
/// IMPORTANT: persistence is best-effort and SECONDARY to the stdout log. Callers wrap the persist
/// in a swallowing try/catch — a DB-down (the very thing that often fails) must never turn a 204
/// into a 500 or mask the original exception. The durable record is the structured stdout log.
/// </summary>
public class ErrorReportService(AppDbContext db)
{
    public record ErrorReportResult(List<ErrorReport> Items, int Total, int Page, int PageSize);

    public const int MaxPageSize = 100;

    // Collapse repeats of the same error within this window into the existing open row.
    private static readonly TimeSpan DedupWindow = TimeSpan.FromHours(24);

    /// <summary>Persist an unhandled server exception (called by the global exception handler).</summary>
    public Task PersistServerAsync(
        ErrorSeverity severity, string message, string? stack, string? routeUrl,
        Guid? userId, string? userName, string? userRole, string? ipAddress, string? correlationId)
        => PersistAsync(ErrorSource.Server, severity, message, stack, componentStack: null,
            routeUrl, userAgent: null, userId, userName, userRole, ipAddress, correlationId);

    /// <summary>Persist a client-side crash report (called by ClientErrorController).</summary>
    public Task PersistClientAsync(
        ErrorSeverity severity, string message, string? stack, string? componentStack,
        string? routeUrl, string? userAgent,
        Guid? userId, string? userName, string? userRole, string? ipAddress, string? correlationId)
        => PersistAsync(ErrorSource.Client, severity, message, stack, componentStack,
            routeUrl, userAgent, userId, userName, userRole, ipAddress, correlationId);

    private async Task PersistAsync(
        ErrorSource source, ErrorSeverity severity, string message, string? stack, string? componentStack,
        string? routeUrl, string? userAgent,
        Guid? userId, string? userName, string? userRole, string? ipAddress, string? correlationId)
    {
        message = string.IsNullOrWhiteSpace(message) ? "(no message)" : message.Trim();
        var fingerprint = Fingerprint(source, message, stack);

        // Dedup-or-insert: fold into a recent OPEN row with the same fingerprint, else insert. Don't
        // overwrite the original message/stack — only bump the counter + last-seen timestamp.
        var since = DateTime.UtcNow - DedupWindow;
        var existing = await db.ErrorReports
            .Where(r => r.Fingerprint == fingerprint
                        && r.Status != ErrorStatus.Resolved && r.Status != ErrorStatus.Ignored
                        && r.LastSeenAt >= since)
            .OrderByDescending(r => r.LastSeenAt)
            .FirstOrDefaultAsync();

        if (existing is not null)
        {
            existing.OccurrenceCount++;
            existing.LastSeenAt = DateTime.UtcNow;
        }
        else
        {
            db.ErrorReports.Add(new ErrorReport
            {
                Source = source,
                Severity = severity,
                CorrelationId = Clip(correlationId, 128),
                Message = Clip(message, 2000)!,
                Stack = Clip(stack, 16000),
                ComponentStack = Clip(componentStack, 16000),
                RouteUrl = Clip(routeUrl, 1000),
                UserAgent = Clip(userAgent, 1000),
                UserId = userId,
                UserName = Clip(userName, 200),
                UserRole = Clip(userRole, 100),
                IpAddress = Clip(ipAddress, 64),
                Fingerprint = fingerprint,
                FirstSeenAt = DateTime.UtcNow,
                LastSeenAt = DateTime.UtcNow,
                Status = ErrorStatus.New,
            });
        }

        await db.SaveChangesAsync();
    }

    /// <summary>Admin board: filter over ALL rows server-side, then paginate (≤100/page).</summary>
    public async Task<ErrorReportResult> GetForAdminAsync(
        ErrorSource? source, ErrorSeverity? severity, ErrorStatus? status,
        DateOnly? from, DateOnly? to, int page, int pageSize)
    {
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        page = Math.Max(0, page);

        var q = db.ErrorReports.AsNoTracking();
        if (source.HasValue) q = q.Where(r => r.Source == source.Value);
        if (severity.HasValue) q = q.Where(r => r.Severity == severity.Value);
        if (status.HasValue) q = q.Where(r => r.Status == status.Value);
        if (from.HasValue)
        {
            var fromUtc = from.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            q = q.Where(r => r.LastSeenAt >= fromUtc);
        }
        if (to.HasValue)
        {
            // inclusive end-of-day
            var toUtc = to.Value.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
            q = q.Where(r => r.LastSeenAt <= toUtc);
        }

        var total = await q.CountAsync();
        var items = await q
            .OrderByDescending(r => r.LastSeenAt)
            .Skip(page * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return new ErrorReportResult(items, total, page, pageSize);
    }

    /// <summary>Admin triage edit (status + notes).</summary>
    public async Task<ErrorReport> UpdateStatusAsync(long id, ErrorStatus status, string? adminNotes, Guid adminUserId)
    {
        var report = await db.ErrorReports.FindAsync(id)
            ?? throw new KeyNotFoundException($"ErrorReport {id} not found");

        report.Status = status;
        report.AdminNotes = string.IsNullOrWhiteSpace(adminNotes) ? null : Clip(adminNotes.Trim(), 4000);
        report.UpdatedAt = DateTime.UtcNow;
        report.UpdatedByUserId = adminUserId;

        await db.SaveChangesAsync();
        return report;
    }

    /// <summary>
    /// Retention prune: drop rows older than <paramref name="retentionDays"/>, then enforce a hard
    /// row cap (keep the newest <paramref name="maxRows"/>). Bounds table growth on free-tier Postgres
    /// and limits how long PHI-capable text lingers. Returns the number of rows deleted.
    /// </summary>
    public async Task<int> PruneAsync(int retentionDays, int maxRows)
    {
        var deleted = 0;

        if (retentionDays > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-retentionDays);
            deleted += await db.ErrorReports.Where(r => r.LastSeenAt < cutoff).ExecuteDeleteAsync();
        }

        if (maxRows > 0)
        {
            var total = await db.ErrorReports.CountAsync();
            if (total > maxRows)
            {
                // Id is append-only ascending → newest first by Id desc. Find the cutoff id and drop
                // everything at or below it, keeping the newest maxRows rows.
                var cutoffId = await db.ErrorReports
                    .OrderByDescending(r => r.Id)
                    .Skip(maxRows)
                    .Select(r => (long?)r.Id)
                    .FirstOrDefaultAsync();
                if (cutoffId is not null)
                    deleted += await db.ErrorReports.Where(r => r.Id <= cutoffId.Value).ExecuteDeleteAsync();
            }
        }

        return deleted;
    }

    // Stable 64-char hex fingerprint of source + message + first stack frame. Collapses identical
    // errors (same call site) into one row even as later frames / timestamps vary.
    private static string Fingerprint(ErrorSource source, string message, string? stack)
    {
        var firstFrame = stack?.Split('\n', 2, StringSplitOptions.TrimEntries)[0] ?? "";
        var raw = $"{source}|{message}|{firstFrame}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes).ToLowerInvariant(); // 64 chars
    }

    private static string? Clip(string? s, int max)
    {
        if (string.IsNullOrEmpty(s)) return s;
        return s.Length > max ? s[..max] : s;
    }
}
