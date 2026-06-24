import { useState } from 'react';
import { Button, Group, Modal, MultiSelect, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconStar } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { useAuthStore } from '../../store/auth';
import { isClinicalStaff, canPrioritizeQueue } from '../../constants/roles';
import { SPECIAL_QUEUE_LETTER, queueLabel } from '../../constants/departments';
import { REFERRAL_GROUPS, DEPARTMENT_STATIONS } from '../../constants/careSteps';
import type { Visit } from '../../types';

/**
 * Clinical actions that act on the whole visit (not a single care step): refer to a station/department
 * and promote to the special queue. Department changes and the women's dual-track happen AUTOMATICALLY
 * off the referral — one "רופא X" moves the department; "רופא נשים" + "רופא X" auto-creates a dual track —
 * so there are no separate "change department" / "dual department" buttons.
 */
export default function TreatmentActions({ visit }: { visit: Visit }) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const canPrioritize = canPrioritizeQueue(user?.roles);
  const isClinical = isClinicalStaff(user?.roles);
  const discharged = visit.status === 'Discharged';
  const isSpecial = visit.queueLetter === SPECIAL_QUEUE_LETTER;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['queue'] });
    qc.invalidateQueries({ queryKey: ['visit', visit.id] });
    qc.invalidateQueries({ queryKey: ['forms', visit.id] });
  };

  // ── Refer to stations / departments (a department-station moves the patient; two — one women's — dual) ──
  const [referOpen, setReferOpen] = useState(false);
  const [referStations, setReferStations] = useState<string[]>([]);
  const [referring, setReferring] = useState(false);
  const doRefer = async () => {
    if (referStations.length === 0) return;
    setReferring(true);
    try {
      await visitsApi.referToStations(visit.id, referStations, visit.receptionDepartment ?? null);
      refresh();
      const movedDepts = referStations.map((s) => DEPARTMENT_STATIONS[s]).filter(Boolean);
      const message = movedDepts.length >= 2
        ? 'נקבע שיוך כפול (מחלקת נשים + מחלקה נוספת)'
        : movedDepts.length === 1
          ? `ההפניה בוצעה; המחלקה עודכנה ל${movedDepts[0]}`
          : 'ההפניה לתחנות בוצעה';
      notifications.show({ color: 'pine', message });
      setReferOpen(false);
      setReferStations([]);
    } catch {
      notifications.show({ color: 'brick', message: 'ההפניה לתחנה נכשלה' });
    } finally {
      setReferring(false);
    }
  };

  // ── Promote to special queue ──
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const doPromote = async () => {
    setPromoting(true);
    try {
      await visitsApi.moveToSpecialQueue(visit.id);
      refresh();
      notifications.show({ color: 'pine', message: 'המטופל קודם לתור המיוחד' });
      setPromoteOpen(false);
    } catch {
      notifications.show({ color: 'brick', message: 'קידום המטופל נכשל' });
    } finally {
      setPromoting(false);
    }
  };

  const patientName = visit.patient ? `${visit.patient.firstName} ${visit.patient.lastName}` : 'המטופל';

  return (
    <>
      <Group gap="xs">
        {isClinical && !discharged && (
          <Button size="xs" variant="light" color="steel" onClick={() => { setReferStations([]); setReferOpen(true); }}>
            הפנה לתחנה
          </Button>
        )}
        {canPrioritize && !discharged && !isSpecial && (
          <Button size="xs" variant="light" color="yellow" leftSection={<IconStar size={14} />} onClick={() => setPromoteOpen(true)}>
            קדם לתור מיוחד
          </Button>
        )}
      </Group>

      <Modal opened={referOpen} onClose={() => setReferOpen(false)} title="הפניה לתחנות" centered>
        <Stack gap="sm">
          <Text size="sm">{patientName} — סמן תחנה אחת או יותר שאליהן המטופל מופנה.</Text>
          <MultiSelect
            label="תחנות"
            data={REFERRAL_GROUPS}
            value={referStations}
            onChange={setReferStations}
            searchable
            clearable
            comboboxProps={{ withinPortal: true }}
          />
          <Text size="xs" c="dimmed">
            בסיום כל תחנה המטופל חוזר אוטומטית להמתין לאיש הצוות שהפנה אותו. "אחות כללית" מוסיפה המתנה
            לאחות באותה מחלקה; הפניה ל"רופא X" מעבירה את המטופל לאותה מחלקה, והפניה גם ל"רופא נשים" וגם
            ל"רופא X" יוצרת אוטומטית שיוך כפול (נשים + מחלקה נוספת).
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setReferOpen(false)}>ביטול</Button>
            <Button loading={referring} disabled={referStations.length === 0} onClick={doRefer}>הפנה</Button>
          </Group>
        </Stack>
      </Modal>

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
