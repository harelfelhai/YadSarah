import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon, Alert, Autocomplete, Badge, Box, Button, Card, Checkbox, Divider,
  Group, Loader, Modal, MultiSelect, NumberInput, Paper, Select, SegmentedControl, Stack, Table, Text, Textarea, TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck, IconClock, IconEdit, IconEye, IconEyeOff, IconInfoCircle, IconLock, IconLockOpen,
  IconPlus, IconPrinter, IconTrash, IconWriting,
} from '@tabler/icons-react';
import { visitsApi } from '../../api/visits';
import { formsApi } from '../../api/forms';
import { medicationsApi } from '../../api/medications';
import { diagnosesApi } from '../../api/diagnoses';
import ReauthModal from '../../components/ReauthModal';
import ErrorBoundary from '../../components/ErrorBoundary';
import DateField from '../../components/DateField';
import TreatmentActions from './TreatmentActions';
import { useAuthStore } from '../../store/auth';
import { newId } from '../../utils/id';
import { canEditSection, canEditSignedForm, apiErrorMessage } from '../../constants/formPolicy';
import { hasAnyRole, isClinicalStaff } from '../../constants/roles';
import { queueLabel, WOMENS_DEPARTMENT } from '../../constants/departments';
import { REFERRAL_GROUPS, DEPARTMENT_STATIONS } from '../../constants/careSteps';
import {
  joinForm, leaveForm, onLockAcquired, onLockReleased,
  onFormSectionUpdated, onPresenceUpdate, onFormSigned, onFormAddendaChanged,
} from '../../realtime/hub';
import type {
  Allergy, Diagnosis, DischargeMedication, FormLockInfo,
  MedicalForm, PresenceUpdate, Routing, StationType, Treatment, Visit, VitalSign,
} from '../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATION_OPTIONS: StationType[] = [
  'טריאז׳', 'טריאז׳ ילדים', 'רופא ר.דחופה', 'רופא ילדים', 'רופאת הריון',
  'רופא טראומה', 'אחות', 'אחות ילדים', 'אחות טיפולים',
  'מעבדה', 'א.ק.ג', 'רנטגן', 'US', 'מוקד 119',
];

const TEXT_SECTION_KEYS = [
  'chiefComplaintNurse', 'chiefComplaint', 'presentIllness', 'pastMedicalHistory', 'triage',
  'physicalExam', 'discussionAndPlan', 'dischargeRecommendations', 'orderedUnits',
];

const SECTIONS = [
  { key: 'chiefComplaintNurse', label: 'סיבת הפנייה — אחות' },
  { key: 'chiefComplaint', label: 'סיבת הפנייה — רופא' },
  { key: 'presentIllness', label: 'מחלה נוכחית (HPI)' },
  { key: 'pastMedicalHistory', label: 'רקע רפואי' },
  { key: 'allergies', label: 'רגישויות' },
  { key: 'homeMedications', label: 'בימים האחרונים נטל תרופות' },
  { key: 'vitalSigns', label: 'סימנים חיוניים' },
  { key: 'triage', label: 'טריאז׳' },
  { key: 'treatments', label: 'טיפולים ותרופות' },
  { key: 'physicalExam', label: 'בדיקה גופנית' },
  { key: 'administrationOrders', label: 'הוראות למתן' },
  { key: 'diagnoses', label: 'אבחנות' },
  { key: 'discussionAndPlan', label: 'דיון ותכנית' },
  { key: 'dischargeRecommendations', label: 'המלצות בשחרור' },
  { key: 'dischargeMedications', label: 'תרופות שחרור' },
  { key: 'orderedUnits', label: 'יחידות להזמנה' },
  { key: 'routing', label: 'ניתוב / הפניות' },
];

// ─── Main component ───────────────────────────────────────────────────────────

type SaveState = 'saving' | 'saved' | 'error';

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Render a stored table-cell value defensively — never an object. Legacy rows may hold a
// non-string value (e.g. a date field poisoned by the old DateField bug, where a fake event
// object got saved as the value); rendering it raw throws React error #31 and crashes the form.
function cellText(v: unknown, dash = '—'): string {
  if (v == null || v === '') return dash;
  if (typeof v === 'object') return dash;
  return String(v);
}

// The form serving a department track. A pre-dual single form has a null department, so it
// stands in for the primary track.
function formForDept(list: MedicalForm[], dept: string, primaryDept?: string): MedicalForm | undefined {
  return list.find((f) => f.department === dept)
    ?? (dept === primaryDept ? list.find((f) => !f.department) : undefined);
}

// The department tracks a visit runs: one for a single department, or two (women's first) when dual.
function trackList(primary?: string | null, secondary?: string | null): string[] {
  if (!primary) return [];
  const pair = [primary, secondary].filter(Boolean) as string[];
  if (!secondary) return pair;
  return [...pair].sort((a, b) => (a === WOMENS_DEPARTMENT ? -1 : b === WOMENS_DEPARTMENT ? 1 : 0));
}

