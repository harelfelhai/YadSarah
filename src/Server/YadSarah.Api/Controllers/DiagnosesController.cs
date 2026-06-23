using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/diagnoses")]
// Diagnosis catalog is non-PHI reference data (a closed list), kept behind auth and
// limited to clinical staff (Reception has no clinical need). Import is Admin-only.
[Authorize(Roles = "Doctor,Nurse,ShiftManager,Admin")]
public class DiagnosesController(
    DiagnosisCatalogService catalog,
    DiagnosisImportService import,
    SettingsService settings,
    AuditService audit) : ControllerBase
{
    private Guid UserId =>
        Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

    // GET /api/diagnoses?q=דלקת&take=20  → autocomplete (clinical staff)
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] int take = 20)
    {
        if (q is { Length: > 100 }) q = q[..100];   // cap search term length
        var rows = await catalog.SearchAsync(q, take);
        return Ok(rows.Select(d => new
        {
            id = d.Id,
            code = d.Code,
            hebrewName = d.HebrewName,
            englishName = d.EnglishName,
        }));
    }

    // GET /api/diagnoses/frequent?take=10  → the signed-in doctor's most-used diagnoses,
    // for pre-populating the diagnosis picker on focus (before any search).
    [HttpGet("frequent")]
    public async Task<IActionResult> Frequent([FromQuery] int take = 10)
        => Ok(await catalog.GetFrequentForDoctorAsync(UserId, take));

    // GET /api/diagnoses/status  → catalog metadata for the admin settings screen
    [HttpGet("status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Status() => Ok(new
    {
        count = await catalog.CountActiveAsync(),
        lastSyncAt = await settings.GetStringAsync(SettingsService.DiagLastSyncAtKey),
        lastSyncStatus = await settings.GetStringAsync(SettingsService.DiagLastSyncStatusKey),
    });

    // POST /api/diagnoses/import  → upload an official CSV/XLSX (replaces the catalog)
    [HttpPost("import")]
    [Authorize(Roles = "Admin")]
    [RequestSizeLimit(20_000_000)]   // 20 MB cap
    public async Task<IActionResult> Import(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "לא צורף קובץ." });

        await using var stream = file.OpenReadStream();
        var result = await import.ImportFromFileAsync(stream, file.FileName);
        await audit.LogAsync("DiagnosisImport", "Diagnosis", default, file.FileName,
            newValue: $"{(result.Success ? "ok" : "fail")}: {result.Message}");
        return result.Success
            ? Ok(new { result.Count, result.Message })
            : BadRequest(new { result.Message });
    }
}
