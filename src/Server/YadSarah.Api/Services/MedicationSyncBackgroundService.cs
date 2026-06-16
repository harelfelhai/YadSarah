using System.Globalization;
using YadSarah.Application.Services;

namespace YadSarah.Api.Services;

/// <summary>
/// Periodically refreshes the drug catalog from the MoH API. Wakes every few hours
/// and syncs only when the configured interval (default 7 days) has elapsed since the
/// last successful sync — so a restart doesn't trigger a redundant fetch. A failed
/// sync is logged and ignored; the last good snapshot remains available offline.
/// The clinical path never depends on this service.
/// </summary>
public class MedicationSyncBackgroundService(
    IServiceScopeFactory scopeFactory,
    ILogger<MedicationSyncBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the app finish starting before the first check.
        try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(CheckInterval);
        do
        {
            try { await RunIfDueAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Medication sync check failed"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunIfDueAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();

        var intervalDays = await settings.GetIntAsync(SettingsService.MedSyncIntervalDaysKey, 7);
        var lastSyncRaw = await settings.GetStringAsync(SettingsService.MedLastSyncAtKey);
        var due = string.IsNullOrWhiteSpace(lastSyncRaw)
            || !DateTime.TryParse(lastSyncRaw, CultureInfo.InvariantCulture,
                   DateTimeStyles.RoundtripKind, out var last)
            || DateTime.UtcNow - last >= TimeSpan.FromDays(Math.Max(1, intervalDays));

        if (!due) return;

        logger.LogInformation("Drug catalog sync is due — fetching from MoH API");
        var sync = scope.ServiceProvider.GetRequiredService<MedicationSyncService>();
        var result = await sync.SyncFromApiAsync(ct);
        if (result.Success) logger.LogInformation("Drug catalog sync ok: {Message}", result.Message);
        else logger.LogWarning("Drug catalog sync failed: {Message}", result.Message);
    }
}