export default function TreatmentFormPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [locks, setLocks] = useState<Record<string, FormLockInfo>>({});
  const [presence, setPresence] = useState<PresenceUpdate['presentUsers']>([]);
  const [activeForm, setActiveForm] = useState<MedicalForm | null>(null);
  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [signConfirm, setSignConfirm] = useState(false);
  // Default view shows only the sections the current user may edit; this reveals the
  // (already-filled) sections owned by the other professional, read-only.
  const [showOtherFields, setShowOtherFields] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Refs for serialized auto-save (always uses the latest version)
  const formRef = useRef<MedicalForm | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const debounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Guards the post-sign auto-open of the printable summary: holds the id of the
  // form whose summary we already opened, so the summary opens EXACTLY ONCE right
  // after the local sign action and never re-opens on close, re-renders, or a
  // FormSigned SignalR echo.
  const openedForSignId = useRef<string | null>(null);

  useEffect(() => { formRef.current = activeForm; }, [activeForm]);

  const { data: visit, isLoading: visitLoading } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => visitsApi.getById(visitId!),
    enabled: !!visitId,
  });

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['forms', visitId],
    queryFn: () => formsApi.getByVisit(visitId!),
    enabled: !!visitId,
  });

  // The department tracks this visit runs. Single department → one track; a dual women's + other
  // visit → two, with the women's track ordered first. (Plain render-time value, not an effect dep.)
  const tracks = trackList(visit?.receptionDepartment, visit?.secondaryDepartment);

  // Ensure a form exists per track (a single-track visit gets one form, a dual visit two).
  // A creating-set dedupes the POST while the refetch is in flight.
  const creatingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (formsLoading || !visitId || !user) return;
    const deptTracks = trackList(visit?.receptionDepartment, visit?.secondaryDepartment);
    if (deptTracks.length === 0) return;
    const list = forms as unknown as MedicalForm[];
    for (const dept of deptTracks) {
      if (formForDept(list, dept, visit?.receptionDepartment)) continue;
      if (creatingRef.current.has(dept)) continue;
      creatingRef.current.add(dept);
      formsApi.create(visitId, 'רופא ר.דחופה' as import('../../types').StationType, 'סיכום ביקור' as import('../../types').FormType, dept)
        .then(() => queryClient.invalidateQueries({ queryKey: ['forms', visitId] }))
        .catch(() => {/* already exists / race — ignore */ })
        .finally(() => creatingRef.current.delete(dept));
    }
  }, [formsLoading, forms, visitId, user, visit?.receptionDepartment, visit?.secondaryDepartment, queryClient]);

  useEffect(() => {
    if (forms.length > 0) {
      const list = forms as unknown as MedicalForm[];
      setActiveForm((prev) => prev
        ? (list.find((f) => f.id === prev.id) ?? prev)
        // default to the women's track when dual, else the first form
        : (list.find((f) => f.department === WOMENS_DEPARTMENT) ?? list[0]));
    }
  }, [forms]);

  // Tick every 15s so the shift-manager grace window expires live
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // SignalR
  useEffect(() => {
    if (!activeForm) return;
    joinForm(activeForm.id);
    const offs = [
      onPresenceUpdate((u) => {
        if (u.formId === activeForm.id) setPresence(u.presentUsers);
      }),
      onLockAcquired((lock) => {
        if (lock.formId === activeForm.id)
          setLocks((prev) => ({ ...prev, [lock.sectionName]: lock }));
      }),
      onLockReleased((info) => {
        if (info.formId === activeForm.id)
          setLocks((prev) => { const n = { ...prev }; delete n[info.sectionName]; return n; });
      }),
      onFormSectionUpdated((upd) => {
        if (upd.formId !== activeForm.id || upd.editedByUserId === user?.id) return;
        // Drop any stale local text override for the section another user just
        // changed — otherwise it would permanently shadow the incoming value and
        // the two views would diverge. (Section locks prevent us from editing the
        // same section concurrently, so we're not clobbering live local input.)
        setLocalTextValues((p) => {
          if (!(upd.sectionName in p)) return p;
          const n = { ...p }; delete n[upd.sectionName]; return n;
        });
        // Apply the pushed value DIRECTLY to local state — the same proven pattern
        // the lock/presence events use — so the change shows immediately, with no
        // refetch round-trip (which in practice did not repaint the view). The event
        // already carries the authoritative value, the new form version, and who
        // edited it. Fall back to a refetch only if the payload lacks the data.
        if (upd.data !== undefined) {
          setActiveForm((prev) => {
            if (!prev || prev.id !== upd.formId) return prev;
            return {
              ...prev,
              [upd.sectionName]: upd.data,
              version: upd.version ?? prev.version,
              fieldEdits: {
                ...prev.fieldEdits,
                [upd.sectionName]: {
                  userId: upd.editedByUserId ?? '',
                  userName: upd.editedByName ?? '',
                  at: upd.editedAt ?? new Date().toISOString(),
                },
              },
            } as MedicalForm;
          });
        } else {
          queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
        }
      }),
      onFormSigned((info) => {
        if (info.formId === activeForm.id)
          queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
      }),
      onFormAddendaChanged((info) => {
        if (info.formId === activeForm.id)
          queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
      }),
    ];
    return () => { leaveForm(activeForm.id); offs.forEach((off) => off()); };
  }, [activeForm?.id, queryClient, visitId, user?.id]);

  // Exit = finish for a NON-doctor: leaving the medical form completes their (nurse) part — the patient
  // stays waiting for the doctor. Doctors finish only by signing. Guarded to an InProgress nurse step so
  // a mere peek doesn't finish. The ref holds the latest decision for the unmount-only cleanup below.
  const finishOnExitRef = useRef(false);
  useEffect(() => {
    const nonDoctorClinical = !hasAnyRole(user?.roles, 'Doctor') && isClinicalStaff(user?.roles);
    finishOnExitRef.current = nonDoctorClinical && !activeForm?.isSigned && !!visit?.careSteps?.some(
      (s) => s.category === 'Clinician' && s.clinicianRole === 'Nurse' && s.status === 'InProgress');
  });
  useEffect(() => () => {
    if (finishOnExitRef.current && visitId) visitsApi.finishTreatment(visitId).catch(() => {});
  }, [visitId]);

  // ── Derived edit-permission state ──────────────────────────────────────────
  const formSigned = !!activeForm?.isSigned;
  const canEditSigned = canEditSignedForm(
    user?.roles, formSigned, activeForm?.signedAt, activeForm?.postSignEditWindowMinutes ?? 10);
  void nowTick; // re-evaluate canEditSigned on each tick

  const sectionReadOnly = (section: string): boolean => {
    if (!activeForm) return true;
    if (formSigned && !canEditSigned) return true;             // signed → locked
    if (!canEditSection(user?.roles, section)) return true;    // role can't edit this field
    if (locks[section] && locks[section].lockedByUserId !== user?.id) return true; // held by another
    return false;
  };
  const lockedBy = (section: string) => locks[section]?.lockedByName;

  // ── Serialized save ────────────────────────────────────────────────────────
  const persistSection = useCallback((section: string, value: unknown) => {
    saveChain.current = saveChain.current.then(async () => {
      const cur = formRef.current;
      if (!cur) return;
      const curRec = cur as unknown as Record<string, unknown>;
      // Skip redundant text saves (value unchanged)
      if (typeof value === 'string' && value === String(curRec[section] ?? '')) {
        return;
      }
      setSaveState((s) => ({ ...s, [section]: 'saving' }));

      // Baseline value of THIS section as we last knew it from the server. Used to
      // distinguish a real same-section conflict (must surface) from a false one
      // caused by another user saving a DIFFERENT section (just re-base and retry).
      const baseline = JSON.stringify(curRec[section] ?? null);
      let version = cur.version;

      for (let attempt = 0; ; attempt++) {
        try {
          const updated = await formsApi.updateSection(cur.id, section, value, version) as unknown as MedicalForm;
          formRef.current = updated;
          setActiveForm(updated);
          setSaveState((s) => ({ ...s, [section]: 'saved' }));
          return;
        } catch (e) {
          const conflict = (e as { status?: number }).status === 409;
          if (conflict && attempt < 4) {
            // Pull the authoritative form. The form-level version bumps on ANY field
            // save, so a conflict usually means a *different* field changed. If OUR
            // field is still what we started from, it's safe to re-base our write on
            // top of the latest version (the edits merge). Only a genuine change to
            // OUR field is surfaced as an error.
            try {
              const fresh = await formsApi.getById(cur.id) as unknown as MedicalForm;
              formRef.current = fresh;
              setActiveForm(fresh);
              const freshSection = JSON.stringify((fresh as unknown as Record<string, unknown>)[section] ?? null);
              if (freshSection === baseline) {
                version = fresh.version;
                continue; // re-base + retry — no error shown
              }
            } catch { /* fall through to surfacing the original error */ }
          }
          setSaveState((s) => ({ ...s, [section]: 'error' }));
          notifications.show({ color: 'red', message: apiErrorMessage(e, 'שמירה נכשלה') });
          queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
          return;
        }
      }
    });
  }, [queryClient, visitId]);

  const handleFocus = async (section: string) => {
    if (!activeForm || sectionReadOnly(section)) return;
    await formsApi.acquireLock(activeForm.id, section).catch(() => {});
  };

  const handleTextChange = (section: string, value: string) => {
    setLocalTextValues((p) => ({ ...p, [section]: value }));
    if (debounce.current[section]) clearTimeout(debounce.current[section]);
    debounce.current[section] = setTimeout(() => persistSection(section, value), 800);
  };

  const handleTextBlur = (section: string) => {
    if (!activeForm) return;
    if (debounce.current[section]) clearTimeout(debounce.current[section]);
    const value = localTextValues[section] ?? String((activeForm as unknown as Record<string, unknown>)[section] ?? '');
    persistSection(section, value);
    formsApi.releaseLock(activeForm.id, section).catch(() => {});
  };

  const handleTableSave = useCallback((section: string, rows: unknown[]) => {
    persistSection(section, rows);
    if (formRef.current) formsApi.releaseLock(formRef.current.id, section).catch(() => {});
  }, [persistSection]);

  // ── Signing ────────────────────────────────────────────────────────────────
  // Re-authentication required: errors propagate so the ReauthModal shows them inline.
  const handleSign = async (username: string, password: string) => {
    if (!activeForm) return;
    const updated = await formsApi.sign(activeForm.id, username, password) as unknown as MedicalForm;
    formRef.current = updated;
    setActiveForm(updated);
    setSignConfirm(false);
    notifications.show({ color: 'green', message: 'הטופס נחתם, המטופל שוחרר וההדפסה נפתחת' });
    queryClient.invalidateQueries({ queryKey: ['queue'] });
    // Open the printable PDF summary automatically after signing — but only once
    // per signed form. The ref guard ensures that returning to this page (which
    // re-renders with formSigned=true) or a FormSigned SignalR echo never re-opens
    // the summary the user has already closed.
    if (openedForSignId.current !== updated.id) {
      openedForSignId.current = updated.id;
      navigate(`/visits/${visitId}/summary?print=1`);
    }
  };

  // A non-doctor (nurse etc.) explicitly finishes their part — completes their step without discharging;
  // the patient stays waiting for the doctor. Clears the exit-guard so the unmount effect doesn't re-fire.
  const handleFinish = async () => {
    if (!visitId) return;
    finishOnExitRef.current = false;
    try {
      await visitsApi.finishTreatment(visitId);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      notifications.show({ color: 'green', message: 'סיימת את הטיפול; המטופל ממתין לרופא' });
    } catch {
      notifications.show({ color: 'brick', message: 'הסיום נכשל' });
    }
    navigate('/queue');
  };

  const isDoctor = hasAnyRole(user?.roles, 'Doctor');
  const isNonDoctorClinical = !isDoctor && isClinicalStaff(user?.roles);

  if (visitLoading || formsLoading) return <Box ta="center" py="xl"><Loader /></Box>;

  return (
    <Stack gap="md" p="md">
      {/* Patient banner */}
      <Card withBorder p="sm" bg="blue.0">
        <Group justify="space-between">
          <Group gap="xl">
            <Box>
              <Text size="xs" c="dimmed">מטופל</Text>
              <Text fw={700}>
                {visit?.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '—'}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">מס׳ תור</Text>
              <Text fw={600}>{visit ? queueLabel(visit.queueLetter, visit.queueNumber) : '—'}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">ת.ז</Text>
              <Text>{visit?.patient?.identityNumber ?? '—'}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">שעת הגעה</Text>
              <Text>{visit?.admissionTime ?? '—'}</Text>
            </Box>
            {/* Dual women's + other visit: switch between the two medical processes. */}
            {tracks.length > 1 && (
              <Box>
                <Text size="xs" c="dimmed">תהליך רפואי (מחלקה)</Text>
                <SegmentedControl
                  size="xs"
                  value={activeForm?.department ?? visit?.receptionDepartment ?? tracks[0]}
                  onChange={(dept) => {
                    const target = formForDept(forms as unknown as MedicalForm[], dept, visit?.receptionDepartment);
                    if (target) setActiveForm(target);
                  }}
                  data={tracks.map((d) => ({ value: d, label: d }))}
                />
              </Box>
            )}
          </Group>
          <Stack gap="xs" align="flex-end">
            {/* Whole-visit clinical actions (moved off the queue board): department / dual / refer / promote. */}
            {visit && <TreatmentActions visit={visit} />}
            <Group gap="xs">
              {presence.map((u) => (
                <Tooltip key={u.userId} label={`${u.fullName} (${u.role})`}>
                  <Badge variant="dot" color="green">{u.fullName.split(' ')[0]}</Badge>
                </Tooltip>
              ))}
            </Group>
          </Stack>
        </Group>
      </Card>

      {/* Signed banner */}
      {formSigned && (
        <Alert
          color="teal"
          icon={<IconWriting size={18} />}
          title={`הטופס נחתם ע"י ${activeForm?.signedByName ?? ''} — ${formatDateTime(activeForm?.signedAt)}`}
        >
          <Text size="sm">הטיפול הסתיים. הטופס נעול לעריכה.</Text>
          {canEditSigned && (
            <Text size="sm" c="orange" fw={600} mt={4}>
              <IconClock size={13} style={{ verticalAlign: 'middle' }} /> חלון תיקון פעיל (מנהל משמרת) —
              ניתן לערוך עד {formatDateTime(
                new Date(new Date(activeForm!.signedAt!).getTime()
                  + (activeForm!.postSignEditWindowMinutes) * 60_000).toISOString())}
            </Text>
          )}
        </Alert>
      )}

      <ErrorBoundary title="שגיאה בהצגת הטופס — הנתונים נשמרו בשרת">
      {activeForm && (() => {
        // True when the section has any content (text non-empty, or table has ≥1 row).
        const sectionHasContent = (key: string): boolean => {
          const f = activeForm as unknown as Record<string, unknown>;
          if (TEXT_SECTION_KEYS.includes(key)) return !!f[key] && String(f[key]).trim().length > 0;
          const rows = f[key];
          return Array.isArray(rows) && rows.length > 0;
        };
        const canEdit = (key: string) => canEditSection(user?.roles, key);
        // Default view = the user's own (editable) sections. The toggle additionally reveals the
        // other professional's sections that are already filled (read-only). Empty non-editable
        // sections are never shown.
        const visibleSections = SECTIONS.filter(
          ({ key }) => canEdit(key) || (showOtherFields && sectionHasContent(key)));
        const otherFilledCount = SECTIONS.filter(({ key }) => !canEdit(key) && sectionHasContent(key)).length;
        // A nurse can't edit the doctor's reason → her hidden fields are the doctor's (and vice versa).
        const revealLabel = canEdit('chiefComplaint') ? 'הצג שדות אחות' : 'הצג שדות רופא';
        return (
        <Stack gap="sm">
          {otherFilledCount > 0 && (
            <Group justify="flex-end">
              <Button
                variant="subtle"
                size="xs"
                color="slate"
                leftSection={showOtherFields ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                onClick={() => setShowOtherFields((v) => !v)}
              >
                {showOtherFields ? 'הסתר שדות נוספים' : `${revealLabel} (${otherFilledCount})`}
              </Button>
            </Group>
          )}
          {visibleSections.map(({ key, label }) => {
            const readOnly = sectionReadOnly(key);
            const heldByOther = !!locks[key] && locks[key].lockedByUserId !== user?.id;
            const myLock = locks[key]?.lockedByUserId === user?.id;
            const isText = TEXT_SECTION_KEYS.includes(key);
            const edit = activeForm.fieldEdits?.[key];
            const st = saveState[key];
            const noPerm = !canEditSection(user?.roles, key);

            return (
              <Card key={key} withBorder p="sm" radius="md">
                <Group gap="xs" mb="xs">
                  <Text fw={600} size="md">{label}</Text>
                  {edit && (
                    <Tooltip label={`נערך לאחרונה ע"י ${edit.userName} — ${formatDateTime(edit.at)}`}>
                      <IconInfoCircle size={14} color="gray" />
                    </Tooltip>
                  )}
                  {heldByOther && (
                    <Tooltip label={`בעריכה ע"י ${lockedBy(key)}`}>
                      <IconLock size={14} color="red" />
                    </Tooltip>
                  )}
                  {myLock && <IconLockOpen size={14} color="green" />}
                  {noPerm && <Badge size="xs" variant="light" color="gray">לקריאה</Badge>}
                  {st === 'saving' && <Loader size={12} />}
                  {st === 'saved' && <IconCheck size={13} color="green" />}
                </Group>
                {isText ? (
                  <TextSectionEditor
                    value={localTextValues[key] ?? String((activeForm as unknown as Record<string, unknown>)[key] ?? '')}
                    readOnly={readOnly}
                    onFocus={() => handleFocus(key)}
                    onChange={(v) => handleTextChange(key, v)}
                    onBlur={() => handleTextBlur(key)}
                  />
                ) : (
                  <TableSectionRouter
                    sectionKey={key}
                    form={activeForm}
                    locked={readOnly}
                    saving={st === 'saving'}
                    onFocus={() => handleFocus(key)}
                    onSave={(rows) => handleTableSave(key, rows)}
                    visit={visit}
                  />
                )}
              </Card>
            );
          })}
        </Stack>
        );
      })()}
      </ErrorBoundary>

      {/* Addenda (post-signature appendices) */}
      {formSigned && activeForm && (
        <AddendaSection
          form={activeForm}
          isDoctor={isDoctor}
          onChange={(f) => { formRef.current = f; setActiveForm(f); }}
        />
      )}

      <Divider />
      <Group justify="space-between">
        <Button variant="subtle" onClick={() => navigate('/queue')}>חזרה לתור</Button>
        <Group>
          {formSigned && activeForm && visit && (
            <Button
              leftSection={<IconPrinter size={16} />}
              variant="outline"
              onClick={() => printForm(activeForm, visit)}
            >
              הדפסה
            </Button>
          )}
          {!formSigned && isNonDoctorClinical && (
            <Button color="teal" onClick={handleFinish}>
              סיים
            </Button>
          )}
          {!formSigned && isDoctor && (
            <Button
              leftSection={<IconWriting size={16} />}
              color="teal"
              onClick={() => setSignConfirm(true)}
            >
              סיים וחתום
            </Button>
          )}
        </Group>
      </Group>

      {/* Sign — requires step-up re-authentication */}
      <ReauthModal
        opened={signConfirm}
        onClose={() => setSignConfirm(false)}
        onConfirm={handleSign}
        title="חתימה ושחרור המטופל"
        description={`לאחר החתימה הטופס יינעל לעריכה, המטופל ישוחרר, ויודפסו הסיכום והמרשם (שינויים לאחר מכן רק למנהל משמרת בחלון של ${activeForm?.postSignEditWindowMinutes ?? 10} דקות, או כ"תוספת לאחר חתימה"). לאישור — הזן מחדש את שם המשתמש והסיסמה שלך.`}
        confirmLabel="חתום ושחרר"
      />
    </Stack>
  );
}

