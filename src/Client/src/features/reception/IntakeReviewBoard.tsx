import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Badge, Box, Button, Card, Group, Loader, Modal, Stack, Table, Text, UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle, IconArrowRight, IconCheck, IconTrash, IconUserCheck,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { intakeApi, type IntakeFieldDiff, type IntakeReview, type IntakeSubmission } from '../../api/intake';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Classify a diff row. Only a real "conflict" (both sides filled and different) requires the
// reviewer to pick; everything else is shown "flowing" and resolves to whichever side has content. ──
type DiffKind = 'conflict' | 'patientOnly' | 'systemOnly' | 'same';
function kindOf(d: IntakeFieldDiff): DiffKind {
  if (d.isConflict) return 'conflict';
  const hasS = !!d.submitted?.trim();
  const hasE = !!d.existing?.trim();
  if (hasS && hasE) return 'same';     // both present and equal
  if (hasS) return 'patientOnly';      // new info the patient supplied
  return 'systemOnly';                 // patient left blank, system already holds it
}

export default function IntakeReviewBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<IntakeReview | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['intake-pending'],
    queryFn: intakeApi.listPending,
    refetchInterval: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['intake-pending'] });

  const handleDismiss = async (id: string) => {
    try {
      await intakeApi.dismiss(id);
      setSelected(null);
      refresh();
      notifications.show({ message: 'הטופס בוטל', color: 'gray' });
    } catch {
      notifications.show({ message: 'שגיאה בביטול הטופס', color: 'red' });
    }
  };

  // Hand off to the staffed reception form, prefilled with the RESOLVED values (per-field choices
  // applied + existing data the patient didn't retype). ReceptionPage marks the staging row Imported
  // once the visit is created.
  const handleProceed = (merged: IntakeSubmission, submissionId: string) => {
    setSelected(null); // close the review modal — "the screen closes and we move to reception"
    navigate('/reception', {
      state: { intakePrefill: merged, intakeSubmissionId: submissionId },
    });
  };

  return (
    <Box>
      <Group justify="space-between" mb="sm">
        <Text size="sm" c="dimmed">{items.length} טפסים שמולאו ע"י מטופלים וממתינים לטיפול</Text>
      </Group>

      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : items.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">אין כרגע טפסים שמולאו ע"י מטופלים</Text>
        </Card>
      ) : (
        <Box style={{ border: '1px solid var(--line)', overflowX: 'auto' }}>
          <Table horizontalSpacing="md" verticalSpacing="sm" miw={760} highlightOnHover
            styles={{ th: { whiteSpace: 'nowrap' }, td: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>שם</Table.Th>
                <Table.Th style={{ width: 150 }}>ת.ז / מזהה</Table.Th>
                <Table.Th style={{ width: 160 }}>סיבת פנייה</Table.Th>
                <Table.Th style={{ width: 150 }}>התקבל</Table.Th>
                <Table.Th style={{ width: 220 }}>סטטוס</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((r) => (
                <Table.Tr
                  key={r.submission.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(r)}
                >
                  <Table.Td><Text fw={600}>{r.submission.firstName} {r.submission.lastName}</Text></Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.submission.identityNumber ?? '—'}</Table.Td>
                  <Table.Td>{r.submission.admissionReason ?? '—'}</Table.Td>
                  <Table.Td>{fmtTime(r.submission.submittedAt)}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'normal' }}>
                    <Group gap={6} wrap="wrap">
                      <Badge color={r.existingPatientMatched ? 'green' : 'blue'} variant="light" size="sm">
                        {r.existingPatientMatched ? 'מטופל קיים' : 'מטופל חדש'}
                      </Badge>
                      {r.hasConflicts && (
                        <Badge color="orange" variant="filled" size="sm" leftSection={<IconAlertTriangle size={11} />}>
                          סתירות
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      <IntakeDetailModal
        key={selected?.submission.id ?? 'none'}
        review={selected}
        onClose={() => setSelected(null)}
        onDismiss={handleDismiss}
        onProceed={handleProceed}
      />
    </Box>
  );
}

// ─── Detail modal: resolve conflicts per-field, then hand the merged result to reception ───────────
function IntakeDetailModal({
  review, onClose, onDismiss, onProceed,
}: {
  review: IntakeReview | null;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onProceed: (merged: IntakeSubmission, submissionId: string) => void;
}) {
  // Per-field decision for conflict rows only — 'submitted' (patient) | 'existing' (system).
  // No default: every conflict must be picked before reception can continue.
  const [choices, setChoices] = useState<Record<string, 'submitted' | 'existing'>>({});

  if (!review) return null;
  const s = review.submission;
  const matched = review.existingPatientMatched;

  const conflicts = review.diffs.filter((d) => d.isConflict);
  const unresolved = conflicts.filter((d) => !choices[d.field]).length;

  const proceed = () => {
    // Build the resolved submission: for each compared field pick the chosen / content side.
    const merged: IntakeSubmission = { ...s };
    const bag = merged as unknown as Record<string, unknown>;
    for (const d of review.diffs) {
      let val: string | null | undefined;
      switch (kindOf(d)) {
        case 'conflict':   val = choices[d.field] === 'existing' ? d.existing : d.submitted; break;
        case 'systemOnly': val = d.existing; break;
        default:           val = d.submitted; break; // patientOnly | same
      }
      bag[d.field] = val ?? '';
    }
    onProceed(merged, s.id);
  };

  return (
    <Modal opened={!!review} onClose={onClose} size="lg" title={
      <Group gap="sm">
        <Text fw={700}>{s.firstName} {s.lastName}</Text>
        <Badge color={matched ? 'green' : 'blue'} variant="light">
          {matched ? 'מטופל קיים' : 'מטופל חדש'}
        </Badge>
        {conflicts.length > 0 && (
          <Badge color={unresolved > 0 ? 'orange' : 'green'} variant="filled"
            leftSection={unresolved > 0 ? <IconAlertTriangle size={11} /> : <IconCheck size={11} />}>
            {unresolved > 0 ? `${unresolved} סתירות` : 'נפתר'}
          </Badge>
        )}
      </Group>
    }>
      <Stack gap="md">
        {conflicts.length > 0 && (
          unresolved > 0 ? (
            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
              יש {unresolved} סתירות בין מה שמילא המטופל לבין הקיים במערכת. בחר/י ערך לכל שדה מסומן —
              חובה לפתור את כולן לפני המעבר לקבלה.
            </Alert>
          ) : (
            <Alert color="green" variant="light" icon={<IconCheck size={16} />}>
              כל הסתירות נפתרו — אפשר להמשיך לקבלה.
            </Alert>
          )
        )}

        <Group gap="xl">
          <Text size="sm"><b>סוג תעודה:</b> {s.identityType}</Text>
          <Text size="sm"><b>מספר:</b> {s.identityNumber ?? '—'}</Text>
        </Group>

        {/* Two side-by-side lists: what the patient filled vs. what the system holds. Conflict rows
            make BOTH value-cells clickable so reception picks a side per-field; non-conflict rows
            (empty-vs-content / identical) just read across — flowing, never flagged as a clash. */}
        <Table withTableBorder withColumnBorders verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 130 }}>שדה</Table.Th>
              <Table.Th>מה שמילא ע"י המטופל</Table.Th>
              {matched && <Table.Th>קיים במערכת</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {review.diffs.map((d) => {
              if (d.isConflict) {
                const picked = choices[d.field];
                const pick = (side: 'submitted' | 'existing') =>
                  setChoices((c) => ({ ...c, [d.field]: side }));
                return (
                  <Table.Tr key={d.field}
                    bg={picked ? 'var(--mantine-color-green-0)' : 'var(--mantine-color-orange-0)'}>
                    <Table.Td>
                      <Text size="sm" fw={600}>{d.label}</Text>
                      {!picked && <Text size="xs" c="orange.7">יש לבחור</Text>}
                    </Table.Td>
                    <Table.Td p={4}>
                      <ChoiceCell value={d.submitted} selected={picked === 'submitted'}
                        onClick={() => pick('submitted')} />
                    </Table.Td>
                    <Table.Td p={4}>
                      <ChoiceCell value={d.existing} selected={picked === 'existing'}
                        onClick={() => pick('existing')} />
                    </Table.Td>
                  </Table.Tr>
                );
              }
              return (
                <Table.Tr key={d.field}>
                  <Table.Td><Text size="sm" fw={500}>{d.label}</Text></Table.Td>
                  <Table.Td>
                    <Text size="sm" c={d.submitted ? undefined : 'dimmed'}>{d.submitted || '—'}</Text>
                  </Table.Td>
                  {matched && (
                    <Table.Td><Text size="sm" c="dimmed">{d.existing || '—'}</Text></Table.Td>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>

        {(s.admissionReason || s.notes) && (
          <Stack gap={4}>
            {s.admissionReason && <Text size="sm"><b>סיבת פנייה:</b> {s.admissionReason}</Text>}
            {s.notes && <Text size="sm"><b>הערות:</b> {s.notes}</Text>}
          </Stack>
        )}

        <Group justify="space-between" mt="sm">
          <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />}
            onClick={() => onDismiss(s.id)}>
            בטל טופס
          </Button>
          <Group gap="sm">
            <Button variant="default" leftSection={<IconArrowRight size={16} />} onClick={onClose}>
              סגור
            </Button>
            <Button leftSection={<IconUserCheck size={16} />} disabled={unresolved > 0} onClick={proceed}>
              המשך לקבלה
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

// One selectable value-cell of a conflict row — click to choose this side; the chosen side gets a
// green ring + check so the picked value is unmistakable across the two columns.
function ChoiceCell({ value, selected, onClick }: {
  value?: string | null; selected: boolean; onClick: () => void;
}) {
  return (
    <UnstyledButton onClick={onClick} aria-pressed={selected}
      style={{
        display: 'block', width: '100%', padding: '6px 8px', borderRadius: 6,
        border: selected ? '2px solid var(--mantine-color-green-6)' : '1px dashed var(--mantine-color-gray-4)',
        background: selected ? 'var(--mantine-color-green-0)' : 'transparent',
      }}>
      <Group gap={6} wrap="nowrap">
        {selected && <IconCheck size={14} style={{ color: 'var(--mantine-color-green-7)', flexShrink: 0 }} />}
        <Text size="sm" fw={selected ? 600 : 400}>{value || '—'}</Text>
      </Group>
    </UnstyledButton>
  );
}
