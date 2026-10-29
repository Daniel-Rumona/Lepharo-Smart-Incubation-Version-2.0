import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "@/firebase";
import { functionsBaseUrl } from "@/firebaseConfig";
import type { AttendeeProgress, EligibilityOverride, TrainingCertificationOverride } from "./certification";

const CREATE_USER_URL = `${functionsBaseUrl}/createPlatformUser`;

export type TrainingCenter = { id: string; name: string };

export type TrainingCapability = "repository" | "progress";

export type TrainingAccessGrant = { departmentId: string; capabilities: TrainingCapability[] };

export type Training = {
  id: string;
  name: string;
  durationStart: string;
  durationEnd: string;
  centers: TrainingCenter[];
  categories: string[];
  access: TrainingAccessGrant[];
  /** Center Coordinators (role "projectadmin") assigned to one of this training's centers get Repository + Progress access. */
  centerCoordinatorAccess: boolean;
  requiredDocuments: string[];
  requiredDetails: string[];
  /** Published Academy courses (academyCatalog ids) this training's SMEs take. */
  courseIds?: string[];
  /** What the training covers and who delivers each part; departments book sessions against it from Appointments. */
  deliveryPlan?: TrainingDeliveryPlan;
  /** Sessions booked as group appointments (from Appointments, or the older plan drawer), in booking order. */
  plan?: TrainingPlanSession[];
  /** Certificate rules for this training; unset fields fall back to the global defaults (see certification.ts). */
  certification?: TrainingCertificationOverride;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingDeliveryMethod = "in_person" | "virtual" | "telephonically";

/** A Training Academy HOD or coordinator picked from the system, or a name typed in (e.g. an external provider). */
export type PlanDeliverer =
  | { kind: "staff"; userId: string; name: string; email: string | null }
  | { kind: "external"; name: string };

export type TrainingPlanItem = {
  id: string;
  /** What will be covered. */
  topic: string;
  deliverer: PlanDeliverer | null;
};

/**
 * The plan is either a typed list of items or an uploaded document (e.g. a
 * PDF saying who does what). Both are kept so switching back loses nothing;
 * mode says which one is in force.
 */
export type TrainingDeliveryPlan = {
  mode: "items" | "document";
  items: TrainingPlanItem[];
  document: (TrainingDocument & { uploadedAt: string }) | null;
  updatedAt: string;
  updatedBy: string;
};

/**
 * One session of a training's plan. Scheduling it creates a group
 * appointmentSessions doc (groupKey trainingSessionGroupKey) plus one
 * appointments invitation per enrolled SME, so attendance, coverage and
 * emails reuse the appointment pipeline. appointmentSessionId is set then.
 */
export type TrainingPlanSession = {
  id: string;
  title: string;
  /** What the session covers. */
  description: string;
  topics: string[];
  /** One of Training.categories: only attendees in that category are invited. Unset or null means everyone. */
  category?: string | null;
  /** Courses (subset of Training.courseIds) SMEs work through for this session. */
  courseIds: string[];
  startAt: string | null;
  endAt: string | null;
  deliveryMethod: TrainingDeliveryMethod;
  location: string;
  meetingLink: string;
  facilitatorId: string;
  facilitatorName: string;
  facilitatorEmail: string | null;
  appointmentSessionId?: string;
  /** The deliveryPlan item this session delivers; unset for sessions booked from the uploaded plan document or the older drawer. */
  planItemId?: string | null;
  /** Who delivers it when that's not the facilitator (assignee) on record, e.g. an external provider. */
  deliveredBy?: string | null;
  /** Set on each occurrence of a repeating session (e.g. daily 10:00–14:00); each is booked on its own. */
  series?: { id: string; index: number; count: number; frequency: RepeatFrequency };
};

export type RepeatFrequency = "daily" | "weekdays" | "weekly";

export type TrainingDocument = { url: string; name: string };

export type LabelledDocument = TrainingDocument & { label: string };

/** Asked for when a training sets no required documents of its own (and for SMEs not yet in a training). */
export const DEFAULT_REQUIRED_DOCUMENTS = ["ID Copy", "Report / Qualification", "CV", "Registration Form"];

export const requiredDocumentsFor = (training?: Training | null): string[] =>
  training?.requiredDocuments?.length ? training.requiredDocuments : DEFAULT_REQUIRED_DOCUMENTS;

/** Profile details a training can ask for (Training.requiredDetails holds the keys). */
export const TRAINING_DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "gender", label: "Gender" },
  { key: "email", label: "Email Address" },
  { key: "phone", label: "Phone Number" },
  { key: "idNumber", label: "ID Number" },
  { key: "registrationNumber", label: "Registration Number" },
  { key: "sector", label: "Sector" },
  { key: "beeLevel", label: "B-BBEE Level" },
  { key: "province", label: "Province" },
  { key: "town", label: "Town / City" },
  { key: "location", label: "Location" },
  { key: "businessAddress", label: "Business Address" },
  { key: "blackOwnedPercent", label: "Black Ownership %" },
  { key: "femaleOwnedPercent", label: "Female Ownership %" },
  { key: "youthOwnedPercent", label: "Youth Ownership %" },
];

