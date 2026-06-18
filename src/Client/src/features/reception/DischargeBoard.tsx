import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Loader, Table, Text, TextInput,
} from '@mantine/core';
import { IconLogout, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import { STATUS_COLOR, STATUS_LABEL } from '../../constants/visitStatus';
import type { Visit } from '../../types';

// Patients who finished treatment (doctor signed) are the ones literally waiting
// to be released — float them to the top of the board.
function dischargeRank(v: Visit): number {
  return v.status === 'FinishedTreatment' ? 0 : 1;
}

export default function DischargeBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Same live source as the clinical queue: current queue-day, non-discharged.
  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['queue', false],
    queryFn: () => visitsApi.getQueue(false),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const off = onQueueUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    });
    return off;
  }, [queryClient]);

  const sorted = [...visits].sort(
    (a, b) => dischargeRank(a) - dischargeRank(b) || a.queueNumber - b.queueNumber,
  );
  const waitingCount = visits.filter((v) => v.status === 'FinishedTreatment').length;

  // A patient coming to be released gives their name / ID at reception — filter by it.
  const q = search.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((v) => {
        const name = v.patient ? `${v.patient.firstName} ${v.patient.lastName}`.toLowerCase() : '';
        const id = v.patient?.identityNumber ?? '';
        return name.includes(q) || id.includes(q);
      })
    : sorted;

  return (
    <Box>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap" gap="sm">
        <Text size="sm" c="dimmed">
          {waitingCount} ממתינים לשחרור · {sorted.length} מטופלים פעילים
        </Text>
        <TextInput
          placeholder="חיפוש לפי שם או ת״ז"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={260}
          maw="100%"
        />
      </Group>

      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : filtered.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">{q ? 'לא נמצאו מטופלים תואמים' : 'אין מטופלים לשחרור כרגע'}</Text>
        </Card>
      ) : (
        <Box style={{ border: '1px solid var(--line)', background: 'var(--surface)', overflowX: 'auto' }}>
          <Table horizontalSpacing="md" verticalSpacing="sm" miw={900} styles={{ th: { whiteSpace: 'nowrap' }, td: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 70 }}>מס׳ תור</Table.Th>
                <Table.Th>שם</Table.Th>
                <Table.Th style={{ width: 150 }}>ת.ז / מזהה</Table.Th>
                <Table.Th style={{ width: 120 }}>מחלקה</Table.Th>
                <Table.Th style={{ width: 200 }}>סטטוס</Table.Th>
                <Table.Th style={{ width: 160 }}>פעולות</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((visit) => {
                const ready = visit.status === 'FinishedTreatment';
                return (
                  <Table.Tr key={visit.id} bg={ready ? 'var(--mantine-color-pine-0)' : undefined}>
                    <Table.Td>
                      <Text fw={800} style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
                        {visit.queueNumber}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={600}>
                        {visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{visit.patient?.identityNumber ?? '—'}</Table.Td>
                    <Table.Td>
                      {visit.receptionDepartment
                        ? <Badge variant="light" color="steel" size="sm">{visit.receptionDepartment}</Badge>
                        : '—'}
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'normal' }}>
                      <Group gap={6} wrap="wrap">
                        <Badge color={STATUS_COLOR[visit.status]} variant="light">{STATUS_LABEL[visit.status]}</Badge>
                        {ready && <Badge color="pine" variant="dot" size="sm">ממתין לשחרור</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        color="pine"
                        variant={ready ? 'filled' : 'light'}
                        leftSection={<IconLogout size={14} />}
                        onClick={() => navigate(`/reception/discharge/${visit.id}`)}
                      >
                        שחרר מטופל
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
