import { api } from './client';
import type { Visit, VisitCreate, VisitStatus } from '../types';

export const visitsApi = {
  getQueue: () => api.get<Visit[]>('/visits/queue'),

  getById: (id: string) => api.get<Visit>(`/visits/${id}`),

  create: (data: VisitCreate) => api.post<Visit>('/visits', data),

  updateStatus: (id: string, status: VisitStatus) =>
    api.patch<Visit>(`/visits/${id}/status`, { status }),

  update: (id: string, data: Partial<VisitCreate>) =>
    api.put<Visit>(`/visits/${id}`, data),
};
