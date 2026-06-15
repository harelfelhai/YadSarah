namespace YadSarah.Domain.Entities;

/// <summary>
/// Key/value system configuration, editable from the admin settings screen.
/// Extensible — new settings are just new rows (no schema change).
/// </summary>
public class SystemSetting
{
    public string Key { get; set; } = string.Empty;   // PK, e.g. "queue.resetHour"
    public string Value { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedByUserId { get; set; }
}
