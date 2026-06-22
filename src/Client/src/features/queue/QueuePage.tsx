import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Group, Loader, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconUserPlus, IconStar, IconSparkles, IconStethoscope } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import { useAuthStore } from '../../store/auth';
import { isReceptionStaff, isClinicalStaff, hasAnyRole, ROLE_LABELS } from '../../constants/roles';
import { STATUS_COLOR, STATUS_LABEL } from '../../constants/visitStatus';
import { queueLabel, SPECIAL_QUEUE_LETTER } from '../../constants/departments';
import CareStepList from '../../components/CareStepList';
import type { CareStep, CareStepAction, CareStepStatus, Visit, VisitStatus } from '../../types';

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

  // Per-step action: call (page) / enter (admit) / complete. Entering a clinician step opens
  // that track's form. The cache is updated optimistically so the status flips instantly (instead
  // of waiting for the refetch / SignalR round-trip), then reconciled with the server.
  const handleStepAction = async (visit: Visit, step: CareStep, action: CareStepAction) => {
    const optimistic: CareStepStatus = action === 'call' ? 'Called' : action === 'enter' ? 'InProgress' : 'Done';
    queryClient.setQueriesData<Visit[]>({ queryKey: ['queue'] }, (old) =>
      old?.map((v) => v.id !== visit.id ? v : {
        ...v,
        careSteps: v.careSteps?.map((s) => s.id === step.id ? { ...s, status: optimistic } : s),
      }));
    try {
      await visitsApi.updateStep(visit.id, step.id, action);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      if (action === 'enter' && step.category === 'Clinician') navigate(`/visits/${visit.id}`);
    } catch {
      queryClient.invalidateQueries({ queryKey: ['queue'] }); // roll back to server truth
      notifications.show({ color: 'brick', message: 'הפעולה נכשלה' });
    }
  };

  const isReception = isReceptionStaff(user?.roles);
  const isClinical = isClinicalStaff(user?.roles);

  const active = showAll ? visits : visits.filter((v) => {
    if (v.status === 'Discharged') return false;
    if (v.status === 'FinishedTreatment') return isReception;
    return true;
  });

  const userDept = user?.department ?? null;
  const showDeptHighlight = !!userDept && hasAnyRole(user?.roles, 'Doctor', 'Nurse', 'MedStudent', 'NursingStudent');

  const isSpecial = (v: Visit) => v.queueLetter === SPECIAL_QUEUE_LETTER;

  // Ordering: priority tiers are preserved — the special/priority queue floats to the very top,
  // then (when highlighting) the viewer's own department, then everyone else. WITHIN each tier
  // patients are ordered by WAIT TIME (longest-waiting first), not by queue number: now that
  // numbers run per-department (A-1, B-1, …) they're no longer comparable across departments.
  const byWaitDesc = (a: Visit, b: Visit) => waitMinutes(b) - waitMinutes(a);
  const special = active.filter(isSpecial).sort(byWaitDesc);
  const rest = active.filter((v) => !isSpecial(v));
  const ordered = showDeptHighlight
    ? [
        ...rest.filter((v) => v.receptionDepartment === userDept).sort(byWaitDesc),
        ...rest.filter((v) => v.receptionDepartment !== userDept).sort(byWaitDesc),
      ]
    : [...rest].sort(byWaitDesc);
  const sorted = [...special, ...ordered];

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
                <Table.Th style={{ minWidth: 340 }}>סטטוס</Table.Th>
                <Table.Th style={{ width: 170 }}>פעולות</Table.Th>
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
                        {/* Dual classification (women's + other) — shown as a second badge on the one row. */}
                        {visit.secondaryDepartment && (
                          <Badge variant="light" color="grape" size="sm">+ {visit.secondaryDepartment}</Badge>
                        )}
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
                      </Group>
                    </Table.Td>
                    <Table.Td>{visit.admissionReason ?? '—'}</Table.Td>
                    <Table.Td>
                      <CareStepList
                        steps={visit.careSteps}
                        isClinical={isClinical}
                        onAction={(step, action) => handleStepAction(visit, step, action)}
                        fallback={
                          <Badge color={STATUS_COLOR[visit.status]} variant="light">
                            {STATUS_LABEL[visit.status]}
                          </Badge>
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="center" wrap="nowrap">
                        {isClinical && (
                          <Button size="xs" variant="outline" onClick={() => navigate(`/visits/${visit.id}`)}>
                            טופס
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
  // Use the real arrival instant (createdAt, UTC). NOT admissionDate+admissionTime: admissionDate is
  // the "queue-day", which before the 18:00 reset is the PREVIOUS calendar date — combined with the
  // real admissionTime that read ~24h for every just-arrived patient.
  if (!v.createdAt) return 0;
  const m = Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 60000);
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
