using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class SettingsService(AppDbContext db)
{
    // Known setting keys
    public const string QueueResetHourKey = "queue.resetHour";
    public const string ShiftStartHoursKey = "shift.startHours";
    public const string MedSyncIntervalDaysKey = "medications.syncIntervalDays";
    public const string MedApiUrlKey = "medications.apiUrl";
    public const string MedLastSyncAtKey = "medications.lastSyncAt";
    public const string MedCountKey = "medications.count";
    public const string MedLastSyncStatusKey = "medications.lastSyncStatus";

    // Default MoH drug-registry endpoint (paged JSON). Configurable because it sits
    // behind a WAF and may change; the file-import path is the offline fallback.
    public const string MedApiUrlDefault = "https://israeldrugs.health.gov.il/GetSpecificProductsByName";

    // Defaults seeded on startup so the admin screen always shows them
    private static readonly (string Key, string Value, string Description)[] Defaults =
    [
        (QueueResetHourKey, "18", "שעת איפוס מונה התור היומי (0–23, שעון ישראל)"),
        (ShiftStartHoursKey, "07,15,23", "שעות תחילת משמרת (0–23, מופרדות בפסיק) — לקביעת מי 'במשמרת' בלוח הסטטוס"),
        (MedSyncIntervalDaysKey, "7", "תדירות סנכרון מסד התרופות (בימים)"),
        (MedApiUrlKey, MedApiUrlDefault, "כתובת API למשיכת מאגר התרופות של משרד הבריאות"),
        (MedLastSyncAtKey, "", "מועד הסנכרון האחרון של מסד התרופות (UTC)"),
        (MedCountKey, "0", "מספר התרופות במאגר הפנימי"),
        (MedLastSyncStatusKey, "", "סטטוס הסנכרון האחרון"),
    ];

    public async Task EnsureDefaultsAsync()
    {
        foreach (var (key, value, description) in Defaults)
        {
            if (!await db.SystemSettings.AnyAsync(s => s.Key == key))
                db.SystemSettings.Add(new SystemSetting { Key = key, Value = value, Description = description });
        }
        await db.SaveChangesAsync();
    }

    public async Task<List<SystemSetting>> GetAllAsync() =>
        await db.SystemSettings.OrderBy(s => s.Key).ToListAsync();

    public async Task<int> GetIntAsync(string key, int fallback)
    {
        var s = await db.SystemSettings.FindAsync(key);
        return s is not null && int.TryParse(s.Value, out var v) ? v : fallback;
    }

    public async Task<string?> GetStringAsync(string key, string? fallback = null)
    {
        var s = await db.SystemSettings.FindAsync(key);
        return s?.Value ?? fallback;
    }

    /// <summary>System-driven write (no user attribution), e.g. sync metadata. Upserts the row.</summary>
    public async Task SetSystemAsync(string key, string value)
    {
        var s = await db.SystemSettings.FindAsync(key);
        if (s is null) { s = new SystemSetting { Key = key }; db.SystemSettings.Add(s); }
        s.Value = value;
        s.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    public async Task<SystemSetting> SetAsync(string key, string value, Guid userId)
    {
        var s = await db.SystemSettings.FindAsync(key)
            ?? throw new KeyNotFoundException($"Unknown setting '{key}'");
        s.Value = value;
        s.UpdatedAt = DateTime.UtcNow;
        s.UpdatedByUserId = userId;
        await db.SaveChangesAsync();
        return s;
    }
}
