import { HDate, gematriyaStrToNum } from '@hebcal/hdate';

// Explicit Hebrew month-name → number map (matching @hebcal numbering:
// Nisan=1 … Adar=12, Adar II=13). We do NOT use HDate.monthFromName for detection
// because it fuzzy-matches arbitrary letters (e.g. "כח" → 9), which would mistake a
// day token for a month. Includes common spelling variants (ו / וו).
const HEB_MONTHS: Record<string, number> = {
  ניסן: 1, אייר: 2, סיון: 3, סיוון: 3, תמוז: 4, אב: 5, אלול: 6,
  תשרי: 7, חשון: 8, חשוון: 8, מרחשון: 8, מרחשוון: 8, כסלו: 9, כסליו: 9,
  טבת: 10, שבט: 11, אדר: 12, אדרא: 12, אדרב: 13,
};

// ─── Flexible birth-date parsing (Gregorian typed OR Hebrew typed) ─────────────
//
// The reception birth-date field lets the clerk TYPE the date. We accept the common
// Gregorian formats AND a Hebrew date (e.g. "כ״ח בסיון תשפ״ו" / "28 בסיון 5786"),
// converting Hebrew → Gregorian offline via @hebcal/hdate. The form always stores an
// ISO `YYYY-MM-DD` string (what the server binds to DateOnly).

export interface ParsedDate {
  iso: string;       // YYYY-MM-DD (Gregorian) — the value stored on the form
  hebrew: string;    // Hebrew rendering, for the live confirmation preview
}

const HEB_LETTER = /[א-ת]/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hebrew rendering of a Gregorian date (gematriya), e.g. "כ״ח סיון תשפ״ו". */
export function hebrewOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  try {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new HDate(d).renderGematriya(true);
  } catch {
    return '';
  }
}

/** ISO `YYYY-MM-DD` → display `DD/MM/YYYY` (Israeli order). */
export function isoToDisplay(iso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '');
}

function validGregorian(y: number, mo: number, d: number): Date | null {
  if (y < 1850 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Reject overflow (e.g. 31/02 → 03/03).
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function parseGregorian(input: string): Date | null {
  // Accept dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy and native yyyy-mm-dd.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  if (iso) return validGregorian(+iso[1], +iso[2], +iso[3]);
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(input);
  if (dmy) return validGregorian(+dmy[3], +dmy[2], +dmy[1]);
  return null;
}

/** A token → number: plain digits, or Hebrew-letter gematriya. */
function tokenToNum(tok: string): number | null {
  if (/^\d+$/.test(tok)) return Number(tok);
  if (HEB_LETTER.test(tok)) {
    const n = gematriyaStrToNum(tok);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function parseHebrew(input: string): Date | null {
  // Split into words; identify the month word (optionally with a "ב"/"ה" prefix)
  // against the explicit month map, then read the day (word before) and year (after).
  const words = input.replace(/[״׳"']/g, '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let monthIdx = -1;
  let monthNum = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = words[i].replace(/^[בה]/, ''); // strip "בסיון" → "סיון"
    const m = HEB_MONTHS[candidate] ?? HEB_MONTHS[words[i]];
    if (m) { monthIdx = i; monthNum = m; break; }
  }
  if (monthIdx < 0) return null;

  const dayTok = words[monthIdx - 1];
  const yearTok = words[monthIdx + 1];
  if (!dayTok || !yearTok) return null;

  const day = tokenToNum(dayTok);
  // Strip a leading "ה" thousands-marker from the year ("ה׳תשפ״ו" → "תשפו" → 786).
  let year = tokenToNum(/[א-ת]/.test(yearTok) ? yearTok.replace(/^ה/, '') : yearTok);
  if (day === null || year === null) return null;
  if (year < 1000) year += 5000; // "תשפ״ו" → 786 → 5786

  try {
    return new HDate(day, monthNum, year).greg();
  } catch {
    return null;
  }
}

/**
 * Parse a typed date (Gregorian or Hebrew) into ISO + Hebrew rendering.
 * Returns null when the input can't be resolved to a valid date.
 */
export function parseFlexibleDate(input: string): ParsedDate | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const greg = parseGregorian(trimmed) ?? (HEB_LETTER.test(trimmed) ? parseHebrew(trimmed) : null);
  if (!greg) return null;

  const iso = toIso(greg);
  return { iso, hebrew: hebrewOf(iso) };
}
