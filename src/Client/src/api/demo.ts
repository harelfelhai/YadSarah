import { api } from './client';

export interface DemoStatus {
  enabled: boolean;
  patients: number;
  visits: number;
  todayQueue: number;
  poolAvailable: number;
  medications: number;
  demoPassword: string | null;
}

export interface DemoCredential {
  username: string;
  password: string;
  role: string;
  fullName: string;
  department: string | null;
}

export interface SeedResult {
  users: number;
  patients: number;
  visits: number;
  poolPatients: number;
  credentials: DemoCredential[];
}

export const demoApi = {
  status: () => api.get<DemoStatus>('/demo/status'),
  seed: () => api.post<SeedResult>('/demo/seed', {}),
  fillQueue: (count = 50, replace = true) =>
    api.post<{ added: number }>(`/demo/fill-queue?count=${count}&replace=${replace}`, {}),
  clearToday: () => api.post<{ removed: number }>('/demo/clear-today', {}),
};
