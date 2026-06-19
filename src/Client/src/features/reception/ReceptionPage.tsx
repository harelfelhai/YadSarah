import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Grid, Group, Select, Stack, Stepper, Text,
  TextInput, Checkbox, Textarea, NumberInput, Badge,
  Alert, ActionIcon, Tooltip, Autocomplete,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconX, IconAlertCircle } from '@tabler/icons-react';
import { DEPARTMENTS } from '../../constants/departments';
import { ISRAELI_CITIES, DEFAULT_CITY } from '../../constants/israeliCities';
import { apiErrorMessage } from '../../constants/formPolicy';
import { patientsApi } from '../../api/patients';
import { visitsApi } from '../../api/visits';
import { streetsApi } from '../../api/streets';
import { formatPhone, phoneValidationError } from '../../utils/phone';
import type { IdentityType, Patient, Visit } from '../../types';
import StickerPrint from './StickerPrint';
import DateField from '../../components/DateField';
import BirthDateField from '../../components/BirthDateField';

// ─── Constants ───────────────────────────────────────────────────────────────

const IDENTITY_TYPES: { value: IdentityType; label: string }[] = [
  { value: 'תעודת זהות', label: 'ת"ז' },
  { value: 'דרכון', label: 'דרכון' },
  { value: 'מספר ביטוח רפואי', label: 'מספר ביטוח רפואי' },
  { value: 'זמני', label: 'זמני (אוטומטי)' },
];
const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית', 'הראל', 'AIM', 'ללא'];
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

