using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YadSarah.Application.Services;

namespace YadSarah.Api.Controllers;

/// <summary>
/// Manager analytics over the patient-flow data (volume by weekday, arrivals and concurrent
/// presence by half-hour). Aggregate, non-PHI — but a management view, so restricted to shift
/// managers and admins and audited like the shift board.
/// </summary>
[ApiController]
[Route("api/analytics")]
[Authorize(Roles = "Admin,ShiftManager")]
public class AnalyticsController(AnalyticsService svc, AuditService audit) : ControllerBase
{
    private const int MaxRangeDays = 366;

    private static readonly TimeZoneInfo IsraelTz =
        TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem");

    [HttpGet("overview")]
    public async Task<IActionResult> Overview([FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, IsraelTz));
        var end = to ?? today;
        var start = from ?? end.AddDays(-29); // default: trailing 30 days
        if (end < start) (start, end) = (end, start);
        // Cap the window so a hand-crafted query can't pull an unbounded range into memory.
        if (end.DayNumber - start.DayNumber + 1 > MaxRangeDays)
            start = end.AddDays(-(MaxRangeDays - 1));

        var result = await svc.GetOverviewAsync(start, end);
        await audit.LogAsync(AuditService.Viewed, "Analytics", fieldName: "overview");
        return Ok(result);
    }
}
