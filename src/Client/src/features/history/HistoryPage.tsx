import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Loader, Pagination, Select, Stack, Table, Text,
  TextInput, Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch, IconX, IconClock } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { visitsApi, type VisitHistoryItem } from '../../api/visits';
import { DEPARTMENTS } from '../../constants/departments';
import type { VisitStatus } from '../../types';
import DateField from '../../components/DateField';

const STATUS_LABEL: Record<VisitStatus, string> = {
  Waiting: 'בהמתנה', Called: 'נקרא', InTreatment: 'בטיפול',
  FinishedTreatment: 'סיים טיפול', Discharged: 'שוחרר',
};
const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'steel', Called: 'ochre', InTreatment: 'moss',
  FinishedTreatment: 'pine', Discharged: 'slate',
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters live in the URL so they survive navigating to a visit and back.
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [staff, setStaff] = useState(searchParams.get('staff') ?? '');
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [department, setDepartment] = useState<string | null>(searchParams.get('department'));
  // Status filter is separate from the "recent 24h" default: defaults to Discharged
  // (completed visits), but can be switched to any status or cleared to show all.
  const [status, setStatus] = useState<string | null>(searchParams.get('status') ?? 'Discharged');
  const [page, setPage] = useState(Number(searchParams.get('page') ?? 0));

  const [dq] = useDebouncedValue(q, 300);
  const [dStaff] = useDebouncedValue(staff, 300);

  const hasFilter = !!(dq || dStaff || from || to || department);

  // Sync state → URL (replace, no history spam) so the back button restores filters + page.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (dq) sp.set('q', dq);
    if (dStaff) sp.set('staff', dStaff);
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (department) sp.set('department', department);
    if (status) sp.set('status', status);
    if (page) sp.set('page', String(page));
    setSearchParams(sp, { replace: true });
  }, [dq, dStaff, from, to, department, status, page, setSearchParams]);

  const { data, isFetching } = useQuery({
    queryKey: ['history', dq, dStaff, from, to, department, status, page],
    queryFn: () => visitsApi.history({
      q: dq || undefined, staff: dStaff || undefined,
      from: from || undefined, to: to || undefined,
      department: department || undefined, status: status || undefined, page,
    }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromRow = total === 0 ? 0 : page * pageSize + 1;
  const toRow = Math.min((page + 1) * pageSize, total);

  // Changing a filter resets to the first page (handlers, so a remount keeps the URL page).
  const onFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0); };
  const clear = () => { setQ(''); setStaff(''); setFrom(''); setTo(''); setDepartment(null); setStatus('Discharged'); setPage(0); };

  return (
    <Stack gap="md" p="md">
      <Title order={3}>היסטוריית מטופלים</Title>

      {/* Filters */}
      <Card withBorder p="md" radius="md">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput
            label="חיפוש מטופל"
            placeholder="שם פרטי / משפחה / ת״ז — תוצאות תוך כדי הקלדה"
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => onFilter(setQ)(e.currentTarget.value)}
            flex={1}
            miw={220}
          />
          <TextInput
            label="צוות מטפל"
            placeholder="רופא / אחות"
            value={staff}
            onChange={(e) => onFilter(setStaff)(e.currentTarget.value)}
            w={170}
          />
          <Select label="מחלקה" data={[...DEPARTMENTS]} clearable value={department} onChange={onFilter(setDepartment)} w={150} />
          <Select
            label="סטטוס"
            data={(Object.keys(STATUS_LABEL) as VisitStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            placeholder="כל הסטטוסים"
            clearable
            value={status}
            onChange={onFilter(setStatus)}
            w={150}
          />
          <DateField label="מתאריך" value={from} onChange={(e) => onFilter(setFrom)(e.currentTarget.value)} w={150} />
          <DateField label="עד תאריך" value={to} onChange={(e) => onFilter(setTo)(e.currentTarget.value)} w={150} />
        </Group>

        <Group justify="space-between" mt="sm">
          <Group gap="xs">
            {!hasFilter ? (
              <Badge variant="light" color="gray" leftSection={<IconClock size={12} />}>
                24 השעות האחרונות
              </Badge>
            ) : (
              <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={clear}>
                נקה סינון
              </Button>
            )}
            {isFetching && <Loader size="xs" />}
          </Group>
          <Text size="xs" c="dimmed">המטופלים שלי בראש</Text>
        </Group>
      </Card>

      {/* Results */}
      <Card withBorder p="md" radius="md">
        {rows.length === 0 && !isFetching ? (
          <Text c="dimmed" size="sm">
            {hasFilter ? 'לא נמצאו ביקורים תואמים.' : 'אין ביקורים ב-24 השעות האחרונות.'}
          </Text>
        ) : (
          <>
            <Box style={{ overflowX: 'auto' }}>
              <Table striped highlightOnHover withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>תאריך</Table.Th>
                    <Table.Th>שעה</Table.Th>
                    <Table.Th>מטופל</Table.Th>
                    <Table.Th>ת״ז</Table.Th>
                    <Table.Th>מחלקה</Table.Th>
                    <Table.Th>צוות מטפל</Table.Th>
                    <Table.Th>סטטוס</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((v: VisitHistoryItem) => (
                    <Table.Tr
                      key={v.visitId}
                      bg={v.relatedTier === 0 ? 'var(--mantine-color-steel-0)' : undefined}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/visits/${v.visitId}/summary`)}
                    >
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.admissionDate)}</Table.Td>
                      <Table.Td>{v.admissionTime?.slice(0, 5) ?? '—'}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text fw={600}>{v.patientName}</Text>
                          {v.relatedTier === 0 && <Badge size="xs" color="steel">שלי</Badge>}
                          {v.relatedTier === 1 && <Badge size="xs" variant="light" color="slate">מחלקתי</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td>{v.identityNumber ?? '—'}</Table.Td>
                      <Table.Td>{v.department ?? '—'}</Table.Td>
                      <Table.Td>
                        <StaffCell signedByName={v.signedByName} editors={v.editors} />
                      </Table.Td>
                      <Table.Td>
                        <Badge color={STATUS_COLOR[v.status]} variant="light">{STATUS_LABEL[v.status]}</Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>

            <Group justify="space-between" mt="md">
              <Text size="xs" c="dimmed">מציג {fromRow}-{toRow} מתוך {total}</Text>
              {totalPages > 1 && (
                <Pagination value={page + 1} onChange={(p) => setPage(p - 1)} total={totalPages} size="sm" />
              )}
            </Group>
          </>
        )}
      </Card>
    </Stack>
  );
}

function StaffCell({ signedByName, editors }: { signedByName?: string | null; editors: string[] }) {
  const otherEditors = editors.filter((e) => e !== signedByName);
  if (!signedByName && otherEditors.length === 0) return <Text size="xs" c="dimmed">—</Text>;
  return (
    <Stack gap={2}>
      {signedByName && (
        <Text size="xs"><Text span c="dimmed">חתם: </Text>{signedByName}</Text>
      )}
      {otherEditors.length > 0 && (
        <Text size="xs"><Text span c="dimmed">ערכו: </Text>{otherEditors.join(', ')}</Text>
      )}
    </Stack>
  );
}
