import { useState } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconStar } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { useAuthStore } from '../../store/auth';
import { canPrioritizeQueue } from '../../constants/roles';
import { SPECIAL_QUEUE_LETTER, queueLabel } from '../../constants/departments';
import type { Visit } from '../../types';

/**
 * Clinical actions that act on the whole visit (not a single care step). Referrals — station, department
 * move, and the women's dual-track — are all performed from the "ניתוב / הפניות" section of the medical form
 * (which both documents and acts), so the only whole-visit action left here is promoting to the special queue.
 */
export default function TreatmentActions({ visit }: { visit: Visit }) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const canPrioritize = canPrioritizeQueue(user?.roles);
  const discharged = visit.status === 'Discharged';
  const isSpecial = visit.queueLetter === SPECIAL_QUEUE_LETTER;

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const doPromote = async () => {
    setPromoting(true);
    try {
      await visitsApi.moveToSpecialQueue(visit.id);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['visit', visit.id] });
      notifications.show({ color: 'pine', message: 'המטופל קודם לתור המיוחד' });
      setPromoteOpen(false);
    } catch {
      notifications.show({ color: 'brick', message: 'קידום המטופל נכשל' });
    } finally {
      setPromoting(false);
    }
  };

  const patientName = visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : 'המטופל';

  if (!canPrioritize || discharged || isSpecial) return null;

  return (
    <>
      <Group gap="xs">
        <Button size="xs" variant="light" color="yellow" leftSection={<IconStar size={14} />} onClick={() => setPromoteOpen(true)}>
          קדם לתור מיוחד
        </Button>
      </Group>

      <Modal opened={promoteOpen} onClose={() => setPromoteOpen(false)} title="קידום לתור מיוחד" centered>
        <Stack gap="sm">
          <Text size="sm">
            להעביר את {patientName} (מס׳ תור {queueLabel(visit.queueLetter, visit.queueNumber)}) לתור המיוחד?
            המטופל יקבל מספר חדש בתור המיוחד ויקודם לראש התור.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setPromoteOpen(false)}>ביטול</Button>
            <Button color="yellow" loading={promoting} leftSection={<IconStar size={16} />} onClick={doPromote}>קדם לתור מיוחד</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
