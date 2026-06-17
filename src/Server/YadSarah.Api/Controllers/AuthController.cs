using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AuthService auth, AuditService audit, WorkstationService workstations) : ControllerBase
{
    public record LoginRequest(
        [param: Required, StringLength(60, MinimumLength = 1)] string Username,
        [param: Required, StringLength(200, MinimumLength = 1)] string Password,
        [param: StringLength(120)] string? DeviceId = null);

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var result = await auth.LoginAsync(req.Username, req.Password);

        switch (result.Outcome)
        {
            case LoginOutcome.LockedOut:
                await audit.LogAsync(Guid.Empty, req.Username, AuditService.LockedOut, "Auth");
                return StatusCode(StatusCodes.Status423Locked, new
                {
                    message = "החשבון נעול זמנית עקב ריבוי ניסיונות כושלים. נסה שוב מאוחר יותר או פנה למנהל."
                });

            case LoginOutcome.Success:
                var user = result.User!;
                await audit.LogAsync(user.Id, user.FullName, AuditService.Login, "Auth", user.Id);
                // Record this user as the current occupant of their computer (if the device
                // is already mapped to a room) and tell the client the room — a null room
                // means the device is new and the client should prompt to set it.
                var room = await workstations.SetOccupantAsync(req.DeviceId, user.Id, user.FullName, user.Role);
                return Ok(new
                {
                    token = result.Token,
                    expiresAt = result.ExpiresAt,
                    user = new { user.Id, user.Username, user.FullName, Role = user.Role.ToString() },
                    workstationRoom = room,
                });

            default: // InvalidCredentials / Inactive / Expired — generic response
                await audit.LogAsync(Guid.Empty, req.Username, AuditService.LoginFailed, "Auth");
                return Unauthorized(new { message = "שם משתמש או סיסמה שגויים" });
        }
    }

    [HttpGet("me")]
    [Authorize]
    public IActionResult Me()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var username = User.Identity?.Name;
        var fullName = User.FindFirst("fullName")?.Value;
        var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;
        return Ok(new { Id = userId, Username = username, FullName = fullName, Role = role });
    }
}
