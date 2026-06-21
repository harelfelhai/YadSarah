export type IdentityType =
  | 'תעודת זהות'
  | 'דרכון'
  | 'מספר ביטוח רפואי'
  | 'זמני'
  | 'ללא'
  | 'ת"ז פלסטינית'
  | 'יילוד'
  | 'לא ידוע';

export type VisitStatus = 'Waiting' | 'Called' | 'InTreatment' | 'FinishedTreatment' | 'Discharged';

export type UserRole =
  | 'Reception' | 'Nurse' | 'Doctor' | 'Admin' | 'ShiftManager'
  | 'MedStudent' | 'NursingStudent' | 'LabStaff';

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
  gender?: string;
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
  digitalContactRelation?: string;
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
  admissionDate: string;
  admissionTime: string;
  // Event screen (reworked 2026-06-19)
  admissionReason?: string;
  receptionDepartment?: string;
  departmentAssignedByAi?: boolean;
  departmentConfidence?: number;
  departmentCandidatesJson?: string;
  notes?: string;
  totalToCollect?: number;        // server-derived (read-only)
  exemptionReason?: string;
  // Discount/exemption — manager-gated
  discountReason?: string;
  discountApprovedByName?: string;
  // Treating staff (single owner) — stamped when the visit moves to InTreatment.
  treatingUserId?: string;
  treatingUserName?: string;
  treatingUserRole?: UserRole;
  treatmentStartedAt?: string;
  treatmentRoom?: string;
  createdAt: string;
  updatedAt: string;
}

export type VisitCreate = Omit<
  Visit,
  | 'id' | 'queueNumber' | 'patient' | 'createdAt' | 'updatedAt'
  | 'treatingUserId' | 'treatingUserName' | 'treatingUserRole' | 'treatmentStartedAt' | 'treatmentRoom'
  // server-derived / server-stamped — never sent by the client
  | 'totalToCollect' | 'discountApprovedByName'
> & {
  // Manager step-up credentials — required only when discountReason is set; verified server-side.
  discountApprovalUsername?: string;
  discountApprovalPassword?: string;
};

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

export interface FieldEdit {
  userId: string;
  userName: string;
  at: string;
}

export interface Addendum {
  id: string;
  text: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  isSigned: boolean;
  signedByUserId?: string;
  signedByName?: string;
  signedAt?: string;
}

export interface MedicalForm {
  id: string;
  visitId: string;
  stationType: StationType;
  formType: FormType;
  version: number;
  isSigned: boolean;
  signedByUserId?: string;
  signedByName?: string;
  signedByLicense?: string;
  signedBySpecialistLicense?: string;
  signedAt?: string;
  postSignEditWindowMinutes: number;
  fieldEdits: Record<string, FieldEdit>;
  addenda: Addendum[];
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
  firstName: string;
  lastName: string;
  fullName: string;
  displayName?: string;
  // Professional classification(s) = permission role(s); a user may hold several.
  roles: UserRole[];
  isActive: boolean;
  identityNumber?: string;
  gender?: string;
  title?: string;                    // ד"ר / פרופ' / מר / גב'
  licenseNumber?: string;
  specialistLicenseNumber?: string;  // מספר רישיון מומחה (מרמ)
  employeeNumber?: string;
  mobile?: string;
  email?: string;
  department?: string;
  lastLoginAt?: string;
  loginFailureCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthToken {
  token: string;
  user: User;
  expiresAt: string;
  // The room this computer is mapped to; null when the device is new (prompt to set it).
  workstationRoom: string | null;
}

// ─── Workstation / Shift status ──────────────────────────────────────────────

export interface Workstation {
  id: string;
  deviceId: string;
  roomName: string;
  currentUserId?: string;
  currentUserName?: string;
  currentUserRole?: UserRole;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomStatus {
  workstationId: string;
  room: string;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  occupied: boolean;
  busy: boolean;
  patientQueueNumber?: number | null;
  patientName?: string | null;
}

export interface ShiftWorker {
  userId: string;
  userName: string;
  role?: string | null;
  busy: boolean;
  busyCount: number;
  room?: string | null;
}

export interface ShiftStatusResult {
  shiftStartUtc: string;
  rooms: RoomStatus[];
  onShift: ShiftWorker[];
}

// ─── Real-time (SignalR) ───────────────────────────────────────────────────

export interface QueueUpdate {
  visitId: string;
  status: VisitStatus;
  queueNumber: number;
  treatingUserName?: string | null;
  room?: string | null;
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
