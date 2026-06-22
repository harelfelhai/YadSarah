namespace YadSarah.Domain.Entities;

/// <summary>What the patient is waiting for / present at: a clinician (doctor/nurse) or a station (test).</summary>
public enum CareStepCategory { Clinician, Station }

/// <summary>
/// Lifecycle of a single care step. Numeric order must not change (EF stores enums as string,
/// but keep the declaration stable). Logical flow: Waiting → Called (paged) → InProgress
/// (the patient entered / the step began) → Done. Canceled is a terminal "no longer relevant".
/// </summary>
public enum CareStepStatus { Waiting, Called, InProgress, Done, Canceled }

/// <summary>
/// One dimension of a visit's live status. A visit has many care steps in parallel — the patient
/// may simultaneously be "waiting for a doctor", "waiting for a nurse", and "waiting for US".
/// Each step tracks who paged the patient and who is handling it (with the room), so at any moment
/// it is clear where the patient is and what they are waiting to enter.
/// </summary>
public class CareStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid VisitId { get; set; }
    public Visit? Visit { get; set; }

    public CareStepCategory Category { get; set; }

    /// <summary>Display label: a role label ("רופא"/"אחות") for clinician steps; a station name
    /// ("US", "בדיקת דם") for station steps.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>For clinician steps — which professional the patient is waiting for (Doctor/Nurse).
    /// Null for station steps.</summary>
    public UserRole? ClinicianRole { get; set; }

    /// <summary>For clinician steps — which department "track" this belongs to (the doctor/nurse of
    /// that department). Null for station steps.</summary>
    public string? Department { get; set; }

    /// <summary>Ordering of the medical tracks within a visit. 0 = first; in a dual (women's + other)
    /// visit the women's track is 0 and the other is 1.</summary>
    public int TrackOrder { get; set; }

    public CareStepStatus Status { get; set; } = CareStepStatus.Waiting;

    // ── Called (paged) — who called the patient and from which room ────────────
    public Guid? CalledByUserId { get; set; }
    public string? CalledByName { get; set; }
    public UserRole? CalledByRole { get; set; }
    public string? CalledRoom { get; set; }
    public DateTime? CalledAt { get; set; }

    // ── InProgress — who admitted/began the step and from which room ───────────
    public Guid? StartedByUserId { get; set; }
    public string? StartedByName { get; set; }
    public UserRole? StartedByRole { get; set; }
    public string? StartedRoom { get; set; }
    public DateTime? StartedAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    // ── Station referral source ───────────────────────────────────────────────
    // For a station step: who referred the patient here, so completing the station can
    // auto-create a "waiting for [the referrer]" clinician step (return to the referrer).
    public Guid? ReferredByUserId { get; set; }
    public string? ReferredByName { get; set; }
    public UserRole? ReferredByRole { get; set; }
    public string? ReferredByDepartment { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
