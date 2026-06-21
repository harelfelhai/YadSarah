using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Reception-side review of patient self-service intake forms. Lists pending submissions and,
/// per submission, surfaces a field-by-field comparison against the existing patient (if matched
/// by identity) so reception can spot conflicts before importing/admitting.
/// </summary>
[ApiController]
[Route("api/intake-submissions")]
[Authorize(Roles = "Reception,ShiftManager,Admin")]
public class IntakeReviewController(IntakeSubmissionService intake, AuditService audit) : ControllerBase
{
    // GET /api/intake-submissions — pending forms (each flagged existing-patient / has-conflicts).
    [HttpGet]
    public async Task<IActionResult> Pending(CancellationToken ct)
    {
        var items = await intake.GetPendingAsync(ct);
        await audit.LogAsync(AuditService.Viewed, "PatientIntakeSubmission", default, "pending");
        return Ok(items);
    }

    // GET /api/intake-submissions/{id} — one submission with computed conflicts.
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var result = await intake.GetWithConflictsAsync(id, ct);
        if (result is null) return NotFound();
        await audit.LogAsync(AuditService.Viewed, "PatientIntakeSubmission", id);
        return Ok(result);
    }

    // POST /api/intake-submissions/{id}/dismiss — discard a submission (handled at the desk).
    [HttpPost("{id:guid}/dismiss")]
    public async Task<IActionResult> Dismiss(Guid id, CancellationToken ct)
    {
        if (!await intake.SetStatusAsync(id, IntakeStatus.Dismissed, ct)) return NotFound();
        await audit.LogAsync(AuditService.Updated, "PatientIntakeSubmission", id, "status", newValue: "Dismissed");
        return NoContent();
    }

    // POST /api/intake-submissions/{id}/imported — mark as used to admit (called after reception
    // creates the visit from the prefilled intake form).
    [HttpPost("{id:guid}/imported")]
    public async Task<IActionResult> Imported(Guid id, CancellationToken ct)
    {
        if (!await intake.SetStatusAsync(id, IntakeStatus.Imported, ct)) return NotFound();
        await audit.LogAsync(AuditService.Updated, "PatientIntakeSubmission", id, "status", newValue: "Imported");
        return NoContent();
    }
}
