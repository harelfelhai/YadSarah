using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AuthService auth) : ControllerBase
{
    public record LoginRequest(string Username, string Password);

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var result = await auth.LoginAsync(req.Username, req.Password);
        if (result is null) return Unauthorized(new { message = "שם משתמש או סיסמה שגויים" });

        var (token, user) = result.Value;
        return Ok(new
        {
            token,
            expiresAt = DateTime.UtcNow.AddHours(12),
            user = new { user.Id, user.Username, user.FullName, Role = user.Role.ToString() }
        });
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
