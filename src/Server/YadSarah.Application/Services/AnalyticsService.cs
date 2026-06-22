using Microsoft.EntityFrameworkCore;
using YadSarah.Domain.Entities;
using YadSarah.Infrastructure.Data;

namespace YadSarah.Application.Services;

// One bar per day-of-week (0 = Sunday … 6 = Saturday). AvgPerDay normalizes by how many
// of that weekday fall in the range, so a 30-day and a 60-day range stay comparable.
public record WeekdayPoint(int Weekday, double AvgPerDay, int Total);

// One bar per half-hour-of-day (Bin 0 = 00:00, 1 = 00:30, … 47 = 23:30).
public record HalfHourPoint(int Bin, string Label, double AvgPerDay, int Total);

// Concurrent presence at each half-hour mark, averaged across the days in range (Max = the
// busiest that slot ever got, for capacity planning).
public record CensusPoint(int Bin, string Label, double Avg, int Max);

public record AnalyticsOverview(
    DateOnly From, DateOnly To, int Days,
    IReadOnlyList<WeekdayPoint> PatientsByWeekday,
    IReadOnlyList<HalfHourPoint> ArrivalsByHalfHour,
    IReadOnlyList<CensusPoint> CensusByHalfHour);

/// <summary>
/// Manager analytics aggregations over the patient-flow data. All time-of-day / day-of-week
/// bucketing is done in <b>Israel local time</b> (timestamps are stored UTC), matching how the
/// rest of the system reasons about the shift day (see <see cref="ShiftStatusService"/>). Volumes
/// are small (an urgent-care's daily flow), so the range is pulled into memory and bucketed there —
/// this avoids DB-specific date functions and timezone pitfalls in SQL.
/// </summary>
public class AnalyticsService(AppDbContext db)
{
    private const int Bins = 48; // 24h × 2 half-hours

    // Upper bound on how long a not-yet-discharged visit is counted as "present" in the census.
    // Guards the chart against legacy/abandoned rows that never got a departure stamp.
    private static readonly TimeSpan MaxPlausibleStay = TimeSpan.FromHours(24);

    private static readonly TimeZoneInfo IsraelTz =
        TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Israel Standard Time" : "Asia/Jerusalem");

