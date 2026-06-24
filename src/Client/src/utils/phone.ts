// ─── Phone display + validation ───────────────────────────────────────────────
// Display convention: Israeli numbers as "3 digits, dash, remainder" (e.g.
// "0501234567" → "050-1234567"). A number typed with a leading "+" is treated as
// international and kept as "+<digits>" (no dash reformatting), so the country-code
// form survives. Validation accepts Israeli mobile (05x, 10 digits), Israeli
// landline (0[2-9], 9 digits), and international (+ and ≥7 digits).

export function digitsOnly(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** True if the value is meant as an international number (leading "+"). */
function isIntl(v: string): boolean {
  return (v ?? '').trim().startsWith('+');
}

/** Format for display. International ("+…") keeps "+<digits>"; otherwise
 * "3 digits, dash, remainder". Caps at 15 digits. */
export function formatPhone(v: string): string {
  const d = digitsOnly(v).slice(0, 15);
  if (isIntl(v)) return '+' + d;
  return d.length <= 3 ? d : `${d.slice(0, 3)}-${d.slice(3)}`;
}

/**
 * Validation error (or null). `required` numbers must be present. A non-empty
 * number must match one of: Israeli mobile `05x-xxxxxxx` (10 digits), Israeli
 * landline `0x-xxxxxxx` (9 digits, x≠5… any 2-9), or international `+` with ≥7 digits.
 */
export function phoneValidationError(v: string, required: boolean): string | null {
  const d = digitsOnly(v);
  if (!d) return required ? 'שדה חובה' : null;
  if (isIntl(v)) {
    return /^\d{7,}$/.test(d) ? null : 'מספר בינלאומי אינו תקין';
  }
  if (/^05\d{8}$/.test(d)) return null;      // Israeli mobile: 05x + 7 → 10 digits
  if (/^0[2-9]\d{7}$/.test(d)) return null;  // Israeli landline: 0[2-9] + 7 → 9 digits
  return 'מספר טלפון אינו תקין (לדוגמה: 050-1234567, 02-1234567, או +972…)';
}
