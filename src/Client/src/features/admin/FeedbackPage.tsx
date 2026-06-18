import { useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, Group, Loader, Modal, Select, Stack, Table,
  Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconEdit, IconLock, IconRefresh } from '@tabler/icons-react';
import {
  feedbackApi, FEEDBACK_TYPE_LABELS, FEEDBACK_STATUS_LABELS, SCREEN_OPTIONS,
  type FeedbackReport, type FeedbackStatus, type FeedbackType,
} from '../../api/feedback';
import { apiErrorMessage } from '../../constants/formPolicy';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';

const TYPE_COLOR: Record<FeedbackType, string> = {
  Bug: 'red', FixNeeded: 'orange', Improvement: 'blue', Other: 'gray',
};
const STATUS_COLOR: Record<FeedbackStatus, string> = {
  New: 'blue', InProgress: 'yellow', Resolved: 'green', Rejected: 'gray',
};

const TYPE_OPTIONS = (Object.keys(FEEDBACK_TYPE_LABELS) as FeedbackType[])
  .map((value) => ({ value, label: FEEDBACK_TYPE_LABELS[value] }));
const STATUS_OPTIONS = (Object.keys(FEEDBACK_STATUS_LABELS) as FeedbackStatus[])
  .map((value) => ({ value, label: FEEDBACK_STATUS_LABELS[value] }));

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function FeedbackPage() {
  const qc = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles);
  const isAdmin = hasAnyRole(roles, 'Admin');
  const [editing, setEditing] = useState<FeedbackReport | null>(null);

  const { data: reports = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['feedback'],
    queryFn: () => feedbackApi.getAll(),
    enabled: isAdmin,
  });

  const updateMut = useMutation({
    mutationFn: (r: FeedbackReport) => feedbackApi.update(r.id, {
      status: r.status,
      adminNotes: r.adminNotes ?? undefined,
      screen: r.screen,
      fieldName: r.fieldName,
      reportType: r.reportType,
      description: r.description,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedback'] });
      notifications.show({ color: 'green', message: 'הדיווח עודכן' });
      setEditing(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'עדכון הדיווח נכשל') }),
  });

  if (!isAdmin) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          דיווחי המשתמשים נגישים למנהל מערכת (Admin) בלבד.
        </Alert>
      </Box>
    );
  }

  const openCount = reports.filter((r) => r.status === 'New' || r.status === 'InProgress').length;

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={3}>דיווחי משתמשים</Title>
          {openCount > 0 && <Badge color="blue" variant="filled">{openCount} פתוחים</Badge>}
        </Group>
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={isFetching} onClick={() => refetch()}>
          רענון
        </Button>
      </Group>

      <Card withBorder p="md" radius="md">
        {isLoading ? (
          <Box ta="center" py="xl"><Loader /></Box>
        ) : reports.length === 0 ? (
          <Text c="dimmed" size="sm">אין דיווחים עדיין.</Text>
        ) : (
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover withTableBorder fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>זמן</Table.Th>
                  <Table.Th>מדווח</Table.Th>
                  <Table.Th>מסך</Table.Th>
                  <Table.Th>שדה</Table.Th>
                  <Table.Th>סוג</Table.Th>
                  <Table.Th>תיאור</Table.Th>
                  <Table.Th>סטטוס</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {reports.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmt(r.createdAt)}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.createdByName}<Text span c="dimmed"> ({r.createdByRole})</Text></Table.Td>
                    <Table.Td>{r.screen}</Table.Td>
                    <Table.Td>{r.fieldName}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={TYPE_COLOR[r.reportType]}>
                        {FEEDBACK_TYPE_LABELS[r.reportType]}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 320 }}>
                      <Text size="xs" lineClamp={2}>{r.description}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[r.status]}>{FEEDBACK_STATUS_LABELS[r.status]}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" leftSection={<IconEdit size={14} />}
                        onClick={() => setEditing({ ...r })}>
                        עריכה
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Card>

      <Modal opened={!!editing} onClose={() => setEditing(null)} title="עריכת דיווח" size="lg" centered>
        {editing && (
          <Stack gap="sm">
            <Text size="xs" c="dimmed">
              דווח ע"י {editing.createdByName} ({editing.createdByRole}) — {fmt(editing.createdAt)}
              {editing.routeUrl ? ` · נתיב: ${editing.routeUrl}` : ''}
            </Text>
            <Group grow>
              <Select label="סטטוס" data={STATUS_OPTIONS} value={editing.status} allowDeselect={false}
                onChange={(v) => v && setEditing({ ...editing, status: v as FeedbackStatus })} />
              <Select label="סוג" data={TYPE_OPTIONS} value={editing.reportType} allowDeselect={false}
                onChange={(v) => v && setEditing({ ...editing, reportType: v as FeedbackType })} />
            </Group>
            <Group grow>
              <Select label="מסך" data={SCREEN_OPTIONS} value={editing.screen} allowDeselect={false}
                onChange={(v) => v && setEditing({ ...editing, screen: v })} />
              <TextInput label="שדה" value={editing.fieldName}
                onChange={(e) => setEditing({ ...editing, fieldName: e.currentTarget.value })} />
            </Group>
            <Textarea label="תיאור" autosize minRows={3} value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.currentTarget.value })} />
            <Textarea label="הערות מנהל / פתרון" autosize minRows={2}
              placeholder="מה נעשה / סטטוס הטיפול…"
              value={editing.adminNotes ?? ''}
              onChange={(e) => setEditing({ ...editing, adminNotes: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setEditing(null)}>ביטול</Button>
              <Button loading={updateMut.isPending} onClick={() => editing && updateMut.mutate(editing)}>
                שמירה
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
