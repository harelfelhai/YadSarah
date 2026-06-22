import { useState } from 'react';
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconStar } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { useAuthStore } from '../../store/auth';
import { isClinicalStaff, canPrioritizeQueue, canReassignDepartment } from '../../constants/roles';
import { DEPARTMENTS, WOMENS_DEPARTMENT, SPECIAL_QUEUE_LETTER, queueLabel } from '../../constants/departments';
import { STATIONS } from '../../constants/careSteps';
import type { Visit } from '../../types';

/**
 * Clinical actions that act on the whole visit (not a single care step): change department,
 * dual women's classification, refer to a station, and promote to the special queue. These were
 * moved off the queue board into the treatment context — a clinician decides them while treating.
 */
export default function TreatmentActions({ visit }: { visit: Visit }) {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const canReassign = canReassignDepartment(user?.roles);
  const canPrioritize = canPrioritizeQueue(user?.roles);
  const isClinical = isClinicalStaff(user?.roles);
  const discharged = visit.status === 'Discharged';
  const isSpecial = visit.queueLetter === SPECIAL_QUEUE_LETTER;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['queue'] });
    qc.invalidateQueries({ queryKey: ['visit', visit.id] });
    qc.invalidateQueries({ queryKey: ['forms', visit.id] });
  };

  // ── Change department ──
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignDept, setReassignDept] = useState<string | null>(visit.receptionDepartment ?? null);
  const [reassigning, setReassigning] = useState(false);
  const doReassign = async () => {
    if (!reassignDept) return;
    setReassigning(true);
    try {
      await visitsApi.reassignDepartment(visit.id, reassignDept);
      refresh();
      notifications.show({ color: 'pine', message: 'המחלקה עודכנה (קביעת איש מקצוע)' });
      setReassignOpen(false);
    } catch {
      notifications.show({ color: 'brick', message: 'עדכון המחלקה נכשל' });
    } finally {
      setReassigning(false);
    }
  };

  // ── Dual department (women's + other) ──
  const dualOptions = visit.receptionDepartment === WOMENS_DEPARTMENT
    ? DEPARTMENTS.filter((d) => d !== WOMENS_DEPARTMENT)
    : [WOMENS_DEPARTMENT];
  const [dualOpen, setDualOpen] = useState(false);
  const [dualSecond, setDualSecond] = useState<string | null>(dualOptions.length === 1 ? dualOptions[0] : null);
  const [dualing, setDualing] = useState(false);
  const doDual = async () => {
    if (!dualSecond) return;
    setDualing(true);
    try {
      await visitsApi.setDualDepartment(visit.id, dualSecond);
      refresh();
      notifications.show({ color: 'pine', message: 'נקבע שיוך כפול (מחלקת נשים + מחלקה נוספת)' });
      setDualOpen(false);
    } catch {
      notifications.show({ color: 'brick', message: 'קביעת שיוך כפול נכשלה' });
    } finally {
      setDualing(false);
    }
  };

  // ── Refer to station ──
  const [referOpen, setReferOpen] = useState(false);
  const [referStation, setReferStation] = useState<string | null>(null);
  const [referring, setReferring] = useState(false);
  const doRefer = async () => {
    if (!referStation) return;
    setReferring(true);
    try {
      await visitsApi.referToStation(visit.id, referStation, visit.receptionDepartment ?? null);
      refresh();
      notifications.show({ color: 'pine', message: `המטופל הופנה ל${referStation}` });
      setReferOpen(false);
      setReferStation(null);
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
          <Button size="xs" variant="light" color="steel" onClick={() => { setReferStation(null); setReferOpen(true); }}>
            הפנה לתחנה
          </Button>
        )}
        {canReassign && !discharged && visit.receptionDepartment && (
          <Button size="xs" variant="light" onClick={() => { setReassignDept(visit.receptionDepartment ?? null); setReassignOpen(true); }}>
            שינוי מחלקה
          </Button>
        )}
        {canReassign && !discharged && !visit.secondaryDepartment && visit.receptionDepartment && (
          <Button size="xs" variant="light" color="grape" onClick={() => { setDualSecond(dualOptions.length === 1 ? dualOptions[0] : null); setDualOpen(true); }}>
            שיוך כפול
          </Button>
        )}
        {canPrioritize && !discharged && !isSpecial && (
          <Button size="xs" variant="light" color="yellow" leftSection={<IconStar size={14} />} onClick={() => setPromoteOpen(true)}>
            קדם לתור מיוחד
          </Button>
        )}
      </Group>

      <Modal opened={reassignOpen} onClose={() => setReassignOpen(false)} title="שינוי מחלקה" centered>
        <Stack gap="sm">
          <Text size="sm">{patientName} — מחלקה נוכחית: {visit.receptionDepartment ?? '—'}</Text>
          <Select
            label="מחלקה חדשה"
            data={[...DEPARTMENTS]}
            value={reassignDept}
            onChange={setReassignDept}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Text size="xs" c="dimmed">השינוי יסומן כקביעת איש מקצוע (לא המלצת AI). מספר התור נשמר.</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setReassignOpen(false)}>ביטול</Button>
            <Button loading={reassigning} disabled={!reassignDept || reassignDept === visit.receptionDepartment} onClick={doReassign}>
              שמור מחלקה
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={dualOpen} onClose={() => setDualOpen(false)} title="שיוך כפול למחלקה" centered>
        <Stack gap="sm">
          <Text size="sm">{patientName} — מחלקה ראשית: {visit.receptionDepartment ?? '—'}</Text>
          <Select
            label="מחלקה שנייה"
            data={dualOptions}
            value={dualSecond}
            onChange={setDualSecond}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Text size="xs" c="dimmed">
            שיוך כפול אפשרי רק כאשר אחת המחלקות היא נשים. ייפתחו שני תהליכים רפואיים (טופס נפרד לכל מחלקה);
            תהליך מחלקת הנשים מטופל ראשון. מספר התור נשמר.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setDualOpen(false)}>ביטול</Button>
            <Button color="grape" loading={dualing} disabled={!dualSecond} onClick={doDual}>קבע שיוך כפול</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={referOpen} onClose={() => setReferOpen(false)} title="הפניה לתחנה" centered>
        <Stack gap="sm">
          <Text size="sm">{patientName} — בחר תחנה שאליה המטופל מופנה.</Text>
          <Select
            label="תחנה"
            data={[...STATIONS]}
            value={referStation}
            onChange={setReferStation}
            comboboxProps={{ withinPortal: true }}
          />
          <Text size="xs" c="dimmed">בסיום התחנה המטופל יחזור אוטומטית להמתין לאיש הצוות שהפנה אותו.</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setReferOpen(false)}>ביטול</Button>
            <Button loading={referring} disabled={!referStation} onClick={doRefer}>הפנה</Button>
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
