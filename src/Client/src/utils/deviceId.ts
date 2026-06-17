import { newId } from './id';

// A stable per-computer identifier. Generated once and kept in localStorage, so the
// same physical machine (browser profile) is recognised across logins and the server
// can map it to a fixed room. On-prem LAN over plain HTTP is fine — newId() falls back
// to non-secure-context UUID generation. Clearing site data makes the machine look new
// and it will be re-prompted for its room (the accepted fallback).
const KEY = 'workstation_device_id';

export function getOrCreateDeviceId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(KEY, id);
    }
  } catch {
    // localStorage blocked (private mode / hardened kiosk) — fall back to a per-session id.
    id ??= newId();
  }
  return id;
}
