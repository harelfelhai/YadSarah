import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { CareStep, CareStepAction, CareStepStatus, UserRole } from '../types';
import { stepPrefix } from '../constants/careSteps';
import { canActOnStep, canEnterStep } from '../constants/roles';

interface Props {
  steps: CareStep[] | undefined;
  /** Whether the current user may act on steps (call / admit / complete). */
  isClinical: boolean;
  onAction: (step: CareStep, action: CareStepAction) => void;
  /** The current user's roles — gates the per-step actions to the wait that targets them. */
  userRoles?: UserRole[];
  /** Rendered when there are no active steps (e.g. legacy rows admitted before care steps). */
  fallback?: React.ReactNode;
}

// Subtle, single-tone status distinction (no loud colors): a faint → light → filled progression in
// one neutral hue, so the step state is still readable at a glance without standing out. The status
// is also spelled out in the badge text via stepPrefix ("ממתין ל…/נקרא ל…/אצל…").
const STEP_VARIANT: Record<CareStepStatus, string> = {
  Waiting: 'outline',
  Called: 'light',
  InProgress: 'filled',
  Done: 'light',
  Canceled: 'outline',
};

/**
 * The live multi-dimensional status of a visit: every thing the patient is currently waiting for
 * or present at, each with who is handling it + the room, and inline call / admit / complete actions.
 * Each action is shown only for the wait that targets the current user's track (a doctor can't call,
 * admit, or complete a nurse's wait, and vice versa — mirrors the server's per-track RBAC). The
 * doctor "claim" (responsible party) lives in its own column on the queue page, not here.
 */
export default function CareStepList({ steps, isClinical, onAction, userRoles, fallback }: Props) {
  const active = (steps ?? []).filter((s) => s.status !== 'Done' && s.status !== 'Canceled');
  if (active.length === 0) return <>{fallback ?? <Text c="dimmed">—</Text>}</>;

  // Women's / first track before the second; within a track keep insertion order.
  const ordered = [...active].sort((a, b) => a.trackOrder - b.trackOrder);

  return (
    <Stack gap={4}>
      {ordered.map((s) => {
        const who = s.status === 'Called' ? s.calledByName : s.status === 'InProgress' ? s.startedByName : null;
        const room = s.status === 'Called' ? s.calledRoom : s.status === 'InProgress' ? s.startedRoom : null;
        // "קרא"/"סיים" are gated to the user's track (call/complete RBAC); "הכנס" to the enter RBAC.
        const mayAct = canActOnStep(userRoles, s.clinicianRole);
        const mayEnter = canEnterStep(userRoles, s.clinicianRole);
        return (
          <Group key={s.id} gap={6} wrap="nowrap" align="center">
            <Badge color="slate" variant={STEP_VARIANT[s.status]} size="sm" style={{ whiteSpace: 'nowrap' }}>
              {stepPrefix(s.status, s.category)}{s.label}
            </Badge>
            {(who || room) && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {who ?? ''}{who && room ? ' · ' : ''}{room ?? ''}
              </Text>
            )}
            {isClinical && (
              <Group gap={4} wrap="nowrap">
                {s.status === 'Waiting' && (
                  <>
                    {mayAct && (
                      <Button size="compact-xs" variant="subtle" color="slate" onClick={() => onAction(s, 'call')}>קרא</Button>
                    )}
                    {mayEnter && (
                      <Button size="compact-xs" variant="light" color="slate" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                    )}
                  </>
                )}
                {s.status === 'Called' && mayEnter && (
                  <Button size="compact-xs" variant="light" color="slate" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                )}
                {s.status === 'InProgress' && mayAct && (
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
