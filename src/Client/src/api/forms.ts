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

  // Signing requires step-up re-authentication (the doctor's own username + password).
  sign: (id: string, username: string, password: string) =>
    api.post<MedicalForm>(`/forms/${id}/sign`, { username, password }),

  addAddendum: (id: string, text: string) =>
    api.post<MedicalForm>(`/forms/${id}/addenda`, { text }),

  signAddendum: (id: string, addendumId: string, username: string, password: string) =>
    api.post<MedicalForm>(`/forms/${id}/addenda/${addendumId}/sign`, { username, password }),

  acquireLock: (id: string, section: string) =>
    api.post<{ acquired: boolean; lockedBy?: string }>(`/forms/${id}/locks/${section}`, {}),

  releaseLock: (id: string, section: string) =>
    api.delete<void>(`/forms/${id}/locks/${section}`),

  export: async (id: string) => {
    const token = localStorage.getItem('auth_token') ?? '';
    const resp = await fetch(`/api/forms/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-export-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
