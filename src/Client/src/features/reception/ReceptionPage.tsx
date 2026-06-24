import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Grid, Group, Input, Select, Stack, Stepper, Text,
  TextInput, Checkbox, Textarea, NumberInput, Badge,
  Alert, ActionIcon, Tooltip, Autocomplete,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconX, IconAlertCircle, IconLock } from '@tabler/icons-react';
import { DEFAULT_CITY, orderCitiesByFrequency } from '../../constants/israeliCities';
import { apiErrorMessage } from '../../constants/formPolicy';
import { patientsApi } from '../../api/patients';
import { visitsApi } from '../../api/visits';
import { streetsApi } from '../../api/streets';
import { receptionApi } from '../../api/reception';
import { referenceApi } from '../../api/reference';
import { intakeApi, type IntakeSubmission } from '../../api/intake';
import { formatPhone, phoneValidationError, digitsOnly } from '../../utils/phone';
import { validateIsraeliId } from '../../utils/israeliId';
import { EXEMPTION_REASONS } from '../../constants/exemptionReasons';
import { computeCharge } from '../../constants/pricing';
import type { IdentityType, Patient, Visit } from '../../types';
import StickerPrint from './StickerPrint';
import ReauthModal from '../../components/ReauthModal';
import BirthDateField from '../../components/BirthDateField';

// ─── Constants ───────────────────────────────────────────────────────────────

const IDENTITY_TYPES: { value: IdentityType; label: string }[] = [
  { value: 'תעודת זהות', label: 'ת"ז' },
  { value: 'דרכון', label: 'דרכון' },
  { value: 'מספר ביטוח רפואי', label: 'מספר ביטוח רפואי' },
  { value: 'זמני', label: 'זמני (אוטומטי)' },
];
const HEALTH_FUNDS = ['מכבי', 'מאוחדת', 'כללית', 'לאומית', 'הראל', 'AIM', 'ללא'];
const GENDERS = [
  { value: 'ז', label: 'זכר' },
  { value: 'נ', label: 'נקבה' },
];

