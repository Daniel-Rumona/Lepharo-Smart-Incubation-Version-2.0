import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { isAssessment, orderedItems, type Course, type Enrollment, type PublishAudience } from "./courseStorage";

/** A published course as listed in academyCatalog. */
export type CatalogCourse = {
  id: string;
  title: string;
  description: string;
  owner: string;
  revision: number;
  publishedAt?: string;
  publishTo?: PublishAudience;
  deletedAt?: string | null;
};

export type AssessmentScore = { itemId: string; title: string; kind: string; score: number; passMark: number };

export type CourseProgress = {
  completed: number;
  required: number;
  percent: number;
  /** First item, in course order, the learner has not completed (required items first). */
  nextItem?: { id: string; title: string };
  /** Graded quizzes and tests the learner has attempted. */
  scores?: AssessmentScore[];
};

export type LearnerCourse = CatalogCourse & { progress?: CourseProgress };

/** Learner routes live in the training family alongside the Training SME portal. */
export const LEARNER_COURSES = "/training/courses";
export const learnerCoursePath = (id: string) => `${LEARNER_COURSES}/${id}`;

export async function listCatalog(): Promise<CatalogCourse[]> {
  const snap = await getDocs(collection(db, "academyCatalog"));
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<CatalogCourse, "id">), id: d.id }))
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The courses linked to the signed-in training SME's own training, in the order staff linked them. */
async function trainingCourseIds(enrollmentId: string): Promise<{ ids: string[]; trainingName?: string }> {
  if (!enrollmentId) return { ids: [] };
  const enrollment = await getDoc(doc(db, "trainingEnrollments", enrollmentId));
  const trainingId = enrollment.exists() && enrollment.data().status === "enrolled" ? String(enrollment.data().trainingId || "") : "";
  if (!trainingId) return { ids: [] };
  const training = await getDoc(doc(db, "trainings", trainingId));
  if (!training.exists()) return { ids: [] };
  const data = training.data();
  return { ids: Array.isArray(data.courseIds) ? data.courseIds : [], trainingName: String(data.name || "") };
}

/** Required-item progress for each of the learner's enrollments, keyed by course id. */
async function progressByCourse(uid: string): Promise<Record<string, CourseProgress>> {
  const snap = await getDocs(query(collection(db, "academyEnrollments"), where("learnerId", "==", uid)));
  const version = versionLoader();
  const entries = await Promise.all(
    snap.docs.map(async (d) => {
      const enrollment = d.data() as Enrollment;
      return [enrollment.courseId, progressOf(enrollment, await version(enrollment))] as const;
    })
  );
  return Object.fromEntries(entries);
}

/** Required items completed out of required items in the published revision the learner enrolled on. */
function progressOf(enrollment: Enrollment, version?: Course): CourseProgress {
  const required = (version?.items || []).filter((i) => i.required);
  const completed = required.filter((i) => enrollment.items?.[i.id]?.status === "completed").length;
  const percent = required.length ? Math.round((completed / required.length) * 100) : 0;
  const items = version ? orderedItems(version) : [];
  const open = items.filter((i) => enrollment.items?.[i.id]?.status !== "completed");
  const next = open.find((i) => i.required) || open[0];
  const scores = items
    .filter((i) => isAssessment(i) && typeof enrollment.items?.[i.id]?.score === "number")
    .map((i) => ({ itemId: i.id, title: i.title, kind: i.kind, score: enrollment.items[i.id].score!, passMark: i.passMark }));
  return { completed, required: required.length, percent, nextItem: next ? { id: next.id, title: next.title } : undefined, scores };
}

/** Loads each academyVersions doc once, shared across enrollments on the same revision. */
function versionLoader() {
  const cache = new Map<string, Promise<Course | undefined>>();
  return (enrollment: Enrollment) => {
    const key = `${enrollment.courseId}_${enrollment.revision}`;
    if (!cache.has(key)) cache.set(key, getDoc(doc(db, "academyVersions", key)).then((v) => v.data() as Course | undefined));
    return cache.get(key)!;
  };
}

/** Key used by progressForLearners; matches the academyEnrollments doc id. */
export const learnerCourseKey = (learnerId: string, courseId: string) => `${learnerId}_${courseId}`;

/**
 * Staff view: each learner's progress on each given course, keyed by
 * learnerCourseKey. A pair with no enrollment yet (not started) is absent.
 */
export async function progressForLearners(pairs: { learnerId: string; courseId: string }[]): Promise<Record<string, CourseProgress>> {
  const version = versionLoader();
  const entries = await Promise.all(
    pairs.map(async ({ learnerId, courseId }) => {
      const key = learnerCourseKey(learnerId, courseId);
      const snap = await getDoc(doc(db, "academyEnrollments", key));
      if (!snap.exists()) return null;
      const enrollment = snap.data() as Enrollment;
      return [key, progressOf(enrollment, await version(enrollment))] as const;
    })
  );
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => !!e));
}

/**
 * The courses the signed-in user may take, with their progress.
 * Training SMEs see the courses linked to their training; everyone else sees
 * the catalog filtered by each course's publish audience. The academyAction
 * "enroll" callable enforces the same rule server-side.
 */
export function useLearnerCourses() {
  const { user } = useFullIdentity();
  const uid = user?.uid || "";
  const role = user?.role || "";
  const participantId = String(user?.participantId || "").trim();
  const [courses, setCourses] = useState<LearnerCourse[]>([]);
  const [trainingName, setTrainingName] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // Courses are the director's for now; a training SME's employees take none.
  const isTrainingEmployee = role === "training_sme" && (user as Record<string, unknown> | null)?.trainingRole === "employee";

  useEffect(() => {
    if (!uid) return;
    if (isTrainingEmployee) {
      setCourses([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [catalog, progress] = await Promise.all([listCatalog(), progressByCourse(uid).catch(() => ({}))]);
        let visible: CatalogCourse[];
        if (role === "training_sme") {
          const linked = await trainingCourseIds(participantId);
          const byId = new Map(catalog.map((c) => [c.id, c]));
          visible = linked.ids.map((id) => byId.get(id)).filter((c): c is CatalogCourse => !!c);
          if (!cancelled) setTrainingName(linked.trainingName);
        } else {
          visible = catalog.filter(
            (c) =>
              c.publishTo?.mode !== "selected" ||
              c.owner === uid ||
              (!!participantId && c.publishTo.participantIds?.includes(participantId))
          );
        }
        if (!cancelled) setCourses(visible.map((c) => ({ ...c, progress: (progress as Record<string, CourseProgress>)[c.id] })));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load courses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, role, participantId, isTrainingEmployee, retry]);

  return { courses, trainingName, loading, error, reload: () => setRetry((n) => n + 1) };
}
