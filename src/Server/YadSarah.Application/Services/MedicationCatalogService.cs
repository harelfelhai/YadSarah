using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One normalized record coming from a sync source (API or file).</summary>
public record MedicationRecord(string RegistrationNumber, string HebrewName, string? EnglishName);

/// <summary>
/// Reads and maintains the internal drug catalog. Search serves the clinical
/// autocomplete (offline); <see cref="ReplaceAllAsync"/> applies a full registry
/// snapshot from the sync sources.
/// </summary>
public class MedicationCatalogService(AppDbContext db)
{
    public async Task<List<Medication>> SearchAsync(string? q, int take)
    {
        take = Math.Clamp(take, 1, 50);
        var query = db.Medications.AsNoTracking().Where(m => m.IsActive);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            var like = $"%{term}%";
            query = query.Where(m =>
                EF.Functions.ILike(m.HebrewName, like) ||
                (m.EnglishName != null && EF.Functions.ILike(m.EnglishName, like)) ||
                EF.Functions.ILike(m.RegistrationNumber, like));
        }

        return await query
            .OrderBy(m => m.HebrewName)
            .Take(take)
            .ToListAsync();
    }

    public Task<int> CountActiveAsync() => db.Medications.CountAsync(m => m.IsActive);

    /// <summary>
    /// Applies a full snapshot: upserts every incoming record (by registration number),
    /// and marks any medication NOT present in the snapshot as inactive (delisted).
    /// Returns the number of active medications afterwards.
    /// </summary>
    public async Task<int> ReplaceAllAsync(IReadOnlyCollection<MedicationRecord> records)
    {
        // De-dup incoming by registration number (registry can repeat).
        var incoming = records
            .Where(r => !string.IsNullOrWhiteSpace(r.RegistrationNumber) && !string.IsNullOrWhiteSpace(r.HebrewName))
            .GroupBy(r => r.RegistrationNumber.Trim())
            .ToDictionary(g => g.Key, g => g.First());

        if (incoming.Count == 0)
            throw new InvalidOperationException("מקור הסנכרון לא החזיר תרופות — לא בוצע עדכון.");

        var existing = await db.Medications.ToDictionaryAsync(m => m.RegistrationNumber);
        var now = DateTime.UtcNow;

        foreach (var (regNum, rec) in incoming)
        {
            if (existing.TryGetValue(regNum, out var med))
            {
                med.HebrewName = rec.HebrewName.Trim();
                med.EnglishName = string.IsNullOrWhiteSpace(rec.EnglishName) ? null : rec.EnglishName.Trim();
                med.IsActive = true;
                med.UpdatedAt = now;
            }
            else
            {
                db.Medications.Add(new Medication
                {
                    RegistrationNumber = regNum,
                    HebrewName = rec.HebrewName.Trim(),
                    EnglishName = string.IsNullOrWhiteSpace(rec.EnglishName) ? null : rec.EnglishName.Trim(),
                    IsActive = true,
                    UpdatedAt = now,
                });
            }
        }

        // Delist anything not in the snapshot (kept, just marked inactive).
        foreach (var (regNum, med) in existing)
            if (!incoming.ContainsKey(regNum) && med.IsActive)
            {
                med.IsActive = false;
                med.UpdatedAt = now;
            }

        await db.SaveChangesAsync();
        return await CountActiveAsync();
    }
}
