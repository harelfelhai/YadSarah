using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;
using YadSarah.Api.Dtos;
using YadSarah.Api.Hubs;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/visits")]
[Authorize]
public class VisitsController(
    VisitService svc, IHubContext<MainHub> hub, AuditService audit, WorkstationService workstations,
    AuthService auth, PricingService pricing, CareStepService steps) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
    private string UserName => User.FindFirstValue("fullName") ?? User.Identity?.Name ?? "";
    private UserRole CallerRole =>
        Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var r) ? r : UserRole.Reception;

    [HttpGet("queue")]
    public async Task<IActionResult> GetQueue([FromQuery] bool all = false) =>
        Ok(await svc.GetQueueAsync(includeDischarged: all));

    // GET /api/visits/history — paged patient-history view (default: last day; or filtered).
    [HttpGet("history")]
    public async Task<IActionResult> History(
        [FromQuery] string? q, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] string? staff, [FromQuery] string? department,
        [FromQuery] VisitStatus? status, [FromQuery] int page = 0)
    {
        if (q is { Length: > 80 }) q = q[..80];
        if (staff is { Length: > 80 }) staff = staff[..80];
        var result = await svc.GetHistoryAsync(UserId, q, from, to, staff, department, status, page);
        await audit.LogAsync(AuditService.Searched, "Visit", fieldName: "history");
        return Ok(result);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var v = await svc.GetByIdAsync(id);
        if (v is null) return NotFound();
        await audit.LogAsync(AuditService.Viewed, "Visit", id);
        return Ok(v);
    }

    // GET /api/visits/by-patient/{patientId} — full visit history for a patient
    [HttpGet("by-patient/{patientId:guid}")]
    public async Task<IActionResult> GetByPatient(Guid patientId)
    {
        await audit.LogAsync(AuditService.Viewed, "Visit", patientId, "byPatient");
        return Ok(await svc.GetByPatientAsync(patientId));
    }

    [HttpPost]
    [Authorize(Roles = "Reception,ShiftManager,Admin")]
    public async Task<IActionResult> Create([FromBody] VisitRequest req)
    {
        if (!await svc.PatientExistsAsync(req.PatientId))
            return BadRequest(new { message = "מטופל לא קיים." });

        var entity = req.ToEntity();

        // Discount/exemption is manager-gated: it persists ONLY with valid shift-manager step-up
        // credentials (a manager may authorize while reception is logged in). Re-verified here even
        // though the client also calls /reception/authorize-discount, so the gate isn't client-trusted.
        var discountAuthorized = false;
        if (!string.IsNullOrWhiteSpace(req.DiscountReason))
        {
            var manager = await auth.VerifyCredentialsAsync(
                req.DiscountApprovalUsername ?? "", req.DiscountApprovalPassword ?? "");
            var isManager = manager is not null &&
                (manager.Roles.Contains(UserRole.ShiftManager) || manager.Roles.Contains(UserRole.Admin));
            if (!isManager)
                return StatusCode(403, new { message = "החלת הנחה/פטור מחייבת אישור מנהל משמרת." });

            entity.DiscountApprovedByUserId = manager!.Id;
            entity.DiscountApprovedByName = manager.DisplayName ?? manager.FullName;
            discountAuthorized = true;
            await audit.LogAsync("DiscountApplied", "Visit", default, "discount", newValue: manager.Username);
        }
        else
        {
            entity.DiscountReason = null; // no client-sent approver stamp without a discount value
        }

        // TotalToCollect is server-derived from the pricing table (never trust the client):
        // keyed on the patient's health fund + arrival mode (referral vs self) + exemptions.
        var healthFund = await svc.GetPatientHealthFundAsync(req.PatientId);
        entity.TotalToCollect = await pricing.CalculateAsync(
            healthFund, entity.ExemptionReason, discountAuthorized);

        var created = await svc.CreateAsync(entity);
        await audit.LogAsync(AuditService.Created, "Visit", created.Id);
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = created.Id,
            status = created.Status.ToString(),
            queueNumber = created.QueueNumber,
            queueLetter = created.QueueLetter,
        });
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Reception,ShiftManager,Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] VisitRequest req)
    {
        try
        {
            var updated = await svc.UpdateAsync(id, req.ToEntity());
            await audit.LogAsync(AuditService.Updated, "Visit", id);
            return Ok(updated);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest req)
    {
        if (!Enum.TryParse<VisitStatus>(req.Status, out var status))
            return BadRequest("Invalid status");

        // FinishedTreatment is reached ONLY by signing the form (FormsController.Sign,
        // which enforces step-up re-auth). Allowing it via a plain status PATCH would
        // bypass that integrity/non-repudiation control — so it is never settable here.
        if (status == VisitStatus.FinishedTreatment)
            return Forbid();

        // Discharge authority: a doctor discharges automatically by signing the form
        // (FormsController.Sign, with step-up re-auth); a manual release here is limited to
        // shift-manager / admin. Plain reception no longer discharges, and clinical staff
        // (doctor/nurse) end a treatment by signing — not via this status PATCH.
        if (status == VisitStatus.Discharged &&
            !(User.IsInRole("ShiftManager") || User.IsInRole("Admin")))
            return Forbid();

        // When a clinician starts treatment, stamp them as the (single) treating owner and
        // the room of the workstation they're acting from — feeds the shift-status board.
        string? room = null;
        if (status == VisitStatus.InTreatment)
            room = await workstations.ResolveRoomAsync(req.DeviceId);

        var updated = await svc.UpdateStatusAsync(
            id, status,
            actingUserId: status == VisitStatus.InTreatment ? UserId : null,
            actingUserName: status == VisitStatus.InTreatment ? UserName : null,
            actingRole: status == VisitStatus.InTreatment ? CallerRole : null,
            room: room);

        await audit.LogAsync(AuditService.StatusChanged, "Visit", id, "Status", newValue: status.ToString());
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = updated.Id,
            status = updated.Status.ToString(),
            queueNumber = updated.QueueNumber,
            queueLetter = updated.QueueLetter,
            treatingUserName = updated.TreatingUserName,
            room = updated.TreatmentRoom,
        });
        return Ok(updated);
    }

    // PATCH /api/visits/{id}/special-queue — move a patient into the special ("S") priority
    // queue. Shift-manager / admin only: it's a deliberate override to advance someone ahead
    // of the per-department queues.
    [HttpPatch("{id:guid}/special-queue")]
    [Authorize(Roles = "ShiftManager,Admin")]
    public async Task<IActionResult> MoveToSpecialQueue(Guid id)
    {
        try
        {
            var updated = await svc.MoveToSpecialQueueAsync(id);
            await audit.LogAsync(AuditService.StatusChanged, "Visit", id, "QueueLetter", newValue: updated.QueueLetter);
            await hub.Clients.All.SendAsync("QueueUpdate", new
            {
                visitId = updated.Id,
                status = updated.Status.ToString(),
                queueNumber = updated.QueueNumber,
                queueLetter = updated.QueueLetter,
            });
            return Ok(updated);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    // PATCH /api/visits/{id}/department — a clinical professional overrides the AI/reception
    // routing and assigns a different department. Reception is intentionally NOT allowed (the
    // routing decision is theirs only at intake); the AI never reaches this path. The chosen
    // department + the deciding professional are stamped so the UI marks it as a professional's
    // call rather than an AI recommendation.
    [HttpPatch("{id:guid}/department")]
    [Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent")]
    public async Task<IActionResult> ReassignDepartment(Guid id, [FromBody] ReassignDepartmentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Department) || !Departments.All.Contains(req.Department))
            return BadRequest(new { message = "מחלקה לא חוקית." });
        try
        {
            var updated = await svc.ReassignDepartmentAsync(id, req.Department, UserId, UserName, CallerRole);
            await audit.LogAsync("DepartmentReassigned", "Visit", id, "ReceptionDepartment", newValue: req.Department);
            await hub.Clients.All.SendAsync("QueueUpdate", new
            {
                visitId = updated.Id,
                status = updated.Status.ToString(),
                queueNumber = updated.QueueNumber,
                queueLetter = updated.QueueLetter,
            });
            return Ok(updated);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    // PATCH /api/visits/{id}/dual-department — a clinician classifies the patient into a SECOND
    // department track. Allowed only when one of the two departments is women's (enforced in the
    // service). Opens a second medical process; the queue ticket is unchanged (single row).
    [HttpPatch("{id:guid}/dual-department")]
    [Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent")]
    public async Task<IActionResult> SetDualDepartment(Guid id, [FromBody] DualDepartmentRequest req)
    {
        try
        {
            var updated = await steps.SetDualDepartmentAsync(id, req.SecondaryDepartment, UserId, UserName, CallerRole);
            await audit.LogAsync("DualDepartmentSet", "Visit", id, "SecondaryDepartment", newValue: req.SecondaryDepartment);
            await BroadcastQueueUpdateAsync(id);
            return Ok(updated);
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // ── Care steps (live multi-dimensional status) ─────────────────────────────

    // POST /api/visits/{id}/steps — a clinician refers the patient to one or more stations (test/consult)
    // in a single action. A regular station creates a "waiting for [station]" step (auto-returns to the
    // referrer on completion); a department-station (e.g. "רופא נשים") instead moves the patient to that
    // department and seeds its default clinician waits.
    [HttpPost("{id:guid}/steps")]
    [Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent")]
    public async Task<IActionResult> ReferToStation(Guid id, [FromBody] ReferStationRequest req)
    {
        try
        {
            var result = await steps.ReferToStationsAsync(
                id, req.Labels, UserId, UserName, CallerRole, req.Department);
            if (result.ReferredLabels.Count > 0)
                await audit.LogAsync("CareStepReferred", "Visit", id, "careStep",
                    newValue: string.Join(", ", result.ReferredLabels));
            if (result.ReassignedDepartment is not null)
                await audit.LogAsync("DepartmentReassignedByReferral", "Visit", id, "ReceptionDepartment",
                    newValue: result.ReassignedDepartment);
            await BroadcastQueueUpdateAsync(id);
            return Ok(result.StationSteps);
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // POST /api/visits/{id}/finish — a NON-doctor professional finished their part (clicked "סיים" or
    // left the medical form). Completes their nurse clinician step(s) WITHOUT discharging. A doctor
    // finishes by signing the form (POST /forms/{id}/sign), so the Doctor role is intentionally excluded.
    [HttpPost("{id:guid}/finish")]
    [Authorize(Roles = "Nurse,ShiftManager,Admin,NursingStudent,LabStaff")]
    public async Task<IActionResult> FinishNonDoctor(Guid id, [FromBody] FinishNonDoctorRequest? req = null)
    {
        try
        {
            var updated = await steps.FinishNonDoctorAsync(id, UserId, UserName, CallerRole);
            await audit.LogAsync("CareStepNonDoctorFinished", "Visit", id, "careStep");
            await BroadcastQueueUpdateAsync(id);
            return Ok(updated);
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    // PATCH /api/visits/{id}/steps/{stepId} — advance a step: call (page) / enter (admit) / complete.
    [HttpPatch("{id:guid}/steps/{stepId:guid}")]
    [Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin,MedStudent,NursingStudent,LabStaff")]
    public async Task<IActionResult> UpdateStep(Guid id, Guid stepId, [FromBody] StepActionRequest req)
    {
        var action = (req.Action ?? "").Trim().ToLowerInvariant();
        try
        {
            CareStep step;
            switch (action)
            {
                case "call":
                    step = await steps.CallAsync(stepId, UserId, UserName, CallerRole,
                        await workstations.ResolveRoomAsync(req.DeviceId));
                    break;
                case "enter":
                    step = await steps.EnterAsync(stepId, UserId, UserName, CallerRole,
                        await workstations.ResolveRoomAsync(req.DeviceId));
                    break;
                case "complete":
                    step = await steps.CompleteAsync(stepId, UserId, UserName, CallerRole);
                    break;
                case "claim":
                case "release":
                    // Claiming a patient ("take under my care") is a doctor decision — restrict to
                    // doctor-capable roles regardless of the broader step-action authorization above.
                    if (!(User.IsInRole(nameof(UserRole.Doctor)) || User.IsInRole(nameof(UserRole.ShiftManager)) || User.IsInRole(nameof(UserRole.Admin))))
                        return StatusCode(403, new { message = "רק רופא או מנהל משמרת יכולים לשייך/לשחרר מטופל." });
                    step = action == "claim"
                        ? await steps.ClaimDoctorStepAsync(stepId, UserId, UserName)
                        : await steps.ReleaseDoctorClaimAsync(stepId, UserId,
                            User.IsInRole(nameof(UserRole.ShiftManager)) || User.IsInRole(nameof(UserRole.Admin)));
                    break;
                default:
                    return BadRequest(new { message = "פעולה לא חוקית." });
            }
            await audit.LogAsync("CareStep" + char.ToUpperInvariant(action[0]) + action[1..],
                "Visit", id, "careStep", newValue: step.Label);
            await BroadcastQueueUpdateAsync(id);
            return Ok(step);
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    /// <summary>Re-broadcast the visit's queue row after a care-step change so every board refreshes.</summary>
    private async Task BroadcastQueueUpdateAsync(Guid id)
    {
        var v = await svc.GetByIdAsync(id);
        if (v is null) return;
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = v.Id,
            status = v.Status.ToString(),
            queueNumber = v.QueueNumber,
            queueLetter = v.QueueLetter,
            treatingUserName = v.TreatingUserName,
            room = v.TreatmentRoom,
        });
    }

    public record UpdateStatusRequest(string Status, [param: StringLength(120)] string? DeviceId = null);

    public record ReassignDepartmentRequest([param: Required, StringLength(100)] string Department);

    public record DualDepartmentRequest([param: Required, StringLength(100)] string SecondaryDepartment);

    public record ReferStationRequest(
        [param: Required, MinLength(1)] List<string> Labels,
        [param: StringLength(100)] string? Department = null,
        [param: StringLength(120)] string? DeviceId = null);

    public record FinishNonDoctorRequest([param: StringLength(120)] string? DeviceId = null);

    public record StepActionRequest(
        [param: Required, StringLength(20)] string Action,
        [param: StringLength(120)] string? DeviceId = null);
}
