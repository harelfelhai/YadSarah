using System.Text.Json;
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

    /// <summary>
    /// The drug names a doctor uses most, across the medication sections (discharge meds,
    /// treatments, administration orders) of the forms THEY signed. Returns the raw
    /// drugName strings (already in "english — regNo" label form for catalog picks),
    /// most-used first. Empty for users who haven't signed forms (e.g. nurses) → caller
    /// falls back to a plain catalog list.
    /// </summary>
    public async Task<List<string>> GetFrequentForDoctorAsync(Guid userId, int take)
    {
        take = Math.Clamp(take, 1, 50);

        var rows = await db.MedicalForms.AsNoTracking()
            .Where(f => f.IsSigned && f.SignedByUserId == userId)
            .Select(f => new { f.DischargeMedicationsJson, f.TreatmentsJson, f.AdministrationOrdersJson })
            .ToListAsync();

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            AddDrugNames(r.DischargeMedicationsJson, counts);
            AddDrugNames(r.TreatmentsJson, counts);
            AddDrugNames(r.AdministrationOrdersJson, counts);
        }

        return counts
            .OrderByDescending(kv => kv.Value)
            .ThenBy(kv => kv.Key)
            .Take(take)
            .Select(kv => kv.Key)
            .ToList();
    }

    // Parse a JSON array of {drugName, ...} objects and tally each non-empty drugName.
    private static void AddDrugNames(string? json, Dictionary<string, int> counts)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return;
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.ValueKind != JsonValueKind.Object) continue;
                foreach (var prop in el.EnumerateObject())
                {
                    if (!string.Equals(prop.Name, "drugName", StringComparison.OrdinalIgnoreCase)) continue;
                    if (prop.Value.ValueKind == JsonValueKind.String)
                    {
                        var name = prop.Value.GetString()?.Trim();
                        if (!string.IsNullOrWhiteSpace(name))
                            counts[name] = counts.GetValueOrDefault(name) + 1;
                    }
                    break;
                }
            }
        }
        catch { /* skip malformed JSON defensively */ }
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
