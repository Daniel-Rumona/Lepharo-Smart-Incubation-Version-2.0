import { admin, db } from "./firebase";
import { clean } from "./whatsappCommon";
import { GatewayResult, ownerIds, sastParts, StaffIdentity } from "./whatsappStaff";

/**
 * Facilitators recording a finished session's coverage on WhatsApp. This mirrors "Record coverage" on the
 * appointments page (saveCoverage in src/routes/shared/appointments/index.tsx), which is browser-only:
 * the same validation, the same batch to the session, its invitations, the linked interventions and a
 * grouped delivery, and the same assignment-link rules (src/lib/appointmentAssignments.ts).
 *
 * Only the session's own facilitator may record it, only once it has ended and has no coverage yet.
 * Training Academy sessions need formal topics and stay on the web. Completing the intervention (signed
 * MOV) also stays on the web: reaching the planned sessions sets coverage.completionRequired, which the
 * appointments page shows as "Ready for completion".
 *
 * The conversation keeps a draft per facilitator (whatsappCoverageDrafts/{userId}); each update returns
 * the next step the assistant should ask: held -> reason | attendance -> summary -> confirm.
 */

type Outcome = "attended" | "no_show";
type NotHeldReason = "no-show" | "cancelled" | "other";

const ok = (body: Record<string, unknown>): GatewayResult => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status: number, error: string): GatewayResult => ({ status, body: { ok: false, error } });
const lower = (value: unknown) => clean(value).toLowerCase();
const shortText = (value: unknown, max: number) => clean(value).replace(/\s+/g, " ").slice(0, max);
const wordCount = (value: unknown) => clean(value).split(/\s+/).filter(Boolean).length;
const drafts = db.collection("whatsappCoverageDrafts");
const NOT_HELD_REASONS: NotHeldReason[] = ["no-show", "cancelled", "other"];

/* --------------------------------------------------------------- sessions */

const isTrainingDepartment = async (departmentId: string) => {
  // departmentUsesTrainingCoverage: a department inherits it from any ancestor marked isTraining.
  let current = clean(departmentId);
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const data = (await db.collection("departments").doc(current).get()).data();
    if (!data) return false;
    if (data.isTraining === true) return true;
    current = clean(data.parentDepartmentId || data.parentDeptId);
  }
  return false;
};

const awaitingCoverage = (data: FirebaseFirestore.DocumentData, now = Date.now()) =>
  !data.coverage && !["completed", "cancelled"].includes(lower(data.status)) && (data.endAt?.toMillis?.() ?? Infinity) < now;

/** The facilitator's own sessions that have ended and still need coverage, newest first. */
export async function sessionsAwaitingCoverage(identity: StaffIdentity) {
  const found = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const id of ownerIds(identity)) {
    (await db.collection("appointmentSessions").where("assigneeId", "==", id).limit(300).get()).docs
      .forEach((doc) => found.set(doc.id, doc));
  }
  return Array.from(found.values())
    .filter((doc) => awaitingCoverage(doc.data()))
    .sort((a, b) => (b.data().startAt?.toMillis?.() ?? 0) - (a.data().startAt?.toMillis?.() ?? 0));
}

/** A session this facilitator may record, with its live invitations as the coverage page sees them. */
async function ownedSession(identity: StaffIdentity, sessionId: string) {
  const snapshot = sessionId ? await db.collection("appointmentSessions").doc(sessionId).get() : null;
  const data = snapshot?.data();
  if (!snapshot?.exists || !data || !ownerIds(identity).includes(clean(data.assigneeId))) return { error: "session_not_found" as const };
  if (!awaitingCoverage(data)) return { error: "coverage_not_due" as const };
  const invitations = (await db.collection("appointments").where("appointmentSessionId", "==", snapshot.id).get()).docs
    .filter((doc) => lower(doc.data().status) !== "cancelled");
  if (!invitations.length) return { error: "no_invitations" as const };
  const date = sastParts(data.startAt.toDate()).date;
  const rows = invitations.map((doc) => {
    const invite = doc.data();
    return {
      ...invite,
      id: doc.id,
      participantId: clean(invite.smeId),
      participantName: invite.attendeeName ? `${clean(invite.attendeeName)} · ${clean(invite.smeName)}` : clean(invite.smeName) || "SME",
      date,
    } as Record<string, any>;
  });
  return { snapshot, data, rows, training: await isTrainingDepartment(clean(data.departmentId || rows[0]?.departmentId)) };
}

