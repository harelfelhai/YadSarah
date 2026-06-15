using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/settings")]
[Authorize(Roles = "Admin")]
public class SettingsController(SettingsService svc, AuditService audit) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

    [HttpGet]
    public async Task<IActionResult> GetAll() => Ok(await svc.GetAllAsync());

    [HttpPut("{key}")]
    public async Task<IActionResult> Update(string key, [FromBody] UpdateSettingRequest req)
    {
        // Per-setting validation
        if (key == SettingsService.QueueResetHourKey)
        {
            if (!int.TryParse(req.Value, out var h) || h < 0 || h > 23)
                return BadRequest(new { message = "שעת איפוס חייבת להיות מספר שלם בין 0 ל-23." });
        }

        try
        {
            var updated = await svc.SetAsync(key, req.Value, UserId);
            await audit.LogAsync(AuditService.Updated, "Setting", default, key, newValue: req.Value);
            return Ok(updated);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    public record UpdateSettingRequest(string Value);
}
