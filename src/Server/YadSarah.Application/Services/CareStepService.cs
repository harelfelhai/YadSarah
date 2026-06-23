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

    // Stations referenced by the obstetric (pregnant women's) intake track — named so the
    // initial-steps logic and the catalog stay in one place.
    public const string Ultrasound = "אולטרסאונד";
    public const string Lab = "בדיקות מעבדה";
    public const string Monitor = "מוניטור עוברי";

    // A referral back to a (regular) nurse in the SAME department (e.g. a doctor returning the patient
    // to a nurse). Unlike a department-station it does NOT move the patient — it just adds a "waiting
    // for a nurse" step in the current department.
    public const string GeneralNurse = "אחות כללית";

    /// <summary>Stations a clinician can send a patient to during treatment (and that pregnant
    /// women's intake pre-assigns). Mirrored on the client in constants/careSteps.ts — keep in sync.</summary>
    public static readonly IReadOnlyList<string> Stations = new[]
    {
        Ultrasound, "א.ק.ג", Lab, "צילום רנטגן", Monitor,
    };

    /// <summary>Referral targets that are really a DEPARTMENT move (label → department): selecting one
    /// reassigns the visit to that department's care rather than creating a parallel station step. One
    /// "רופא X" entry per department that has a doctor, plus "אחות עירוי" → the infusion department
    /// (nurse-only, no doctor). Mirrored on the client in constants/careSteps.ts — keep in sync.</summary>
    public static readonly IReadOnlyDictionary<string, string> DepartmentStations = new Dictionary<string, string>
    {
        ["רופא רפואה דחופה"] = Departments.Emergency,
        ["רופא ילדים"] = Departments.Pediatrics,
        ["רופא אורטופדיה"] = Departments.Orthopedics,
        ["רופא נשים"] = Departments.Womens,
        ["רופא ביקורת"] = Departments.Review,
        ["אחות עירוי"] = Departments.Infusion,
    };

    /// <summary>True if the label is a valid referral target — a regular station, the general-nurse
    /// referral, or a department-station.</summary>
    public static bool IsKnownReferral(string label) =>
        Stations.Contains(label) || label == GeneralNurse || DepartmentStations.ContainsKey(label);

    /// <summary>The clinician roles a department's patient waits for by default — the same mapping
    /// <see cref="CareStepService.InitialSteps"/> uses (אורטופדיה → doctor only; עירוי → nurse only;
    /// otherwise nurse + doctor). Drives both intake and a mid-treatment department move (referral).</summary>
    public static IReadOnlyList<UserRole> DefaultClinicianRoles(string? department) => department switch
    {
        Departments.Orthopedics => new[] { UserRole.Doctor },
        Departments.Infusion => new[] { UserRole.Nurse },
        _ => new[] { UserRole.Nurse, UserRole.Doctor },
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

    /// <summary>The care steps a new patient starts with, by department:
    ///   • אורטופדיה — doctor only (no nurse);
    ///   • עירוי תרופות — nurse only;
    ///   • נשים + pregnant — nurse + doctor + US + מעבדה (+ מוניטור from gestational week 28);
    ///   • otherwise — waiting for a nurse and a doctor.
    /// Pregnancy/week are read from the admission reason (same signal as routing — see PregnancyInfo).</summary>
    public static IEnumerable<CareStep> InitialSteps(string? department, string? admissionReason = null)
    {
        foreach (var role in CareStepCatalog.DefaultClinicianRoles(department))
            yield return ClinicianStep(role, department, trackOrder: 0);

        // Pregnant women's department gets obstetric stations pre-assigned from intake.
        if (department == Departments.Womens && PregnancyInfo.IsPregnant(admissionReason))
        {
            yield return StationStep(CareStepCatalog.Ultrasound);
            yield return StationStep(CareStepCatalog.Lab);
            if (PregnancyInfo.GestationalWeek(admissionReason) is >= 28)
                yield return StationStep(CareStepCatalog.Monitor);
        }
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

    /// <summary>A "waiting for [station]" step pre-assigned at intake — no referrer, so completing
    /// it does NOT auto-create a return step (unlike a clinician-initiated <see cref="ReferToStationAsync"/>).</summary>
    public static CareStep StationStep(string label, int trackOrder = 0) => new()
    {
        Category = CareStepCategory.Station,
        Label = label,
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
    /// InProgress and, for a clinician step, stamps the visit's treating owner + room. Enforces two
    /// invariants at this single chokepoint (the only place a patient becomes "אצל"):
    ///   • RBAC — a professional admits a patient only to the wait that targets their own track
    ///     (Doctor/MedStudent → doctor steps; Nurse/NursingStudent → nurse steps); ShiftManager/Admin
    ///     may admit to any wait; stations stay open to any clinical role.
    ///   • Exclusivity — a patient can be "אצל" only ONE professional (vacate the patient's other
    ///     in-progress steps), and a professional holds only ONE patient "אצלו" (vacate any in-progress
    ///     step they began on another patient). See <see cref="VacateInProgress"/> for the per-kind rule.</summary>
    public async Task<CareStep> EnterAsync(
        Guid stepId, Guid userId, string userName, UserRole role,
        IReadOnlyCollection<UserRole> roles, string? room)
    {
        var step = await LoadActiveStepAsync(stepId);
        EnsureMayEnter(step, roles);

        var now = DateTime.UtcNow;
        step.Status = CareStepStatus.InProgress;
        step.StartedByUserId = userId;
        step.StartedByName = userName;
        step.StartedByRole = role;
        step.StartedRoom = room;
        step.StartedAt = now;
        step.UpdatedAt = now;

        // Exclusivity: vacate every OTHER in-progress step that belongs to this patient (rule 1 —
        // one patient, one place) or was begun by this professional on another patient (rule 2 —
        // one professional, one patient). The freshly-entered step is excluded by Id.
        var toVacate = await db.CareSteps
            .Where(s => s.Id != step.Id && s.Status == CareStepStatus.InProgress &&
                        (s.VisitId == step.VisitId || s.StartedByUserId == userId))
            .ToListAsync();
        var affected = new HashSet<Guid> { step.VisitId };
        foreach (var s in toVacate) { VacateInProgress(s, now); affected.Add(s.VisitId); }

        // Recompute the entered visit (stamping the treating owner), then any OTHER visit whose step
        // was vacated by rule 2 (its coarse status must be re-derived from the changed steps).
        await RecomputeVisitStatusAsync(
            step.VisitId,
            enterActor: step.Category == CareStepCategory.Clinician
                ? new EnterActor(userId, userName, role, room)
                : null);
        foreach (var id in affected)
            if (id != step.VisitId)
                await RecomputeVisitStatusAsync(id, enterActor: null);

        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>Authorize an "enter" (admit): a professional may admit a patient only to a wait that
    /// targets their own track. ShiftManager/Admin may admit to any wait; station steps are open to
    /// any clinical role (the controller already gates the broad action set).</summary>
    private static void EnsureMayEnter(CareStep step, IReadOnlyCollection<UserRole> roles)
    {
        if (roles.Contains(UserRole.ShiftManager) || roles.Contains(UserRole.Admin)) return;
        if (step.Category != CareStepCategory.Clinician) return; // station — no track restriction

        var ok = step.ClinicianRole == UserRole.Nurse
            ? roles.Contains(UserRole.Nurse) || roles.Contains(UserRole.NursingStudent)
            : roles.Contains(UserRole.Doctor) || roles.Contains(UserRole.MedStudent);
        if (!ok)
            throw new ForbiddenException("ניתן להכניס מטופל רק להמתנה התואמת לתפקידך.");
    }

    /// <summary>Take a step out of the live "אצל"/"בבדיקת" (InProgress) state because the patient moved
    /// to someone else, or the professional moved to another patient. A DOCTOR step goes back to Waiting
    /// (the doctor wait ends only at signing) and the interrupted treatment is converted to a soft claim,
    /// so that doctor stays the responsible party and resumes. Everything else (a nurse / any non-doctor
    /// clinician / a station) is considered finished → Done.</summary>
    private static void VacateInProgress(CareStep s, DateTime now)
    {
        if (s.Category == CareStepCategory.Clinician && s.ClinicianRole == UserRole.Doctor)
        {
            s.ClaimedByUserId ??= s.StartedByUserId;
            s.ClaimedByName ??= s.StartedByName;
            s.ClaimedAt ??= now;
            s.Status = CareStepStatus.Waiting;
            s.StartedByUserId = null;
            s.StartedByName = null;
            s.StartedByRole = null;
            s.StartedRoom = null;
            s.StartedAt = null;
        }
        else
        {
            s.Status = CareStepStatus.Done;
            s.CompletedAt = now;
        }
        s.UpdatedAt = now;
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

    /// <summary>The result of a (possibly multi-target) referral: the accepted referral labels (for the
    /// audit trail — covers stations, the general-nurse referral, and department-moves alike), the station
    /// steps created, and the department the patient was moved to if any target was a department-station.</summary>
    public record ReferralResult(
        IReadOnlyList<string> ReferredLabels, IReadOnlyList<CareStep> StationSteps, string? ReassignedDepartment);

    /// <summary>Refer the patient to one or more targets in a single action. A regular station creates a
    /// "waiting for [station]" step (remembering the referrer for auto-return). A department-station
    /// (<see cref="CareStepCatalog.DepartmentStations"/>, e.g. "רופא נשים") instead MOVES the patient to
    /// that department — reassigns the visit's department (referral provenance, queue ticket kept) and
    /// adds that department's default clinician waiting-steps that aren't already active. Kinds may mix.</summary>
    public async Task<ReferralResult> ReferToStationsAsync(
        Guid visitId, IReadOnlyList<string> labels, Guid userId, string userName, UserRole role, string? department)
    {
        var clean = (labels ?? Array.Empty<string>())
            .Select(l => (l ?? string.Empty).Trim())
            .Where(l => l.Length > 0)
            .Distinct()
            .ToList();
        if (clean.Count == 0) throw new ArgumentException("לא נבחרו תחנות.");
        foreach (var l in clean)
            if (!CareStepCatalog.IsKnownReferral(l))
                throw new ArgumentException($"תחנה לא מוכרת: {l}");

        var visit = await db.Visits.Include(v => v.CareSteps).Include(v => v.Forms)
            .FirstOrDefaultAsync(v => v.Id == visitId)
            ?? throw new KeyNotFoundException($"Visit {visitId} not found");

        var stationSteps = new List<CareStep>();
        string? reassignedTo = null;

        foreach (var label in clean)
        {
            if (label == CareStepCatalog.GeneralNurse)
            {
                // Send the patient back to a regular nurse in the current department (no department move).
                AddClinicianStepIfAbsent(visit, UserRole.Nurse, visit.ReceptionDepartment);
            }
            else if (CareStepCatalog.DepartmentStations.TryGetValue(label, out var targetDept))
            {
                ReassignByReferral(visit, targetDept, userId, userName, role);
                reassignedTo = targetDept;
            }
            else
            {
                var step = new CareStep
                {
                    VisitId = visitId,
                    Category = CareStepCategory.Station,
                    Label = label,
                    Status = CareStepStatus.Waiting,
                    ReferredByUserId = userId,
                    ReferredByName = userName,
                    ReferredByRole = role,
                    ReferredByDepartment = visit.ReceptionDepartment,
                };
                db.CareSteps.Add(step);
                visit.CareSteps.Add(step);
                stationSteps.Add(step);
            }
        }

        if (visit.Status != VisitStatus.Discharged)
        {
            var allFormsSigned = visit.Forms.Count > 0 && visit.Forms.All(f => f.IsSigned);
            visit.Status = DeriveStatus(visit.CareSteps, allFormsSigned);
            visit.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return new ReferralResult(clean, stationSteps, reassignedTo);
    }

    /// <summary>Move the visit to a department because of a clinician's referral (e.g. "רופא נשים"):
    /// stamp the department + referring professional (not AI), KEEP the queue ticket, and RECONCILE the
    /// patient's clinician waits to the new department's defaults — cancel active clinician steps whose
    /// role the new department doesn't use (the previous department's no-longer-relevant defaults),
    /// KEEP a role both departments share (e.g. "ממתין לרופא"), and add any missing default role. Explicit
    /// station referrals are untouched; the visit's department supplies the "which doctor" context.</summary>
    private void ReassignByReferral(Visit visit, string targetDept, Guid userId, string userName, UserRole role)
    {
        if (visit.ReceptionDepartment != targetDept)
        {
            visit.ReceptionDepartment = targetDept;
            visit.DepartmentAssignedByAi = false;
            visit.DepartmentConfidence = null;
            visit.DepartmentCandidatesJson = null;
            visit.DepartmentChangedByUserId = userId;
            visit.DepartmentChangedByName = userName;
            visit.DepartmentChangedByRole = role;
            visit.DepartmentChangedAt = DateTime.UtcNow;
            visit.UpdatedAt = DateTime.UtcNow;
        }

        var newRoles = CareStepCatalog.DefaultClinicianRoles(targetDept);

        // Remove the previous department's defaults that the new one doesn't need (a shared role stays).
        foreach (var s in visit.CareSteps.Where(s =>
            s.Category == CareStepCategory.Clinician &&
            s.ClinicianRole is UserRole r && !newRoles.Contains(r) &&
            s.Status is CareStepStatus.Waiting or CareStepStatus.Called or CareStepStatus.InProgress))
        {
            s.Status = CareStepStatus.Canceled;
            s.UpdatedAt = DateTime.UtcNow;
        }

        // Add the new department's default clinician waits that aren't already active.
        foreach (var defaultRole in newRoles)
            AddClinicianStepIfAbsent(visit, defaultRole, targetDept);
    }

    /// <summary>Add a "waiting for [role]" clinician step in the given department, unless the visit already
    /// has an active (waiting/called/in-progress) step for that role. Shared by the general-nurse referral
    /// (send the patient back to a regular nurse) and the department-move reconcile above.</summary>
    private void AddClinicianStepIfAbsent(Visit visit, UserRole role, string? department)
    {
        var normalized = CareStepCatalog.NormalizeClinician(role);
        var hasActive = visit.CareSteps.Any(s =>
            s.Category == CareStepCategory.Clinician &&
            s.ClinicianRole == normalized &&
            s.Status is CareStepStatus.Waiting or CareStepStatus.Called or CareStepStatus.InProgress);
        if (hasActive) return;

        var step = ClinicianStep(normalized, department, trackOrder: 0);
        step.VisitId = visit.Id;
        db.CareSteps.Add(step);
        visit.CareSteps.Add(step);
    }

    // ── Doctor claim (take a patient under your care without starting treatment) ──

    /// <summary>A doctor "takes a patient under their care" without starting treatment: marks the visit's
    /// active Doctor clinician step as claimed by this doctor. The step stays Waiting/Called (no status
    /// change, so the coarse visit status / analytics are untouched), but other doctors now see it is taken
    /// ("ממתין לד״ר X") and the patient sinks below unclaimed ones in the queue. Override is allowed —
    /// re-claiming a step already claimed by another doctor just reassigns it (audited by the caller).</summary>
    public async Task<CareStep> ClaimDoctorStepAsync(Guid stepId, Guid userId, string userName)
    {
        var step = await LoadActiveStepAsync(stepId);
        if (step.Category != CareStepCategory.Clinician || step.ClinicianRole != UserRole.Doctor)
            throw new ArgumentException("ניתן לשייך לרופא רק צעד של רופא.");
        if (step.Status is not (CareStepStatus.Waiting or CareStepStatus.Called))
            throw new ArgumentException("ניתן לשייך רק מטופל הממתין לרופא (לפני תחילת טיפול).");

        step.ClaimedByUserId = userId;
        step.ClaimedByName = userName;
        step.ClaimedAt = DateTime.UtcNow;
        step.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>Release a doctor's claim (clear the soft assignment), returning the patient to the
    /// unassigned "ממתין לרופא" pool. Allowed only for the claiming doctor or a shift-manager/admin
    /// (<paramref name="isManager"/>) — a different doctor who wants the patient re-claims instead.</summary>
    public async Task<CareStep> ReleaseDoctorClaimAsync(Guid stepId, Guid userId, bool isManager)
    {
        var step = await LoadActiveStepAsync(stepId);
        if (step.ClaimedByUserId is Guid claimer && claimer != userId && !isManager)
            throw new ArgumentException("רק הרופא המשייך או מנהל משמרת יכולים לשחרר את השיוך.");

        step.ClaimedByUserId = null;
        step.ClaimedByName = null;
        step.ClaimedAt = null;
        step.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return step;
    }

    /// <summary>A non-doctor professional finished their part (clicked "סיים" or left the medical form):
    /// complete the active NURSE clinician step(s) for the visit — WITHOUT discharging. The patient keeps
    /// waiting for the doctor (and any stations). Only a doctor's signature discharges, so this never
    /// touches a doctor step (the only non-doctor clinician track is the nurse's).</summary>
    public async Task<Visit> FinishNonDoctorAsync(Guid visitId, Guid userId, string userName, UserRole role)
    {
        var visit = await db.Visits.Include(v => v.CareSteps).Include(v => v.Forms)
            .FirstOrDefaultAsync(v => v.Id == visitId)
            ?? throw new KeyNotFoundException($"Visit {visitId} not found");

        foreach (var s in visit.CareSteps.Where(s =>
            s.Category == CareStepCategory.Clinician &&
            s.ClinicianRole == UserRole.Nurse &&
            s.Status != CareStepStatus.Done && s.Status != CareStepStatus.Canceled))
        {
            s.Status = CareStepStatus.Done;
            s.CompletedAt = DateTime.UtcNow;
            s.UpdatedAt = DateTime.UtcNow;
        }

        if (visit.Status != VisitStatus.Discharged)
        {
            var allFormsSigned = visit.Forms.Count > 0 && visit.Forms.All(f => f.IsSigned);
            visit.Status = DeriveStatus(visit.CareSteps, allFormsSigned);
            visit.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return visit;
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
