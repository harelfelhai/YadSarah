using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using YadSarah.Application.Services;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Api.Controllers;

/// <summary>
/// PUBLIC (no-login) reference-data lookups that the self-service intake page needs: street
/// autocomplete (city-scoped) and the city list ordered by how often patients register from
/// each city. Everything here is NON-PHI reference data (names + ordering only, never counts
/// or patient details). Used by both the public page and (for the frequency ordering) the
/// staffed reception screen.
/// </summary>
[ApiController]
[Route("api/public-ref")]
[AllowAnonymous]
[EnableRateLimiting("publicIntake")]
public class PublicReferenceController(AppDbContext db, StreetCatalogService streets) : ControllerBase
{
    // GET /api/public-ref/streets?city=ירושלים&q=הרצל → street autocomplete within a city.
    [HttpGet("streets")]
    public async Task<IActionResult> Streets([FromQuery] string? city, [FromQuery] string? q)
    {
        if (city is { Length: > 100 }) city = city[..100];
        if (q is { Length: > 100 }) q = q[..100];
        return Ok(await streets.SearchAsync(city, q, take: 20));
    }

    // GET /api/public-ref/cities/frequent?take=15 → city NAMES ordered by registration frequency.
    // Derived live from the Patients table (each patient row = one registration from its city);
    // no separate counter is needed. Returns names only — the count itself is never exposed.
    [HttpGet("cities/frequent")]
    public async Task<IActionResult> FrequentCities([FromQuery] int take = 15)
    {
        take = Math.Clamp(take, 1, 50);
        var top = await db.Patients
            .Where(p => p.City != null && p.City != "")
            .GroupBy(p => p.City!)
            .Select(g => new { City = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.City)
            .Take(take)
            .Select(x => x.City)
            .ToListAsync();
        return Ok(top);
    }
}
