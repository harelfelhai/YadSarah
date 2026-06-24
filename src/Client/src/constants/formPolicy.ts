import type { UserRole } from '../types';

// ⚠ Mirror of the server-side FormSectionPolicy (FormSectionPolicy.cs). Keep these two in sync.

// Sections a NURSE / nursing-student may edit — exactly these seven.
const NURSE_EDITABLE = new Set<string>([
  'chiefComplaintNurse', 'allergies', 'vitalSigns', 'treatments',
  'administrationOrders', 'orderedUnits', 'diagnoses',
]);

// Sections only the nurse track (and managers) may edit — the doctor/medstudent must NOT
// overwrite them. Currently just the nurse's own reason-for-referral.
const NURSE_ONLY = new Set<string>(['chiefComplaintNurse']);

function canEditSingle(role: UserRole, section: string): boolean {
  switch (role) {
    // Managers may edit any section.
    case 'ShiftManager':
    case 'Admin':
      return true;
    // Doctors and medical students may edit any section EXCEPT the nurse-only ones.
    case 'Doctor':
    case 'MedStudent':
      return !NURSE_ONLY.has(section);
    // Nurses and nursing students are limited to the nurse-editable sections.
    case 'Nurse':
    case 'NursingStudent':
      return NURSE_EDITABLE.has(section);
    default:
      return false;
  }
}

// A user may edit a section if ANY of their roles permits it (permissions = union).
export function canEditSection(roles: UserRole[] | undefined, section: string): boolean {
  return !!roles && roles.some((r) => canEditSingle(r, section));
}

// Returns true if, given the form's signed state, this user may currently edit.
// (Shift manager / admin keep a grace window after signing.)
export function canEditSignedForm(
  roles: UserRole[] | undefined,
  isSigned: boolean,
  signedAt: string | undefined,
  windowMinutes: number,
): boolean {
  if (!isSigned) return true;
  if (!roles || !roles.some((r) => r === 'ShiftManager' || r === 'Admin')) return false;
  if (!signedAt) return false;
  const deadline = new Date(signedAt).getTime() + windowMinutes * 60_000;
  return Date.now() <= deadline;
}

// Extract a human message from an API error thrown by the client (body may be JSON).
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  try {
    const parsed = JSON.parse(e.message);
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    /* not JSON */
  }
  return e.message || fallback;
}
