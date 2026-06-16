namespace YadSarah.Domain.Entities;

/// <summary>
/// A medication from the official Israeli Ministry of Health drug registry
/// (פנקס התכשירים). The catalog is held in the internal DB and refreshed
/// periodically (weekly auto-sync or admin-triggered / file import) so the
/// clinical path (entering a drug in a form) is always served offline.
///
/// Minimal fields by design: registration number + name (Hebrew/English).
/// </summary>
public class Medication
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>MoH registration number (מספר רישום), e.g. "012 34 56789 00". Unique.</summary>
    public string RegistrationNumber { get; set; } = string.Empty;

    public string HebrewName { get; set; } = string.Empty;
    public string? EnglishName { get; set; }

    /// <summary>False = delisted / no longer in the latest registry snapshot (kept for history).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
