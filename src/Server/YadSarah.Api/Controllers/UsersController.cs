using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize(Roles = "Admin,ShiftManager")]
public class UsersController(UserService svc, AuditService audit) : ControllerBase
{
    private UserRole CallerRole =>
        Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var r) ? r : UserRole.Reception;

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await svc.GetAllAsync());

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var user = await svc.GetByIdAsync(id);
        return user is null ? NotFound() : Ok(user);
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        try
        {
            var user = await svc.CreateAsync(req);
            await audit.LogAsync(AuditService.Created, "User", user.Id, "Role", newValue: user.Role.ToString());
            return CreatedAtAction(nameof(GetById), new { id = user.Id }, user);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest req)
    {
        // Privilege-escalation guard: a shift manager may not edit an admin
        // account, nor grant the Admin role.
        if (CallerRole != UserRole.Admin)
        {
            var target = await svc.GetByIdAsync(id);
            if (target is null) return NotFound();
            if (target.Role == UserRole.Admin || req.Role == UserRole.Admin)
                return StatusCode(403, new { message = "אין הרשאה לערוך חשבון מנהל או להעניק הרשאת מנהל." });
        }

        try
        {
            var user = await svc.UpdateAsync(id, req);
            await audit.LogAsync(AuditService.Updated, "User", user.Id, "Role", newValue: user.Role.ToString());
            return Ok(user);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPost("{id:guid}/reset-failures")]
    public async Task<IActionResult> ResetFailures(Guid id)
    {
        try
        {
            await svc.ResetLoginFailuresAsync(id);
            await audit.LogAsync(AuditService.Updated, "User", id, "LockoutReset");
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }
}
