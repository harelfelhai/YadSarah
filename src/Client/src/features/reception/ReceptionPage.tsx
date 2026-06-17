import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Grid, Group, Select, Stack, Stepper, Text,
  TextInput, Title, Checkbox, Textarea, NumberInput, Badge,
  Alert, ActionIcon, Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconX, IconAlertCircle } from '@tabler/icons-react';
import { DEPARTMENTS } from '../../constants/departments';
import { apiErrorMessage } from '../../constants/formPolicy';
import { patientsApi } from '../../api/patients';
import { visitsApi } from '../../api/visits';
import type { IdentityType, Patient, Visit } from '../../types';
import StickerPrint from './StickerPrint';
import DateField from '../../components/DateField';

// ─── Constants ───────────────────────────────────────────────────────────────

const IDENTITY_TYPES: IdentityType[] = [
  'תעודת זהות', 'דרכון', 'זמני', 'ת"ז פלסטינית', 'יילוד', 'לא ידוע',
];
const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית'];
const ADMISSION_METHODS = ['רגיל', 'אמבולנס', 'הפניה', 'עצמאי'];
const ARRIVAL_METHODS = ['הגיע בעצמו', 'אמבולנס', 'משטרה', 'צבא'];
const ADMISSION_REASONS = [
  'כאב', 'פציעה / חבלה', 'חום', 'קוצר נשימה', 'בחילה / הקאות',
  'חולשה / עילפון', 'בדיקה רפואית', 'ייעוץ', 'המשך טיפול', 'תאונת דרכים', 'אחר',
];
const GENDERS = [
  { value: 'ז', label: 'זכר' },
  { value: 'נ', label: 'נקבה' },
  { value: 'א', label: 'אחר' },
];

// ─── Israeli ID validation ────────────────────────────────────────────────────

