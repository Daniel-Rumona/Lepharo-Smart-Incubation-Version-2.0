import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { type CourseProgress, learnerCourseKey, listCatalog, progressForLearners } from "@/components/courses/learnerCourses";
import type { Training, TrainingEnrollment } from "@/components/trainings/trainingStorage";
import { type BookedSession, loadBookedSessions, orderedPlan } from "@/components/trainings/trainingPlan";
import type { Appointment } from "@/types/appointment";

/** Is the active programme id a training? (Trainings are listed in the programme picker.) */
export function useActiveTraining(programId?: string) {
  const [training, setTraining] = useState<Training | null>(null);
  const [checking, setChecking] = useState(!!programId);
  useEffect(() => {
    if (!programId) {
      setTraining(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    getDoc(doc(db, "trainings", programId))
      .then((snap) => !cancelled && setTraining(snap.exists() ? ({ ...(snap.data() as Omit<Training, "id">), id: snap.id }) : null))
      .catch(() => !cancelled && setTraining(null))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [programId]);
  return { training, checking };
}

export type TrainingProgramData = {
  smes: TrainingEnrollment[];
  booked: Record<string, BookedSession>;
  /** Invitations for this training's sessions, by appointmentSessionId. */
  invitations: Record<string, Appointment[]>;
  progress: Record<string, CourseProgress>;
  courseTitles: Record<string, string>;
};

/** Everything the training dashboard shows, loaded for one training. */
export function useTrainingProgram(training: Training | null) {
  const [data, setData] = useState<TrainingProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!training) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const sessionIds = orderedPlan(training.plan)
          .map((s) => s.appointmentSessionId)
          .filter((id): id is string => !!id);
        const [enrollSnap, booked, apptSnap, catalog] = await Promise.all([
          getDocs(query(collection(db, "trainingEnrollments"), where("trainingId", "==", training.id))),
          loadBookedSessions(sessionIds),
          getDocs(query(collection(db, "appointments"), where("programId", "==", training.id))),
          listCatalog().catch(() => []),
        ]);
        const smes = enrollSnap.docs.map((d) => ({ ...(d.data() as Omit<TrainingEnrollment, "id">), id: d.id }));
        const invitations: Record<string, Appointment[]> = {};
        apptSnap.docs.forEach((d) => {
          const a = { ...(d.data() as Appointment), id: d.id } as Appointment & { id: string };
          if (a.status === "cancelled" || !a.appointmentSessionId) return;
          (invitations[a.appointmentSessionId] ||= []).push(a);
        });
        const pairs = smes.flatMap((e) =>
          e.status === "enrolled" && e.userId ? (training.courseIds || []).map((courseId) => ({ learnerId: e.userId!, courseId })) : []
        );
        const progress = pairs.length ? await progressForLearners(pairs).catch(() => ({})) : {};
        if (!cancelled)
          setData({ smes, booked, invitations, progress, courseTitles: Object.fromEntries(catalog.map((c) => [c.id, c.title])) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this training.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [training, retry]);

  return { data, loading, error, reload: () => setRetry((n) => n + 1) };
}

export { learnerCourseKey };
