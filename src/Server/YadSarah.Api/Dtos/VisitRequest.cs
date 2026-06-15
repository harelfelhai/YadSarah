using System.ComponentModel.DataAnnotations;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Dtos;

/// <summary>
/// Client-settable visit fields only. Server-controlled fields (Status,
/// QueueNumber, AdmissionDate/Time, Version, timestamps) are intentionally
/// excluded to prevent over-posting; the server assigns them.
/// </summary>
public class VisitRequest
{
    [Required]
    public Guid PatientId { get; set; }

    [StringLength(100)] public string? ReceptionDepartment { get; set; }
    [StringLength(100)] public string? AdmissionMethod { get; set; }
    [StringLength(200)] public string? AdmissionReason { get; set; }
    [StringLength(500)] public string? AdmissionReasonFree { get; set; }
    [StringLength(100)] public string? ArrivalMethod { get; set; }
    [StringLength(100)] public string? AmbulanceCompany { get; set; }
    [StringLength(200)] public string? ReferringSource { get; set; }
    [StringLength(200)] public string? ReferringDoctor { get; set; }
    [StringLength(100)] public string? IncidentNumber { get; set; }
    [StringLength(100)] public string? VisitNumberAtStation { get; set; }
    [StringLength(100)] public string? CommitmentNumber { get; set; }
    public DateOnly? CommitmentExpiryDate { get; set; }
    [StringLength(200)] public string? ReceptionActivity { get; set; }
    [Range(0, 1_000_000)] public decimal? TotalToCollect { get; set; }
    [StringLength(500)] public string? ExemptionReason { get; set; }

    public Visit ToEntity() => new()
    {
        PatientId = PatientId,
        ReceptionDepartment = ReceptionDepartment,
        AdmissionMethod = AdmissionMethod,
        AdmissionReason = AdmissionReason,
        AdmissionReasonFree = AdmissionReasonFree,
        ArrivalMethod = ArrivalMethod,
        AmbulanceCompany = AmbulanceCompany,
        ReferringSource = ReferringSource,
        ReferringDoctor = ReferringDoctor,
        IncidentNumber = IncidentNumber,
        VisitNumberAtStation = VisitNumberAtStation,
        CommitmentNumber = CommitmentNumber,
        CommitmentExpiryDate = CommitmentExpiryDate,
        ReceptionActivity = ReceptionActivity,
        TotalToCollect = TotalToCollect,
        ExemptionReason = ExemptionReason,
    };
}