const sessionLabel = (data: FirebaseFirestore.DocumentData) => {
  const start = data.startAt?.toDate?.() as Date | undefined;
  const when = start ? `${sastParts(start).date} ${sastParts(start).time}` : "";
  return { title: clean(data.title) || clean(data.interventionTitle) || "Session", when };
};

export async function coveragePending(identity: StaffIdentity): Promise<GatewayResult> {
  const sessions = await sessionsAwaitingCoverage(identity);
  const rows = await Promise.all(sessions.slice(0, 10).map(async (doc) => {
    const data = doc.data();
    const invitations = (await db.collection("appointments").where("appointmentSessionId", "==", doc.id).get()).docs
      .filter((invite) => lower(invite.data().status) !== "cancelled");
    return {
      sessionId: doc.id,
      ...sessionLabel(data),
      smes: invitations.map((invite) => clean(invite.data().smeName)).filter(Boolean).slice(0, 4),
      smeCount: invitations.length,
      webOnly: await isTrainingDepartment(clean(data.departmentId)),
    };
  }));
  return ok({ sessions: rows, total: sessions.length });
}

/* ------------------------------------------------------------------ drafts */

type Draft = {
  sessionId: string;
  held: boolean | null;
  notHeldReason: NotHeldReason | null;
  reasonNotHeld: string | null;
  attendance: Record<string, Outcome>;
  summary: string | null;
};

function nextStep(draft: Draft, rows: Array<Record<string, any>>) {
  if (draft.held === null) return { step: "held" };
  if (draft.held === false) {
    if (!draft.notHeldReason) return { step: "not_held_reason" };
    return { step: "confirm" };
  }
  const missing = rows.find((row) => !draft.attendance[row.id]);
  if (missing) return { step: "attendance", appointmentId: missing.id, participantName: missing.participantName, group: rows.length > 1 };
  if (!draft.summary) return { step: "summary" };
  return { step: "confirm" };
}

function draftView(draft: Draft, session: { data: FirebaseFirestore.DocumentData; rows: Array<Record<string, any>> }) {
  return {
    sessionId: draft.sessionId,
    ...sessionLabel(session.data),
    held: draft.held,
    notHeldReason: draft.notHeldReason,
    reasonNotHeld: draft.reasonNotHeld,
    summary: draft.summary,
    attendance: session.rows.map((row) => ({ appointmentId: row.id, participantName: row.participantName, outcome: draft.attendance[row.id] || null })),
    ...nextStep(draft, session.rows),
  };
}

const sessionError = (error: string) => fail(error === "session_not_found" ? 404 : 409, error);

