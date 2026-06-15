import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, Grid, Group, Select, Stack, Text,
  TextInput, Title, Checkbox, Textarea, NumberInput, Loader, Box, Alert,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { IconAlertCircle } from '@tabler/icons-react';
import { patientsApi } from '../../api/patients';
import { useAuthStore } from '../../store/auth';
import type { IdentityType, Patient } from '../../types';

const IDENTITY_TYPES: IdentityType[] = [
  'תעודת זהות', 'דרכון', 'זמני', 'ת"ז פלסטינית', 'יילוד', 'לא ידוע',
];
const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית'];
const GENDERS = [
  { value: 'ז', label: 'זכר' },
  { value: 'נ', label: 'נקבה' },
  { value: 'א', label: 'אחר' },
];

export default function PatientEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const canEditId = user?.role === 'Admin' || user?.role === 'ShiftManager';

  const { data: patient, isLoading, isError } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => patientsApi.getById(id!),
    enabled: !!id,
  });

  const form = useForm({
    initialValues: emptyValues(),
    validate: {
      firstName: (v) => (v.trim() ? null : 'שדה חובה'),
      lastName: (v) => (v.trim() ? null : 'שדה חובה'),
    },
  });

  useEffect(() => {
    if (patient) form.setValues(fromPatient(patient));
  }, [patient]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const { hasErrors } = form.validate();
    if (hasErrors) {
      notifications.show({ message: 'יש שגיאות בטופס', color: 'red' });
      return;
    }
    try {
      await patientsApi.update(id!, {
        ...form.values,
        numberOfChildren: form.values.numberOfChildren ?? 0,
        birthDate: form.values.birthDate || undefined,
      });
      notifications.show({ message: 'פרטי המטופל עודכנו בהצלחה', color: 'green' });
      navigate(-1);
    } catch (e) {
      notifications.show({
        message: `שגיאה בשמירה: ${e instanceof Error ? e.message : 'שגיאה לא ידועה'}`,
        color: 'red',
      });
    }
  };

  if (isLoading) return <Box ta="center" py="xl"><Loader /></Box>;
  if (isError || !patient) return (
    <Box p="md">
      <Alert icon={<IconAlertCircle size={16} />} color="red">לא נמצא מטופל</Alert>
    </Box>
  );

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>
          עריכת פרטי מטופל — {patient.firstName} {patient.lastName}
        </Title>
        <Button variant="subtle" onClick={() => navigate(-1)}>חזרה</Button>
      </Group>

      {/* Identity — restricted */}
      <Card withBorder p="md">
        <Group gap="xs" mb="sm">
          <Text fw={600}>זיהוי</Text>
          {!canEditId && (
            <Text size="xs" c="orange">
              (עריכת ת"ז / סוג תעודה — מנהל משמרת / מנהל ראשי בלבד)
            </Text>
          )}
        </Group>
        <Grid>
          <Grid.Col span={3}>
            <Select
              label="סוג תעודה"
              data={IDENTITY_TYPES}
              disabled={!canEditId}
              {...form.getInputProps('identityType')}
            />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput
              label="מספר תעודה"
              disabled={!canEditId}
              {...form.getInputProps('identityNumber')}
            />
          </Grid.Col>
        </Grid>
      </Card>

      {/* Personal */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">פרטים אישיים</Text>
        <Grid>
          <Grid.Col span={3}>
            <TextInput label="שם פרטי" withAsterisk {...form.getInputProps('firstName')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="שם משפחה" withAsterisk {...form.getInputProps('lastName')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="שם פרטי לועזי" {...form.getInputProps('firstNameLatin')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="שם משפחה לועזי" {...form.getInputProps('lastNameLatin')} />
          </Grid.Col>
          <Grid.Col span={2}>
            <Select label="מין" data={GENDERS} clearable {...form.getInputProps('gender')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="שם האב" {...form.getInputProps('fatherName')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="תאריך לידה" type="date" {...form.getInputProps('birthDate')} />
          </Grid.Col>
          <Grid.Col span={2}>
            <TextInput label="ארץ לידה" {...form.getInputProps('birthCountry')} />
          </Grid.Col>
          <Grid.Col span={2}>
            <TextInput label="מצב משפחתי" {...form.getInputProps('maritalStatus')} />
          </Grid.Col>
          <Grid.Col span={2}>
            <NumberInput label="מספר ילדים" min={0} {...form.getInputProps('numberOfChildren')} />
          </Grid.Col>
        </Grid>
      </Card>

      {/* Address */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">כתובת</Text>
        <Grid>
          <Grid.Col span={4}><TextInput label="עיר" {...form.getInputProps('city')} /></Grid.Col>
          <Grid.Col span={4}><TextInput label="רחוב" {...form.getInputProps('street')} /></Grid.Col>
          <Grid.Col span={2}><TextInput label="מספר" {...form.getInputProps('houseNumber')} /></Grid.Col>
          <Grid.Col span={2}><TextInput label="מיקוד" {...form.getInputProps('zipCode')} /></Grid.Col>
          <Grid.Col span={2}><TextInput label="ת.ד" {...form.getInputProps('poBox')} /></Grid.Col>
        </Grid>
      </Card>

      {/* Contact */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">טלפונים ותקשורת</Text>
        <Grid>
          <Grid.Col span={3}><TextInput label="טלפון נייד" {...form.getInputProps('phoneMobile')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="טלפון בית" {...form.getInputProps('phoneHome')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="טלפון עבודה" {...form.getInputProps('phoneWork')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="טלפון נוסף 1" {...form.getInputProps('phoneExtra1')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="טלפון נוסף 2" {...form.getInputProps('phoneExtra2')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label='דוא"ל' {...form.getInputProps('email')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="פקס" {...form.getInputProps('fax')} /></Grid.Col>
          <Grid.Col span={6}>
            <TextInput label="איש קשר למידע דיגיטלי" {...form.getInputProps('digitalContactPerson')} />
          </Grid.Col>
          <Grid.Col span={3}>
            <TextInput label="טלפון נייד לדיגיטלי" {...form.getInputProps('digitalContactPhone')} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Checkbox
              label="מאשר קבלת מידע דיגיטלי (מייל/SMS/זימון תור/תזכורות)"
              {...form.getInputProps('acceptsDigitalInfo', { type: 'checkbox' })}
            />
          </Grid.Col>
        </Grid>
      </Card>

      {/* Health fund */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">קופ"ח ומרפאה</Text>
        <Grid>
          <Grid.Col span={3}>
            <Select label="קופת חולים" data={HEALTH_FUNDS} clearable {...form.getInputProps('healthFund')} />
          </Grid.Col>
          <Grid.Col span={3}><TextInput label="סניף" {...form.getInputProps('healthFundBranch')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="שם רופא משפחה" {...form.getInputProps('familyDoctorName')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="טלפון מרפאה" {...form.getInputProps('clinicPhone')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label="פקס מרפאה" {...form.getInputProps('clinicFax')} /></Grid.Col>
          <Grid.Col span={3}><TextInput label='דוא"ל מרפאה' {...form.getInputProps('clinicEmail')} /></Grid.Col>
        </Grid>
      </Card>

      {/* Flags & notes */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">דגלים והערות</Text>
        <Grid>
          <Grid.Col span={12}>
            <Group gap="lg">
              <Checkbox label="חסוי" {...form.getInputProps('isConfidential', { type: 'checkbox' })} />
              <Checkbox label="לא לכבד" {...form.getInputProps('isHonorBlocked', { type: 'checkbox' })} />
              <Checkbox label="חסום" {...form.getInputProps('isBlocked', { type: 'checkbox' })} />
              <Checkbox label="כרטסת בהנהלת חשבונות" {...form.getInputProps('accountingCard', { type: 'checkbox' })} />
            </Group>
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea label="הערות" rows={3} {...form.getInputProps('notes')} />
          </Grid.Col>
        </Grid>
      </Card>

      <Group justify="flex-end">
        <Button variant="subtle" onClick={() => navigate(-1)}>ביטול</Button>
        <Button onClick={handleSave}>שמור שינויים</Button>
      </Group>
    </Stack>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function emptyValues() {
  return {
    identityType: 'תעודת זהות' as IdentityType,
    identityNumber: '',
    firstName: '', lastName: '', firstNameLatin: '', lastNameLatin: '',
    gender: '', fatherName: '', birthDate: '', birthCountry: '',
    maritalStatus: '', numberOfChildren: 0,
    city: '', street: '', houseNumber: '', zipCode: '', poBox: '',
    phoneMobile: '', phoneHome: '', phoneWork: '', phoneExtra1: '', phoneExtra2: '',
    email: '', fax: '',
    digitalContactPerson: '', digitalContactPhone: '', acceptsDigitalInfo: false,
    healthFund: '', healthFundBranch: '', familyDoctorName: '',
    clinicPhone: '', clinicFax: '', clinicEmail: '',
    notes: '', isConfidential: false, isBlocked: false,
    isHonorBlocked: false, accountingCard: false,
  };
}

function fromPatient(p: Patient) {
  return {
    identityType: p.identityType,
    identityNumber: p.identityNumber ?? '',
    firstName: p.firstName,
    lastName: p.lastName,
    firstNameLatin: p.firstNameLatin ?? '',
    lastNameLatin: p.lastNameLatin ?? '',
    gender: p.gender ?? '',
    fatherName: p.fatherName ?? '',
    birthDate: p.birthDate ?? '',
    birthCountry: p.birthCountry ?? '',
    maritalStatus: p.maritalStatus ?? '',
    numberOfChildren: p.numberOfChildren ?? 0,
    city: p.city ?? '',
    street: p.street ?? '',
    houseNumber: p.houseNumber ?? '',
    zipCode: p.zipCode ?? '',
    poBox: p.poBox ?? '',
    phoneMobile: p.phoneMobile ?? '',
    phoneHome: p.phoneHome ?? '',
    phoneWork: p.phoneWork ?? '',
    phoneExtra1: p.phoneExtra1 ?? '',
    phoneExtra2: p.phoneExtra2 ?? '',
    email: p.email ?? '',
    fax: p.fax ?? '',
    digitalContactPerson: p.digitalContactPerson ?? '',
    digitalContactPhone: p.digitalContactPhone ?? '',
    acceptsDigitalInfo: p.acceptsDigitalInfo,
    healthFund: p.healthFund ?? '',
    healthFundBranch: p.healthFundBranch ?? '',
    familyDoctorName: p.familyDoctorName ?? '',
    clinicPhone: p.clinicPhone ?? '',
    clinicFax: p.clinicFax ?? '',
    clinicEmail: p.clinicEmail ?? '',
    notes: p.notes ?? '',
    isConfidential: p.isConfidential,
    isBlocked: p.isBlocked,
    isHonorBlocked: p.isHonorBlocked,
    accountingCard: p.accountingCard,
  };
}
