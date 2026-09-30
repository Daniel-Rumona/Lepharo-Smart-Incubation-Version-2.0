import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/firebase";

export type TrainingCenter = { id: string; name: string };

export type TrainingCapability = "repository" | "progress";

export type TrainingAccessGrant = { department: string; capabilities: TrainingCapability[] };

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
  owner: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingDocument = { url: string; name: string };

export type EnrollmentStatus = "unassigned" | "enrolled" | "discontinued";

export type TrainingEnrollment = {
  id: string;
  trainingId: string;
  name: string;
  companyName: string;
  idDocument: TrainingDocument | null;
  qualificationDocument: TrainingDocument | null;
  cvDocument: TrainingDocument | null;
  registrationFormDocument: TrainingDocument | null;
  categories: string[];
  status: EnrollmentStatus;
  enrolledAt?: string;
  discontinuedReason?: string;
  discontinuedAt?: string;
  owner: string;
  createdAt: string;
};

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

export async function deleteEnrollment(id: string): Promise<void> {
  await deleteDoc(doc(db, "trainingEnrollments", id));
}

export type TrainingFileKind = "id" | "qualification" | "cv" | "registrationForm";

export async function uploadTrainingFile(trainingId: string, kind: TrainingFileKind, file: File): Promise<TrainingDocument> {
  const fileName = `${kind}_${Date.now()}_${file.name}`;
  const fileRef = ref(storage, `training_enrollments/${trainingId}/${fileName}`);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, name: file.name };
}

export async function createEnrollment(input: {
  trainingId: string;
  name: string;
  companyName: string;
  categories: string[];
  idFile: File;
  qualificationFile: File;
  cvFile: File;
  registrationFormFile: File;
  owner: string;
}): Promise<string> {
  const folder = input.trainingId || "unassigned";
  const [idDocument, qualificationDocument, cvDocument, registrationFormDocument] = await Promise.all([
    uploadTrainingFile(folder, "id", input.idFile),
    uploadTrainingFile(folder, "qualification", input.qualificationFile),
    uploadTrainingFile(folder, "cv", input.cvFile),
    uploadTrainingFile(folder, "registrationForm", input.registrationFormFile),
  ]);
  const now = new Date().toISOString();
  const status: EnrollmentStatus = input.trainingId ? "enrolled" : "unassigned";
  const created = await addDoc(enrollmentsRef, {
    trainingId: input.trainingId,
    name: input.name,
    companyName: input.companyName,
    idDocument,
    qualificationDocument,
    cvDocument,
    registrationFormDocument,
    categories: input.categories,
    status,
    owner: input.owner,
    createdAt: now,
    ...(status === "enrolled" ? { enrolledAt: now } : {}),
  });
  return created.id;
}

export async function assignTraining(id: string, trainingId: string, categories: string[]): Promise<void> {
  await updateDoc(doc(db, "trainingEnrollments", id), {
    trainingId,
    categories,
    status: "enrolled",
    enrolledAt: new Date().toISOString(),
  });
}

export async function discontinueEnrollment(id: string, reason: string): Promise<void> {
  await updateDoc(doc(db, "trainingEnrollments", id), {
    status: "discontinued",
    discontinuedReason: reason,
    discontinuedAt: new Date().toISOString(),
  });
}
