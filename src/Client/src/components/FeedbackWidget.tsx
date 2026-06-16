import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Alert, Button, Drawer, Group, Select, Stack, Text, Textarea, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconMessageReport, IconSend } from '@tabler/icons-react';
import {
  feedbackApi, FEEDBACK_TYPE_LABELS, SCREEN_OPTIONS, screenFromPath, GENERAL,
  type FeedbackType,
} from '../api/feedback';
import { apiErrorMessage } from '../constants/formPolicy';

const TYPE_OPTIONS = (Object.keys(FEEDBACK_TYPE_LABELS) as FeedbackType[])
  .map((value) => ({ value, label: FEEDBACK_TYPE_LABELS[value] }));

/**
 * Floating "report an issue" widget, present on every authenticated screen.
 * Lets any user report a bug / needed fix / improvement. The current screen is
 * auto-detected (and editable); the route is captured for context.
 */
export default function FeedbackWidget() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState(GENERAL);
  const [field, setField] = useState('');
  const [type, setType] = useState<FeedbackType>('Bug');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // Pre-fill the screen from the current route each time the drawer opens.
  useEffect(() => {
    if (open) {
      setScreen(screenFromPath(location.pathname));
      setField('');
      setType('Bug');
      setDescription('');
    }
  }, [open, location.pathname]);

  const submit = async () => {
    if (!description.trim()) return;
    setBusy(true);
    try {
      await feedbackApi.create({
        screen,
        fieldName: field.trim() || GENERAL,
        reportType: type,
        description: description.trim(),
        routeUrl: location.pathname,
      });
      notifications.show({ color: 'green', message: 'הדיווח נשלח — תודה!' });
      setOpen(false);
    } catch (e) {
      notifications.show({ color: 'red', message: apiErrorMessage(e, 'שליחת הדיווח נכשלה') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        leftSection={<IconMessageReport size={18} />}
        size="sm"
        radius="xl"
        color="medicalBlue"
        styles={{ root: { position: 'fixed', insetInlineStart: 20, bottom: 20, zIndex: 200, boxShadow: 'var(--mantine-shadow-md)' } }}
      >
        דיווח
      </Button>

      <Drawer
        opened={open}
        onClose={() => setOpen(false)}
        position="right"
        size="md"
        title={<Text fw={700}>דיווח על תקלה / הצעה לשיפור</Text>}
      >
        <Stack gap="sm">
          <Select
            label="מסך"
            description="זוהה אוטומטית — ניתן לשנות"
            data={SCREEN_OPTIONS}
            value={screen}
            onChange={(v) => setScreen(v ?? GENERAL)}
            allowDeselect={false}
          />
          <TextInput
            label="שדה"
            placeholder={GENERAL}
            value={field}
            onChange={(e) => setField(e.currentTarget.value)}
          />
          <Select
            label="סוג הדיווח"
            data={TYPE_OPTIONS}
            value={type}
            onChange={(v) => v && setType(v as FeedbackType)}
            allowDeselect={false}
          />
          <Textarea
            label="תיאור"
            required
            autosize
            minRows={4}
            placeholder="תאר את התקלה / התיקון הנדרש / ההצעה…"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">
            <Text size="xs">נא לא לכלול פרטים מזהים של מטופלים (שם, ת"ז) בתיאור.</Text>
          </Alert>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setOpen(false)} disabled={busy}>ביטול</Button>
            <Button
              leftSection={<IconSend size={16} />}
              loading={busy}
              disabled={!description.trim()}
              onClick={submit}
            >
              שליחה
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
}
