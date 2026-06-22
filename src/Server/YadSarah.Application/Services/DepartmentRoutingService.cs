namespace YadSarah.Application.Services;

/// <summary>Canonical department set used for AI routing at reception (2026-06-19).</summary>
public static class Departments
{
    public const string Emergency = "רפואה דחופה";
    public const string Pediatrics = "ילדים";        // עד גיל 17
    public const string Orthopedics = "אורטופדיה";
    public const string Womens = "נשים";
    public const string Infusion = "עירוי תרופות";

    public static readonly IReadOnlyList<string> All =
        new[] { Emergency, Pediatrics, Orthopedics, Womens, Infusion };

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
/// The router's decision. One department ⇒ confident assignment; several ⇒ low confidence,
/// reception picks among the AI-narrowed candidates.
/// </summary>
public record DepartmentRoutingResult(IReadOnlyList<string> Departments, double Confidence, string Source)
{
    public bool IsConfident => Departments.Count == 1;
    public string? Assigned => Departments.Count == 1 ? Departments[0] : null;
}

/// <summary>
/// Decides the department for a visit from its admission reason. Pipeline:
///   (1) algorithmic pre-filter — hard deterministic rules (e.g. age gate);
///   (2) AI classifier — DECIDES (not just recommends); below a confidence threshold it
///       returns MORE THAN ONE option for reception to choose among;
///   (3) deterministic fallback — when the AI is disabled/unavailable/errors.
///
/// The AI rules/examples and most pre-filter narrowing are TODO seams to be filled from
/// client-supplied rules. Internet in the critical path is permitted (on-prem dropped 2026-06-19).
/// </summary>
public class DepartmentRoutingService(IDepartmentClassifier classifier)
{
    // Tunable later (settings/config). Below this confidence the AI's narrowed candidate set is
    // returned so reception chooses, rather than the system committing to a single department.
    private const double ConfidenceThreshold = 0.70;

    public async Task<DepartmentRoutingResult> RouteAsync(
        string? admissionReason, RoutingContext ctx, CancellationToken ct = default)
    {
        var candidates = PreFilter(admissionReason, ctx);

        if (!string.IsNullOrWhiteSpace(admissionReason))
        {
            try
            {
                var c = await classifier.ClassifyAsync(admissionReason!, candidates, ctx, ct);
                if (c is { Departments.Count: > 0 })
                {
                    var picked = c.Departments.Where(candidates.Contains).ToList();
                    if (picked.Count == 0) picked = c.Departments.ToList();
                    var final = c.Confidence >= ConfidenceThreshold ? picked.Take(1).ToList() : picked;
                    return new DepartmentRoutingResult(final, c.Confidence, "ai");
                }
            }
            catch
            {
                // The AI must never break the reception flow — fall through to the fallback.
            }
        }

        // Fallback (AI disabled / unconfigured / errored): offer the pre-filtered set for a
        // manual pick. Deterministic and offline-safe.
        return new DepartmentRoutingResult(candidates, 0.0, "fallback");
    }

    /// <summary>
    /// Hard, deterministic narrowing applied BEFORE the AI.
    /// TODO(pending): full rules from the client (keyword maps, gender gating for "נשים", …).
    /// The one concrete rule kept now: a known adult (age &gt; 17) is never routed to "ילדים".
    /// </summary>
    private static IReadOnlyList<string> PreFilter(string? admissionReason, RoutingContext ctx)
    {
        var set = Departments.All.ToList();
        if (ctx.Age is > 17) set.Remove(Departments.Pediatrics);
        return set.Count > 0 ? set : Departments.All;
    }
}
