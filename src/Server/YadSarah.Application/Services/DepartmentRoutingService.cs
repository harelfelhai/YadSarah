using System.Text.RegularExpressions;

namespace YadSarah.Application.Services;

/// <summary>Canonical department set used for AI routing at reception (2026-06-19).</summary>
public static class Departments
{
    public const string Emergency = "רפואה דחופה";
    public const string Pediatrics = "ילדים";        // עד גיל 17
    public const string Orthopedics = "אורטופדיה";
    public const string Womens = "נשים";
    public const string Infusion = "עירוי תרופות";
    public const string Review = "ביקורת";           // ביקורת חוזרת/מעקב אצל רופא ספציפי

    public static readonly IReadOnlyList<string> All =
        new[] { Emergency, Pediatrics, Orthopedics, Womens, Infusion, Review };

    // ── Queue letters ─────────────────────────────────────────────────────────
    // Each department runs its own numbered queue, identified by a letter (A,B,C,…),
    // plus a separate "S" (special/priority) queue. Mirrored on the client in
    // constants/departments.ts — keep in sync.
    public const string SpecialQueueLetter = "S";

    private static readonly IReadOnlyDictionary<string, string> Letters = new Dictionary<string, string>
    {
        [Emergency] = "A",
        [Pediatrics] = "B",
        [Orthopedics] = "C",
        [Womens] = "D",
        [Infusion] = "E",
        [Review] = "F",
    };

    /// <summary>The queue letter for a department. Unknown/empty → "A" (Emergency) as a
    /// safe default; in practice the department is always one of the closed list.</summary>
    public static string LetterFor(string? department) =>
        department is not null && Letters.TryGetValue(department, out var l) ? l : "A";
}

/// <summary>Extra context the router may use to narrow departments (age gate, gender, …).</summary>
public record RoutingContext(int? Age = null, string? Gender = null);

/// <summary>A classifier's verdict: one department (confident) or several (low confidence).</summary>
public record DepartmentClassification(IReadOnlyList<string> Departments, double Confidence);

/// <summary>
/// AI department-classifier seam. Implemented in the API layer (LLM-backed). MUST return null
/// when unavailable/disabled (so routing falls back deterministically) and never throw.
/// </summary>
public interface IDepartmentClassifier
{
    Task<DepartmentClassification?> ClassifyAsync(
        string admissionReason, IReadOnlyList<string> candidates, RoutingContext ctx,
        CancellationToken ct = default);
}

/// <summary>
/// The router's decision. By policy the routing ALWAYS commits to exactly ONE department
/// (low confidence is broken deterministically, not deferred to reception). <see cref="Departments"/>
/// therefore always holds a single item; <see cref="Source"/> says how it was decided
/// ("rule" = deterministic policy, "ai" = LLM, "fallback" = AI unavailable).
/// </summary>
public record DepartmentRoutingResult(IReadOnlyList<string> Departments, double Confidence, string Source)
{
    public bool IsConfident => Departments.Count == 1;
    public string? Assigned => Departments.Count >= 1 ? Departments[0] : null;
}

/// <summary>
/// Decides the department for a visit from its admission reason. Pipeline:
///   (1) algorithmic pre-filter — hard deterministic candidate narrowing (age gates, rules 4+5);
///   (2) deterministic policy override — pregnancy/gestational-week ⇒ "נשים" (rule 6);
///   (3) AI classifier — returns a ranked list, which is ALWAYS collapsed to a single department
///       (confident ⇒ top pick; ambiguous ⇒ broken by a fixed priority order, rule 3);
///   (4) deterministic fallback — one department when the AI is disabled/unavailable/errors.
///
/// By policy the result is ALWAYS exactly one department — reception never picks (the field is
/// read-only); a clinician finalizes the department during treatment. Internet in the critical
/// path is permitted (on-prem dropped 2026-06-19).
/// </summary>
public class DepartmentRoutingService(IDepartmentClassifier classifier)
{
    // Tunable later (settings/config). At/above this AI confidence we take the top pick; below it
    // the ambiguity is broken deterministically by AmbiguityPriority rather than deferred to reception.
    private const double ConfidenceThreshold = 0.70;

    // Rule 3 — when departments are ambiguous, prefer in this order. Only these three genuinely
    // conflict; the rest are decided deterministically (age ⇒ ילדים, keyword ⇒ ביקורת/נשים).
    private static readonly IReadOnlyList<string> AmbiguityPriority =
        new[] { Departments.Womens, Departments.Emergency, Departments.Orthopedics };

