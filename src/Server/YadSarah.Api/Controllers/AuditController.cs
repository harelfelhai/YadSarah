using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/audit")]
[Authorize(Roles = "Admin")]
public class AuditController(AuditService audit) : ControllerBase
{
    // GET /api/audit?entityType=Patient&userId=...&take=100
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string? entityType, [FromQuery] Guid? userId, [FromQuery] int take = 100)
        => Ok(await audit.GetRecentAsync(entityType, userId, take));
}
