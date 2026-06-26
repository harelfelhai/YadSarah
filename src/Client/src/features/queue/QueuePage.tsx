import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ActionIcon, Badge, Box, Button, Card, Group, Loader, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSearch, IconUserPlus, IconStar, IconSpeakerphone, IconDoorEnter, IconCheck, IconX,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { onQueueUpdate } from '../../realtime/hub';
import { useAuthStore } from '../../store/auth';
import { isReceptionStaff, isClinicalStaff, hasAnyRole, getViewerTrack, canActOnStep, canEnterStep } from '../../constants/roles';
import { STATUS_LABEL } from '../../constants/visitStatus';
import { queueLabel, SPECIAL_QUEUE_LETTER } from '../../constants/departments';
import CareStepList from '../../components/CareStepList';
import type { CareStep, CareStepAction, CareStepStatus, UserRole, Visit, VisitStatus } from '../../types';

// A single muted, neutral rail/divider tone — no loud per-status colors (kept subtle by request).
const RAIL = 'var(--mantine-color-slate-3)';

// A waiting patient past this many minutes is "overdue" → the wait chip gets a subtle emphasis.
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
    // Avoid an extra refetch/re-render on window refocus that could interrupt a row click.
    refetchOnWindowFocus: false,
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
    // Claim / release: a soft doctor assignment — no status change, just stamp/clear the claiming doctor.
    if (action === 'claim' || action === 'release') {
      const claimedByName = action === 'claim' ? (user?.fullName ?? '') : null;
      const claimedByUserId = action === 'claim' ? (user?.id ?? null) : null;
      queryClient.setQueriesData<Visit[]>({ queryKey: ['queue'] }, (old) =>
        old?.map((v) => v.id !== visit.id ? v : {
          ...v,
          careSteps: v.careSteps?.map((s) => s.id === step.id ? { ...s, claimedByName, claimedByUserId } : s),
        }));
      try {
        await visitsApi.updateStep(visit.id, step.id, action);
        queryClient.invalidateQueries({ queryKey: ['queue'] });
      } catch {
        queryClient.invalidateQueries({ queryKey: ['queue'] }); // roll back to server truth
        notifications.show({ color: 'brick', message: 'הפעולה נכשלה' });
      }
      return;
    }
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

  // Manager (Admin/ShiftManager) "call to me" presence — parallel to the clinical track, does not
  // change "waiting-for". Optimistically stamps the manager's name + state, then reconciles.
  const handleManagerPresence = async (visit: Visit, action: 'call' | 'enter' | 'clear') => {
    const state = action === 'call' ? 'Called' : action === 'enter' ? 'Present' : 'None';
    queryClient.setQueriesData<Visit[]>({ queryKey: ['queue'] }, (old) =>
      old?.map((v) => v.id !== visit.id ? v : {
        ...v,
        managerPresenceState: state as Visit['managerPresenceState'],
        managerPresenceName: action === 'clear' ? null : (user?.fullName ?? ''),
      }));
    try {
      await visitsApi.managerPresence(visit.id, action);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      notifications.show({ color: 'brick', message: 'הפעולה נכשלה' });
    }
  };

  const isReception = isReceptionStaff(user?.roles);
  const isClinical = isClinicalStaff(user?.roles);
  // Who may "take a patient under their care": doctors (and shift-managers/admins acting clinically).
  const canClaim = hasAnyRole(user?.roles, 'Doctor', 'ShiftManager', 'Admin');

  const active = showAll ? visits : visits.filter((v) => {
    if (v.status === 'Discharged') return false;
    if (v.status === 'FinishedTreatment') return isReception;
    return true;
  });

  const userDept = user?.department ?? null;
  const showDeptHighlight = !!userDept && hasAnyRole(user?.roles, 'Doctor', 'Nurse', 'MedStudent', 'NursingStudent');

  const isSpecial = (v: Visit) => v.queueLetter === SPECIAL_QUEUE_LETTER;
  // A patient taken by a doctor sinks BELOW unclaimed ones — but ONLY for the OTHER doctors (so they
  // skip an already-taken patient). NOT for the claiming doctor (it's their patient → stays in place)
  // and NOT for nurses/other staff (who don't pick up doctor patients). Hence it depends on the viewer.
  const isClaimedByOther = (v: Visit) => canClaim && !!v.careSteps?.some((s) =>
    s.category === 'Clinician' && s.clinicianRole === 'Doctor' &&
    !!s.claimedByUserId && s.claimedByUserId !== user?.id &&
    (s.status === 'Waiting' || s.status === 'Called'));

  // ── Role-aware ordering (items 6 + 9) ───────────────────────────────────────
  // The viewer's "track": nurse → nurse steps, doctor → doctor steps, lab/tech → their assigned
  // station's steps. Patients WAITING for the viewer's own track float to the top (subtle highlight).
  // For a doctor specifically: a patient who still has a pending station/lab is NOT yet ready for the
  // doctor (they'll be seen after the tests) → sinks below those waiting only for a doctor.
  const viewerTrack = getViewerTrack(user?.roles);
  const viewerStation = user?.station ?? null;
  const isActiveStep = (s: CareStep) => s.status === 'Waiting' || s.status === 'Called';
  const hasPendingStation = (v: Visit) => !!v.careSteps?.some((s) =>
    s.category === 'Station' && s.status !== 'Done' && s.status !== 'Canceled');
  const waitingForMyTrack = (v: Visit): boolean => {
    const steps = v.careSteps ?? [];
    if (viewerTrack === 'Nurse') return steps.some((s) => s.category === 'Clinician' && s.clinicianRole === 'Nurse' && isActiveStep(s));
    if (viewerTrack === 'Doctor') return steps.some((s) => s.category === 'Clinician' && s.clinicianRole === 'Doctor' && isActiveStep(s));
    if (viewerTrack === 'Lab') return steps.some((s) => s.category === 'Station' && isActiveStep(s) && (!viewerStation || s.label === viewerStation));
    return false;
  };
  // A doctor's patient who is still waiting on a station isn't ready for the doctor yet.
  const doctorNotReady = (v: Visit) => viewerTrack === 'Doctor' && hasPendingStation(v);
  // True for the rows we float to the top + tint (waiting for my track and, for a doctor, ready).
  const myTurn = (v: Visit) => waitingForMyTrack(v) && !doctorNotReady(v);
  const rankOf = (v: Visit): number => {
    if (myTurn(v)) return 0;                                            // waiting for me (ready) → top
    if (showDeptHighlight && v.receptionDepartment === userDept) return 1; // my department
    if (doctorNotReady(v)) return 3;                                   // pending station → below the rest
    return 2;
  };
  // WITHIN a rank, claimed-by-another sinks, then longest-waiting first (queue numbers run per-letter
  // so they're not comparable).
  const byClaimThenWait = (a: Visit, b: Visit) =>
    (isClaimedByOther(a) ? 1 : 0) - (isClaimedByOther(b) ? 1 : 0) || waitMinutes(b) - waitMinutes(a);
  const cmp = (a: Visit, b: Visit) => rankOf(a) - rankOf(b) || byClaimThenWait(a, b);
  const special = active.filter(isSpecial).sort(cmp);
  const sorted = [...special, ...active.filter((v) => !isSpecial(v)).sort(cmp)];

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
            style={{ flex: '1 1 0', minWidth: 110, borderInlineStart: `4px solid ${RAIL}`, textAlign: 'center' }}
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
          <Table horizontalSpacing="md" verticalSpacing="sm" withTableBorder={false} miw={1600} styles={{ th: { whiteSpace: 'nowrap' }, td: { whiteSpace: 'nowrap' } }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 110, textAlign: 'center' }}>פעולות</Table.Th>
                <Table.Th style={{ width: 70 }}>מס׳ תור</Table.Th>
                <Table.Th>שם</Table.Th>
                <Table.Th>ת.ז / מזהה</Table.Th>
                <Table.Th style={{ width: 56 }}>גיל</Table.Th>
                <Table.Th style={{ width: 120, whiteSpace: 'nowrap' }}>המתנה</Table.Th>
                <Table.Th style={{ minWidth: 210, whiteSpace: 'nowrap' }}>מחלקה</Table.Th>
                <Table.Th>סיבת קבלה</Table.Th>
                <Table.Th style={{ minWidth: 150 }}>אחות</Table.Th>
                <Table.Th style={{ minWidth: 150 }}>רופא</Table.Th>
                <Table.Th style={{ minWidth: 170 }}>בדיקות ומעבדות</Table.Th>
                <Table.Th style={{ minWidth: 150 }}>גורם אחראי</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((visit, i) => {
                const isOtherDept = showDeptHighlight && visit.receptionDepartment !== userDept;
                const wait = waitMinutes(visit);
                const overdue = visit.status === 'Waiting' && wait >= OVERDUE_MIN;
                // Status is split into three per-track columns: nurse / doctor / everything else
                // (stations = "בדיקות ומעבדות"). Terminal visits have no active steps, so surface the
                // overall status once (in the nurse column) instead of three empty cells.
                const careSteps = visit.careSteps ?? [];
                const nurseSteps = careSteps.filter((s) => s.category === 'Clinician' && s.clinicianRole === 'Nurse');
                const doctorSteps = careSteps.filter((s) => s.category === 'Clinician' && s.clinicianRole === 'Doctor');
                const testSteps = careSteps.filter((s) => !(s.category === 'Clinician' && (s.clinicianRole === 'Nurse' || s.clinicianRole === 'Doctor')));
                const terminalBadge = (visit.status === 'Discharged' || visit.status === 'FinishedTreatment')
                  ? <Badge color="slate" variant="light">{STATUS_LABEL[visit.status]}</Badge>
                  : undefined;
                return (
                  <Table.Tr
                    key={visit.id}
                    className="ys-row-in"
                    onClick={isClinical ? () => navigate(`/visits/${visit.id}`) : undefined}
                    style={{
                      animationDelay: `${Math.min(i, 12) * 25}ms`,
                      // Own-track-waiting rows get a subtle tint + stay full opacity (even if another dept).
                      opacity: isOtherDept && !myTurn(visit) ? 0.5 : 1,
                      background: myTurn(visit)
                        ? 'var(--mantine-color-slate-1)'
                        : isOtherDept ? 'var(--mantine-color-slate-0)' : undefined,
                      cursor: isClinical ? 'pointer' : undefined,
                    }}
                  >
                    <Table.Td onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"],[role="option"],[role="listbox"]')) e.stopPropagation(); }} style={{ borderInlineStart: `4px solid ${RAIL}`, textAlign: 'center', width: 110 }}>
                      <AutoActionIcons
                        visit={visit}
                        userRoles={user?.roles}
                        station={user?.station}
                        onStep={(step, action) => handleStepAction(visit, step, action)}
                        onManager={(action) => handleManagerPresence(visit, action)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" align="center">
                        {isSpecial(visit) && (
                          <IconStar size={16} fill="var(--mantine-color-slate-4)" color="var(--mantine-color-slate-5)" />
                        )}
                        <Text
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
                          <Badge variant={isOtherDept ? 'outline' : 'light'} color="slate" size="sm">
                            {visit.receptionDepartment}
                          </Badge>
                        ) : <Text c="dimmed">—</Text>}
                        {/* Dual classification (women's + other) — shown as a second badge on the one row. */}
                        {visit.secondaryDepartment && (
                          <Badge variant="light" color="slate" size="sm">+ {visit.secondaryDepartment}</Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{visit.admissionReason ?? '—'}</Table.Td>
                    <Table.Td onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"],[role="option"],[role="listbox"]')) e.stopPropagation(); }}>
                      <CareStepList
                        steps={nurseSteps}
                        isClinical={isClinical}
                        userRoles={user?.roles}
                        hideActionButtons
                        onAction={(step, action) => handleStepAction(visit, step, action)}
                        fallback={terminalBadge}
                      />
                    </Table.Td>
                    <Table.Td onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"],[role="option"],[role="listbox"]')) e.stopPropagation(); }}>
                      <CareStepList
                        steps={doctorSteps}
                        isClinical={isClinical}
                        userRoles={user?.roles}
                        hideActionButtons
                        onAction={(step, action) => handleStepAction(visit, step, action)}
                      />
                    </Table.Td>
                    <Table.Td onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"],[role="option"],[role="listbox"]')) e.stopPropagation(); }}>
                      <CareStepList
                        steps={testSteps}
                        isClinical={isClinical}
                        userRoles={user?.roles}
                        hideActionButtons
                        onAction={(step, action) => handleStepAction(visit, step, action)}
                      />
                    </Table.Td>
                    <Table.Td onClick={(e) => { if ((e.target as HTMLElement).closest('button,a,input,textarea,select,[role="button"],[role="combobox"],[role="option"],[role="listbox"]')) e.stopPropagation(); }}>
                      <ResponsibleParty
                        visit={visit}
                        canClaim={canClaim}
                        currentUserId={user?.id}
                        onAction={(step, action) => handleStepAction(visit, step, action)}
                      />
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
  // Overdue gets a subtle emphasis (filled, same neutral tone) — no alert red, no blinking.
  return (
    <Badge variant={overdue ? 'filled' : 'light'} color="slate" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {label}
    </Badge>
  );
}

// "גורם אחראי" — the doctor responsible for the visit: whoever claimed the doctor step ("שייך אליי")
// or began its treatment. When no doctor has taken it yet, a claim button lets a doctor take the
// patient under their care without starting treatment (the soft assignment behavior of "שייך אליי").
// One entry per active doctor track (a dual women's visit has two); a department label disambiguates.
function ResponsibleParty({
  visit, canClaim, currentUserId, onAction,
}: {
  visit: Visit;
  canClaim: boolean;
  currentUserId?: string;
  onAction: (step: CareStep, action: CareStepAction) => void;
}) {
  const doctorSteps = (visit.careSteps ?? []).filter(
    (s) => s.category === 'Clinician' && s.clinicianRole === 'Doctor' &&
      (s.status === 'Waiting' || s.status === 'Called' || s.status === 'InProgress'));
  // Manager "call to me" presence — parallel to the clinical responsible party, shown to everyone.
  const mp = visit.managerPresenceState && visit.managerPresenceState !== 'None' ? (
    <Badge variant="light" color="slate" size="sm" style={{ whiteSpace: 'nowrap' }}>
      {visit.managerPresenceState === 'Present' ? 'אצל' : 'נקרא ל'} {visit.managerPresenceName || 'מנהל'}
      {visit.managerPresenceRoom ? ` · ${visit.managerPresenceRoom}` : ''}
    </Badge>
  ) : null;
  if (doctorSteps.length === 0) return mp ?? <Text c="dimmed">—</Text>;
  const showDept = doctorSteps.length > 1;

  return (
    <Stack gap={4}>
      {mp}
      {doctorSteps.map((s) => {
        const name = s.claimedByName ?? s.startedByName ?? null;
        const claimedByMe = !!s.claimedByUserId && s.claimedByUserId === currentUserId;
        // Claimable: nobody has it yet (no claim, not in treatment) and it's still a waiting/called step.
        const claimable = (s.status === 'Waiting' || s.status === 'Called') && !s.claimedByUserId && !s.startedByName;
        return (
          <Group key={s.id} gap={6} wrap="nowrap" align="center">
            {showDept && s.department && <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{s.department}:</Text>}
            {name ? (
              <>
                <Badge variant="light" color="slate" size="sm" style={{ whiteSpace: 'nowrap' }}>{name}</Badge>
                {claimedByMe && (
                  <Button size="compact-xs" variant="subtle" color="slate" onClick={() => onAction(s, 'release')}>שחרר</Button>
                )}
              </>
            ) : canClaim && claimable ? (
              <Button size="compact-xs" variant="light" color="slate" onClick={() => onAction(s, 'claim')}>שייך אליי</Button>
            ) : (
              <Text c="dimmed">—</Text>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}

// "פעולות" — role-aware call/enter/complete, as icons, auto-targeting the viewer's own track:
// nurse→nurse step, doctor→doctor step, lab/tech→their assigned station's step (one icon-set per row,
// no need to pick a station). A manager (Admin/ShiftManager) instead gets a parallel "call/enter to me"
// that does NOT change the clinical "waiting-for". Hidden when there's nothing the viewer can act on.
function AutoActionIcons({
  visit, userRoles, station, onStep, onManager,
}: {
  visit: Visit;
  userRoles?: UserRole[];
  station?: string;
  onStep: (step: CareStep, action: CareStepAction) => void;
  onManager: (action: 'call' | 'enter' | 'clear') => void;
}) {
  const track = getViewerTrack(userRoles);
  if (!track) return <Text c="dimmed">—</Text>;

  // Manager: parallel presence (call / enter / clear), unrelated to the clinical track.
  if (track === 'Manager') {
    const state = visit.managerPresenceState ?? 'None';
    return (
      <Group gap={6} justify="center" wrap="nowrap">
        {state === 'None' ? (
          <>
            <Tooltip label="קרא אליי"><ActionIcon variant="light" color="blue" onClick={() => onManager('call')}><IconSpeakerphone size={16} /></ActionIcon></Tooltip>
            <Tooltip label="הכנס אליי"><ActionIcon variant="light" color="green" onClick={() => onManager('enter')}><IconDoorEnter size={16} /></ActionIcon></Tooltip>
          </>
        ) : (
          <Tooltip label={state === 'Present' ? 'נקה (אצלי)' : 'נקה (נקרא אליי)'}>
            <ActionIcon variant="subtle" color="gray" onClick={() => onManager('clear')}><IconX size={16} /></ActionIcon>
          </Tooltip>
        )}
      </Group>
    );
  }

  // Clinical / station track: find the matching active step (prefer the primary-department one
  // when a dual-track visit has two), then expose the action that fits its status.
  const isActive = (s: CareStep) => s.status !== 'Done' && s.status !== 'Canceled';
  const matches = (visit.careSteps ?? []).filter((s) =>
    track === 'Lab'
      ? s.category === 'Station' && isActive(s) && (!station || s.label === station)
      : s.category === 'Clinician' && s.clinicianRole === track && isActive(s));
  if (matches.length === 0) return null;
  const step = matches.find((s) => s.department === visit.receptionDepartment) ?? matches[0];

  const mayAct = canActOnStep(userRoles, step.clinicianRole ?? null);
  const mayEnter = canEnterStep(userRoles, step.clinicianRole ?? null);

  return (
    <Group gap={6} justify="center" wrap="nowrap">
      {step.status === 'Waiting' && mayAct && (
        <Tooltip label="קרא"><ActionIcon variant="light" color="blue" onClick={() => onStep(step, 'call')}><IconSpeakerphone size={16} /></ActionIcon></Tooltip>
      )}
      {(step.status === 'Waiting' || step.status === 'Called') && mayEnter && (
        <Tooltip label="הכנס"><ActionIcon variant="light" color="green" onClick={() => onStep(step, 'enter')}><IconDoorEnter size={16} /></ActionIcon></Tooltip>
      )}
      {step.status === 'InProgress' && mayAct && (
        <Tooltip label="סיים"><ActionIcon variant="light" color="teal" onClick={() => onStep(step, 'complete')}><IconCheck size={16} /></ActionIcon></Tooltip>
      )}
    </Group>
  );
}
