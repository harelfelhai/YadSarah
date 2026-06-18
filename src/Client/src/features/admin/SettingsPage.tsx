import { useEffect, useRef, useState } from 'react';
import {
  Card, Group, Stack, Title, Text, Button, Select, Box, Loader, Alert, Badge,
  Modal, Table, Code, SimpleGrid, Divider, NumberInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconClock, IconDeviceFloppy, IconInfoCircle, IconLock, IconPill, IconRefresh, IconUpload,
  IconDatabase, IconUsersGroup, IconPlayerPlay, IconTrash, IconAlertTriangle,
} from '@tabler/icons-react';
import { settingsApi } from '../../api/settings';
import { medicationsApi } from '../../api/medications';
import { demoApi, type SeedResult } from '../../api/demo';
import { apiErrorMessage } from '../../constants/formPolicy';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';

const QUEUE_RESET_HOUR_KEY = 'queue.resetHour';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));

export default function SettingsPage() {
  const qc = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles);
  const isAdmin = hasAnyRole(roles, 'Admin');

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

  // ── Demo mode (presentations) ──
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [fillCount, setFillCount] = useState<number>(50);
  const [seedConfirmOpen, setSeedConfirmOpen] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  const { data: demoStatus } = useQuery({
    queryKey: ['demoStatus'],
    queryFn: () => demoApi.status(),
    enabled: isAdmin,
  });

  const refreshAfterDemo = () => {
    qc.invalidateQueries({ queryKey: ['demoStatus'] });
    qc.invalidateQueries({ queryKey: ['queue'] });
    qc.invalidateQueries({ queryKey: ['history'] });
  };

  const fillMut = useMutation({
    mutationFn: () => demoApi.fillQueue(fillCount, true),
    onSuccess: (r) => {
      refreshAfterDemo();
      notifications.show({ color: 'green', message: `${r.added} מטופלים נכנסו לתור היום (התור אופס)` });
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'הזרמת התור נכשלה') }),
  });

  const clearMut = useMutation({
    mutationFn: () => demoApi.clearToday(),
    onSuccess: (r) => {
      refreshAfterDemo();
      notifications.show({ color: 'green', message: `תור היום נוקה (${r.removed} ביקורים הוסרו)` });
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'ניקוי התור נכשל') }),
  });

  const seedMut = useMutation({
    mutationFn: () => demoApi.seed(),
    onSuccess: (r) => {
      setSeedConfirmOpen(false);
      setSeedResult(r);
      qc.invalidateQueries();
    },
    onError: (e) => notifications.show({ color: 'red', message: apiErrorMessage(e, 'איפוס וזריעת הנתונים נכשלו') }),
  });

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

      {/* ── Demo mode (presentations) — only when enabled (non-production) ── */}
      {demoStatus?.enabled && (
        <Card withBorder p="md" radius="md" style={{ borderColor: 'var(--mantine-color-grape-4)' }}>
          <Group gap="xs" mb="sm">
            <IconDatabase size={18} />
            <Text fw={600}>מצב הדגמה (DEMO)</Text>
            <Badge variant="light" color="grape">לא לפרודקשן</Badge>
          </Group>

          <Text size="sm" c="dimmed" mb="sm">
            כלי להדגמות מול המנהל: הזרמת מטופלים לתור בלחיצה, וזריעת מאגר נתונים גדול שנראה אמיתי.
            פעיל רק כשהדגל <Code>Demo:Enabled</Code> דולק (סביבת פיתוח) — בפרודקשן הכלי מוסתר.
          </Text>

          <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
            <StatTile label="מטופלים" value={demoStatus.patients} />
            <StatTile label="ביקורים" value={demoStatus.visits} />
            <StatTile label="בתור היום" value={demoStatus.todayQueue} />
            <StatTile label="מאגר זמין" value={demoStatus.poolAvailable} />
          </SimpleGrid>

          <Group align="flex-end" gap="md">
            <NumberInput
              label="כמות לתור"
              value={fillCount}
              onChange={(v) => setFillCount(typeof v === 'number' ? v : 50)}
              min={1}
              max={200}
              w={120}
            />
            <Button
              color="grape"
              leftSection={<IconPlayerPlay size={16} />}
              loading={fillMut.isPending}
              onClick={() => fillMut.mutate()}
            >
              הזרם לתור (מחליף את תור היום)
            </Button>
            <Button
              variant="outline"
              color="gray"
              leftSection={<IconTrash size={16} />}
              loading={clearMut.isPending}
              onClick={() => {
                if (window.confirm('לנקות את כל ביקורי היום מהתור?')) clearMut.mutate();
              }}
            >
              נקה תור היום
            </Button>
          </Group>

          <Divider my="md" />

          <Group justify="space-between" align="center">
            <Box>
              <Text size="sm" fw={600}>אפס וזרע נתוני הדגמה</Text>
              <Text size="xs" c="dimmed">
                מוחק את כל המטופלים/הביקורים/הטפסים/המשתמשים ויוצר ~1,000 טיפולים + מאגר תור.
                מאגר התרופות וההגדרות נשמרים.
              </Text>
            </Box>
            <Button
              color="red"
              variant="light"
              leftSection={<IconUsersGroup size={16} />}
              onClick={() => setSeedConfirmOpen(true)}
            >
              אפס וזרע
            </Button>
          </Group>
        </Card>
      )}

      {/* Seed confirmation */}
      <Modal opened={seedConfirmOpen} onClose={() => setSeedConfirmOpen(false)} title="אישור איפוס וזריעה" centered>
        <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="md">
          פעולה הרסנית: כל המטופלים, הביקורים, הטפסים, הדיווחים, יומן הביקורת והמשתמשים יימחקו
          וייווצרו מחדש. מאגר התרופות וההגדרות יישמרו. המשך?
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setSeedConfirmOpen(false)}>ביטול</Button>
          <Button color="red" loading={seedMut.isPending} onClick={() => seedMut.mutate()}>
            כן, אפס וזרע
          </Button>
        </Group>
      </Modal>

      {/* Credentials after seeding */}
      <Modal
        opened={!!seedResult}
        onClose={() => setSeedResult(null)}
        title="נתוני ההדגמה נוצרו"
        size="lg"
        centered
      >
        {seedResult && (
          <Stack gap="sm">
            <Text size="sm">
              נוצרו <b>{seedResult.users}</b> משתמשים, <b>{seedResult.patients}</b> מטופלים,
              {' '}<b>{seedResult.visits}</b> ביקורים ומאגר תור של <b>{seedResult.poolPatients}</b>.
            </Text>
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
              המשתמשים אופסו — יש להתחבר מחדש. הסיסמה לכל המשתמשים: <Code>{demoStatus?.demoPassword}</Code>
            </Alert>
            <Box style={{ maxHeight: 320, overflow: 'auto' }}>
              <Table striped withTableBorder withColumnBorders stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>שם משתמש</Table.Th>
                    <Table.Th>שם מלא</Table.Th>
                    <Table.Th>תפקיד</Table.Th>
                    <Table.Th>מחלקה</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {seedResult.credentials.map((c) => (
                    <Table.Tr key={c.username}>
                      <Table.Td><Code>{c.username}</Code></Table.Td>
                      <Table.Td>{c.fullName}</Table.Td>
                      <Table.Td>{c.role}</Table.Td>
                      <Table.Td>{c.department ?? '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
            <Group justify="flex-end">
              <Button color="blue" onClick={() => { setSeedResult(null); clearAuth(); window.location.href = '/login'; }}>
                התחבר מחדש
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card withBorder p="xs" radius="md" ta="center">
      <Text size="xl" fw={700}>{value.toLocaleString('he-IL')}</Text>
      <Text size="xs" c="dimmed">{label}</Text>
    </Card>
  );
}
