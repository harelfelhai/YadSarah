using System.Globalization;
using YadSarah.Application.Services;

namespace YadSarah.Api.Services;

/// <summary>
/// Periodically refreshes the streets catalog from data.gov.il. Wakes every few hours and
/// syncs only when the configured interval (default 30 days) has elapsed since the last
/// successful sync — so a restart doesn't trigger a redundant fetch. A failed sync is logged
/// and ignored; the last good snapshot remains available offline. The reception path never
/// depends on this service. Mirrors <see cref="MedicationSyncBackgroundService"/>.
/// </summary>
public class StreetSyncBackgroundService(
    IServiceScopeFactory scopeFactory,
    ILogger<StreetSyncBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(12);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(CheckInterval);
        do
        {
            try { await RunIfDueAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Street sync check failed"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunIfDueAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();

        var intervalDays = await settings.GetIntAsync(SettingsService.StreetsSyncIntervalDaysKey, 30);
        var lastSyncRaw = await settings.GetStringAsync(SettingsService.StreetsLastSyncAtKey);
        var due = string.IsNullOrWhiteSpace(lastSyncRaw)
            || !DateTime.TryParse(lastSyncRaw, CultureInfo.InvariantCulture,
                   DateTimeStyles.RoundtripKind, out var last)
            || DateTime.UtcNow - last >= TimeSpan.FromDays(Math.Max(1, intervalDays));

        if (!due) return;

        logger.LogInformation("Streets catalog sync is due — fetching from data.gov.il");
        var sync = scope.ServiceProvider.GetRequiredService<StreetSyncService>();
        var result = await sync.SyncFromApiAsync(ct);
        if (result.Success) logger.LogInformation("Streets catalog sync ok: {Message}", result.Message);
        else logger.LogWarning("Streets catalog sync failed: {Message}", result.Message);
    }
}
