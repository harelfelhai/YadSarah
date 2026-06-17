using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Demo/presentation data generator. DESTRUCTIVE — the seed action wipes all
/// transactional/test data. Therefore double-gated:
///   1. Admin role only.
///   2. The "Demo:Enabled" config flag must be true (default ON in Development,
///      absent → OFF in Production). When off, the action endpoints return 404 so
///      the capability is invisible in production.
/// All actions are written to the audit trail.
/// </summary>
[ApiController]
[Route("api/demo")]
[Authorize(Roles = "Admin")]
public class DemoController(DemoDataService demo, AuditService audit, IConfiguration config) : ControllerBase
{
    private bool DemoEnabled => config.GetValue("Demo:Enabled", false);

    // GET /api/demo/status — counts + whether demo mode is enabled (used by the UI to
    // decide whether to render the panel). Not flag-gated so the UI can report "off".
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var s = await demo.StatusAsync();
        return Ok(new
        {
            enabled = DemoEnabled,
            s.Patients, s.Visits, s.TodayQueue, s.PoolAvailable, s.Medications,
            demoPassword = DemoEnabled ? DemoDataService.DemoPassword : null,
        });
    }

    // POST /api/demo/seed — wipe + regenerate the full demo dataset.
    [HttpPost("seed")]
    public async Task<IActionResult> Seed()
    {
        if (!DemoEnabled) return NotFound();
        var result = await demo.SeedAsync();
        await audit.LogAsync(AuditService.DemoSeeded, "Demo", newValue:
            $"users={result.Users};patients={result.Patients};visits={result.Visits};pool={result.PoolPatients}");
        return Ok(result);
    }

    // POST /api/demo/fill-queue?count=50 — inject pool patients into today's board.
    [HttpPost("fill-queue")]
    public async Task<IActionResult> FillQueue([FromQuery] int count = 50, [FromQuery] bool replace = true)
    {
        if (!DemoEnabled) return NotFound();
        var added = await demo.FillQueueAsync(count, replace);
        await audit.LogAsync(AuditService.DemoQueueFilled, "Demo", newValue: $"added={added};replace={replace}");
        return Ok(new { added });
    }

    // POST /api/demo/clear-today — clear today's queue (between demos).
    [HttpPost("clear-today")]
    public async Task<IActionResult> ClearToday()
    {
        if (!DemoEnabled) return NotFound();
        var removed = await demo.ClearTodayAsync();
        await audit.LogAsync(AuditService.DemoQueueCleared, "Demo", newValue: $"removed={removed}");
        return Ok(new { removed });
    }
}
