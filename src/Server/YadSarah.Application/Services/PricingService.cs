namespace YadSarah.Application.Services;

/// <summary>
/// Server-authoritative ED charge for a visit — the client cannot set
/// <see cref="Domain.Entities.Visit.TotalToCollect"/>; the controller calls this and stamps it.
/// The client mirrors this exact logic for live display (constants/pricing.ts) — keep in sync.
///
/// Rules (client-supplied pricing table, 2026-06-19):
///   • Charge = ByFund[healthFund] keyed on arrival mode (with-referral vs self-arrival).
///   • Arrival mode is "with referral" iff the exemption reason is <see cref="ReferralReason"/>.
///   • Any OTHER (non-empty) exemption reason is a FULL exemption ⇒ 0.
///   • A manager-approved discount/exemption ⇒ 0.
/// </summary>
public class PricingService
{
    /// <summary>The exemption-list option that selects the "with doctor referral" price column.</summary>
    public const string ReferralReason = "בהפניית רופא";

    // ED charge per health fund: (with referral, self-arrival), in ₪.
    private static readonly Dictionary<string, (decimal Referral, decimal Self)> ByFund = new()
    {
        ["כללית"] = (0m, 108m),
        ["לאומית"] = (0m, 108m),
        ["מכבי"] = (0m, 108m),
        ["מאוחדת"] = (380m, 380m),
        ["הראל"] = (0m, 0m),
        ["AIM"] = (0m, 0m),
    };

    // No health-fund arrangement ("ללא" / unknown fund) — flat fee.
    private static readonly (decimal Referral, decimal Self) NoArrangement = (480m, 480m);

    public Task<decimal> CalculateAsync(
        string? healthFund, string? exemptionReason, bool hasApprovedDiscount, CancellationToken ct = default)
        => Task.FromResult(Calculate(healthFund, exemptionReason, hasApprovedDiscount));

    public static decimal Calculate(string? healthFund, string? exemptionReason, bool hasApprovedDiscount)
    {
        if (hasApprovedDiscount) return 0m;

        var reason = exemptionReason?.Trim();
        var isReferral = reason == ReferralReason;
        // Any exemption reason other than the referral modifier is a full exemption.
        if (!string.IsNullOrEmpty(reason) && !isReferral) return 0m;

        var (referral, self) = ByFund.TryGetValue(healthFund?.Trim() ?? "", out var p) ? p : NoArrangement;
        return isReferral ? referral : self;
    }
}
