import { useEffect, useRef, useState } from 'react';
import {
  Card, Group, Stack, Title, Text, Button, Select, Box, Loader, Alert, Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconClock, IconDeviceFloppy, IconInfoCircle, IconLock, IconPill, IconRefresh, IconUpload,
} from '@tabler/icons-react';
import { settingsApi } from '../../api/settings';
import { medicationsApi } from '../../api/medications';
import { apiErrorMessage } from '../../constants/formPolicy';
import { useAuthStore } from '../../store/auth';

const QUEUE_RESET_HOUR_KEY = 'queue.resetHour';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));

export default function SettingsPage() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'Admin';

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getAll(),
    enabled: isAdmin,
  });

  const updateMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsApi.update(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({ color: 'green', message: 'ההגדרה נשמרה' });
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'שמירת ההגדרה נכשלה') }),
  });

  // ── Queue reset hour ──
  const resetSetting = settings.find((s) => s.key === QUEUE_RESET_HOUR_KEY);
  const [resetHour, setResetHour] = useState<string>('18');
  useEffect(() => {
    if (resetSetting) setResetHour(resetSetting.value);
  }, [resetSetting?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetDirty = !!resetSetting && resetHour !== resetSetting.value;

  // ── Medication catalog ──
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: medStatus } = useQuery({
    queryKey: ['medStatus'],
    queryFn: () => medicationsApi.getStatus(),
    enabled: isAdmin,
  });

  const syncMut = useMutation({
    mutationFn: () => medicationsApi.sync(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['medStatus'] });
      notifications.show({ color: 'green', message: r.message });
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'סנכרון מסד התרופות נכשל') }),
  });

  const importMut = useMutation({
    mutationFn: (file: File) => medicationsApi.importFile(file),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['medStatus'] });
      notifications.show({ color: 'green', message: r.message });
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'ייבוא הקובץ נכשל') }),
  });

  const formatSync = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'מעולם לא';

  if (!isAdmin) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          הגדרות המערכת נגישות למנהל מערכת (Admin) בלבד.
        </Alert>
      </Box>
    );
  }

  if (isLoading) return <Box ta="center" py="xl"><Loader /></Box>;

  return (
    <Stack gap="md" p="md">
      <Title order={3}>הגדרות מערכת</Title>

      {/* ── Queue ── */}
      <Card withBorder p="md" radius="md">
        <Group gap="xs" mb="sm">
          <IconClock size={18} />
          <Text fw={600}>תור</Text>
        </Group>

        <Group align="flex-end" gap="md">
          <Select
            label="שעת איפוס מונה התור היומי"
            description="המספור מתאפס לאחד בשעה זו (שעון ישראל). שעת הפתיחה היא 19:00."
            data={HOUR_OPTIONS}
            value={resetHour}
            onChange={(v) => v && setResetHour(v)}
            w={260}
            leftSection={<IconClock size={16} />}
          />
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            disabled={!resetDirty}
            loading={updateMut.isPending}
            onClick={() => updateMut.mutate({ key: QUEUE_RESET_HOUR_KEY, value: resetHour })}
          >
            שמור
          </Button>
        </Group>

        <Alert icon={<IconInfoCircle size={15} />} color="blue" variant="light" mt="sm" p="xs">
          <Text size="xs">
            כל המטופלים שמתקבלים מרגע האיפוס ועד האיפוס הבא מקבלים מספור רץ (1, 2, 3…).
            הגדרת ברירת המחדל היא 18:00 — שעה לפני הפתיחה — כדי שהמונה יהיה נקי בתחילת המשמרת.
          </Text>
        </Alert>
      </Card>

      {/* ── Medication catalog ── */}
      <Card withBorder p="md" radius="md">
        <Group gap="xs" mb="sm">
          <IconPill size={18} />
          <Text fw={600}>מסד התרופות</Text>
          <Badge variant="light" color="blue">{medStatus?.count ?? 0} תרופות</Badge>
        </Group>

        <Text size="sm" c="dimmed" mb="xs">
          המאגר מבוסס על פנקס התכשירים של משרד הבריאות (שם + מספר רישום). הזנת תרופה בטופס
          נשלפת מהמאגר הפנימי — ללא תלות באינטרנט. המשיכה מתבצעת אוטומטית כל {medStatus?.intervalDays ?? 7} ימים,
          וניתן לעדכן ידנית כאן.
        </Text>

        <Group gap="lg" mb="sm">
          <Text size="sm">סנכרון אחרון: <b>{formatSync(medStatus?.lastSyncAt)}</b></Text>
          {medStatus?.lastSyncStatus && (
            <Text size="xs" c="dimmed">({medStatus.lastSyncStatus})</Text>
          )}
        </Group>

        <Group gap="md">
          <Button
            leftSection={<IconRefresh size={16} />}
            loading={syncMut.isPending}
            onClick={() => syncMut.mutate()}
          >
            עדכון מסד התרופות (משיכה מ-API)
          </Button>

          <Button
            variant="outline"
            leftSection={<IconUpload size={16} />}
            loading={importMut.isPending}
            onClick={() => fileRef.current?.click()}
          >
            ייבוא מקובץ (Excel / CSV)
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) importMut.mutate(f);
              e.currentTarget.value = '';
            }}
          />
        </Group>

        <Alert icon={<IconInfoCircle size={15} />} color="blue" variant="light" mt="sm" p="xs">
          <Text size="xs">
            ייבוא רשמי: הורד את "פנקס התרופות הרשומות" (קובץ Excel) מאתר משרד הבריאות / חופש המידע,
            והעלה אותו כאן. המערכת מזהה אוטומטית את עמודות מספר הרישום והשם (עברי/אנגלי).
            הייבוא מחליף את כל המאגר בתמונת-המצב החדשה.
          </Text>
        </Alert>
      </Card>
    </Stack>
  );
}
