import { Timestamp, arrayUnion, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase";
import { invitationDocId, scheduleAppointmentSession } from "@/services/appointmentSchedulingService";
import { getDepartmentDescendants } from "@/services/departmentCapabilities";
import { departmentIdForRole, loadDepartmentRoles } from "@/services/departmentRoles";
import type { Appointment, AppointmentSession } from "@/types/appointment";
import type { Dayjs } from "dayjs";
import type { PlanDeliverer, RepeatFrequency, Training, TrainingDeliveryPlan, TrainingPlanSession } from "./trainingStorage";
import { type TrainingInvitee, inviteeKey } from "./attendeeStorage";

/*
 * Training plans reuse the canonical v5 appointment collections instead of a
 * parallel one. Trainings have no intervention, so every session carries a
 * synthetic interventionId (trainingInterventionId) and a groupKey naming the
 * training and plan session, and programId is the training's own id: a
 * training is a programme in its own right (it is listed in the programme
 * picker for Training Academy staff). The firestore rules only require interventionId
 * to be a string, and group sessions are scoped by groupKey, not by an
 * assigned intervention, so no rule change is needed.
 */

export const trainingInterventionId = (trainingId: string) => `training_${trainingId}`;
export const trainingSessionGroupKey = (trainingId: string, planSessionId: string) => `training:${trainingId}:${planSessionId}`;

export const newPlanSessionId = () => `ps_${crypto.randomUUID().slice(0, 8)}`;

export const REPEAT_LABEL: Record<RepeatFrequency, string> = {
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Every week",
};

/** A repeating session never expands past this many occurrences. */
export const MAX_OCCURRENCES = 100;

/** Dates from `start` to `until` (inclusive) for a repeat rule. */
export function occurrenceDates(start: Dayjs, until: Dayjs, frequency: RepeatFrequency): Dayjs[] {
  const dates: Dayjs[] = [];
  let day = start.startOf("day");
  const last = until.endOf("day");
  while (!day.isAfter(last) && dates.length < MAX_OCCURRENCES) {
    const weekday = day.day();
    if (frequency !== "weekdays" || (weekday !== 0 && weekday !== 6)) dates.push(day);
    day = day.add(1, frequency === "weekly" ? "week" : "day");
  }
  return dates;
}

/** "Bookkeeping · Day 3 of 10" for an occurrence; the plain title otherwise. */
export const planSessionLabel = (s: Pick<TrainingPlanSession, "title" | "series">) =>
  s.series ? `${s.title} · ${s.series.frequency === "weekly" ? "Week" : "Day"} ${s.series.index} of ${s.series.count}` : s.title;

/** Unscheduled sessions keep their plan order after the dated ones. */
export function orderedPlan(plan: TrainingPlanSession[] = []): TrainingPlanSession[] {
  const dated = plan.filter((s) => s.startAt).sort((a, b) => a.startAt!.localeCompare(b.startAt!));
  return [...dated, ...plan.filter((s) => !s.startAt)];
}

export const newPlanItemId = () => `pi_${crypto.randomUUID().slice(0, 8)}`;

export const delivererName = (deliverer?: PlanDeliverer | null) => deliverer?.name || "";

export async function saveDeliveryPlan(trainingId: string, plan: TrainingDeliveryPlan): Promise<void> {
  await updateDoc(doc(db, "trainings", trainingId), {
    deliveryPlan: JSON.parse(JSON.stringify(plan)),
    updatedAt: new Date().toISOString(),
  });
}

/** Appends a session booked from Appointments; arrayUnion so two departments booking at once don't overwrite each other. */
export async function recordBookedSession(trainingId: string, session: TrainingPlanSession): Promise<void> {
  await updateDoc(doc(db, "trainings", trainingId), {
    plan: arrayUnion(JSON.parse(JSON.stringify(session))),
    updatedAt: new Date().toISOString(),
  });
}

export type TrainingStaff = { id: string; name: string; email: string | null; role: string; departmentId: string };

/**
 * HODs (role operations) and coordinators of the Training Academy department
 * (systemSettings/departmentRoles "training") and its sub-departments: the
 * people a plan item can name as its deliverer. Falls back to
 * `fallbackDepartmentId` when no Training Academy department is configured.
 */
export async function listTrainingStaff(fallbackDepartmentId?: string): Promise<TrainingStaff[]> {
  const { roles, departments } = await loadDepartmentRoles();
  const rootId = departmentIdForRole("training", roles) || String(fallbackDepartmentId || "");
  if (!rootId) return [];
  const tree = departments.map((d) => ({ id: d.id, parentDepartmentId: String(d.parentDepartmentId || d.parentDeptId || "") }));
  const departmentIds = [rootId, ...getDepartmentDescendants(rootId, tree).map((d) => d.id)];
  const chunks: string[][] = [];
  for (let i = 0; i < departmentIds.length; i += 30) chunks.push(departmentIds.slice(i, i + 30));
  const snaps = await Promise.all(chunks.map((ids) => getDocs(query(collection(db, "users"), where("departmentId", "in", ids)))));
  return snaps
    .flatMap((snap) => snap.docs)
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name || data.email || d.id),
        email: data.email || null,
        role: String(data.role || ""),
        departmentId: String(data.departmentId || ""),
      };
    })
    .filter((s) => s.role === "operations" || s.role === "coordinator")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTrainingPlan(trainingId: string, plan: TrainingPlanSession[]): Promise<void> {
  await updateDoc(doc(db, "trainings", trainingId), {
    plan: JSON.parse(JSON.stringify(plan)),
    updatedAt: new Date().toISOString(),
  });
}

