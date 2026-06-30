import { reportClientError } from './errors';

// Catches errors the React ErrorBoundary CAN'T see — unhandled promise rejections (most async/API
// failures), errors thrown in event handlers / timers, and other window-level errors — and ships
// them to the server crash log. Without this they die silently in the user's console.
//
// Guards against three failure modes: noise (AbortError, the 401-redirect, extension/cross-origin
// junk), floods (a render loop firing thousands/sec), and dev double-invocation (StrictMode / HMR).

let installed = false;

// Per-fingerprint dedup + a global per-minute cap so an error storm can't flood the server.
const recentByFingerprint = new Map<string, number>();
const DEDUP_WINDOW_MS = 10_000;
const sentTimestamps: number[] = [];
const MAX_PER_MINUTE = 10;

function isNoise(message: string, stack?: string): boolean {
  const m = message || '';
  // Our fetch timeout + TanStack query cancellation both surface as AbortError — expected, not a bug.
  if (/AbortError|aborted|signal is aborted|The user aborted a request/i.test(m)) return true;
  // Expected 401 → the api client already cleared the token and redirected to /login.
  if (m === 'Unauthorized') return true;
  // Cross-origin script error with no detail — not actionable.
  if (/^Script error\.?$/i.test(m) && !stack) return true;
  // Benign browser warning that surfaces as an error in some engines.
  if (/ResizeObserver loop/i.test(m)) return true;
  // Browser-extension noise — not our code.
  if (/chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\//i.test(stack || '')) return true;
  return false;
}

function shouldSend(fingerprint: string): boolean {
  const now = Date.now();
  const last = recentByFingerprint.get(fingerprint);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  recentByFingerprint.set(fingerprint, now);
  // Sliding 60s window cap (complements the server per-IP rate limit + fingerprint dedup).
  while (sentTimestamps.length && now - sentTimestamps[0] > 60_000) sentTimestamps.shift();
  if (sentTimestamps.length >= MAX_PER_MINUTE) return false;
  sentTimestamps.push(now);
  return true;
}

function fingerprintOf(message: string, stack?: string): string {
  const firstFrame = (stack || '').split('\n')[1] ?? '';
  return `${message}|${firstFrame}`;
}

function handle(message: string, stack: string | undefined, severity: string): void {
  if (!message || isNoise(message, stack)) return;
  if (!shouldSend(fingerprintOf(message, stack))) return;
  reportClientError({
    message,
    stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    severity,
  });
}

export function installGlobalErrorHandlers(): void {
  if (installed) return; // StrictMode / HMR re-execution guard — never double-register
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const err = event.error as Error | undefined;
    // Resource-load failures (img/script) fire 'error' with no event.error and no message — skip.
    const message = err?.message ?? event.message ?? '';
    handle(message, err?.stack, 'Error');
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? '');
    const stack = reason instanceof Error ? reason.stack : undefined;
    handle(message, stack, 'Error');
  });
}
