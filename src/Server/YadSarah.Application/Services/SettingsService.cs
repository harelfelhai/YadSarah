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
    // Diagnosis catalog (closed list). Import-only (no live Hebrew ICD source), so no
    // apiUrl/interval keys — just the snapshot metadata for the admin screen.
    public const string DiagLastSyncAtKey = "diagnoses.lastSyncAt";
    public const string DiagCountKey = "diagnoses.count";
    public const string DiagLastSyncStatusKey = "diagnoses.lastSyncStatus";
    public const string StreetsSyncIntervalDaysKey = "streets.syncIntervalDays";
    public const string StreetsApiUrlKey = "streets.apiUrl";
    public const string StreetsResourceIdKey = "streets.resourceId";
    public const string StreetsLastSyncAtKey = "streets.lastSyncAt";
    public const string StreetsCountKey = "streets.count";
    public const string StreetsLastSyncStatusKey = "streets.lastSyncStatus";
    // Public self-service intake: per-device submission cap + its rolling window (anti-abuse).
    public const string IntakeDeviceLimitKey = "intake.deviceLimit";
    public const string IntakeDeviceWindowMinutesKey = "intake.deviceWindowMinutes";
    // Error-report retention: rows older than N days are pruned, and a hard row cap bounds growth
    // on free-tier Postgres + limits how long PHI-capable error text lingers (ErrorReport table).
    public const string ErrorRetentionDaysKey = "errors.retentionDays";
    public const string ErrorMaxRowsKey = "errors.maxRows";

    // Default MoH drug-registry endpoint (paged JSON). Configurable because it sits
    // behind a WAF and may change; the file-import path is the offline fallback.
    public const string MedApiUrlDefault = "https://israeldrugs.health.gov.il/GetSpecificProductsByName";

    // Default streets source: the data.gov.il CKAN datastore ("רחובות בישראל").
    // The file-import path is the offline fallback.
    public const string StreetsApiUrlDefault = "https://data.gov.il/api/3/action/datastore_search";
    public const string StreetsResourceIdDefault = "a7296d1a-f8c9-4b70-96c2-6ebb4352f8e3";

    // Defaults seeded on startup so the admin screen always shows them
    private static readonly (string Key, string Value, string Description)[] Defaults =
    [
        (QueueResetHourKey, "6", "שעת איפוס מונה התור היומי (0–23, שעון ישראל)"),
        (ShiftStartHoursKey, "07,15,23", "שעות תחילת משמרת (0–23, מופרדות בפסיק) — לקביעת מי 'במשמרת' בלוח הסטטוס"),
        (MedSyncIntervalDaysKey, "7", "תדירות סנכרון מסד התרופות (בימים)"),
        (MedApiUrlKey, MedApiUrlDefault, "כתובת API למשיכת מאגר התרופות של משרד הבריאות"),
        (MedLastSyncAtKey, "", "מועד הסנכרון האחרון של מסד התרופות (UTC)"),
        (MedCountKey, "0", "מספר התרופות במאגר הפנימי"),
        (MedLastSyncStatusKey, "", "סטטוס הסנכרון האחרון"),
        (DiagLastSyncAtKey, "", "מועד העדכון האחרון של מסד האבחנות (UTC)"),
        (DiagCountKey, "0", "מספר האבחנות במאגר הפנימי"),
        (DiagLastSyncStatusKey, "", "סטטוס העדכון האחרון של מסד האבחנות"),
        (StreetsSyncIntervalDaysKey, "30", "תדירות סנכרון מאגר הרחובות (בימים)"),
        (StreetsApiUrlKey, StreetsApiUrlDefault, "כתובת ה-API למשיכת מאגר הרחובות (data.gov.il)"),
        (StreetsResourceIdKey, StreetsResourceIdDefault, "מזהה המשאב של מאגר הרחובות ב-data.gov.il"),
        (StreetsLastSyncAtKey, "", "מועד הסנכרון האחרון של מאגר הרחובות (UTC)"),
        (StreetsCountKey, "0", "מספר הרחובות במאגר הפנימי"),
        (StreetsLastSyncStatusKey, "", "סטטוס הסנכרון האחרון של הרחובות"),
        (IntakeDeviceLimitKey, "3", "מספר מרבי של טפסי קבלה-עצמית מאותו מכשיר בתוך חלון הזמן"),
        (IntakeDeviceWindowMinutesKey, "60", "חלון הזמן (בדקות) לספירת טפסי קבלה-עצמית מאותו מכשיר"),
        (ErrorRetentionDaysKey, "30", "מספר הימים לשמירת דיווחי שגיאות לפני מחיקה אוטומטית"),
        (ErrorMaxRowsKey, "50000", "מספר השורות המרבי בטבלת השגיאות (מחיקת הישנות ביותר מעבר לכך)"),
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
