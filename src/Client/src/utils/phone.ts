// ─── Phone display + validation ───────────────────────────────────────────────
// Display convention (per spec): the first 3 digits, then a dash, then the rest —
// e.g. "0501234567" → "050-1234567". Validation accepts Israeli and foreign numbers:
// at least 9 digits (ignoring separators).

export function digitsOnly(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Format for display: 3 digits, dash, remainder. Caps at 15 digits. */
export function formatPhone(v: string): string {
  const d = digitsOnly(v).slice(0, 15);
  return d.length <= 3 ? d : `${d.slice(0, 3)}-${d.slice(3)}`;
}

/**
 * Validation error (or null). `required` numbers must be present; any non-empty
 * number must have ≥9 digits.
 */
export function phoneValidationError(v: string, required: boolean): string | null {
  const d = digitsOnly(v);
  if (!d) return required ? 'שדה חובה' : null;
  if (d.length < 9) return 'מספר טלפון חייב לכלול לפחות 9 ספרות';
  return null;
}
