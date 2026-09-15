import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  onSnapshot,
} from "firebase/firestore";
import {
  ref,
  uploadString,
  getDownloadURL,
  uploadBytes,
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { auth, db, storage, functions } from "@/firebase";
import type {
  SavedCourse,
  Course,
  Material,
  Enrollment,
} from "../../../functions/src/courseDomain";
import { normalizeCourse } from "../../../functions/src/courseDomain";
export * from "../../../functions/src/courseDomain";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("training-academy-courses", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("courses", { keyPath: ["owner", "id"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function local<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const databaseRef = await database();
  return new Promise((resolve, reject) => {
    const tx = databaseRef.transaction("courses", mode);
    const request = operation(tx.objectStore("courses"));
    tx.oncomplete = () => {
      databaseRef.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      databaseRef.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      databaseRef.close();
      reject(tx.error);
    };
  });
}
export const backupCourse = (course: SavedCourse) =>
  local("readwrite", (store) => store.put(course));
export const getRecovery = (
  owner: string,
  id: string
): Promise<SavedCourse | undefined> =>
  local("readonly", (store) => store.get([owner, id]));
export async function getCourse(
  owner: string,
  id: string
): Promise<SavedCourse | undefined> {
  try {
    const snap = await getDoc(doc(db, "academyDrafts", id));
    if (snap.exists()) {
      const course = normalizeCourse(snap.data() as SavedCourse);
      if (course.owner !== owner)
        throw new Error("You cannot edit this course.");
      return course;
    }
  } catch (error) {
    const recovery = await getRecovery(owner, id).catch(() => undefined);
    if (recovery) return { ...normalizeCourse(recovery), localRecovery: true };
    throw error;
  }
  const recovery = await getRecovery(owner, id).catch(() => undefined);
  return recovery
    ? { ...normalizeCourse(recovery), localRecovery: true }
    : undefined;
}

export async function saveCourse(course: SavedCourse): Promise<SavedCourse> {
  if (auth.currentUser?.uid !== course.owner)
    throw new Error("Sign in as the course author to save.");
  await backupCourse(course).catch(() => undefined);
  const material = async (m: Material): Promise<Material> => {
    if (!m.url.startsWith("data:")) return m;
    const location = ref(
      storage,
      `academyMaterials/${course.owner}/${course.id}/${
        m.id
      }_${crypto.randomUUID()}`
    );
    await uploadString(location, m.url, "data_url");
    return { ...m, url: await getDownloadURL(location) };
  };
  const items = [];
  for (const item of course.items) {
    const questions = [];
    for (const question of item.questions)
      questions.push({
        ...question,
        materials: await Promise.all((question.materials || []).map(material)),
      });
    items.push({
      ...item,
      materials: await Promise.all((item.materials || []).map(material)),
      questions,
    });
  }
  const { localRecovery, ...draft } = course;
  const clean = normalizeCourse({ ...draft, items });
  const saved = await runTransaction(db, async (tx) => {
    const location = doc(db, "academyDrafts", course.id),
      snapshot = await tx.get(location),
      existing = snapshot.data();
    if (existing?.deletedAt) throw new Error('This course was deleted. Restore it from the repository before editing.');
    if (existing && (existing.revision || 0) !== (course.revision || 0))
      throw new Error(
        "Another session saved this course. Your recovery copy is safe; reload the saved draft before continuing."
      );
    const next = {
      ...clean,
      revision: (existing?.revision || 0) + 1,
      publishedRevision: existing?.publishedRevision || 0,
    };
    tx.set(location, JSON.parse(JSON.stringify(next)));
    return next;
  });
  await backupCourse(saved).catch(() => undefined);
  return saved;
}
export async function listCourses(owner: string): Promise<SavedCourse[]> {
  const legacy = localStorage.getItem(`training-course-draft-v1:${owner}`);
  if (legacy && !(await getRecovery(owner, "legacy-draft"))) {
    try {
      const old = JSON.parse(legacy) as Course;
      if (Array.isArray(old.items))
        await backupCourse(
          normalizeCourse({
            ...old,
            id: "legacy-draft",
            owner,
            updatedAt: new Date().toISOString(),
          })
        );
    } catch {
      /* Other valid drafts remain accessible. */
    }
  }
  const recovered = (
    await local<SavedCourse[]>("readonly", (store) => store.getAll()).catch(
      () => []
    )
  ).filter((c) => c.owner === owner);
  const merged = new Map(
    recovered.map((c) => [c.id, { ...normalizeCourse(c), localRecovery: true }])
  );
  try {
    const snapshot = await getDocs(
      query(collection(db, "academyDrafts"), where("owner", "==", owner))
    );
    snapshot.docs.forEach((d) =>
      merged.set(d.id, {
        ...normalizeCourse(d.data() as SavedCourse),
        localRecovery: false,
      })
    );
  } catch (error) {
    if (!recovered.length) throw error;
  }
  return [...merged.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}
export async function courseAction(
  action: string,
  data: Record<string, unknown>
): Promise<any> {
  return (await httpsCallable(functions, "academyAction")({ action, ...data }))
    .data;
}
export async function coachMessage(
  enrollmentId: string,
  itemId: string,
  text: string
): Promise<Enrollment> {
  return (
    await httpsCallable(
      functions,
      "academyCoach"
    )({ enrollmentId, itemId, text })
  ).data as Enrollment;
}
export async function uploadSubmission(
  file: File,
  enrollmentId: string
): Promise<Material> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in to upload.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Choose a file smaller than 25 MB.");
  const id = crypto.randomUUID(),
    location = ref(storage, `academySubmissions/${uid}/${enrollmentId}/${id}`);
  await uploadBytes(location, file);
  return {
    id,
    kind: "document",
    name: file.name,
    url: await getDownloadURL(location),
  };
}
export async function learnerCourse(
  id: string
): Promise<{ course: Course; enrollment: Enrollment }> {
  const enrollment = (await courseAction("enroll", {
    courseId: id,
  })) as Enrollment;
  const version = await getDoc(
    doc(db, "academyVersions", `${id}_${enrollment.revision}`)
  );
  if (!version.exists())
    throw new Error("Published course version is unavailable.");
  return { course: version.data() as Course, enrollment };
}
export function watchEnrollment(
  id: string,
  onChange: (value: Enrollment) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    doc(db, "academyEnrollments", id),
    (snapshot) => {
      if (snapshot.exists()) onChange(snapshot.data() as Enrollment);
    },
    onError
  );
}
export async function reviewQueue(
  owner: string,
  courseId: string
): Promise<Enrollment[]> {
  const snapshot = await getDocs(
    query(collection(db, "academyEnrollments"), where("owner", "==", owner))
  );
  return snapshot.docs
    .map((d) => ({ ...d.data(), id: d.id } as Enrollment))
    .filter(
      (e) =>
        e.courseId === courseId &&
        Object.values(e.items).some((i) => i.status === "submitted")
    );
}

export async function setCourseDeleted(course: SavedCourse, deleted: boolean): Promise<void> {
  if (auth.currentUser?.uid !== course.owner) throw new Error('Sign in as the course author.');
  const result = course.revision ? await courseAction(deleted ? 'deleteCourse' : 'restoreCourse', {courseId:course.id}) : {deletedAt:deleted ? new Date().toISOString() : null};
  await backupCourse({...course,deletedAt:result.deletedAt,revision:course.revision ? course.revision + 1 : 0});
}