const LEGACY_SLOTS: Record<string, "idDocument" | "qualificationDocument" | "cvDocument" | "registrationFormDocument"> = {
  "id copy": "idDocument",
  "report / qualification": "qualificationDocument",
  cv: "cvDocument",
  "registration form": "registrationFormDocument",
};

/** Every document on an enrollment, from the labelled list or (older records) the fixed slots. */
export function enrollmentDocuments(e: TrainingEnrollment): LabelledDocument[] {
  if (e.documents?.length) return e.documents;
  const legacy: [string, TrainingDocument | null][] = [
    ["ID Copy", e.idDocument],
    ["Report / Qualification", e.qualificationDocument],
    ["CV", e.cvDocument],
    ["Registration Form", e.registrationFormDocument],
  ];
  return legacy.filter((entry): entry is [string, TrainingDocument] => !!entry[1]).map(([label, d]) => ({ ...d, label }));
}

/** Required documents for the SME's training that are not on file yet. */
export const missingDocuments = (e: TrainingEnrollment, training?: Training | null): string[] => {
  const have = new Set(enrollmentDocuments(e).map((d) => d.label.toLowerCase()));
  return requiredDocumentsFor(training).filter((label) => !have.has(label.toLowerCase()));
};

const legacySlotsOf = (documents: LabelledDocument[]) => {
  const slots: Record<string, TrainingDocument | null> = {
    idDocument: null,
    qualificationDocument: null,
    cvDocument: null,
    registrationFormDocument: null,
  };
  documents.forEach((d) => {
    const slot = LEGACY_SLOTS[d.label.toLowerCase()];
    if (slot) slots[slot] = { url: d.url, name: d.name };
  });
  return slots;
};

export type EnrollmentStatus = "unassigned" | "enrolled" | "discontinued";

export type TrainingEnrollment = {
  id: string;
  trainingId: string;
  name: string;
  companyName: string;
  email: string;
  /** Auth uid of the portal account created when the SME is enrolled in a training. */
  userId?: string;
  /** Documents collected for the training's requiredDocuments, labelled with the requirement they meet. */
  documents?: LabelledDocument[];
  /** Profile details collected for the training's requiredDetails, keyed by TRAINING_DETAIL_FIELDS key. */
  details?: Record<string, string>;
  /** Legacy fixed document slots, still filled when a label matches so older views keep working. */
  idDocument: TrainingDocument | null;
  qualificationDocument: TrainingDocument | null;
  cvDocument: TrainingDocument | null;
  registrationFormDocument: TrainingDocument | null;
  categories: string[];
  status: EnrollmentStatus;
  enrolledAt?: string;
  discontinuedReason?: string;
  discontinuedAt?: string;
  /** Company-mode certification: staff decision that the SME is eligible whatever the rules say. */
  certificationOverride?: EligibilityOverride | null;
  /** Seeded demo SMEs: nothing about them may reach a real person. */
  dataOrigin?: "synthetic" | "real";
  suppressNotifications?: boolean;
  owner: string;
  createdAt: string;
};

/**
 * One person from an SME (a trainingEnrollments record, which is the company):
 * its director (the enrollment's own person) or an employee the company sends.
 * Each person has their own training_sme login (users.trainingAttendeeId points
 * here, users.trainingRole says director/employee) and their own appointment
 * invitations. Company documents stay on the enrollment; a person only gives
 * their own identity.
 */
export type TrainingAttendeeKind = "director" | "employee";

