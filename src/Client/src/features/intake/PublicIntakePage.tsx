import { useState } from 'react';
import {
  Alert, Autocomplete, Button, Card, Center, Checkbox, Container, Grid, Group,
  Select, Stack, Text, Textarea, TextInput, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCircleCheck, IconHeartHandshake } from '@tabler/icons-react';
import { ISRAELI_CITIES, DEFAULT_CITY } from '../../constants/israeliCities';
import { validateIsraeliId } from '../../utils/israeliId';
import { formatPhone, phoneValidationError, digitsOnly } from '../../utils/phone';
import { intakeApi, type IntakeSubmitPayload } from '../../api/intake';
import type { IdentityType } from '../../types';
import BirthDateField from '../../components/BirthDateField';

// Public page is intentionally a slim, mobile-first subset of the staffed reception screen:
// patient self-fill only — NO existing-patient lookup, NO department/AI routing, NO staff flags.

const IDENTITY_TYPES: { value: IdentityType; label: string }[] = [
  { value: 'תעודת זהות', label: 'תעודת זהות' },
  { value: 'דרכון', label: 'דרכון' },
];
const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית', 'הראל', 'AIM', 'ללא'];
const ADMISSION_REASONS = [
  'כאב', 'פציעה / חבלה', 'חום', 'קוצר נשימה', 'בחילה / הקאות',
  'חולשה / עילפון', 'בדיקה רפואית', 'ייעוץ', 'המשך טיפול', 'תאונת דרכים', 'אחר',
];
const GENDERS = [
  { value: 'ז', label: 'זכר' },
  { value: 'נ', label: 'נקבה' },
  { value: 'א', label: 'אחר' },
];

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function PublicIntakePage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const form = useForm({
    initialValues: {
      identityType: 'תעודת זהות' as IdentityType,
      identityNumber: '',
      firstName: '', lastName: '', fatherName: '', gender: '', birthDate: '',
      city: DEFAULT_CITY, street: '', houseNumber: '',
      phoneMobile: '', phoneHome: '', email: '',
      digitalContactPerson: '', digitalContactRelation: '', digitalContactPhone: '',
      acceptsDigitalInfo: false,
      healthFund: '',
      admissionReason: '', notes: '',
    },
    validate: {
      identityNumber: (v, vals) => {
        const t = (v ?? '').trim();
        if (!t) return 'יש להזין מספר תעודה';
        if (vals.identityType === 'תעודת זהות' && !validateIsraeliId(t))
          return 'מספר תעודת זהות אינו תקין';
        return null;
      },
      firstName: (v) => (!v.trim() ? 'שדה חובה' : /[<>]/.test(v) ? 'אסור להשתמש ב-< או >' : null),
      lastName: (v) => (!v.trim() ? 'שדה חובה' : /[<>]/.test(v) ? 'אסור להשתמש ב-< או >' : null),
      // Two contact numbers required: טלפון 1 always; second may be טלפון 2 or the contact's mobile.
      phoneMobile: (v) => phoneValidationError(v ?? '', true),
      phoneHome: (v, vals) => {
        const err = phoneValidationError(v ?? '', false);
        if (err) return err;
        const hasSecond =
          digitsOnly(v ?? '').length >= 9 || digitsOnly(vals.digitalContactPhone ?? '').length >= 9;
        return hasSecond ? null : 'נדרש מספר שני: טלפון 2 או נייד איש קשר';
      },
      digitalContactPhone: (v) => phoneValidationError(v ?? '', false),
      email: (v) => (v && !EMAIL_RX.test(v.trim()) ? 'כתובת דוא"ל אינה תקינה' : null),
      admissionReason: (v) => (!v.trim() ? 'יש לבחור סיבת פנייה' : null),
    },
  });

  const phoneProps = (field: 'phoneMobile' | 'phoneHome' | 'digitalContactPhone') => ({
    value: formatPhone(form.values[field] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      form.setFieldValue(field, formatPhone(e.currentTarget.value)),
    error: form.errors[field],
    inputMode: 'tel' as const,
  });

  const handleSubmit = async () => {
    if (form.validate().hasErrors) {
      notifications.show({ message: 'יש שדות חסרים או שגויים — אנא בדקו את הטופס', color: 'red' });
      return;
    }
    setSubmitting(true);
    try {
      const v = form.values;
      const payload: IntakeSubmitPayload = {
        identityType: v.identityType,
        identityNumber: v.identityNumber.trim(),
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        fatherName: v.fatherName || undefined,
        gender: v.gender || undefined,
        birthDate: v.birthDate || undefined,
        city: v.city || undefined,
        street: v.street || undefined,
        houseNumber: v.houseNumber || undefined,
        phoneMobile: v.phoneMobile || undefined,
        phoneHome: v.phoneHome || undefined,
        email: v.email || undefined,
        digitalContactPerson: v.digitalContactPerson || undefined,
        digitalContactRelation: v.digitalContactRelation || undefined,
        digitalContactPhone: v.digitalContactPhone || undefined,
        acceptsDigitalInfo: v.acceptsDigitalInfo,
        healthFund: v.healthFund || undefined,
        admissionReason: v.admissionReason || undefined,
        notes: v.notes || undefined,
      };
      await intakeApi.submit(payload);
      setDone(true);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const message = status === 429
        ? 'בוצעו כבר מספר שליחות מהמכשיר הזה. אנא פנו לדלפק הקבלה.'
        : (e as Error).message || 'אירעה שגיאה בשליחת הטופס';
      notifications.show({ message, color: 'red' });
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Container size="xs" py="xl">
        <Center>
          <Card withBorder p="xl" w="100%">
            <Stack align="center" gap="md">
              <IconCircleCheck size={64} color="var(--mantine-color-moss-6)" />
              <Title order={3} ta="center">הטופס נשלח בהצלחה</Title>
              <Text ta="center" c="dimmed">
                תודה! הפרטים שמילאת נשלחו לדלפק הקבלה. אנא גש/י לדלפק כדי להשלים את הקליטה.
              </Text>
            </Stack>
          </Card>
        </Center>
      </Container>
    );
  }

  return (
    <Container size="sm" py="md" px="sm">
      <Stack gap="md">
        <Group gap="xs" justify="center">
          <IconHeartHandshake size={28} color="var(--mantine-color-steel-6)" />
          <Title order={3}>קבלה עצמית — יד שרה</Title>
        </Group>
        <Alert color="steel" variant="light">
          מלא/י את פרטיך כאן כדי לקצר את ההמתנה בדלפק. לאחר השליחה יש לגשת לדלפק הקבלה.
        </Alert>

        {/* ── Identity ── */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">זיהוי</Text>
          <Grid>
            <Grid.Col span={{ base: 12, xs: 5 }}>
              <Select
                label="סוג תעודה"
                data={IDENTITY_TYPES}
                allowDeselect={false}
                {...form.getInputProps('identityType')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 7 }}>
              <TextInput label="מספר תעודה" withAsterisk inputMode="numeric" {...form.getInputProps('identityNumber')} />
            </Grid.Col>
          </Grid>
        </Card>

        {/* ── Personal ── */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">פרטים אישיים</Text>
          <Grid>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="שם פרטי" withAsterisk {...form.getInputProps('firstName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="שם משפחה" withAsterisk {...form.getInputProps('lastName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="שם האב" {...form.getInputProps('fatherName')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <Select label="מין" data={GENDERS} clearable {...form.getInputProps('gender')} />
            </Grid.Col>
            <Grid.Col span={12}>
              <BirthDateField
                label="תאריך לידה"
                value={form.values.birthDate}
                onChange={(iso) => form.setFieldValue('birthDate', iso)}
              />
            </Grid.Col>
          </Grid>
        </Card>

        {/* ── Address ── */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">כתובת</Text>
          <Grid>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <Autocomplete
                label="עיר"
                data={ISRAELI_CITIES as unknown as string[]}
                limit={20}
                {...form.getInputProps('city')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="רחוב" {...form.getInputProps('street')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}>
              <TextInput label="מספר בית" {...form.getInputProps('houseNumber')} />
            </Grid.Col>
          </Grid>
        </Card>

        {/* ── Contact ── */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">טלפונים ותקשורת</Text>
          <Grid>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="טלפון 1" withAsterisk placeholder="050-1234567" {...phoneProps('phoneMobile')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput
                label="טלפון 2"
                placeholder="02-1234567"
                description="או נייד איש הקשר — נדרשים 2 מספרים"
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                {...phoneProps('phoneHome')}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label='דוא"ל' inputMode="email" {...form.getInputProps('email')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="איש קשר למידע" {...form.getInputProps('digitalContactPerson')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="קרבה לאיש הקשר" placeholder="בן/בת זוג, הורה…" {...form.getInputProps('digitalContactRelation')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <TextInput label="נייד איש הקשר" placeholder="050-1234567" {...phoneProps('digitalContactPhone')} />
            </Grid.Col>
            <Grid.Col span={12}>
              <Checkbox
                label="מאשר/ת קבלת מידע דיגיטלי (מייל/SMS/זימון תור/תזכורות)"
                {...form.getInputProps('acceptsDigitalInfo', { type: 'checkbox' })}
              />
            </Grid.Col>
          </Grid>
        </Card>

        {/* ── Visit / reason ── */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">פרטי הפנייה</Text>
          <Grid>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <Select label="קופת חולים" data={HEALTH_FUNDS} clearable {...form.getInputProps('healthFund')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}>
              <Select
                label="סיבת הפנייה"
                withAsterisk
                data={ADMISSION_REASONS}
                searchable
                {...form.getInputProps('admissionReason')}
              />
            </Grid.Col>
            <Grid.Col span={12}>
              <Textarea label="הערות (לא חובה)" rows={3} {...form.getInputProps('notes')} />
            </Grid.Col>
          </Grid>
        </Card>

        <Button size="md" fullWidth loading={submitting} onClick={handleSubmit}>
          שליחה לדלפק הקבלה
        </Button>
      </Stack>
    </Container>
  );
}
