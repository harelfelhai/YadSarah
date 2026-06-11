import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Loader, Stack, Table, Text, Title,
} from '@mantine/core';
import { IconUserPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import type { Visit, VisitStatus } from '../../types';

const STATUS_LABEL: Record<VisitStatus, string> = {
  Waiting: 'ממתין',
  Called: 'נקרא',
  InTreatment: 'בטיפול',
  Discharged: 'שוחרר',
};

const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'blue',
  Called: 'yellow',
  InTreatment: 'green',
  Discharged: 'gray',
};

export default function QueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['queue'],
    queryFn: visitsApi.getQueue,
    refetchInterval: 30_000,
  });

  // Live updates via SignalR
  useEffect(() => {
    const off = onQueueUpdate((update) => {
      queryClient.setQueryData<Visit[]>(['queue'], (prev = []) =>
        prev.map((v) =>
          v.id === update.visitId ? { ...v, status: update.status } : v
        )
      );
    });
    return off;
  }, [queryClient]);

  const callPatient = async (visit: Visit) => {
    await visitsApi.updateStatus(visit.id, 'Called');
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const startTreatment = async (visit: Visit) => {
    await visitsApi.updateStatus(visit.id, 'InTreatment');
    navigate(`/visits/${visit.id}`);
  };

  const active = visits.filter((v) => v.status !== 'Discharged');

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>תור — רפואה דחופה</Title>
        <Button leftSection={<IconUserPlus size={16} />} onClick={() => navigate('/reception/new')}>
          קבלת מטופל
        </Button>
      </Group>

      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : active.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">אין מטופלים בתור כרגע</Text>
        </Card>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>מס׳ תור</Table.Th>
              <Table.Th>שם</Table.Th>
              <Table.Th>ת.ז / מזהה</Table.Th>
              <Table.Th>גיל</Table.Th>
              <Table.Th>שעת הגעה</Table.Th>
              <Table.Th>מחלקה</Table.Th>
              <Table.Th>סיבת קבלה</Table.Th>
              <Table.Th>סטטוס</Table.Th>
              <Table.Th>פעולות</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {active.map((visit) => (
              <Table.Tr key={visit.id}>
                <Table.Td fw={700}>{visit.queueNumber}</Table.Td>
                <Table.Td>
                  {visit.patient
                    ? `${visit.patient.firstName} ${visit.patient.lastName}`
                    : '—'}
                </Table.Td>
                <Table.Td>{visit.patient?.identityNumber ?? '—'}</Table.Td>
                <Table.Td>{calcAge(visit.patient?.birthDate)}</Table.Td>
                <Table.Td>{visit.admissionTime}</Table.Td>
                <Table.Td>{visit.receptionDepartment ?? '—'}</Table.Td>
                <Table.Td>{visit.admissionReason ?? visit.admissionReasonFree ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[visit.status]} variant="light">
                    {STATUS_LABEL[visit.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {visit.status === 'Waiting' && (
                      <Button size="xs" variant="light" onClick={() => callPatient(visit)}>
                        קרא למטופל
                      </Button>
                    )}
                    {(visit.status === 'Called' || visit.status === 'Waiting') && (
                      <Button size="xs" onClick={() => startTreatment(visit)}>
                        פתח טופס
                      </Button>
                    )}
                    {visit.status === 'InTreatment' && (
                      <Button size="xs" variant="outline" onClick={() => navigate(`/visits/${visit.id}`)}>
                        המשך טיפול
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

function calcAge(birthDate?: string): string {
  if (!birthDate) return '—';
  const diff = Date.now() - new Date(birthDate).getTime();
  return `${Math.floor(diff / (1000 * 60 * 60 * 24 * 365))}`;
}
