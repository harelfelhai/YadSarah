import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import ErrorBoundary from './components/ErrorBoundary';
import { reportClientError } from './api/errors';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import { theme } from './theme';
import { useAuthStore } from './store/auth';
import { hasAnyRole, isClinicalStaff } from './constants/roles';
import type { UserRole } from './types';
import AppShellLayout from './layout/AppShell';
import LoginPage from './features/auth/LoginPage';
import QueuePage from './features/queue/QueuePage';
import ReceptionDeskPage from './features/reception/ReceptionDeskPage';
import DischargePage from './features/reception/DischargePage';
import TreatmentFormPage from './features/treatment/TreatmentFormPage';
import VisitSummaryPage from './features/treatment/VisitSummaryPage';
import AdminPage from './features/admin/AdminPage';
import ShiftStatusPage from './features/shift/ShiftStatusPage';
import AnalyticsPage from './features/analytics/AnalyticsPage';
import SettingsPage from './features/admin/SettingsPage';
import AuditPage from './features/admin/AuditPage';
import FeedbackPage from './features/admin/FeedbackPage';
import ErrorsPage from './features/admin/ErrorsPage';
import HistoryPage from './features/history/HistoryPage';
import PatientEditPage from './features/reception/PatientEditPage';
import PublicIntakePage from './features/intake/PublicIntakePage';

const queryClient = new QueryClient({
  // Surface failures instead of letting them fail silently: when a query errors after its retries,
  // show a single toast. 401 is excluded — the api client already clears the token and redirects, so
  // toasting over the redirect would be noise. Mutations keep their own per-call onError handlers.
  queryCache: new QueryCache({
    onError: (error) => {
      const status = (error as { status?: number }).status;
      if (status === 401) return;
      const correlationId = (error as { correlationId?: string }).correlationId;
      const base = (error as Error).message || 'אירעה שגיאה בטעינת נתונים מהשרת.';
      notifications.show({
        color: 'red',
        message: correlationId ? `${base} (מספר תקלה: ${correlationId})` : base,
      });
    },
  }),
  // Report-only safety net for mutation failures (no toast — each mutation owns its own user-facing
  // onError). Funnels otherwise-unobserved errors to the server crash log so they're not lost.
  mutationCache: new MutationCache({
    onError: (error) => {
      const status = (error as { status?: number }).status;
      if (status === 401) return; // expected session-expiry redirect, not a crash
      reportClientError({
        message: `Mutation error: ${(error as Error).message}`,
        stack: (error as Error).stack ?? undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
        correlationId: (error as { correlationId?: string }).correlationId,
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      // Retry transient/network/5xx failures a few times with exponential backoff, but NOT 4xx —
      // a 403/404 won't fix itself, so retrying it just delays the error the user needs to see.
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  // Token presence gates the route; an expired-but-persisted token is handled inside the shell
  // (AppShell logs out immediately on mount when expiresAt is past — see its idle/expiry effect)
  // and by the global 401 handler, keeping this guard a pure, render-safe check.
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

// Role gate for the operational (reception/discharge) screens. A clinical user who
// reaches the URL directly or via a stale link is redirected to the queue — matching
// the hidden nav link, so the server-side 403 is never hit as a dead end.
function RequireRole({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const userRoles = useAuthStore((s) => s.user?.roles);
  return hasAnyRole(userRoles, ...roles) ? <>{children}</> : <Navigate to="/queue" replace />;
}

function DefaultRedirect() {
  const userRoles = useAuthStore((s) => s.user?.roles);
  // Reception-only staff land on their desk; anyone clinical lands on the queue.
  const dest = hasAnyRole(userRoles, 'Reception') && !isClinicalStaff(userRoles) ? '/reception' : '/queue';
  return <Navigate to={dest} replace />;
}

// Authenticated app shell + a per-route ErrorBoundary INSIDE the shell, so a crash in one screen
// shows a contained, recoverable panel while the nav/header stay usable (vs. the root boundary which
// would replace the whole app). Keyed by pathname so navigating to another screen resets it.
function ShellRoutes() {
  const location = useLocation();
  return (
    <AppShellLayout>
      <ErrorBoundary key={location.pathname} title="אירעה שגיאה בעמוד זה — נסו שוב או רעננו את הדף">
        <Routes>
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/reception" element={<RequireRole roles={['Reception', 'ShiftManager', 'Admin']}><ReceptionDeskPage /></RequireRole>} />
          <Route path="/reception/discharge/:visitId" element={<RequireRole roles={['ShiftManager', 'Admin']}><DischargePage /></RequireRole>} />
          <Route path="/reception/new" element={<Navigate to="/reception" replace />} />
          <Route path="/visits/:visitId" element={<TreatmentFormPage />} />
          <Route path="/visits/:visitId/summary" element={<VisitSummaryPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/admin/users" element={<AdminPage />} />
          <Route path="/shift-status" element={<ShiftStatusPage />} />
          <Route path="/analytics" element={<RequireRole roles={['ShiftManager', 'Admin']}><AnalyticsPage /></RequireRole>} />
          <Route path="/admin/settings" element={<SettingsPage />} />
          <Route path="/admin/audit" element={<AuditPage />} />
          <Route path="/admin/feedback" element={<FeedbackPage />} />
          <Route path="/admin/errors" element={<ErrorsPage />} />
          <Route path="/patients/:id/edit" element={<PatientEditPage />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </ErrorBoundary>
    </AppShellLayout>
  );
}

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" />
      {/* App-wide safety net: ANY render crash on ANY page is contained as a recoverable panel and
          reported to the server log — never a white screen. Inside MantineProvider so the fallback
          is themed; the finer-grained boundary inside the treatment form still handles section-level
          crashes locally. */}
      <ErrorBoundary title="אירעה שגיאה במערכת — נסו לרענן את הדף">
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public, no-login patient self-service intake (reached via the QR at reception). */}
            <Route path="/intake" element={<PublicIntakePage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <ShellRoutes />
                </RequireAuth>
              }
            />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </MantineProvider>
  );
}
