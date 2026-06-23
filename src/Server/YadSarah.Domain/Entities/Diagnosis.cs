namespace YadSarah.Domain.Entities;

/// <summary>
/// An official diagnosis from the internal diagnosis catalog (a CLOSED list).
/// Mirrors <see cref="Medication"/>: the catalog is held in the internal DB and
/// refreshed via admin file-import (CSV/XLSX) or the seeded starter list, so
/// entering a diagnosis in a form is always served from the internal closed
/// catalog (no free text).
///
/// There is no accessible official open Hebrew ICD source, so Hebrew labels are
/// supplied by us (a seeded curated ED list, replaceable by an admin upload).
/// The diagnosis <see cref="Code"/> (ICD) is the unique key — the analog of the
/// medication registration number.
/// </summary>
public class Diagnosis
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Official diagnosis code (e.g. ICD-10 "J03.90"). Unique.</summary>
    public string Code { get; set; } = string.Empty;

    public string HebrewName { get; set; } = string.Empty;
    public string? EnglishName { get; set; }

    /// <summary>False = removed from the latest snapshot / delisted (kept for history).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
