const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

// Hard ceiling on a single request so a hung server/connection fails fast instead of leaving the
// UI spinning forever. The abort is surfaced as a retryable error (no .status) so TanStack retries it.
const REQUEST_TIMEOUT_MS = 20_000;

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

/** Error thrown by the api helper. `status` = HTTP code; `correlationId` = the server's מספר תקלה. */
export type ApiError = Error & { status?: number; correlationId?: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    // Our timeout (AbortError) or a network failure. Wrap the abort into a friendly Hebrew error
    // WITHOUT a status so the retry policy still retries it (a 4xx would be treated as terminal).
    if ((e as Error).name === 'AbortError') {
      throw new Error('הבקשה לשרת ארכה זמן רב מדי. בדקו את החיבור ונסו שוב.', { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // Correlation id ("מספר תקלה") — links this response to the server log line / ErrorReport.
  let correlationId = res.headers.get('X-Request-Id') ?? undefined;

  // A 401 from any *authenticated* call means the session expired → clear it and bounce to login.
  // The login call itself returns 401 on bad credentials; that must NOT trigger the global redirect
  // (a full-page reload wipes the form and its error before LoginPage can show its message). Let it
  // fall through to the normal error path so the caller surfaces the message.
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text();
    // Handled errors return JSON ({ message: "..." }); unhandled ones return RFC-7807 ProblemDetails
    // ({ title, detail, correlationId }). Surface the best human message and pick up the correlation
    // id from the body if the header was missing.
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.message === 'string') message = parsed.message;
      else if (parsed && typeof parsed.detail === 'string') message = parsed.detail;
      else if (parsed && typeof parsed.title === 'string') message = parsed.title;
      if (!correlationId && parsed && typeof parsed.correlationId === 'string')
        correlationId = parsed.correlationId;
    } catch {
      // Not JSON — use the raw body text as-is.
    }
    // Attach the HTTP status + correlation id so callers can branch (409 conflict) and show the id.
    const err = new Error(message || `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.correlationId = correlationId;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
