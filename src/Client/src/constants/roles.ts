import type { UserRole } from '../types';

// Hebrew labels for each professional classification (= permission role).
export const ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'מנהל מערכת',
  ShiftManager: 'מנהל משמרת',
  Doctor: 'רופא',
  Nurse: 'אחות',
  Reception: 'קבלה',
  MedStudent: 'סטודנט לרפואה',
  NursingStudent: 'סטודנט לסיעוד',
  LabStaff: 'איש מעבדה',
};

// Options for the multi-select classification picker, in display order.
export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  'Doctor', 'Nurse', 'Reception', 'ShiftManager', 'Admin',
  'MedStudent', 'NursingStudent', 'LabStaff',
].map((r) => ({ value: r as UserRole, label: ROLE_LABELS[r as UserRole] }));

// Higher = more privileged — picks the "primary" role for display defaults.
const PRIORITY: Record<UserRole, number> = {
  Admin: 100, ShiftManager: 90, Doctor: 80, Nurse: 70,
  Reception: 60, MedStudent: 50, NursingStudent: 40, LabStaff: 30,
};

export function primaryRole(roles?: UserRole[]): UserRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  return [...roles].sort((a, b) => PRIORITY[b] - PRIORITY[a])[0];
}

export function hasAnyRole(roles: UserRole[] | undefined, ...wanted: UserRole[]): boolean {
  return !!roles && roles.some((r) => wanted.includes(r));
}

export function rolesLabel(roles?: UserRole[]): string {
  if (!roles || roles.length === 0) return '—';
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(', ');
}

// ── Capability helpers (mirror the server permission table) ──────────────────
export const isReceptionStaff = (roles?: UserRole[]) =>
  hasAnyRole(roles, 'Reception', 'ShiftManager', 'Admin');
export const isClinicalStaff = (roles?: UserRole[]) =>
  hasAnyRole(roles, 'Doctor', 'Nurse', 'ShiftManager', 'Admin', 'MedStudent', 'NursingStudent');
export const canSign = (roles?: UserRole[]) => hasAnyRole(roles, 'Doctor');
export const isAdmin = (roles?: UserRole[]) => hasAnyRole(roles, 'Admin');
export const canManageUsers = (roles?: UserRole[]) => hasAnyRole(roles, 'Admin', 'ShiftManager');
export const canEditIdentity = (roles?: UserRole[]) => hasAnyRole(roles, 'Admin', 'ShiftManager');
// Manual discharge is a shift-manager/admin action (a doctor discharges automatically by
// signing the form). Plain reception no longer discharges.
export const canDischarge = (roles?: UserRole[]) => hasAnyRole(roles, 'ShiftManager', 'Admin');
// Promoting a patient into the special ("S") queue is a shift-manager/admin override.
export const canPrioritizeQueue = (roles?: UserRole[]) => hasAnyRole(roles, 'ShiftManager', 'Admin');
// Overriding the AI/reception department routing is a clinical-professional call — any
// non-reception clinical staff, never plain reception (mirrors the server's role gate).
export const canReassignDepartment = (roles?: UserRole[]) => isClinicalStaff(roles);

// "Enter" (admit) RBAC — mirror of CareStepService.EnsureMayEnter. A professional admits a patient
// only to the wait that targets their own track: Doctor/MedStudent → doctor steps, Nurse/
// NursingStudent → nurse steps. ShiftManager/Admin may admit to any wait; station steps (clinicianRole
// null) carry no track restriction. Keep in sync with the server.
export const canEnterStep = (roles: UserRole[] | undefined, clinicianRole: UserRole | null | undefined) => {
  if (hasAnyRole(roles, 'ShiftManager', 'Admin')) return true;
  if (clinicianRole == null) return true; // station — no track restriction
  return clinicianRole === 'Nurse'
    ? hasAnyRole(roles, 'Nurse', 'NursingStudent')
    : hasAnyRole(roles, 'Doctor', 'MedStudent');
};
