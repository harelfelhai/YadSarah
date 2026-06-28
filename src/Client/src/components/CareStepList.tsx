import { useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { CareStep, CareStepAction, CareStepStatus, UserRole } from '../types';
import { stepText, calledExpiry, effectiveStepStatus } from '../constants/careSteps';
import { canActOnStep, canEnterStep } from '../constants/roles';

interface Props {
  steps: CareStep[] | undefined;
  /** Whether the current user may act on steps (call / admit / complete). */
  isClinical: boolean;
  onAction: (step: CareStep, action: CareStepAction) => void;
  /** The current user's roles — gates the per-step actions to the wait that targets them. */
  userRoles?: UserRole[];
  /** Hide the inline call/enter/complete buttons (the queue board shows them as a single
   *  role-aware icon column instead; only the step status badges are rendered here). */
  hideActionButtons?: boolean;
  /** Rendered when there are no active steps (e.g. legacy rows admitted before care steps). */
  fallback?: React.ReactNode;
}

// Subtle status distinction via a thin border, no loud fills: waiting → gray (slate) outline ·
// called → soft amber (ochre) · in-treatment → a slightly-more-prominent green (moss) outline.
const STEP_VARIANT: Record<CareStepStatus, string> = {
  Waiting: 'outline',
  Called: 'light',
  InProgress: 'outline',
  Done: 'light',
  Canceled: 'outline',
};
const STEP_COLOR: Record<CareStepStatus, string> = {
  Waiting: 'slate',
  Called: 'ochre',
  InProgress: 'moss',
  Done: 'pine',
  Canceled: 'slate',
};

// Current time (ms). Wrapped at module scope so the time read isn't a bare impure call in the render
// body (same pattern as the queue page's waitMinutes); the effect below forces the re-render that
// flips a "נקרא" badge back once its window elapses.
const nowMs = () => Date.now();

/**
 * The live multi-dimensional status of a visit: every thing the patient is currently waiting for
 * or present at, each with who is handling it + the room (on hover), and inline call / admit /
 * complete actions. Each action is shown only for the wait that targets the current user's track
 * (a doctor can't call, admit, or complete a nurse's wait, and vice versa — mirrors the server's
 * per-track RBAC). The doctor "claim" (responsible party) lives in its own column on the queue page.
 */
export default function CareStepList({ steps, isClinical, onAction, userRoles, hideActionButtons, fallback }: Props) {
  // Re-render exactly when the soonest "Called" badge's 10s display window elapses, so it flips
  // back to "בהמתנה" without waiting for the next poll / SignalR round-trip.
  const [, force] = useState(0);
  const now = nowMs();
  const nextCalledExpiry = (steps ?? [])
    .filter((s) => s.status === 'Called')
    .map((s) => calledExpiry(s, now))
    .filter((t) => t > now)
    .reduce((min, t) => Math.min(min, t), Infinity);
  useEffect(() => {
    if (!Number.isFinite(nextCalledExpiry)) return;
    const id = setTimeout(() => force((n) => n + 1), nextCalledExpiry - Date.now() + 50);
    return () => clearTimeout(id);
  }, [nextCalledExpiry]);

  const active = (steps ?? []).filter((s) => s.status !== 'Done' && s.status !== 'Canceled');
  if (active.length === 0) return <>{fallback ?? <Text c="dimmed">—</Text>}</>;

  // Women's / first track before the second; within a track keep insertion order.
  const ordered = [...active].sort((a, b) => a.trackOrder - b.trackOrder);

  return (
    <Stack gap={4}>
      {ordered.map((s) => {
        // Display-only: a Called step older than the announcement window reads as Waiting again.
        const eff = effectiveStepStatus(s, now);
        const who = eff === 'Called' ? s.calledByName : eff === 'InProgress' ? s.startedByName : null;
        const room = eff === 'Called' ? s.calledRoom : eff === 'InProgress' ? s.startedRoom : null;
        // Who + room (e.g. "ד״ר כהן · חדר 3") moved to a hover tooltip — the badge itself stays compact.
        const detail = who || room ? `${who ?? ''}${who && room ? ' · ' : ''}${room ?? ''}` : null;
        // "קרא"/"סיים" are gated to the user's track (call/complete RBAC); "הכנס" to the enter RBAC.
        const mayAct = canActOnStep(userRoles, s.clinicianRole);
        const mayEnter = canEnterStep(userRoles, s.clinicianRole);
        return (
          <Group key={s.id} gap={6} wrap="nowrap" align="center">
            <Tooltip label={detail ?? ''} disabled={!detail} withArrow position="top">
              <Badge color={STEP_COLOR[eff]} variant={STEP_VARIANT[eff]} size="sm" style={{ whiteSpace: 'nowrap' }}>
                {stepText(eff, s.category, s.label)}
              </Badge>
            </Tooltip>
            {isClinical && !hideActionButtons && (
              <Group gap={4} wrap="nowrap">
                {eff === 'Waiting' && (
                  <>
                    {mayAct && (
                      <Button size="compact-xs" variant="subtle" color="slate" onClick={() => onAction(s, 'call')}>קרא</Button>
                    )}
                    {mayEnter && (
                      <Button size="compact-xs" variant="light" color="slate" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                    )}
                  </>
                )}
                {eff === 'Called' && mayEnter && (
                  <Button size="compact-xs" variant="light" color="slate" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                )}
                {eff === 'InProgress' && mayAct && (
                  <Button size="compact-xs" variant="subtle" color="slate" onClick={() => onAction(s, 'complete')}>סיים</Button>
                )}
              </Group>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
