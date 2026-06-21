// ─── Israeli ID (תעודת זהות) check-digit validation ───────────────────────────
// Standard Luhn-like checksum over the 9-digit, zero-padded number.

export function validateIsraeliId(id: string): boolean {
  const cleaned = id.replace(/\D/g, '');
  if (!cleaned || cleaned.length > 9) return false;
  const padded = cleaned.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(padded[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0;
}
