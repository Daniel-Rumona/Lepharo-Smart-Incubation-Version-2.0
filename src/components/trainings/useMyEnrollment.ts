import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import type { Training, TrainingAttendee, TrainingEnrollment } from "./trainingStorage";

/**
 * director: the SME's owner (the enrollment's own person); sees and manages the
 * whole company. employee: a person the SME sends; sees company totals and
 * their own sessions, and may only answer and check in to their own.
 * A login without trainingRole predates employees and is the director.
 */
export type TrainingPortalRole = "director" | "employee";

type Profile = Record<string, unknown> | null;

/**
 * The signed-in training SME's company, person and training. users.participantId
 * is the company's enrollment id for directors and employees alike;
 * users.trainingAttendeeId is the person. Only the director may read the
 * enrollment itself (it holds the company's documents), so an employee's
 * company is described from their profile and person record.
 */
export function useMyEnrollment() {
  const { user } = useFullIdentity();
  const profile = user as Profile;
  const enrollmentId = String(profile?.participantId || "").trim();
  const attendeeId = String(profile?.trainingAttendeeId || "").trim();
  const role: TrainingPortalRole = profile?.trainingRole === "employee" ? "employee" : "director";
  const profileTrainingId = String(profile?.trainingId || "").trim();
  const [enrollment, setEnrollment] = useState<TrainingEnrollment | null>(null);
  const [attendee, setAttendee] = useState<TrainingAttendee | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!enrollmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        let mine: TrainingEnrollment | null = null;
        if (role === "director") {
          const enrollmentSnap = await getDoc(doc(db, "trainingEnrollments", enrollmentId));
          if (!enrollmentSnap.exists()) throw new Error("We couldn't find your training enrollment.");
          mine = { ...(enrollmentSnap.data() as Omit<TrainingEnrollment, "id">), id: enrollmentSnap.id };
        }
        // A director's person record is optional (it appears once the SME's people are set up).
        const attendeeSnap = attendeeId ? await getDoc(doc(db, "trainingAttendees", attendeeId)).catch(() => null) : null;
        const person = attendeeSnap?.exists() ? ({ ...(attendeeSnap.data() as Omit<TrainingAttendee, "id">), id: attendeeSnap.id }) : null;
        if (role === "employee" && !person) throw new Error("We couldn't find your training record.");
        if (person?.status === "withdrawn") throw new Error("You've been withdrawn from this training.");
        const trainingId = mine?.trainingId || person?.trainingId || profileTrainingId;
        const trainingSnap = trainingId ? await getDoc(doc(db, "trainings", trainingId)) : null;
        if (cancelled) return;
        setEnrollment(mine);
        setAttendee(person);
        setTraining(trainingSnap?.exists() ? ({ ...(trainingSnap.data() as Omit<Training, "id">), id: trainingSnap.id }) : null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your training.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enrollmentId, attendeeId, role, profileTrainingId]);

  const companyName = enrollment?.companyName || String(profile?.companyName || profile?.company || "");
  // Stable between renders: the agenda reloads when it changes.
  const categories = useMemo(() => attendee?.categories || enrollment?.categories || [], [attendee, enrollment]);
  return {
    user,
    role,
    /** The company (trainingEnrollments id); set for directors and employees. */
    enrollmentId: enrollment || attendee ? enrollmentId : "",
    companyName,
    /** Director only: employees can't read the company's enrollment. */
    enrollment,
    /** The signed-in person, when the SME's people are set up. */
    attendee,
    /** The categories this person attends (a director without a person record: the company's). */
    categories,
    training,
    loading,
    error,
  };
}
