using System.Text.RegularExpressions;

namespace YadSarah.Application.Services;

/// <summary>
/// Detects pregnancy and gestational week from a free-text admission reason. Single source of truth
/// shared by reception routing (pregnancy → women's department) and the obstetric intake care-steps
/// (US/lab, and the monitor from week 28) — so the two never diverge on what "pregnant" means.
/// </summary>
public static class PregnancyInfo
{
    // "הריון"/"היריון" (incl. "בהריון", "ההיריון" as substrings) or an explicit "שבוע <n>" gestational week.
    private static readonly Regex PregnantRx = new(@"הריון|היריון|שבוע\s*\d+", RegexOptions.Compiled);
    private static readonly Regex WeekRx = new(@"שבוע\s*(\d+)", RegexOptions.Compiled);

    public static bool IsPregnant(string? reason) => PregnantRx.IsMatch(reason ?? "");

    /// <summary>The gestational week if the reason states one ("שבוע 30" → 30), else null.</summary>
    public static int? GestationalWeek(string? reason)
    {
        var m = WeekRx.Match(reason ?? "");
        return m.Success && int.TryParse(m.Groups[1].Value, out var w) ? w : null;
    }
}
