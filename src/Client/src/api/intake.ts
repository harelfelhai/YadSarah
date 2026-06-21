import { api } from './client';
import type { IdentityType } from '../types';

// ─── Public self-service intake (patient-filled, no login) ─────────────────────

// Payload the patient submits from the public page. Mirrors PublicIntakeRequest on the
// server — patient fields only (NO department/routing, NO staff flags).
export interface IntakeSubmitPayload {
  identityType: IdentityType;
  identityNumber?: string;
  firstName: string;
  lastName: string;
  fatherName?: string;
  gender?: string;
  birthDate?: string;            // ISO YYYY-MM-DD
  city?: string;
  street?: string;
  houseNumber?: string;
  phoneMobile?: string;
  phoneHome?: string;
  email?: string;
  digitalContactPerson?: string;
  digitalContactRelation?: string;
  digitalContactPhone?: string;
  acceptsDigitalInfo: boolean;
  healthFund?: string;
  admissionReason?: string;
  notes?: string;
  deviceId?: string;
}

// The stored submission as returned to reception for review.
export interface IntakeSubmission extends Omit<IntakeSubmitPayload, 'deviceId'> {
  id: string;
  status: 'Pending' | 'Imported' | 'Dismissed';
  submittedAt: string;
  deviceId?: string;
}

export interface IntakeFieldDiff {
  field: string;
  label: string;
  submitted?: string | null;
  existing?: string | null;
  isConflict: boolean;
}

export interface IntakeReview {
  submission: IntakeSubmission;
  existingPatientId?: string | null;
  existingPatientMatched: boolean;
  hasConflicts: boolean;
  diffs: IntakeFieldDiff[];
}

// A stable per-browser token, the basis of the "max 3 per device" submit cap. Bypassable by
// clearing storage (the per-IP rate-limit is the backstop), but matches "same device" intent.
const DEVICE_KEY = 'intake_device_id';
export function getIntakeDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export const intakeApi = {
  // Public (anonymous) — submit a patient-filled form.
  submit: (payload: IntakeSubmitPayload) =>
    api.post<{ id: string }>('/public-intake', { ...payload, deviceId: getIntakeDeviceId() }),

  // Reception-side review (authenticated).
  listPending: () => api.get<IntakeReview[]>('/intake-submissions'),
  get: (id: string) => api.get<IntakeReview>(`/intake-submissions/${id}`),
  dismiss: (id: string) => api.post<void>(`/intake-submissions/${id}/dismiss`, {}),
  markImported: (id: string) => api.post<void>(`/intake-submissions/${id}/imported`, {}),
};
