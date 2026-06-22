using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>Labels for clinician steps and the catalog of stations a clinician can refer to.
/// Mirrored on the client in constants/careSteps.ts — keep in sync.</summary>
public static class CareStepCatalog
{
    public const string DoctorLabel = "רופא";
    public const string NurseLabel = "אחות";

    /// <summary>Stations a clinician can send a patient to during treatment.</summary>
    public static readonly IReadOnlyList<string> Stations = new[]
    {
        "US", "בדיקת דם", "צילום", "CT", "אקג", "ייעוץ",
    };

    /// <summary>The role label for a clinician step. A patient waits for "a doctor" or "a nurse";
    /// a manager/admin acting as a clinician still targets the doctor track.</summary>
    public static string ClinicianLabel(UserRole role) => role == UserRole.Nurse ? NurseLabel : DoctorLabel;

    /// <summary>The clinician role a step targets, normalized to Doctor/Nurse (the only two
    /// professionals a patient explicitly waits for).</summary>
    public static UserRole NormalizeClinician(UserRole role) => role == UserRole.Nurse ? UserRole.Nurse : UserRole.Doctor;
}

/// <summary>
/// Owns the live multi-dimensional status (care steps) of a visit: the initial nurse+doctor steps,
/// calling/admitting/completing them, station referrals with auto-return to the referrer, and
/// deriving the coarse <see cref="VisitStatus"/> kept on the visit for analytics / the shift board.
/// </summary>
public class CareStepService(AppDbContext db)
{
    // ── Step factories ────────────────────────────────────────────────────────

    /// <summary>The two steps every new patient starts with: waiting for a nurse and a doctor.</summary>
    public static IEnumerable<CareStep> InitialSteps(string? department)
    {
        yield return ClinicianStep(UserRole.Nurse, department, trackOrder: 0);
        yield return ClinicianStep(UserRole.Doctor, department, trackOrder: 0);
    }

    /// <summary>A fresh "waiting for [role]" clinician step for a department track.</summary>
    public static CareStep ClinicianStep(UserRole role, string? department, int trackOrder) => new()
    {
        Category = CareStepCategory.Clinician,
        ClinicianRole = CareStepCatalog.NormalizeClinician(role),
        Label = CareStepCatalog.ClinicianLabel(role),
        Department = department,
        TrackOrder = trackOrder,
        Status = CareStepStatus.Waiting,
    };

    // ── Step transitions ───────────────────────────────────────────────────────

