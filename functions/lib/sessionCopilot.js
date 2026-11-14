"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionBrief = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const complianceExpiry_1 = require("./complianceExpiry");
const sessionCopilotLogic_1 = require("./sessionCopilotLogic");
/**
 * Session copilot, part one: the prep brief a facilitator reads before a session.
 * It gathers what is already recorded (this intervention's earlier sessions and
 * what was agreed at them, other support the SME is on, outstanding compliance,
 * the risk register, latest revenue and jobs) for one appointment. Read-only.
 * The web app asks the assistant for a few "focus today" bullets from these facts.
 */
const CALLABLE_CORS = [
    "http://localhost:5173",
    "https://lepharosmartinc.co.za",
    "https://www.lepharosmartinc.co.za",
];
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const iso = (value) => {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
};
const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "")
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const DONE = ["completed", "complete", "done", "confirmed", "cancelled", "declined"];
async function viewerOf(uid, email) {
    let snapshot = await firebase_1.db.collection("users").doc(uid).get();
    if (!snapshot.exists && email) {
        const found = await firebase_1.db.collection("users").where("email", "==", email).limit(1).get();
        if (!found.empty)
            snapshot = found.docs[0];
    }
    const data = snapshot.exists ? snapshot.data() || {} : {};
    return {
        role: clean(data.role),
        ids: Array.from(new Set([uid, snapshot.id].filter(Boolean))),
        email: clean(data.email) || email,
        departmentId: clean(data.departmentId),
    };
}
const sessionOf = (data) => {
    const coverage = data?.coverage || {};
    return {
        date: iso(data?.startAt),
        held: typeof coverage.held === "boolean" ? coverage.held : null,
        title: clean(data?.title),
        summary: clean(coverage.outcomeSummary),
        reasonNotHeld: clean(coverage.reasonNotHeld),
        attendance: clean(coverage.smeAttendance),
        actions: Array.isArray(coverage.actions) ? coverage.actions.map(clean).filter(Boolean) : [],
        nextFocus: clean(coverage.nextFocus),
    };
};
exports.sessionBrief = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const appointmentId = clean(request.data?.appointmentId);
    if (!appointmentId)
        throw new https_1.HttpsError("invalid-argument", "Choose an appointment.");
    const appointmentSnapshot = await firebase_1.db.collection("appointments").doc(appointmentId).get();
    if (!appointmentSnapshot.exists)
        throw new https_1.HttpsError("not-found", "That appointment no longer exists.");
    const appointment = appointmentSnapshot.data();
    const viewer = await viewerOf(request.auth.uid, clean(request.auth.token?.email));
    if (!(0, sessionCopilotLogic_1.canSeeBrief)(viewer, {
        assigneeId: clean(appointment.assigneeId),
        assigneeEmail: clean(appointment.assigneeEmail),
        departmentId: clean(appointment.departmentId),
    })) {
        throw new https_1.HttpsError("permission-denied", "Only the session's facilitator, their department or managers can see this brief.");
    }
    const smeId = clean(appointment.smeId);
    const assignmentId = clean(appointment.assignedInterventionId);
    const sessionId = clean(appointment.appointmentSessionId);
    const [sessionSnapshot, assignmentSnapshot, participantSnapshot, siblingsSnapshot, otherAssignmentsSnapshot, riskSnapshot, metricsSnapshot, compliance] = await Promise.all([
        sessionId ? firebase_1.db.collection("appointmentSessions").doc(sessionId).get() : Promise.resolve(null),
        assignmentId ? firebase_1.db.collection("assignedInterventions").doc(assignmentId).get() : Promise.resolve(null),
        smeId ? firebase_1.db.collection("participants").doc(smeId).get() : Promise.resolve(null),
        assignmentId ? firebase_1.db.collection("appointments").where("assignedInterventionId", "==", assignmentId).get() : Promise.resolve(null),
        smeId ? firebase_1.db.collection("assignedInterventions").where("participantId", "==", smeId).get() : Promise.resolve(null),
        smeId ? firebase_1.db.collection("smeRiskSnapshots").doc(smeId).get() : Promise.resolve(null),
        smeId ? firebase_1.db.collection("participantMonthlyMetrics").where("participantId", "==", smeId).get() : Promise.resolve(null),
        smeId ? (0, complianceExpiry_1.outstandingComplianceForParticipant)(smeId).catch(() => null) : Promise.resolve(null),
    ]);
    const session = sessionSnapshot?.exists ? sessionSnapshot.data() : {};
    const assignment = assignmentSnapshot?.exists ? assignmentSnapshot.data() : {};
    const participant = participantSnapshot?.exists ? participantSnapshot.data() : {};
    // Every session of this intervention, read once, for the history.
    const siblingSessionIds = Array.from(new Set((siblingsSnapshot?.docs || []).map((doc) => clean(doc.data().appointmentSessionId)).filter(Boolean)));
    const siblingSessions = siblingSessionIds.length
        ? await firebase_1.db.getAll(...siblingSessionIds.map((id) => firebase_1.db.collection("appointmentSessions").doc(id)))
        : [];
    const history = (0, sessionCopilotLogic_1.summariseHistory)({
        sessionStart: iso(session.startAt) || new Date().toISOString(),
        sessions: siblingSessions.filter((doc) => doc.exists).map((doc) => sessionOf(doc.data())),
        plannedSessions: Number(assignment.plannedSessions) || 1,
        attendanceByAppointment: assignment.sessionAttendanceByAppointment || {},
    });
    // A group session's members, so the facilitator knows who is coming.
    let members = [];
    if (sessionId && clean(appointment.groupKey)) {
        const groupSnapshot = await firebase_1.db.collection("appointments").where("appointmentSessionId", "==", sessionId).get();
        const memberIds = Array.from(new Set(groupSnapshot.docs.map((doc) => clean(doc.data().smeId)).filter(Boolean)));
        const risks = memberIds.length ? await firebase_1.db.getAll(...memberIds.map((id) => firebase_1.db.collection("smeRiskSnapshots").doc(id))) : [];
        const riskOf = new Map(risks.filter((doc) => doc.exists).map((doc) => [doc.id, clean(doc.data().level) || null]));
        members = groupSnapshot.docs.map((doc) => {
            const data = doc.data();
            return { name: clean(data.smeName) || "SME", riskLevel: riskOf.get(clean(data.smeId)) || null };
        }).slice(0, 40);
    }
    const otherInterventions = (otherAssignmentsSnapshot?.docs || [])
        .filter((doc) => doc.id !== assignmentId)
        .map((doc) => doc.data())
        .filter((data) => !DONE.includes(lower(data.assignmentStatus)) && !DONE.includes(lower(data.participantCompletionStatus)))
        .map((data) => clean(data.interventionTitle))
        .filter(Boolean)
        .slice(0, 6);
    const risk = riskSnapshot?.exists ? riskSnapshot.data() : null;
    const metrics = (metricsSnapshot?.docs || []).map((doc) => {
        const data = doc.data();
        const permanent = numberOrNull(data.headcountPermanent);
        const temporary = numberOrNull(data.headcountTemporary);
        return {
            month: clean(data.sourceMonth) || clean(data.month),
            revenue: numberOrNull(data.monthlyRevenue ?? data.revenue),
            jobs: permanent === null && temporary === null ? null : (permanent || 0) + (temporary || 0),
        };
    });
    const complianceItems = Array.isArray(compliance?.items) ? compliance.items : [];
    return {
        appointmentId,
        sme: {
            id: smeId,
            name: clean(appointment.smeName) || clean(participant.beneficiaryName) || clean(participant.companyName) || "SME",
            sector: clean(participant.sector || participant.industry) || null,
        },
        session: {
            title: clean(session.title) || clean(appointment.interventionTitle),
            startAt: iso(session.startAt) || null,
            deliveryMethod: clean(session.deliveryMethod) || null,
            plannedCoverage: Array.isArray(session.plannedCoverage) ? session.plannedCoverage.map(clean).filter(Boolean) : [],
            isGroup: members.length > 1,
        },
        intervention: {
            title: clean(assignment.interventionTitle) || clean(appointment.interventionTitle),
            progress: numberOrNull(assignment.computedProgress ?? assignment.tracking?.progress),
            dueDate: iso(assignment.dueDate) || null,
        },
        history,
        members,
        otherInterventions,
        compliance: { outstanding: complianceItems.length, items: complianceItems.slice(0, 5) },
        risk: risk
            ? {
                level: clean(risk.level) || null,
                trend: clean(risk.trend) || null,
                reasons: (Array.isArray(risk.reasons) ? risk.reasons : []).map((item) => clean(item?.label)).filter(Boolean).slice(0, 3),
            }
            : null,
        business: (0, sessionCopilotLogic_1.businessSnapshot)(metrics),
        declinedBefore: (siblingsSnapshot?.docs || [])
            .filter((doc) => doc.id !== appointmentId && lower(doc.data().smeConfirmation) === "declined").length,
    };
});
//# sourceMappingURL=sessionCopilot.js.map