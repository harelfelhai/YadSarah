import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon, Badge, Box, Button, Card, Group, Loader, Modal, Select, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconUserPlus, IconStar, IconSparkles, IconStethoscope, IconPencil } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import { useAuthStore } from '../../store/auth';
import { isReceptionStaff, isClinicalStaff, canPrioritizeQueue, canReassignDepartment, hasAnyRole, ROLE_LABELS } from '../../constants/roles';
import { STATUS_COLOR, STATUS_LABEL } from '../../constants/visitStatus';
import { queueLabel, SPECIAL_QUEUE_LETTER, DEPARTMENTS } from '../../constants/departments';
import type { Visit, VisitStatus } from '../../types';

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


export default function QueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  // Re-render every 30s so wait-time chips stay live.
  const [, setTick] = useState(0);
  // Shift-manager "advance to special queue" confirmation target.
  const [promoteTarget, setPromoteTarget] = useState<Visit | null>(null);
  const [promoting, setPromoting] = useState(false);
  // Clinical "change department" target + chosen department.
  const [reassignTarget, setReassignTarget] = useState<Visit | null>(null);
  const [reassignDept, setReassignDept] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);

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

  const confirmPromote = async () => {
    if (!promoteTarget) return;
    setPromoting(true);
    try {
      await visitsApi.moveToSpecialQueue(promoteTarget.id);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      notifications.show({ color: 'pine', message: 'המטופל קודם לתור המיוחד' });
      setPromoteTarget(null);
    } catch {
      notifications.show({ color: 'brick', message: 'קידום המטופל נכשל' });
    } finally {
      setPromoting(false);
    }
  };

  const openReassign = (visit: Visit) => {
    setReassignTarget(visit);
    setReassignDept(visit.receptionDepartment ?? null);
  };

  const confirmReassign = async () => {
    if (!reassignTarget || !reassignDept) return;
    setReassigning(true);
    try {
      await visitsApi.reassignDepartment(reassignTarget.id, reassignDept);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      notifications.show({ color: 'pine', message: 'המחלקה עודכנה (קביעת איש מקצוע)' });
      setReassignTarget(null);
    } catch {
      notifications.show({ color: 'brick', message: 'עדכון המחלקה נכשל' });
    } finally {
      setReassigning(false);
    }
  };

  const isReception = isReceptionStaff(user?.roles);
  const isClinical = isClinicalStaff(user?.roles);
  const canPrioritize = canPrioritizeQueue(user?.roles);
  const canReassign = canReassignDepartment(user?.roles);

  const active = showAll ? visits : visits.filter((v) => {
    if (v.status === 'Discharged') return false;
    if (v.status === 'FinishedTreatment') return isReception;
    return true;
  });

  const userDept = user?.department ?? null;
  const showDeptHighlight = !!userDept && hasAnyRole(user?.roles, 'Doctor', 'Nurse', 'MedStudent', 'NursingStudent');

  const isSpecial = (v: Visit) => v.queueLetter === SPECIAL_QUEUE_LETTER;

  // Department grouping (own dept first when highlighting), then the special/priority queue
  // floats to the very top regardless — that's what "advancing" a patient means.
  const grouped = showDeptHighlight
    ? [
        ...active.filter((v) => v.receptionDepartment === userDept),
        ...active.filter((v) => v.receptionDepartment !== userDept),
      ]
    : active;
  const sorted = [...grouped.filter(isSpecial), ...grouped.filter((v) => !isSpecial(v))];

  // Find a patient quickly by name / ID (e.g. to open their form).
  const q = search.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((v) => {
        const name = v.patient ? `${v.patient.firstName} ${v.patient.lastName}`.toLowerCase() : '';
        const id = v.patient?.identityNumber ?? '';
        return name.includes(q) || id.includes(q);
      })
    : sorted;

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
          <TextInput
            placeholder="חיפוש לפי שם או ת״ז"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={240}
            maw="100%"
          />
          <Switch
            label="הצג את כל מטופלי היום"
            checked={showAll}
            onChange={(e) => setShowAll(e.currentTarget.checked)}
          />
          {isReception && (
            <Button leftSection={<IconUserPlus size={16} />} onClick={() => navigate('/reception')}>
              קבלת מטופל
            </Button>
          )}
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
      ) : filtered.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">{q ? 'לא נמצאו מטופלים תואמים' : 'אין מטופלים בתור כרגע'}</Text>
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
                <Table.Th style={{ width: 120, whiteSpace: 'nowrap' }}>המתנה</Table.Th>
                <Table.Th style={{ minWidth: 210, whiteSpace: 'nowrap' }}>מחלקה</Table.Th>
                <Table.Th>סיבת קבלה</Table.Th>
                <Table.Th style={{ width: 110 }}>סטטוס</Table.Th>
                <Table.Th style={{ width: 230 }}>פעולות</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((visit, i) => {
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
                      <Group gap={4} wrap="nowrap" align="center">
                        {isSpecial(visit) && (
                          <IconStar size={16} fill="var(--mantine-color-yellow-5)" color="var(--mantine-color-yellow-6)" />
                        )}
                        <Text
                          className={overdue ? 'ys-overdue' : undefined}
                          fw={800}
                          style={{ fontSize: 22, fontFamily: '"Frank Ruhl Libre", serif', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}
                        >
                          {queueLabel(visit.queueLetter, visit.queueNumber)}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={600}>
                        {visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{visit.patient?.identityNumber ?? '—'}</Table.Td>
                    <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{calcAge(visit.patient?.birthDate)}</Table.Td>
                    <Table.Td>{waitChip(visit, wait, overdue)}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap" align="center">
                        {visit.receptionDepartment ? (
                          <Badge variant={isOtherDept ? 'outline' : 'light'} color={isOtherDept ? 'slate' : 'steel'} size="sm">
                            {visit.receptionDepartment}
                          </Badge>
                        ) : <Text c="dimmed">—</Text>}
                        {/* Provenance: a professional override is marked distinctly from an AI recommendation. */}
                        {visit.departmentChangedByName ? (
                          <Tooltip
                            withArrow
                            multiline
                            label={`נקבע ע״י ${visit.departmentChangedByName}${visit.departmentChangedByRole ? ` · ${ROLE_LABELS[visit.departmentChangedByRole] ?? visit.departmentChangedByRole}` : ''}`}
                          >
                            <Badge size="xs" variant="light" color="teal" leftSection={<IconStethoscope size={11} />}>
                              איש מקצוע
                            </Badge>
                          </Tooltip>
                        ) : visit.departmentAssignedByAi ? (
                          <Badge size="xs" variant="light" color="grape" leftSection={<IconSparkles size={11} />}>
                            AI
                          </Badge>
                        ) : null}
                        {canReassign && visit.status !== 'Discharged' && visit.receptionDepartment && (
                          <Tooltip label="שינוי מחלקה" withArrow>
                            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => openReassign(visit)}>
                              <IconPencil size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{visit.admissionReason ?? '—'}</Table.Td>
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
                        {canPrioritize && !isSpecial(visit) && visit.status !== 'Discharged' && (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="yellow"
                            leftSection={<IconStar size={14} />}
                            onClick={() => setPromoteTarget(visit)}
                          >
                            קדם לתור מיוחד
                          </Button>
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

      <Modal
        opened={!!promoteTarget}
        onClose={() => setPromoteTarget(null)}
        title="קידום לתור מיוחד"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            להעביר את{' '}
            {promoteTarget?.patient
              ? `${promoteTarget.patient.firstName} ${promoteTarget.patient.lastName}`
              : 'המטופל'}{' '}
            (מס׳ תור {queueLabel(promoteTarget?.queueLetter, promoteTarget?.queueNumber)}) לתור המיוחד?
            המטופל יקבל מספר חדש בתור המיוחד ויקודם לראש התור.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setPromoteTarget(null)}>ביטול</Button>
            <Button color="yellow" loading={promoting} leftSection={<IconStar size={16} />} onClick={confirmPromote}>
              קדם לתור מיוחד
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!reassignTarget}
        onClose={() => setReassignTarget(null)}
        title="שינוי מחלקה"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            {reassignTarget?.patient
              ? `${reassignTarget.patient.firstName} ${reassignTarget.patient.lastName}`
              : 'המטופל'}
            {' '}— מחלקה נוכחית: {reassignTarget?.receptionDepartment ?? '—'}
          </Text>
          <Select
            label="מחלקה חדשה"
            data={[...DEPARTMENTS]}
            value={reassignDept}
            onChange={setReassignDept}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Text size="xs" c="dimmed">
            השינוי יסומן כקביעת איש מקצוע (לא המלצת AI). מספר התור נשמר.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setReassignTarget(null)}>ביטול</Button>
            <Button
              loading={reassigning}
              disabled={!reassignDept || reassignDept === reassignTarget?.receptionDepartment}
              onClick={confirmReassign}
            >
              שמור מחלקה
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