    // Rule 6 — pregnancy / "שבוע <n>" (gestational week). Rule 1 fallback — "ביקורת" or the
    // follow-up doctor "מתי" as a standalone word ("מתי" also means "when", so require a word boundary).
    private static readonly Regex PregnancyRx = new(@"הריון|היריון|שבוע\s*\d+", RegexOptions.Compiled);
    private static readonly Regex ReviewRx = new(@"ביקורת|(?<!\p{L})מתי(?!\p{L})", RegexOptions.Compiled);

    public async Task<DepartmentRoutingResult> RouteAsync(
        string? admissionReason, RoutingContext ctx, CancellationToken ct = default)
    {
        var candidates = PreFilter(ctx);

        // (2) Hard policy override (rule 6): pregnancy + not explicitly male ⇒ women's. Guaranteed
        // regardless of the AI (and saves a call). The AI prompt reinforces the same for robustness.
        if (PregnancyRx.IsMatch(admissionReason ?? "") && !IsMale(ctx.Gender))
            return new DepartmentRoutingResult(new[] { Departments.Womens }, 1.0, "rule");

        // (3) AI classifier — ranked list, always collapsed to ONE.
        if (!string.IsNullOrWhiteSpace(admissionReason))
        {
            try
            {
                var c = await classifier.ClassifyAsync(admissionReason!, candidates, ctx, ct);
                if (c is { Departments.Count: > 0 })
                {
                    var picked = c.Departments.Where(candidates.Contains).ToList();
                    if (picked.Count == 0) picked = c.Departments.ToList();
                    var one = c.Confidence >= ConfidenceThreshold ? picked[0] : CollapseAmbiguous(picked);
                    return new DepartmentRoutingResult(new[] { one }, c.Confidence, "ai");
                }
            }
            catch
            {
                // The AI must never break the reception flow — fall through to the fallback.
            }
        }

        // (4) Fallback (AI disabled / unconfigured / errored): pick ONE deterministically.
        return new DepartmentRoutingResult(new[] { FallbackDepartment(admissionReason, ctx) }, 0.0, "fallback");
    }

    /// <summary>
    /// Hard, deterministic candidate narrowing applied BEFORE the AI:
    ///   • a known adult (age &gt; 17) is never routed to "ילדים";
    ///   • age &gt; 70 (rule 4) or ≤ 2 (rule 5) is never routed to "אורטופדיה" — an orthopedic-looking
    ///     complaint then falls to "רפואה דחופה" (urgent) for the elderly, or "ילדים" for an infant.
    /// </summary>
    private static IReadOnlyList<string> PreFilter(RoutingContext ctx)
    {
        var set = Departments.All.ToList();
        if (ctx.Age is > 17) set.Remove(Departments.Pediatrics);
        if (ctx.Age is > 70 or <= 2) set.Remove(Departments.Orthopedics);
        return set.Count > 0 ? set : Departments.All;
    }

    /// <summary>Break an ambiguous (low-confidence) candidate set. Only נשים/רפואה דחופה/אורטופדיה
    /// genuinely conflict, so a deliberate non-conflicting top pick (ביקורת/ילדים/עירוי) is respected
    /// as-is; otherwise the three conflicting departments are reordered by the fixed priority (rule 3).</summary>
    private static string CollapseAmbiguous(IReadOnlyList<string> picked)
    {
        if (!AmbiguityPriority.Contains(picked[0])) return picked[0];
        foreach (var dept in AmbiguityPriority)
            if (picked.Contains(dept)) return dept;
        return picked[0];
    }

    /// <summary>The single department to use when the AI is unavailable: an explicit follow-up
    /// ("ביקורת"/"מתי") wins, then pregnancy ⇒ women's, then a child ⇒ pediatrics, else the safe
    /// default "רפואה דחופה". (Orthopedics is never auto-assigned without the AI.)</summary>
    private static string FallbackDepartment(string? reason, RoutingContext ctx)
    {
        var text = reason ?? "";
        if (ReviewRx.IsMatch(text)) return Departments.Review;
        if (PregnancyRx.IsMatch(text) && !IsMale(ctx.Gender)) return Departments.Womens;
        if (ctx.Age is <= 17) return Departments.Pediatrics;
        return Departments.Emergency;
    }

    /// <summary>Whether the gender value denotes male — reception uses "ז", admin uses "זכר".</summary>
    private static bool IsMale(string? gender)
    {
        var g = gender?.Trim();
        return g is "ז" or "זכר"
            || string.Equals(g, "male", StringComparison.OrdinalIgnoreCase)
            || string.Equals(g, "m", StringComparison.OrdinalIgnoreCase);
    }
}
