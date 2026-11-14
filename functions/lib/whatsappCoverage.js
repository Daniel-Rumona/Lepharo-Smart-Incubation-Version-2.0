"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coverageSubmit = exports.coverageCancel = exports.coverageUpdate = exports.coverageStart = exports.coveragePending = exports.sessionsAwaitingCoverage = void 0;
const firebase_1 = require("./firebase");
const whatsappCommon_1 = require("./whatsappCommon");
const whatsappStaff_1 = require("./whatsappStaff");
const ok = (body) => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status, error) => ({ status, body: { ok: false, error } });
const lower = (value) => (0, whatsappCommon_1.clean)(value).toLowerCase();
const shortText = (value, max) => (0, whatsappCommon_1.clean)(value).replace(/\s+/g, " ").slice(0, max);
const wordCount = (value) => (0, whatsappCommon_1.clean)(value).split(/\s+/).filter(Boolean).length;
const drafts = firebase_1.db.collection("whatsappCoverageDrafts");
const NOT_HELD_REASONS = ["no-show", "cancelled", "other"];
/* --------------------------------------------------------------- sessions */
const isTrainingDepartment = async (departmentId) => {
    // departmentUsesTrainingCoverage: a department inherits it from any ancestor marked isTraining.
    let current = (0, whatsappCommon_1.clean)(departmentId);
    const visited = new Set();
    while (current && !visited.has(current)) {
        visited.add(current);
        const data = (await firebase_1.db.collection("departments").doc(current).get()).data();
        if (!data)
            return false;
        if (data.isTraining === true)
            return true;
        current = (0, whatsappCommon_1.clean)(data.parentDepartmentId || data.parentDeptId);
    }
    return false;
};
const awaitingCoverage = (data, now = Date.now()) => !data.coverage && !["completed", "cancelled"].includes(lower(data.status)) && (data.endAt?.toMillis?.() ?? Infinity) < now;
/** The facilitator's own sessions that have ended and still need coverage, newest first. */
async function sessionsAwaitingCoverage(identity) {
    const found = new Map();
    for (const id of (0, whatsappStaff_1.ownerIds)(identity)) {
        (await firebase_1.db.collection("appointmentSessions").where("assigneeId", "==", id).limit(300).get()).docs
            .forEach((doc) => found.set(doc.id, doc));
    }
    return Array.from(found.values())
        .filter((doc) => awaitingCoverage(doc.data()))
        .sort((a, b) => (b.data().startAt?.toMillis?.() ?? 0) - (a.data().startAt?.toMillis?.() ?? 0));
}
exports.sessionsAwaitingCoverage = sessionsAwaitingCoverage;
/** A session this facilitator may record, with its live invitations as the coverage page sees them. */
async function ownedSession(identity, sessionId) {
    const snapshot = sessionId ? await firebase_1.db.collection("appointmentSessions").doc(sessionId).get() : null;
    const data = snapshot?.data();
    if (!snapshot?.exists || !data || !(0, whatsappStaff_1.ownerIds)(identity).includes((0, whatsappCommon_1.clean)(data.assigneeId)))
        return { error: "session_not_found" };
    if (!awaitingCoverage(data))
        return { error: "coverage_not_due" };
    const invitations = (await firebase_1.db.collection("appointments").where("appointmentSessionId", "==", snapshot.id).get()).docs
        .filter((doc) => lower(doc.data().status) !== "cancelled");
    if (!invitations.length)
        return { error: "no_invitations" };
    const date = (0, whatsappStaff_1.sastParts)(data.startAt.toDate()).date;
    const rows = invitations.map((doc) => {
        const invite = doc.data();
        return {
            ...invite,
            id: doc.id,
            participantId: (0, whatsappCommon_1.clean)(invite.smeId),
            participantName: invite.attendeeName ? `${(0, whatsappCommon_1.clean)(invite.attendeeName)} · ${(0, whatsappCommon_1.clean)(invite.smeName)}` : (0, whatsappCommon_1.clean)(invite.smeName) || "SME",
            date,
        };
    });
    return { snapshot, data, rows, training: await isTrainingDepartment((0, whatsappCommon_1.clean)(data.departmentId || rows[0]?.departmentId)) };
}
const sessionLabel = (data) => {
    const start = data.startAt?.toDate?.();
    const when = start ? `${(0, whatsappStaff_1.sastParts)(start).date} ${(0, whatsappStaff_1.sastParts)(start).time}` : "";
    return { title: (0, whatsappCommon_1.clean)(data.title) || (0, whatsappCommon_1.clean)(data.interventionTitle) || "Session", when };
};
async function coveragePending(identity) {
    const sessions = await sessionsAwaitingCoverage(identity);
    const rows = await Promise.all(sessions.slice(0, 10).map(async (doc) => {
        const data = doc.data();
        const invitations = (await firebase_1.db.collection("appointments").where("appointmentSessionId", "==", doc.id).get()).docs
            .filter((invite) => lower(invite.data().status) !== "cancelled");
        return {
            sessionId: doc.id,
            ...sessionLabel(data),
            smes: invitations.map((invite) => (0, whatsappCommon_1.clean)(invite.data().smeName)).filter(Boolean).slice(0, 4),
            smeCount: invitations.length,
            webOnly: await isTrainingDepartment((0, whatsappCommon_1.clean)(data.departmentId)),
        };
    }));
    return ok({ sessions: rows, total: sessions.length });
}
exports.coveragePending = coveragePending;
function nextStep(draft, rows) {
    if (draft.held === null)
        return { step: "held" };
    if (draft.held === false) {
        if (!draft.notHeldReason)
            return { step: "not_held_reason" };
        return { step: "confirm" };
    }
    const missing = rows.find((row) => !draft.attendance[row.id]);
    if (missing)
        return { step: "attendance", appointmentId: missing.id, participantName: missing.participantName, group: rows.length > 1 };
    if (!draft.summary)
        return { step: "summary" };
    return { step: "confirm" };
}
function draftView(draft, session) {
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
const sessionError = (error) => fail(error === "session_not_found" ? 404 : 409, error);
async function coverageStart(identity, payload) {
    const session = await ownedSession(identity, (0, whatsappCommon_1.clean)(payload.sessionId));
    if ("error" in session)
        return sessionError(session.error);
    if (session.training)
        return fail(409, "training_coverage_on_web");
    const draft = { sessionId: session.snapshot.id, held: null, notHeldReason: null, reasonNotHeld: null, attendance: {}, summary: null };
    await drafts.doc(identity.id).set({ ...draft, updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
    return ok({ draft: draftView(draft, session) });
}
exports.coverageStart = coverageStart;
async function currentDraft(identity) {
    const data = (await drafts.doc(identity.id).get()).data();
    if (!data?.sessionId)
        return null;
    return {
        sessionId: (0, whatsappCommon_1.clean)(data.sessionId),
        held: typeof data.held === "boolean" ? data.held : null,
        notHeldReason: NOT_HELD_REASONS.includes(data.notHeldReason) ? data.notHeldReason : null,
        reasonNotHeld: data.reasonNotHeld ?? null,
        attendance: (data.attendance || {}),
        summary: data.summary ?? null,
    };
}
/** Applies one answer; validates it the way the coverage form does. */
async function coverageUpdate(identity, payload) {
    const draft = await currentDraft(identity);
    if (!draft || draft.sessionId !== (0, whatsappCommon_1.clean)(payload.sessionId))
        return fail(404, "no_coverage_in_progress");
    const session = await ownedSession(identity, draft.sessionId);
    if ("error" in session)
        return sessionError(session.error);
    if (typeof payload.held === "boolean") {
        draft.held = payload.held;
        if (payload.held) {
            draft.notHeldReason = null;
            draft.reasonNotHeld = null;
        }
        else {
            draft.attendance = {};
            draft.summary = null;
        }
    }
    if (payload.notHeldReason !== undefined) {
        const reason = lower(payload.notHeldReason);
        // Rescheduling is not an outcome: the web sends it to Reschedule.
        if (reason === "rescheduled")
            return fail(400, "reschedule_on_web");
        if (!NOT_HELD_REASONS.includes(reason))
            return fail(400, "invalid_reason");
        draft.notHeldReason = reason;
    }
    if (payload.reasonNotHeld !== undefined)
        draft.reasonNotHeld = shortText(payload.reasonNotHeld, 500) || null;
    if (payload.allAttended === true)
        session.rows.forEach((row) => { draft.attendance[row.id] = "attended"; });
    if (payload.attendance && typeof payload.attendance === "object") {
        for (const [appointmentId, outcome] of Object.entries(payload.attendance)) {
            if (!session.rows.some((row) => row.id === appointmentId) || !["attended", "no_show"].includes(String(outcome))) {
                return fail(400, "invalid_attendance");
            }
            draft.attendance[appointmentId] = outcome;
        }
    }
    if (payload.summary !== undefined) {
        const summary = shortText(payload.summary, 2000);
        if (wordCount(summary) < 5)
            return fail(400, "summary_too_short");
        draft.summary = summary;
    }
    await drafts.doc(identity.id).set({ ...draft, updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
    return ok({ draft: draftView(draft, session) });
}
exports.coverageUpdate = coverageUpdate;
async function coverageCancel(identity) {
    await drafts.doc(identity.id).delete();
    return ok({ cancelled: true });
}
exports.coverageCancel = coverageCancel;
/* ------------------------------------------------- assignment links (ported) */
const toDate = (raw) => {
    if (raw == null || raw === "")
        return null;
    const value = typeof raw?.toDate === "function" ? raw.toDate() : typeof raw?.seconds === "number" ? new Date(raw.seconds * 1000) : new Date(raw);
    return Number.isNaN(value.getTime()) ? null : value;
};
const firstDate = (values) => values.map(toDate).find(Boolean) || null;
const assignmentDate = (row) => firstDate([row.assignedAt, row.createdAt]);
const scheduledAppointmentDate = (row) => firstDate([row.schedule?.startAt, row.schedule?.startTime, row.startsAt, row.date, row.startAt, row.startTime]);
const appointmentDate = (row) => firstDate([row.schedule?.startAt, row.schedule?.startTime, row.startsAt, row.date, row.startAt, row.startTime, row.createdAt]);
const dayOf = (date) => (0, whatsappStaff_1.sastParts)(date).date;
/** src/lib/appointmentAssignments.ts assignmentCanOwnAppointment. */
function assignmentCanOwnAppointment(appointment, assignment, options = {}) {
    const participantId = (0, whatsappCommon_1.clean)(appointment.participantId || appointment.smeId);
    const assignmentParticipantId = (0, whatsappCommon_1.clean)(assignment.participantId || assignment.beneficiaryId);
    if (participantId && assignmentParticipantId && participantId !== assignmentParticipantId)
        return false;
    if (appointment.interventionId && (0, whatsappCommon_1.clean)(assignment.interventionId) !== (0, whatsappCommon_1.clean)(appointment.interventionId))
        return false;
    for (const field of ["programId", "departmentId", "cycleKey", "groupKey", "assigneeId", "subInterventionId"]) {
        if (appointment[field] && (0, whatsappCommon_1.clean)(assignment[field]) !== (0, whatsappCommon_1.clean)(appointment[field]))
            return false;
    }
    const strict = scheduledAppointmentDate(appointment);
    if (options.requireScheduledDate && !strict)
        return false;
    const scheduled = options.requireScheduledDate ? strict : appointmentDate(appointment);
    const assigned = assignmentDate(assignment);
    if (scheduled && assigned && dayOf(scheduled) < dayOf(assigned))
        return false;
    return true;
}
/** unambiguousAppointmentAssignment: repair a missing link only when there is exactly one match. */
function unambiguousAppointmentAssignment(appointment, candidates) {
    const participantId = (0, whatsappCommon_1.clean)(appointment.participantId || appointment.smeId);
    const distinct = [...new Map(candidates.filter((row) => row.id).map((row) => [String(row.id), row])).values()];
    const matches = distinct.filter((candidate) => {
        if (!participantId || !appointment.interventionId)
            return false;
        if (!assignmentCanOwnAppointment(appointment, candidate, { requireScheduledDate: true }))
            return false;
        return (0, whatsappCommon_1.clean)(candidate.subInterventionId) === (0, whatsappCommon_1.clean)(appointment.subInterventionId);
    });
    return matches.length === 1 ? matches[0] : null;
}
async function resolveLinkedAssignments(rows) {
    const assignments = new Map();
    const load = async (id) => {
        if (!assignments.has(id)) {
            const snapshot = await firebase_1.db.collection("assignedInterventions").doc(id).get();
            if (snapshot.exists)
                assignments.set(id, { id, ...snapshot.data() });
        }
        return assignments.get(id) || null;
    };
    const linkedByAppointmentId = new Map();
    const repairedAppointmentIds = [];
    const orphanAppointmentIds = [];
    for (const row of rows) {
        const directId = (0, whatsappCommon_1.clean)(row.assignedInterventionId);
        const direct = directId ? await load(directId) : null;
        if (direct && assignmentCanOwnAppointment(row, direct)) {
            linkedByAppointmentId.set(row.id, directId);
            continue;
        }
        if (!row.participantId || !row.interventionId) {
            orphanAppointmentIds.push(row.id);
            continue;
        }
        const candidates = (await firebase_1.db.collection("assignedInterventions").where("participantId", "==", row.participantId).get()).docs
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
const isCatchingUp = (assignment) => assignment?.catchUp?.status === "active" && lower(assignment?.assigneeCompletionStatus) !== "completed";
const groupKeyOf = (assignment) => (assignment && !isCatchingUp(assignment) ? (0, whatsappCommon_1.clean)(assignment.groupKey) : "");
const groupDeliveryRef = (groupKey) => firebase_1.db.collection("groupInterventionDeliveries").doc(encodeURIComponent((0, whatsappCommon_1.clean)(groupKey)));
const normalizePointList = (value) => Array.from(new Set((Array.isArray(value) ? value : [value]).map((item) => (0, whatsappCommon_1.clean)(item)).filter(Boolean)));
/* ------------------------------------------------------------------ submit */
/** Writes the coverage exactly as the appointments page's saveCoverage does. */
async function coverageSubmit(identity, payload) {
    const draft = await currentDraft(identity);
    if (!draft || draft.sessionId !== (0, whatsappCommon_1.clean)(payload.sessionId))
        return fail(404, "no_coverage_in_progress");
    const session = await ownedSession(identity, draft.sessionId);
    if ("error" in session)
        return sessionError(session.error);
    if (session.training)
        return fail(409, "training_coverage_on_web");
    if (nextStep(draft, session.rows).step !== "confirm")
        return fail(400, "coverage_incomplete");
    const { data, rows } = session;
    const sessionRef = session.snapshot.ref;
    const heldBool = draft.held === true;
    const isGroupCoverage = rows.length > 1;
    const title = (0, whatsappCommon_1.clean)(data.title) || (0, whatsappCommon_1.clean)(data.interventionTitle) || "Session";
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
    const notes = heldBool ? (0, whatsappCommon_1.clean)(draft.summary) : "";
    const coveredPoints = notes ? [notes] : [];
    const plannedCoverage = normalizePointList(data.plannedCoverage || []);
    const linked = await resolveLinkedAssignments(rows);
    if (linked.orphanAppointmentIds.length)
        return fail(409, "assignment_not_linked");
    if (rows.length + linked.assignmentIds.length > 450)
        return fail(409, "coverage_too_large");
    const outcomeFor = (row) => (heldBool ? draft.attendance[row.id] || "unverified" : "unverified");
    const progressInfo = new Map();
    for (const id of linked.assignmentIds) {
        const row = rows.find((item) => linked.linkedByAppointmentId.get(item.id) === id);
        const outcome = outcomeFor(row);
        const prior = (linked.assignments.get(id)?.sessionAttendanceByAppointment || {});
        const attendedCount = Object.entries(prior).filter(([apptId, record]) => apptId !== row.id && record?.outcome === "attended").length +
            (outcome === "attended" ? 1 : 0);
        const plannedSessions = Math.max(1, Number(linked.assignments.get(id)?.plannedSessions) || 1);
        progressInfo.set(id, { outcome, attendedCount, plannedSessions, reachedPlan: attendedCount >= plannedSessions });
    }
    // A grouped intervention is one delivery: its progress lives on the shared group record.
    const sharedGroupKey = linked.assignmentIds.map((id) => groupKeyOf(linked.assignments.get(id))).find(Boolean) || "";
    const groupDelivery = sharedGroupKey ? (await groupDeliveryRef(sharedGroupKey).get()).data() : null;
    const groupAlreadyCounted = (groupDelivery?.progressUpdates || []).some((update) => (0, whatsappCommon_1.clean)(update?.appointmentSessionId) === sessionRef.id);
    const groupPlanned = Math.max(1, Number(groupDelivery?.plannedSessions) ||
        Math.max(1, ...linked.assignmentIds.map((id) => Number(linked.assignments.get(id)?.plannedSessions) || 1)));
    const groupHeld = Number(groupDelivery?.sessionsCompleted || 0) + (heldBool && smeParticipated && !groupAlreadyCounted ? 1 : 0);
    const groupProgress = sharedGroupKey
        ? Math.max(Number(groupDelivery?.progress || 0), Math.min(100, Math.round((groupHeld / groupPlanned) * 100)))
        : 0;
    const completionIds = linked.assignmentIds.filter((id) => !(sharedGroupKey && isCatchingUp(linked.assignments.get(id))));
    const completionRequested = heldBool && smeParticipated && completionIds.length > 0 &&
        (sharedGroupKey ? groupProgress >= 100 : Array.from(progressInfo.values()).some((info) => info.reachedPlan));
    const now = firebase_1.admin.firestore.Timestamp.now();
    const recordedBy = identity.uid || identity.email || identity.id;
    const entry = {
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
        .filter(Boolean));
    const batch = firebase_1.db.batch();
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
        batch.update(firebase_1.db.collection("appointments").doc(row.id), {
            ...rowPatch,
            attendance: {
                ...(row.attendance || {}),
                status: outcome === "attended" ? "attended" : outcome === "no_show" ? "absent" : row.attendance?.status || "expected",
            },
            ...(repairedId && repairedId !== row.assignedInterventionId ? { assignedInterventionId: repairedId, assignmentLinkRepairedAt: now } : {}),
        });
    }
    for (const id of linked.assignmentIds) {
        const row = rows.find((item) => linked.linkedByAppointmentId.get(item.id) === id);
        const info = progressInfo.get(id);
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
        const existingProgress = Math.max(Number(assignment?.computedProgress || 0), Number(assignment?.progress || 0), Number(assignment?.deliveryWorkProgress || 0), ...(assignment?.progressUpdates || []).map((update) => Number(update?.computedProgress || update?.deliveryWorkProgress || 0)));
        const sessionMilestoneProgress = Math.min(100, (info.attendedCount / info.plannedSessions) * 100);
        const isSessionTracked = !assignment?.target?.mode || assignment.target.mode === "sessions";
        const derivedProgress = Math.min(100, isSessionTracked ? sessionMilestoneProgress : Math.max(existingProgress, sessionMilestoneProgress));
        const shouldTrack = heldBool && info.outcome === "attended" && progressingAssignmentIds.has(id) && derivedProgress > 0;
        const alreadyLogged = (assignment?.progressUpdates || [])
            .some((update) => update?.source === "appointment" && (0, whatsappCommon_1.clean)(update?.appointmentId) === rows[0].id);
        const isSharedGroupMember = !!sharedGroupKey && groupKeyOf(assignment) === sharedGroupKey;
        const progressPatch = shouldTrack && isSharedGroupMember
            ? { "tracking.sessionsLogged": info.attendedCount }
            : shouldTrack && alreadyLogged
                ? { "tracking.sessionsLogged": info.attendedCount, computedProgress: derivedProgress }
                : shouldTrack
                    ? {
                        "tracking.sessionsLogged": info.attendedCount,
                        progressUpdates: firebase_1.admin.firestore.FieldValue.arrayUnion({
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
        batch.update(firebase_1.db.collection("assignedInterventions").doc(id), {
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
            progressUpdates: firebase_1.admin.firestore.FieldValue.arrayUnion({
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
exports.coverageSubmit = coverageSubmit;
//# sourceMappingURL=whatsappCoverage.js.map