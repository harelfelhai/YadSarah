import { api } from './client';
import type { CareStep, CareStepAction, Visit, VisitCreate, VisitStatus } from '../types';
import { getOrCreateDeviceId } from '../utils/deviceId';

export interface VisitHistoryItem {
  visitId: string;
  patientId: string;
  patientName: string;
  identityNumber?: string | null;
  admissionDate: string;
  admissionTime?: string | null;
  queueNumber: number;
  queueLetter?: string | null;
  department?: string | null;
  status: VisitStatus;
  signedByName?: string | null;
  editors: string[];
  relatedTier: number; // 0 = treated by me, 1 = my department, 2 = other
}

export interface HistoryParams {
  q?: string;
  from?: string;
  to?: string;
  staff?: string;
  department?: string;
  status?: string;
  page?: number;
}

export interface HistoryResult {
  items: VisitHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const visitsApi = {
  getQueue: (all = false) => api.get<Visit[]>(`/visits/queue${all ? '?all=true' : ''}`),

  getById: (id: string) => api.get<Visit>(`/visits/${id}`),

  getByPatient: (patientId: string) =>
    api.get<Visit[]>(`/visits/by-patient/${patientId}`),

  history: (params: HistoryParams) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (params.staff) sp.set('staff', params.staff);
    if (params.department) sp.set('department', params.department);
    if (params.status) sp.set('status', params.status);
    if (params.page) sp.set('page', String(params.page));
    const qs = sp.toString();
    return api.get<HistoryResult>(`/visits/history${qs ? `?${qs}` : ''}`);
  },

  create: (data: VisitCreate) => api.post<Visit>('/visits', data),

  // deviceId is sent so the server can stamp the treating room when status → InTreatment.
  updateStatus: (id: string, status: VisitStatus) =>
    api.patch<Visit>(`/visits/${id}/status`, { status, deviceId: getOrCreateDeviceId() }),

  update: (id: string, data: Partial<VisitCreate>) =>
    api.put<Visit>(`/visits/${id}`, data),

  // Shift-manager / admin override: move a patient into the special ("S") priority queue.
  moveToSpecialQueue: (id: string) =>
    api.patch<Visit>(`/visits/${id}/special-queue`, {}),

  // ── Care steps (live multi-dimensional status) ────────────────────────────
  // Advance a step: call (page) / enter (admit) / complete. deviceId stamps the room.
  updateStep: (visitId: string, stepId: string, action: CareStepAction) =>
    api.patch<CareStep>(`/visits/${visitId}/steps/${stepId}`, { action, deviceId: getOrCreateDeviceId() }),

  // Refer the patient to one or more stations in a single action. Regular stations create
  // "waiting for [station]" steps; a department-station (e.g. "רופא נשים") moves the patient to that
  // department. Returns the created station steps.
  referToStations: (visitId: string, labels: string[], department?: string | null) =>
    api.post<CareStep[]>(`/visits/${visitId}/steps`, { labels, department: department ?? null }),

  // A non-doctor professional finished their part (clicked "סיים" or left the form): completes their
  // nurse clinician step without discharging. Doctors finish by signing the form instead.
  finishTreatment: (visitId: string) =>
    api.post<Visit>(`/visits/${visitId}/finish`, { deviceId: getOrCreateDeviceId() }),
};