// ─── Text section editor (auto-save) ───────────────────────────────────────────

interface TextEditorProps {
  value: string;
  readOnly: boolean;
  onFocus: () => void;
  onChange: (v: string) => void;
  onBlur: () => void;
}

function TextSectionEditor({ value, readOnly, onFocus, onChange, onBlur }: TextEditorProps) {
  return (
    <Textarea
      value={value}
      readOnly={readOnly}
      variant={readOnly ? 'filled' : 'default'}
      autosize
      minRows={3}
      placeholder={readOnly ? '' : 'הקלד כאן — נשמר אוטומטית'}
      onFocus={onFocus}
      onChange={(e) => onChange(e.currentTarget.value)}
      onBlur={onBlur}
    />
  );
}

// ─── Closed-catalog pickers (server-backed) ────────────────────────────────────
// Diagnoses and medications are CLOSED lists: the value must come from the internal
// catalog. Implemented with a strict Mantine Select (searchable, no free text), which
// opens with the doctor's most-frequent picks and switches to a server search on type.
// Fallback: if the catalog is empty (e.g. the drug catalog before its first sync) an
// empty list can't be enforced, so the field degrades to free text. The seeded
// diagnosis catalog is never empty → always strict.

// Label for a medication option: `${englishName} — ${registrationNumber}`, or just the
// registration number when there is no English name. Never exposes the Hebrew name.
function medicationLabel(m: import('../../api/medications').Medication): string {
  const eng = m.englishName?.trim();
  return eng ? `${eng} — ${m.registrationNumber}` : m.registrationNumber;
}

