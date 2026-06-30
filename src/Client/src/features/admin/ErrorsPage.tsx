import { useMemo, useState } from 'react';
import {
  Alert, Badge, Box, Button, Card, Code, CopyButton, Group, Loader, Modal, Pagination,
  Select, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCheck, IconCopy, IconEdit, IconLock, IconRefresh } from '@tabler/icons-react';
import {
  errorReportsApi, ERROR_SOURCE_LABELS, ERROR_SEVERITY_LABELS, ERROR_STATUS_LABELS,
  type ErrorReport, type ErrorSource, type ErrorSeverity, type ErrorStatus,
} from '../../api/errorReports';
import { apiErrorMessage } from '../../constants/formPolicy';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';

const PAGE_SIZE = 100;

const SOURCE_COLOR: Record<ErrorSource, string> = { Client: 'blue', Server: 'orange' };
const SEVERITY_COLOR: Record<ErrorSeverity, string> = {
  Info: 'gray', Warning: 'yellow', Error: 'red', Fatal: 'grape',
};
const STATUS_COLOR: Record<ErrorStatus, string> = {
  New: 'blue', Investigating: 'yellow', Resolved: 'green', Ignored: 'gray',
};

const toOptions = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const SOURCE_OPTIONS = toOptions(ERROR_SOURCE_LABELS);
const SEVERITY_OPTIONS = toOptions(ERROR_SEVERITY_LABELS);
const STATUS_OPTIONS = toOptions(ERROR_STATUS_LABELS);

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const mono = { fontFamily: 'monospace', direction: 'ltr' as const };

