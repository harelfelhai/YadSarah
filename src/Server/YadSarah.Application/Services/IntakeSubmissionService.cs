using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One field as the patient typed it vs. what the system already holds.</summary>
public record IntakeFieldDiff(string Field, string Label, string? Submitted, string? Existing, bool IsConflict);

/// <summary>A submission enriched for reception review: the matched existing patient (if any)
/// and a field-by-field comparison highlighting conflicts.</summary>
public record IntakeReviewResult(
    PatientIntakeSubmission Submission,
    Guid? ExistingPatientId,
    bool ExistingPatientMatched,
    bool HasConflicts,
    IReadOnlyList<IntakeFieldDiff> Diffs);

/// <summary>Outcome of a public submit — Accepted, or rejected because the device hit its cap.</summary>
public record IntakeCreateResult(bool Accepted, PatientIntakeSubmission? Submission);

/// <summary>
/// Staging-area logic for patient self-service intake forms. Submissions land in a separate
/// table (never the patient records) and are triaged by reception. Enforces the per-device
/// submit cap and computes conflicts against an existing patient.
/// </summary>
public class IntakeSubmissionService(AppDbContext db)
{
    /// <summary>
    /// Persist a public submission, enforcing the "max N per device per window" cap. When the
    /// device already has <paramref name="deviceLimit"/> submissions inside the window, returns
    /// <c>Accepted=false</c> (the controller maps that to 429). A missing device token can't be
    /// counted — those rely on the IP rate-limiter instead and are accepted here.
    /// </summary>
    public async Task<IntakeCreateResult> CreateAsync(
        PatientIntakeSubmission submission, int deviceLimit, TimeSpan window, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(submission.DeviceId))
        {
            var since = DateTime.UtcNow - window;
            var recent = await db.PatientIntakeSubmissions.CountAsync(
                s => s.DeviceId == submission.DeviceId && s.SubmittedAt >= since, ct);
            if (recent >= deviceLimit)
                return new IntakeCreateResult(false, null);
        }

        submission.Id = Guid.NewGuid();
        submission.Status = IntakeStatus.Pending;
        submission.SubmittedAt = DateTime.UtcNow;
        db.PatientIntakeSubmissions.Add(submission);
        await db.SaveChangesAsync(ct);
        return new IntakeCreateResult(true, submission);
    }

    /// <summary>Pending submissions for the reception review board, newest first, each flagged
    /// with whether it matches an existing patient and whether any field conflicts.</summary>
    public async Task<List<IntakeReviewResult>> GetPendingAsync(CancellationToken ct = default)
    {
        var pending = await db.PatientIntakeSubmissions
            .Where(s => s.Status == IntakeStatus.Pending)
            .OrderByDescending(s => s.SubmittedAt)
            .ToListAsync(ct);

        var results = new List<IntakeReviewResult>(pending.Count);
        foreach (var s in pending)
            results.Add(await BuildReviewAsync(s, ct));
        return results;
    }

    public async Task<IntakeReviewResult?> GetWithConflictsAsync(Guid id, CancellationToken ct = default)
    {
        var s = await db.PatientIntakeSubmissions.FindAsync([id], ct);
        return s is null ? null : await BuildReviewAsync(s, ct);
    }

    public async Task<bool> SetStatusAsync(Guid id, IntakeStatus status, CancellationToken ct = default)
    {
        var s = await db.PatientIntakeSubmissions.FindAsync([id], ct);
        if (s is null) return false;
        s.Status = status;
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ── Conflict computation ──────────────────────────────────────────────────
    private async Task<IntakeReviewResult> BuildReviewAsync(
        PatientIntakeSubmission s, CancellationToken ct)
    {
        Patient? existing = null;
        if (!string.IsNullOrWhiteSpace(s.IdentityNumber))
        {
            existing = await db.Patients.AsNoTracking().FirstOrDefaultAsync(
                p => p.IdentityType == s.IdentityType && p.IdentityNumber == s.IdentityNumber, ct);
        }

        var diffs = BuildDiffs(s, existing);
        return new IntakeReviewResult(
            s, existing?.Id, existing is not null,
            diffs.Any(d => d.IsConflict), diffs);
    }

    private static List<IntakeFieldDiff> BuildDiffs(PatientIntakeSubmission s, Patient? p)
    {
        // (label, submitted, existing) for each compared field. A conflict = both sides have a
        // value AND they differ (trim/case-insensitive). "Empty on one side, content on the other"
        // is NOT a conflict — it's shown as flowing info so reception can carry the content forward
        // (an empty existing value = new info from the patient; an empty submitted value = data the
        // system already holds). A field blank on BOTH sides is dropped.
        var fields = new (string Field, string Label, string? Submitted, string? Existing)[]
        {
            ("firstName", "שם פרטי", s.FirstName, p?.FirstName),
            ("lastName", "שם משפחה", s.LastName, p?.LastName),
            ("fatherName", "שם האב", s.FatherName, p?.FatherName),
            ("gender", "מין", s.Gender, p?.Gender),
            ("birthDate", "תאריך לידה", s.BirthDate?.ToString("yyyy-MM-dd"), p?.BirthDate?.ToString("yyyy-MM-dd")),
            ("city", "עיר", s.City, p?.City),
            ("street", "רחוב", s.Street, p?.Street),
            ("houseNumber", "מספר בית", s.HouseNumber, p?.HouseNumber),
            ("phoneMobile", "טלפון 1", s.PhoneMobile, p?.PhoneMobile),
            ("phoneHome", "טלפון 2", s.PhoneHome, p?.PhoneHome),
            ("email", "דוא\"ל", s.Email, p?.Email),
            ("healthFund", "קופת חולים", s.HealthFund, p?.HealthFund),
            ("digitalContactPerson", "איש קשר", s.DigitalContactPerson, p?.DigitalContactPerson),
            ("digitalContactRelation", "קרבה", s.DigitalContactRelation, p?.DigitalContactRelation),
            ("digitalContactPhone", "נייד איש קשר", s.DigitalContactPhone, p?.DigitalContactPhone),
        };

        var diffs = new List<IntakeFieldDiff>(fields.Length);
        foreach (var (field, label, submitted, existing) in fields)
        {
            var hasSubmitted = !string.IsNullOrWhiteSpace(submitted);
            var hasExisting = !string.IsNullOrWhiteSpace(existing);
            if (!hasSubmitted && !hasExisting) continue; // nothing on either side — skip
            var conflict = hasSubmitted && hasExisting &&
                           !string.Equals(submitted!.Trim(), existing!.Trim(), StringComparison.OrdinalIgnoreCase);
            diffs.Add(new IntakeFieldDiff(field, label, submitted, existing, conflict));
        }
        return diffs;
    }
}
