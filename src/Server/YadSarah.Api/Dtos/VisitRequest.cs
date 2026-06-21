using System.ComponentModel.DataAnnotations;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Dtos;

/// <summary>
/// Client-settable visit fields only. Server-controlled fields (Status, QueueNumber,
/// AdmissionDate/Time, timestamps, and <see cref="Visit.TotalToCollect"/> — which is
/// DERIVED server-side from the pricing table) are intentionally excluded to prevent
/// over-posting. The discount fields are accepted but only persist when accompanied by
/// valid shift-manager step-up credentials (verified in the controller).
/// </summary>
public class VisitRequest
{
    [Required]
    public Guid PatientId { get; set; }

    [StringLength(200)] public string? AdmissionReason { get; set; }

    // Department + AI-routing provenance (obtained from POST /api/reception/route-department,
    // echoed back so the chosen department and how it was decided are persisted).
    [StringLength(100)] public string? ReceptionDepartment { get; set; }
    public bool DepartmentAssignedByAi { get; set; }
    [Range(0, 1)] public double? DepartmentConfidence { get; set; }
    [StringLength(500)] public string? DepartmentCandidatesJson { get; set; }

    [StringLength(2000)] public string? Notes { get; set; }

    // Exemption reason — closed list (TODO pending: list from client).
    [StringLength(200)] public string? ExemptionReason { get; set; }

    // ── Discount / exemption (manager-gated) ──────────────────────────────────
    // DiscountReason persists ONLY if Approval* credentials verify to an active
    // ShiftManager/Admin (a manager may authorize even while reception is logged in).
    [StringLength(500)] public string? DiscountReason { get; set; }
    [StringLength(100)] public string? DiscountApprovalUsername { get; set; }
    [StringLength(200)] public string? DiscountApprovalPassword { get; set; }

    /// <summary>Maps the non-gated fields. The controller fills TotalToCollect (pricing)
    /// and the Discount approver stamp after verifying manager credentials.</summary>
    public Visit ToEntity() => new()
    {
        PatientId = PatientId,
        AdmissionReason = AdmissionReason,
        ReceptionDepartment = ReceptionDepartment,
        DepartmentAssignedByAi = DepartmentAssignedByAi,
        DepartmentConfidence = DepartmentConfidence,
        DepartmentCandidatesJson = DepartmentCandidatesJson,
        Notes = Notes,
        ExemptionReason = ExemptionReason,
        DiscountReason = DiscountReason,
    };
}
