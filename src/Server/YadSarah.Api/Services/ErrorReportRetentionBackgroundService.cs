using YadSarah.Application.Services;

namespace YadSarah.Api.Services;

/// <summary>
/// Periodically prunes the <c>ErrorReports</c> table: drops rows older than the configured retention
/// window (default 30 days) and enforces a hard row cap (default 50,000). Bounds table growth on
/// free-tier Postgres and limits how long PHI-capable error text lingers. A failed prune is logged
/// and ignored — it never crashes the host. The clinical path never depends on this service.
/// </summary>
public class ErrorReportRetentionBackgroundService(
    IServiceScopeFactory scopeFactory,
    ILogger<ErrorReportRetentionBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(12);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the app finish starting before the first prune.
        try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(CheckInterval);
        do
        {
            try { await PruneAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Error-report retention prune failed"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task PruneAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        var svc = scope.ServiceProvider.GetRequiredService<ErrorReportService>();

        var retentionDays = await settings.GetIntAsync(SettingsService.ErrorRetentionDaysKey, 30);
        var maxRows = await settings.GetIntAsync(SettingsService.ErrorMaxRowsKey, 50000);

        var deleted = await svc.PruneAsync(retentionDays, maxRows);
        if (deleted > 0)
            logger.LogInformation("Error-report retention pruned {Count} rows", deleted);
    }
}