export type TrainingAttendee = {
  id: string;
  /** The SME (trainingEnrollments id). */
  enrollmentId: string;
  trainingId: string;
  kind: TrainingAttendeeKind;
  /** Whether this person attends sessions. Always true for employees; a director is often only the owner. */
  attends: boolean;
  name: string;
  email: string;
  phone?: string | null;
  idNumber: string | null;
  idDocument: TrainingDocument | null;
  /** Subset of the training's categories this person attends. */
  categories: string[];
  /** Auth uid of their training_sme login, once created. */
  userId?: string;
  status: "active" | "withdrawn";
  withdrawnAt?: string;
  withdrawnBy?: string;
  withdrawnReason?: string;
  addedBy: { uid: string; role: "staff" | "director" | "migration" };
  /** Staff decision that this person is eligible for a certificate whatever the rules say. */
  eligibilityOverride?: EligibilityOverride | null;
  /** Written only by the progress Cloud Function. */
  progress?: AttendeeProgress;
  dataOrigin?: "synthetic" | "real";
  suppressNotifications?: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The director's attendee doc id: deterministic, so the backfill can be re-run safely. */
export const directorAttendeeId = (enrollmentId: string) => `${enrollmentId}_director`;

const trainingsRef = collection(db, "trainings");
const enrollmentsRef = collection(db, "trainingEnrollments");

export async function listTrainings(): Promise<Training[]> {
  const snap = await getDocs(query(trainingsRef, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Training, "id">), id: d.id }));
}

export async function saveTraining(
  input: {
    id?: string;
    name: string;
    durationStart: string;
    durationEnd: string;
    centers: TrainingCenter[];
    categories: string[];
    access: TrainingAccessGrant[];
    centerCoordinatorAccess: boolean;
    requiredDocuments: string[];
    requiredDetails: string[];
    courseIds: string[];
  },
  owner: string
): Promise<string> {
  const now = new Date().toISOString();
  if (input.id) {
    await setDoc(
      doc(db, "trainings", input.id),
      {
        name: input.name,
        durationStart: input.durationStart,
        durationEnd: input.durationEnd,
        centers: input.centers,
        categories: input.categories,
        access: input.access,
        centerCoordinatorAccess: input.centerCoordinatorAccess,
        requiredDocuments: input.requiredDocuments,
        requiredDetails: input.requiredDetails,
        courseIds: input.courseIds,
        updatedAt: now,
      },
      { merge: true }
    );
    return input.id;
  }
  const created = await addDoc(trainingsRef, {
    name: input.name,
    durationStart: input.durationStart,
    durationEnd: input.durationEnd,
    centers: input.centers,
    categories: input.categories,
    access: input.access,
    centerCoordinatorAccess: input.centerCoordinatorAccess,
    requiredDocuments: input.requiredDocuments,
    requiredDetails: input.requiredDetails,
    courseIds: input.courseIds,
    owner,
    createdAt: now,
    updatedAt: now,
  });
  return created.id;
}

export async function deleteTraining(id: string): Promise<void> {
  await deleteDoc(doc(db, "trainings", id));
}

export async function listBranches(): Promise<TrainingCenter[]> {
  const snap = await getDocs(collection(db, "branches"));
  const seen = new Set<string>();
  const list: TrainingCenter[] = [];
  snap.docs.forEach((d) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    const data = d.data() as Record<string, unknown>;
    list.push({ id: d.id, name: String(data.name || data.branchName || d.id) });
  });
  return list;
}

export async function listAllEnrollments(): Promise<TrainingEnrollment[]> {
  const snap = await getDocs(query(enrollmentsRef, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ ...(d.data() as Omit<TrainingEnrollment, "id">), id: d.id }));
}

export async function uploadTrainingFile(trainingId: string, kind: string, file: File): Promise<TrainingDocument> {
  const slug = kind.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";
  const fileName = `${slug}_${Date.now()}_${file.name}`;
  const fileRef = ref(storage, `training_enrollments/${trainingId}/${fileName}`);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, name: file.name };
}

/** Result of an enrol/assign step; accountError is set when the portal login could not be created. */
export type EnrollmentResult = { id: string; accountError?: string };

/** Staff action for an enrolled SME who has no portal login yet (e.g. creation failed at enrolment). */
export async function createPortalLogin(enrollment: TrainingEnrollment, training?: Training): Promise<string | undefined> {
  if (enrollment.userId) return "This SME already has a portal login.";
  if (enrollment.status !== "enrolled" || !enrollment.trainingId) return "Enrol the SME in a training before creating a login.";
  return provisionAccount(
    enrollment.id,
    { name: enrollment.name, email: enrollment.email, companyName: enrollment.companyName },
    { id: enrollment.trainingId, name: training?.name || "" }
  );
}

/**
 * Creates the SME's restricted "training_sme" login (default password + custom
 * welcome email, sent by the createPlatformUser cloud function) and links it
 * back onto the enrollment. Never throws: a failure is returned so the
 * enrollment itself still stands and staff can be told.
 */
