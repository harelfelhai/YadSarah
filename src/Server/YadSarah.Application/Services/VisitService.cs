using System.Data;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class VisitService(AppDbContext db, SettingsService settings)
{
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

    public async Task<List<Visit>> GetQueueAsync()
    {
        // The active queue is a per-period board: only the current queue-day's
        // non-discharged visits — keeps the running number unambiguous.
        var queueDate = await CurrentQueueDateAsync();
        return await db.Visits
            .Include(v => v.Patient)
            .Where(v => v.Status != VisitStatus.Discharged && v.AdmissionDate == queueDate)
            .OrderBy(v => v.QueueNumber)
            .ToListAsync();
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
