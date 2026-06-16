using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One row of the patient-history view (visit + patient + treating staff + relevance tier).</summary>
public record VisitHistoryItem(
    Guid VisitId, Guid PatientId, string PatientName, string? IdentityNumber,
    DateOnly AdmissionDate, TimeOnly? AdmissionTime, int QueueNumber,
    string? Department, VisitStatus Status,
    string? SignedByName, List<string> Editors, int RelatedTier);

/// <summary>A single page of history results plus the total count of all matching records.</summary>
public record HistoryResult(List<VisitHistoryItem> Items, int Total, int Page, int PageSize);

public class VisitService(AppDbContext db, SettingsService settings)
{
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    // On-prem server runs in Israel; resolve local time for the queue day.
    private static readonly TimeZoneInfo IsraelTz =
        TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem");

    private static DateTime IsraelNow() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, IsraelTz);

    // The "queue day" resets at a configurable hour (default 18:00, an hour before
    // opening). Before the reset hour we still belong to the previous day's period.
    private async Task<DateOnly> CurrentQueueDateAsync()
    {
        var now = IsraelNow();
        var resetHour = await settings.GetIntAsync(SettingsService.QueueResetHourKey, 18);
        var effective = now.Hour < resetHour ? now.Date.AddDays(-1) : now.Date;
        return DateOnly.FromDateTime(effective);
    }

    public async Task<List<Visit>> GetQueueAsync(bool includeDischarged = false)
    {
        // The queue board shows the current queue-day's visits. By default only
        // non-discharged ones (the active board); includeDischarged shows everyone
        // admitted since the running queue started today.
        var queueDate = await CurrentQueueDateAsync();
        var query = db.Visits
            .Include(v => v.Patient)
            .Where(v => v.AdmissionDate == queueDate);
        if (!includeDischarged)
            query = query.Where(v => v.Status != VisitStatus.Discharged);
        return await query.OrderBy(v => v.QueueNumber).ToListAsync();
    }

    public async Task<Visit?> GetByIdAsync(Guid id)
    {
        // Forms are clinical PHI and are fetched only via the gated FormsController.
        return await db.Visits
            .Include(v => v.Patient)
            .FirstOrDefaultAsync(v => v.Id == id);
    }

    public Task<bool> PatientExistsAsync(Guid patientId) =>
        db.Patients.AnyAsync(p => p.Id == patientId);

    // Full visit history for a patient (newest first), across all days.
    public async Task<List<Visit>> GetByPatientAsync(Guid patientId)
    {
        return await db.Visits
            .Where(v => v.PatientId == patientId)
            .OrderByDescending(v => v.AdmissionDate)
            .ThenByDescending(v => v.AdmissionTime)
            .ToListAsync();
    }

    public const int HistoryPageSize = 50;

    /// <summary>
    /// Paged history view. With no filters → visits from the last day. With filters → all
    /// history matching them (patient text, date range, treating-staff name, department).
    /// Filtering, ordering and counting happen in the DB over ALL matching records; only
    /// one page (50) is materialized. Relevance tiers for the viewer: 0 = treated by viewer
    /// (signed or last-edited the form), 1 = viewer's department, 2 = other — treated first,
    /// then own department, then newest-first within each tier.
    /// Note: tier/staff use the form's signer + last editor (queryable) for scale; the
    /// per-field editor list (FieldEdits) is still shown for context on the returned page.
    /// </summary>
    public async Task<HistoryResult> GetHistoryAsync(
        Guid viewerId, string? q, DateOnly? from, DateOnly? to, string? staff, string? department, int page)
    {
        page = Math.Max(0, page);
        var anyFilter = !string.IsNullOrWhiteSpace(q) || from.HasValue || to.HasValue
            || !string.IsNullOrWhiteSpace(staff) || !string.IsNullOrWhiteSpace(department);

        var viewerDept = (await db.Users.FindAsync(viewerId))?.Department;

        var query = db.Visits.Include(v => v.Patient).Include(v => v.Forms).AsQueryable();

        if (!string.IsNullOrWhiteSpace(department))
            query = query.Where(v => v.ReceptionDepartment == department);
        if (from.HasValue) query = query.Where(v => v.AdmissionDate >= from.Value);
        if (to.HasValue) query = query.Where(v => v.AdmissionDate <= to.Value);
        if (!string.IsNullOrWhiteSpace(q))
        {
            foreach (var token in q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(5))
            {
                var t = token;
                query = query.Where(v => v.Patient!.FirstName.Contains(t) || v.Patient.LastName.Contains(t) ||
                    (v.Patient.IdentityNumber != null && v.Patient.IdentityNumber.Contains(t)) ||
                    (v.Patient.FirstNameLatin != null && v.Patient.FirstNameLatin.Contains(t)) ||
                    (v.Patient.LastNameLatin != null && v.Patient.LastNameLatin.Contains(t)));
            }
        }
        if (!string.IsNullOrWhiteSpace(staff))
        {
            var s = staff.Trim();
            var staffIds = await db.Users.Where(u => u.FullName.Contains(s)).Select(u => u.Id).ToListAsync();
            query = query.Where(v => v.Forms.Any(f =>
                (f.SignedByName != null && f.SignedByName.Contains(s)) ||
                (f.UpdatedByUserId != null && staffIds.Contains(f.UpdatedByUserId.Value))));
        }
        if (!anyFilter)
        {
            var cutoffDate = DateOnly.FromDateTime(IsraelNow().AddDays(-1));
            query = query.Where(v => v.AdmissionDate >= cutoffDate);
        }

        var total = await query.CountAsync();

        var pageVisits = await query
            .OrderByDescending(v => v.Forms.Any(f => f.SignedByUserId == viewerId || f.UpdatedByUserId == viewerId))
            .ThenByDescending(v => viewerDept != null && v.ReceptionDepartment == viewerDept)
            .ThenByDescending(v => v.AdmissionDate).ThenByDescending(v => v.AdmissionTime).ThenBy(v => v.Id)
            .Skip(page * HistoryPageSize).Take(HistoryPageSize)
            .ToListAsync();

        var items = pageVisits.Select(v =>
        {
            string? signedBy = null;
            var editors = new List<string>();
            var treatedByViewer = v.Forms.Any(f => f.SignedByUserId == viewerId || f.UpdatedByUserId == viewerId);

            foreach (var f in v.Forms)
            {
                if (signedBy is null && !string.IsNullOrWhiteSpace(f.SignedByName)) signedBy = f.SignedByName;
                foreach (var (_, name) in ParseEditors(f.FieldEditsJson))
                    if (!string.IsNullOrWhiteSpace(name) && !editors.Contains(name)) editors.Add(name);
            }

            var tier = treatedByViewer ? 0
                : (!string.IsNullOrWhiteSpace(viewerDept) && v.ReceptionDepartment == viewerDept) ? 1
                : 2;

            return new VisitHistoryItem(
                v.Id, v.PatientId,
                $"{v.Patient!.FirstName} {v.Patient.LastName}", v.Patient.IdentityNumber,
                v.AdmissionDate, v.AdmissionTime, v.QueueNumber,
                v.ReceptionDepartment, v.Status, signedBy, editors, tier);
        }).ToList();

        return new HistoryResult(items, total, page, HistoryPageSize);
    }

    private static IEnumerable<(Guid Id, string Name)> ParseEditors(string? fieldEditsJson)
    {
        if (string.IsNullOrWhiteSpace(fieldEditsJson)) yield break;
        Dictionary<string, FieldEdit>? edits = null;
        try { edits = JsonSerializer.Deserialize<Dictionary<string, FieldEdit>>(fieldEditsJson, JsonOpts); }
        catch { yield break; }
        if (edits is null) yield break;
        foreach (var e in edits.Values) yield return (e.UserId, e.UserName);
    }

    public async Task<Visit> CreateAsync(Visit visit)
    {
        var now = IsraelNow();
        var queueDate = await CurrentQueueDateAsync();

        // Server-authoritative admission stamp so the queue number is tied to the
        // current queue-day (don't trust client-sent date/time).
        visit.AdmissionDate = queueDate;
        visit.AdmissionTime = TimeOnly.FromDateTime(now);

        visit.QueueNumber = await NextQueueNumberAsync(queueDate);
        db.Visits.Add(visit);
        await db.SaveChangesAsync();
        return visit;
    }

    /// <summary>
    /// Atomically reserves the next per-day running queue number. A single
    /// INSERT…ON CONFLICT…RETURNING avoids races; on the day's first insert it
    /// seeds from visits already recorded that day. Resets to 1 each new day.
    /// (Run via raw ADO.NET because INSERT…RETURNING is not composable for
    /// EF's SqlQuery wrapper.)
    /// </summary>
    private async Task<int> NextQueueNumberAsync(DateOnly today)
    {
        var conn = db.Database.GetDbConnection();
        var wasClosed = conn.State != ConnectionState.Open;
        if (wasClosed) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                """
                INSERT INTO "QueueCounters" ("DateKey", "LastNumber")
                VALUES (@d, (SELECT COALESCE(MAX("QueueNumber"), 0) + 1 FROM "Visits" WHERE "AdmissionDate" = @d))
                ON CONFLICT ("DateKey")
                DO UPDATE SET "LastNumber" = "QueueCounters"."LastNumber" + 1
                RETURNING "LastNumber";
                """;
            var p = cmd.CreateParameter();
            p.ParameterName = "d";
            p.Value = today;
            cmd.Parameters.Add(p);

            var result = await cmd.ExecuteScalarAsync();
            return Convert.ToInt32(result);
        }
        finally
        {
            if (wasClosed) await conn.CloseAsync();
        }
    }

    public async Task<Visit> UpdateStatusAsync(Guid id, VisitStatus status)
    {
        var visit = await db.Visits.FindAsync(id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");
        visit.Status = status;
        visit.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return visit;
    }

    public async Task<Visit> UpdateAsync(Guid id, Visit incoming)
    {
        var existing = await db.Visits
            .Include(v => v.Patient)
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");

        existing.ReceptionDepartment = incoming.ReceptionDepartment;
        existing.AdmissionMethod = incoming.AdmissionMethod;
        existing.AdmissionReason = incoming.AdmissionReason;
        existing.AdmissionReasonFree = incoming.AdmissionReasonFree;
        existing.ArrivalMethod = incoming.ArrivalMethod;
        existing.AmbulanceCompany = incoming.AmbulanceCompany;
        existing.ReferringSource = incoming.ReferringSource;
        existing.ReferringDoctor = incoming.ReferringDoctor;
        existing.IncidentNumber = incoming.IncidentNumber;
        existing.VisitNumberAtStation = incoming.VisitNumberAtStation;
        existing.CommitmentNumber = incoming.CommitmentNumber;
        existing.CommitmentExpiryDate = incoming.CommitmentExpiryDate;
        existing.ReceptionActivity = incoming.ReceptionActivity;
        existing.TotalToCollect = incoming.TotalToCollect;
        existing.ExemptionReason = incoming.ExemptionReason;
        existing.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return existing;
    }
}
