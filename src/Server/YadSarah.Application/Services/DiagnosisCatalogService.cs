using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

/// <summary>One normalized record coming from a sync source (file import or seed).
/// Code is required; at least one of English/Hebrew name must be present (English is
/// the primary — the catalog is official ICD-10-CM, English by design).</summary>
public record DiagnosisRecord(string Code, string? HebrewName, string? EnglishName);

/// <summary>
/// Reads and maintains the internal diagnosis catalog (a CLOSED list). Search serves
/// the clinical autocomplete; <see cref="ReplaceAllAsync"/> applies a full snapshot
/// (admin file-import or the seeded starter list). The catalog is the analog of the
/// drug catalog (<see cref="MedicationCatalogService"/>), keyed by ICD code instead of
/// registration number.
/// </summary>
public class DiagnosisCatalogService(AppDbContext db)
{
    // Separator used to build a single display/label string from name + code.
    // MUST match the client (diagnosisLabel in the picker) exactly, since the
    // stored form value is this label and the closed-list check compares labels.
    public const string LabelSep = " — ";

    /// <summary>Canonical English-first label: "EnglishName — Code", falling back to the
    /// Hebrew name, then the bare code. Matches the client diagnosisLabel helper.</summary>
    public static string Label(Diagnosis d) => BuildLabel(d.EnglishName, d.HebrewName, d.Code);

    private static string BuildLabel(string? english, string? hebrew, string code)
    {
        var en = english?.Trim();
        if (!string.IsNullOrWhiteSpace(en)) return $"{en}{LabelSep}{code}";
        var he = hebrew?.Trim();
        return string.IsNullOrWhiteSpace(he) ? code : $"{he}{LabelSep}{code}";
    }

    public async Task<List<Diagnosis>> SearchAsync(string? q, int take)
    {
        take = Math.Clamp(take, 1, 50);
        var query = db.Diagnoses.AsNoTracking().Where(d => d.IsActive);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            var like = $"%{term}%";   // substring match on all three columns, each GIN-trgm indexed
            query = query.Where(d =>
                (d.EnglishName != null && EF.Functions.ILike(d.EnglishName, like)) ||
                EF.Functions.ILike(d.HebrewName, like) ||
                EF.Functions.ILike(d.Code, like));
        }

