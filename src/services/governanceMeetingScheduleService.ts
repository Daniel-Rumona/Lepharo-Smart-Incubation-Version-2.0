import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/firebase";
import { GovernanceMeetingSchedule } from "@/types/featureGovernance";

const schedules = collection(db, "governanceMeetingSchedules");

export const governanceMeetingScheduleService = {
  async list(): Promise<GovernanceMeetingSchedule[]> {
    const snap = await getDocs(query(schedules));
    return snap.docs
      .map(
        (item) => ({ id: item.id, ...item.data() } as GovernanceMeetingSchedule)
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  },
  async create(value: Omit<GovernanceMeetingSchedule, "id">) {
    return addDoc(schedules, {
      ...value,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },
  async setActive(id: string, active: boolean) {
    return updateDoc(doc(db, "governanceMeetingSchedules", id), {
      active,
      updatedAt: serverTimestamp(),
    });
  },
  async remove(id: string) {
    return deleteDoc(doc(db, "governanceMeetingSchedules", id));
  },
};
