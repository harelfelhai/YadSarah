import { api } from './client';

export interface SystemSetting {
  key: string;
  value: string;
  description?: string;
  updatedAt: string;
  updatedByUserId?: string;
}

export const settingsApi = {
  getAll: () => api.get<SystemSetting[]>('/settings'),
  update: (key: string, value: string) =>
    api.put<SystemSetting>(`/settings/${key}`, { value }),
};
