import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Loader, Modal, Stack, Switch, Table, Text, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUserPlus, IconLogout } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import { useAuthStore } from '../../store/auth';
import type { Visit, VisitStatus } from '../../types';

const STATUS_LABEL: Record<VisitStatus, string> = {
  Waiting: 'ממתין',
  Called: 'נקרא',
  InTreatment: 'בטיפול',
  FinishedTreatment: 'סיים טיפול',
  Discharged: 'שוחרר',
};

const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'blue',
  Called: 'yellow',
  InTreatment: 'green',
  FinishedTreatment: 'teal',
  Discharged: 'gray',
};

// Roles that have a home department and should see dept-based highlighting
const DEPT_AWARE_ROLES = new Set(['Doctor', 'Nurse']);

// Reception-side roles that handle discharge/payment after treatment ends
const RECEPTION_ROLES = new Set(['Reception', 'ShiftManager', 'Admin']);

export default function QueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAll, setShowAll] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<Visit | null>(null);
  const [discharging, setDischarging] = useState(false);

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['queue', showAll],
    queryFn: () => visitsApi.getQueue(showAll),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const off = onQueueUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    });
    return off;
  }, [queryClient]);

  const confirmDischarge = async () => {
    if (!dischargeTarget) return;
    setDischarging(true);
    try {
      await visitsApi.updateStatus(dischargeTarget.id, 'Discharged');
      notifications.show({ color: 'teal', message: 'המטופל שוחרר' });
      setDischargeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch {
      notifications.show({ color: 'red', message: 'שחרור המטופל נכשל' });
    } finally {
      setDischarging(false);
    }
  };

  const callPatient = async (visit: Visit) => {
    await visitsApi.updateStatus(visit.id, 'Called');
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  };

  const startTreatment = async (visit: Visit) => {
    await visitsApi.updateStatus(visit.id, 'InTreatment');
    navigate(`/visits/${visit.id}`);
  };

  const isReception = RECEPTION_ROLES.has(user?.role ?? '');
  // Clinical actions (call / open treatment form) require clinical roles — Reception is excluded.
  const isClinical = ['Doctor', 'Nurse', 'ShiftManager', 'Admin'].includes(user?.role ?? '');

  // Clinicians see the active treatment queue (finished patients leave it);
  // reception-side roles also see "סיים טיפול" patients awaiting discharge/payment.
  // "Show all today" overrides the filter and lists everyone admitted this queue-day.
  const active = showAll ? visits : visits.filter((v) => {
    if (v.status === 'Discharged') return false;
    if (v.status === 'FinishedTreatment') return isReception;
    return true;
  });

  // Department-based sorting & highlighting only for dept-aware roles with a dept set
  const userDept = user?.department ?? null;
  const showDeptHighlight = !!userDept && DEPT_AWARE_ROLES.has(user?.role ?? '');

  const sorted = showDeptHighlight
    ? [
        ...active.filter((v) => v.receptionDepartment === userDept),
        ...active.filter((v) => v.receptionDepartment !== userDept),
      ]
    : active;

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>תור — רפואה דחופה</Title>
        <Group gap="md">
          <Switch
            label="הצג את כל מטופלי היום"
            checked={showAll}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => navigate('/reception/new')}>
            קבלת מטופל
          </Button>
        </Group>
      </Group>

      {showDeptHighlight && (
        <Group gap="lg">
          <Group gap="xs">
            <Box w={12} h={12} style={{ background: 'var(--mantine-color-body)', border: '1px solid #dee2e6', borderRadius: 2 }} />
            <Text size="xs" c="dimmed">מטופלי המחלקה שלך ({userDept})</Text>
          </Group>
          <Group gap="xs">
            <Box w={12} h={12} style={{ background: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: 2 }} />
            <Text size="xs" c="dimmed">מחלקות אחרות</Text>
          </Group>
        </Group>
      )}

      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : sorted.length === 0 ? (
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
            {sorted.map((visit) => {
              const isOtherDept = showDeptHighlight && visit.receptionDepartment !== userDept;
              return (
                <Table.Tr
                  key={visit.id}
                  style={isOtherDept ? { opacity: 0.55, background: '#f8f9fa' } : undefined}
                >
                  <Table.Td fw={700}>{visit.queueNumber}</Table.Td>
                  <Table.Td>
                    {visit.patient
                      ? `${visit.patient.firstName} ${visit.patient.lastName}`
                      : '—'}
                  </Table.Td>
                  <Table.Td>{visit.patient?.identityNumber ?? '—'}</Table.Td>
                  <Table.Td>{calcAge(visit.patient?.birthDate)}</Table.Td>
                  <Table.Td>{visit.admissionTime}</Table.Td>
                  <Table.Td>
                    {visit.receptionDepartment
                      ? (
                        <Badge
                          variant={isOtherDept ? 'outline' : 'light'}
                          color={isOtherDept ? 'gray' : 'medicalBlue'}
                          size="sm"
                        >
                          {visit.receptionDepartment}
                        </Badge>
                      )
                      : '—'}
                  </Table.Td>
                  <Table.Td>{visit.admissionReason ?? visit.admissionReasonFree ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[visit.status]} variant="light">
                      {STATUS_LABEL[visit.status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      {isClinical && visit.status === 'Waiting' && (
                        <Button size="xs" variant="light" onClick={() => callPatient(visit)}>
                          קרא למטופל
                        </Button>
                      )}
                      {isClinical && (visit.status === 'Called' || visit.status === 'Waiting') && (
                        <Button size="xs" onClick={() => startTreatment(visit)}>
                          פתח טופס
                        </Button>
                      )}
                      {isClinical && visit.status === 'InTreatment' && (
                        <Button size="xs" variant="outline" onClick={() => navigate(`/visits/${visit.id}`)}>
                          המשך טיפול
                        </Button>
                      )}
                      {visit.status !== 'Discharged' && (
                        <Button size="xs" color="teal" variant={visit.status === 'FinishedTreatment' ? 'filled' : 'light'}
                          leftSection={<IconLogout size={14} />}
                          onClick={() => setDischargeTarget(visit)}>
                          שחרר
                        </Button>
                      )}
                      {visit.patient && (
                        <Tooltip label="עריכת פרטי מטופל">
                          <Button
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={() => navigate(`/patients/${visit.patient!.id}/edit`)}
                          >
                            עריכת פרטים
                          </Button>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!dischargeTarget} onClose={() => setDischargeTarget(null)} title="שחרור מטופל" centered>
        <Stack gap="sm">
          <Text size="sm">
            לשחרר את {dischargeTarget?.patient
              ? `${dischargeTarget.patient.firstName} ${dischargeTarget.patient.lastName}`
              : 'המטופל'} (מס׳ תור {dischargeTarget?.queueNumber})?
            המטופל יוסר מהתור הפעיל.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setDischargeTarget(null)}>ביטול</Button>
            <Button color="teal" loading={discharging} leftSection={<IconLogout size={16} />} onClick={confirmDischarge}>
              שחרר מטופל
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function calcAge(birthDate?: string): string {
  if (!birthDate) return '—';
  const diff = Date.now() - new Date(birthDate).getTime();
  return `${Math.floor(diff / (1000 * 60 * 60 * 24 * 365))}`;
}
