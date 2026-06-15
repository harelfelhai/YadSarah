import type { UserRole } from '../types';

// ⚠ Mirror of the server-side FormSectionPolicy (FormSectionPolicy.cs).
// Keep these two in sync. Final nurse mapping TBD by client.

const NURSE_EDITABLE = new Set<string>([
  'chiefComplaint', 'presentIllness', 'pastMedicalHistory',
  'allergies', 'vitalSigns', 'triage', 'treatments',
  'administrationOrders', 'routing',
]);

export function canEditSection(role: UserRole | undefined, section: string): boolean {
  switch (role) {
    case 'Doctor':
    case 'ShiftManager':
    case 'Admin':
      return true;
    case 'Nurse':
      return NURSE_EDITABLE.has(section);
    default:
      return false;
  }
}

// Returns true if, given the form's signed state, this user may currently edit.
// (Shift manager / admin keep a grace window after signing.)
export function canEditSignedForm(
  role: UserRole | undefined,
  isSigned: boolean,
  signedAt: string | undefined,
  windowMinutes: number,
): boolean {
  if (!isSigned) return true;
  if (role !== 'ShiftManager' && role !== 'Admin') return false;
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
