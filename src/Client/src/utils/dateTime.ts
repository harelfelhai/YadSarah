// Shared Hebrew-locale date/time formatter for admin tables (audit / feedback / errors).
// `—` for empty. Pass { seconds: true } where second-level precision matters (audit log).
export function formatDateTime(iso?: string | null, opts?: { seconds?: boolean }): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(opts?.seconds ? { second: '2-digit' } : {}),
  });
}
