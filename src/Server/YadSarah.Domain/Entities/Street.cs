namespace YadSarah.Domain.Entities;

/// <summary>
/// A street within an Israeli city, from the national streets registry (data.gov.il
/// "רחובות בישראל"). Non-PHI reference data held in the internal DB and refreshed
/// periodically (admin-triggered sync / file import) so the reception address
/// autocomplete is always served offline — the same offline-first design as
/// <see cref="Medication"/>.
/// </summary>
public class Street
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string CityName { get; set; } = string.Empty;
    public string StreetName { get; set; } = string.Empty;

    /// <summary>False = no longer in the latest registry snapshot (kept for history).</summary>
    public bool IsActive { get; set; } = true;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
