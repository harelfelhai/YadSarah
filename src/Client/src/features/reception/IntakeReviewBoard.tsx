import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Badge, Box, Button, Card, Group, Loader, Modal, Stack, Table, Text,
} from '@mantine/core';
import { IconAlertTriangle, IconArrowRight, IconTrash, IconUserCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { intakeApi, type IntakeReview } from '../../api/intake';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
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

  // Hand off to the staffed reception form, prefilled from the submission. ReceptionPage marks the
  // staging row Imported once the visit is created.
  const handleOpenInReception = (r: IntakeReview) => {
    navigate('/reception', {
      state: { intakePrefill: r.submission, intakeSubmissionId: r.submission.id },
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
                        <Badge color="red" variant="filled" size="sm" leftSection={<IconAlertTriangle size={11} />}>
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
        review={selected}
        onClose={() => setSelected(null)}
        onDismiss={handleDismiss}
        onOpenInReception={handleOpenInReception}
      />
    </Box>
  );
}

// ─── Detail modal: submitted vs. existing, conflicts highlighted ───────────────
function IntakeDetailModal({
  review, onClose, onDismiss, onOpenInReception,
}: {
  review: IntakeReview | null;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onOpenInReception: (r: IntakeReview) => void;
}) {
  if (!review) return null;
  const s = review.submission;
  const matched = review.existingPatientMatched;

  return (
    <Modal opened={!!review} onClose={onClose} size="lg" title={
      <Group gap="sm">
        <Text fw={700}>{s.firstName} {s.lastName}</Text>
        <Badge color={matched ? 'green' : 'blue'} variant="light">
          {matched ? 'מטופל קיים' : 'מטופל חדש'}
        </Badge>
        {review.hasConflicts && (
          <Badge color="red" variant="filled" leftSection={<IconAlertTriangle size={11} />}>סתירות</Badge>
        )}
      </Group>
    }>
      <Stack gap="md">
        {review.hasConflicts && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            יש סתירות בין מה שהמטופל מילא לבין הקיים במערכת — השדות הסותרים מסומנים באדום.
          </Alert>
        )}

        <Group gap="xl">
          <Text size="sm"><b>סוג תעודה:</b> {s.identityType}</Text>
          <Text size="sm"><b>מספר:</b> {s.identityNumber ?? '—'}</Text>
        </Group>

        <Table withTableBorder withColumnBorders verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 150 }}>שדה</Table.Th>
              <Table.Th>מה שמולא ע"י המטופל</Table.Th>
              {matched && <Table.Th>קיים במערכת</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {review.diffs.map((d) => (
              <Table.Tr key={d.field} bg={d.isConflict ? 'var(--mantine-color-red-0)' : undefined}>
                <Table.Td><Text size="sm" fw={500}>{d.label}</Text></Table.Td>
                <Table.Td>
                  <Text size="sm" c={d.isConflict ? 'red.8' : undefined} fw={d.isConflict ? 600 : 400}>
                    {d.submitted || '—'}
                  </Text>
                </Table.Td>
                {matched && (
                  <Table.Td>
                    <Text size="sm" c="dimmed">{d.existing || '—'}</Text>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
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
            <Button leftSection={<IconUserCheck size={16} />} onClick={() => onOpenInReception(review)}>
              פתח בקבלה
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
