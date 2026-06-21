// ED-charge pricing table — client mirror of the server's PricingService.cs (keep in sync).
// Used for LIVE display of "סה״כ לגבייה" in reception; the SERVER value (on visit create)
// remains authoritative. Source: client-supplied payment table (2026-06-19).

// The exemption-list option that selects the "with doctor referral" price column.
export const REFERRAL_REASON = 'בהפניית רופא';

// Charge per health fund: [withReferral, selfArrival] in ₪.
const BY_FUND: Record<string, [number, number]> = {
  'כללית': [0, 108],
  'לאומית': [0, 108],
  'מכבי': [0, 108],
  'מאוחדת': [380, 380],
  'הראל': [0, 0],
  'AIM': [0, 0],
};

// No health-fund arrangement ("ללא" / unknown) — flat fee.
const NO_ARRANGEMENT: [number, number] = [480, 480];

/**
 * Computes the ED charge. A manager-approved discount, or any full-exemption reason (every
 * exemption-list option EXCEPT the referral modifier), zeroes the charge. "בהפניית רופא"
 * selects the referral column; otherwise the self-arrival column applies.
 */
export function computeCharge(
  healthFund: string | undefined,
  exemptionReason: string | undefined,
  discountApproved: boolean,
): number {
  if (discountApproved) return 0;
  const reason = (exemptionReason ?? '').trim();
  const isReferral = reason === REFERRAL_REASON;
  if (reason && !isReferral) return 0; // full exemption
  const [referral, self] = BY_FUND[(healthFund ?? '').trim()] ?? NO_ARRANGEMENT;
  return isReferral ? referral : self;
}
