import type { CareStepStatus } from '../types';

// Client mirror of the server's CareStepCatalog (CareStepService.cs) — keep in sync.

export const DOCTOR_LABEL = 'רופא';
export const NURSE_LABEL = 'אחות';

// Stations a clinician can refer a patient to during treatment (and that pregnant women's intake
// pre-assigns: אולטרסאונד + בדיקות מעבדה, plus מוניטור עוברי from gestational week 28).
export const STATIONS = ['אולטרסאונד', 'א.ק.ג', 'בדיקות מעבדה', 'צילום רנטגן', 'מוניטור עוברי'] as const;

// A referral back to a (regular) nurse in the SAME department (e.g. a doctor returning the patient to a
// nurse) — adds a "waiting for a nurse" step WITHOUT moving the patient. Mirror of CareStepCatalog.GeneralNurse.
export const GENERAL_NURSE_REFERRAL = 'אחות כללית';

// Department-stations: referral targets that MOVE the patient to that department (mirror of the server
// CareStepCatalog.DepartmentStations). One "רופא X" per department that has a doctor, plus "אחות עירוי"
// → the infusion department (nurse-only, no doctor). Selecting one reassigns the visit's department.
export const DEPARTMENT_STATIONS: Record<string, string> = {
  'רופא רפואה דחופה': 'רפואה דחופה',
  'רופא ילדים': 'ילדים',
  'רופא אורטופדיה': 'אורטופדיה',
  'רופא נשים': 'נשים',
  'רופא ביקורת': 'ביקורת',
  'אחות עירוי': 'עירוי תרופות',
};

// The referral picker, grouped by kind (mirrors the three server-side referral kinds): regular
// stations, the same-department nurse referral, and department-moves.
export const REFERRAL_GROUPS = [
  { group: 'תחנות', items: [...STATIONS] },
  { group: 'צוות (אותה מחלקה)', items: [GENERAL_NURSE_REFERRAL] },
  { group: 'העברת מחלקה', items: Object.keys(DEPARTMENT_STATIONS) },
];

// Flat list of every valid referral option (stations + general-nurse + department-moves).
export const REFERRAL_OPTIONS: string[] = REFERRAL_GROUPS.flatMap((g) => g.items);

// Per-step status labels + colors (same muted palette as visitStatus.ts).
export const STEP_STATUS_LABEL: Record<CareStepStatus, string> = {
  Waiting: 'ממתין',
  Called: 'נקרא',
  InProgress: 'בטיפול',
  Done: 'הושלם',
  Canceled: 'בוטל',
};

export const STEP_STATUS_COLOR: Record<CareStepStatus, string> = {
  Waiting: 'steel',
  Called: 'ochre',
  InProgress: 'moss',
  Done: 'pine',
  Canceled: 'slate',
};

// Verb prefix for a step line, by status + category. Clinician: "ממתין ל… / נקרא ל… / אצל…".
// Station: "ממתין ל… / בבדיקת…".
export function stepPrefix(status: CareStepStatus, category: 'Clinician' | 'Station'): string {
  switch (status) {
    case 'Waiting':
      return 'ממתין ל';
    case 'Called':
      return 'נקרא ל';
    case 'InProgress':
      return category === 'Station' ? 'בבדיקת ' : 'אצל ';
    case 'Done':
      return 'הושלם: ';
    case 'Canceled':
      return 'בוטל: ';
  }
}
