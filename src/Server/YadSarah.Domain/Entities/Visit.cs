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

    public int QueueNumber { get; set; }
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

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation — excluded from API serialization
    [System.Text.Json.Serialization.JsonIgnore]
    public ICollection<MedicalForm> Forms { get; set; } = [];
}
