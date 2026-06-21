// Canonical department set for AI routing at reception (2026-06-19).
// Mirrors the server-side `Departments` (DepartmentRoutingService.cs) — keep in sync.
// "ילדים" covers ages up to 17 (the age gate is enforced server-side in routing).
export const DEPARTMENTS = [
  'רפואה דחופה',
  'ילדים',
  'אורטופדיה',
  'נשים',
  'עירוי תרופות',
] as const;

export type Department = (typeof DEPARTMENTS)[number];
