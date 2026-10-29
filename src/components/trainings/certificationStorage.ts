import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase";
import {
  CERTIFICATION_SETTINGS_DOC,
  type CertificationSettings,
  type EligibilityOverride,
  type TrainingCertificationOverride,
  type TrainingCompanyProgress,
} from "./certification";

/*
 * Certification settings and staff decisions. The progress Cloud Function
 * reacts to every write here (trainingProgress.ts), so eligibility updates
 * on its own; recomputeTrainingProgress is for after a migration.
 */

const settingsRef = doc(db, CERTIFICATION_SETTINGS_DOC.collection, CERTIFICATION_SETTINGS_DOC.id);

/** The global defaults as saved, or null when they never were (DEFAULT_CERTIFICATION applies). */
export async function loadCertificationDefaults(): Promise<Partial<CertificationSettings> | null> {
  const snap = await getDoc(settingsRef);
  return snap.exists() ? (snap.data() as Partial<CertificationSettings>) : null;
}

export async function saveCertificationDefaults(settings: CertificationSettings): Promise<void> {
  await setDoc(settingsRef, JSON.parse(JSON.stringify(settings)));
}

/** A training's own settings; null goes back to the global defaults. */
export async function saveTrainingCertification(trainingId: string, override: TrainingCertificationOverride | null): Promise<void> {
  await updateDoc(doc(db, "trainings", trainingId), {
    certification: override ? JSON.parse(JSON.stringify(override)) : deleteField(),
    updatedAt: new Date().toISOString(),
  });
}

/** Staff: mark one person eligible whatever the rules say (a reason is required), or clear it. */
export async function setAttendeeOverride(attendeeId: string, override: EligibilityOverride | null): Promise<void> {
  await updateDoc(doc(db, "trainingAttendees", attendeeId), { eligibilityOverride: override, updatedAt: new Date().toISOString() });
}

/** Staff, company mode: mark the SME eligible whatever the rules say, or clear it. */
export async function setCompanyOverride(enrollmentId: string, override: EligibilityOverride | null): Promise<void> {
  await updateDoc(doc(db, "trainingEnrollments", enrollmentId), { certificationOverride: override });
}

/** Every SME's totals (staff), keyed by enrollment id. */
export async function listCompanyProgress(): Promise<Record<string, TrainingCompanyProgress>> {
  const snap = await getDocs(collection(db, "trainingCompanyProgress"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as TrainingCompanyProgress]));
}

/** One company's totals, for its own people in the portal (null until first computed). */
export async function loadCompanyProgress(enrollmentId: string): Promise<TrainingCompanyProgress | null> {
  const snap = await getDoc(doc(db, "trainingCompanyProgress", enrollmentId));
  return snap.exists() ? (snap.data() as TrainingCompanyProgress) : null;
}

export async function recomputeProgress(scope: { trainingId?: string; enrollmentId?: string } = {}): Promise<number> {
  const result = await httpsCallable(functions, "recomputeTrainingProgress")(scope);
  return (result.data as { recomputed: number }).recomputed;
}
