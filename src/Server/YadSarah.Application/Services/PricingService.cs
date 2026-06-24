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

    /// <summary>Closed list of accepted exemption reasons — server mirror of the client
    /// <c>EXEMPTION_REASONS</c> (constants/exemptionReasons.ts). KEEP IN SYNC byte-for-byte: the stored
    /// value IS this label and the off-list check below compares against it. These are statutory
    /// full-exemption cases reception applies from documentation/clinical presentation; any value NOT in
    /// this set is rejected (400) so free text can no longer silently zero the ED charge.</summary>
    public static readonly IReadOnlySet<string> KnownExemptionReasons = new HashSet<string>
    {
        ReferralReason,
        "מכתב רפואי / טופס 17 — ולא אושפז",
        "אושפז (גם ללא מכתב רפואי / טופס 17)",
        "נפגע עבודה — אישור מעסיק (טופס 250)",
        "נפגע תאונת דרכים — אישור משטרה",
        "תלמיד שנפגע בבית הספר / טיול — עם אישור",
        "הופנה ע\"י פסיכיאטר מחוזי / צו בית משפט (חוק טיפול בחולי נפש)",
        "פנייה / הפניה למרכז בריאות הנפש או בי\"ח פסיכיאטרי",
        "פינוי באמבולנס מד\"א מהרחוב / מקום ציבורי — אירוע פתאומי",
        "תינוק עד גיל חודשיים — חום גבוה (מעל 38.5°)",
        "חולה דיאליזה",
        "נפגע אלימות במשפחה / תקיפה מינית (פנייה מוצדקת)",
        "שבר חדש",
        "פריקה חריפה של כתף / מרפק",
        "פציעה הדורשת תפירה / איחוי",
        "שאיפת גוף זר לדרכי הנשימה",
        "חדירת גוף זר לעין",
        "טיפול במחלת סרטן",
        "טיפול בהמופיליה",
        "טיפול בסיסטיק פיברוזיס (CF)",
        "אישה עם צירי לידה",
        "הכשת נחש",
        "עקיצת עקרב",
        "תגובה אלרגית מסכנת חיים",
        "חבלת ראש — עד גיל שנתיים",
        "חבלת ראש — מעל גיל 70",
        "התקף אפילפטי בחולה אפילפטי ידוע",
        "פריקת לסת",
        "כוויה מדרגה 3",
        "היריון — מבוטחי כללית / מכבי בלבד",
    };

    /// <summary>True when the value is empty (no exemption) or one of the accepted closed-list reasons.
    /// The trim mirrors how <see cref="Calculate"/> reads the reason.</summary>
    public static bool IsAcceptedExemption(string? exemptionReason)
    {
        var reason = exemptionReason?.Trim();
        return string.IsNullOrEmpty(reason) || KnownExemptionReasons.Contains(reason);
    }

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
