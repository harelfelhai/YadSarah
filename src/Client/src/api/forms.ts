import { api } from './client';
import type { MedicalForm, StationType, FormType } from '../types';

export const formsApi = {
  getByVisit: (visitId: string) =>
    api.get<MedicalForm[]>(`/visits/${visitId}/forms`),

  getById: (id: string) => api.get<MedicalForm>(`/forms/${id}`),

  create: (visitId: string, stationType: StationType, formType: FormType) =>
    api.post<MedicalForm>(`/visits/${visitId}/forms`, { stationType, formType }),

  updateSection: (id: string, section: string, data: unknown, version: number) =>
    api.patch<MedicalForm>(`/forms/${id}/sections/${section}`, { data, version }),

  acquireLock: (id: string, section: string) =>
    api.post<{ acquired: boolean; lockedBy?: string }>(`/forms/${id}/locks/${section}`, {}),

  releaseLock: (id: string, section: string) =>
    api.delete<void>(`/forms/${id}/locks/${section}`),

  export: (id: string) =>
    fetch(`/api/forms/${id}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
    }),
};