export async function coverageStart(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const session = await ownedSession(identity, clean(payload.sessionId));
  if ("error" in session) return sessionError(session.error!);
  if (session.training) return fail(409, "training_coverage_on_web");
  const draft: Draft = { sessionId: session.snapshot.id, held: null, notHeldReason: null, reasonNotHeld: null, attendance: {}, summary: null };
  await drafts.doc(identity.id).set({ ...draft, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return ok({ draft: draftView(draft, session) });
}

async function currentDraft(identity: StaffIdentity) {
  const data = (await drafts.doc(identity.id).get()).data();
  if (!data?.sessionId) return null;
  return {
    sessionId: clean(data.sessionId),
    held: typeof data.held === "boolean" ? data.held : null,
    notHeldReason: NOT_HELD_REASONS.includes(data.notHeldReason) ? data.notHeldReason : null,
    reasonNotHeld: data.reasonNotHeld ?? null,
    attendance: (data.attendance || {}) as Record<string, Outcome>,
    summary: data.summary ?? null,
  } as Draft;
}

/** Applies one answer; validates it the way the coverage form does. */
export async function coverageUpdate(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const draft = await currentDraft(identity);
  if (!draft || draft.sessionId !== clean(payload.sessionId)) return fail(404, "no_coverage_in_progress");
  const session = await ownedSession(identity, draft.sessionId);
  if ("error" in session) return sessionError(session.error!);

  if (typeof payload.held === "boolean") {
    draft.held = payload.held;
    if (payload.held) {
      draft.notHeldReason = null;
      draft.reasonNotHeld = null;
    } else {
      draft.attendance = {};
      draft.summary = null;
    }
  }
  if (payload.notHeldReason !== undefined) {
    const reason = lower(payload.notHeldReason);
    // Rescheduling is not an outcome: the web sends it to Reschedule.
    if (reason === "rescheduled") return fail(400, "reschedule_on_web");
    if (!NOT_HELD_REASONS.includes(reason as NotHeldReason)) return fail(400, "invalid_reason");
    draft.notHeldReason = reason as NotHeldReason;
  }
  if (payload.reasonNotHeld !== undefined) draft.reasonNotHeld = shortText(payload.reasonNotHeld, 500) || null;
  if (payload.allAttended === true) session.rows.forEach((row) => { draft.attendance[row.id] = "attended"; });
  if (payload.attendance && typeof payload.attendance === "object") {
    for (const [appointmentId, outcome] of Object.entries(payload.attendance)) {
      if (!session.rows.some((row) => row.id === appointmentId) || !["attended", "no_show"].includes(String(outcome))) {
        return fail(400, "invalid_attendance");
      }
      draft.attendance[appointmentId] = outcome as Outcome;
    }
  }
  if (payload.summary !== undefined) {
    const summary = shortText(payload.summary, 2000);
    if (wordCount(summary) < 5) return fail(400, "summary_too_short");
    draft.summary = summary;
  }
  await drafts.doc(identity.id).set({ ...draft, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return ok({ draft: draftView(draft, session) });
}

export async function coverageCancel(identity: StaffIdentity): Promise<GatewayResult> {
  await drafts.doc(identity.id).delete();
  return ok({ cancelled: true });
}

/* ------------------------------------------------- assignment links (ported) */

const toDate = (raw: any): Date | null => {
  if (raw == null || raw === "") return null;
  const value = typeof raw?.toDate === "function" ? raw.toDate() : typeof raw?.seconds === "number" ? new Date(raw.seconds * 1000) : new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
};
const firstDate = (values: any[]) => values.map(toDate).find(Boolean) || null;
const assignmentDate = (row: any) => firstDate([row.assignedAt, row.createdAt]);
const scheduledAppointmentDate = (row: any) =>
  firstDate([row.schedule?.startAt, row.schedule?.startTime, row.startsAt, row.date, row.startAt, row.startTime]);
const appointmentDate = (row: any) =>
  firstDate([row.schedule?.startAt, row.schedule?.startTime, row.startsAt, row.date, row.startAt, row.startTime, row.createdAt]);
const dayOf = (date: Date) => sastParts(date).date;

/** src/lib/appointmentAssignments.ts assignmentCanOwnAppointment. */
function assignmentCanOwnAppointment(appointment: any, assignment: any, options: { requireScheduledDate?: boolean } = {}) {
  const participantId = clean(appointment.participantId || appointment.smeId);
  const assignmentParticipantId = clean(assignment.participantId || assignment.beneficiaryId);
  if (participantId && assignmentParticipantId && participantId !== assignmentParticipantId) return false;
  if (appointment.interventionId && clean(assignment.interventionId) !== clean(appointment.interventionId)) return false;
  for (const field of ["programId", "departmentId", "cycleKey", "groupKey", "assigneeId", "subInterventionId"]) {
    if (appointment[field] && clean(assignment[field]) !== clean(appointment[field])) return false;
  }
  const strict = scheduledAppointmentDate(appointment);
  if (options.requireScheduledDate && !strict) return false;
  const scheduled = options.requireScheduledDate ? strict : appointmentDate(appointment);
  const assigned = assignmentDate(assignment);
  if (scheduled && assigned && dayOf(scheduled) < dayOf(assigned)) return false;
  return true;
}

/** unambiguousAppointmentAssignment: repair a missing link only when there is exactly one match. */
function unambiguousAppointmentAssignment(appointment: any, candidates: any[]) {
  const participantId = clean(appointment.participantId || appointment.smeId);
  const distinct = [...new Map(candidates.filter((row) => row.id).map((row) => [String(row.id), row])).values()];
  const matches = distinct.filter((candidate) => {
    if (!participantId || !appointment.interventionId) return false;
    if (!assignmentCanOwnAppointment(appointment, candidate, { requireScheduledDate: true })) return false;
    return clean(candidate.subInterventionId) === clean(appointment.subInterventionId);
  });
  return matches.length === 1 ? matches[0] : null;
}

async function resolveLinkedAssignments(rows: Array<Record<string, any>>) {
  const assignments = new Map<string, any>();
  const load = async (id: string) => {
    if (!assignments.has(id)) {
      const snapshot = await db.collection("assignedInterventions").doc(id).get();
      if (snapshot.exists) assignments.set(id, { id, ...snapshot.data() });
    }
    return assignments.get(id) || null;
  };
  const linkedByAppointmentId = new Map<string, string>();
  const repairedAppointmentIds: string[] = [];
  const orphanAppointmentIds: string[] = [];
  for (const row of rows) {
    const directId = clean(row.assignedInterventionId);
    const direct = directId ? await load(directId) : null;
    if (direct && assignmentCanOwnAppointment(row, direct)) {
      linkedByAppointmentId.set(row.id, directId);
      continue;
    }
    if (!row.participantId || !row.interventionId) {
      orphanAppointmentIds.push(row.id);
      continue;
    }
    const candidates = (await db.collection("assignedInterventions").where("participantId", "==", row.participantId).get()).docs
      .map((doc) => ({ id: doc.id, ...doc.data() }));
    const replacement = unambiguousAppointmentAssignment(row, candidates);
    if (!replacement) {
      orphanAppointmentIds.push(row.id);
      continue;
    }
    assignments.set(replacement.id, replacement);
    linkedByAppointmentId.set(row.id, replacement.id);
    repairedAppointmentIds.push(row.id);
  }
  return { linkedByAppointmentId, assignmentIds: Array.from(new Set(linkedByAppointmentId.values())), assignments, orphanAppointmentIds };
}

const isCatchingUp = (assignment: any) =>
  assignment?.catchUp?.status === "active" && lower(assignment?.assigneeCompletionStatus) !== "completed";
const groupKeyOf = (assignment: any) => (assignment && !isCatchingUp(assignment) ? clean(assignment.groupKey) : "");
const groupDeliveryRef = (groupKey: string) => db.collection("groupInterventionDeliveries").doc(encodeURIComponent(clean(groupKey)));
const normalizePointList = (value: any): string[] =>
  Array.from(new Set((Array.isArray(value) ? value : [value]).map((item) => clean(item)).filter(Boolean)));

/* ------------------------------------------------------------------ submit */

/** Writes the coverage exactly as the appointments page's saveCoverage does. */
export async function coverageSubmit(identity: StaffIdentity, payload: any): Promise<GatewayResult> {
  const draft = await currentDraft(identity);
  if (!draft || draft.sessionId !== clean(payload.sessionId)) return fail(404, "no_coverage_in_progress");
  const session = await ownedSession(identity, draft.sessionId);
  if ("error" in session) return sessionError(session.error!);
  if (session.training) return fail(409, "training_coverage_on_web");
  if (nextStep(draft, session.rows).step !== "confirm") return fail(400, "coverage_incomplete");

  const { data, rows } = session;
  const sessionRef = session.snapshot.ref;
  const heldBool = draft.held === true;
  const isGroupCoverage = rows.length > 1;
  const title = clean(data.title) || clean(data.interventionTitle) || "Session";
  const attendanceByParticipant = isGroupCoverage
    ? rows.map((row) => ({
      participantId: row.participantId,
      participantName: row.participantName,
      participantEmail: lower(row.smeEmail),
      outcome: draft.attendance[row.id],
    }))
    : [];
  const groupOutcomes = attendanceByParticipant.map((item) => item.outcome).filter(Boolean);
  const smeAttendance = isGroupCoverage
    ? groupOutcomes.length && groupOutcomes.every((outcome) => outcome === "attended")
      ? "attended"
      : groupOutcomes.some((outcome) => outcome === "attended")
        ? "partially_attended"
        : groupOutcomes.length && groupOutcomes.every((outcome) => outcome === "no_show") ? "no_show" : "unverified"
    : draft.attendance[rows[0].id] || "unverified";
  const smeParticipated = smeAttendance === "attended" || smeAttendance === "partially_attended";
  const notes = heldBool ? clean(draft.summary) : "";
  const coveredPoints = notes ? [notes] : [];
  const plannedCoverage = normalizePointList(data.plannedCoverage || []);

  const linked = await resolveLinkedAssignments(rows);
  if (linked.orphanAppointmentIds.length) return fail(409, "assignment_not_linked");
  if (rows.length + linked.assignmentIds.length > 450) return fail(409, "coverage_too_large");

  const outcomeFor = (row: Record<string, any>): Outcome | "unverified" => (heldBool ? draft.attendance[row.id] || "unverified" : "unverified");
  const progressInfo = new Map<string, { outcome: string; attendedCount: number; plannedSessions: number; reachedPlan: boolean }>();
  for (const id of linked.assignmentIds) {
    const row = rows.find((item) => linked.linkedByAppointmentId.get(item.id) === id)!;
    const outcome = outcomeFor(row);
    const prior = (linked.assignments.get(id)?.sessionAttendanceByAppointment || {}) as Record<string, { outcome?: string }>;
    const attendedCount = Object.entries(prior).filter(([apptId, record]) => apptId !== row.id && record?.outcome === "attended").length +
      (outcome === "attended" ? 1 : 0);
    const plannedSessions = Math.max(1, Number(linked.assignments.get(id)?.plannedSessions) || 1);
    progressInfo.set(id, { outcome, attendedCount, plannedSessions, reachedPlan: attendedCount >= plannedSessions });
  }

  // A grouped intervention is one delivery: its progress lives on the shared group record.
  const sharedGroupKey = linked.assignmentIds.map((id) => groupKeyOf(linked.assignments.get(id))).find(Boolean) || "";
  const groupDelivery = sharedGroupKey ? (await groupDeliveryRef(sharedGroupKey).get()).data() as any : null;
  const groupAlreadyCounted = ((groupDelivery?.progressUpdates || []) as any[]).some((update) => clean(update?.appointmentSessionId) === sessionRef.id);
  const groupPlanned = Math.max(1, Number(groupDelivery?.plannedSessions) ||
    Math.max(1, ...linked.assignmentIds.map((id) => Number(linked.assignments.get(id)?.plannedSessions) || 1)));
  const groupHeld = Number(groupDelivery?.sessionsCompleted || 0) + (heldBool && smeParticipated && !groupAlreadyCounted ? 1 : 0);
  const groupProgress = sharedGroupKey
    ? Math.max(Number(groupDelivery?.progress || 0), Math.min(100, Math.round((groupHeld / groupPlanned) * 100)))
    : 0;
  const completionIds = linked.assignmentIds.filter((id) => !(sharedGroupKey && isCatchingUp(linked.assignments.get(id))));
  const completionRequested = heldBool && smeParticipated && completionIds.length > 0 &&
    (sharedGroupKey ? groupProgress >= 100 : Array.from(progressInfo.values()).some((info) => info.reachedPlan));

  const now = admin.firestore.Timestamp.now();
  const recordedBy = identity.uid || identity.email || identity.id;
  const entry: Record<string, unknown> = {
    held: heldBool,
    ...(heldBool ? { smeAttendance } : {}),
    title,
    plannedCoverage,
    coveredPoints: heldBool && smeParticipated ? coveredPoints : [],
    photos: [],
    ...(heldBool ? {} : { notHeldReasonCategory: draft.notHeldReason }),
    reasonNotHeld: heldBool ? "" : draft.reasonNotHeld || "",
    notes,
    ...(isGroupCoverage ? { attendanceByParticipant } : {}),
    createdAt: now,
    createdByEmail: identity.email || "",
    createdByName: identity.name || "",
    createdVia: "whatsapp",
    ...(completionRequested ? { completionRequired: true, completionAssignmentIds: completionIds, ...(sharedGroupKey ? { completionGroupKey: sharedGroupKey } : {}) } : {}),
  };
  const rowPatch = heldBool
    ? { status: "completed", completedAt: now, updatedAt: now }
    : { status: "scheduled", completedAt: null, updatedAt: now };
  const attendedParticipantIds = new Set(attendanceByParticipant.filter((item) => item.outcome === "attended").map((item) => item.participantId));
  const progressingAssignmentIds = new Set(rows
    .filter((row) => !isGroupCoverage || attendedParticipantIds.has(row.participantId))
    .map((row) => linked.linkedByAppointmentId.get(row.id))
    .filter(Boolean) as string[]);

  const batch = db.batch();
  batch.update(sessionRef, {
    title,
    plannedCoverage,
    coverage: {
      held: heldBool,
      outcomeSummary: heldBool ? notes : null,
      actions: [],
      nextFocus: null,
      coveredPoints: heldBool ? coveredPoints : [],
      photos: [],
      reasonNotHeld: heldBool ? null : draft.reasonNotHeld || null,
      recordedAt: now,
      recordedById: recordedBy,
      smeAttendance: isGroupCoverage ? null : smeAttendance,
      attendanceByParticipant: isGroupCoverage ? attendanceByParticipant : [],
      completionRequired: completionRequested,
      completionAssignmentIds: completionRequested ? completionIds : [],
      completionGroupKey: completionRequested ? sharedGroupKey || null : null,
      ...(heldBool ? {} : { notHeldReasonCategory: draft.notHeldReason }),
      recordedVia: "whatsapp",
    },
    status: heldBool ? "completed" : "scheduled",
    ...(heldBool ? { completedAt: now } : {}),
    updatedAt: now,
  });

  for (const row of rows) {
    const outcome = outcomeFor(row);
    const repairedId = linked.linkedByAppointmentId.get(row.id);
    batch.update(db.collection("appointments").doc(row.id), {
      ...rowPatch,
      attendance: {
        ...(row.attendance || {}),
        status: outcome === "attended" ? "attended" : outcome === "no_show" ? "absent" : row.attendance?.status || "expected",
      },
      ...(repairedId && repairedId !== row.assignedInterventionId ? { assignedInterventionId: repairedId, assignmentLinkRepairedAt: now } : {}),
    });
  }

  for (const id of linked.assignmentIds) {
    const row = rows.find((item) => linked.linkedByAppointmentId.get(item.id) === id)!;
    const info = progressInfo.get(id)!;
    const assignment = linked.assignments.get(id);
    const sessionAttendanceRecord = {
      appointmentId: row.id,
      groupAppointmentId: rows[0].id,
      date: row.date,
      title,
      outcome: info.outcome,
      held: heldBool,
      coveredPoints: info.outcome === "attended" ? coveredPoints : [],
      notes,
      recordedAt: now,
      recordedByEmail: identity.email || "",
    };
    const existingProgress = Math.max(
      Number(assignment?.computedProgress || 0),
      Number(assignment?.progress || 0),
      Number(assignment?.deliveryWorkProgress || 0),
      ...((assignment?.progressUpdates || []) as any[]).map((update) => Number(update?.computedProgress || update?.deliveryWorkProgress || 0)),
    );
    const sessionMilestoneProgress = Math.min(100, (info.attendedCount / info.plannedSessions) * 100);
    const isSessionTracked = !assignment?.target?.mode || assignment.target.mode === "sessions";
    const derivedProgress = Math.min(100, isSessionTracked ? sessionMilestoneProgress : Math.max(existingProgress, sessionMilestoneProgress));
    const shouldTrack = heldBool && info.outcome === "attended" && progressingAssignmentIds.has(id) && derivedProgress > 0;
    const alreadyLogged = ((assignment?.progressUpdates || []) as any[])
      .some((update) => update?.source === "appointment" && clean(update?.appointmentId) === rows[0].id);
    const isSharedGroupMember = !!sharedGroupKey && groupKeyOf(assignment) === sharedGroupKey;
    const progressPatch = shouldTrack && isSharedGroupMember
      ? { "tracking.sessionsLogged": info.attendedCount }
      : shouldTrack && alreadyLogged
        ? { "tracking.sessionsLogged": info.attendedCount, computedProgress: derivedProgress }
        : shouldTrack
          ? {
            "tracking.sessionsLogged": info.attendedCount,
            progressUpdates: admin.firestore.FieldValue.arrayUnion({
              by: recordedBy,
              source: "appointment",
              appointmentId: rows[0].id,
              note: notes || coveredPoints.join("; "),
              createdAt: now,
              resources: [],
              computedProgress: derivedProgress,
            }),
            computedProgress: derivedProgress,
          }
          : {};
    batch.update(db.collection("assignedInterventions").doc(id), {
      lastSessionCoverage: entry,
      lastAppointmentId: rows[0].id,
      lastAppointmentAt: now,
      [`sessionAttendanceByAppointment.${row.id}`]: sessionAttendanceRecord,
      updatedAt: now,
      ...progressPatch,
    });
  }

  if (sharedGroupKey && heldBool && smeParticipated && !groupAlreadyCounted) {
    batch.set(groupDeliveryRef(sharedGroupKey), {
      groupKey: sharedGroupKey,
      progress: groupProgress,
      deliveryStatus: groupProgress >= 100 ? "completed" : "in_progress",
      sessionsCompleted: groupHeld,
      plannedSessions: groupPlanned,
      progressUpdates: admin.firestore.FieldValue.arrayUnion({
        by: recordedBy,
        source: "appointment",
        appointmentSessionId: sessionRef.id,
        appointmentId: rows[0].id,
        note: notes,
        computedProgress: groupProgress,
        createdAt: now,
      }),
      updatedAt: now,
    }, { merge: true });
  }
  batch.delete(drafts.doc(identity.id));
  await batch.commit();

  const progress = sharedGroupKey
    ? groupProgress
    : Math.max(0, ...Array.from(progressInfo.values()).map((info) => Math.round(Math.min(100, (info.attendedCount / info.plannedSessions) * 100))));
  return ok({
    saved: true,
    title,
    held: heldBool,
    attended: rows.filter((row) => draft.attendance[row.id] === "attended").length,
    invited: rows.length,
    progress: heldBool ? progress : null,
    completionRequired: completionRequested,
  });
}