        return await query
            .OrderBy(d => d.EnglishName)
            .ThenBy(d => d.HebrewName)
            .Take(take)
            .ToListAsync();
    }

    /// <summary>
    /// The diagnoses a doctor uses most, across the diagnoses section of the forms THEY
    /// signed. Returns the raw diagnosis label strings (already in "name — code" form for
    /// catalog picks), most-used first. Empty for users who haven't signed forms → caller
    /// falls back to a plain catalog list. Same derive-on-read pattern as the drug catalog.
    /// </summary>
    public async Task<List<string>> GetFrequentForDoctorAsync(Guid userId, int take)
    {
        take = Math.Clamp(take, 1, 50);

        var rows = await db.MedicalForms.AsNoTracking()
            .Where(f => f.IsSigned && f.SignedByUserId == userId)
            .Select(f => f.DiagnosesJson)
            .ToListAsync();

        var counts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var json in rows)
            AddDiagnoses(json, counts);

        var ordered = counts
            .OrderByDescending(kv => kv.Value)
            .ThenBy(kv => kv.Key)
            .Select(kv => kv.Key)
            .AsEnumerable();

        // Surface ONLY current official-catalog labels ("English — Code"). Legacy/free-text
        // values (e.g. Hebrew diagnoses predating the closed catalog, or demo seed data) are
        // dropped — the picker must offer only entries from the official ICD-10-CM catalog. When
        // no catalog is loaded yet (free-text mode), keep the raw history so quick-picks stay useful.
        var active = await GetActiveLabelsAsync();
        if (active.Count > 0)
            ordered = ordered.Where(active.Contains);

        return ordered.Take(take).ToList();
    }

    // Parse a JSON array of {diagnosis, ...} objects and tally each non-empty diagnosis.
    private static void AddDiagnoses(string? json, Dictionary<string, int> counts)
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
                    if (!string.Equals(prop.Name, "diagnosis", StringComparison.OrdinalIgnoreCase)) continue;
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

    public Task<int> CountActiveAsync() => db.Diagnoses.CountAsync(d => d.IsActive);

    /// <summary>
    /// The set of canonical labels for the active catalog — used by the server-side
    /// closed-list check (a saved diagnosis must be one of these). Built in memory to
    /// avoid SQL string concatenation. Empty when the catalog is unpopulated.
    /// </summary>
    public async Task<HashSet<string>> GetActiveLabelsAsync()
    {
        var rows = await db.Diagnoses.AsNoTracking()
            .Where(d => d.IsActive)
            .Select(d => new { d.EnglishName, d.HebrewName, d.Code })
            .ToListAsync();
        return rows
            .Select(r => BuildLabel(r.EnglishName, r.HebrewName, r.Code))
            .ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>
    /// Applies a full snapshot: upserts every incoming record (by code), and marks any
    /// diagnosis NOT present in the snapshot as inactive (delisted). Returns the number
    /// of active diagnoses afterwards.
    /// </summary>
    public async Task<int> ReplaceAllAsync(IReadOnlyCollection<DiagnosisRecord> records)
    {
        // De-dup incoming by code (a source can repeat). Require a code and at least one
        // name (English is primary; Hebrew optional).
        var incoming = records
            .Where(r => !string.IsNullOrWhiteSpace(r.Code)
                && (!string.IsNullOrWhiteSpace(r.EnglishName) || !string.IsNullOrWhiteSpace(r.HebrewName)))
            .GroupBy(r => r.Code.Trim())
            .ToDictionary(g => g.Key, g => g.First());

        if (incoming.Count == 0)
            throw new InvalidOperationException("מקור הסנכרון לא החזיר אבחנות — לא בוצע עדכון.");

        var existing = await db.Diagnoses.ToDictionaryAsync(d => d.Code);
        var now = DateTime.UtcNow;

        foreach (var (code, rec) in incoming)
        {
            if (existing.TryGetValue(code, out var diag))
            {
                diag.HebrewName = rec.HebrewName?.Trim() ?? "";
                diag.EnglishName = string.IsNullOrWhiteSpace(rec.EnglishName) ? null : rec.EnglishName.Trim();
                diag.IsActive = true;
                diag.UpdatedAt = now;
            }
            else
            {
                db.Diagnoses.Add(new Diagnosis
                {
                    Code = code,
                    HebrewName = rec.HebrewName?.Trim() ?? "",
                    EnglishName = string.IsNullOrWhiteSpace(rec.EnglishName) ? null : rec.EnglishName.Trim(),
                    IsActive = true,
                    UpdatedAt = now,
                });
            }
        }

        // Delist anything not in the snapshot (kept, just marked inactive).
        foreach (var (code, diag) in existing)
            if (!incoming.ContainsKey(code) && diag.IsActive)
            {
                diag.IsActive = false;
                diag.UpdatedAt = now;
            }

        await db.SaveChangesAsync();
        return await CountActiveAsync();
    }

    /// <summary>
    /// Seeds the curated English ICD-10-CM ED starter list on first run (only when the
    /// catalog is empty, so an admin's later import/delist is never overwritten). It is a
    /// focused subset of the most common ED presentations so the closed picker is usable
    /// out of the box without loading the full ~70k ICD-10-CM file; an admin replaces it
    /// with the official CDC file (or a hospital file) via import.
    /// </summary>
    public async Task SeedDefaultsAsync()
    {
        if (await db.Diagnoses.AnyAsync()) return;
        await ReplaceAllAsync(StarterCatalog);
    }

    // ── Curated English ICD-10-CM ED starter catalog (replaceable by admin import) ──
    // Code + English short description for the most common emergency-department
    // presentations. NOT exhaustive — a starter set, explicitly meant to be replaced by
    // the official CDC ICD-10-CM file (code + description) or the hospital's file.
    public static readonly IReadOnlyList<DiagnosisRecord> StarterCatalog = new DiagnosisRecord[]
    {
        // Respiratory
        new("J00",     null, "Acute nasopharyngitis (common cold)"),
        new("J02.9",   null, "Acute pharyngitis"),
        new("J03.90",  null, "Acute tonsillitis"),
        new("J06.9",   null, "Acute upper respiratory infection"),
        new("J20.9",   null, "Acute bronchitis"),
        new("J21.9",   null, "Acute bronchiolitis"),
        new("J18.9",   null, "Pneumonia, unspecified organism"),
        new("J45.909", null, "Asthma, unspecified"),
        new("J44.1",   null, "COPD with acute exacerbation"),
        new("J11.1",   null, "Influenza with respiratory manifestations"),
        new("R05",     null, "Cough"),
        new("R06.02",  null, "Shortness of breath"),
        // ENT
        new("H66.90",  null, "Otitis media, unspecified"),
        new("H60.9",   null, "Otitis externa, unspecified"),
        new("J01.90",  null, "Acute sinusitis, unspecified"),
        new("R04.0",   null, "Epistaxis"),
        // Cardiovascular
        new("I10",     null, "Essential (primary) hypertension"),
        new("I20.9",   null, "Angina pectoris, unspecified"),
        new("I21.9",   null, "Acute myocardial infarction, unspecified"),
        new("I48.91",  null, "Atrial fibrillation, unspecified"),
        new("I50.9",   null, "Heart failure, unspecified"),
        new("I80.209", null, "Deep vein thrombosis of lower extremity"),
        new("R07.9",   null, "Chest pain, unspecified"),
        new("R55",     null, "Syncope and collapse"),
        new("R00.2",   null, "Palpitations"),
        // Gastrointestinal
        new("A09",     null, "Infectious gastroenteritis and colitis"),
        new("K52.9",   null, "Noninfective gastroenteritis and colitis"),
        new("K59.00",  null, "Constipation, unspecified"),
        new("R10.9",   null, "Abdominal pain, unspecified"),
        new("R10.0",   null, "Acute abdomen"),
        new("K35.80",  null, "Acute appendicitis, unspecified"),
        new("K80.20",  null, "Calculus of gallbladder without cholecystitis"),
        new("K29.70",  null, "Gastritis, unspecified, without bleeding"),
        new("K21.9",   null, "Gastro-esophageal reflux disease without esophagitis"),
        new("R11.2",   null, "Nausea with vomiting, unspecified"),
        new("K57.32",  null, "Diverticulitis of large intestine without perforation"),
        new("K92.2",   null, "Gastrointestinal hemorrhage, unspecified"),
        new("K62.5",   null, "Hemorrhage of anus and rectum"),
        // Genitourinary
        new("N39.0",   null, "Urinary tract infection, site not specified"),
        new("N20.0",   null, "Calculus of kidney"),
        new("N23",     null, "Unspecified renal colic"),
        new("N30.90",  null, "Cystitis, unspecified, without hematuria"),
        new("R31.9",   null, "Hematuria, unspecified"),
        new("N10",     null, "Acute pyelonephritis"),
        // Neurological
        new("G43.909", null, "Migraine, unspecified, not intractable"),
        new("R51.9",   null, "Headache, unspecified"),
        new("G40.909", null, "Epilepsy, unspecified, not intractable"),
        new("R56.9",   null, "Unspecified convulsions"),
        new("I63.9",   null, "Cerebral infarction, unspecified (stroke)"),
        new("G45.9",   null, "Transient cerebral ischemic attack (TIA)"),
        new("R42",     null, "Dizziness and giddiness"),
        new("H81.10",  null, "Benign paroxysmal vertigo, unspecified ear"),
        // Musculoskeletal / trauma
        new("M54.50",  null, "Low back pain, unspecified"),
        new("M54.2",   null, "Cervicalgia"),
        new("M25.50",  null, "Pain in unspecified joint"),
        new("M79.10",  null, "Myalgia, unspecified site"),
        new("M25.569", null, "Pain in unspecified knee"),
        new("S52.509", null, "Fracture of lower end of radius"),
        new("S62.609", null, "Fracture of finger"),
        new("S82.6",   null, "Fracture of lateral malleolus (ankle)"),
        new("S93.409", null, "Sprain of ankle"),
        new("S43.409", null, "Sprain of shoulder joint"),
        new("S60.00",  null, "Contusion of finger without damage to nail"),
        new("T14.90",  null, "Injury, unspecified"),
        new("S09.90",  null, "Unspecified injury of head (minor head injury)"),
        // Skin / allergy
        new("L03.90",  null, "Cellulitis, unspecified"),
        new("L50.9",   null, "Urticaria, unspecified"),
        new("T78.40XA", null, "Allergy, unspecified, initial encounter"),
        new("T78.2XXA", null, "Anaphylactic shock, unspecified, initial encounter"),
        new("B02.9",   null, "Zoster without complications (herpes zoster)"),
        new("L08.9",   null, "Local infection of skin, unspecified"),
        new("L30.9",   null, "Dermatitis, unspecified"),
        // General / metabolic / infectious
        new("R50.9",   null, "Fever, unspecified"),
        new("E86.0",   null, "Dehydration"),
        new("E11.9",   null, "Type 2 diabetes mellitus without complications"),
        new("R73.9",   null, "Hyperglycemia, unspecified"),
        new("E16.2",   null, "Hypoglycemia, unspecified"),
        new("D64.9",   null, "Anemia, unspecified"),
        new("R53.83",  null, "Other fatigue / weakness"),
        new("T67.0XXA", null, "Heatstroke and sunstroke, initial encounter"),
        new("A41.9",   null, "Sepsis, unspecified organism"),
        // Psychiatric
        new("F41.9",   null, "Anxiety disorder, unspecified"),
        new("F41.0",   null, "Panic disorder (panic attack)"),
        new("F32.9",   null, "Major depressive disorder, single episode"),
        // Eye
        new("H10.9",   null, "Unspecified conjunctivitis"),
        new("H00.019", null, "Hordeolum externum, unspecified eye"),
        new("S05.00XA", null, "Injury of conjunctiva/cornea, initial encounter"),
        // Obstetric / gynecological (women's track)
        new("O21.0",   null, "Mild hyperemesis gravidarum"),
        new("O20.0",   null, "Threatened abortion"),
        new("N76.0",   null, "Acute vaginitis"),
        new("N73.9",   null, "Female pelvic inflammatory disease (PID)"),
        new("N94.6",   null, "Dysmenorrhea, unspecified"),
        new("O26.90",  null, "Pregnancy related condition, unspecified"),
        // Pediatric
        new("R56.00",  null, "Simple febrile convulsions"),
        new("A08.4",   null, "Viral intestinal infection, unspecified"),
        new("B34.9",   null, "Viral infection, unspecified"),
    };
}
