using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One room on the board: its occupant (current login) and whether they're treating a patient.</summary>
public record RoomStatus(
    Guid WorkstationId, string Room,
    Guid? UserId, string? UserName, string? UserRole,
    bool Occupied, bool Busy,
    int? PatientQueueNumber, string? PatientName);

/// <summary>One worker who logged in during the current shift, with their live busy state.</summary>
public record ShiftWorker(
    Guid UserId, string UserName, string? Role,
    bool Busy, int BusyCount, string? Room);

public record ShiftStatusResult(DateTime ShiftStartUtc, List<RoomStatus> Rooms, List<ShiftWorker> OnShift);

/// <summary>
/// Builds the shift-status board: which rooms are occupied/busy and who logged in during the
/// current shift. "Busy" is derived from a Visit currently in <see cref="VisitStatus.InTreatment"/>
/// owned by the user (Visit.TreatingUserId). The shift window starts at the most recent configured
/// shift-start hour (<see cref="SettingsService.ShiftStartHoursKey"/>), resolved in Israel local time.
/// </summary>
public class ShiftStatusService(AppDbContext db, SettingsService settings)
{
    private static readonly TimeZoneInfo IsraelTz =
        TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem");

    private static DateTime IsraelNow() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, IsraelTz);

    public async Task<ShiftStatusResult> GetCurrentStatusAsync()
    {
        var shiftStartUtc = await CurrentShiftStartUtcAsync();

        // Everyone currently being treated (single query; busy state derives from these).
        var inTreatment = await db.Visits
            .AsNoTracking()
            .Include(v => v.Patient)
            .Where(v => v.Status == VisitStatus.InTreatment && v.TreatingUserId != null)
            .ToListAsync();

        var workstations = await db.Workstations.AsNoTracking().OrderBy(w => w.RoomName).ToListAsync();

        string PatientName(Visit v) =>
            v.Patient is null ? "" : $"{v.Patient.FirstName} {v.Patient.LastName}".Trim();

        // ── Rooms ────────────────────────────────────────────────────────────
        // A room shows its current occupant only if they logged in during this shift
        // (a stale occupant from a previous shift reads as empty).
        var rooms = workstations.Select(w =>
        {
            var occupied = w.CurrentUserId.HasValue && w.LastLoginAt.HasValue && w.LastLoginAt.Value >= shiftStartUtc;
            var visit = occupied ? inTreatment.FirstOrDefault(v => v.TreatingUserId == w.CurrentUserId) : null;
            return new RoomStatus(
                w.Id, w.RoomName,
                occupied ? w.CurrentUserId : null,
                occupied ? w.CurrentUserName : null,
                occupied ? w.CurrentUserRole?.ToString() : null,
                occupied, Busy: visit is not null,
                visit?.QueueNumber, visit is null ? null : PatientName(visit));
        }).ToList();

        // ── On-shift roster ─────────────────────────────────────────────────
        // Distinct users with a successful Login audit event since the shift start.
        var loginUserIds = await db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == AuditService.Login && a.EntityType == "Auth"
                        && a.Timestamp >= shiftStartUtc && a.UserId != Guid.Empty)
            .Select(a => a.UserId)
            .Distinct()
            .ToListAsync();

        var users = await db.Users.AsNoTracking()
            .Where(u => loginUserIds.Contains(u.Id))
            .ToListAsync();

        // Use the SAME "occupied this shift" rule as the room cards (login since shift
        // start), so a roster chip never shows a room the board considers empty.
        var roomByUser = workstations
            .Where(w => w.CurrentUserId.HasValue && w.LastLoginAt.HasValue && w.LastLoginAt.Value >= shiftStartUtc)
            .GroupBy(w => w.CurrentUserId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(w => w.LastLoginAt).First().RoomName);

        var onShift = users
            .Select(u =>
            {
                var busyCount = inTreatment.Count(v => v.TreatingUserId == u.Id);
                return new ShiftWorker(
                    u.Id, u.FullName, u.Role.ToString(),
                    Busy: busyCount > 0, busyCount,
                    roomByUser.GetValueOrDefault(u.Id));
            })
            .OrderByDescending(w => w.Busy)
            .ThenBy(w => w.UserName)
            .ToList();

        return new ShiftStatusResult(shiftStartUtc, rooms, onShift);
    }

    /// <summary>
    /// The current shift's start, in UTC. Picks the most recent configured shift-start hour
    /// (today or yesterday, Israel local time) that is at or before now.
    /// </summary>
    private async Task<DateTime> CurrentShiftStartUtcAsync()
    {
        var raw = await settings.GetStringAsync(SettingsService.ShiftStartHoursKey, "07,15,23") ?? "07,15,23";
        var hours = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var h) ? h : -1)
            .Where(h => h is >= 0 and <= 23)
            .Distinct()
            .ToList();
        if (hours.Count == 0) hours = [7, 15, 23];

        var nowIsrael = IsraelNow();
        DateTime? best = null;
        foreach (var h in hours)
        {
            foreach (var dayOffset in new[] { 0, -1 })
            {
                var cand = nowIsrael.Date.AddDays(dayOffset).AddHours(h);
                if (cand <= nowIsrael && (best is null || cand > best))
                    best = cand;
            }
        }
        best ??= nowIsrael.Date;

        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(best.Value, DateTimeKind.Unspecified), IsraelTz);
    }
}
