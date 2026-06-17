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

    // Reception details
    public string? ReceptionDepartment { get; set; }
    public DateOnly AdmissionDate { get; set; }
    public TimeOnly AdmissionTime { get; set; }
    public string? AdmissionMethod { get; set; }
    public string? AdmissionReason { get; set; }
    public string? AdmissionReasonFree { get; set; }
    public string? ArrivalMethod { get; set; }
    public string? AmbulanceCompany { get; set; }
    public string? ReferringSource { get; set; }
    public string? ReferringDoctor { get; set; }
    public string? IncidentNumber { get; set; }
    public string? VisitNumberAtStation { get; set; }
    public string? CommitmentNumber { get; set; }
    public DateOnly? CommitmentExpiryDate { get; set; }
    public string? ReceptionActivity { get; set; }
    public decimal? TotalToCollect { get; set; }
    public string? ExemptionReason { get; set; }

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
