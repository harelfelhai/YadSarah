import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { theme } from './theme';
import { useAuthStore } from './store/auth';
import AppShellLayout from './layout/AppShell';
import LoginPage from './features/auth/LoginPage';
import QueuePage from './features/queue/QueuePage';
import ReceptionPage from './features/reception/ReceptionPage';
import TreatmentFormPage from './features/treatment/TreatmentFormPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppShellLayout>
                    <Routes>
                      <Route path="/queue" element={<QueuePage />} />
                      <Route path="/reception/new" element={<ReceptionPage />} />
                      <Route path="/visits/:visitId" element={<TreatmentFormPage />} />
                      <Route path="*" element={<Navigate to="/queue" replace />} />
                    </Routes>
                  </AppShellLayout>
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
