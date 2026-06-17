using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

/// <summary>
/// The shift-status board: which rooms are occupied/busy and who logged in this shift.
/// Restricted to shift managers and admins.
/// </summary>
[ApiController]
[Route("api/shift-status")]
[Authorize(Roles = "Admin,ShiftManager")]
public class ShiftStatusController(ShiftStatusService svc, AuditService audit) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var result = await svc.GetCurrentStatusAsync();
        // The board surfaces in-treatment patients' names (PHI) → log the access (need-to-know view).
        await audit.LogAsync(AuditService.Viewed, "Visit", fieldName: "shiftStatus");
        return Ok(result);
    }
}
