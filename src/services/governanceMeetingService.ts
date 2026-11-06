import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/firebase";
import { GovernanceMeeting } from "@/types/featureGovernance";

const meetings = collection(db, "governanceMeetings");

export const governanceMeetingService = {
  async list(): Promise<GovernanceMeeting[]> {
    const snap = await getDocs(query(meetings));
    return snap.docs
      .map((item) => ({ id: item.id, ...item.data() } as GovernanceMeeting))
      .sort(
        (a, b) =>
          (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0)
      );
  },
  async create(
    value: Omit<GovernanceMeeting, "id" | "createdAt" | "updatedAt">
  ) {
    return addDoc(meetings, {
      ...value,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
  async update(id: string, patch: Partial<GovernanceMeeting>) {
    return updateDoc(doc(db, "governanceMeetings", id), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  },
  /**
   * Creates or patches a meeting under a known id. Recurring occurrences use
   * the id the reminder cron would give them ({scheduleId}_{date}), so an
   * occurrence answered here is the same document the cron later finds.
   */
  async upsert(id: string, value: Partial<GovernanceMeeting>) {
    return setDoc(
      doc(db, "governanceMeetings", id),
      { ...value, updatedAt: serverTimestamp() },
      { merge: true }
    );
  },
  async updateChallenges(
    id: string,
    challenges: GovernanceMeeting["challenges"]
  ) {
    return updateDoc(doc(db, "governanceMeetings", id), {
      challenges,
      updatedAt: serverTimestamp(),
    });
  },
};
