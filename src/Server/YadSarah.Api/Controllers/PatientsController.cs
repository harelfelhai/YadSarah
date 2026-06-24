using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using YadSarah.Application.Services;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/patients")]
[Authorize]
public class PatientsController(AppDbContext db, AuditService audit) : ControllerBase
{
    private UserRole CallerRole =>
        Enum.TryParse<UserRole>(User.FindFirstValue(ClaimTypes.Role), out var r) ? r : UserRole.Reception;

    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q)) return Ok(Array.Empty<object>());
        if (q.Length > 50) q = q[..50]; // cap to bound query cost

        // Match each whitespace-separated token against any name/identity field, so a
        // full-name query like "הראל פלהיימר" matches (first name + last name), not just
        // a single field. All tokens must match (AND); each may hit first/last/identity (OR).
        var tokens = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                      .Take(5).ToArray();

        var query = db.Patients.AsQueryable();
        foreach (var token in tokens)
        {
            var t = token; // capture per-iteration for the closure
            query = query.Where(p =>
                (p.IdentityNumber != null && p.IdentityNumber.Contains(t)) ||
                p.FirstName.Contains(t) ||
                p.LastName.Contains(t) ||
                (p.FirstNameLatin != null && p.FirstNameLatin.Contains(t)) ||
                (p.LastNameLatin != null && p.LastNameLatin.Contains(t)));
        }

        var results = await query.Take(20).ToListAsync();

        await audit.LogAsync(AuditService.Searched, "Patient", newValue: q);
        return Ok(results);
    }

    // GET /api/patients/temp-id  → a fresh 5-digit "temporary" identity number, unique across
    // all patients (so it can't clash with another temp record). Real IDs/passports are longer,
    // so a 5-digit value never collides with a genuine identity. Used when reception picks the
    // "זמני" identity type for an unidentified patient.
    [HttpGet("temp-id")]
    [Authorize(Roles = "Reception,ShiftManager,Admin")]
    public async Task<IActionResult> TempId()
    {
        // A handful of random tries first (cheap; the 90k space is virtually empty); if those
        // happen to collide, fall back to a linear scan for the first free value.
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var candidate = Random.Shared.Next(10000, 100000).ToString();
            if (!await db.Patients.AnyAsync(p => p.IdentityNumber == candidate))
                return Ok(new { value = candidate });
        }
        for (var n = 10000; n < 100000; n++)
        {
            var candidate = n.ToString();
            if (!await db.Patients.AnyAsync(p => p.IdentityNumber == candidate))
                return Ok(new { value = candidate });
        }
        return Conflict(new { message = "לא נמצא מספר זמני פנוי." });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await db.Patients.FindAsync(id);
        if (p is null) return NotFound();
        await audit.LogAsync(AuditService.Viewed, "Patient", id);
        return Ok(p);
    }

    [HttpPost]
    [Authorize(Roles = "Reception,ShiftManager,Admin")]
    public async Task<IActionResult> Create(Patient patient)
    {
        if (ValidatePatient(patient) is { } error) return BadRequest(new { message = error });

        // Birth date is required when CREATING a new patient (reception capture). Existing
        // records with a null birth date are grandfathered — the shared ValidatePatient (used
        // by Update too) is intentionally NOT changed, so editing an old record still works.
        if (patient.BirthDate is null)
            return BadRequest(new { message = "תאריך לידה הוא שדה חובה." });

        // Block duplicate identities — a patient with the same identity type +
        // number may not be created twice (the existing record must be reused).
        if (await IdentityExistsAsync(patient.IdentityType, patient.IdentityNumber, excludeId: null))
            return Conflict(new { message = "מטופל עם תעודה זהה כבר קיים במערכת." });

        // Server-controlled fields — never trust the client for these
        patient.Id = Guid.NewGuid();
        patient.CreatedAt = DateTime.UtcNow;
        patient.UpdatedAt = DateTime.UtcNow;
        db.Patients.Add(patient);
        await db.SaveChangesAsync();
        await audit.LogAsync(AuditService.Created, "Patient", patient.Id);
        return CreatedAtAction(nameof(GetById), new { id = patient.Id }, patient);
    }

    private static readonly Regex EmailRx = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);
    // Phone: digits with optional +, -, spaces, parentheses; 6–20 chars.
    private static readonly Regex PhoneRx = new(@"^[\d+\-() ]{6,20}$", RegexOptions.Compiled);

    // Server-side validation of patient demographics (the request body is the entity itself,
    // so the API is the trust boundary). Names may not contain markup — consistent with the
    // user-name policy; emails/phones must be well-formed when provided. Returns an error
    // message, or null when valid.
    private static string? ValidatePatient(Patient p)
    {
        if (HasAngleBrackets(p.FirstName) || HasAngleBrackets(p.LastName) ||
            HasAngleBrackets(p.FirstNameLatin) || HasAngleBrackets(p.LastNameLatin))
            return "שם המטופל אינו יכול להכיל את התווים < או >.";

        foreach (var email in new[] { p.Email, p.ClinicEmail })
            if (!string.IsNullOrWhiteSpace(email) && !EmailRx.IsMatch(email.Trim()))
                return "כתובת דוא\"ל אינה תקינה.";

        foreach (var phone in new[] { p.PhoneMobile, p.PhoneHome, p.PhoneWork })
            if (!string.IsNullOrWhiteSpace(phone) && !PhoneRx.IsMatch(phone.Trim()))
                return "מספר טלפון אינו תקין.";

        return null;
    }

    private static bool HasAngleBrackets(string? s) =>
        s is not null && (s.Contains('<') || s.Contains('>'));

    // True if another patient already has this identity type + number.
    private async Task<bool> IdentityExistsAsync(string identityType, string? identityNumber, Guid? excludeId)
    {
        if (string.IsNullOrWhiteSpace(identityNumber)) return false;
        return await db.Patients.AnyAsync(p =>
            p.IdentityType == identityType &&
            p.IdentityNumber == identityNumber &&
            (excludeId == null || p.Id != excludeId));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Reception,Nurse,Doctor,ShiftManager,Admin")]
    public async Task<IActionResult> Update(Guid id, Patient incoming)
    {
        var existing = await db.Patients.FindAsync(id);
        if (existing is null) return NotFound();

        if (ValidatePatient(incoming) is { } error) return BadRequest(new { message = error });

        // Identity (type/number) may only be changed by a shift manager / admin.
        var identityChanged =
            incoming.IdentityType != existing.IdentityType ||
            incoming.IdentityNumber != existing.IdentityNumber;
        if (identityChanged && CallerRole is not (UserRole.ShiftManager or UserRole.Admin))
            return StatusCode(403, new { message = "שינוי תעודת זהות מותר למנהל משמרת או מנהל בלבד." });

        if (await IdentityExistsAsync(incoming.IdentityType, incoming.IdentityNumber, excludeId: id))
            return Conflict(new { message = "מטופל אחר עם תעודה זהה כבר קיים במערכת." });

        // Preserve server-controlled fields
        incoming.Id = id;
        incoming.CreatedAt = existing.CreatedAt;
        incoming.UpdatedAt = DateTime.UtcNow;
        db.Entry(existing).CurrentValues.SetValues(incoming);
        await db.SaveChangesAsync();
        await audit.LogAsync(AuditService.Updated, "Patient", id);
        return Ok(existing);
    }
}