type Scheduler = { departmentId: string; role: string };

/**
 * One invitation per invitee: a person from an SME (smeId stays the
 * enrollment, smeEmail is the person's own email), or an SME whose people
 * aren't on record yet, invited as one record as before.
 */
function invitationFor(
  { enrollment, attendee }: TrainingInvitee,
  training: Training,
  session: TrainingPlanSession,
  scheduler: Scheduler
): Omit<Appointment, "appointmentSessionId" | "createdAt" | "updatedAt"> {
  const synthetic =
    enrollment.dataOrigin === "synthetic" || enrollment.suppressNotifications === true || attendee?.dataOrigin === "synthetic" || enrollment.id.startsWith("dtseed_");
  return {
    schemaVersion: 5,
    programId: training.id,
    departmentId: scheduler.departmentId,
    assignedInterventionId: "",
    smeId: enrollment.id,
    smeName: attendee ? enrollment.companyName || enrollment.name : enrollment.name,
    smeEmail: (attendee ? attendee.email : enrollment.email) || null,
    ...(attendee ? { attendeeId: attendee.id, attendeeName: attendee.name, attendeeKind: attendee.kind } : {}),
    ...(synthetic ? { dataOrigin: "synthetic" as const, suppressNotifications: true } : {}),
    interventionId: trainingInterventionId(training.id),
    interventionTitle: training.name,
    subInterventionId: session.id,
    subInterventionTitle: planSessionLabel(session),
    cycleKey: null,
    assigneeId: session.facilitatorId,
    assigneeName: session.facilitatorName,
    assigneeEmail: session.facilitatorEmail,
    assigneeRole: scheduler.role === "coordinator" ? "coordinator" : "operations",
    groupKey: trainingSessionGroupKey(training.id, session.id),
    status: "scheduled",
    smeConfirmation: "pending",
    smeDeclineReason: null,
    attendance: { status: "expected", checkedInAt: null, checkedOutAt: null },
    foodSelections: [],
    completedAt: null,
  };
}

export function scheduleProblem(session: TrainingPlanSession, invitees: TrainingInvitee[]): string | undefined {
  if (!session.startAt || !session.endAt) return "Set a date and time first.";
  if (new Date(session.endAt) <= new Date(session.startAt)) return "The session must end after it starts.";
  if (!session.facilitatorId) return "Choose a facilitator.";
  if (!invitees.length) return session.category ? `No one attending is in the ${session.category} category yet.` : "No SMEs are enrolled in this training yet.";
  return undefined;
}

