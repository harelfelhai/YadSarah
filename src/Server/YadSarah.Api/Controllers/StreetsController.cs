using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/streets")]
// Streets are non-PHI reference data, kept behind auth. Reception needs the autocomplete
// to fill a patient address, so it (and clinical staff) may search; sync/import are Admin-only.
[Authorize(Roles = "Reception,Nurse,Doctor,ShiftManager,Admin")]
public class StreetsController(
    StreetCatalogService catalog,
    StreetSyncService sync,
    SettingsService settings,
    AuditService audit) : ControllerBase
{
    // GET /api/streets?city=ירושלים&q=הרצל&take=20  → street autocomplete within a city
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? city, [FromQuery] string? q, [FromQuery] int take = 20)
    {
        if (city is { Length: > 100 }) city = city[..100];
        if (q is { Length: > 100 }) q = q[..100];
        return Ok(await catalog.SearchAsync(city, q, take));
    }

    // GET /api/streets/status  → sync metadata for the admin settings screen
    [HttpGet("status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Status() => Ok(new
    {
        count = await catalog.CountActiveAsync(),
        lastSyncAt = await settings.GetStringAsync(SettingsService.StreetsLastSyncAtKey),
        lastSyncStatus = await settings.GetStringAsync(SettingsService.StreetsLastSyncStatusKey),
        intervalDays = await settings.GetIntAsync(SettingsService.StreetsSyncIntervalDaysKey, 30),
    });

    // POST /api/streets/sync  → trigger an immediate fetch from data.gov.il
    [HttpPost("sync")]
    [Authorize(Roles = "Admin")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Sync(CancellationToken ct)
    {
        var result = await sync.SyncFromApiAsync(ct);
        await audit.LogAsync("StreetSync", "Street", default, "api",
            newValue: $"{(result.Success ? "ok" : "fail")}: {result.Message}");
        return result.Success
            ? Ok(new { result.Count, result.Message })
            : StatusCode(502, new { result.Message });
    }

    // POST /api/streets/import  → upload a CSV (offline fallback)
    [HttpPost("import")]
    [Authorize(Roles = "Admin")]
    [RequestSizeLimit(30_000_000)]   // 30 MB cap
    public async Task<IActionResult> Import(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "לא צורף קובץ." });

        await using var stream = file.OpenReadStream();
        var result = await sync.ImportFromFileAsync(stream, ct);
        await audit.LogAsync("StreetImport", "Street", default, file.FileName,
            newValue: $"{(result.Success ? "ok" : "fail")}: {result.Message}");
        return result.Success
            ? Ok(new { result.Count, result.Message })
            : BadRequest(new { result.Message });
    }
}
