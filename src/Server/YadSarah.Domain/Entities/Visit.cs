namespace YadSarah.Domain.Entities;

// Numeric order must not change (EF stores enums as int).
// Logical flow: Waiting → Called → InTreatment → FinishedTreatment → Discharged.
// FinishedTreatment (4) is appended last to preserve existing stored values.
public enum VisitStatus { Waiting, Called, InTreatment, Discharged, FinishedTreatment }

public class Visit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PatientId { get; set; }
    public Patient? Patient { get; set; }

    /// <summary>Per-department running number within the queue-day. Paired with
    /// <see cref="QueueLetter"/> to form the displayed ticket (e.g. "C-7").</summary>
    public int QueueNumber { get; set; }

    /// <summary>Queue letter: one per department (A,B,C,…) or "S" for the special
    /// (priority) queue. Each (day, letter) runs its own number sequence.</summary>
    public string? QueueLetter { get; set; }

    public VisitStatus Status { get; set; } = VisitStatus.Waiting;

    // ── Reception / event details ─────────────────────────────────────────────
    // Reworked 2026-06-19 to a slim "current-event" screen. Dropped legacy fields
    // (AdmissionMethod, AdmissionReasonFree, ArrivalMethod, AmbulanceCompany,
    // ReferringSource, ReferringDoctor, IncidentNumber, VisitNumberAtStation,
    // CommitmentNumber, CommitmentExpiryDate, ReceptionActivity).
    public DateOnly AdmissionDate { get; set; }
    public TimeOnly AdmissionTime { get; set; }

    /// <summary>Primary reason, entered first; drives AI department routing.</summary>
    public string? AdmissionReason { get; set; }

    /// <summary>Department the patient is routed to. Decided by AI routing — or chosen by
    /// reception among the AI-narrowed candidates when confidence is low.</summary>
    public string? ReceptionDepartment { get; set; }
    public bool DepartmentAssignedByAi { get; set; }
    public double? DepartmentConfidence { get; set; }
    /// <summary>JSON array of candidate departments offered when AI confidence was low
    /// (reception then picked one into ReceptionDepartment). Null on a confident assignment.</summary>
    public string? DepartmentCandidatesJson { get; set; }

    // ── Department reassignment (clinical override) ───────────────────────────
    /// <summary>When a clinician (NOT reception, NOT the AI) overrides the routed department,
    /// the professional who decided is stamped here. A non-null name ⇒ the department is a
    /// professional's determination, shown distinctly from an AI recommendation. Setting these
    /// also clears <see cref="DepartmentAssignedByAi"/>.</summary>
    public Guid? DepartmentChangedByUserId { get; set; }
    public string? DepartmentChangedByName { get; set; }
    public UserRole? DepartmentChangedByRole { get; set; }
    public DateTime? DepartmentChangedAt { get; set; }

    /// <summary>Free-text reception notes for this visit/event.</summary>
    public string? Notes { get; set; }

    /// <summary>Total charge — server-derived from the pricing table (read-only to the client).</summary>
    public decimal? TotalToCollect { get; set; }

    /// <summary>Exemption reason — closed list (TODO pending: list supplied by client).</summary>
    public string? ExemptionReason { get; set; }

    // ── Discount / exemption (manager-gated) ──────────────────────────────────
    /// <summary>Discount or exemption value. Settable ONLY with shift-manager step-up
    /// authorization; the approving manager is stamped below.</summary>
    public string? DiscountReason { get; set; }
    public Guid? DiscountApprovedByUserId { get; set; }
    public string? DiscountApprovedByName { get; set; }

    // ── Treating staff (single owner) ─────────────────────────────────────────
    // Stamped when a clinician moves the visit to InTreatment (the user who took the
    // patient + the room of the workstation they acted from). A later opener replaces
    // ownership. Kept after treatment ends for history/queue display; "busy" is derived
    // purely from Status == InTreatment, so no clearing is needed on discharge.
    public Guid? TreatingUserId { get; set; }
    public string? TreatingUserName { get; set; }
    public UserRole? TreatingUserRole { get; set; }
    public DateTime? TreatmentStartedAt { get; set; }
    public string? TreatmentRoom { get; set; }

    /// <summary>When the visit was discharged (status → Discharged). The patient's "departure"
    /// instant — paired with <see cref="CreatedAt"/> it bounds the time the patient was present,
    /// the basis for the analytics concurrent-presence (census) chart. Null while still present.</summary>
    public DateTime? DepartedAt { get; set; }

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation — excluded from API serialization
    [System.Text.Json.Serialization.JsonIgnore]
    public ICollection<MedicalForm> Forms { get; set; } = [];
}
