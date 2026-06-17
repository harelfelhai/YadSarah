import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon, Badge, Box, Button, Card, Group, Loader, Modal, Stack, Switch, Table, Text, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUserPlus, IconLogout, IconPencil } from '@tabler/icons-react';
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

// Muted status ramp (matches the theme's custom colors)
const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'steel',
  Called: 'ochre',
  InTreatment: 'moss',
  FinishedTreatment: 'pine',
  Discharged: 'slate',
};

// Resolved hex for the leading status rail (var refs would need theme lookup)
const RAIL_HEX: Record<VisitStatus, string> = {
  Waiting: '#2e5a7d',
  Called: '#a9761f',
  InTreatment: '#2f6b4f',
  FinishedTreatment: '#37706b',
  Discharged: '#8a96a1',
};

// A waiting patient past this many minutes is "overdue" → rail pulses in alert red.
const OVERDUE_MIN = 30;

const DEPT_AWARE_ROLES = new Set(['Doctor', 'Nurse']);
const RECEPTION_ROLES = new Set(['Reception', 'ShiftManager', 'Admin']);

export default function QueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAll, setShowAll] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<Visit | null>(null);
  const [discharging, setDischarging] = useState(false);
  // Re-render every 30s so wait-time chips stay live.
  const [, setTick] = useState(0);

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

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const confirmDischarge = async () => {
    if (!dischargeTarget) return;
    setDischarging(true);
    try {
      await visitsApi.updateStatus(dischargeTarget.id, 'Discharged');
      notifications.show({ color: 'pine', message: 'המטופל שוחרר' });
      setDischargeTarget(null);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch {
      notifications.show({ color: 'brick', message: 'שחרור המטופל נכשל' });
    } finally {
      setDischarging(false);
    }
  };

  const callPatient = async (visit: Visit) => {
    try {
      await visitsApi.updateStatus(visit.id, 'Called');
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch {
      notifications.show({ color: 'brick', message: 'הקריאה למטופל נכשלה' });
    }
  };

  const startTreatment = async (visit: Visit) => {
    try {
      await visitsApi.updateStatus(visit.id, 'InTreatment');
      navigate(`/visits/${visit.id}`);
    } catch {
      notifications.show({ color: 'brick', message: 'פתיחת הטופס נכשלה' });
    }
  };

  const isReception = RECEPTION_ROLES.has(user?.role ?? '');
  const isClinical = ['Doctor', 'Nurse', 'ShiftManager', 'Admin'].includes(user?.role ?? '');

  const active = showAll ? visits : visits.filter((v) => {
    if (v.status === 'Discharged') return false;
    if (v.status === 'FinishedTreatment') return isReception;
    return true;
  });

  const userDept = user?.department ?? null;
  const showDeptHighlight = !!userDept && DEPT_AWARE_ROLES.has(user?.role ?? '');

  const sorted = showDeptHighlight
    ? [
        ...active.filter((v) => v.receptionDepartment === userDept),
        ...active.filter((v) => v.receptionDepartment !== userDept),
      ]
    : active;

  // Live status counts for the summary strip (over the loaded set).
  const counts = active.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});
  const COUNT_ORDER: VisitStatus[] = ['Waiting', 'Called', 'InTreatment', 'FinishedTreatment', 'Discharged'];

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="flex-end">
        <Box>
          <Title order={3}>תור — רפואה דחופה</Title>
          <Text size="sm" c="dimmed">לוח טיפול חי · {sorted.length} מטופלים פעילים</Text>
        </Box>
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

      {/* Live status-count strip */}
      <Group gap={0} wrap="wrap" style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}>
        {COUNT_ORDER.filter((s) => showAll || s !== 'Discharged').map((s) => (
          <Box
            key={s}
            px="lg"
            py="xs"
            style={{ flex: '1 1 0', minWidth: 110, borderInlineStart: `4px solid ${RAIL_HEX[s]}`, textAlign: 'center' }}
          >
            <Text fw={800} size="xl" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
              {counts[s] ?? 0}
            </Text>
            <Text size="xs" c="dimmed">{STATUS_LABEL[s]}</Text>
          </Box>
        ))}
      </Group>

      {showDeptHighlight && (
        <Text size="xs" c="dimmed">
          מודגשים: מטופלי המחלקה שלך ({userDept}) · מטופלי מחלקות אחרות מוצגים בעמעום.
        </Text>
      )}

      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : sorted.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">אין מטופלים בתור כרגע</Text>
        </Card>
      ) : (
        <Box style={{ border: '1px solid var(--line)', background: 'var(--surface)', overflowX: 'auto' }}>
          <Table horizontalSpacing="md" verticalSpacing="sm" withTableBorder={false} miw={1320} styles={{ th: { whiteSpace: 'nowrap' }, td: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 70 }}>מס׳ תור</Table.Th>
                <Table.Th>שם</Table.Th>
                <Table.Th>ת.ז / מזהה</Table.Th>
                <Table.Th style={{ width: 56 }}>גיל</Table.Th>
                <Table.Th style={{ width: 90 }}>שעת הגעה</Table.Th>
                <Table.Th style={{ width: 120, whiteSpace: 'nowrap' }}>המתנה</Table.Th>
                <Table.Th style={{ minWidth: 150, whiteSpace: 'nowrap' }}>מחלקה</Table.Th>
                <Table.Th>סיבת קבלה</Table.Th>
                <Table.Th style={{ width: 110 }}>סטטוס</Table.Th>
                <Table.Th style={{ width: 230 }}>פעולות</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((visit, i) => {
                const isOtherDept = showDeptHighlight && visit.receptionDepartment !== userDept;
                const wait = waitMinutes(visit);
                const overdue = visit.status === 'Waiting' && wait >= OVERDUE_MIN;
                const railColor = overdue ? 'var(--alert)' : RAIL_HEX[visit.status];
                return (
                  <Table.Tr
                    key={visit.id}
                    className="ys-row-in"
                    style={{
                      animationDelay: `${Math.min(i, 12) * 25}ms`,
                      opacity: isOtherDept ? 0.5 : 1,
                      background: isOtherDept ? 'var(--mantine-color-slate-0)' : undefined,
                    }}
                  >
                    <Table.Td style={{ borderInlineStart: `4px solid ${railColor}` }}>
                      <Text
                        className={overdue ? 'ys-overdue' : undefined}
                        fw={800}
                        style={{ fontSize: 22, fontFamily: '"Frank Ruhl Libre", serif', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}
                      >
                        {visit.queueNumber}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={600}>
                        {visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{visit.patient?.identityNumber ?? '—'}</Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{calcAge(visit.patient?.birthDate)}</Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{shortTime(visit.admissionTime)}</Table.Td>
                    <Table.Td>{waitChip(visit, wait, overdue)}</Table.Td>
                    <Table.Td>
                      {visit.receptionDepartment ? (
                        <Badge variant={isOtherDept ? 'outline' : 'light'} color={isOtherDept ? 'slate' : 'steel'} size="sm">
                          {visit.receptionDepartment}
                        </Badge>
                      ) : '—'}
                    </Table.Td>
                    <Table.Td>{visit.admissionReason ?? visit.admissionReasonFree ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[visit.status]} variant="light">
                        {STATUS_LABEL[visit.status]}
                      </Badge>
                      {visit.status === 'InTreatment' && (visit.treatingUserName || visit.treatmentRoom) && (
                        <Text size="xs" c="dimmed" mt={4} style={{ whiteSpace: 'nowrap' }}>
                          {visit.treatingUserName ?? ''}
                          {visit.treatingUserName && visit.treatmentRoom ? ' · ' : ''}
                          {visit.treatmentRoom ?? ''}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="center" wrap="nowrap">
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
                        {isReception && visit.status !== 'Discharged' && (
                          <Button
                            size="xs"
                            color="pine"
                            variant={visit.status === 'FinishedTreatment' ? 'filled' : 'light'}
                            leftSection={<IconLogout size={14} />}
                            onClick={() => setDischargeTarget(visit)}
                          >
                            שחרר
                          </Button>
                        )}
                        {visit.patient && (
                          <Tooltip label="עריכת פרטי מטופל">
                            <ActionIcon
                              variant="subtle"
                              color="slate"
                              size="lg"
                              aria-label="עריכת פרטי מטופל"
                              onClick={() => navigate(`/patients/${visit.patient!.id}/edit`)}
                            >
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Box>
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
            <Button variant="subtle" color="slate" onClick={() => setDischargeTarget(null)}>ביטול</Button>
            <Button color="pine" loading={discharging} leftSection={<IconLogout size={16} />} onClick={confirmDischarge}>
              שחרר מטופל
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function calcAge(birthDate?: string): string {
  if (!birthDate) return '—';
  const diff = Date.now() - new Date(birthDate).getTime();
  return `${Math.floor(diff / (1000 * 60 * 60 * 24 * 365))}`;
}

function shortTime(t?: string): string {
  if (!t) return '—';
  return t.slice(0, 5); // HH:mm
}

function waitMinutes(v: Visit): number {
  if (!v.admissionDate || !v.admissionTime) return 0;
  const dt = new Date(`${v.admissionDate}T${v.admissionTime.length === 5 ? v.admissionTime + ':00' : v.admissionTime}`);
  const m = Math.floor((Date.now() - dt.getTime()) / 60000);
  return Number.isFinite(m) && m > 0 ? m : 0;
}

function waitChip(v: Visit, wait: number, overdue: boolean) {
  if (v.status === 'Discharged' || v.status === 'FinishedTreatment') return <Text c="dimmed">—</Text>;
  const label = wait < 60 ? `${wait} ד׳` : `${Math.floor(wait / 60)}ש ${wait % 60}ד׳`;
  return (
    <Badge variant={overdue ? 'filled' : 'light'} color={overdue ? 'brick' : 'slate'} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {label}
    </Badge>
  );
}
