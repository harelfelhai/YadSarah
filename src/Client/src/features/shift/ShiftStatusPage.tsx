import { useEffect } from 'react';
import {
  Alert, Avatar, Badge, Box, Card, Group, Loader, Paper, SimpleGrid, Stack, Text, Title,
} from '@mantine/core';
import { IconLock, IconDeviceDesktop, IconBed } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftStatusApi } from '../../api/shiftStatus';
import { onQueueUpdate } from '../../realtime/hub';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';
import type { RoomStatus, ShiftWorker } from '../../types';

const ROLE_LABEL: Record<string, string> = {
  Admin: 'מנהל מערכת', ShiftManager: 'מנהל משמרת', Doctor: 'רופא/ה', Nurse: 'אח/ות', Reception: 'קבלה',
};

// free = occupied, no patient (green) · busy = with a patient (red) · empty = nobody (gray)
type RoomState = 'empty' | 'free' | 'busy';
function roomState(r: RoomStatus): RoomState {
  if (!r.occupied) return 'empty';
  return r.busy ? 'busy' : 'free';
}
const STATE_COLOR: Record<RoomState, string> = { empty: 'slate', free: 'moss', busy: 'brick' };
const STATE_TINT: Record<RoomState, string> = {
  empty: 'var(--mantine-color-slate-0)',
  free: 'var(--mantine-color-moss-0)',
  busy: 'var(--mantine-color-brick-0)',
};
const STATE_LABEL: Record<RoomState, string> = { empty: 'ריק', free: 'פנוי', busy: 'בטיפול' };

function initials(name?: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function roleLabel(role?: string | null): string {
  return role ? ROLE_LABEL[role] ?? role : '';
}

export default function ShiftStatusPage() {
  const roles = useAuthStore((s) => s.user?.roles);
  const canAccess = hasAnyRole(roles, 'Admin', 'ShiftManager');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['shift-status'],
    queryFn: () => shiftStatusApi.get(),
    enabled: canAccess,
    refetchInterval: 5_000,
  });

  // Refresh immediately when a queue/treatment event fires (live busy/free).
  useEffect(() => {
    if (!canAccess) return;
    const off = onQueueUpdate(() => {
      queryClient.invalidateQueries({ queryKey: ['shift-status'] });
    });
    return off;
  }, [canAccess, queryClient]);

  if (!canAccess) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          מסך סטטוס המשמרת נגיש למנהל משמרת ולמנהל מערכת בלבד.
        </Alert>
      </Box>
    );
  }

  const rooms = data?.rooms ?? [];
  const onShift = data?.onShift ?? [];
  const shiftStart = data?.shiftStartUtc
    ? new Date(data.shiftStartUtc).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : null;
  const busyCount = onShift.filter((w) => w.busy).length;

  return (
    <Stack gap="md" p="md">
      <Box>
        <Title order={3}>סטטוס משמרת</Title>
        <Text size="sm" c="dimmed">
          מצב חדרים וצוות בזמן אמת{shiftStart ? ` · משמרת מאז ${shiftStart}` : ''}
        </Text>
      </Box>

      {/* Roster strip */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs" align="flex-end">
          <Text fw={700}>
            {onShift.length} עובדים במשמרת
            <Text span c="dimmed" fw={400} size="sm">{`  ·  ${busyCount} בטיפול`}</Text>
          </Text>
        </Group>
        {onShift.length === 0 ? (
          <Text size="sm" c="dimmed">אף עובד לא התחבר במשמרת הנוכחית עדיין.</Text>
        ) : (
          <Group gap="xs">
            {onShift.map((w: ShiftWorker) => (
              <Badge
                key={w.userId}
                size="lg"
                variant="light"
                color={w.busy ? 'brick' : 'moss'}
                leftSection={
                  <Box
                    component="span"
                    style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: `var(--mantine-color-${w.busy ? 'brick' : 'moss'}-6)`,
                    }}
                  />
                }
                styles={{ root: { textTransform: 'none' } }}
              >
                {w.userName}
                <Text span c="dimmed" size="xs">{`  ${roleLabel(w.role)}`}</Text>
                {w.room ? <Text span size="xs">{`  · ${w.room}`}</Text> : null}
              </Badge>
            ))}
          </Group>
        )}
      </Paper>

      {/* Room grid */}
      {isLoading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : rooms.length === 0 ? (
        <Card withBorder p="xl" ta="center">
          <Text c="dimmed">
            לא הוגדרו עמדות עדיין. חדר מופיע כאן לאחר שמחשב מוגדר לחדר בהתחברות הראשונה ממנו.
          </Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, xs: 2, sm: 3, md: 4 }} spacing="md">
          {rooms.map((r) => {
            const state = roomState(r);
            const color = STATE_COLOR[state];
            return (
              <Card
                key={r.workstationId}
                withBorder
                p="md"
                style={{
                  background: STATE_TINT[state],
                  borderColor: `var(--mantine-color-${color}-4)`,
                  borderTop: `3px solid var(--mantine-color-${color}-6)`,
                  minHeight: 168,
                }}
              >
                <Stack gap="xs" align="center" justify="space-between" h="100%">
                  <Group w="100%" justify="space-between" wrap="nowrap">
                    <Text fw={700} truncate>{r.room}</Text>
                    <Badge color={color} variant="filled" size="sm">{STATE_LABEL[state]}</Badge>
                  </Group>

                  {r.occupied ? (
                    <Stack gap={4} align="center">
                      <Avatar size={52} radius="xl" color={color} variant="filled">
                        {initials(r.userName) || <IconDeviceDesktop size={24} />}
                      </Avatar>
                      <Text fw={600} ta="center" lh={1.15}>{r.userName}</Text>
                      <Text size="xs" c="dimmed">{roleLabel(r.userRole)}</Text>
                    </Stack>
                  ) : (
                    <Stack gap={4} align="center" c="dimmed">
                      <Avatar size={52} radius="xl" color="slate" variant="light">
                        <IconBed size={24} />
                      </Avatar>
                      <Text size="sm" c="dimmed">אין משתמש מחובר</Text>
                    </Stack>
                  )}

                  <Box style={{ minHeight: 24 }}>
                    {r.busy && (
                      <Badge color="brick" variant="light" size="sm">
                        מטופל #{r.patientQueueNumber} · {r.patientName}
                      </Badge>
                    )}
                  </Box>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
