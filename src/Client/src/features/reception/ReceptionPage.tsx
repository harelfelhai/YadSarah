import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Divider, Grid, Group, Select, Stack, Tabs, Text,
  TextInput, Title, Checkbox, Textarea, NumberInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconSearch, IconUserPlus } from '@tabler/icons-react';
import { patientsApi } from '../../api/patients';
import { visitsApi } from '../../api/visits';
import type { IdentityType, Patient } from '../../types';

const IDENTITY_TYPES: IdentityType[] = [
  'תעודת זהות', 'דרכון', 'זמני', 'ת"ז פלסטינית', 'יילוד', 'לא ידוע',
];

const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית'];

const ADMISSION_METHODS = ['רגיל', 'אמבולנס', 'הפניה', 'עצמאי'];
const ARRIVAL_METHODS = ['הגיע בעצמו', 'אמבולנס', 'משטרה', 'צבא'];

export default function ReceptionPage() {
  const navigate = useNavigate();
  const [foundPatient, setFoundPatient] = useState<Patient | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Search ──────────────────────────────────────────────────────────────
  const searchForm = useForm({
    initialValues: { identityType: 'תעודת זהות' as IdentityType, identityNumber: '' },
  });

  const handleSearch = async (values: typeof searchForm.values) => {
    setSearching(true);
    try {
      const results = await patientsApi.search(values.identityNumber);
      setFoundPatient(results[0] ?? null);
      if (results[0]) patientForm.setValues(toFormValues(results[0]));
    } finally {
      setSearching(false);
    }
  };

  // ── Patient form ─────────────────────────────────────────────────────────
  const patientForm = useForm({
    initialValues: {
      identityType: 'תעודת זהות' as IdentityType,
      identityNumber: '',
      firstName: '', lastName: '', firstNameLatin: '', lastNameLatin: '', fatherName: '',
      birthDate: '', birthCountry: '', maritalStatus: '', numberOfChildren: 0,
      city: '', street: '', houseNumber: '', zipCode: '', poBox: '',
      phoneMobile: '', phoneHome: '', phoneWork: '', phoneExtra1: '', phoneExtra2: '',
      email: '', fax: '',
      digitalContactPerson: '', digitalContactPhone: '', acceptsDigitalInfo: false,
      healthFund: '', healthFundBranch: '', familyDoctorName: '',
      clinicPhone: '', clinicFax: '', clinicEmail: '',
      notes: '', isConfidential: false, isBlocked: false, isHonorBlocked: false, accountingCard: false,
    },
    validate: {
      firstName: (v) => (v.trim() ? null : 'שדה חובה'),
      lastName: (v) => (v.trim() ? null : 'שדה חובה'),
    },
  });

  // ── Visit form ───────────────────────────────────────────────────────────
  const visitForm = useForm({
    initialValues: {
      receptionDepartment: '',
      admissionMethod: '',
      admissionReason: '',
      admissionReasonFree: '',
      arrivalMethod: '',
      ambulanceCompany: '',
      referringSource: '',
      referringDoctor: '',
      incidentNumber: '',
      visitNumberAtStation: '',
      commitmentNumber: '',
      commitmentExpiryDate: '',
      receptionActivity: '',
      totalToCollect: 0,
      exemptionReason: '',
    },
  });

  const handleSubmit = async () => {
    setSaving(true);
    try {
      let patient = foundPatient;
      if (!patient) {
        patient = await patientsApi.create({
          ...patientForm.values,
          numberOfChildren: patientForm.values.numberOfChildren ?? 0,
        });
      }

      const now = new Date();
      const visit = await visitsApi.create({
        patientId: patient.id,
        status: 'Waiting',
        admissionDate: now.toISOString().split('T')[0],
        admissionTime: now.toTimeString().slice(0, 5),
        ...visitForm.values,
        totalToCollect: visitForm.values.totalToCollect ?? 0,
      });

      navigate(`/queue`, { state: { newVisitId: visit.id } });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>קבלת מטופל</Title>
        <Button variant="subtle" onClick={() => navigate('/queue')}>חזרה לתור</Button>
      </Group>

      {/* Search */}
      <Card withBorder p="md">
        <form onSubmit={searchForm.onSubmit(handleSearch)}>
          <Group align="flex-end" gap="sm">
            <Select
              label="סוג תעודה"
              data={IDENTITY_TYPES}
              w={180}
              {...searchForm.getInputProps('identityType')}
            />
            <TextInput
              label="מספר תעודה"
              placeholder="חפש מטופל קיים"
              flex={1}
              {...searchForm.getInputProps('identityNumber')}
            />
            <Button
              type="submit"
              leftSection={<IconSearch size={16} />}
              loading={searching}
              variant="light"
            >
              חיפוש
            </Button>
            <Button
              leftSection={<IconUserPlus size={16} />}
              variant="outline"
              onClick={() => { setFoundPatient(null); patientForm.reset(); }}
            >
              מטופל חדש
            </Button>
          </Group>
        </form>
        {foundPatient !== null && !foundPatient && (
          <Text c="dimmed" mt="xs" size="sm">לא נמצא מטופל — ניתן להוסיף חדש</Text>
        )}
        {foundPatient && (
          <Text c="green.7" mt="xs" size="sm">
            נמצא: {foundPatient.firstName} {foundPatient.lastName}
          </Text>
        )}
      </Card>

      <Tabs defaultValue="patient">
        <Tabs.List>
          <Tabs.Tab value="patient">פרטי מטופל</Tabs.Tab>
          <Tabs.Tab value="visit">פרטי קבלה</Tabs.Tab>
        </Tabs.List>

        {/* ── Patient tab ── */}
        <Tabs.Panel value="patient" pt="md">
          <Stack gap="md">
            <Card withBorder p="md">
              <Text fw={600} mb="sm">זיהוי ופרטים אישיים</Text>
              <Grid gutter="sm">
                <Grid.Col span={4}>
                  <Select label="סוג תעודה" data={IDENTITY_TYPES} {...patientForm.getInputProps('identityType')} />
                </Grid.Col>
                <Grid.Col span={4}>
                  <TextInput label="מספר תעודה" {...patientForm.getInputProps('identityNumber')} />
                </Grid.Col>
                <Grid.Col span={4} />
                <Grid.Col span={3}>
                  <TextInput label="שם פרטי" withAsterisk {...patientForm.getInputProps('firstName')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="שם משפחה" withAsterisk {...patientForm.getInputProps('lastName')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="שם פרטי לועזי" {...patientForm.getInputProps('firstNameLatin')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="שם משפחה לועזי" {...patientForm.getInputProps('lastNameLatin')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="שם האב" {...patientForm.getInputProps('fatherName')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="תאריך לידה" type="date" {...patientForm.getInputProps('birthDate')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="ארץ לידה" {...patientForm.getInputProps('birthCountry')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="מצב משפחתי" {...patientForm.getInputProps('maritalStatus')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <NumberInput label="מספר ילדים" min={0} {...patientForm.getInputProps('numberOfChildren')} />
                </Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">כתובת</Text>
              <Grid gutter="sm">
                <Grid.Col span={4}><TextInput label="עיר" {...patientForm.getInputProps('city')} /></Grid.Col>
                <Grid.Col span={4}><TextInput label="רחוב" {...patientForm.getInputProps('street')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="מספר" {...patientForm.getInputProps('houseNumber')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="מיקוד" {...patientForm.getInputProps('zipCode')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="ת.ד" {...patientForm.getInputProps('poBox')} /></Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">טלפונים ותקשורת</Text>
              <Grid gutter="sm">
                <Grid.Col span={3}><TextInput label="טלפון נייד" {...patientForm.getInputProps('phoneMobile')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון בית" {...patientForm.getInputProps('phoneHome')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון עבודה" {...patientForm.getInputProps('phoneWork')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון נוסף 1" {...patientForm.getInputProps('phoneExtra1')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון נוסף 2" {...patientForm.getInputProps('phoneExtra2')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label='דוא"ל' {...patientForm.getInputProps('email')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="פקס" {...patientForm.getInputProps('fax')} /></Grid.Col>
                <Grid.Col span={6}><TextInput label="איש קשר למידע דיגיטלי" {...patientForm.getInputProps('digitalContactPerson')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון נייד לדיגיטלי" {...patientForm.getInputProps('digitalContactPhone')} /></Grid.Col>
                <Grid.Col span={12}>
                  <Checkbox
                    label="מאשר קבלת מידע דיגיטלי (מייל/SMS/זימון תור/תזכורות)"
                    {...patientForm.getInputProps('acceptsDigitalInfo', { type: 'checkbox' })}
                  />
                </Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">קופ"ח ומרפאה</Text>
              <Grid gutter="sm">
                <Grid.Col span={3}><Select label='קופת חולים' data={HEALTH_FUNDS} clearable {...patientForm.getInputProps('healthFund')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="סניף קופת חולים" {...patientForm.getInputProps('healthFundBranch')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="שם רופא משפחה" {...patientForm.getInputProps('familyDoctorName')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון מרפאה" {...patientForm.getInputProps('clinicPhone')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="פקס מרפאה" {...patientForm.getInputProps('clinicFax')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label='דוא"ל מרפאה' {...patientForm.getInputProps('clinicEmail')} /></Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">דגלים והערות</Text>
              <Grid gutter="sm">
                <Grid.Col span={12}>
                  <Group gap="lg">
                    <Checkbox label="חסוי" {...patientForm.getInputProps('isConfidential', { type: 'checkbox' })} />
                    <Checkbox label="לא לכבד" {...patientForm.getInputProps('isHonorBlocked', { type: 'checkbox' })} />
                    <Checkbox label="חסום" {...patientForm.getInputProps('isBlocked', { type: 'checkbox' })} />
                    <Checkbox label="כרטסת בהנהלת חשבונות" {...patientForm.getInputProps('accountingCard', { type: 'checkbox' })} />
                  </Group>
                </Grid.Col>
                <Grid.Col span={12}>
                  <Textarea label="הערות" rows={3} {...patientForm.getInputProps('notes')} />
                </Grid.Col>
              </Grid>
            </Card>
          </Stack>
        </Tabs.Panel>

        {/* ── Visit tab ── */}
        <Tabs.Panel value="visit" pt="md">
          <Card withBorder p="md">
            <Grid gutter="sm">
              <Grid.Col span={4}>
                <TextInput label="מחלקת קבלה" {...visitForm.getInputProps('receptionDepartment')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select label="אופן קבלה" data={ADMISSION_METHODS} clearable {...visitForm.getInputProps('admissionMethod')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select label="דרך הגעה" data={ARRIVAL_METHODS} clearable {...visitForm.getInputProps('arrivalMethod')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="סיבת קבלה" {...visitForm.getInputProps('admissionReason')} />
              </Grid.Col>
              <Grid.Col span={8}>
                <TextInput label="סיבת קבלה (חופשי)" {...visitForm.getInputProps('admissionReasonFree')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="חברת אמבולנס" {...visitForm.getInputProps('ambulanceCompany')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="גורם מפנה" {...visitForm.getInputProps('referringSource')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="רופא מפנה" {...visitForm.getInputProps('referringDoctor')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="מספר אירוע" {...visitForm.getInputProps('incidentNumber')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="מספר ביקור במוקד" {...visitForm.getInputProps('visitNumberAtStation')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="מספר התחייבות" {...visitForm.getInputProps('commitmentNumber')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="תוקף התחייבות" type="date" {...visitForm.getInputProps('commitmentExpiryDate')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput label="פעילות בקבלה" {...visitForm.getInputProps('receptionActivity')} />
              </Grid.Col>
              <Grid.Col span={4}>
                <NumberInput label="סה״כ לגבייה מהמטופל (₪)" min={0} {...visitForm.getInputProps('totalToCollect')} />
              </Grid.Col>
              <Grid.Col span={8}>
                <TextInput label="סיבת הפטור" {...visitForm.getInputProps('exemptionReason')} />
              </Grid.Col>
            </Grid>
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Divider />
      <Group justify="flex-end">
        <Button variant="subtle" onClick={() => navigate('/queue')}>ביטול</Button>
        <Button onClick={handleSubmit} loading={saving}>
          אשר קבלה והכנס לתור
        </Button>
      </Group>
    </Stack>
  );
}

function toFormValues(p: Patient) {
  return {
    identityType: p.identityType,
    identityNumber: p.identityNumber ?? '',
    firstName: p.firstName, lastName: p.lastName,
    firstNameLatin: p.firstNameLatin ?? '', lastNameLatin: p.lastNameLatin ?? '',
    fatherName: p.fatherName ?? '', birthDate: p.birthDate ?? '', birthCountry: p.birthCountry ?? '',
    maritalStatus: p.maritalStatus ?? '', numberOfChildren: p.numberOfChildren ?? 0,
    city: p.city ?? '', street: p.street ?? '', houseNumber: p.houseNumber ?? '',
    zipCode: p.zipCode ?? '', poBox: p.poBox ?? '',
    phoneMobile: p.phoneMobile ?? '', phoneHome: p.phoneHome ?? '', phoneWork: p.phoneWork ?? '',
    phoneExtra1: p.phoneExtra1 ?? '', phoneExtra2: p.phoneExtra2 ?? '',
    email: p.email ?? '', fax: p.fax ?? '',
    digitalContactPerson: p.digitalContactPerson ?? '', digitalContactPhone: p.digitalContactPhone ?? '',
    acceptsDigitalInfo: p.acceptsDigitalInfo,
    healthFund: p.healthFund ?? '', healthFundBranch: p.healthFundBranch ?? '',
    familyDoctorName: p.familyDoctorName ?? '',
    clinicPhone: p.clinicPhone ?? '', clinicFax: p.clinicFax ?? '', clinicEmail: p.clinicEmail ?? '',
    notes: p.notes ?? '',
    isConfidential: p.isConfidential, isBlocked: p.isBlocked, isHonorBlocked: p.isHonorBlocked,
    accountingCard: p.accountingCard,
  };
}
