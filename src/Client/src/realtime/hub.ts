import * as signalR from '@microsoft/signalr';
import type { QueueUpdate, FormLockInfo, PresenceUpdate } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

let connection: signalR.HubConnection | null = null;

export function getHub(): signalR.HubConnection {
  if (!connection) {
    connection = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE_URL}/hubs/main`, {
        accessTokenFactory: () => localStorage.getItem('auth_token') ?? '',
      })
      .withAutomaticReconnect()
      .build();
  }
  return connection;
}

export async function startHub(): Promise<void> {
  const hub = getHub();
  if (hub.state === signalR.HubConnectionState.Disconnected) {
    await hub.start();
  }
}

export async function stopHub(): Promise<void> {
  await connection?.stop();
}

// ─── Queue subscriptions ───────────────────────────────────────────────────

export function onQueueUpdate(handler: (update: QueueUpdate) => void) {
  getHub().on('QueueUpdate', handler);
  return () => getHub().off('QueueUpdate', handler);
}

// ─── Form presence & locking ───────────────────────────────────────────────

export async function joinForm(formId: string) {
  await getHub().invoke('JoinForm', formId);
}

export async function leaveForm(formId: string) {
  await getHub().invoke('LeaveForm', formId);
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
