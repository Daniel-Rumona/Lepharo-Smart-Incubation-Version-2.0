import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
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
