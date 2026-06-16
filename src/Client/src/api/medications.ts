import { api } from './client';

export interface Medication {
  id: string;
  registrationNumber: string;
  hebrewName: string;
  englishName?: string | null;
}

export interface MedicationStatus {
  count: number;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  intervalDays: number;
}

export interface MedicationSyncResponse {
  count: number;
  message: string;
}

export const medicationsApi = {
  search: (q: string, take = 20) =>
    api.get<Medication[]>(`/medications?q=${encodeURIComponent(q)}&take=${take}`),

  getStatus: () => api.get<MedicationStatus>('/medications/status'),

  sync: () => api.post<MedicationSyncResponse>('/medications/sync', {}),

  // Multipart upload — must NOT set Content-Type (browser sets the boundary).
  importFile: async (file: File): Promise<MedicationSyncResponse> => {
    const token = localStorage.getItem('auth_token') ?? '';
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/medications/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text ? JSON.parse(text) : { count: 0, message: '' };
  },
};
