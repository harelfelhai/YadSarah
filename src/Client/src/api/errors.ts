// Fire-and-forget client crash reporter. POSTs a render-time exception to the server so it lands in
// the application log (visible in Render) instead of dying silently in the user's browser console.
// MUST never throw or block: any failure here is swallowed — a broken reporter must not turn a
// contained crash into a cascade. Does not use the shared `api` helper on purpose (no 401-redirect
// coupling, no awaiting); attaches the token only so the server can attribute the user.
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  /** Server correlation id ("מספר תקלה") when the crash originated from a failed API call. */
  correlationId?: string;
  /** 'Info' | 'Warning' | 'Error' | 'Fatal' — defaults to Error server-side when omitted. */
  severity?: string;
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    const token = localStorage.getItem('auth_token');
    void fetch(`${BASE_URL}/client-errors`, {
      method: 'POST',
      keepalive: true, // let it complete even if the page is navigating away
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(report),
    }).catch(() => {
      /* swallow — reporting is best-effort */
    });
  } catch {
    /* swallow — never let the reporter crash the error boundary */
  }
}
