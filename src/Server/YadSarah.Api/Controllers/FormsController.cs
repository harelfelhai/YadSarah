using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;
using YadSarah.Api.Hubs;

namespace YadSarah.Api.Controllers;

[ApiController]
[Authorize]
public class FormsController(FormService svc, IHubContext<MainHub> hub) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private string UserName =>
        User.FindFirstValue("fullName") ?? User.Identity?.Name ?? "Unknown";

    // GET /api/visits/{visitId}/forms
    [HttpGet("api/visits/{visitId:guid}/forms")]
    public async Task<IActionResult> GetByVisit(Guid visitId) =>
        Ok(await svc.GetByVisitAsync(visitId));

    // POST /api/visits/{visitId}/forms
    [HttpPost("api/visits/{visitId:guid}/forms")]
    public async Task<IActionResult> Create(Guid visitId, [FromBody] CreateFormRequest req)
    {
        var form = new MedicalForm
        {
            VisitId = visitId,
            StationType = req.StationType,
            FormType = req.FormType,
            CreatedByUserId = UserId,
        };
        var created = await svc.CreateAsync(form);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    // GET /api/forms/{id}
    [HttpGet("api/forms/{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var f = await svc.GetByIdAsync(id);
        return f is null ? NotFound() : Ok(f);
    }

    // PATCH /api/forms/{id}/sections/{section}
    [HttpPatch("api/forms/{id:guid}/sections/{section}")]
    public async Task<IActionResult> UpdateSection(
        Guid id, string section, [FromBody] UpdateSectionRequest req)
    {
        try
        {
            var updated = await svc.UpdateSectionAsync(
                id, section, req.Data?.ToString() ?? string.Empty, req.Version, UserId);

            // Broadcast to everyone in the form group
            await hub.Clients.Group($"form_{id}").SendAsync("FormSectionUpdated", new
            {
                formId = id,
                sectionName = section,
                data = req.Data,
            });

            return Ok(updated);
        }
        catch (ConcurrencyException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    // POST /api/forms/{id}/locks/{section}
    [HttpPost("api/forms/{id:guid}/locks/{section}")]
    public async Task<IActionResult> AcquireLock(Guid id, string section)
    {
        var (acquired, lockedBy) = await svc.AcquireLockAsync(id, section, UserId, UserName);

        if (acquired)
        {
            await hub.Clients.Group($"form_{id}").SendAsync("LockAcquired", new
            {
                formId = id,
                sectionName = section,
                lockedByUserId = UserId,
                lockedByName = UserName,
                expiresAt = DateTime.UtcNow.AddMinutes(5),
            });
        }

        return Ok(new { acquired, lockedBy });
    }

    // DELETE /api/forms/{id}/locks/{section}
    [HttpDelete("api/forms/{id:guid}/locks/{section}")]
    public async Task<IActionResult> ReleaseLock(Guid id, string section)
    {
        await svc.ReleaseLockAsync(id, section, UserId);
        await hub.Clients.Group($"form_{id}").SendAsync("LockReleased", new
        {
            formId = id,
            sectionName = section,
        });
        return NoContent();
    }

    // GET /api/forms/{id}/export  — returns the form data as JSON (PDF generation TBD)
    [HttpGet("api/forms/{id:guid}/export")]
    public async Task<IActionResult> Export(Guid id)
    {
        var form = await svc.GetByIdAsync(id);
        if (form is null) return NotFound();
        // TODO: generate PDF; for now return structured JSON
        return Ok(form);
    }

    public record CreateFormRequest(string StationType, string FormType);
    public record UpdateSectionRequest(object? Data, int Version);
}