async function provisionAccount(
  enrollmentId: string,
  sme: { name: string; email: string; companyName: string },
  training: { id: string; name: string }
): Promise<string | undefined> {
  if (!sme.email) return "No email address on file, so no portal login was created.";
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return "Sign in again to create the SME's portal login.";
    const response = await fetch(CREATE_USER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email: sme.email,
        name: sme.name,
        company: sme.companyName,
        role: "training_sme",
        mustRegister: false,
        sendEmail: true,
        emailTemplate: "training_sme",
        trainingName: training.name,
        extra: {
          participantId: enrollmentId,
          trainingEnrollmentId: enrollmentId,
          trainingId: training.id,
          companyName: sme.companyName,
          firstLoginComplete: true,
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return data.error === "email_already_exists"
        ? "An account with this email already exists, so no new portal login was created."
        : `The portal login could not be created (${data.error || response.status}).`;
    }
    await updateDoc(doc(db, "trainingEnrollments", enrollmentId), { userId: data.uid });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "The portal login could not be created.";
  }
}

export async function createEnrollment(input: {
  trainingId: string;
  name: string;
  companyName: string;
  email: string;
  categories: string[];
  files: { label: string; file: File }[];
  details: Record<string, string>;
  owner: string;
}): Promise<EnrollmentResult> {
  const folder = input.trainingId || "unassigned";
  const documents: LabelledDocument[] = await Promise.all(
    input.files.map(async ({ label, file }) => ({ ...(await uploadTrainingFile(folder, label, file)), label }))
  );
  const now = new Date().toISOString();
  const status: EnrollmentStatus = input.trainingId ? "enrolled" : "unassigned";
  const created = await addDoc(enrollmentsRef, {
    trainingId: input.trainingId,
    name: input.name,
    companyName: input.companyName,
    email: input.email,
    documents,
    details: input.details,
    ...legacySlotsOf(documents),
    categories: input.categories,
    status,
    owner: input.owner,
    createdAt: now,
    ...(status === "enrolled" ? { enrolledAt: now } : {}),
  });
  if (status !== "enrolled") return { id: created.id };
  const trainingSnap = await getDoc(doc(db, "trainings", input.trainingId));
  const trainingName = trainingSnap.exists() ? String(trainingSnap.data().name || "") : "";
  const accountError = await provisionAccount(
    created.id,
    { name: input.name, email: input.email, companyName: input.companyName },
    { id: input.trainingId, name: trainingName }
  );
  return { id: created.id, accountError };
}

/** Corrects an SME's record and adds documents. The email is fixed once a portal login exists (it is the login). */
export async function updateEnrollment(
  enrollment: TrainingEnrollment,
  input: {
    name: string;
    companyName: string;
    email: string;
    categories: string[];
    details: Record<string, string>;
    files: { label: string; file: File }[];
  }
): Promise<void> {
  const folder = enrollment.trainingId || "unassigned";
  const uploaded: LabelledDocument[] = await Promise.all(
    input.files.map(async ({ label, file }) => ({ ...(await uploadTrainingFile(folder, label, file)), label }))
  );
  const replaced = new Set(uploaded.map((d) => d.label.toLowerCase()));
  const documents = [...enrollmentDocuments(enrollment).filter((d) => !replaced.has(d.label.toLowerCase())), ...uploaded];
  await updateDoc(doc(db, "trainingEnrollments", enrollment.id), {
    name: input.name,
    companyName: input.companyName,
    ...(enrollment.userId ? {} : { email: input.email }),
    categories: input.categories,
    details: { ...(enrollment.details || {}), ...input.details },
    documents,
    ...legacySlotsOf(documents),
  });
}

export async function assignTraining(id: string, trainingId: string, categories: string[]): Promise<EnrollmentResult> {
  const ref = doc(db, "trainingEnrollments", id);
  await updateDoc(ref, {
    trainingId,
    categories,
    status: "enrolled",
    enrolledAt: new Date().toISOString(),
  });
  const [enrollmentSnap, trainingSnap] = await Promise.all([getDoc(ref), getDoc(doc(db, "trainings", trainingId))]);
  const enrollment = enrollmentSnap.data() as Partial<TrainingEnrollment> | undefined;
  if (!enrollment || enrollment.userId) return { id };
  const accountError = await provisionAccount(
    id,
    { name: enrollment.name || "", email: enrollment.email || "", companyName: enrollment.companyName || "" },
    { id: trainingId, name: trainingSnap.exists() ? String(trainingSnap.data().name || "") : "" }
  );
  return { id, accountError };
}

export async function discontinueEnrollment(id: string, reason: string): Promise<void> {
  await updateDoc(doc(db, "trainingEnrollments", id), {
    status: "discontinued",
    discontinuedReason: reason,
    discontinuedAt: new Date().toISOString(),
  });
}
