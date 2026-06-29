using System.Data;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One row of the patient-history view (visit + patient + treating staff + relevance tier).</summary>
public record VisitHistoryItem(
    Guid VisitId, Guid PatientId, string PatientName, string? IdentityNumber,
    DateOnly AdmissionDate, TimeOnly? AdmissionTime, int QueueNumber, string? QueueLetter,
    string? Department, VisitStatus Status,
    string? SignedByName, List<string> Editors, int RelatedTier, DateTime? DepartedAt);

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
        // The queue board keeps showing every patient who hasn't been DISCHARGED — they
        // stay on the board until discharge, even across the daily reset boundary (only the
        // numbering resets each queue-day, not the patient list). includeDischarged ("הצג הכול")
        // additionally surfaces patients DISCHARGED during the current queue-day.
        var queueDate = await CurrentQueueDateAsync();
        var query = db.Visits
            .Include(v => v.Patient)
            .Include(v => v.CareSteps)
            .AsQueryable();
        query = includeDischarged
            ? query.Where(v => v.Status != VisitStatus.Discharged || v.AdmissionDate == queueDate)
            : query.Where(v => v.Status != VisitStatus.Discharged);
        return await query.OrderBy(v => v.QueueLetter).ThenBy(v => v.QueueNumber).ToListAsync();
    }

    public async Task<Visit?> GetByIdAsync(Guid id)
    {
        // Forms are clinical PHI and are fetched only via the gated FormsController.
        return await db.Visits
            .Include(v => v.Patient)
            .Include(v => v.CareSteps)
            .FirstOrDefaultAsync(v => v.Id == id);
    }

    public Task<bool> PatientExistsAsync(Guid patientId) =>
        db.Patients.AnyAsync(p => p.Id == patientId);

    // The patient's current health fund — used server-side to derive the ED charge
    // (the fund is re-entered each visit, so it reflects this visit's coverage).
    public Task<string?> GetPatientHealthFundAsync(Guid patientId) =>
        db.Patients.Where(p => p.Id == patientId).Select(p => p.HealthFund).FirstOrDefaultAsync();

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
        Guid viewerId, string? q, DateOnly? from, DateOnly? to, string? staff, string? department,
        VisitStatus? status, int page)
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
            // FieldEditsJson is serialized with the default (web) encoder, which escapes
            // non-ASCII to \uXXXX — so Hebrew editor names are stored escaped. A raw
            // Contains(s) therefore never matches a Hebrew name. Match the escaped form too
            // (Npgsql translates Contains to strpos, so the backslashes are literal, not a
            // LIKE pattern). This finds per-field editors shown under "ערכו:" without a
            // data migration. Keep the raw match for ASCII names / future raw-stored data.
            var sEscaped = JavaScriptEncoder.Default.Encode(s);
            query = query.Where(v => v.Forms.Any(f =>
                (f.SignedByName != null && f.SignedByName.Contains(s)) ||
                (f.UpdatedByUserId != null && staffIds.Contains(f.UpdatedByUserId.Value)) ||
                (f.FieldEditsJson != null &&
                    (f.FieldEditsJson.Contains(s) || f.FieldEditsJson.Contains(sEscaped)))));
        }
        // Status filter is orthogonal to the "recent 24h" default — it doesn't count as a
        // filter for the window, so the default view stays last-24h (+ the default status).
        if (status.HasValue)
            query = query.Where(v => v.Status == status.Value);
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
                v.AdmissionDate, v.AdmissionTime, v.QueueNumber, v.QueueLetter,
                v.ReceptionDepartment, v.Status, signedBy, editors, tier, v.DepartedAt);
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

        // Queue letter is derived from the department (one numbered queue per department);
        // the running number is per (day, letter).
        visit.QueueLetter = Departments.LetterFor(visit.ReceptionDepartment);
        visit.QueueNumber = await NextQueueNumberAsync(queueDate, visit.QueueLetter);

        // Every new patient starts the multi-dimensional clock — the initial steps depend on the
        // department (and, for pregnant women, on the admission reason: US/lab + monitor from week 28).
        foreach (var step in CareStepService.InitialSteps(visit.ReceptionDepartment, visit.AdmissionReason))
            visit.CareSteps.Add(step);

        db.Visits.Add(visit);
        await db.SaveChangesAsync();
        return visit;
    }

    /// <summary>
    /// Moves a visit into the special ("S") priority queue, assigning it the next running
    /// number in that queue for its queue-day. Used by a shift manager to advance a patient
    /// ahead of the per-department queues. No-op if the visit is already in the special queue.
    /// </summary>
    public async Task<Visit> MoveToSpecialQueueAsync(Guid id)
    {
        var visit = await db.Visits
            .Include(v => v.Patient)
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");

        if (visit.QueueLetter == Departments.SpecialQueueLetter) return visit;

        visit.QueueLetter = Departments.SpecialQueueLetter;
        visit.QueueNumber = await NextQueueNumberAsync(visit.AdmissionDate, Departments.SpecialQueueLetter);
        visit.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return visit;
    }

    /// <summary>Manager (Admin/ShiftManager) "call to me" presence — page the patient to the manager
    /// (<c>call</c>), mark them present with the manager (<c>enter</c>), or clear it (<c>clear</c>).
    /// Deliberately does NOT touch CareSteps or the derived <see cref="VisitStatus"/>: no one "waits
    /// for" a manager, so this never affects the clinical "ממתין ל" — it is a parallel presence only.</summary>
    public async Task<Visit> SetManagerPresenceAsync(Guid visitId, string action, Guid userId, string userName, string? room)
    {
        var visit = await db.Visits.Include(v => v.Patient).FirstOrDefaultAsync(v => v.Id == visitId)
            ?? throw new KeyNotFoundException($"Visit {visitId} not found");

        switch (action)
        {
            case "call":
            case "enter":
                visit.ManagerPresenceState = action == "call" ? ManagerPresenceState.Called : ManagerPresenceState.Present;
                visit.ManagerPresenceUserId = userId;
                visit.ManagerPresenceName = userName;
                visit.ManagerPresenceRoom = room;
                visit.ManagerPresenceAt = DateTime.UtcNow;
                break;
            case "clear":
                visit.ManagerPresenceState = ManagerPresenceState.None;
                visit.ManagerPresenceUserId = null;
                visit.ManagerPresenceName = null;
                visit.ManagerPresenceRoom = null;
                visit.ManagerPresenceAt = null;
                break;
            default:
                throw new ArgumentException("פעולה לא חוקית.");
        }
        visit.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return visit;
    }

    /// <summary>
    /// Atomically reserves the next per-(day, letter) running queue number. A single
    /// INSERT…ON CONFLICT…RETURNING avoids races; on that letter's first insert for the day
    /// it seeds from visits already recorded that day for the same letter. Resets to 1 each
    /// new day (per letter). (Run via raw ADO.NET because INSERT…RETURNING is not composable
    /// for EF's SqlQuery wrapper.)
    /// </summary>
    private async Task<int> NextQueueNumberAsync(DateOnly today, string letter)
    {
        var conn = db.Database.GetDbConnection();
        var wasClosed = conn.State != ConnectionState.Open;
        if (wasClosed) await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                """
                INSERT INTO "QueueCounters" ("DateKey", "QueueLetter", "LastNumber")
                VALUES (@d, @l, (SELECT COALESCE(MAX("QueueNumber"), 0) + 1 FROM "Visits" WHERE "AdmissionDate" = @d AND "QueueLetter" = @l))
                ON CONFLICT ("DateKey", "QueueLetter")
                DO UPDATE SET "LastNumber" = "QueueCounters"."LastNumber" + 1
                RETURNING "LastNumber";
                """;
            var pd = cmd.CreateParameter();
            pd.ParameterName = "d";
            pd.Value = today;
            cmd.Parameters.Add(pd);
            var pl = cmd.CreateParameter();
            pl.ParameterName = "l";
            pl.Value = letter;
            cmd.Parameters.Add(pl);

            var result = await cmd.ExecuteScalarAsync();
            return Convert.ToInt32(result);
        }
        finally
        {
            if (wasClosed) await conn.CloseAsync();
        }
    }

    public async Task<Visit> UpdateStatusAsync(Guid id, VisitStatus status,
        Guid? actingUserId = null, string? actingUserName = null,
        UserRole? actingRole = null, string? room = null)
    {
        var visit = await db.Visits.FindAsync(id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");

        // Discharged is terminal (set by sign-all / manual discharge), mirroring the invariant in
        // CareStepService.RecomputeVisitStatusAsync. Reopening it via a plain status PATCH would
        // decouple the live status from the signed clinical record, so reject the transition. A real
        // "reopen" workflow, if ever needed, must be an explicit, audited, RBAC-gated action.
        if (visit.Status == VisitStatus.Discharged && status != VisitStatus.Discharged)
            throw new InvalidOperationException("ביקור משוחרר אינו ניתן לפתיחה מחדש דרך שינוי-סטטוס.");

        visit.Status = status;
        visit.UpdatedAt = DateTime.UtcNow;

        // Stamp the departure instant on the first transition to Discharged (the basis for the
        // analytics census chart). Re-entry into the queue from a discharged state is not a flow
        // we support, so a single stamp is enough; don't overwrite an existing one.
        if (status == VisitStatus.Discharged && visit.DepartedAt is null)
            visit.DepartedAt = DateTime.UtcNow;

        // Moving into treatment stamps the single owner (whoever took the patient) and
        // the room of the workstation they acted from — the basis for the shift board's
        // busy/free state. A later transition by someone else replaces ownership.
        if (status == VisitStatus.InTreatment && actingUserId.HasValue)
        {
            visit.TreatingUserId = actingUserId;
            visit.TreatingUserName = actingUserName;
            visit.TreatingUserRole = actingRole;
            visit.TreatmentStartedAt = DateTime.UtcNow;
            visit.TreatmentRoom = room;
        }

        await db.SaveChangesAsync();
        return visit;
    }

    public async Task<Visit> UpdateAsync(Guid id, Visit incoming)
    {
        var existing = await db.Visits
            .Include(v => v.Patient)
            .FirstOrDefaultAsync(v => v.Id == id)
            ?? throw new KeyNotFoundException($"Visit {id} not found");

        // Slim event screen (2026-06-19). TotalToCollect is server-derived (set by the
        // controller via PricingService, not copied from the client). Discount fields are
        // manager-gated and updated only through the authorized create/discount path, so
        // they are intentionally NOT copied here.
        existing.ReceptionDepartment = incoming.ReceptionDepartment;
        existing.DepartmentAssignedByAi = incoming.DepartmentAssignedByAi;
        existing.DepartmentConfidence = incoming.DepartmentConfidence;
        existing.DepartmentCandidatesJson = incoming.DepartmentCandidatesJson;
        existing.AdmissionReason = incoming.AdmissionReason;
        existing.Notes = incoming.Notes;
        existing.ExemptionReason = incoming.ExemptionReason;
        existing.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return existing;
    }
}
