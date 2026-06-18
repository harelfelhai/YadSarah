import { useState } from 'react';
import { Autocomplete, Button, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceDesktop } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { workstationApi } from '../api/workstation';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { apiErrorMessage } from '../constants/formPolicy';

/**
 * Shown on a computer's first connection to pin it to a fixed room. The room is then
 * remembered for that machine permanently, so the system knows where a clinician is
 * when they take a patient. Required (cannot be dismissed) — every workstation must
 * declare its room once.
 */
export default function WorkstationSetupModal({ onDone }: { onDone: (room: string) => void }) {
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
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
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
          זוהי ההתחברות הראשונה ממחשב זה. ציין באיזה חדר הוא נמצא — המערכת תזכור זאת
          לכל ההמשך, כדי לדעת היכן נמצא הצוות בעת טיפול. (מנהל מערכת יכול לשנות בהמשך.)
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
        <Button fullWidth loading={saving} disabled={!room.trim()} onClick={save}>
          שמירה
        </Button>
      </Stack>
    </Modal>
  );
}
