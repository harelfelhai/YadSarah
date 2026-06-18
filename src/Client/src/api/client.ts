const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  // A 401 from any *authenticated* call means the session expired → clear it and
  // bounce to login. The login call itself returns 401 on bad credentials; that
  // must NOT trigger the global redirect (a full-page reload wipes the form and
  // its error before LoginPage can show "שם משתמש או סיסמה שגויים"). Let it fall
  // through to the normal error path so the caller surfaces the message.
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.text();
    // The API returns errors as JSON ({ message: "..." }); surface that message,
    // falling back to the raw body or the status code.
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.message === 'string') message = parsed.message;
    } catch {
      // Not JSON — use the raw body text as-is.
    }
    // Attach the HTTP status so callers can branch on it (e.g. 409 conflict handling).
    const err = new Error(message || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
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
