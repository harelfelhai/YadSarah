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
                var displayName = user.DisplayName ?? user.FullName;
                // Audit the login including the computer/room it came from (device id).
                await audit.LogAsync(user.Id, displayName, AuditService.Login, "Auth", user.Id,
                    newValue: string.IsNullOrWhiteSpace(req.DeviceId) ? null : $"device:{req.DeviceId}");
                // Record this user as the current occupant of their computer (if the device
                // is already mapped to a room) and tell the client the room — a null room
                // means the device is new and the client should prompt to set it.
                var room = await workstations.SetOccupantAsync(req.DeviceId, user.Id, displayName, user.PrimaryRole);
                return Ok(new
                {
                    token = result.Token,
                    expiresAt = result.ExpiresAt,
                    user = new
                    {
                        user.Id,
                        user.Username,
                        FullName = displayName,
                        Roles = user.Roles.Select(r => r.ToString()).ToArray(),
                    },
                    workstationRoom = room,
                });

            default: // InvalidCredentials / Inactive / Expired — generic response
                // A login that just auto-deactivated a stale (120+ days unused) account is a
                // security event worth its own audit entry, attributable to the account.
                if (result.AutoDeactivated && result.User is not null)
                    await audit.LogAsync(result.User.Id, result.User.DisplayName ?? result.User.FullName,
                        AuditService.AccountAutoDeactivated, "User", result.User.Id,
                        newValue: "120+ days inactivity");
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
        var roles = User.FindAll(System.Security.Claims.ClaimTypes.Role).Select(c => c.Value).ToArray();
        return Ok(new { Id = userId, Username = username, FullName = fullName, Roles = roles });
    }
}
