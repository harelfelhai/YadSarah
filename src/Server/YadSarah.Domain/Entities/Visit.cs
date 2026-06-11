namespace YadSarah.Domain.Entities;

public enum VisitStatus { Waiting, Called, InTreatment, Discharged }

public class Visit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PatientId { get; set; }
    public Patient Patient { get; set; } = null!;

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

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<MedicalForm> Forms { get; set; } = [];
}
