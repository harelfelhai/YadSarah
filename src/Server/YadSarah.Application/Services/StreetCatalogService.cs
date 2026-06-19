using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One normalized street record from a sync source (API or file).</summary>
public record StreetRecord(string CityName, string StreetName);

/// <summary>
/// Reads and maintains the internal streets catalog. <see cref="SearchAsync"/> serves the
/// reception address autocomplete (offline, scoped to the selected city);
/// <see cref="ReplaceAllAsync"/> applies a full snapshot from the sync sources.
/// Mirrors <see cref="MedicationCatalogService"/>.
/// </summary>
public class StreetCatalogService(AppDbContext db)
{
    public async Task<List<string>> SearchAsync(string? city, string? q, int take)
    {
        take = Math.Clamp(take, 1, 50);
        if (string.IsNullOrWhiteSpace(city)) return [];

        var cityTerm = city.Trim();
        var query = db.Streets.AsNoTracking()
            .Where(s => s.IsActive && s.CityName == cityTerm);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim()}%";
            query = query.Where(s => EF.Functions.ILike(s.StreetName, like));
        }

        return await query
            .OrderBy(s => s.StreetName)
            .Select(s => s.StreetName)
            .Take(take)
            .ToListAsync();
    }

    public Task<int> CountActiveAsync() => db.Streets.CountAsync(s => s.IsActive);

    /// <summary>
    /// Replaces the whole catalog with a fresh snapshot. The streets dataset is large
    /// (hundreds of thousands of rows) and has no per-row history requirement, so unlike
    /// the drug catalog this truncates and bulk-inserts in batches (clearing the change
    /// tracker each batch to keep memory bounded). Returns the number of active streets.
    /// </summary>
    public async Task<int> ReplaceAllAsync(IReadOnlyCollection<StreetRecord> records, CancellationToken ct = default)
    {
        // De-dup incoming by (city, street); ignore blanks.
        var incoming = records
            .Where(r => !string.IsNullOrWhiteSpace(r.CityName) && !string.IsNullOrWhiteSpace(r.StreetName))
            .Select(r => new StreetRecord(r.CityName.Trim(), r.StreetName.Trim()))
            .GroupBy(r => (r.CityName, r.StreetName))
            .Select(g => g.Key)
            .ToList();

        if (incoming.Count == 0)
            throw new InvalidOperationException("מקור הסנכרון לא החזיר רחובות — לא בוצע עדכון.");

        await db.Streets.ExecuteDeleteAsync(ct);

        var now = DateTime.UtcNow;
        const int batchSize = 2000;
        for (var i = 0; i < incoming.Count; i += batchSize)
        {
            ct.ThrowIfCancellationRequested();
            foreach (var (cityName, streetName) in incoming.Skip(i).Take(batchSize))
                db.Streets.Add(new Street { CityName = cityName, StreetName = streetName, IsActive = true, UpdatedAt = now });
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        return incoming.Count;
    }
}