    /// <summary>Call (page) the patient for a waiting step — stamps who called and from which room.</summary>
    public async Task<CareStep> CallAsync(Guid stepId, Guid userId, string userName, UserRole role, string? room)
    {
        var step = await LoadActiveStepAsync(stepId);
        step.Status = CareStepStatus.Called;
        step.CalledByUserId = userId;
        step.CalledByName = userName;
        step.CalledByRole = role;
        step.CalledRoom = room;
        step.CalledAt = DateTime.UtcNow;
        step.UpdatedAt = DateTime.UtcNow;

        await RecomputeVisitStatusAsync(step.VisitId, enterActor: null);
        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>Admit the patient / begin the step (with or without a prior call) — moves to
    /// InProgress and, for a clinician step, stamps the visit's treating owner + room.</summary>
    public async Task<CareStep> EnterAsync(Guid stepId, Guid userId, string userName, UserRole role, string? room)
    {
        var step = await LoadActiveStepAsync(stepId);
        step.Status = CareStepStatus.InProgress;
        step.StartedByUserId = userId;
        step.StartedByName = userName;
        step.StartedByRole = role;
        step.StartedRoom = room;
        step.StartedAt = DateTime.UtcNow;
        step.UpdatedAt = DateTime.UtcNow;

        await RecomputeVisitStatusAsync(
            step.VisitId,
            enterActor: step.Category == CareStepCategory.Clinician
                ? new EnterActor(userId, userName, role, room)
                : null);
        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>Mark a step done. A completed station the patient was referred to auto-creates a
    /// "waiting for [the referrer]" clinician step, so the patient returns to whoever sent them.</summary>
    public async Task<CareStep> CompleteAsync(Guid stepId, Guid userId, string userName, UserRole role)
    {
        var step = await LoadActiveStepAsync(stepId);
        step.Status = CareStepStatus.Done;
        step.CompletedAt = DateTime.UtcNow;
        step.UpdatedAt = DateTime.UtcNow;

        if (step.Category == CareStepCategory.Station && step.ReferredByUserId is not null)
        {
            // Auto-return: re-add a waiting clinician step for the referrer's role + department,
            // so they review the result. Skip if such a waiting step already exists.
            var returnRole = CareStepCatalog.NormalizeClinician(step.ReferredByRole ?? UserRole.Doctor);
            var alreadyWaiting = await db.CareSteps.AnyAsync(s =>
                s.VisitId == step.VisitId &&
                s.Category == CareStepCategory.Clinician &&
                s.ClinicianRole == returnRole &&
                s.Department == step.ReferredByDepartment &&
                (s.Status == CareStepStatus.Waiting || s.Status == CareStepStatus.Called));
            if (!alreadyWaiting)
            {
                var returnStep = ClinicianStep(returnRole, step.ReferredByDepartment, trackOrder: 0);
                returnStep.VisitId = step.VisitId;
                db.CareSteps.Add(returnStep);
            }
        }

        await RecomputeVisitStatusAsync(step.VisitId, enterActor: null);
        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>Refer the patient to a station (a test/consult). Creates a waiting station step that
    /// remembers the referrer so completing it returns the patient to them.</summary>
    public async Task<CareStep> ReferToStationAsync(
        Guid visitId, string stationLabel, Guid userId, string userName, UserRole role, string? department)
    {
        var label = (stationLabel ?? string.Empty).Trim();
        if (!CareStepCatalog.Stations.Contains(label))
            throw new ArgumentException($"תחנה לא מוכרת: {label}");

        var step = new CareStep
        {
            VisitId = visitId,
            Category = CareStepCategory.Station,
            Label = label,
            Status = CareStepStatus.Waiting,
            ReferredByUserId = userId,
            ReferredByName = userName,
            ReferredByRole = role,
            ReferredByDepartment = department,
        };
        db.CareSteps.Add(step);

        await RecomputeVisitStatusAsync(visitId, enterActor: null);
        await db.SaveChangesAsync();
        return step;
    }

    // ── Dual department (women's + other) ───────────────────────────────────────

    /// <summary>
    /// Classify a visit into TWO department tracks — allowed ONLY when one of the two is women's
    /// ("נשים"), and only as a clinical professional's call. The women's track is handled first
    /// (TrackOrder 0). Ensures each track has nurse + doctor care-steps. The issued queue ticket
    /// (letter + number) is intentionally left unchanged — it stays a single queue row.
    /// </summary>
    public async Task<Visit> SetDualDepartmentAsync(
        Guid visitId, string secondaryDepartment, Guid userId, string userName, UserRole role)
    {
        var visit = await db.Visits
            .Include(v => v.CareSteps)
            .Include(v => v.Forms)
            .FirstOrDefaultAsync(v => v.Id == visitId)
            ?? throw new KeyNotFoundException($"Visit {visitId} not found");

        var primary = visit.ReceptionDepartment;
        var secondary = (secondaryDepartment ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(primary))
            throw new ArgumentException("למטופל אין מחלקה ראשית.");
        if (!Departments.All.Contains(secondary))
            throw new ArgumentException("מחלקה לא חוקית.");
        if (secondary == primary)
            throw new ArgumentException("המחלקה השנייה זהה למחלקה הראשית.");
        if (primary != Departments.Womens && secondary != Departments.Womens)
            throw new ArgumentException("שיוך כפול אפשרי רק כאשר אחת המחלקות היא נשים.");

        var womensDept = primary == Departments.Womens ? primary : secondary;
        var otherDept = primary == Departments.Womens ? secondary : primary;

        visit.SecondaryDepartment = secondary;
        visit.DepartmentAssignedByAi = false;
        visit.DepartmentChangedByUserId = userId;
        visit.DepartmentChangedByName = userName;
        visit.DepartmentChangedByRole = role;
        visit.DepartmentChangedAt = DateTime.UtcNow;
        visit.UpdatedAt = DateTime.UtcNow;

        // Re-track existing clinician steps so the women's track sorts first (0) and the other (1).
        foreach (var s in visit.CareSteps.Where(s => s.Category == CareStepCategory.Clinician))
        {
            if (s.Department == womensDept) s.TrackOrder = 0;
            else if (s.Department == otherDept) s.TrackOrder = 1;
        }

        EnsureClinicianTrack(visit, womensDept, 0);
        EnsureClinicianTrack(visit, otherDept, 1);

        // Compute the coarse status in-memory (the graph is fully loaded + freshly mutated).
        if (visit.Status != VisitStatus.Discharged)
        {
            var allFormsSigned = visit.Forms.Count > 0 && visit.Forms.All(f => f.IsSigned);
            visit.Status = DeriveStatus(visit.CareSteps, allFormsSigned);
        }

        await db.SaveChangesAsync();
        return visit;
    }

    /// <summary>Ensure a department track has both a nurse and a doctor waiting-step (idempotent).</summary>
    private void EnsureClinicianTrack(Visit visit, string department, int trackOrder)
    {
        foreach (var role in new[] { UserRole.Nurse, UserRole.Doctor })
        {
            var exists = visit.CareSteps.Any(s =>
                s.Category == CareStepCategory.Clinician &&
                s.ClinicianRole == role &&
                s.Department == department &&
                s.Status != CareStepStatus.Canceled);
            if (exists) continue;

            var step = ClinicianStep(role, department, trackOrder);
            step.VisitId = visit.Id;
            db.CareSteps.Add(step);
            visit.CareSteps.Add(step);
        }
    }

    // ── Visit status derivation ─────────────────────────────────────────────────

    private record EnterActor(Guid UserId, string UserName, UserRole Role, string? Room);

    /// <summary>Recompute the coarse <see cref="VisitStatus"/> from the visit's care steps + forms,
    /// and (when a clinician step just started) stamp the treating owner for the shift board.
    /// Never overrides an explicit Discharged state.</summary>
    private async Task RecomputeVisitStatusAsync(Guid visitId, EnterActor? enterActor)
    {
        var visit = await db.Visits
            .Include(v => v.CareSteps)
            .Include(v => v.Forms)
            .FirstOrDefaultAsync(v => v.Id == visitId);
        if (visit is null) return;

        if (enterActor is not null)
        {
            visit.TreatingUserId = enterActor.UserId;
            visit.TreatingUserName = enterActor.UserName;
            visit.TreatingUserRole = enterActor.Role;
            visit.TreatmentStartedAt = DateTime.UtcNow;
            visit.TreatmentRoom = enterActor.Room;
        }

        if (visit.Status == VisitStatus.Discharged) return; // terminal — set only by sign-all / manual discharge

        var allFormsSigned = visit.Forms.Count > 0 && visit.Forms.All(f => f.IsSigned);
        visit.Status = DeriveStatus(visit.CareSteps, allFormsSigned);
        visit.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>any InProgress → InTreatment; else any Called → Called; else (all done)
    /// → FinishedTreatment when every form is signed, otherwise InTreatment; else Waiting.</summary>
    public static VisitStatus DeriveStatus(IEnumerable<CareStep> steps, bool allFormsSigned)
    {
        var active = steps.Where(s => s.Status != CareStepStatus.Canceled).ToList();
        if (active.Count == 0) return VisitStatus.Waiting;
        if (active.Any(s => s.Status == CareStepStatus.InProgress)) return VisitStatus.InTreatment;
        if (active.Any(s => s.Status == CareStepStatus.Called)) return VisitStatus.Called;
        if (active.All(s => s.Status == CareStepStatus.Done))
            return allFormsSigned ? VisitStatus.FinishedTreatment : VisitStatus.InTreatment;
        return VisitStatus.Waiting;
    }

    private async Task<CareStep> LoadActiveStepAsync(Guid stepId)
    {
        var step = await db.CareSteps.FindAsync(stepId)
            ?? throw new KeyNotFoundException($"CareStep {stepId} not found");
        if (step.Status is CareStepStatus.Done or CareStepStatus.Canceled)
            throw new ArgumentException("הצעד כבר הסתיים.");
        return step;
    }
}