// ─── Optional-field format checks (mirror the server validation) ──────────────
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailError = (v: string) => (v && !EMAIL_RX.test(v.trim()) ? 'כתובת דוא"ל אינה תקינה' : null);

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReceptionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // When reception opens a patient-submitted intake form ("פתח בקבלה"), the submission id is held
  // so the staging row can be marked Imported once the visit is created.
  const intakeSubmissionId = useRef<string | null>(null);

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

  // City picker ordered by registration frequency (most-used first), full catalog as the tail.
  const { data: frequentCities = [] } = useQuery({
    queryKey: ['frequent-cities'],
    queryFn: referenceApi.frequentCities,
    staleTime: 300_000,
  });
  const cityData = orderCitiesByFrequency(frequentCities);

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
    setDiscountUnlocked(false);
    setDiscountApprovedBy('');
    managerCreds.current = null;
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
      // Need 2 numbers total: טלפון 1 is always required; the second may be either
      // טלפון 2 OR the digital-contact's mobile. Any number entered must be well-formed.
      phoneMobile: (v) => phoneValidationError(v ?? '', true),
      phoneHome: (v, vals) => {
        const err = phoneValidationError(v ?? '', false);
        if (err) return err;
        const hasSecond =
          digitsOnly(v ?? '').length >= 9 || digitsOnly(vals.digitalContactPhone ?? '').length >= 9;
        return hasSecond ? null : 'נדרש מספר שני: טלפון 2 או נייד איש קשר';
      },
      digitalContactPhone: (v) => phoneValidationError(v ?? '', false),
      email: emailError,
      city: (v) => (!v.trim() ? 'יש לבחור עיר' : null),
      street: (v) => (!v.trim() ? 'יש להזין רחוב' : null),
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

  // ── Visit / event form (slim screen 2026-06-19) ─────────────────────────────
  const visitForm = useForm({
    initialValues: {
      admissionReason: '',
      receptionDepartment: '',
      departmentAssignedByAi: false,
      departmentConfidence: 0,
      departmentCandidatesJson: '',
      notes: '',
      exemptionReason: '',
      discountReason: '',
    },
    validate: {
      admissionReason: (v) => (!v.trim() ? 'יש לבחור סיבת קבלה' : null),
      receptionDepartment: (v) => (!v.trim() ? 'יש לקבוע / לבחור מחלקה' : null),
    },
  });

  // ── Prefill from a patient self-service submission ("פתח בקבלה") ─────────────
  // Reception still drives the normal flow (verify, route department, create visit); this only
  // seeds the fields from the staging row. ID is treated as confirmed but NOT auto-searched —
  // reception verifies the identity itself.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time seed from navigation state;
     initialValues stay blank so reset()/handleResetId clear the form for the next patient. */
  useEffect(() => {
    const state = location.state as { intakePrefill?: IntakeSubmission; intakeSubmissionId?: string } | null;
    const s = state?.intakePrefill;
    if (!s) return;
    intakeSubmissionId.current = state?.intakeSubmissionId ?? null;
    // "ללא" (the patient had no document) → reception assigns a temporary number now.
    const noDoc = s.identityType === 'ללא';
    const effType: IdentityType = noDoc ? 'זמני' : s.identityType;
    setIdType(effType);
    setIdNumber(s.identityNumber ?? '');
    setFoundPatient(null);
    setIdConfirmed(true);
    patientForm.setValues((prev) => ({
      ...prev,
      identityType: effType,
      identityNumber: s.identityNumber ?? '',
      firstName: s.firstName ?? '',
      lastName: s.lastName ?? '',
      fatherName: s.fatherName ?? '',
      gender: s.gender ?? '',
      birthDate: s.birthDate ?? '',
      city: s.city || DEFAULT_CITY,
      street: s.street ?? '',
      houseNumber: s.houseNumber ?? '',
      phoneMobile: s.phoneMobile ?? '',
      phoneHome: s.phoneHome ?? '',
      email: s.email ?? '',
      digitalContactPerson: s.digitalContactPerson ?? '',
      digitalContactRelation: s.digitalContactRelation ?? '',
      digitalContactPhone: s.digitalContactPhone ?? '',
      acceptsDigitalInfo: s.acceptsDigitalInfo ?? false,
      healthFund: s.healthFund ?? '',
    }));
    visitForm.setFieldValue('admissionReason', s.admissionReason ?? '');
    setStep(0);
    // Drop the nav state so a refresh / "admit another" doesn't re-prefill.
    window.history.replaceState({}, '');
    // For a no-document patient, pull a fresh temporary number from the server.
    if (noDoc) {
      patientsApi.tempId()
        .then((r) => { setIdNumber(r.value); patientForm.setFieldValue('identityNumber', r.value); })
        .catch(() => notifications.show({ message: 'שגיאה בהקצאת מספר זמני', color: 'red' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Department AI routing (decides exactly one department, behind the scenes) ──
  const [routing, setRouting] = useState(false);

  const ageFromBirth = (iso?: string): number | undefined => {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a : undefined;
  };

  const runRouting = async (reason: string) => {
    visitForm.setFieldValue('admissionReason', reason);
    if (!reason.trim()) { return; }
    setRouting(true);
    try {
      const res = await receptionApi.routeDepartment({
        admissionReason: reason,
        age: ageFromBirth(patientForm.values.birthDate),
        gender: patientForm.values.gender || undefined,
      });
      // Routing always commits to exactly ONE department (rule/ai/fallback). Reception never picks
      // (the field is display-only); a clinician finalizes the department during treatment. The
      // rule/AI provenance is still persisted (behind-the-scenes) but NOT surfaced at reception.
      visitForm.setFieldValue('receptionDepartment', res.departments[0] ?? '');
      visitForm.setFieldValue('departmentAssignedByAi', res.source === 'ai');
      visitForm.setFieldValue('departmentConfidence', res.confidence);
      visitForm.setFieldValue('departmentCandidatesJson', '');
    } catch {
      notifications.show({ message: 'קביעת מחלקה נכשלה — בחר ידנית', color: 'orange' });
    } finally {
      setRouting(false);
    }
  };

  // ── Discount / exemption manager gate ───────────────────────────────────────
  const [reauthOpen, setReauthOpen] = useState(false);
  const [discountUnlocked, setDiscountUnlocked] = useState(false);
  const [discountApprovedBy, setDiscountApprovedBy] = useState('');
  // Held transiently to re-send on create (the server re-verifies); cleared on reset.
  const managerCreds = useRef<{ username: string; password: string } | null>(null);

  const handleAuthorizeDiscount = async (username: string, password: string) => {
    const res = await receptionApi.authorizeDiscount(username, password); // throws → modal shows error
    managerCreds.current = { username, password };
    setDiscountApprovedBy(res.approvedByName);
    setDiscountUnlocked(true);
    setReauthOpen(false);
  };

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
      const v = visitForm.values;
      const visit = await visitsApi.create({
        patientId: patient.id,
        status: 'Waiting',
        admissionDate: now.toLocaleDateString('en-CA'),
        admissionTime: now.toTimeString().slice(0, 5),
        admissionReason: v.admissionReason || undefined,
        receptionDepartment: v.receptionDepartment || undefined,
        departmentAssignedByAi: v.departmentAssignedByAi,
        departmentConfidence: v.departmentConfidence || undefined,
        departmentCandidatesJson: v.departmentCandidatesJson || undefined,
        notes: v.notes || undefined,
        exemptionReason: v.exemptionReason || undefined,
        // Manager-gated discount: only sent when a manager authorized it (server re-verifies).
        discountReason: discountUnlocked ? (v.discountReason || undefined) : undefined,
        discountApprovalUsername: discountUnlocked ? managerCreds.current?.username : undefined,
        discountApprovalPassword: discountUnlocked ? managerCreds.current?.password : undefined,
      });

      setSavedPatient({ ...patient, healthFund: patientForm.values.healthFund });
      setCreatedVisit(visit);

      // If this admission came from a patient self-service form, retire the staging row.
      if (intakeSubmissionId.current) {
        try { await intakeApi.markImported(intakeSubmissionId.current); } catch { /* non-fatal */ }
        intakeSubmissionId.current = null;
      }
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
                      withAsterisk
                      data={cityData}
                      limit={20}
                      {...patientForm.getInputProps('city')}
                      onChange={(v) => { patientForm.setFieldValue('city', v); setStreetOptions([]); }}
                    />
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <Autocomplete
                      label="רחוב"
                      withAsterisk
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
                <Alert icon={<IconAlertCircle size={14} />} color="blue" variant="light" p="xs" radius="sm" mb="sm">
                  חובה להזין <b>2 מספרי טלפון</b>: <b>טלפון 1</b> + <b>טלפון 2</b> או <b>נייד איש הקשר</b>.
                </Alert>
                <Grid>
                  <Grid.Col span={3}>
                    <TextInput label="טלפון 1" withAsterisk placeholder="050-1234567" {...phoneProps('phoneMobile')} />
                  </Grid.Col>
                  <Grid.Col span={3}>
                    <TextInput
                      label="טלפון 2"
                      placeholder="02-1234567"
                      description="חובה — אלא אם הוזן נייד איש הקשר"
                      inputWrapperOrder={['label', 'input', 'description', 'error']}
                      {...phoneProps('phoneHome')}
                    />
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
                    <TextInput
                      label="נייד איש הקשר"
                      placeholder="050-1234567"
                      description="נחשב כמספר השני (חלופה לטלפון 2)"
                      inputWrapperOrder={['label', 'input', 'description', 'error']}
                      {...phoneProps('digitalContactPhone')}
                    />
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

        {/* ── Step 1: Event details (slim screen, AI-routed department) ── */}
        {step === 1 && (
          <Stack gap="md" mt="md">
            <Card withBorder p="md">
              <Grid>
                {/* סיבת קבלה — free text (entered first; drives the AI department routing on blur) */}
                <Grid.Col span={6}>
                  <TextInput
                    label="סיבת קבלה"
                    withAsterisk
                    value={visitForm.values.admissionReason}
                    onChange={(e) => visitForm.setFieldValue('admissionReason', e.currentTarget.value)}
                    onBlur={() => runRouting(visitForm.values.admissionReason)}
                    error={visitForm.errors.admissionReason}
                  />
                </Grid.Col>

                {/* מחלקה — נקבעת אוטומטית מאחורי-הקלעים (כלל/AI/ברירת-מחדל) לפי סיבת הקבלה. תצוגה בלבד,
                    לא שדה-קלט, ובלי חשיפת אופן-הקביעה; שינוי ע"י צוות קליני בשלב הטיפול */}
                <Grid.Col span={6}>
                  <Input.Wrapper label="מחלקה" withAsterisk error={visitForm.errors.receptionDepartment}>
                    <Box style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}>
                      {routing ? (
                        <Text size="sm" c="dimmed">קובע מחלקה…</Text>
                      ) : visitForm.values.receptionDepartment ? (
                        <Badge size="lg" variant="light" radius="sm">{visitForm.values.receptionDepartment}</Badge>
                      ) : (
                        <Text size="sm" c="dimmed">תיקבע אוטומטית לפי סיבת הקבלה</Text>
                      )}
                    </Box>
                  </Input.Wrapper>
                </Grid.Col>

                <Grid.Col span={12}>
                  <Textarea label="הערות" rows={3} {...visitForm.getInputProps('notes')} />
                </Grid.Col>

                {/* סה"כ לגבייה — live display (client mirror); the SERVER value on create is authoritative */}
                <Grid.Col span={4}>
                  <NumberInput
                    label="סה״כ לגבייה מהמטופל (₪)"
                    value={computeCharge(patientForm.values.healthFund, visitForm.values.exemptionReason, discountUnlocked)}
                    readOnly
                    styles={{ input: { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } }}
                    description="מחושב לפי קופ״ח, אופן-הגעה וסיבת פטור"
                    inputWrapperOrder={['label', 'input', 'description', 'error']}
                  />
                </Grid.Col>

                {/* סיבת פטור — closed list */}
                <Grid.Col span={4}>
                  <Select
                    label="סיבת פטור"
                    data={EXEMPTION_REASONS}
                    clearable
                    searchable
                    {...visitForm.getInputProps('exemptionReason')}
                  />
                </Grid.Col>

                {/* הנחה / פטור — manager-gated (step-up re-auth) */}
                <Grid.Col span={4}>
                  {discountUnlocked ? (
                    <TextInput
                      label="הנחה / פטור"
                      description={`אושר ע"י ${discountApprovedBy}`}
                      inputWrapperOrder={['label', 'input', 'description', 'error']}
                      {...visitForm.getInputProps('discountReason')}
                    />
                  ) : (
                    <Button
                      variant="light"
                      color="orange"
                      mt={24}
                      fullWidth
                      leftSection={<IconLock size={16} />}
                      onClick={() => setReauthOpen(true)}
                    >
                      הנחה / פטור (אישור מנהל)
                    </Button>
                  )}
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

            <ReauthModal
              opened={reauthOpen}
              onClose={() => setReauthOpen(false)}
              onConfirm={handleAuthorizeDiscount}
              title="אישור הנחה / פטור — מנהל משמרת"
              description="להחלת הנחה או פטור נדרש מנהל משמרת להזין שם משתמש וסיסמה."
              confirmLabel="אשר"
              confirmColor="orange"
            />
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
