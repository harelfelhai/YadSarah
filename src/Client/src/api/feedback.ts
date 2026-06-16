import { api } from './client';

export type FeedbackType = 'Bug' | 'FixNeeded' | 'Improvement' | 'Other';
export type FeedbackStatus = 'New' | 'InProgress' | 'Resolved' | 'Rejected';

export interface FeedbackReport {
  id: string;
  screen: string;
  fieldName: string;
  reportType: FeedbackType;
  description: string;
  routeUrl?: string | null;
  status: FeedbackStatus;
  adminNotes?: string | null;
  createdByName: string;
  createdByRole: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateFeedbackPayload {
  screen: string;
  fieldName: string;
  reportType: FeedbackType;
  description: string;
  routeUrl?: string;
}

export interface UpdateFeedbackPayload {
  status: FeedbackStatus;
  adminNotes?: string;
  screen: string;
  fieldName: string;
  reportType: FeedbackType;
  description: string;
}

export const feedbackApi = {
  create: (payload: CreateFeedbackPayload) => api.post<FeedbackReport>('/feedback', payload),
  getAll: () => api.get<FeedbackReport[]>('/feedback'),
  update: (id: string, payload: UpdateFeedbackPayload) =>
    api.put<FeedbackReport>(`/feedback/${id}`, payload),
};

// ── Shared labels & screen map (used by the widget and the admin page) ──

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  Bug: 'תקלה',
  FixNeeded: 'תיקון נדרש',
  Improvement: 'הצעה לשיפור',
  Other: 'אחר',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  New: 'חדש',
  InProgress: 'בטיפול',
  Resolved: 'טופל',
  Rejected: 'נדחה',
};

export const GENERAL = 'כללי';

/** Known screens for the report's "screen" select. */
export const SCREEN_OPTIONS = [
  GENERAL,
  'תור מטופלים',
  'קבלת מטופל',
  'טופס טיפול',
  'היסטוריית מטופלים',
  'ניהול משתמשים',
  'הגדרות מערכת',
  'יומן ביקורת',
  'דיווחי משתמשים',
  'עריכת מטופל',
  'התחברות',
];

/** Best-effort mapping from the current route to a screen label (auto-prefill). */
export function screenFromPath(pathname: string): string {
  if (pathname.startsWith('/queue')) return 'תור מטופלים';
  if (pathname.startsWith('/reception')) return 'קבלת מטופל';
  if (pathname.startsWith('/visits')) return 'טופס טיפול';
  if (pathname.startsWith('/history')) return 'היסטוריית מטופלים';
  if (pathname.startsWith('/admin/users')) return 'ניהול משתמשים';
  if (pathname.startsWith('/admin/settings')) return 'הגדרות מערכת';
  if (pathname.startsWith('/admin/audit')) return 'יומן ביקורת';
  if (pathname.startsWith('/admin/feedback')) return 'דיווחי משתמשים';
  if (pathname.startsWith('/patients')) return 'עריכת מטופל';
  if (pathname.startsWith('/login')) return 'התחברות';
  return GENERAL;
}
