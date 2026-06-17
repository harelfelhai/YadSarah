import * as signalR from '@microsoft/signalr';
import type { QueueUpdate, FormLockInfo, PresenceUpdate } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

let connection: signalR.HubConnection | null = null;

// The form group the user is currently in. SignalR re-establishes the connection and
// its `.on` handlers on automatic reconnect, but server-side GROUP membership is lost —
// so we track the active form and re-join it in `onreconnected`.
let activeFormId: string | null = null;

// Set true only on explicit logout so the self-healing reconnect below doesn't fight it.
let intentionallyStopped = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

// Tracks the in-flight initial start() so startHub() and joinForm() share ONE
// connect attempt (never double-start) and can both await it.
let startPromise: Promise<void> | null = null;

// Keep trying to bring the connection back after it closes for good. A brief server
// blip (e.g. a restart) otherwise left the default policy exhausted after ~30s and the
// connection permanently dead — silently killing presence + live form sync until a
// manual page refresh.
function scheduleRestart(delay = 3000) {
  if (intentionallyStopped || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (intentionallyStopped) return;
    startHub().catch(() => scheduleRestart(Math.min(delay * 2, 15000)));
  }, delay);
}

export function getHub(): signalR.HubConnection {
  if (!connection) {
    connection = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_URL}/hubs/main`, {
        accessTokenFactory: () => localStorage.getItem('auth_token') ?? '',
      })
      // Retry indefinitely (capped exponential backoff) instead of the default policy
      // that gives up after ~30s — so the connection survives a transient outage.
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) =>
          Math.min(1000 * 2 ** Math.min(ctx.previousRetryCount, 4), 10000),
      })
      .build();

    connection.onreconnected(() => {
      if (activeFormId) {
        connection?.invoke('JoinForm', activeFormId).catch(() => {});
      }
    });

    // Closed despite auto-reconnect (or it never started) → keep trying, unless we
    // logged out on purpose.
    connection.onclose(() => {
      if (!intentionallyStopped) scheduleRestart();
    });
  }
  return connection;
}

// Ensure the socket is connected, starting it if needed. Returns a promise that
// resolves once connected. Crucially, as soon as the socket comes up it (re)joins
// the active form — this covers the INITIAL connect, not just reconnects
// (`onreconnected` only fires on reconnect). Without this, a form opened on a fresh
// page load could invoke JoinForm before the socket was ready, fail silently, and
// end up connected but NOT in the group → no presence, no locks, no live updates.
function ensureConnected(): Promise<void> {
  const hub = getHub();
  if (hub.state === signalR.HubConnectionState.Connected) return Promise.resolve();
  if (hub.state === signalR.HubConnectionState.Disconnected && !startPromise) {
    startPromise = hub.start()
      .then(() => {
        if (activeFormId) hub.invoke('JoinForm', activeFormId).catch(() => {});
      })
      .catch((e) => {
        // Server not up yet (e.g. opened the app before the API) — retry in background.
        scheduleRestart();
        throw e;
      })
      .finally(() => { startPromise = null; });
  }
  // Mid-connect → await that attempt; reconnecting → resolve and let onreconnected re-join.
  return startPromise ?? Promise.resolve();
}

export async function startHub(): Promise<void> {
  intentionallyStopped = false;
  await ensureConnected();
}

export async function stopHub(): Promise<void> {
  intentionallyStopped = true;
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  await connection?.stop();
}

// ─── Queue subscriptions ───────────────────────────────────────────────────

export function onQueueUpdate(handler: (update: QueueUpdate) => void) {
  getHub().on('QueueUpdate', handler);
  return () => getHub().off('QueueUpdate', handler);
}

// ─── Form presence & locking ───────────────────────────────────────────────

export async function joinForm(formId: string) {
  activeFormId = formId;
  try {
    // Wait for the socket to be connected before joining — otherwise the invoke
    // throws and is swallowed, leaving us connected but NOT in the group.
    await ensureConnected();
    await getHub().invoke('JoinForm', formId);
  } catch {
    // Still not ready / reconnecting — the start chain or onreconnected re-joins activeFormId.
  }
}

export async function leaveForm(formId: string) {
  if (activeFormId === formId) activeFormId = null;
  try {
    await getHub().invoke('LeaveForm', formId);
  } catch {
    // Already disconnected — nothing to leave.
  }
}

export function onPresenceUpdate(handler: (update: PresenceUpdate) => void) {
  getHub().on('PresenceUpdate', handler);
  return () => getHub().off('PresenceUpdate', handler);
}

export function onLockAcquired(handler: (lock: FormLockInfo) => void) {
  getHub().on('LockAcquired', handler);
  return () => getHub().off('LockAcquired', handler);
}

export function onLockReleased(handler: (info: { formId: string; sectionName: string }) => void) {
  getHub().on('LockReleased', handler);
  return () => getHub().off('LockReleased', handler);
}

export function onFormSectionUpdated(
  handler: (update: {
    formId: string; sectionName: string; data: unknown;
    editedByUserId?: string; editedByName?: string; editedAt?: string; version?: number;
  }) => void
) {
  getHub().on('FormSectionUpdated', handler);
  return () => getHub().off('FormSectionUpdated', handler);
}

export function onFormSigned(
  handler: (info: { formId: string; signedByName: string; signedAt: string }) => void
) {
  getHub().on('FormSigned', handler);
  return () => getHub().off('FormSigned', handler);
}

export function onFormAddendaChanged(
  handler: (info: { formId: string }) => void
) {
  getHub().on('FormAddendaChanged', handler);
  return () => getHub().off('FormAddendaChanged', handler);
}
