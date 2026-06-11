using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;
using YadSarah.Api.Hubs;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/visits")]
[Authorize]
public class VisitsController(VisitService svc, IHubContext<MainHub> hub) : ControllerBase
{
    [HttpGet("queue")]
    public async Task<IActionResult> GetQueue() => Ok(await svc.GetQueueAsync());

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var v = await svc.GetByIdAsync(id);
        return v is null ? NotFound() : Ok(v);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Visit visit)
    {
        var created = await svc.CreateAsync(visit);
        // Notify all connected clients
        await hub.Clients.All.SendAsync("QueueUpdate", new
        {
            visitId = created.Id,
            status = created.Status.ToString(),
            queueNumber = created.QueueNumber,
        });
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateStatusRequest req)
    {
        if (!Enum.TryParse<VisitStatus>(req.Status, out var status))
            return BadRequest("Invalid status");

        var updated = await svc.UpdateStatusAsync(id, status);
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
