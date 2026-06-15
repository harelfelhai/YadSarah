import { useEffect, useState } from 'react';
import {
  Card, Group, Stack, Title, Text, Button, Select, Box, Loader, Alert,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconClock, IconDeviceFloppy, IconInfoCircle, IconLock } from '@tabler/icons-react';
import { settingsApi } from '../../api/settings';
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

      {/* Future settings cards will be added here */}
      <Text size="xs" c="dimmed">הגדרות נוספות יתווספו כאן בהמשך.</Text>
    </Stack>
  );
}
