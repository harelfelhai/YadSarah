import { api } from './client';

export interface AuditEntry {
  id: number;
  userId: string;
  userName: string;
  entityType: string;
  entityId: string;
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  timestamp: string;
  ipAddress?: string;
}

export const auditApi = {
  get: (params: { entityType?: string; take?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.entityType) q.set('entityType', params.entityType);
    q.set('take', String(params.take ?? 200));
    return api.get<AuditEntry[]>(`/audit?${q.toString()}`);
  },
};
