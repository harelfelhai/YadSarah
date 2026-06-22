import type { CareStepStatus } from '../types';

// Client mirror of the server's CareStepCatalog (CareStepService.cs) — keep in sync.

export const DOCTOR_LABEL = 'רופא';
export const NURSE_LABEL = 'אחות';

// Stations a clinician can refer a patient to during treatment (and that pregnant women's intake
// pre-assigns: US + מעבדה, plus מוניטור from gestational week 28).
export const STATIONS = ['US', 'בדיקת דם', 'מעבדה', 'צילום', 'CT', 'אקג', 'מוניטור', 'ייעוץ'] as const;

// Department-stations: referral targets that MOVE the patient to that department (mirror of the server
// CareStepCatalog.DepartmentStations). Selecting one reassigns the visit's department automatically.
// PLACEHOLDER mapping — the full list is pending. Keep in sync with the server.
export const DEPARTMENT_STATIONS: Record<string, string> = {
  'רופא ילדים': 'ילדים',
  'רופא נשים': 'נשים',
};

// Everything shown in the referral picker — regular stations + department-stations.
export const REFERRAL_OPTIONS: string[] = [...STATIONS, ...Object.keys(DEPARTMENT_STATIONS)];

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
