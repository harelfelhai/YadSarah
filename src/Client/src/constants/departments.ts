// Canonical department set for AI routing at reception (2026-06-19).
// Mirrors the server-side `Departments` (DepartmentRoutingService.cs) — keep in sync.
// "ילדים" covers ages up to 17 (the age gate is enforced server-side in routing).
export const DEPARTMENTS = [
  'רפואה דחופה',
  'ילדים',
  'אורטופדיה',
  'נשים',
  'עירוי תרופות',
  'ביקורת',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// The women's department — the only one that permits a dual (two-track) classification.
export const WOMENS_DEPARTMENT = 'נשים';

// ── Queue letters ─────────────────────────────────────────────────────────────
// Each department runs its own numbered queue, identified by a letter (A,B,C,…), plus a
// separate "S" (special / priority) queue. Mirrors the server-side `Departments.LetterFor`
// (DepartmentRoutingService.cs) — keep in sync.
export const SPECIAL_QUEUE_LETTER = 'S';

export const DEPARTMENT_LETTERS: Record<string, string> = {
  'רפואה דחופה': 'A',
  'ילדים': 'B',
  'אורטופדיה': 'C',
  'נשים': 'D',
  'עירוי תרופות': 'E',
  'ביקורת': 'F',
};

/** The displayed queue ticket: "C-7" (letter + per-department number), or just the
 *  number when no letter is set (legacy rows admitted before per-department numbering). */
export function queueLabel(letter: string | null | undefined, num: number | null | undefined): string {
  if (num == null) return '—';
  return letter ? `${letter}-${num}` : `${num}`;
}
