import { api } from './client';

export type ErrorSource = 'Client' | 'Server';
export type ErrorSeverity = 'Info' | 'Warning' | 'Error' | 'Fatal';
export type ErrorStatus = 'New' | 'Investigating' | 'Resolved' | 'Ignored';

export interface ErrorReport {
  id: number;
  source: ErrorSource;
  severity: ErrorSeverity;
  status: ErrorStatus;
  correlationId?: string | null;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  routeUrl?: string | null;
  userAgent?: string | null;
  userName?: string | null;
  userRole?: string | null;
  ipAddress?: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  adminNotes?: string | null;
  updatedAt?: string | null;
}

export interface ErrorReportPage {
  items: ErrorReport[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ErrorReportFilters {
  source?: ErrorSource | null;
  severity?: ErrorSeverity | null;
  status?: ErrorStatus | null;
  from?: string | null; // yyyy-mm-dd
  to?: string | null;
  page?: number;
  pageSize?: number;
}

function buildQuery(f: ErrorReportFilters): string {
  const p = new URLSearchParams();
  if (f.source) p.set('source', f.source);
  if (f.severity) p.set('severity', f.severity);
  if (f.status) p.set('status', f.status);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  p.set('page', String(f.page ?? 0));
  p.set('pageSize', String(f.pageSize ?? 100));
  return p.toString();
}

export const errorReportsApi = {
  getAll: (f: ErrorReportFilters = {}) => api.get<ErrorReportPage>(`/error-reports?${buildQuery(f)}`),
  updateStatus: (id: number, payload: { status: ErrorStatus; adminNotes?: string }) =>
    api.put<ErrorReport>(`/error-reports/${id}`, payload),
};

// ── Hebrew labels ──
export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = { Client: 'לקוח', Server: 'שרת' };
export const ERROR_SEVERITY_LABELS: Record<ErrorSeverity, string> = {
  Info: 'מידע', Warning: 'אזהרה', Error: 'שגיאה', Fatal: 'חמורה',
};
export const ERROR_STATUS_LABELS: Record<ErrorStatus, string> = {
  New: 'חדש', Investigating: 'בבדיקה', Resolved: 'טופל', Ignored: 'התעלמות',
};
