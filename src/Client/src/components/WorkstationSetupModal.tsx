import { useState } from 'react';
import { Autocomplete, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceDesktop } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { workstationApi } from '../api/workstation';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { apiErrorMessage } from '../constants/formPolicy';

/**
 * Shown on a computer's first connection to (optionally) pin it to a fixed room. The room is
 * then remembered for that machine, so the system knows where a clinician is when they take a
 * patient. Optional — the user can skip it (e.g. a personal / off-site computer); skipping is
 * remembered on this device so it won't prompt again, and an admin can set the room later.
 */
export default function WorkstationSetupModal(
  { onDone, onSkip }: { onDone: (room: string) => void; onSkip: () => void },
) {
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rooms = [] } = useQuery({
    queryKey: ['workstation-rooms'],
    queryFn: () => workstationApi.getRooms(),
  });

  const save = async () => {
    const trimmed = room.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await workstationApi.setRoom(getOrCreateDeviceId(), trimmed);
      onDone(res.room);
    } catch (e) {
      notifications.show({ color: 'brick', message: apiErrorMessage(e, 'שמירת החדר נכשלה') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened
      onClose={onSkip}
      closeOnClickOutside={false}
      centered
      title={
        <Text fw={700}>
          <IconDeviceDesktop size={18} style={{ verticalAlign: 'middle', marginInlineEnd: 6 }} />
          הגדרת חדר למחשב זה
        </Text>
      }
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          זוהי ההתחברות הראשונה ממחשב זה. אפשר לציין באיזה חדר הוא נמצא — המערכת תזכור זאת
          כדי לדעת היכן נמצא הצוות בעת טיפול. זה אופציונלי: ניתן לדלג (ומנהל מערכת יוכל להגדיר בהמשך).
        </Text>
        <Autocomplete
          label="חדר"
          placeholder="לדוגמה: חדר 1"
          description="עד 60 תווים"
          maxLength={60}
          data={rooms}
          value={room}
          onChange={setRoom}
          data-autofocus
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <Group justify="space-between" mt="xs">
          <Button variant="subtle" color="gray" onClick={onSkip}>
            דלג
          </Button>
          <Button loading={saving} disabled={!room.trim()} onClick={save}>
            שמירה
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
