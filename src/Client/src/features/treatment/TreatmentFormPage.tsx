import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion, ActionIcon, Badge, Box, Button, Card, Divider, Group,
  Loader, Select, Stack, Table, Text, Textarea, TextInput, Title, Tooltip,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconLock, IconLockOpen, IconPlus, IconDownload } from '@tabler/icons-react';
import { visitsApi } from '../../api/visits';
import { formsApi } from '../../api/forms';
import { useAuthStore } from '../../store/auth';
import {
  joinForm, leaveForm, onLockAcquired, onLockReleased,
  onFormSectionUpdated, onPresenceUpdate,
} from '../../realtime/hub';
import type { MedicalForm, FormLockInfo, PresenceUpdate } from '../../types';

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
  { key: 'orderedUnits', label: 'יחידות להזמנה' },
];

export default function TreatmentFormPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [locks, setLocks] = useState<Record<string, FormLockInfo>>({});
  const [presence, setPresence] = useState<PresenceUpdate['presentUsers']>([]);
  const [activeForm, setActiveForm] = useState<MedicalForm | null>(null);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [savingSection, setSavingSection] = useState<string | null>(null);

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

  // Use the first form by default (or let user pick)
  useEffect(() => {
    if (forms.length > 0 && !activeForm) setActiveForm(forms[0]);
  }, [forms, activeForm]);

  // SignalR presence + locks
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
        if (upd.formId === activeForm.id) {
          setActiveForm((f) => f ? { ...f, [upd.sectionName]: upd.data } : f);
          queryClient.invalidateQueries({ queryKey: ['forms', visitId] });
        }
      }),
    ];

    return () => {
      leaveForm(activeForm.id);
      offs.forEach((off) => off());
    };
  }, [activeForm?.id, queryClient, visitId]);

  const isSectionLocked = (section: string) =>
    !!locks[section] && locks[section].lockedByUserId !== user?.id;

  const lockedBy = (section: string) => locks[section]?.lockedByName;

  const handleFocus = async (section: string) => {
    if (!activeForm) return;
    await formsApi.acquireLock(activeForm.id, section);
  };

  const handleSave = useCallback(async (section: string) => {
    if (!activeForm) return;
    setSavingSection(section);
    try {
      const updated = await formsApi.updateSection(
        activeForm.id, section, localValues[section] ?? activeForm[section as keyof MedicalForm], activeForm.version
      );
      setActiveForm(updated);
      await formsApi.releaseLock(activeForm.id, section);
      setLocks((prev) => { const n = { ...prev }; delete n[section]; return n; });
    } finally {
      setSavingSection(null);
    }
  }, [activeForm, localValues]);

  const handleDischarge = async () => {
    if (!visitId) return;
    await visitsApi.updateStatus(visitId, 'Discharged');
    navigate('/queue');
  };

  if (visitLoading || formsLoading) return <Box ta="center" py="xl"><Loader /></Box>;

  return (
    <Stack gap="md" p="md">
      {/* Header / Patient banner */}
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
              <Text size="xs" c="dimmed">מס׳ ביקור</Text>
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
            <Button size="xs" color="red" variant="light" onClick={handleDischarge}>
              שחרר מטופל
            </Button>
          </Group>
        </Group>
      </Card>

      {/* Form selector */}
      {forms.length > 1 && (
        <Group gap="xs">
          <Text size="sm" c="dimmed">טופס:</Text>
          {forms.map((f) => (
            <Button
              key={f.id}
              size="xs"
              variant={activeForm?.id === f.id ? 'filled' : 'outline'}
              onClick={() => setActiveForm(f)}
            >
              {f.formType} — {f.stationType}
            </Button>
          ))}
        </Group>
      )}

      {activeForm && (
        <Accordion multiple variant="separated">
          {SECTIONS.map(({ key, label }) => {
            const locked = isSectionLocked(key);
            const myLock = locks[key]?.lockedByUserId === user?.id;
            const value = localValues[key] ?? String(activeForm[key as keyof MedicalForm] ?? '');

            return (
              <Accordion.Item key={key} value={key}>
                <Accordion.Control>
                  <Group gap="xs">
                    <Text fw={500}>{label}</Text>
                    {locked && (
                      <Tooltip label={`נעול ע"י ${lockedBy(key)}`}>
                        <IconLock size={14} color="red" />
                      </Tooltip>
                    )}
                    {myLock && <IconLockOpen size={14} color="green" />}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <SectionEditor
                    sectionKey={key}
                    value={value}
                    locked={locked}
                    saving={savingSection === key}
                    onFocus={() => handleFocus(key)}
                    onChange={(v) => setLocalValues((prev) => ({ ...prev, [key]: v }))}
                    onSave={() => handleSave(key)}
                    form={activeForm}
                  />
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <Divider />
      <Group justify="flex-end">
        <Button
          leftSection={<IconDownload size={16} />}
          variant="outline"
          onClick={() => activeForm && formsApi.export(activeForm.id)}
        >
          ייצוא סיכום ביקור
        </Button>
      </Group>
    </Stack>
  );
}

// ─── Section editor — routes to the right UI per section ──────────────────

interface SectionEditorProps {
  sectionKey: string;
  value: string;
  locked: boolean;
  saving: boolean;
  form: MedicalForm;
  onFocus: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
}

function SectionEditor({ sectionKey, value, locked, saving, onFocus, onChange, onSave }: SectionEditorProps) {
  const isTextSection = [
    'chiefComplaint', 'presentIllness', 'pastMedicalHistory',
    'triage', 'physicalExam', 'discussionAndPlan',
    'dischargeRecommendations', 'orderedUnits',
  ].includes(sectionKey);

  if (isTextSection) {
    return (
      <Stack gap="xs">
        <Textarea
          value={value}
          disabled={locked}
          autosize
          minRows={3}
          onFocus={onFocus}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
        {!locked && (
          <Group justify="flex-end">
            <Button size="xs" loading={saving} onClick={onSave}>שמור</Button>
          </Group>
        )}
      </Stack>
    );
  }

  // Table sections — simplified placeholder rows with "add row" button
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {locked ? `שדה נעול — עריכה זמינה כשיתפנה` : 'לחץ על + להוספת שורה'}
      </Text>
      {!locked && (
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={onFocus}>
          הוסף שורה
        </Button>
      )}
    </Stack>
  );
}
