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
    VisitService svc, IHubContext<MainHub> hub, AuditService audit, WorkstationService workstations) : ControllerBase
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
        [FromQuery] string? staff, [FromQuery] string? department, [FromQuery] int page = 0)
    {
        if (q is { Length: > 80 }) q = q[..80];
        if (staff is { Length: > 80 }) staff = staff[..80];
        var result = await svc.GetHistoryAsync(UserId, q, from, to, staff, department, page);
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

        var created = await svc.CreateAsync(req.ToEntity());
        await audit.LogAsync(AuditService.Created, "Visit", created.Id);
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = created.Id,
            status = created.Status.ToString(),
            queueNumber = created.QueueNumber,
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

        // Discharge is an administrative release — reception / shift-manager / admin only.
        // Clinical staff (doctor/nurse) drive the in-treatment workflow (call patient,
        // start treatment) but end a treatment by signing the form, not by discharging.
        if (status == VisitStatus.Discharged &&
            !(User.IsInRole("Reception") || User.IsInRole("ShiftManager") || User.IsInRole("Admin")))
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
            treatingUserName = updated.TreatingUserName,
            room = updated.TreatmentRoom,
        });
        return Ok(updated);
    }

    public record UpdateStatusRequest(string Status, [param: StringLength(120)] string? DeviceId = null);
}