// ─── Optional-field format checks (mirror the server validation) ──────────────
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailError = (v: string) => (v && !EMAIL_RX.test(v.trim()) ? 'כתובת דוא"ל אינה תקינה' : null);

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

  // Street autocomplete (city-scoped, served offline from the internal catalog)
  const [streetOptions, setStreetOptions] = useState<string[]>([]);
  const streetTimer = useRef<number | undefined>(undefined);

  // After success
  const [createdVisit, setCreatedVisit] = useState<Visit | null>(null);
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null);

  // Enter-to-advance: Step 0 container, so Enter jumps field→field (and finally
  // activates the "המשך" button) the way Tab would.
  const step0Ref = useRef<HTMLDivElement>(null);

  // ── Identity type change ────────────────────────────────────────────────────
  const handleIdTypeChange = async (v: string | null) => {
    const t = (v ?? 'תעודת זהות') as IdentityType;
    setIdType(t);
    setIdError('');
    if (t === 'זמני') {
      try {
        const r = await patientsApi.tempId();
        setIdNumber(r.value);
      } catch {
        notifications.show({ message: 'שגיאה בהקצאת מספר זמני', color: 'red' });
      }
    } else {
      setIdNumber('');
    }
  };

  // ── ID confirmation ────────────────────────────────────────────────────────
  const handleConfirmId = async () => {
    const trimmed = idNumber.trim();
    if (idType !== 'זמני') {
      if (!trimmed) { setIdError('הזן מספר תעודה'); return; }
      if (idType === 'תעודת זהות' && !validateIsraeliId(trimmed)) {
        setIdError('מספר ת"ז אינו תקין (ספרת ביקורת)');
        return;
      }
      if (idType === 'מספר ביטוח רפואי' && !/^\d{1,20}$/.test(trimmed)) {
        setIdError('מספר ביטוח רפואי חייב להכיל ספרות בלבד (עד 20)');
        return;
      }
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
    setIdType('תעודת זהות');
    setIdNumber('');
    setIdError('');
    setStreetOptions([]);
    patientForm.reset();
    visitForm.reset();
    setStep(0);
  };

  // ── Patient form ──────────────────────────────────────────────────────────
  // initialValues keeps the FULL field set (even fields no longer shown) so loading
  // an existing patient and saving back never wipes data the form doesn't render.
  const patientForm = useForm({
    initialValues: {
      identityType: 'תעודת זהות' as IdentityType,
      identityNumber: '',
      firstName: '', lastName: '', firstNameLatin: '', lastNameLatin: '',
      gender: '', fatherName: '', birthDate: '', birthCountry: '',
      maritalStatus: '', numberOfChildren: 0,
      city: DEFAULT_CITY, street: '', houseNumber: '', zipCode: '', poBox: '',
      phoneMobile: '', phoneHome: '', phoneWork: '', phoneExtra1: '', phoneExtra2: '',
      email: '', fax: '',
      digitalContactPerson: '', digitalContactRelation: '', digitalContactPhone: '', acceptsDigitalInfo: false,
      healthFund: '', healthFundBranch: '', familyDoctorName: '',
      clinicPhone: '', clinicFax: '', clinicEmail: '',
      notes: '', isConfidential: false, isBlocked: false,
      isHonorBlocked: false, accountingCard: false,
    },
    validate: {
      firstName: (v) => (!v.trim() ? 'שדה חובה' : /[<>]/.test(v) ? 'אסור להשתמש ב-< או >' : null),
      lastName: (v) => (!v.trim() ? 'שדה חובה' : /[<>]/.test(v) ? 'אסור להשתמש ב-< או >' : null),
      fatherName: (v) => (!v.trim() ? 'שדה חובה (אפשר "לא ידוע")' : /[<>]/.test(v) ? 'אסור להשתמש ב-< או >' : null),
      phoneMobile: (v) => phoneValidationError(v ?? '', true),
      phoneHome: (v) => phoneValidationError(v ?? '', true),
      digitalContactPhone: (v) => phoneValidationError(v ?? '', false),
      email: emailError,
    },
  });

  // ── Street autocomplete (debounced, city-scoped) ────────────────────────────
  const handleStreetChange = (val: string) => {
    patientForm.setFieldValue('street', val);
    const city = patientForm.values.city?.trim();
    window.clearTimeout(streetTimer.current);
    if (!city || val.trim().length < 1) { setStreetOptions([]); return; }
    streetTimer.current = window.setTimeout(async () => {
      try { setStreetOptions(await streetsApi.search(city, val.trim())); }
      catch { /* offline / empty catalog → stay free-text */ }
    }, 250);
  };

  // ── Enter-to-advance (Tab-like) ─────────────────────────────────────────────
  const handleStep0KeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    const el = e.target as HTMLElement;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    if (el.getAttribute('aria-expanded') === 'true') return; // open combobox → let it select
    e.preventDefault();
    const container = step0Ref.current;
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>('input:not([type=hidden]), select, textarea, button'),
    ).filter((n) => !(n as HTMLButtonElement).disabled && n.tabIndex !== -1 && n.offsetParent !== null);
    const idx = focusables.indexOf(el);
    if (idx >= 0 && idx < focusables.length - 1) focusables[idx + 1].focus();
  };

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

  // ── Phone field binding (formatted display "XXX-XXXXXXX") ───────────────────
  const phoneProps = (field: 'phoneMobile' | 'phoneHome' | 'digitalContactPhone') => ({
    value: formatPhone(patientForm.values[field] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      patientForm.setFieldValue(field, formatPhone(e.currentTarget.value)),
    error: patientForm.errors[field],
    inputMode: 'tel' as const,
  });

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
    <Stack gap="md">
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
                onChange={handleIdTypeChange}
                allowDeselect={false}
                w={200}
              />
              <TextInput
                label="מספר תעודה"
                placeholder={idType === 'זמני' ? 'מוקצה אוטומטית' : 'הזן מספר ולחץ Enter'}
                value={idNumber}
                readOnly={idType === 'זמני'}
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
              לאחר אישור הזיהוי, טופס הפרטים האישיים יהיה זמין למילוי.
              אם המטופל קיים במערכת — פרטיו ימולאו אוטומטית. "זמני" מקצה מספר מערכת ייחודי.
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
            <Tooltip label="שנה זיהוי / התחל מחדש">
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
          <div ref={step0Ref} onKeyDown={handleStep0KeyDown}>
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
                    <TextInput label="שם האב" withAsterisk {...patientForm.getInputProps('fatherName')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <Select label="מין" data={GENDERS} clearable {...patientForm.getInputProps('gender')} />
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <BirthDateField
                      label="תאריך לידה"
                      value={patientForm.values.birthDate}
                      onChange={(iso) => patientForm.setFieldValue('birthDate', iso)}
                    />
                  </Grid.Col>
                </Grid>
              </Card>

              <Card withBorder p="md">
                <Text fw={600} mb="sm">כתובת</Text>
                <Grid>
                  <Grid.Col span={4}>
                    <Autocomplete
                      label="עיר"
                      data={ISRAELI_CITIES as unknown as string[]}
                      limit={20}
                      {...patientForm.getInputProps('city')}
                      onChange={(v) => { patientForm.setFieldValue('city', v); setStreetOptions([]); }}
                    />
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Autocomplete
                      label="רחוב"
                      data={streetOptions}
                      limit={20}
                      value={patientForm.values.street}
                      onChange={handleStreetChange}
                      error={patientForm.errors.street}
                    />
                  </Grid.Col>
                  <Grid.Col span={2}>
                    <TextInput label="מספר בית" {...patientForm.getInputProps('houseNumber')} />
                  </Grid.Col>
                </Grid>
              </Card>

              <Card withBorder p="md">
                <Text fw={600} mb="sm">טלפונים ותקשורת</Text>
                <Grid>
                  <Grid.Col span={3}>
                    <TextInput label="טלפון 1" withAsterisk placeholder="050-1234567" {...phoneProps('phoneMobile')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <TextInput label="טלפון 2" withAsterisk placeholder="02-1234567" {...phoneProps('phoneHome')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <TextInput label='דוא"ל' {...patientForm.getInputProps('email')} />
                  </Grid.Col>
                  <Grid.Col span={3} />
                  <Grid.Col span={3}>
                    <TextInput label="איש קשר למידע" {...patientForm.getInputProps('digitalContactPerson')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <TextInput label="קרבה לאיש הקשר" placeholder="בן/בת זוג, הורה…" {...patientForm.getInputProps('digitalContactRelation')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <TextInput label="נייד איש הקשר" placeholder="050-1234567" {...phoneProps('digitalContactPhone')} />
                  </Grid.Col>
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
                  <Text fw={600}>קופ"ח ודגלים</Text>
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
                  <Grid.Col span={9}>
                    <Checkbox
                      mt={28}
                      label="חסוי"
                      {...patientForm.getInputProps('isConfidential', { type: 'checkbox' })}
                    />
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <Textarea label="הערות" rows={3} {...patientForm.getInputProps('notes')} />
                  </Grid.Col>
                </Grid>
              </Card>

              <Group justify="flex-end">
                <Button variant="subtle" tabIndex={-1} onClick={() => navigate('/queue')}>ביטול</Button>
                <Button onClick={handleContinue} disabled={!idConfirmed}>
                  המשך לפרטי קבלה ←
                </Button>
              </Group>
            </Stack>
          </div>
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
                    inputWrapperOrder={['label', 'input', 'description', 'error']}
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
    city: p.city ?? DEFAULT_CITY,
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
    digitalContactRelation: p.digitalContactRelation ?? '',
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