// Label for a diagnosis option: `${englishName} — ${code}` (English-first, official
// ICD-10-CM), falling back to the Hebrew name, then the bare code. The server builds the
// identical string for the closed-list check — keep the separator (U+2014) in sync.
function diagnosisLabel(d: import('../../api/diagnoses').Diagnosis): string {
  const en = d.englishName?.trim();
  if (en) return `${en} — ${d.code}`;
  const he = d.hebrewName?.trim();
  return he ? `${he} — ${d.code}` : d.code;
}

interface CatalogSelectProps {
  label?: string;
  value?: string;
  error?: React.ReactNode;
  placeholder?: string;
  onChange?: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  fetchFrequent: (take: number) => Promise<string[]>;
  fetchSearch: (q: string, take: number) => Promise<string[]>;
}

function CatalogSelect({
  label, value, error, placeholder, onChange, onBlur, onFocus, fetchFrequent, fetchSearch,
}: CatalogSelectProps) {
  const [data, setData] = useState<string[]>([]);
  const [strict, setStrict] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Probe once whether the catalog has any entries; an empty catalog can't be a closed
  // list, so fall back to free text until one is loaded.
  useEffect(() => {
    let alive = true;
    fetchSearch('', 1).then((r) => { if (alive && r.length === 0) setStrict(false); }).catch(() => {});
    return () => { alive = false; };
  }, [fetchSearch]);

  // Fetch catalog matches for a query (empty query → top results). Debounced ~250ms.
  const runSearch = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setData(await fetchSearch(q.trim(), 20)); } catch { setData([]); }
    }, 250);
  }, [fetchSearch]);

  // Open with the doctor's most-frequent picks; fall back to a catalog list.
  const loadFrequent = () => {
    if (data.length > 0) return;
    fetchFrequent(10)
      .then((names) => { if (names.length > 0) setData(names); else runSearch(''); })
      .catch(() => runSearch(''));
  };

  // The selected value is always present so it renders even before results load.
  const options = useMemo(() => {
    const set = new Set<string>();
    if (value) set.add(value);
    for (const d of data) set.add(d);
    return [...set];
  }, [value, data]);

  if (!strict) {
    // Empty catalog → permissive free-text fallback.
    return (
      <Autocomplete
        label={label}
        value={value ?? ''}
        data={options}
        error={error}
        onChange={(v) => { onChange?.(v); runSearch(v); }}
        onFocus={(e) => { loadFrequent(); onFocus?.(e); }}
        onBlur={onBlur}
        limit={20}
        placeholder={placeholder}
        comboboxProps={{ withinPortal: true }}
      />
    );
  }

  return (
    <Select
      label={label}
      value={value ?? null}
      data={options}
      searchable
      clearable
      error={error}
      nothingFoundMessage="לא נמצא בקטלוג"
      filter={(input) => input.options}
      onChange={(v) => onChange?.(v ?? '')}
      onSearchChange={runSearch}
      onDropdownOpen={loadFrequent}
      onFocus={onFocus}
      onBlur={onBlur}
      limit={20}
      placeholder={placeholder}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

// Medication picker (closed MoH drug catalog). Name kept for existing call sites.
function DrugAutocomplete({ label = 'שם תרופה *', value, error, onChange, onBlur, onFocus }: {
  label?: string; value?: string; error?: React.ReactNode;
  onChange?: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <CatalogSelect
      label={label} value={value} error={error} onChange={onChange} onBlur={onBlur} onFocus={onFocus}
      placeholder="בחר תרופה מהמאגר הרשמי"
      fetchFrequent={(take) => medicationsApi.frequent(take)}
      fetchSearch={async (q, take) => (await medicationsApi.search(q, take)).map(medicationLabel)}
    />
  );
}

// Diagnosis picker (closed diagnosis catalog).
function DiagnosisSelect({ label = 'אבחנה *', value, error, onChange, onBlur, onFocus }: {
  label?: string; value?: string; error?: React.ReactNode;
  onChange?: (value: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <CatalogSelect
      label={label} value={value} error={error} onChange={onChange} onBlur={onBlur} onFocus={onFocus}
      placeholder="בחר אבחנה מהרשימה הסגורה"
      fetchFrequent={(take) => diagnosesApi.frequent(take)}
      fetchSearch={async (q, take) => (await diagnosesApi.search(q, take)).map(diagnosisLabel)}
    />
  );
}

// ─── Addenda section ───────────────────────────────────────────────────────────

function AddendaSection({ form, isDoctor, onChange }: {
  form: MedicalForm;
  isDoctor: boolean;
  onChange: (f: MedicalForm) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingAddendumId, setSigningAddendumId] = useState<string | null>(null);

  const addAddendum = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const updated = await formsApi.addAddendum(form.id, text.trim()) as unknown as MedicalForm;
      onChange(updated);
      setText('');
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorMessage(e, 'הוספת תוספת נכשלה') });
    } finally {
      setBusy(false);
    }
  };

  // Re-authentication required per addendum; errors propagate to the ReauthModal.
  const handleSignAddendum = async (username: string, password: string) => {
    if (!signingAddendumId) return;
    const updated = await formsApi.signAddendum(
      form.id, signingAddendumId, username, password) as unknown as MedicalForm;
    onChange(updated);
    setSigningAddendumId(null);
  };

  return (
    <Card withBorder p="md">
      <Text fw={600} mb="sm">תוספות לאחר חתימה</Text>
      <Stack gap="sm">
        {(form.addenda ?? []).length === 0 && (
          <Text size="sm" c="dimmed">אין תוספות.</Text>
        )}
        {(form.addenda ?? []).map((a, i) => (
          <Paper key={a.id} withBorder p="sm" bg={a.isSigned ? undefined : 'yellow.0'}>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">
                תוספת #{i + 1} — {a.createdByName} — {formatDateTime(a.createdAt)}
              </Text>
              {a.isSigned ? (
                <Badge color="teal" leftSection={<IconCheck size={12} />}>
                  חתום ע"י {a.signedByName} — {formatDateTime(a.signedAt)}
                </Badge>
              ) : (
                <Badge color="orange">ממתין לחתימה</Badge>
              )}
            </Group>
            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{a.text}</Text>
            {!a.isSigned && isDoctor && (
              <Group justify="flex-end" mt="xs">
                <Button size="xs" color="teal" variant="light"
                  leftSection={<IconWriting size={14} />}
                  onClick={() => setSigningAddendumId(a.id)}>
                  חתום על התוספת
                </Button>
              </Group>
            )}
          </Paper>
        ))}

        <Divider label="הוספת תוספת חדשה" />
        <Textarea
          placeholder="טקסט התוספת — יופיע כנספח לאחר החתימה ויידרוש חתימה נפרדת"
          autosize minRows={2}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button size="xs" leftSection={<IconPlus size={14} />} loading={busy}
            disabled={!text.trim()} onClick={addAddendum}>
            הוסף תוספת
          </Button>
        </Group>
      </Stack>

      {/* Addendum signing — requires step-up re-authentication */}
      <ReauthModal
        opened={signingAddendumId !== null}
        onClose={() => setSigningAddendumId(null)}
        onConfirm={handleSignAddendum}
        title="חתימה על תוספת"
        description="לאישור החתימה על התוספת הזן מחדש את שם המשתמש והסיסמה שלך."
        confirmLabel="חתום על התוספת"
      />
    </Card>
  );
}

