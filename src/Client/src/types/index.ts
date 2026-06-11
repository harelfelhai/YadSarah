export type IdentityType =
  | 'תעודת זהות'
  | 'דרכון'
  | 'זמני'
  | 'ת"ז פלסטינית'
  | 'יילוד'
  | 'לא ידוע';

export type VisitStatus = 'Waiting' | 'Called' | 'InTreatment' | 'Discharged';

export type UserRole = 'Reception' | 'Nurse' | 'Doctor' | 'Admin';

export type StationType =
  | 'טריאז׳'
  | 'טריאז׳ ילדים'
  | 'רופא ר.דחופה'
  | 'רופא ילדים'
  | 'רופאת הריון'
  | 'רופא טראומה'
  | 'אחות'
  | 'אחות ילדים'
  | 'אחות טיפולים'
  | 'מעבדה'
  | 'א.ק.ג'
  | 'רנטגן'
  | 'US'
  | 'מוקד 119';

export type FormType = 'מיון' | 'טופס אחות' | 'מרשם' | 'סיכום ביקור';

// ─── Patient ───────────────────────────────────────────────────────────────

export interface Patient {
  id: string;
  identityType: IdentityType;
  identityNumber?: string;
  firstName: string;
  lastName: string;
  firstNameLatin?: string;
  lastNameLatin?: string;
  fatherName?: string;
  birthDate?: string;
  birthCountry?: string;
  maritalStatus?: string;
  numberOfChildren?: number;
  city?: string;
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  poBox?: string;
  phoneMobile?: string;
  phoneHome?: string;
  phoneWork?: string;
  phoneExtra1?: string;
  phoneExtra2?: string;
  email?: string;
  fax?: string;
  digitalContactPerson?: string;
  digitalContactPhone?: string;
  acceptsDigitalInfo: boolean;
  healthFund?: string;
  healthFundBranch?: string;
  familyDoctorName?: string;
  clinicPhone?: string;
  clinicFax?: string;
  clinicEmail?: string;
  notes?: string;
  isConfidential: boolean;
  isBlocked: boolean;
  isHonorBlocked: boolean;
  accountingCard: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PatientCreate = Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>;

// ─── Visit ─────────────────────────────────────────────────────────────────

export interface Visit {
  id: string;
  patientId: string;
  patient?: Pick<Patient, 'id' | 'firstName' | 'lastName' | 'identityNumber' | 'identityType' | 'birthDate'>;
  queueNumber: number;
  status: VisitStatus;
  receptionDepartment?: string;
  admissionDate: string;
  admissionTime: string;
  admissionMethod?: string;
  admissionReason?: string;
  admissionReasonFree?: string;
  arrivalMethod?: string;
  ambulanceCompany?: string;
  referringSource?: string;
  referringDoctor?: string;
  incidentNumber?: string;
  visitNumberAtStation?: string;
  commitmentNumber?: string;
  commitmentExpiryDate?: string;
  receptionActivity?: string;
  totalToCollect?: number;
  exemptionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type VisitCreate = Omit<Visit, 'id' | 'queueNumber' | 'patient' | 'createdAt' | 'updatedAt'>;

// ─── Medical Form sub-types ────────────────────────────────────────────────

export interface Allergy {
  id: string;
  drugName: string;
  type?: string;
  effect?: string;
  determinationDate?: string;
}

export interface VitalSign {
  id: string;
  date: string;
  time: string;
  bp?: string;
  pulse?: number;
  respiration?: number;
  o2Sat?: number;
  temperature?: number;
  glucose?: number;
  weight?: number;
  notes?: string;
}

export interface Treatment {
  id: string;
  drugName: string;
  dosage?: string;
  startDate?: string;
  duration?: string;
  notes?: string;
}

export interface AdminOrder {
  id: string;
  drugName: string;
  dosage?: string;
  startDate?: string;
  duration?: string;
  notes?: string;
}

export interface Diagnosis {
  id: string;
  diagnosis: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  isPrimary: boolean;
  location?: string;
  severity?: string;
  notes?: string;
}

export interface DischargeMedication {
  id: string;
  drugName: string;
  dosage?: string;
  notes?: string;
}

export interface Routing {
  id: string;
  station: StationType;
  status?: string;
  arrivalDate?: string;
}

// ─── Medical Form ──────────────────────────────────────────────────────────

export interface MedicalForm {
  id: string;
  visitId: string;
  stationType: StationType;
  formType: FormType;
  version: number;
  chiefComplaint?: string;
  presentIllness?: string;
  pastMedicalHistory?: string;
  allergies: Allergy[];
  vitalSigns: VitalSign[];
  triage?: string;
  treatments: Treatment[];
  physicalExam?: string;
  administrationOrders: AdminOrder[];
  diagnoses: Diagnosis[];
  discussionAndPlan?: string;
  dischargeRecommendations?: string;
  dischargeMedications: DischargeMedication[];
  orderedUnits?: string;
  routing: Routing[];
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

// ─── User / Auth ───────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

export interface AuthToken {
  token: string;
  user: User;
  expiresAt: string;
}

// ─── Real-time (SignalR) ───────────────────────────────────────────────────

export interface QueueUpdate {
  visitId: string;
  status: VisitStatus;
  queueNumber: number;
}

export interface FormLockInfo {
  formId: string;
  sectionName: string;
  lockedByUserId: string;
  lockedByName: string;
  expiresAt: string;
}

export interface PresenceUpdate {
  formId: string;
  presentUsers: Array<{ userId: string; fullName: string; role: UserRole }>;
}