    private static DateTime ToIsrael(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), IsraelTz);

    private static DateTime ToUtc(DateTime local) =>
        TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), IsraelTz);

    private static string BinLabel(int bin) => $"{bin / 2:00}:{(bin % 2) * 30:00}";

    public async Task<AnalyticsOverview> GetOverviewAsync(DateOnly from, DateOnly to)
    {
        if (to < from) (from, to) = (to, from);
        int days = to.DayNumber - from.DayNumber + 1;

        var byWeekday = await PatientsByWeekdayAsync(from, to, days);
        var byArrival = await ArrivalsByHalfHourAsync(from, to, days);
        var byCensus = await CensusByHalfHourAsync(from, to, days);

        return new AnalyticsOverview(from, to, days, byWeekday, byArrival, byCensus);
    }

    // ── 1. Patients per day, grouped by day-of-week ───────────────────────────
    private async Task<List<WeekdayPoint>> PatientsByWeekdayAsync(DateOnly from, DateOnly to, int days)
    {
        // AdmissionDate is the (already-local) arrival day, so weekday bucketing needs no TZ math.
        var dates = await db.Visits.AsNoTracking()
            .Where(v => v.AdmissionDate >= from && v.AdmissionDate <= to)
            .Select(v => v.AdmissionDate)
            .ToListAsync();

        var totals = new int[7];
        foreach (var d in dates) totals[(int)d.DayOfWeek]++;

        // How many of each weekday actually fall in [from, to] — the divisor for the average.
        var weekdayCounts = new int[7];
        for (var d = from; d <= to; d = d.AddDays(1)) weekdayCounts[(int)d.DayOfWeek]++;

        return Enumerable.Range(0, 7)
            .Select(w => new WeekdayPoint(
                w,
                weekdayCounts[w] == 0 ? 0 : Math.Round((double)totals[w] / weekdayCounts[w], 1),
                totals[w]))
            .ToList();
    }

    // ── 2. Arrivals by half-hour-of-day ───────────────────────────────────────
    private async Task<List<HalfHourPoint>> ArrivalsByHalfHourAsync(DateOnly from, DateOnly to, int days)
    {
        var times = await db.Visits.AsNoTracking()
            .Where(v => v.AdmissionDate >= from && v.AdmissionDate <= to)
            .Select(v => v.AdmissionTime)
            .ToListAsync();

        var totals = new int[Bins];
        foreach (var t in times) totals[BinOf(t.Hour, t.Minute)]++;

        return Enumerable.Range(0, Bins)
            .Select(b => new HalfHourPoint(
                b, BinLabel(b),
                days == 0 ? 0 : Math.Round((double)totals[b] / days, 2),
                totals[b]))
            .ToList();
    }

    // ── 3. Concurrent presence (census) by half-hour-of-day ───────────────────
    private async Task<List<CensusPoint>> CensusByHalfHourAsync(DateOnly from, DateOnly to, int days)
    {
        var startUtc = ToUtc(from.ToDateTime(TimeOnly.MinValue));
        var endUtc = ToUtc(to.AddDays(1).ToDateTime(TimeOnly.MinValue)); // exclusive

        // Any visit whose presence interval [arrival, departure) overlaps the range.
        var intervals = await db.Visits.AsNoTracking()
            .Where(v => v.CreatedAt < endUtc && (v.DepartedAt == null || v.DepartedAt >= startUtc))
            .Select(v => new { v.CreatedAt, v.DepartedAt, v.Status })
            .ToListAsync();

        var nowUtc = DateTime.UtcNow;
        // perDayBin[dayIndex][bin] = how many patients were present at that half-hour mark.
        var counts = new int[days, Bins];

        foreach (var iv in intervals)
        {
            var arrival = ToIsrael(iv.CreatedAt);
            DateTime departureUtc;
            if (iv.DepartedAt.HasValue)
            {
                departureUtc = iv.DepartedAt.Value;
            }
            else if (iv.Status == VisitStatus.Discharged)
            {
                // Already discharged but with no departure stamp = legacy data from before
                // departure was tracked: the exit time is unknown, so we can't place this visit
                // on the timeline. Don't assume "still present" (that would smear it across the
                // whole range). Skip it.
                continue;
            }
            else
            {
                // Genuinely still present (no departure yet): count up to "now", capped to a
                // plausible max stay so a stale un-discharged row can't run forever.
                departureUtc = iv.CreatedAt.Add(MaxPlausibleStay) < nowUtc ? iv.CreatedAt.Add(MaxPlausibleStay) : nowUtc;
            }
            var departure = ToIsrael(departureUtc);
            if (departure <= arrival) continue;

            // Walk the half-hour marks the patient was present for: present at mark t ⇔ arrival ≤ t < departure.
            var firstMark = CeilToHalfHour(arrival);
            for (var mark = firstMark; mark < departure; mark = mark.AddMinutes(30))
            {
                int dayIndex = DateOnly.FromDateTime(mark).DayNumber - from.DayNumber;
                if (dayIndex < 0 || dayIndex >= days) continue;
                counts[dayIndex, BinOf(mark.Hour, mark.Minute)]++;
            }
        }

        var result = new List<CensusPoint>(Bins);
        for (int b = 0; b < Bins; b++)
        {
            long sum = 0;
            int max = 0;
            for (int d = 0; d < days; d++)
            {
                sum += counts[d, b];
                if (counts[d, b] > max) max = counts[d, b];
            }
            result.Add(new CensusPoint(b, BinLabel(b),
                days == 0 ? 0 : Math.Round((double)sum / days, 2), max));
        }
        return result;
    }

    private static int BinOf(int hour, int minute) => hour * 2 + (minute >= 30 ? 1 : 0);

    // Smallest half-hour mark (:00 or :30) at or after t.
    private static DateTime CeilToHalfHour(DateTime t)
    {
        var floor = new DateTime(t.Year, t.Month, t.Day, t.Hour, t.Minute < 30 ? 0 : 30, 0, DateTimeKind.Unspecified);
        return floor >= t ? floor : floor.AddMinutes(30);
    }
}
