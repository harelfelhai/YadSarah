import { api } from './client';
import type { Workstation } from '../types';

export const workstationApi = {
  // The room this computer is mapped to (null if the device is new).
  getMyRoom: (deviceId: string) =>
    api.get<{ room: string | null }>(`/workstation/me?deviceId=${encodeURIComponent(deviceId)}`),

  // Existing room names — suggested on first connect.
  getRooms: () => api.get<string[]>('/workstation/rooms'),

  // First-connect (or re-)assignment of this computer's room.
  setRoom: (deviceId: string, room: string) =>
    api.post<{ room: string }>('/workstation', { deviceId, room }),

  // Admin management.
  list: () => api.get<Workstation[]>('/workstation'),
  update: (id: string, room: string) => api.put<Workstation>(`/workstation/${id}`, { room }),
};