export default function ErrorsPage() {
  const qc = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles);
  const isAdmin = hasAnyRole(roles, 'Admin');

  // Filters are applied SERVER-side over ALL rows; pagination is applied last on the filtered result.
  const [source, setSource] = useState<ErrorSource | null>(null);
  const [severity, setSeverity] = useState<ErrorSeverity | null>(null);
  const [status, setStatus] = useState<ErrorStatus | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0); // 0-based
  const [editing, setEditing] = useState<ErrorReport | null>(null);

  const filters = { source, severity, status, from: from || null, to: to || null };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['error-reports', filters, page],
    queryFn: () => errorReportsApi.getAll({ ...filters, page, pageSize: PAGE_SIZE }),
    enabled: isAdmin,
  });

  const updateMut = useMutation({
    mutationFn: (r: ErrorReport) =>
      errorReportsApi.updateStatus(r.id, { status: r.status, adminNotes: r.adminNotes ?? undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['error-reports'] });
      notifications.show({ color: 'green', message: 'הדיווח עודכן' });
      setEditing(null);
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'עדכון הדיווח נכשל') }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  if (!isAdmin) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          לוח שגיאות המערכת נגיש למנהל מערכת (Admin) בלבד.
        </Alert>
      </Box>
    );
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={3}>שגיאות מערכת</Title>
          <Badge color="gray" variant="light">{total} רשומות</Badge>
        </Group>
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={isFetching} onClick={() => refetch()}>
          רענון
        </Button>
      </Group>

      {/* Server-side filters over ALL rows */}
      <Card withBorder p="sm" radius="md">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select label="מקור" placeholder="הכול" clearable data={SOURCE_OPTIONS} w={130}
            value={source} onChange={(v) => { setSource(v as ErrorSource | null); setPage(0); }} />
          <Select label="חומרה" placeholder="הכול" clearable data={SEVERITY_OPTIONS} w={130}
            value={severity} onChange={(v) => { setSeverity(v as ErrorSeverity | null); setPage(0); }} />
          <Select label="סטטוס" placeholder="הכול" clearable data={STATUS_OPTIONS} w={130}
            value={status} onChange={(v) => { setStatus(v as ErrorStatus | null); setPage(0); }} />
          <TextInput label="מתאריך" type="date" value={from}
            onChange={(e) => { setFrom(e.currentTarget.value); setPage(0); }} />
          <TextInput label="עד תאריך" type="date" value={to}
            onChange={(e) => { setTo(e.currentTarget.value); setPage(0); }} />
        </Group>
      </Card>

      <Card withBorder p="md" radius="md">
        {isLoading ? (
          <Box ta="center" py="xl"><Loader /></Box>
        ) : items.length === 0 ? (
          <Text c="dimmed" size="sm">לא נמצאו שגיאות התואמות את הסינון.</Text>
        ) : (
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover withTableBorder fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>זמן אחרון</Table.Th>
                  <Table.Th>מקור</Table.Th>
                  <Table.Th>חומרה</Table.Th>
                  <Table.Th>מספר תקלה</Table.Th>
                  <Table.Th>הודעה</Table.Th>
                  <Table.Th>מופעים</Table.Th>
                  <Table.Th>נתיב</Table.Th>
                  <Table.Th>משתמש</Table.Th>
                  <Table.Th>סטטוס</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmt(r.lastSeenAt)}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={SOURCE_COLOR[r.source]}>{ERROR_SOURCE_LABELS[r.source]}</Badge></Table.Td>
                    <Table.Td><Badge size="sm" color={SEVERITY_COLOR[r.severity]}>{ERROR_SEVERITY_LABELS[r.severity]}</Badge></Table.Td>
                    <Table.Td>{r.correlationId ? <Code style={mono}>{r.correlationId}</Code> : <Text c="dimmed">—</Text>}</Table.Td>
                    <Table.Td style={{ maxWidth: 340 }}><Text size="xs" lineClamp={2}>{r.message}</Text></Table.Td>
                    <Table.Td ta="center">{r.occurrenceCount > 1 ? <Badge size="sm" variant="filled" color="red">{r.occurrenceCount}</Badge> : r.occurrenceCount}</Table.Td>
                    <Table.Td style={{ maxWidth: 180 }}><Text size="xs" lineClamp={1} style={{ direction: 'ltr' }}>{r.routeUrl ?? '—'}</Text></Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{r.userName ?? <Text span c="dimmed">אנונימי</Text>}{r.userRole ? <Text span c="dimmed"> ({r.userRole})</Text> : ''}</Table.Td>
                    <Table.Td><Badge size="sm" color={STATUS_COLOR[r.status]}>{ERROR_STATUS_LABELS[r.status]}</Badge></Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" leftSection={<IconEdit size={14} />} onClick={() => setEditing({ ...r })}>
                        פרטים
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
        {totalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination total={totalPages} value={page + 1} onChange={(v) => setPage(v - 1)} size="sm" />
          </Group>
        )}
      </Card>

      <Modal opened={!!editing} onClose={() => setEditing(null)} title="פרטי שגיאה" size="xl" centered>
        {editing && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge variant="light" color={SOURCE_COLOR[editing.source]}>{ERROR_SOURCE_LABELS[editing.source]}</Badge>
              <Badge color={SEVERITY_COLOR[editing.severity]}>{ERROR_SEVERITY_LABELS[editing.severity]}</Badge>
              {editing.occurrenceCount > 1 && <Badge color="red" variant="filled">{editing.occurrenceCount} מופעים</Badge>}
            </Group>
            <Text size="xs" c="dimmed">
              ראשון: {fmt(editing.firstSeenAt)} · אחרון: {fmt(editing.lastSeenAt)}
              {editing.userName ? ` · ${editing.userName}${editing.userRole ? ` (${editing.userRole})` : ''}` : ' · אנונימי'}
              {editing.ipAddress ? ` · ${editing.ipAddress}` : ''}
            </Text>
            {editing.correlationId && (
              <Group gap="xs" align="center">
                <Text size="xs" c="dimmed">מספר תקלה:</Text>
                <Code style={mono}>{editing.correlationId}</Code>
                <CopyButton value={editing.correlationId}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'הועתק' : 'העתק'}>
                      <Button size="compact-xs" variant="subtle" onClick={copy}
                        leftSection={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}>
                        {copied ? 'הועתק' : 'העתק'}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            )}
            {editing.routeUrl && <Text size="xs" style={{ direction: 'ltr' }}>{editing.routeUrl}</Text>}

            <Text size="sm" fw={600}>הודעה</Text>
            <Code block style={mono}>{editing.message}</Code>

            {editing.stack && (<><Text size="sm" fw={600}>Stack</Text><Code block style={{ ...mono, maxHeight: 240, overflow: 'auto' }}>{editing.stack}</Code></>)}
            {editing.componentStack && (<><Text size="sm" fw={600}>Component stack</Text><Code block style={{ ...mono, maxHeight: 200, overflow: 'auto' }}>{editing.componentStack}</Code></>)}
            {editing.userAgent && <Text size="xs" c="dimmed" style={{ direction: 'ltr' }}>{editing.userAgent}</Text>}

            <Text size="xs" c="dimmed">שים לב: הטקסט עלול להכיל מידע רפואי מזהה (PHI) — לטיפול בהתאם.</Text>

            <Select label="סטטוס" data={STATUS_OPTIONS} value={editing.status} allowDeselect={false}
              onChange={(v) => v && setEditing({ ...editing, status: v as ErrorStatus })} />
            <Textarea label="הערות מנהל / פתרון" autosize minRows={2} placeholder="מה נעשה / סטטוס הטיפול…"
              value={editing.adminNotes ?? ''}
              onChange={(e) => setEditing({ ...editing, adminNotes: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setEditing(null)}>סגירה</Button>
              <Button loading={updateMut.isPending} onClick={() => editing && updateMut.mutate(editing)}>שמירה</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
