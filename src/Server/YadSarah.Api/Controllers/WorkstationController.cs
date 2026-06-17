using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Maps each LAN computer (stable browser device id) to a fixed room. Any authenticated
/// user may set the room on first connect; listing/reassignment is Admin-only.
/// </summary>
[ApiController]
[Route("api/workstation")]
[Authorize]
public class WorkstationController(WorkstationService svc, AuditService audit) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);
    private string UserName => User.FindFirstValue("fullName") ?? User.Identity?.Name ?? "";
    private UserRole CallerRole =>
        Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var r) ? r : UserRole.Reception;

    // GET /api/workstation/me?deviceId=... — the room this computer is mapped to (null if unknown).
    [HttpGet("me")]
    public async Task<IActionResult> Me([FromQuery] string? deviceId)
        => Ok(new { room = await svc.ResolveRoomAsync(deviceId) });

    // GET /api/workstation/rooms — existing room names, to suggest on first connect.
    [HttpGet("rooms")]
    public async Task<IActionResult> Rooms() => Ok(await svc.GetRoomNamesAsync());

    public record SetRoomRequest(
        [param: Required, StringLength(120, MinimumLength = 1)] string DeviceId,
        [param: Required, StringLength(60, MinimumLength = 1)] string Room);

    // POST /api/workstation — first-connect (or re-)assignment of this computer's room.
    [HttpPost]
    public async Task<IActionResult> SetRoom([FromBody] SetRoomRequest req)
    {
        var ws = await svc.SetRoomAsync(req.DeviceId, req.Room, UserId, UserName, CallerRole);
        await audit.LogAsync(AuditService.RoomAssigned, "Workstation", ws.Id, "RoomName", newValue: ws.RoomName);
        return Ok(new { room = ws.RoomName });
    }

    // GET /api/workstation — all mapped computers (management view).
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetAll() => Ok(await svc.GetAllAsync());

    public record UpdateRoomRequest(
        [param: Required, StringLength(60, MinimumLength = 1)] string Room);

    // PUT /api/workstation/{id} — admin reassigns a computer's room.
    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateRoomRequest req)
    {
        try
        {
            var ws = await svc.UpdateRoomAsync(id, req.Room);
            await audit.LogAsync(AuditService.RoomAssigned, "Workstation", ws.Id, "RoomName", newValue: ws.RoomName);
            return Ok(ws);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }
}
