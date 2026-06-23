import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { CareStep, CareStepAction } from '../types';
import { STEP_STATUS_COLOR, stepPrefix } from '../constants/careSteps';

interface Props {
  steps: CareStep[] | undefined;
  /** Whether the current user may act on steps (call / admit / complete). */
  isClinical: boolean;
  onAction: (step: CareStep, action: CareStepAction) => void;
  /** Whether the current user may claim a patient ("take under my care") — doctor / shift-manager / admin. */
  canClaim?: boolean;
  /** The current user's id — to tell apart "claimed by me" (→ release) from "claimed by another doctor". */
  currentUserId?: string;
  /** Rendered when there are no active steps (e.g. legacy rows admitted before care steps). */
  fallback?: React.ReactNode;
}

/**
 * The live multi-dimensional status of a visit: every thing the patient is currently waiting for
 * or present at, each with who is handling it + the room, and inline call / admit / complete actions.
 * A doctor may also "claim" a waiting patient (take them under their care without starting treatment):
 * the doctor step then reads "ממתין לד״ר X" so other doctors leave the patient alone.
 */
export default function CareStepList({ steps, isClinical, onAction, canClaim, currentUserId, fallback }: Props) {
  const active = (steps ?? []).filter((s) => s.status !== 'Done' && s.status !== 'Canceled');
  if (active.length === 0) return <>{fallback ?? <Text c="dimmed">—</Text>}</>;

  // Women's / first track before the second; within a track keep insertion order.
  const ordered = [...active].sort((a, b) => a.trackOrder - b.trackOrder);

  return (
    <Stack gap={4}>
      {ordered.map((s) => {
        const who = s.status === 'Called' ? s.calledByName : s.status === 'InProgress' ? s.startedByName : null;
        const room = s.status === 'Called' ? s.calledRoom : s.status === 'InProgress' ? s.startedRoom : null;
        // A doctor step still waiting (or called) can be claimed; a claim swaps "רופא" → "ד״ר {name}".
        const claimableDoctor = s.category === 'Clinician' && s.clinicianRole === 'Doctor'
          && (s.status === 'Waiting' || s.status === 'Called');
        const claimedByMe = !!s.claimedByUserId && s.claimedByUserId === currentUserId;
        // The claimer's full name already carries their title (e.g. "ד״ר רון כהן") — show it as-is so the
        // line reads "ממתין ל…/נקרא ל…" + the name, with no doubled "ד״ר".
        const label = claimableDoctor && s.claimedByName ? s.claimedByName : s.label;
        return (
          <Group key={s.id} gap={6} wrap="nowrap" align="center">
            <Badge color={STEP_STATUS_COLOR[s.status]} variant="light" size="sm" style={{ whiteSpace: 'nowrap' }}>
              {stepPrefix(s.status, s.category)}{label}
            </Badge>
            {(who || room) && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {who ?? ''}{who && room ? ' · ' : ''}{room ?? ''}
              </Text>
            )}
            {(isClinical || (canClaim && claimableDoctor)) && (
              <Group gap={4} wrap="nowrap">
                {isClinical && s.status === 'Waiting' && (
                  <>
                    <Button size="compact-xs" variant="subtle" onClick={() => onAction(s, 'call')}>קרא</Button>
                    <Button size="compact-xs" variant="light" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                  </>
                )}
                {isClinical && s.status === 'Called' && (
                  <Button size="compact-xs" variant="light" onClick={() => onAction(s, 'enter')}>הכנס</Button>
                )}
                {isClinical && s.status === 'InProgress' && (
                  <Button size="compact-xs" variant="subtle" color="pine" onClick={() => onAction(s, 'complete')}>סיים</Button>
                )}
                {canClaim && claimableDoctor && (
                  claimedByMe ? (
                    <Button size="compact-xs" variant="subtle" color="grape" onClick={() => onAction(s, 'release')}>שחרר</Button>
                  ) : (
                    <Button size="compact-xs" variant="light" color="grape" onClick={() => onAction(s, 'claim')}>קח תחתיי</Button>
                  )
                )}
              </Group>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