function validateIsraeliId(id: string): boolean {
  const cleaned = id.replace(/\D/g, '');
  if (!cleaned || cleaned.length > 9) return false;
  const padded = cleaned.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(padded[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReceptionPage() {
  const navigate = useNavigate();

  // ID gate state
  const [idType, setIdType] = useState<IdentityType>('תעודת זהות');
  const [idNumber, setIdNumber] = useState('');
  const [idError, setIdError] = useState('');
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [foundPatient, setFoundPatient] = useState<Patient | null>(null);
  const [searching, setSearching] = useState(false);

  // Wizard step: 0 = patient details, 1 = visit details
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // After success
  const [createdVisit, setCreatedVisit] = useState<Visit | null>(null);
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null);

  // ── ID confirmation ────────────────────────────────────────────────────────
  const handleConfirmId = async () => {
    const trimmed = idNumber.trim();
    if (!trimmed) { setIdError('הזן מספר תעודה'); return; }
    if (idType === 'תעודת זהות' && !validateIsraeliId(trimmed)) {
      setIdError('מספר ת"ז אינו תקין (ספרת ביקורת)');
      return;
    }
    setIdError('');
    setSearching(true);
    try {
      const results = await patientsApi.search(trimmed);
      // Exact identity match — search is a partial (Contains) query, so never
      // load a near-match by accident; an existing record must be reused.
      const found = results.find((p) => p.identityNumber === trimmed) ?? null;
      setFoundPatient(found);
      setIdConfirmed(true);

      patientForm.reset();
      patientForm.setFieldValue('identityType', idType);
      patientForm.setFieldValue('identityNumber', trimmed);

      if (found) {
        patientForm.setValues(toFormValues(found, idType, trimmed));
        notifications.show({
          message: `מטופל קיים נטען: ${found.firstName} ${found.lastName}`,
          color: 'green',
        });
      }
    } catch {
      notifications.show({ message: 'שגיאה בחיפוש מטופל', color: 'red' });
    } finally {
      setSearching(false);
    }
  };

  const handleResetId = () => {
    setIdConfirmed(false);
    setFoundPatient(null);
    setIdNumber('');
    setIdError('');
    patientForm.reset();
    visitForm.reset();
    setStep(0);
  };

  // ── Patient form ──────────────────────────────────────────────────────────
  const patientForm = useForm({
    initialValues: {
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
    },
    validate: {
      firstName: (v) => (v.trim() ? null : 'שדה חובה'),
      lastName: (v) => (v.trim() ? null : 'שדה חובה'),
    },
  });

  // ── Visit form ────────────────────────────────────────────────────────────
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
      exemptionReason: '',
    },
    validate: {
      admissionReasonFree: (v, vals) =>
        vals.admissionReason === 'אחר' && !v.trim() ? 'יש לפרט סיבה' : null,
    },
  });

  // ── Step navigation ───────────────────────────────────────────────────────
  const handleContinue = () => {
    const pValid = patientForm.validate();
    if (pValid.hasErrors) {
      notifications.show({ message: 'יש שגיאות בפרטי המטופל', color: 'red' });
      return;
    }
    setStep(1);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const vValid = visitForm.validate();
    if (vValid.hasErrors) {
      notifications.show({ message: 'יש שגיאות בפרטי הקבלה', color: 'red' });
      return;
    }

    setSaving(true);
    try {
      // Empty date inputs come through as '' — convert to undefined so the
      // server can bind nullable DateOnly fields (otherwise JSON binding fails).
      const patientPayload = {
        ...patientForm.values,
        numberOfChildren: patientForm.values.numberOfChildren ?? 0,
        birthDate: patientForm.values.birthDate || undefined,
      };

      let patient: Patient;
      if (foundPatient) {
        patient = await patientsApi.update(foundPatient.id, patientPayload);
      } else {
        patient = await patientsApi.create(patientPayload);
      }

      const now = new Date();
      const visit = await visitsApi.create({
        patientId: patient.id,
        status: 'Waiting',
        // Local date (en-CA → YYYY-MM-DD) to stay consistent with the local admissionTime
        // below; toISOString() would use UTC and shift the date near midnight.
        admissionDate: now.toLocaleDateString('en-CA'),
        admissionTime: now.toTimeString().slice(0, 5),
        ...visitForm.values,
        commitmentExpiryDate: visitForm.values.commitmentExpiryDate || undefined,
        totalToCollect: 0,
      });

      setSavedPatient({ ...patient, healthFund: patientForm.values.healthFund });
      setCreatedVisit(visit);
    } catch (e) {
      notifications.show({
        message: apiErrorMessage(e, 'שגיאה בשמירה'),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  // Reset the whole screen back to step 1 to admit the next patient
  const handleAdmitAnother = () => {
    setCreatedVisit(null);
    setSavedPatient(null);
    handleResetId();
  };

  // ── Sticker screen ────────────────────────────────────────────────────────
  if (createdVisit && savedPatient) {
    return (
      <StickerPrint
        patient={savedPatient}
        visit={createdVisit}
        onContinue={() => navigate('/queue', { state: { newVisitId: createdVisit.id } })}
        onAdmitAnother={handleAdmitAnother}
      />
    );
  }

  const isOther = visitForm.values.admissionReason === 'אחר';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>קבלת מטופל</Title>
        <Button variant="subtle" onClick={() => navigate('/queue')}>חזרה לתור</Button>
      </Group>

      <Stepper active={idConfirmed ? step + 1 : 0} size="sm" styles={{ step: { cursor: 'default' } }}>
        <Stepper.Step label="זיהוי" />
        <Stepper.Step label="פרטי מטופל" />
        <Stepper.Step label="פרטי קבלה" />
      </Stepper>

      {/* ── ID Gate ── */}
      <Card withBorder p="md" bg={idConfirmed ? 'green.0' : undefined}>
        {!idConfirmed ? (
          <Stack gap="xs">
            <Text fw={600}>שלב 1 — זיהוי מטופל</Text>
            <Group align="flex-end" gap="sm">
              <Select
                label="סוג תעודה"
                data={IDENTITY_TYPES}
                value={idType}
                onChange={(v) => { setIdType(v as IdentityType); setIdError(''); }}
                w={180}
              />
              <TextInput
                label="מספר תעודה"
                placeholder="הזן מספר וסייס Enter"
                value={idNumber}
                onChange={(e) => { setIdNumber(e.currentTarget.value); setIdError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmId(); }}
                error={idError || undefined}
                flex={1}
              />
              <Button
                leftSection={<IconSearch size={16} />}
                loading={searching}
                onClick={handleConfirmId}
              >
                אשר וחפש
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              לאחר אישור הת"ז, טופס הפרטים האישיים יהיה זמין למילוי.
              אם המטופל קיים במערכת — פרטיו ימולאו אוטומטית.
            </Text>
          </Stack>
        ) : (
          <Group justify="space-between">
            <Group gap="sm">
              <Badge color={foundPatient ? 'green' : 'blue'} size="lg">
                {foundPatient ? 'מטופל קיים' : 'מטופל חדש'}
              </Badge>
              <Text fw={600}>{idType}: {idNumber}</Text>
              {foundPatient && (
                <Text c="dimmed">— {foundPatient.firstName} {foundPatient.lastName}</Text>
              )}
            </Group>
            <Tooltip label="שנה תעודת זהות / התחל מחדש">
              <ActionIcon variant="subtle" color="gray" onClick={handleResetId}>
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Card>

      {/* ── Forms (disabled until ID confirmed) ── */}
      <fieldset
        disabled={!idConfirmed}
        style={{
          border: 'none', padding: 0, margin: 0,
          opacity: idConfirmed ? 1 : 0.45,
          pointerEvents: idConfirmed ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
      >
        {/* ── Step 0: Patient details ── */}
        {step === 0 && (
          <Stack gap="md" mt="md">
            <Card withBorder p="md">
              <Text fw={600} mb="sm">פרטים אישיים</Text>
              <Grid>
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
                <Grid.Col span={2}>
                  <Select label="מין" data={GENDERS} clearable {...patientForm.getInputProps('gender')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <TextInput label="שם האב" {...patientForm.getInputProps('fatherName')} />
                </Grid.Col>
                <Grid.Col span={3}>
                  <DateField label="תאריך לידה" {...patientForm.getInputProps('birthDate')} />
                </Grid.Col>
                <Grid.Col span={2}>
                  <TextInput label="ארץ לידה" {...patientForm.getInputProps('birthCountry')} />
                </Grid.Col>
                <Grid.Col span={2}>
                  <TextInput label="מצב משפחתי" {...patientForm.getInputProps('maritalStatus')} />
                </Grid.Col>
                <Grid.Col span={2}>
                  <NumberInput label="מספר ילדים" min={0} {...patientForm.getInputProps('numberOfChildren')} />
                </Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">כתובת</Text>
              <Grid>
                <Grid.Col span={4}><TextInput label="עיר" {...patientForm.getInputProps('city')} /></Grid.Col>
                <Grid.Col span={4}><TextInput label="רחוב" {...patientForm.getInputProps('street')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="מספר" {...patientForm.getInputProps('houseNumber')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="מיקוד" {...patientForm.getInputProps('zipCode')} /></Grid.Col>
                <Grid.Col span={2}><TextInput label="ת.ד" {...patientForm.getInputProps('poBox')} /></Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">טלפונים ותקשורת</Text>
              <Grid>
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
              <Group gap="xs" mb="sm">
                <Text fw={600}>קופ"ח ומרפאה</Text>
                {foundPatient && (
                  <Alert icon={<IconAlertCircle size={14} />} color="orange" p="xs" radius="sm">
                    קופת חולים לא נשלפת — יש למלא מחדש
                  </Alert>
                )}
              </Group>
              <Grid>
                <Grid.Col span={3}>
                  <Select label="קופת חולים" data={HEALTH_FUNDS} clearable {...patientForm.getInputProps('healthFund')} />
                </Grid.Col>
                <Grid.Col span={3}><TextInput label="סניף" {...patientForm.getInputProps('healthFundBranch')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="שם רופא משפחה" {...patientForm.getInputProps('familyDoctorName')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="טלפון מרפאה" {...patientForm.getInputProps('clinicPhone')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label="פקס מרפאה" {...patientForm.getInputProps('clinicFax')} /></Grid.Col>
                <Grid.Col span={3}><TextInput label='דוא"ל מרפאה' {...patientForm.getInputProps('clinicEmail')} /></Grid.Col>
              </Grid>
            </Card>

            <Card withBorder p="md">
              <Text fw={600} mb="sm">דגלים והערות</Text>
              <Grid>
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

            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => navigate('/queue')}>ביטול</Button>
              <Button onClick={handleContinue} disabled={!idConfirmed}>
                המשך לפרטי קבלה ←
              </Button>
            </Group>
          </Stack>
        )}

        {/* ── Step 1: Visit details ── */}
        {step === 1 && (
          <Stack gap="md" mt="md">
            <Card withBorder p="md">
              <Grid>
                <Grid.Col span={4}>
                  <Select
                    label="מחלקה"
                    data={[...DEPARTMENTS]}
                    clearable
                    {...visitForm.getInputProps('receptionDepartment')}
                  />
                </Grid.Col>
                <Grid.Col span={4}>
                  <Select label="אופן קבלה" data={ADMISSION_METHODS} clearable {...visitForm.getInputProps('admissionMethod')} />
                </Grid.Col>
                <Grid.Col span={4}>
                  <Select label="דרך הגעה" data={ARRIVAL_METHODS} clearable {...visitForm.getInputProps('arrivalMethod')} />
                </Grid.Col>

                <Grid.Col span={isOther ? 4 : 8}>
                  <Select
                    label="סיבת קבלה"
                    data={ADMISSION_REASONS}
                    clearable
                    {...visitForm.getInputProps('admissionReason')}
                  />
                </Grid.Col>
                {isOther && (
                  <Grid.Col span={8}>
                    <TextInput
                      label='פירוט ("אחר")'
                      withAsterisk
                      placeholder="פרט את סיבת הקבלה"
                      {...visitForm.getInputProps('admissionReasonFree')}
                    />
                  </Grid.Col>
                )}

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
                  <DateField label="תוקף התחייבות" {...visitForm.getInputProps('commitmentExpiryDate')} />
                </Grid.Col>
                <Grid.Col span={4}>
                  <TextInput label="פעילות בקבלה" {...visitForm.getInputProps('receptionActivity')} />
                </Grid.Col>
                <Grid.Col span={4}>
                  <NumberInput
                    label="סה״כ לגבייה מהמטופל (₪)"
                    value={0}
                    readOnly
                    styles={{ input: { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } }}
                    description="מחושב לפי סיבת קבלה וקופ״ח"
                  />
                </Grid.Col>
                <Grid.Col span={8}>
                  <TextInput label="סיבת הפטור" {...visitForm.getInputProps('exemptionReason')} />
                </Grid.Col>
              </Grid>
            </Card>

            <Group justify="space-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                ← חזרה לפרטי מטופל
              </Button>
              <Button onClick={handleSubmit} loading={saving}>
                סיים והכנס לתור
              </Button>
            </Group>
          </Stack>
        )}
      </fieldset>
    </Stack>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toFormValues(p: Patient, idType: IdentityType, idNumber: string) {
  return {
    identityType: idType,
    identityNumber: idNumber,
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
    healthFund: '',           // always empty — re-enter each visit
    healthFundBranch: '',
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
