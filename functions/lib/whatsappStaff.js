"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStaffAction = exports.STAFF_ACTIONS = exports.resolveStaffByPhone = exports.roleGroupOf = void 0;
const firebase_1 = require("./firebase");
const whatsappCommon_1 = require("./whatsappCommon");
const roleKey = (role) => (0, whatsappCommon_1.clean)(role).toLowerCase().replace(/[\s_-]/g, "");
const roleGroupOf = (role) => {
    const key = roleKey(role);
    if (key === "admin" || key === "systemadmin")
        return "admin";
    if (key === "director")
        return "director";
    if (["operations", "headofdepartment", "headsofdepartment"].includes(key))
        return "hod";
    if (["projectadmin", "coordinator"].includes(key))
        return "coordinator";
    if (key === "receptionist")
        return "receptionist";
    if (["employee", "consultant", "projectmanager", "auxiliary"].includes(key))
        return "employee";
    if (["funder", "government"].includes(key))
        return "external";
    return "unknown";
};
exports.roleGroupOf = roleGroupOf;
const TIME_ZONE = "Africa/Johannesburg";
// South Africa and Zimbabwe do not observe daylight saving, so the offset is fixed.
const TZ_OFFSET = "+02:00";
class UserError extends Error {
    constructor(message, code = "invalid_request") {
        super(message);
        this.code = code;
    }
}
const ok = (body) => ({ status: 200, body: { ok: true, matched: true, ...body } });
const fail = (status, error, extra = {}) => ({
    status,
    body: { ok: false, error, ...extra },
});
const sastParts = (date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};
const todaySast = () => sastParts(new Date()).date;
const validDate = (value) => {
    const text = (0, whatsappCommon_1.clean)(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
        return null;
    const parsed = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
};
const validTime = (value) => {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((0, whatsappCommon_1.clean)(value));
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
};
const shortText = (value, max) => (0, whatsappCommon_1.clean)(value).replace(/\s+/g, " ").slice(0, max);
const formatWhen = (date) => {
    if (!date)
        return null;
    const { date: day, time } = sastParts(date);
    return `${day} ${time}`;
};
/* ------------------------------------------------------------------ identity */
async function resolveStaffByPhone(phoneNumber) {
    const digits = (0, whatsappCommon_1.normalizePhone)(phoneNumber);
    if (digits.length < 8)
        return null;
    const matches = new Map();
    for (const candidate of (0, whatsappCommon_1.candidatePhoneValues)(digits)) {
        for (const field of ["phone", "phoneNumber"]) {
            const snapshot = await firebase_1.db.collection("users").where(field, "==", candidate).limit(3).get();
            snapshot.docs.forEach((doc) => matches.set(doc.id, doc));
        }
    }
    let rows = Array.from(matches.values());
    if (rows.length !== 1) {
        const suffix = digits.slice(-9);
        const snapshot = await firebase_1.db.collection("users").limit(2000).get();
        rows = snapshot.docs.filter((doc) => {
            const data = doc.data() || {};
            return [data.phone, data.phoneNumber].some((stored) => {
                const normalized = (0, whatsappCommon_1.normalizePhone)(stored);
                return suffix.length >= 8 && normalized.length >= 8 && normalized.slice(-9) === suffix;
            });
        });
    }
    if (rows.length !== 1)
        return null;
    const data = rows[0].data() || {};
    const role = (0, whatsappCommon_1.clean)(data.role);
    return {
        kind: "staff",
        id: rows[0].id,
        uid: (0, whatsappCommon_1.clean)(data.uid) || null,
        name: (0, whatsappCommon_1.clean)(data.name) || (0, whatsappCommon_1.clean)(data.displayName) || (0, whatsappCommon_1.clean)(data.email) || "there",
        role,
        roleGroup: (0, exports.roleGroupOf)(role),
        email: (0, whatsappCommon_1.clean)(data.email) || null,
        phoneNumber: (0, whatsappCommon_1.clean)(data.phone || data.phoneNumber) || phoneNumber,
        departmentId: (0, whatsappCommon_1.clean)(data.department || data.departmentId) || null,
        branchId: (0, whatsappCommon_1.clean)(data.assignedBranch || data.branchId) || null,
    };
}
exports.resolveStaffByPhone = resolveStaffByPhone;
const ownerIds = (identity) => Array.from(new Set([identity.id, identity.uid || ""].filter(Boolean)));
const isOwnedBy = (identity, assigneeId) => ownerIds(identity).includes((0, whatsappCommon_1.clean)(assigneeId));
/* -------------------------------------------------------------------- reads */
const tally = (values) => {
    const counts = {};
    values.forEach((value) => {
        const key = value || "unknown";
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
};
async function staffOverview(identity) {
    if (!["admin", "director", "hod"].includes(identity.roleGroup))
        return fail(403, "not_permitted");
    const [participants, assignments, upcoming] = await Promise.all([
        firebase_1.db.collection("participants").count().get(),
        firebase_1.db.collection("assignedInterventions").select("assignmentStatus").get(),
        firebase_1.db.collection("appointmentSessions")
            .where("startAt", ">=", firebase_1.admin.firestore.Timestamp.now())
            .count()
            .get(),
    ]);
    const body = {
        participants: participants.data().count,
        assignments: {
            total: assignments.size,
            byStatus: tally(assignments.docs.map((doc) => (0, whatsappCommon_1.clean)(doc.data().assignmentStatus).toLowerCase())),
        },
        upcomingSessions: upcoming.data().count,
    };
    if (identity.roleGroup !== "hod") {
        const users = await firebase_1.db.collection("users").select("role").get();
        body.users = {
            total: users.size,
            byRole: tally(users.docs.map((doc) => (0, whatsappCommon_1.clean)(doc.data().role).toLowerCase())),
        };
    }
    return ok(body);
}
async function governanceSummary(identity) {
    if (!["admin", "director"].includes(identity.roleGroup))
        return fail(403, "not_permitted");
    const [features, meetings] = await Promise.all([
        firebase_1.db.collection("featureGovernance").get(),
        firebase_1.db.collection("governanceMeetings").get(),
    ]);
    const records = features.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const pipeline = records
        .filter((record) => record.status !== "released")
        .sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0))
        .slice(0, 6)
        .map((record) => ({
        title: (0, whatsappCommon_1.clean)(record.title),
        status: (0, whatsappCommon_1.clean)(record.status),
        progress: Number(record.progress || 0),
        dueDate: (0, whatsappCommon_1.clean)(record.dueDate) || null,
    }));
    let openChallenges = 0;
    let pendingMeetings = 0;
    meetings.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status === "pending")
            pendingMeetings += 1;
        if (Array.isArray(data.challenges)) {
            openChallenges += data.challenges.filter((challenge) => challenge?.status !== "resolved").length;
        }
    });
    return ok({
        features: {
            total: records.length,
            byStatus: tally(records.map((record) => (0, whatsappCommon_1.clean)(record.status))),
        },
        pipeline,
        meetings: { total: meetings.size, pending: pendingMeetings },
        openChallenges,
    });
}
const sessionSummary = (id, data) => {
    const start = data?.startAt?.toDate?.() || null;
    const end = data?.endAt?.toDate?.() || null;
    return {
        id,
        title: (0, whatsappCommon_1.clean)(data?.title) || (0, whatsappCommon_1.clean)(data?.interventionTitle) || "Appointment",
        interventionTitle: (0, whatsappCommon_1.clean)(data?.interventionTitle) || null,
        assigneeName: (0, whatsappCommon_1.clean)(data?.assigneeName) || null,
        start: formatWhen(start),
        endTime: end ? sastParts(end).time : null,
        deliveryMethod: (0, whatsappCommon_1.clean)(data?.deliveryMethod) || null,
        location: (0, whatsappCommon_1.clean)(data?.location) || null,
        meetingLink: (0, whatsappCommon_1.clean)(data?.meetingLink) || null,
        invited: Number(data?.attendanceSummary?.invitedCount || 0),
        status: (0, whatsappCommon_1.clean)(data?.status) || "scheduled",
        sessionType: (0, whatsappCommon_1.clean)(data?.sessionType) || "individual",
    };
};
async function myAppointments(identity) {
    if (identity.roleGroup === "external" || identity.roleGroup === "unknown")
        return fail(403, "not_permitted");
    const now = Date.now();
    let docs;
    const orgWide = ["admin", "director", "receptionist"].includes(identity.roleGroup);
    if (orgWide) {
        const snapshot = await firebase_1.db.collection("appointmentSessions")
            .where("startAt", ">=", firebase_1.admin.firestore.Timestamp.fromMillis(now - 60 * 60 * 1000))
            .orderBy("startAt")
            .limit(60)
            .get();
        docs = snapshot.docs;
    }
    else {
        const found = new Map();
        for (const id of ownerIds(identity)) {
            const snapshot = await firebase_1.db.collection("appointmentSessions").where("assigneeId", "==", id).limit(300).get();
            snapshot.docs.forEach((doc) => found.set(doc.id, doc));
        }
        docs = Array.from(found.values());
    }
    const sessions = docs
        .filter((doc) => {
        const data = doc.data();
        const status = (0, whatsappCommon_1.clean)(data.status).toLowerCase();
        const start = data.startAt?.toMillis?.() ?? 0;
        return !["cancelled", "completed"].includes(status) && start >= now - 60 * 60 * 1000;
    })
        .sort((a, b) => (a.data().startAt?.toMillis?.() ?? 0) - (b.data().startAt?.toMillis?.() ?? 0))
        .filter((doc) => identity.roleGroup !== "receptionist" || sastParts(doc.data().startAt.toDate()).date === todaySast())
        .slice(0, 8)
        .map((doc) => sessionSummary(doc.id, doc.data()));
    return ok({ appointments: sessions, scope: orgWide ? "organisation" : "mine" });
}
const participantLabel = (data) => (0, whatsappCommon_1.clean)(data?.beneficiaryName) || (0, whatsappCommon_1.clean)(data?.participantName) || (0, whatsappCommon_1.clean)(data?.businessName) || (0, whatsappCommon_1.clean)(data?.companyName) || (0, whatsappCommon_1.clean)(data?.name);
async function searchParticipants(identity, query) {
    if (!["admin", "hod", "coordinator", "employee"].includes(identity.roleGroup))
        return fail(403, "not_permitted");
    const needle = shortText(query, 80).toLowerCase();
    if (needle.length < 2)
        return fail(400, "query_required");
    const snapshot = await firebase_1.db.collection("participants").limit(2000).get();
    const matches = snapshot.docs
        .map((doc) => ({ id: doc.id, name: participantLabel(doc.data()) }))
        .filter((row) => row.name && needle.split(" ").every((token) => row.name.toLowerCase().includes(token)))
        .slice(0, 6);
    return ok({ participants: matches });
}
const INACTIVE_ASSIGNMENT = ["cancelled", "completed", "declined"];
async function searchAssignments(identity, payload) {
    if (!["admin", "hod", "coordinator", "employee"].includes(identity.roleGroup))
        return fail(403, "not_permitted");
    const participantId = (0, whatsappCommon_1.clean)(payload.participantId);
    const needle = shortText(payload.query, 80).toLowerCase();
    if (!participantId && needle.length < 2)
        return fail(400, "query_required");
    const fields = [
        "participantId", "participantName", "interventionTitle", "subInterventionTitle", "assigneeId",
        "assigneeName", "assignmentStatus", "type", "groupKey", "cycleKey", "createdAt",
    ];
    let docs = [];
    if (participantId) {
        docs = (await firebase_1.db.collection("assignedInterventions").where("participantId", "==", participantId).limit(100).get()).docs;
    }
    else if (identity.roleGroup === "admin") {
        docs = (await firebase_1.db.collection("assignedInterventions").select(...fields).limit(3000).get()).docs;
    }
    else {
        const found = new Map();
        for (const id of ownerIds(identity)) {
            (await firebase_1.db.collection("assignedInterventions").where("assigneeId", "==", id).limit(500).get()).docs
                .forEach((doc) => found.set(doc.id, doc));
        }
        docs = Array.from(found.values());
    }
    const assignments = docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((row) => !INACTIVE_ASSIGNMENT.includes((0, whatsappCommon_1.clean)(row.assignmentStatus).toLowerCase()))
        .filter((row) => identity.roleGroup === "admin" || isOwnedBy(identity, row.assigneeId))
        .filter((row) => !needle || (0, whatsappCommon_1.clean)(row.participantName).toLowerCase().includes(needle))
        .slice(0, 8)
        .map((row) => ({
        id: row.id,
        participantId: (0, whatsappCommon_1.clean)(row.participantId),
        participantName: (0, whatsappCommon_1.clean)(row.participantName),
        interventionTitle: (0, whatsappCommon_1.clean)(row.interventionTitle),
        subInterventionTitle: (0, whatsappCommon_1.clean)(row.subInterventionTitle) || null,
        assigneeName: (0, whatsappCommon_1.clean)(row.assigneeName) || null,
        cycleKey: (0, whatsappCommon_1.clean)(row.cycleKey) || null,
        grouped: (0, whatsappCommon_1.clean)(row.type) === "grouped" || !!(0, whatsappCommon_1.clean)(row.groupKey),
    }));
    return ok({ assignments });
}
/* ---------------------------------------------------------------- proposals */
const ROLE_CHOICES = ["admin", "director", "operations", "coordinator", "projectadmin", "receptionist", "employee", "incubatee", "funder"];
const DELIVERY_METHODS = ["in_person", "virtual", "telephonically"];
const DELIVERY_LABEL = { in_person: "In person", virtual: "Virtual", telephonically: "Telephonic" };
function validateLogMeeting(identity, raw) {
    if (identity.roleGroup !== "admin")
        throw new UserError("Only system administrators can log governance meetings.", "not_permitted");
    const title = shortText(raw.title, 160);
    const withName = shortText(raw.withName, 120);
    if (!title)
        throw new UserError("What should the meeting be called?");
    if (!withName)
        throw new UserError("Who was the meeting with?");
    const status = raw.status === "pending" ? "pending" : "held";
    const meetingDate = validDate(raw.meetingDate) || todaySast();
    const discussion = shortText(raw.discussion, 1500);
    const challenges = (Array.isArray(raw.challenges) ? raw.challenges : [])
        .map((item) => shortText(item, 300))
        .filter(Boolean)
        .slice(0, 10);
    const summary = [
        `Log a governance meeting`,
        `Title: ${title}`,
        `With: ${withName}`,
        `Date: ${meetingDate} (${status === "held" ? "held" : "still to happen"})`,
        discussion ? `Discussed: ${discussion}` : null,
        challenges.length ? `Challenges: ${challenges.join("; ")}` : null,
    ].filter(Boolean).join("\n");
    return { params: { title, withName, status, meetingDate, discussion, challenges }, summary };
}
function validateLogFeature(identity, raw) {
    if (identity.roleGroup !== "admin")
        throw new UserError("Only system administrators can log features.", "not_permitted");
    const title = shortText(raw.title, 160);
    const description = shortText(raw.description, 1500);
    if (!title)
        throw new UserError("What is the feature called?");
    if (!description)
        throw new UserError("Please give me a short description of the feature.");
    const type = raw.type === "pipeline" ? "pipeline" : "request";
    const dueDate = raw.dueDate ? validDate(raw.dueDate) : null;
    if (raw.dueDate && !dueDate)
        throw new UserError("I couldn't read that target date. Please give it as a date, like 30 September 2026.");
    const roles = Array.from(new Set((Array.isArray(raw.roles) ? raw.roles : []).map((role) => roleKey(role)).filter((role) => ROLE_CHOICES.includes(role))));
    const summary = [
        type === "pipeline" ? "Add a feature to the pipeline" : "Log a feature request",
        `Feature: ${title}`,
        `Description: ${description}`,
        dueDate ? `Target date: ${dueDate}` : null,
        roles.length ? `Affected users: ${roles.join(", ")}` : "Affected users: not set yet (you can add them in the web app)",
    ].filter(Boolean).join("\n");
    return { params: { title, description, type, dueDate, roles }, summary };
}
const safeKey = (value) => encodeURIComponent(value).replace(/%/g, "_");
async function loadSchedule(identity, params) {
    if (!["admin", "hod", "coordinator", "employee"].includes(identity.roleGroup)) {
        throw new UserError("Your role can't set up appointments from WhatsApp.", "not_permitted");
    }
    const assignmentId = (0, whatsappCommon_1.clean)(params.assignedInterventionId);
    const snapshot = assignmentId ? await firebase_1.db.collection("assignedInterventions").doc(assignmentId).get() : null;
    if (!snapshot?.exists)
        throw new UserError("I couldn't find that intervention assignment. Tell me which SME it's for and I'll look it up.");
    const assignment = { id: snapshot.id, ...snapshot.data() };
    if (identity.roleGroup !== "admin" && !isOwnedBy(identity, assignment.assigneeId)) {
        throw new UserError("That intervention is assigned to someone else, so I can't schedule it for you.", "not_permitted");
    }
    if (INACTIVE_ASSIGNMENT.includes((0, whatsappCommon_1.clean)(assignment.assignmentStatus).toLowerCase())) {
        throw new UserError("That intervention is no longer active, so I can't book a session for it.");
    }
    if ((0, whatsappCommon_1.clean)(assignment.type) === "grouped" || (0, whatsappCommon_1.clean)(assignment.groupKey)) {
        throw new UserError("That is a group intervention. Group sessions need to be scheduled in the web app.");
    }
    if (!(0, whatsappCommon_1.clean)(assignment.assigneeId))
        throw new UserError("That intervention has no responsible person yet. Assign one in the web app first.");
    const date = validDate(params.date);
    const time = validTime(params.time);
    if (!date || !time)
        throw new UserError("What date and time should the appointment be? For example 30 September at 10:00.");
    const start = new Date(`${date}T${time}:00${TZ_OFFSET}`);
    const minutes = Math.min(480, Math.max(15, Math.round(Number(params.durationMinutes) || 60)));
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    if (start.getTime() <= Date.now())
        throw new UserError("That time has already passed. Please choose a future date and time.");
    const hour = Number(time.slice(0, 2));
    if (hour < 6 || hour >= 18)
        throw new UserError("Appointments must start between 06:00 and 18:00.");
    const created = assignment.createdAt?.toDate?.() || assignment.assignedAt?.toDate?.() || null;
    if (created && date < sastParts(created).date) {
        throw new UserError("The appointment can't be earlier than the date the intervention was assigned.");
    }
    const programId = (0, whatsappCommon_1.clean)(assignment.programId);
    const sessionId = `session_${safeKey([
        programId, (0, whatsappCommon_1.clean)(assignment.departmentId), (0, whatsappCommon_1.clean)(assignment.interventionId), assignmentId, start.getTime(), (0, whatsappCommon_1.clean)(assignment.assigneeId),
    ].join("__"))}`;
    if ((await firebase_1.db.collection("appointmentSessions").doc(sessionId).get()).exists) {
        throw new UserError("That appointment already exists, so I haven't booked a duplicate.");
    }
    const clash = await firebase_1.db.collection("appointmentSessions").where("assigneeId", "==", (0, whatsappCommon_1.clean)(assignment.assigneeId)).limit(300).get();
    const overlapping = clash.docs.find((doc) => {
        const data = doc.data();
        if (["cancelled", "postponed", "completed"].includes((0, whatsappCommon_1.clean)(data.status).toLowerCase()))
            return false;
        const s = data.startAt?.toMillis?.() ?? 0;
        const e = data.endAt?.toMillis?.() ?? 0;
        return start.getTime() < e && end.getTime() > s;
    });
    if (overlapping) {
        throw new UserError(`${(0, whatsappCommon_1.clean)(assignment.assigneeName) || "The assignee"} already has a session at ${formatWhen(overlapping.data().startAt.toDate())}. Please pick another time.`);
    }
    const participantSnapshot = await firebase_1.db.collection("participants").doc((0, whatsappCommon_1.clean)(assignment.participantId)).get();
    return { assignment, assignmentId, sessionId, start, end, participant: participantSnapshot.exists ? participantSnapshot.data() : {} };
}
async function validateSchedule(identity, raw) {
    const context = await loadSchedule(identity, raw);
    const deliveryMethod = DELIVERY_METHODS.includes((0, whatsappCommon_1.clean)(raw.deliveryMethod)) ? (0, whatsappCommon_1.clean)(raw.deliveryMethod) : "in_person";
    const location = deliveryMethod === "in_person" ? shortText(raw.location, 200) : "";
    const meetingLink = deliveryMethod === "virtual" ? shortText(raw.meetingLink, 400) : "";
    if (meetingLink && !/^https?:\/\//i.test(meetingLink))
        throw new UserError("The meeting link needs to start with http:// or https://.");
    const durationMinutes = Math.round((context.end.getTime() - context.start.getTime()) / 60000);
    const title = shortText(raw.title, 160) || (0, whatsappCommon_1.clean)(context.assignment.interventionTitle) || "Appointment";
    const summary = [
        "Schedule an appointment",
        `SME: ${(0, whatsappCommon_1.clean)(context.assignment.participantName)}`,
        `Intervention: ${(0, whatsappCommon_1.clean)(context.assignment.interventionTitle)}${(0, whatsappCommon_1.clean)(context.assignment.subInterventionTitle) ? ` - ${(0, whatsappCommon_1.clean)(context.assignment.subInterventionTitle)}` : ""}`,
        `When: ${formatWhen(context.start)} (${durationMinutes} min)`,
        `How: ${DELIVERY_LABEL[deliveryMethod]}${location ? ` at ${location}` : ""}${meetingLink ? ` (${meetingLink})` : ""}`,
        `Led by: ${(0, whatsappCommon_1.clean)(context.assignment.assigneeName) || "the assignee"}`,
        "The SME will be invited to confirm.",
    ].join("\n");
    return {
        params: {
            assignedInterventionId: context.assignmentId,
            date: sastParts(context.start).date,
            time: sastParts(context.start).time,
            durationMinutes,
            deliveryMethod,
            location,
            meetingLink,
            title,
        },
        summary,
    };
}
async function executeSchedule(identity, params) {
    const context = await loadSchedule(identity, params);
    const { assignment, participant, sessionId, start, end } = context;
    const deliveryMethod = DELIVERY_METHODS.includes((0, whatsappCommon_1.clean)(params.deliveryMethod)) ? (0, whatsappCommon_1.clean)(params.deliveryMethod) : "in_person";
    const assigneeRole = roleKey(assignment.assigneeRole) === "operations" ? "operations" : "coordinator";
    const assigneeEmail = (0, whatsappCommon_1.clean)(assignment.assigneeEmail).toLowerCase() || null;
    const now = firebase_1.admin.firestore.FieldValue.serverTimestamp();
    const sessionRef = firebase_1.db.collection("appointmentSessions").doc(sessionId);
    const invitationRef = firebase_1.db.collection("appointments").doc(`appointment_${safeKey(`${sessionId}__${(0, whatsappCommon_1.clean)(assignment.participantId)}`)}`);
    await firebase_1.db.runTransaction(async (transaction) => {
        const [existingSession, existingInvitation] = await Promise.all([transaction.get(sessionRef), transaction.get(invitationRef)]);
        if (existingSession.exists || existingInvitation.exists)
            throw new UserError("That appointment already exists, so I haven't booked a duplicate.");
        transaction.set(sessionRef, {
            schemaVersion: 5,
            programId: (0, whatsappCommon_1.clean)(assignment.programId),
            departmentId: (0, whatsappCommon_1.clean)(assignment.departmentId),
            interventionId: (0, whatsappCommon_1.clean)(assignment.interventionId),
            interventionTitle: (0, whatsappCommon_1.clean)(assignment.interventionTitle),
            cycleKey: (0, whatsappCommon_1.clean)(assignment.cycleKey) || null,
            groupKey: null,
            sessionType: "individual",
            assigneeId: (0, whatsappCommon_1.clean)(assignment.assigneeId),
            assigneeName: (0, whatsappCommon_1.clean)(assignment.assigneeName),
            assigneeEmail,
            assigneeRole,
            title: shortText(params.title, 160) || (0, whatsappCommon_1.clean)(assignment.interventionTitle) || "Appointment",
            startAt: firebase_1.admin.firestore.Timestamp.fromDate(start),
            endAt: firebase_1.admin.firestore.Timestamp.fromDate(end),
            deliveryMethod,
            location: deliveryMethod === "in_person" ? (0, whatsappCommon_1.clean)(params.location) || null : null,
            meetingLink: deliveryMethod === "virtual" ? (0, whatsappCommon_1.clean)(params.meetingLink) || null : null,
            plannedCoverage: [],
            coverage: { held: null, outcomeSummary: null, coveredPoints: [], reasonNotHeld: null, recordedAt: null, recordedById: null },
            attendanceSession: null,
            attendanceSummary: { invitedCount: 1, attendedCount: 0, checkedInCount: 0, checkedOutCount: 0 },
            foodMenu: [],
            status: "scheduled",
            createdVia: "whatsapp",
            createdById: identity.id,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        });
        transaction.set(invitationRef, {
            schemaVersion: 5,
            programId: (0, whatsappCommon_1.clean)(assignment.programId),
            departmentId: (0, whatsappCommon_1.clean)(assignment.departmentId),
            assignedInterventionId: context.assignmentId,
            appointmentSessionId: sessionId,
            smeId: (0, whatsappCommon_1.clean)(assignment.participantId),
            smeName: (0, whatsappCommon_1.clean)(assignment.participantName),
            smeEmail: (0, whatsappCommon_1.clean)(participant?.email).toLowerCase() || null,
            interventionId: (0, whatsappCommon_1.clean)(assignment.interventionId),
            interventionTitle: (0, whatsappCommon_1.clean)(assignment.interventionTitle),
            subInterventionId: (0, whatsappCommon_1.clean)(assignment.subInterventionId) || null,
            subInterventionTitle: (0, whatsappCommon_1.clean)(assignment.subInterventionTitle) || null,
            cycleKey: (0, whatsappCommon_1.clean)(assignment.cycleKey) || null,
            assigneeId: (0, whatsappCommon_1.clean)(assignment.assigneeId),
            assigneeName: (0, whatsappCommon_1.clean)(assignment.assigneeName),
            assigneeEmail,
            assigneeRole,
            groupKey: null,
            status: "scheduled",
            smeConfirmation: "pending",
            smeDeclineReason: null,
            attendance: { status: "expected", checkedInAt: null, checkedOutAt: null },
            foodSelections: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        });
    });
    return `Appointment booked for ${(0, whatsappCommon_1.clean)(assignment.participantName)} on ${formatWhen(start)}. They'll be invited to confirm.`;
}
const PROPOSAL_TTL_MS = 30 * 60 * 1000;
async function proposeAction(identity, payload) {
    const kind = (0, whatsappCommon_1.clean)(payload.proposalKind);
    const raw = payload.params && typeof payload.params === "object" ? payload.params : {};
    try {
        let validated;
        if (kind === "log_meeting")
            validated = validateLogMeeting(identity, raw);
        else if (kind === "log_feature")
            validated = validateLogFeature(identity, raw);
        else if (kind === "schedule_appointment")
            validated = await validateSchedule(identity, raw);
        else
            return fail(400, "unsupported_proposal");
        const previous = await firebase_1.db.collection("whatsappAgentProposals")
            .where("userId", "==", identity.id).where("status", "==", "pending").get();
        await Promise.all(previous.docs.map((doc) => doc.ref.update({ status: "superseded" })));
        const ref = await firebase_1.db.collection("whatsappAgentProposals").add({
            userId: identity.id,
            userName: identity.name,
            role: identity.role,
            kind,
            params: validated.params,
            summary: validated.summary,
            status: "pending",
            createdAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: firebase_1.admin.firestore.Timestamp.fromMillis(Date.now() + PROPOSAL_TTL_MS),
        });
        return ok({ proposalId: ref.id, kind, summary: validated.summary });
    }
    catch (error) {
        if (error instanceof UserError)
            return ok({ rejected: true, reason: error.message, code: error.code });
        throw error;
    }
}
async function latestPending(identity) {
    const snapshot = await firebase_1.db.collection("whatsappAgentProposals")
        .where("userId", "==", identity.id).where("status", "==", "pending").get();
    return snapshot.docs
        .sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0))[0] || null;
}
async function executeProposal(identity, kind, params) {
    const now = firebase_1.admin.firestore.FieldValue.serverTimestamp();
    if (kind === "log_meeting") {
        const value = validateLogMeeting(identity, params).params;
        await firebase_1.db.collection("governanceMeetings").add({
            source: "meeting",
            title: value.title,
            status: value.status,
            withName: value.withName,
            meetingDate: value.meetingDate,
            dueDate: "",
            discussion: value.discussion,
            challenges: value.challenges.map((text, index) => ({
                id: `challenge-${Date.now()}-${index}`,
                text,
                status: "open",
            })),
            requests: "",
            relatedFeatureIds: [],
            createdFeatureIds: [],
            createdBy: identity.id,
            createdByName: identity.name,
            createdVia: "whatsapp",
            createdAt: now,
            updatedAt: now,
        });
        return `Meeting logged: "${value.title}" with ${value.withName}. You'll find it under Feature Governance > Meetings.`;
    }
    if (kind === "log_feature") {
        const value = validateLogFeature(identity, params).params;
        await firebase_1.db.collection("featureGovernance").add({
            programSpecific: false,
            programId: null,
            appliesToAllPrograms: false,
            type: value.type,
            title: value.title,
            description: value.description,
            status: value.type === "pipeline" ? "planned" : "submitted",
            progress: 0,
            dueDate: value.dueDate || null,
            completedAt: null,
            audience: { roles: value.roles, allDepartments: false, departmentIds: [], allBranches: false, branchIds: [] },
            meetings: [],
            whatsNew: { published: false, headline: value.title, summary: value.description, imageUrls: [] },
            createdBy: identity.id,
            createdByName: identity.name,
            createdVia: "whatsapp",
            createdAt: now,
            updatedAt: now,
        });
        return `Logged "${value.title}" as ${value.type === "pipeline" ? "a pipeline feature" : "a feature request"}. It's under Feature Governance.`;
    }
    if (kind === "schedule_appointment")
        return executeSchedule(identity, params);
    throw new UserError("I don't know how to do that one.");
}
async function confirmProposal(identity) {
    const pending = await latestPending(identity);
    if (!pending)
        return ok({ found: false, message: "There's nothing waiting for your confirmation." });
    const data = pending.data();
    if ((data.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
        await pending.ref.update({ status: "expired" });
        return ok({ found: false, message: "That request expired. Tell me again and I'll set it up." });
    }
    try {
        const message = await executeProposal(identity, (0, whatsappCommon_1.clean)(data.kind), data.params || {});
        await pending.ref.update({ status: "executed", result: message, executedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
        return ok({ found: true, executed: true, message });
    }
    catch (error) {
        if (error instanceof UserError) {
            await pending.ref.update({ status: "failed", result: error.message });
            return ok({ found: true, executed: false, message: error.message });
        }
        throw error;
    }
}
async function cancelProposal(identity) {
    const pending = await latestPending(identity);
    if (pending)
        await pending.ref.update({ status: "cancelled" });
    return ok({ cancelled: !!pending });
}
/* -------------------------------------------------------------------- state */
const MAX_HISTORY = 8;
async function stateGet(identity) {
    const snapshot = await firebase_1.db.collection("whatsappAgentState").doc(identity.id).get();
    const data = snapshot.data() || {};
    const fresh = (data.updatedAt?.toMillis?.() ?? 0) > Date.now() - 6 * 60 * 60 * 1000;
    return ok({ history: fresh && Array.isArray(data.history) ? data.history : [] });
}
async function stateSet(identity, payload) {
    const history = (Array.isArray(payload.history) ? payload.history : [])
        .slice(-MAX_HISTORY)
        .map((turn) => ({
        role: turn?.role === "assistant" ? "assistant" : "user",
        text: shortText(turn?.text, 700),
    }))
        .filter((turn) => turn.text);
    await firebase_1.db.collection("whatsappAgentState").doc(identity.id).set({
        history,
        updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    return ok({ saved: true });
}
/* ----------------------------------------------------------------- dispatch */
exports.STAFF_ACTIONS = new Set([
    "staff_overview",
    "governance_summary",
    "my_appointments",
    "search_participants",
    "search_assignments",
    "propose_action",
    "confirm_proposal",
    "cancel_proposal",
    "agent_state_get",
    "agent_state_set",
]);
async function handleStaffAction(action, identity, payload) {
    switch (action) {
        case "staff_overview": return staffOverview(identity);
        case "governance_summary": return governanceSummary(identity);
        case "my_appointments": return myAppointments(identity);
        case "search_participants": return searchParticipants(identity, (0, whatsappCommon_1.clean)(payload.query));
        case "search_assignments": return searchAssignments(identity, payload);
        case "propose_action": return proposeAction(identity, payload);
        case "confirm_proposal": return confirmProposal(identity);
        case "cancel_proposal": return cancelProposal(identity);
        case "agent_state_get": return stateGet(identity);
        case "agent_state_set": return stateSet(identity, payload);
        default: return fail(400, "unsupported_action");
    }
}
exports.handleStaffAction = handleStaffAction;
//# sourceMappingURL=whatsappStaff.js.map