/** Books the plan session as one group appointment session with an invitation per invitee. */
export async function scheduleTrainingSession(
  training: Training,
  session: TrainingPlanSession,
  invitees: TrainingInvitee[],
  scheduler: Scheduler
): Promise<string> {
  const problem = scheduleProblem(session, invitees);
  if (problem) throw new Error(problem);
  const payload: Omit<AppointmentSession, "createdAt" | "updatedAt"> = {
    schemaVersion: 5,
    programId: training.id,
    departmentId: scheduler.departmentId,
    interventionId: trainingInterventionId(training.id),
    interventionTitle: training.name,
    cycleKey: null,
    groupKey: trainingSessionGroupKey(training.id, session.id),
    sessionType: "group",
    assigneeId: session.facilitatorId,
    assigneeName: session.facilitatorName,
    assigneeEmail: session.facilitatorEmail,
    assigneeRole: scheduler.role === "coordinator" ? "coordinator" : "operations",
    title: `${training.name}: ${planSessionLabel(session)}`,
    startAt: Timestamp.fromDate(new Date(session.startAt!)),
    endAt: Timestamp.fromDate(new Date(session.endAt!)),
    deliveryMethod: session.deliveryMethod,
    location: session.location || null,
    meetingLink: session.meetingLink || null,
    plannedTopics: session.topics,
    category: session.category || null,
    plannedCoverage: session.description ? [session.description] : session.topics,
    coverage: { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
    attendanceSession: null,
    attendanceSummary: { invitedCount: invitees.length, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
    foodMenu: [],
    status: "scheduled",
    completedAt: null,
  };
  const { sessionId } = await scheduleAppointmentSession({
    session: payload,
    invitations: invitees.map((invitee) => invitationFor(invitee, training, session, scheduler)),
  });
  return sessionId;
}

/** Invitees already invited to a scheduled session (by inviteeKey), so people added later can be invited. */
export async function invitedKeys(appointmentSessionId: string): Promise<Set<string>> {
  const snap = await getDocs(query(collection(db, "appointments"), where("appointmentSessionId", "==", appointmentSessionId)));
  return new Set(
    snap.docs.filter((d) => d.data().status !== "cancelled").map((d) => inviteeKey(String(d.data().smeId), d.data().attendeeId))
  );
}

/** Adds invitations for people (or SMEs) added after the session was booked, keeping the session's own linkage. */
export async function inviteToTrainingSession(
  training: Training,
  session: TrainingPlanSession,
  invitees: TrainingInvitee[],
  scheduler: Scheduler
): Promise<number> {
  const sessionId = session.appointmentSessionId;
  if (!sessionId) throw new Error("Schedule the session first.");
  const sessionRef = doc(db, "appointmentSessions", sessionId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists()) throw new Error("The booked session no longer exists.");
    const booked = snap.data() as AppointmentSession;
    const refs = invitees.map((invitee) => doc(db, "appointments", invitationDocId(sessionId, invitee.enrollment.id, invitee.attendee?.id)));
    const existing = await Promise.all(refs.map((ref) => tx.get(ref)));
    let added = 0;
    invitees.forEach((invitee, i) => {
      if (existing[i].exists() && existing[i].data()?.status !== "cancelled") return;
      tx.set(refs[i], {
        ...invitationFor(invitee, training, session, scheduler),
        // A late invitation to a seeded session keeps the session's mark.
        ...(booked.dataOrigin === "synthetic" ? { dataOrigin: "synthetic", suppressNotifications: true } : {}),
        // The rules require the invitation to match the session it points at.
        programId: booked.programId,
        departmentId: booked.departmentId,
        appointmentSessionId: sessionId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      added += 1;
    });
    if (added) {
      tx.update(sessionRef, {
        attendanceSummary: { ...booked.attendanceSummary, invitedCount: (booked.attendanceSummary?.invitedCount || 0) + added },
        updatedAt: serverTimestamp(),
      });
    }
    return added;
  });
}

export type RosterEntry = Pick<Appointment, "smeId" | "smeName" | "smeEmail" | "attendeeId" | "attendeeName" | "attendeeKind" | "smeConfirmation" | "smeDeclineReason" | "attendance" | "status"> & {
  id: string;
};

/** Everyone invited to a booked session, for the per-company roster. Cancelled invitations are left out. */
export async function loadSessionRoster(appointmentSessionId: string): Promise<RosterEntry[]> {
  const snap = await getDocs(query(collection(db, "appointments"), where("appointmentSessionId", "==", appointmentSessionId)));
  return snap.docs
    .map((d) => ({ ...(d.data() as Appointment), id: d.id }))
    .filter((a) => a.status !== "cancelled");
}

export type BookedSession = Pick<AppointmentSession, "status" | "startAt" | "endAt" | "attendanceSummary" | "coverage"> & { id: string };

export async function loadBookedSessions(ids: string[]): Promise<Record<string, BookedSession>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const snap = await getDoc(doc(db, "appointmentSessions", id));
      return snap.exists() ? ([id, { ...(snap.data() as AppointmentSession), id }] as const) : null;
    })
  );
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => !!e));
}