// ─── Print (only filled fields) ────────────────────────────────────────────────

function printForm(form: MedicalForm, visit: import('../../types').Visit) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.opener = null; // sever opener access (we keep the ref to write content)

  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const parts: string[] = [];

  // Header
  const patientName = visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : '';
  const emblem = `<svg viewBox="0 0 32 29.6" width="34" height="31"><defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f6fc4"/><stop offset="1" stop-color="#e03131"/></linearGradient></defs><path fill="url(#h)" d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"/><rect x="14.7" y="6" width="2.6" height="10" rx="1.3" fill="#fff"/><rect x="11" y="9.7" width="10" height="2.6" rx="1.3" fill="#fff"/></svg>`;
  parts.push(`<div class="hdr">
    <h1>${emblem}<span>מלר"ד יד שרה — סיכום ביקור</span></h1>
    <div class="meta">
      <span>מטופל: <b>${esc(patientName)}</b></span>
      <span>ת.ז: ${esc(visit.patient?.identityNumber)}</span>
      <span>מס׳ תור: ${esc(queueLabel(visit.queueLetter, visit.queueNumber))}</span>
      <span>תאריך: ${esc(visit.admissionDate)} ${esc(visit.admissionTime)}</span>
    </div>
  </div>`);

  // Text sections — only if filled
  for (const { key, label } of SECTIONS) {
    if (TEXT_SECTION_KEYS.includes(key)) {
      const val = (form as unknown as Record<string, unknown>)[key];
      if (val && String(val).trim()) {
        parts.push(`<section><h2>${esc(label)}</h2><p>${esc(val).replace(/\n/g, '<br/>')}</p></section>`);
      }
    } else {
      const rows = (form as unknown as Record<string, unknown[]>)[key];
      if (Array.isArray(rows) && rows.length > 0) {
        parts.push(renderTablePrint(label, key, rows, esc));
      }
    }
  }

  // Signature
  if (form.isSigned) {
    parts.push(`<div class="sign">נחתם ע"י ${esc(form.signedByName)} — ${esc(formatDateTime(form.signedAt))}</div>`);
  }

  // Addenda — only signed-relevant content, each with its own signature line
  for (let i = 0; i < (form.addenda ?? []).length; i++) {
    const a = form.addenda[i];
    if (!a.text?.trim()) continue;
    parts.push(`<section class="addendum">
      <h2>תוספת לאחר חתימה #${i + 1}</h2>
      <p>${esc(a.text).replace(/\n/g, '<br/>')}</p>
      <div class="sign">${a.isSigned
        ? `נחתם ע"י ${esc(a.signedByName)} — ${esc(formatDateTime(a.signedAt))}`
        : '(טרם נחתם)'}</div>
    </section>`);
  }

  win.document.write(`<html dir="rtl"><head><meta charset="UTF-8"/><title>סיכום ביקור</title>
    <style>
      * { font-family: Arial, sans-serif; box-sizing: border-box; }
      body { margin: 24px; color: #111; }
      .hdr h1 { font-size: 18pt; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
      .hdr h1 svg { flex-shrink: 0; }
      .meta { display: flex; gap: 18px; flex-wrap: wrap; font-size: 10pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 12px; }
      section { margin-bottom: 14px; page-break-inside: avoid; }
      h2 { font-size: 12pt; border-bottom: 1px solid #999; padding-bottom: 2px; margin: 0 0 6px; }
      p { font-size: 11pt; margin: 0; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th, td { border: 1px solid #999; padding: 3px 6px; text-align: right; }
      .sign { margin-top: 8px; font-size: 10pt; font-style: italic; color: #333; border-top: 1px dashed #999; padding-top: 4px; }
      .addendum { border: 1px solid #ccc; padding: 8px; border-radius: 6px; }
    </style></head><body>${parts.join('')}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

// Column definitions for printable tables (only filled rows reach here)
const PRINT_COLUMNS: Record<string, { key: string; label: string }[]> = {
  allergies: [{ key: 'drugName', label: 'תרופה' }, { key: 'type', label: 'סוג' }, { key: 'effect', label: 'השפעה' }, { key: 'determinationDate', label: 'ת.קביעה' }],
  vitalSigns: [{ key: 'date', label: 'תאריך' }, { key: 'time', label: 'שעה' }, { key: 'bp', label: 'ל"ד' }, { key: 'pulse', label: 'דופק' }, { key: 'respiration', label: 'נשימות' }, { key: 'o2Sat', label: 'סטורציה' }, { key: 'temperature', label: 'חום' }, { key: 'glucose', label: 'סוכר' }, { key: 'weight', label: 'משקל' }],
  treatments: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'startDate', label: 'התחלה' }, { key: 'duration', label: 'משך' }, { key: 'notes', label: 'הערות' }],
  administrationOrders: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'startDate', label: 'התחלה' }, { key: 'duration', label: 'משך' }, { key: 'notes', label: 'הערות' }],
  diagnoses: [{ key: 'diagnosis', label: 'אבחנה' }, { key: 'status', label: 'סטטוס' }, { key: 'severity', label: 'חומרה' }, { key: 'isPrimary', label: 'עיקרית' }],
  dischargeMedications: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'notes', label: 'הערות' }],
  homeMedications: [{ key: 'drugName', label: 'תרופה' }, { key: 'dosage', label: 'מינון' }, { key: 'notes', label: 'הערות' }],
  routing: [{ key: 'station', label: 'תחנה' }, { key: 'status', label: 'סטטוס' }, { key: 'arrivalDate', label: 'ת.הגעה' }],
};

function renderTablePrint(label: string, key: string, rows: unknown[], esc: (s: unknown) => string): string {
  const cols = PRINT_COLUMNS[key];
  if (!cols) return '';
  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => {
    const row = r as Record<string, unknown>;
    return '<tr>' + cols.map((c) => {
      const v = row[c.key];
      const cell = typeof v === 'boolean' ? (v ? '✓' : '') : v;
      return `<td>${esc(cell)}</td>`;
    }).join('') + '</tr>';
  }).join('');
  return `<section><h2>${esc(label)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

// ─── Table section router ─────────────────────────────────────────────────────

interface TableSectionProps {
  sectionKey: string;
  form: MedicalForm;
  locked: boolean;
  saving: boolean;
  onFocus: () => void;
  onSave: (rows: unknown[]) => void;
  visit?: Visit | null;
}

function TableSectionRouter({ sectionKey, form, locked, saving, onFocus, onSave, visit }: TableSectionProps) {
  switch (sectionKey) {
    case 'allergies':
      return <AllergiesEditor rows={form.allergies ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'vitalSigns':
      return <VitalSignsEditor rows={form.vitalSigns ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'treatments':
      return <TreatmentsEditor rows={form.treatments ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'administrationOrders':
      return <TreatmentsEditor rows={(form.administrationOrders ?? []) as Treatment[]} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'diagnoses':
      return <DiagnosesEditor rows={form.diagnoses ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'dischargeMedications':
      return <DischargeMedsEditor rows={form.dischargeMedications ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'homeMedications':
      return <DischargeMedsEditor rows={(form.homeMedications ?? []) as DischargeMedication[]} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
    case 'routing':
      return <RoutingEditor rows={form.routing ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} visit={visit} />;
    default:
      return null;
  }
}

// ─── Shared table layout helper ───────────────────────────────────────────────

function TableActions({ onEdit, onDelete, locked }: { onEdit: () => void; onDelete: () => void; locked: boolean }) {
  if (locked) return null;
  return (
    <Group gap={4} wrap="nowrap">
      <ActionIcon size="sm" variant="subtle" onClick={onEdit}><IconEdit size={14} /></ActionIcon>
      <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete}><IconTrash size={14} /></ActionIcon>
    </Group>
  );
}

function AddButton({ onClick, locked }: { onClick: () => void; locked: boolean }) {
  if (locked) return <Text size="sm" c="dimmed">נעול לעריכה</Text>;
  return (
    <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={onClick}>
      הוסף שורה
    </Button>
  );
}

// ─── Allergies editor ─────────────────────────────────────────────────────────

interface AllergyEditorProps { rows: Allergy[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function AllergiesEditor({ rows, locked, saving, onFocus, onSave }: AllergyEditorProps) {
  const [localRows, setLocalRows] = useState<Allergy[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  const form = useForm({
    initialValues: { drugName: '', type: '', effect: '', determinationDate: '' },
    validate: { drugName: (v) => v.trim() ? null : 'שדה חובה' },
  });

  function openAdd() { onFocus(); form.reset(); setEditingId(null); setOpen(true); }
  function openEdit(row: Allergy) { form.setValues({ drugName: row.drugName, type: row.type ?? '', effect: row.effect ?? '', determinationDate: row.determinationDate ?? '' }); setEditingId(row.id); setOpen(true); }

  function handleSubmit(values: typeof form.values) {
    const next = editingId
      ? localRows.map((x) => x.id === editingId ? { ...x, ...values } : x)
      : [...localRows, { id: newId(), ...values }];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
      <Table striped withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>שם תרופה</Table.Th>
            <Table.Th>סוג</Table.Th>
            <Table.Th>השפעה</Table.Th>
            <Table.Th>ת.קביעה</Table.Th>
            {!locked && <Table.Th style={{ width: 70 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {localRows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td>{row.drugName}</Table.Td>
              <Table.Td>{row.type ?? '—'}</Table.Td>
              <Table.Td>{row.effect ?? '—'}</Table.Td>
              <Table.Td>{cellText(row.determinationDate)}</Table.Td>
              {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
            </Table.Tr>
          ))}
          {localRows.length === 0 && <Table.Tr><Table.Td colSpan={5} ta="center" c="dimmed">אין רשומות</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת רגישות' : 'הוספת רגישות'} size="sm">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            <DrugAutocomplete label="שם תרופה *" {...form.getInputProps('drugName')} />
            <TextInput label="סוג" {...form.getInputProps('type')} />
            <TextInput label="השפעה" {...form.getInputProps('effect')} />
            <DateField label="ת.קביעה" {...form.getInputProps('determinationDate')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Vital signs editor ───────────────────────────────────────────────────────

// ─── Vital signs ranges ───────────────────────────────────────────────────────

interface VitalRange {
  absMin: number; absMax: number;       // physiologically impossible outside these
  normalMin: number; normalMax: number; // expected healthy range
  critMin: number; critMax: number;     // critical alert boundary
}

const VITAL: Record<string, VitalRange> = {
  pulse:       { absMin: 10,  absMax: 300, normalMin: 60,   normalMax: 100,  critMin: 40,   critMax: 130  },
  respiration: { absMin: 4,   absMax: 80,  normalMin: 12,   normalMax: 20,   critMin: 8,    critMax: 30   },
  o2Sat:       { absMin: 50,  absMax: 100, normalMin: 95,   normalMax: 100,  critMin: 90,   critMax: 100  },
  temperature: { absMin: 25,  absMax: 45,  normalMin: 36.1, normalMax: 37.5, critMin: 35,   critMax: 38.5 },
  glucose:     { absMin: 20,  absMax: 800, normalMin: 70,   normalMax: 180,  critMin: 60,   critMax: 250  },
  weight:      { absMin: 0.5, absMax: 300, normalMin: 0,    normalMax: 9999, critMin: 0,    critMax: 9999 },
  bpSys:       { absMin: 40,  absMax: 300, normalMin: 90,   normalMax: 140,  critMin: 80,   critMax: 180  },
  bpDia:       { absMin: 20,  absMax: 200, normalMin: 60,   normalMax: 90,   critMin: 50,   critMax: 110  },
};

type VitalStatus = 'normal' | 'alert' | 'critical';

function vitalStatus(value: number, r: VitalRange): VitalStatus {
  if (value < r.critMin || value > r.critMax) return 'critical';
  if (value < r.normalMin || value > r.normalMax) return 'alert';
  return 'normal';
}

function bpStatus(bp: string): VitalStatus {
  const parts = bp.split('/').map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 'normal';
  const [sys, dia] = parts;
  const s1 = vitalStatus(sys, VITAL.bpSys);
  const s2 = vitalStatus(dia, VITAL.bpDia);
  if (s1 === 'critical' || s2 === 'critical') return 'critical';
  if (s1 === 'alert' || s2 === 'alert') return 'alert';
  return 'normal';
}

const STATUS_COLOR: Record<VitalStatus, string | undefined> = {
  normal: undefined,
  alert: 'orange',
  critical: 'red',
};

// Colored table cell for a numeric vital
function VCell({ value, field }: { value: number | undefined; field: string }) {
  if (value == null) return <Table.Td c="dimmed">—</Table.Td>;
  const r = VITAL[field];
  const status = r ? vitalStatus(value, r) : 'normal';
  return (
    <Table.Td>
      <Text fz="xs" c={STATUS_COLOR[status]} fw={status !== 'normal' ? 700 : undefined}>
        {value}
      </Text>
    </Table.Td>
  );
}

// Colored table cell for blood pressure string
function BpCell({ bp }: { bp?: string }) {
  if (!bp) return <Table.Td c="dimmed">—</Table.Td>;
  const status = bpStatus(bp);
  return (
    <Table.Td>
      <Text fz="xs" c={STATUS_COLOR[status]} fw={status !== 'normal' ? 700 : undefined}>
        {bp}
      </Text>
    </Table.Td>
  );
}

// Description ReactNode for a NumberInput that shows normal range + warning when out of range
function vitalDesc(value: number | undefined, field: string, unit: string): React.ReactNode {
  const r = VITAL[field];
  if (!r || r.normalMax >= 9999) return null;
  const rangeLabel = `נורמלי: ${r.normalMin}–${r.normalMax} ${unit}`;
  if (value == null) return <Text fz="xs" c="dimmed">{rangeLabel}</Text>;
  const status = vitalStatus(value, r);
  if (status === 'critical') return <Text fz="xs" c="red" fw={700}>⚠ חריגה קריטית! ({rangeLabel})</Text>;
  if (status === 'alert')    return <Text fz="xs" c="orange">⚠ מחוץ לנורמה ({rangeLabel})</Text>;
  return <Text fz="xs" c="dimmed">{rangeLabel}</Text>;
}

// BP input description
function bpDesc(bpVal: string): React.ReactNode {
  const label = 'נורמלי: 90–140 / 60–90 mmHg';
  if (!bpVal || !bpVal.includes('/')) return <Text fz="xs" c="dimmed">{label}</Text>;
  const status = bpStatus(bpVal);
  if (status === 'critical') return <Text fz="xs" c="red" fw={700}>⚠ חריגה קריטית! ({label})</Text>;
  if (status === 'alert')    return <Text fz="xs" c="orange">⚠ מחוץ לנורמה ({label})</Text>;
  return <Text fz="xs" c="dimmed">{label}</Text>;
}

// ─── VitalSignsEditor ─────────────────────────────────────────────────────────

interface VitalSignsEditorProps { rows: VitalSign[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function VitalSignsEditor({ rows, locked, saving, onFocus, onSave }: VitalSignsEditorProps) {
  const [localRows, setLocalRows] = useState<VitalSign[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  const emptyVital = {
    date: '', time: '', bp: '',
    pulse: undefined as number | undefined,
    respiration: undefined as number | undefined,
    o2Sat: undefined as number | undefined,
    temperature: undefined as number | undefined,
    glucose: undefined as number | undefined,
    weight: undefined as number | undefined,
    notes: '',
  };

  const form = useForm({
    initialValues: emptyVital,
    validate: {
      date: (v) => v ? null : 'שדה חובה',
      time: (v) => v ? null : 'שדה חובה',
      bp: (v) => {
        if (!v) return null;
        const parts = v.split('/').map((p) => parseInt(p.trim(), 10));
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]))
          return 'פורמט לא תקין — הזן כ-120/80';
        const [sys, dia] = parts;
        if (sys < VITAL.bpSys.absMin || sys > VITAL.bpSys.absMax)
          return `ל"ד סיסטולי חריג: ${VITAL.bpSys.absMin}–${VITAL.bpSys.absMax}`;
        if (dia < VITAL.bpDia.absMin || dia > VITAL.bpDia.absMax)
          return `ל"ד דיאסטולי חריג: ${VITAL.bpDia.absMin}–${VITAL.bpDia.absMax}`;
        return null;
      },
      pulse:       (v) => v != null && (v < VITAL.pulse.absMin || v > VITAL.pulse.absMax) ? `דופק חריג: ${VITAL.pulse.absMin}–${VITAL.pulse.absMax}` : null,
      respiration: (v) => v != null && (v < VITAL.respiration.absMin || v > VITAL.respiration.absMax) ? `נשימות חריגות: ${VITAL.respiration.absMin}–${VITAL.respiration.absMax}` : null,
      o2Sat:       (v) => v != null && (v < VITAL.o2Sat.absMin || v > VITAL.o2Sat.absMax) ? `סטורציה חריגה: ${VITAL.o2Sat.absMin}–${VITAL.o2Sat.absMax}%` : null,
      temperature: (v) => v != null && (v < VITAL.temperature.absMin || v > VITAL.temperature.absMax) ? `חום חריג: ${VITAL.temperature.absMin}–${VITAL.temperature.absMax}°C` : null,
      glucose:     (v) => v != null && (v < VITAL.glucose.absMin || v > VITAL.glucose.absMax) ? `סוכר חריג: ${VITAL.glucose.absMin}–${VITAL.glucose.absMax}` : null,
      weight:      (v) => v != null && (v < VITAL.weight.absMin || v > VITAL.weight.absMax) ? `משקל חריג: ${VITAL.weight.absMin}–${VITAL.weight.absMax} ק"ג` : null,
    },
  });

  function openAdd() {
    onFocus();
    // Prefill the current LOCAL date + time (editable) — measurements are almost always "now".
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    form.setValues({ ...emptyVital, date, time });
    setEditingId(null);
    setOpen(true);
  }
  function openEdit(row: VitalSign) {
    form.setValues({ date: row.date, time: row.time, bp: row.bp ?? '', pulse: row.pulse, respiration: row.respiration, o2Sat: row.o2Sat, temperature: row.temperature, glucose: row.glucose, weight: row.weight, notes: row.notes ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: VitalSign = { id: editingId ?? newId(), ...values };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  const vals = form.values;

  return (
    <Stack gap="xs">
      <Box style={{ overflowX: 'auto' }}>
        <Table striped withTableBorder withColumnBorders fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>תאריך</Table.Th><Table.Th>שעה</Table.Th>
              <Table.Th>ל"ד</Table.Th><Table.Th>דופק</Table.Th>
              <Table.Th>נשימות</Table.Th><Table.Th>סטורציה</Table.Th>
              <Table.Th>חום</Table.Th><Table.Th>סוכר</Table.Th>
              <Table.Th>משקל</Table.Th><Table.Th>הערות</Table.Th>
              {!locked && <Table.Th style={{ width: 70 }} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {localRows.map((row) => (
              <Table.Tr key={row.id}>
                <Table.Td fz="xs">{cellText(row.date, '')}</Table.Td>
                <Table.Td fz="xs">{cellText(row.time, '')}</Table.Td>
                <BpCell bp={row.bp} />
                <VCell value={row.pulse}       field="pulse" />
                <VCell value={row.respiration} field="respiration" />
                <VCell value={row.o2Sat}       field="o2Sat" />
                <VCell value={row.temperature} field="temperature" />
                <VCell value={row.glucose}     field="glucose" />
                <Table.Td fz="xs">{row.weight ?? '—'}</Table.Td>
                <Table.Td fz="xs">{row.notes ?? '—'}</Table.Td>
                {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
              </Table.Tr>
            ))}
            {localRows.length === 0 && <Table.Tr><Table.Td colSpan={11} ta="center" c="dimmed">אין מדדים</Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Box>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת מדדים' : 'הוספת מדדים'} size="lg">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="sm">
            <Group grow>
              <DateField label="תאריך *" {...form.getInputProps('date')} />
              <TextInput label="שעה *" type="time" {...form.getInputProps('time')} />
            </Group>
            <Group grow align="flex-start">
              <TextInput
                label='לחץ דם (ל"ד)'
                placeholder="120/80"
                description={bpDesc(vals.bp)}
                {...form.getInputProps('bp')}
              />
              <NumberInput
                label="דופק (bpm)"
                min={VITAL.pulse.absMin} max={VITAL.pulse.absMax}
                description={vitalDesc(vals.pulse, 'pulse', 'bpm')}
                {...form.getInputProps('pulse')}
              />
            </Group>
            <Group grow align="flex-start">
              <NumberInput
                label="נשימות (לדקה)"
                min={VITAL.respiration.absMin} max={VITAL.respiration.absMax}
                description={vitalDesc(vals.respiration, 'respiration', '/דקה')}
                {...form.getInputProps('respiration')}
              />
              <NumberInput
                label="סטורציה (%)"
                min={VITAL.o2Sat.absMin} max={VITAL.o2Sat.absMax}
                description={vitalDesc(vals.o2Sat, 'o2Sat', '%')}
                {...form.getInputProps('o2Sat')}
              />
            </Group>
            <Group grow align="flex-start">
              <NumberInput
                label="חום (°C)"
                min={VITAL.temperature.absMin} max={VITAL.temperature.absMax}
                decimalScale={1}
                description={vitalDesc(vals.temperature, 'temperature', '°C')}
                {...form.getInputProps('temperature')}
              />
              <NumberInput
                label="סוכר (mg/dL)"
                min={VITAL.glucose.absMin} max={VITAL.glucose.absMax}
                description={vitalDesc(vals.glucose, 'glucose', 'mg/dL')}
                {...form.getInputProps('glucose')}
              />
            </Group>
            <Group grow align="flex-start">
              <NumberInput
                label={'משקל (ק"ג)'}
                min={VITAL.weight.absMin} max={VITAL.weight.absMax}
                decimalScale={1}
                {...form.getInputProps('weight')}
              />
              <TextInput label="הערות" {...form.getInputProps('notes')} />
            </Group>
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Treatments / Admin orders editor (shared) ────────────────────────────────

interface TreatmentsEditorProps { rows: Treatment[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function TreatmentsEditor({ rows, locked, saving, onFocus, onSave }: TreatmentsEditorProps) {
  const [localRows, setLocalRows] = useState<Treatment[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  const form = useForm({
    initialValues: { drugName: '', dosage: '', startDate: '', duration: '', notes: '' },
    validate: { drugName: (v) => v.trim() ? null : 'שדה חובה' },
  });

  function openAdd() { onFocus(); form.reset(); setEditingId(null); setOpen(true); }
  function openEdit(row: Treatment) {
    form.setValues({ drugName: row.drugName, dosage: row.dosage ?? '', startDate: row.startDate ?? '', duration: row.duration ?? '', notes: row.notes ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: Treatment = { id: editingId ?? newId(), ...values };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
      <Table striped withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>שם תרופה</Table.Th><Table.Th>מינון</Table.Th>
            <Table.Th>תאריך התחלה</Table.Th><Table.Th>משך טיפול</Table.Th>
            <Table.Th>הערות</Table.Th>
            {!locked && <Table.Th style={{ width: 70 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {localRows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td>{row.drugName}</Table.Td><Table.Td>{row.dosage ?? '—'}</Table.Td>
              <Table.Td>{cellText(row.startDate)}</Table.Td><Table.Td>{row.duration ?? '—'}</Table.Td>
              <Table.Td>{row.notes ?? '—'}</Table.Td>
              {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
            </Table.Tr>
          ))}
          {localRows.length === 0 && <Table.Tr><Table.Td colSpan={6} ta="center" c="dimmed">אין רשומות</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת תרופה/טיפול' : 'הוספת תרופה/טיפול'} size="sm">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            <DrugAutocomplete label="שם תרופה *" {...form.getInputProps('drugName')} />
            <TextInput label="מינון" {...form.getInputProps('dosage')} />
            <DateField label="תאריך התחלה" {...form.getInputProps('startDate')} />
            <TextInput label="משך טיפול" placeholder="לדוגמה: 5 ימים" {...form.getInputProps('duration')} />
            <Textarea label="הערות" {...form.getInputProps('notes')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Diagnoses editor ─────────────────────────────────────────────────────────

interface DiagnosesEditorProps { rows: Diagnosis[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function DiagnosesEditor({ rows, locked, saving, onFocus, onSave }: DiagnosesEditorProps) {
  const [localRows, setLocalRows] = useState<Diagnosis[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  const form = useForm({
    initialValues: { diagnosis: '', startDate: '', endDate: '', status: '', isPrimary: false, location: '', severity: '', notes: '' },
    validate: { diagnosis: (v) => v.trim() ? null : 'שדה חובה' },
  });

  function openAdd() { onFocus(); form.reset(); setEditingId(null); setOpen(true); }
  function openEdit(row: Diagnosis) {
    form.setValues({ diagnosis: row.diagnosis, startDate: row.startDate ?? '', endDate: row.endDate ?? '', status: row.status ?? '', isPrimary: row.isPrimary, location: row.location ?? '', severity: row.severity ?? '', notes: row.notes ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: Diagnosis = { id: editingId ?? newId(), ...values };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
      <Table striped withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>אבחנה</Table.Th><Table.Th>ת.התחלה</Table.Th><Table.Th>ת.סיום</Table.Th>
            <Table.Th>סטטוס</Table.Th><Table.Th>עיקרית</Table.Th><Table.Th>חומרה</Table.Th>
            {!locked && <Table.Th style={{ width: 70 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {localRows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td>{row.diagnosis}</Table.Td>
              <Table.Td>{cellText(row.startDate)}</Table.Td><Table.Td>{cellText(row.endDate)}</Table.Td>
              <Table.Td>{row.status ?? '—'}</Table.Td>
              <Table.Td>{row.isPrimary ? '✓' : ''}</Table.Td>
              <Table.Td>{row.severity ?? '—'}</Table.Td>
              {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
            </Table.Tr>
          ))}
          {localRows.length === 0 && <Table.Tr><Table.Td colSpan={7} ta="center" c="dimmed">אין אבחנות</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת אבחנה' : 'הוספת אבחנה'} size="md">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            <DiagnosisSelect label="אבחנה *" {...form.getInputProps('diagnosis')} />
            <Group grow>
              <DateField label="ת.התחלה" {...form.getInputProps('startDate')} />
              <DateField label="ת.סיום" {...form.getInputProps('endDate')} />
            </Group>
            <Group grow>
              <TextInput label="סטטוס" {...form.getInputProps('status')} />
              <TextInput label="מיקום" {...form.getInputProps('location')} />
            </Group>
            <Select label="חומרה" data={['קלה', 'בינונית', 'קשה', 'קריטית']} clearable {...form.getInputProps('severity')} />
            <Checkbox label="אבחנה עיקרית" {...form.getInputProps('isPrimary', { type: 'checkbox' })} />
            <Textarea label="הערות" {...form.getInputProps('notes')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Discharge medications editor ─────────────────────────────────────────────

interface DischargeMedsEditorProps { rows: DischargeMedication[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function DischargeMedsEditor({ rows, locked, saving, onFocus, onSave }: DischargeMedsEditorProps) {
  const [localRows, setLocalRows] = useState<DischargeMedication[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  const form = useForm({
    initialValues: { drugName: '', dosage: '', notes: '' },
    validate: { drugName: (v) => v.trim() ? null : 'שדה חובה' },
  });

  function openAdd() { onFocus(); form.reset(); setEditingId(null); setOpen(true); }
  function openEdit(row: DischargeMedication) {
    form.setValues({ drugName: row.drugName, dosage: row.dosage ?? '', notes: row.notes ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: DischargeMedication = { id: editingId ?? newId(), ...values };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
      <Table striped withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>שם תרופה</Table.Th><Table.Th>מינון</Table.Th><Table.Th>הערות</Table.Th>
            {!locked && <Table.Th style={{ width: 70 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {localRows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td>{row.drugName}</Table.Td><Table.Td>{row.dosage ?? '—'}</Table.Td><Table.Td>{row.notes ?? '—'}</Table.Td>
              {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
            </Table.Tr>
          ))}
          {localRows.length === 0 && <Table.Tr><Table.Td colSpan={4} ta="center" c="dimmed">אין תרופות שחרור</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת תרופת שחרור' : 'הוספת תרופת שחרור'} size="sm">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            <DrugAutocomplete label="שם תרופה *" {...form.getInputProps('drugName')} />
            <TextInput label="מינון" {...form.getInputProps('dosage')} />
            <Textarea label="הערות" {...form.getInputProps('notes')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}

// ─── Routing editor ───────────────────────────────────────────────────────────

interface RoutingEditorProps { rows: Routing[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; visit?: Visit | null; }

function RoutingEditor({ rows, locked, saving, onFocus, onSave, visit }: RoutingEditorProps) {
  const queryClient = useQueryClient();
  const [localRows, setLocalRows] = useState<Routing[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [referSel, setReferSel] = useState<string[]>([]);
  const [referring, setReferring] = useState(false);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

  // Refer to stations/departments — performs the REAL referral (care steps / department move / auto-dual)
  // AND documents each target as a routing row. One "רופא X" moves the department; "רופא נשים" + "רופא X"
  // auto-creates a dual track (handled server-side). Mirrors the "הפנה לתחנה" quick action.
  const doRefer = async () => {
    if (!visit || referSel.length === 0) return;
    setReferring(true);
    try {
      await visitsApi.referToStations(visit.id, referSel, visit.receptionDepartment ?? null);
      const today = new Date().toISOString().slice(0, 10);
      const docRows: Routing[] = referSel.map((label) => ({
        id: newId(), station: label as StationType, status: 'הופנה', arrivalDate: today,
      }));
      commit([...localRows, ...docRows]);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['visit', visit.id] });
      const movedDepts = referSel.map((s) => DEPARTMENT_STATIONS[s]).filter(Boolean);
      notifications.show({
        color: 'green',
        message: movedDepts.length >= 2
          ? 'נקבע שיוך כפול (מחלקת נשים + מחלקה נוספת)'
          : movedDepts.length === 1
            ? `ההפניה בוצעה; המחלקה עודכנה ל${movedDepts[0]}`
            : 'ההפניה לתחנות בוצעה',
      });
      setReferSel([]);
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorMessage(e, 'ההפניה לתחנה נכשלה') });
    } finally {
      setReferring(false);
    }
  };

  const form = useForm({
    initialValues: { station: '' as StationType | '', status: '', arrivalDate: '' },
    validate: { station: (v) => v ? null : 'שדה חובה' },
  });

  function openAdd() { onFocus(); form.reset(); setEditingId(null); setOpen(true); }
  function openEdit(row: Routing) {
    form.setValues({ station: row.station, status: row.status ?? '', arrivalDate: row.arrivalDate ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: Routing = { id: editingId ?? newId(), station: values.station as StationType, status: values.status, arrivalDate: values.arrivalDate };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
      {!locked && visit && (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <MultiSelect
            label="הפניה לתחנות (מבצע הפניה ומתעד)"
            placeholder="בחר תחנה/מחלקה"
            data={REFERRAL_GROUPS}
            value={referSel}
            onChange={setReferSel}
            onFocus={onFocus}
            searchable
            clearable
            style={{ flex: 1 }}
            comboboxProps={{ withinPortal: true }}
          />
          <Button size="sm" loading={referring} disabled={referSel.length === 0} onClick={doRefer}>הפנה</Button>
        </Group>
      )}
      <Table striped withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>תחנה</Table.Th><Table.Th>סטטוס</Table.Th><Table.Th>תאריך הגעה</Table.Th>
            {!locked && <Table.Th style={{ width: 70 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {localRows.map((row) => (
            <Table.Tr key={row.id}>
              <Table.Td>{cellText(row.station)}</Table.Td><Table.Td>{row.status ?? '—'}</Table.Td><Table.Td>{cellText(row.arrivalDate)}</Table.Td>
              {!locked && <Table.Td><TableActions onEdit={() => openEdit(row)} onDelete={() => commit(localRows.filter((x) => x.id !== row.id))} locked={locked} /></Table.Td>}
            </Table.Tr>
          ))}
          {localRows.length === 0 && <Table.Tr><Table.Td colSpan={4} ta="center" c="dimmed">אין הפניות</Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <AddButton onClick={openAdd} locked={locked} />
        {saving && <Group gap={4}><Loader size={12} /><Text size="xs" c="dimmed">שומר…</Text></Group>}
      </Group>
      <Modal opened={open} onClose={() => setOpen(false)} title={editingId ? 'עריכת הפניה' : 'הוספת הפניה'} size="sm">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            <Select label="תחנה *" data={STATION_OPTIONS} searchable {...form.getInputProps('station')} />
            <TextInput label="סטטוס" {...form.getInputProps('status')} />
            <DateField label="תאריך הגעה" {...form.getInputProps('arrivalDate')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
