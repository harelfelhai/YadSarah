import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon, Alert, Autocomplete, Badge, Box, Button, Card, Checkbox, Divider,
  Group, Loader, Modal, NumberInput, Paper, Select, Stack, Table, Text, Textarea, TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck, IconClock, IconDownload, IconEdit, IconInfoCircle, IconLock, IconLockOpen,
  IconPlus, IconPrinter, IconTrash, IconWriting,
} from '@tabler/icons-react';
import { visitsApi } from '../../api/visits';
import { formsApi } from '../../api/forms';
import { useAuthStore } from '../../store/auth';
import { canEditSection, canEditSignedForm, apiErrorMessage } from '../../constants/formPolicy';
import {
  joinForm, leaveForm, onLockAcquired, onLockReleased,
  onFormSectionUpdated, onPresenceUpdate, onFormSigned, onFormAddendaChanged,
} from '../../realtime/hub';
import type {
  Allergy, Diagnosis, DischargeMedication, FormLockInfo,
  MedicalForm, PresenceUpdate, Routing, StationType, Treatment, VitalSign,
} from '../../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const COMMON_DRUGS = [
  'PARACETAMOL', 'DIPYRONE', 'IBUPROFEN', 'AMOXICILLIN', 'AZITHROMYCIN',
  'METFORMIN', 'AMLODIPINE', 'LISINOPRIL', 'ATORVASTATIN', 'OMEPRAZOLE',
  'ASPIRIN', 'CLOPIDOGREL', 'METOPROLOL', 'FUROSEMIDE', 'PREDNISONE',
  'ONDANSETRON', 'DEXAMETHASONE', 'MORPHINE', 'TRAMADOL', 'CODEINE',
];

const STATION_OPTIONS: StationType[] = [
  'טריאז׳', 'טריאז׳ ילדים', 'רופא ר.דחופה', 'רופא ילדים', 'רופאת הריון',
  'רופא טראומה', 'אחות', 'אחות ילדים', 'אחות טיפולים',
  'מעבדה', 'א.ק.ג', 'רנטגן', 'US', 'מוקד 119',
];

const TEXT_SECTION_KEYS = [
  'chiefComplaint', 'presentIllness', 'pastMedicalHistory', 'triage',
  'physicalExam', 'discussionAndPlan', 'dischargeRecommendations', 'orderedUnits',
];

