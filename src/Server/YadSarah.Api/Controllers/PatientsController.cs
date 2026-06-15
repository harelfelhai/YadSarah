using System.Security.Claims;
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

        var results = await db.Patients
            .Where(p =>
                (p.IdentityNumber != null && p.IdentityNumber.Contains(q)) ||
                p.FirstName.Contains(q) ||
                p.LastName.Contains(q))
            .Take(20)
            .ToListAsync();

        await audit.LogAsync(AuditService.Searched, "Patient", newValue: q);
        return Ok(results);
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
