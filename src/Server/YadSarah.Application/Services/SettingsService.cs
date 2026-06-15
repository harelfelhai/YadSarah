using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

public class SettingsService(AppDbContext db)
{
    // Known setting keys
    public const string QueueResetHourKey = "queue.resetHour";

    // Defaults seeded on startup so the admin screen always shows them
    private static readonly (string Key, string Value, string Description)[] Defaults =
    [
        (QueueResetHourKey, "18", "שעת איפוס מונה התור היומי (0–23, שעון ישראל)"),
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
