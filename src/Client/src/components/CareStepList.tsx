import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { CareStep, CareStepAction } from '../types';
import { STEP_STATUS_COLOR, stepPrefix } from '../constants/careSteps';

interface Props {
  steps: CareStep[] | undefined;
  /** Whether the current user may act on steps (call / admit / complete). */
  isClinical: boolean;
  onAction: (step: CareStep, action: CareStepAction) => void;
  /** Rendered when there are no active steps (e.g. legacy rows admitted before care steps). */
  fallback?: React.ReactNode;
}

/**
 * The live multi-dimensional status of a visit: every thing the patient is currently waiting for
 * or present at, each with who is handling it + the room, and inline call / admit / complete actions.
 */
export default function CareStepList({ steps, isClinical, onAction, fallback }: Props) {
  const active = (steps ?? []).filter((s) => s.status !== 'Done' && s.status !== 'Canceled');
  if (active.length === 0) return <>{fallback ?? <Text c="dimmed">—</Text>}</>;

  // Women's / first track before the second; within a track keep insertion order.
  const ordered = [...active].sort((a, b) => a.trackOrder - b.trackOrder);

  return (
    <Stack gap={4}>
      {ordered.map((s) => {
        const who = s.status === 'Called' ? s.calledByName : s.status === 'InProgress' ? s.startedByName : null;
        const room = s.status === 'Called' ? s.calledRoom : s.status === 'InProgress' ? s.startedRoom : null;
        return (
          <Group key={s.id} gap={6} wrap="nowrap" align="center">
            <Badge color={STEP_STATUS_COLOR[s.status]} variant="light" size="sm" style={{ whiteSpace: 'nowrap' }}>
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
                    <Button size="compact-xs" variant="subtle" onClick={() => onAction(s, 'call')}>קרא</Button>
                    <Button size="compact-xs" variant="light" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                  </>
                )}
                {s.status === 'Called' && (
                  <Button size="compact-xs" variant="light" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                )}
                {s.status === 'InProgress' && (
                  <Button size="compact-xs" variant="subtle" color="pine" onClick={() => onAction(s, 'complete')}>סיים</Button>
                )}
              </Group>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
