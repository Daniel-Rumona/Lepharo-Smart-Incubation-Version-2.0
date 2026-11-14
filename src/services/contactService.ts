import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/firebase";
import {
  CONTACT_CATEGORIES,
  type ContactInput,
  type SavedContact,
} from "@/lib/contactDirectory";

export const contactService = {
  async list(branchId: string): Promise<SavedContact[]> {
    const snapshot = await getDocs(
      query(
        collection(db, "receptionContacts"),
        where("branchId", "==", branchId)
      )
    );
    return snapshot.docs.map(
      (item) =>
        ({
          ...item.data(),
          id: item.id,
          linkedInquiryIds: item.data().linkedInquiryIds || [],
        } as SavedContact)
    );
  },
  async save(
    input: ContactInput,
    branchId: string,
    uid: string,
    id?: string
  ): Promise<void> {
    const data = {
      ...input,
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      company: input.company.trim(),
    };
    if (
      !branchId ||
      !uid ||
      !data.name ||
      (!data.email && !data.phone) ||
      !CONTACT_CATEGORIES.includes(data.category)
    )
      throw new Error("A name, category and email or phone are required.");
    if (id)
      await updateDoc(doc(db, "receptionContacts", id), {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    else
      await addDoc(collection(db, "receptionContacts"), {
        ...data,
        branchId,
        createdAt: serverTimestamp(),
        createdBy: uid,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
  },
};
