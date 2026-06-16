using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/medications")]
// Drug catalog is non-PHI reference data, but kept behind auth and limited to
// clinical staff (Reception has no clinical need). Sync/import are Admin-only.
[Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin")]
public class MedicationsController(
    MedicationCatalogService catalog,
    MedicationSyncService sync,
    SettingsService settings,
    AuditService audit) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

    // GET /api/medications?q=acamol&take=20  → autocomplete (clinical staff)
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int take = 20)
    {
        if (q is { Length: > 100 }) q = q[..100];   // cap search term length
        var meds = await catalog.SearchAsync(q, take);
        return Ok(meds.Select(m => new
        {
            id = m.Id,
            registrationNumber = m.RegistrationNumber,
            hebrewName = m.HebrewName,
            englishName = m.EnglishName,
        }));
    }

    // GET /api/medications/status  → sync metadata for the admin settings screen
    [HttpGet("status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Status() => Ok(new
    {
        count = await catalog.CountActiveAsync(),
        lastSyncAt = await settings.GetStringAsync(SettingsService.MedLastSyncAtKey),
        lastSyncStatus = await settings.GetStringAsync(SettingsService.MedLastSyncStatusKey),
        intervalDays = await settings.GetIntAsync(SettingsService.MedSyncIntervalDaysKey, 7),
    });

    // POST /api/medications/sync  → trigger an immediate fetch from the MoH API
    [HttpPost("sync")]
    [Authorize(Roles = "Admin")]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> Sync(CancellationToken ct)
    {
        var result = await sync.SyncFromApiAsync(ct);
        await audit.LogAsync("MedicationSync", "Medication", default, "api",
            newValue: $"{(result.Success ? "ok" : "fail")}: {result.Message}");
        return result.Success
            ? Ok(new { result.Count, result.Message })
            : StatusCode(502, new { result.Message });
    }

    // POST /api/medications/import  → upload an official CSV file (offline fallback)
    [HttpPost("import")]
    [Authorize(Roles = "Admin")]
    [RequestSizeLimit(20_000_000)]   // 20 MB cap
    public async Task<IActionResult> Import(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "לא צורף קובץ." });

        await using var stream = file.OpenReadStream();
        var result = await sync.ImportFromFileAsync(stream, file.FileName);
        await audit.LogAsync("MedicationImport", "Medication", default, file.FileName,
            newValue: $"{(result.Success ? "ok" : "fail")}: {result.Message}");
        return result.Success
            ? Ok(new { result.Count, result.Message })
            : BadRequest(new { result.Message });
    }
}
