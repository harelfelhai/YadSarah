using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Api.Controllers;

[ApiController]
[Route("api/patients")]
[Authorize]
public class PatientsController(AppDbContext db) : ControllerBase
{
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q)) return Ok(Array.Empty<object>());

        var results = await db.Patients
            .Where(p =>
                (p.IdentityNumber != null && p.IdentityNumber.Contains(q)) ||
                p.FirstName.Contains(q) ||
                p.LastName.Contains(q))
            .Take(20)
            .ToListAsync();

        return Ok(results);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await db.Patients.FindAsync(id);
        return p is null ? NotFound() : Ok(p);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Patient patient)
    {
        patient.Id = Guid.NewGuid();
        patient.CreatedAt = DateTime.UtcNow;
        patient.UpdatedAt = DateTime.UtcNow;
        db.Patients.Add(patient);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = patient.Id }, patient);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, Patient incoming)
    {
        var existing = await db.Patients.FindAsync(id);
        if (existing is null) return NotFound();

        incoming.Id = id;
        incoming.CreatedAt = existing.CreatedAt;
        incoming.UpdatedAt = DateTime.UtcNow;
        db.Entry(existing).CurrentValues.SetValues(incoming);
        await db.SaveChangesAsync();
        return Ok(existing);
    }
}
