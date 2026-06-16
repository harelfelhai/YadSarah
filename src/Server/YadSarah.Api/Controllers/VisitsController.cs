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
public class VisitsController(VisitService svc, IHubContext<MainHub> hub, AuditService audit) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

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
    [Authorize(Roles = "Reception,ShiftManager,Admin")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest req)
    {
        if (!Enum.TryParse<VisitStatus>(req.Status, out var status))
            return BadRequest("Invalid status");

        var updated = await svc.UpdateStatusAsync(id, status);
        await audit.LogAsync(AuditService.StatusChanged, "Visit", id, "Status", newValue: status.ToString());
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = updated.Id,
            status = updated.Status.ToString(),
            queueNumber = updated.QueueNumber,
        });
        return Ok(updated);
    }

    public record UpdateStatusRequest(string Status);
}
