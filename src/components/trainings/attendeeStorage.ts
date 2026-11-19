import { collection, getDocs, query, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { withOwner } from "@/lib/storageOwner";
import { httpsCallable } from "firebase/functions";
import { db, functions, storage } from "@/firebase";
import type { TrainingAttendee, TrainingDocument, TrainingEnrollment } from "./trainingStorage";

/*
 * The people an SME sends to a training (see TrainingAttendee). Reads go to
 * Firestore directly; every change goes through the manageTrainingAttendee
 * callable, which staff and the SME's director share and which also creates
 * each person's login.
 */

const attendeesRef = collection(db, "trainingAttendees");

const toAttendee = (d: { id: string; data: () => unknown }) => ({ ...(d.data() as Omit<TrainingAttendee, "id">), id: d.id });

/** Every person on record (staff only, for the SMEs page). */
export async function listAllAttendees(): Promise<TrainingAttendee[]> {
  return (await getDocs(attendeesRef)).docs.map(toAttendee);
}

export async function listTrainingAttendees(trainingId: string): Promise<TrainingAttendee[]> {
  return (await getDocs(query(attendeesRef, where("trainingId", "==", trainingId)))).docs.map(toAttendee);
}

export async function listCompanyAttendees(enrollmentId: string): Promise<TrainingAttendee[]> {
  return (await getDocs(query(attendeesRef, where("enrollmentId", "==", enrollmentId)))).docs.map(toAttendee);
}

/** A person's ID copy, under their own folder (storage.rules: training_attendees). */
export async function uploadAttendeeIdCopy(enrollmentId: string, attendeeKey: string, file: File): Promise<TrainingDocument> {
  const path = `training_attendees/${enrollmentId}/${attendeeKey}/id-copy_${Date.now()}_${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, withOwner());
  return { url: await getDownloadURL(fileRef), name: file.name };
}

export type AttendeeInput = {
  name: string;
  email: string;
  phone?: string;
  idNumber?: string;
  idDocument?: TrainingDocument | null;
  categories: string[];
};

type CallResult = { attendeeId: string; loginProblem?: string | null; cancelledInvitations?: number };

const call = async (payload: Record<string, unknown>): Promise<CallResult> =>
  (await httpsCallable(functions, "manageTrainingAttendee")(payload)).data as CallResult;

export const ensureDirectorAttendee = (enrollmentId: string) => call({ action: "ensureDirector", enrollmentId });

export const addEmployee = (enrollmentId: string, input: AttendeeInput) => call({ action: "add", enrollmentId, ...input });

export const updateAttendee = (attendeeId: string, input: Partial<AttendeeInput> & { attends?: boolean }) =>
  call({ action: "update", attendeeId, ...input });

export const createAttendeeLogin = (attendeeId: string) => call({ action: "createLogin", attendeeId });

export const withdrawAttendee = (attendeeId: string, reason: string) => call({ action: "withdraw", attendeeId, reason });

export { trainingInvitees, inviteeKey, matchesTrainingCategory, type TrainingInvitee } from './trainingInvitees';

/**
 * Deletes an SME completely (the deleteTrainingSme function): its record,
 * people, invitations, progress, files and its own logins. Refused for an SME
 * with attendance or certificates on record; discontinue that one instead.
 */
export const deleteSmeCompletely = async (enrollmentId: string) =>
  (await httpsCallable(functions, "deleteTrainingSme")({ enrollmentId })).data as { people: number; invitations: number; logins: number };