const SECTIONS = [
  { key: 'chiefComplaint', label: 'סיבת הפנייה / תלונה עיקרית' },
  { key: 'presentIllness', label: 'מחלה נוכחית (HPI)' },
  { key: 'pastMedicalHistory', label: 'רקע רפואי' },
  { key: 'allergies', label: 'רגישויות' },
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
  const [signing, setSigning] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Refs for serialized auto-save (always uses the latest version)
  const formRef = useRef<MedicalForm | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const debounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  // Auto-create a single shared form if the visit has none yet
  useEffect(() => {
    if (!formsLoading && forms.length === 0 && visitId && user) {
      formsApi.create(visitId, 'רופא ר.דחופה' as import('../../types').StationType, 'סיכום ביקור' as import('../../types').FormType)
        .then(() => queryClient.invalidateQueries({ queryKey: ['forms', visitId] }))
        .catch(() => {/* already has a form, ignore */ });
    }
  }, [formsLoading, forms.length, visitId, user, queryClient]);

  useEffect(() => {
    if (forms.length > 0) {
      setActiveForm((prev) => prev
        ? (forms as unknown as MedicalForm[]).find((f) => f.id === prev.id) ?? prev
        : (forms[0] as unknown as MedicalForm));
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
        if (upd.formId === activeForm.id && upd.editedByUserId !== user?.id) {
          // Another user changed a field — pull the authoritative form
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

  // ── Derived edit-permission state ──────────────────────────────────────────
  const formSigned = !!activeForm?.isSigned;
  const canEditSigned = canEditSignedForm(
    user?.role, formSigned, activeForm?.signedAt, activeForm?.postSignEditWindowMinutes ?? 10);
  void nowTick; // re-evaluate canEditSigned on each tick

  const sectionReadOnly = (section: string): boolean => {
    if (!activeForm) return true;
    if (formSigned && !canEditSigned) return true;             // signed → locked
    if (!canEditSection(user?.role, section)) return true;     // role can't edit this field
    if (locks[section] && locks[section].lockedByUserId !== user?.id) return true; // held by another
    return false;
  };
  const lockedBy = (section: string) => locks[section]?.lockedByName;

  // ── Serialized save ────────────────────────────────────────────────────────
  const persistSection = useCallback((section: string, value: unknown) => {
    saveChain.current = saveChain.current.then(async () => {
      const cur = formRef.current;
      if (!cur) return;
      // Skip redundant text saves (value unchanged)
      if (typeof value === 'string' && value === String((cur as Record<string, unknown>)[section] ?? '')) {
        return;
      }
      setSaveState((s) => ({ ...s, [section]: 'saving' }));
      try {
        const updated = await formsApi.updateSection(cur.id, section, value, cur.version) as unknown as MedicalForm;
        formRef.current = updated;
        setActiveForm(updated);
        setSaveState((s) => ({ ...s, [section]: 'saved' }));
      } catch (e) {
        setSaveState((s) => ({ ...s, [section]: 'error' }));
        notifications.show({ color: 'red', message: apiErrorMessage(e, 'שמירה נכשלה') });
        queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
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
    const value = localTextValues[section] ?? String((activeForm as Record<string, unknown>)[section] ?? '');
    persistSection(section, value);
    formsApi.releaseLock(activeForm.id, section).catch(() => {});
  };

  const handleTableSave = useCallback((section: string, rows: unknown[]) => {
    persistSection(section, rows);
    if (formRef.current) formsApi.releaseLock(formRef.current.id, section).catch(() => {});
  }, [persistSection]);

  // ── Signing ────────────────────────────────────────────────────────────────
  const doSign = async () => {
    if (!activeForm) return;
    setSigning(true);
    try {
      const updated = await formsApi.sign(activeForm.id) as unknown as MedicalForm;
      formRef.current = updated;
      setActiveForm(updated);
      setSignConfirm(false);
      notifications.show({ color: 'green', message: 'הטופס נחתם והטיפול הסתיים' });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorMessage(e, 'החתימה נכשלה') });
    } finally {
      setSigning(false);
    }
  };

  const isDoctor = user?.role === 'Doctor';

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
              <Text fw={600}>{visit?.queueNumber ?? '—'}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">ת.ז</Text>
              <Text>{visit?.patient?.identityNumber ?? '—'}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">שעת הגעה</Text>
              <Text>{visit?.admissionTime ?? '—'}</Text>
            </Box>
          </Group>
          <Group gap="xs">
            {presence.map((u) => (
              <Tooltip key={u.userId} label={`${u.fullName} (${u.role})`}>
                <Badge variant="dot" color="green">{u.fullName.split(' ')[0]}</Badge>
              </Tooltip>
            ))}
          </Group>
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

      {activeForm && (
        <Stack gap="sm">
          {SECTIONS.map(({ key, label }) => {
            const readOnly = sectionReadOnly(key);
            const heldByOther = !!locks[key] && locks[key].lockedByUserId !== user?.id;
            const myLock = locks[key]?.lockedByUserId === user?.id;
            const isText = TEXT_SECTION_KEYS.includes(key);
            const edit = activeForm.fieldEdits?.[key];
            const st = saveState[key];
            const noPerm = !canEditSection(user?.role, key);

            return (
              <Card key={key} withBorder p="sm" radius="md">
                <Group gap="xs" mb="xs">
                  <Text fw={600} size="sm">{label}</Text>
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
                    value={localTextValues[key] ?? String((activeForm as Record<string, unknown>)[key] ?? '')}
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
                  />
                )}
              </Card>
            );
          })}
        </Stack>
      )}

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
          <Button
            leftSection={<IconDownload size={16} />}
            variant="outline"
            onClick={() => activeForm && formsApi.export(activeForm.id)}
          >
            ייצוא (JSON)
          </Button>
          {formSigned && activeForm && visit && (
            <Button
              leftSection={<IconPrinter size={16} />}
              variant="outline"
              onClick={() => printForm(activeForm, visit)}
            >
              הדפסה
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

      {/* Sign confirmation */}
      <Modal opened={signConfirm} onClose={() => setSignConfirm(false)} title="חתימה על הטופס" centered>
        <Stack gap="sm">
          <Text size="sm">
            לאחר החתימה הטופס יינעל לעריכה והטיפול יסומן כ"סיים טיפול".
            שינויים לאחר מכן יתאפשרו רק למנהל משמרת בחלון של {activeForm?.postSignEditWindowMinutes ?? 10} דקות,
            או באמצעות "תוספת לאחר חתימה".
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setSignConfirm(false)}>ביטול</Button>
            <Button color="teal" loading={signing} onClick={doSign} leftSection={<IconWriting size={16} />}>
              חתום וסיים טיפול
            </Button>
          </Group>
        </Stack>
      </Modal>
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

// ─── Addenda section ───────────────────────────────────────────────────────────

function AddendaSection({ form, isDoctor, onChange }: {
  form: MedicalForm;
  isDoctor: boolean;
  onChange: (f: MedicalForm) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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

  const signAddendum = async (addendumId: string) => {
    try {
      const updated = await formsApi.signAddendum(form.id, addendumId) as unknown as MedicalForm;
      onChange(updated);
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorMessage(e, 'חתימה על תוספת נכשלה') });
    }
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
                  onClick={() => signAddendum(a.id)}>
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
      <span>מס׳ תור: ${esc(visit.queueNumber)}</span>
      <span>תאריך: ${esc(visit.admissionDate)} ${esc(visit.admissionTime)}</span>
    </div>
  </div>`);

  // Text sections — only if filled
  for (const { key, label } of SECTIONS) {
    if (TEXT_SECTION_KEYS.includes(key)) {
      const val = (form as Record<string, unknown>)[key];
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
}

function TableSectionRouter({ sectionKey, form, locked, saving, onFocus, onSave }: TableSectionProps) {
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
    case 'routing':
      return <RoutingEditor rows={form.routing ?? []} locked={locked} saving={saving} onFocus={onFocus} onSave={onSave} />;
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
      : [...localRows, { id: crypto.randomUUID(), ...values }];
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
              <Table.Td>{row.determinationDate ?? '—'}</Table.Td>
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
            <TextInput label="שם תרופה *" {...form.getInputProps('drugName')} />
            <TextInput label="סוג" {...form.getInputProps('type')} />
            <TextInput label="השפעה" {...form.getInputProps('effect')} />
            <TextInput label="ת.קביעה" type="date" {...form.getInputProps('determinationDate')} />
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

  function openAdd() { onFocus(); form.setValues(emptyVital); setEditingId(null); setOpen(true); }
  function openEdit(row: VitalSign) {
    form.setValues({ date: row.date, time: row.time, bp: row.bp ?? '', pulse: row.pulse, respiration: row.respiration, o2Sat: row.o2Sat, temperature: row.temperature, glucose: row.glucose, weight: row.weight, notes: row.notes ?? '' });
    setEditingId(row.id); setOpen(true);
  }

  function handleSubmit(values: typeof form.values) {
    const row: VitalSign = { id: editingId ?? crypto.randomUUID(), ...values };
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
                <Table.Td fz="xs">{row.date}</Table.Td>
                <Table.Td fz="xs">{row.time}</Table.Td>
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
              <TextInput label="תאריך *" type="date" {...form.getInputProps('date')} />
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
    const row: Treatment = { id: editingId ?? crypto.randomUUID(), ...values };
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
              <Table.Td>{row.startDate ?? '—'}</Table.Td><Table.Td>{row.duration ?? '—'}</Table.Td>
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
            <Autocomplete label="שם תרופה *" data={COMMON_DRUGS} {...form.getInputProps('drugName')} />
            <TextInput label="מינון" {...form.getInputProps('dosage')} />
            <TextInput label="תאריך התחלה" type="date" {...form.getInputProps('startDate')} />
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
    const row: Diagnosis = { id: editingId ?? crypto.randomUUID(), ...values };
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
              <Table.Td>{row.startDate ?? '—'}</Table.Td><Table.Td>{row.endDate ?? '—'}</Table.Td>
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
            <TextInput label="אבחנה *" {...form.getInputProps('diagnosis')} />
            <Group grow>
              <TextInput label="ת.התחלה" type="date" {...form.getInputProps('startDate')} />
              <TextInput label="ת.סיום" type="date" {...form.getInputProps('endDate')} />
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
    const row: DischargeMedication = { id: editingId ?? crypto.randomUUID(), ...values };
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
            <Autocomplete label="שם תרופה *" data={COMMON_DRUGS} {...form.getInputProps('drugName')} />
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

interface RoutingEditorProps { rows: Routing[]; locked: boolean; saving: boolean; onFocus: () => void; onSave: (r: unknown[]) => void; }

function RoutingEditor({ rows, locked, saving, onFocus, onSave }: RoutingEditorProps) {
  const [localRows, setLocalRows] = useState<Routing[]>(rows);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setLocalRows(rows); }, [rows]);

  // Auto-save: every mutation persists immediately (no manual save button)
  const commit = (next: typeof localRows) => { setLocalRows(next); onSave(next); };

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
    const row: Routing = { id: editingId ?? crypto.randomUUID(), station: values.station as StationType, status: values.status, arrivalDate: values.arrivalDate };
    const next = editingId ? localRows.map((x) => x.id === editingId ? row : x) : [...localRows, row];
    commit(next);
    setOpen(false);
  }

  return (
    <Stack gap="xs">
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
              <Table.Td>{row.station}</Table.Td><Table.Td>{row.status ?? '—'}</Table.Td><Table.Td>{row.arrivalDate ?? '—'}</Table.Td>
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
            <TextInput label="תאריך הגעה" type="date" {...form.getInputProps('arrivalDate')} />
            <Group justify="flex-end"><Button type="submit" size="sm">שמור</Button></Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
