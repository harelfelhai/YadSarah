import { api } from './client';

export interface Diagnosis {
  id: string;
  code: string;
  // English (ICD-10-CM) is the primary name; Hebrew is optional (legacy / hospital file).
  hebrewName?: string | null;
  englishName?: string | null;
}

export interface DiagnosisStatus {
  count: number;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
}

export interface DiagnosisImportResponse {
  count: number;
  message: string;
}

export const diagnosesApi = {
  search: (q: string, take = 20) =>
    api.get<Diagnosis[]>(`/diagnoses?q=${encodeURIComponent(q)}&take=${take}`),

  // The signed-in doctor's most-frequently-used diagnoses (already in "name — code"
  // label form). Shown on focus, before any search.
  frequent: (take = 10) =>
    api.get<string[]>(`/diagnoses/frequent?take=${take}`),

  getStatus: () => api.get<DiagnosisStatus>('/diagnoses/status'),

  // Multipart upload — must NOT set Content-Type (browser sets the boundary).
  importFile: async (file: File): Promise<DiagnosisImportResponse> => {
    const token = localStorage.getItem('auth_token') ?? '';
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/diagnoses/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text ? JSON.parse(text) : { count: 0, message: '' };
  },
};
