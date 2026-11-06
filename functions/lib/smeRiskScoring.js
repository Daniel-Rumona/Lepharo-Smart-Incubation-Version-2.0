"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smeRiskScoringCron = exports.runSmeRiskScoring = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("./firebase");
const syntheticData_1 = require("./syntheticData");
const complianceExpiry_1 = require("./complianceExpiry");
const departmentRoles_1 = require("./departmentRoles");
const inAppNotifications_1 = require("./inAppNotifications");
const smeRiskLogic_1 = require("./smeRiskLogic");
/**
 * Nightly SME early warning. Scores every SME with an accepted application using
 * the register's formula plus the early-warning signals (smeRiskLogic.ts), saves
 * smeRiskSnapshots/{participantId} with the reasons, trend, suggested next step and
 * a short history, and alerts the people who support an SME when it moves up into
 * High or Critical. The snapshot's previous level is the ledger: an SME that stays
 * at the same level is never alerted twice.
 */
const SNAPSHOTS = "smeRiskSnapshots";
const HISTORY_LENGTH = 12;
const BATCH_SIZE = 400;
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const groupBy = (rows, key) => {
    const out = new Map();
    rows.forEach((row) => {
        const id = key(row);
        if (!id)
            return;
        const list = out.get(id) || [];
        list.push(row);
        out.set(id, list);
    });
    return out;
};
const monthOf = (row) => {
    const source = clean(row.sourceMonth);
    if (/^\d{4}-\d{2}$/.test(source))
        return source;
    const date = row.createdAt?.toDate?.();
    return date ? date.toISOString().slice(0, 7) : "";
};
async function runSmeRiskScoring(now = new Date()) {
    const [applicationsSnapshot, participantsSnapshot, assignmentsSnapshot, appointmentsSnapshot, metricsSnapshot, followUpsSnapshot, queriesSnapshot, suppressionsSnapshot, snapshotsSnapshot, usersSnapshot, compliance, romDepartmentIds,] = await Promise.all([
        firebase_1.db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
        firebase_1.db.collection("participants").get(),
        firebase_1.db.collection("assignedInterventions").get(),
        firebase_1.db.collection("appointments").get(),
        firebase_1.db.collection("participantMonthlyMetrics").get(),
        firebase_1.db.collection("outcomeFollowUps").where("dueAt", "<=", firebase_1.admin.firestore.Timestamp.fromDate(now)).get(),
        firebase_1.db.collection("workflowQueries").where("status", "in", ["open", "answered"]).get(),
        firebase_1.db.collection("emailSuppressions").get(),
        firebase_1.db.collection(SNAPSHOTS).get(),
        firebase_1.db.collection("users").get(),
        (0, complianceExpiry_1.loadComplianceContext)(),
        (0, departmentRoles_1.departmentIdsForRole)("rom"),
    ]);
    const participants = new Map(participantsSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const assignments = groupBy(assignmentsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), (row) => clean(row.participantId));
    const appointments = groupBy(appointmentsSnapshot.docs.map((doc) => doc.data()), (row) => clean(row.smeId));
    const metrics = groupBy(metricsSnapshot.docs.map((doc) => doc.data()), (row) => clean(row.participantId));
    const followUps = groupBy(followUpsSnapshot.docs.map((doc) => doc.data()), (row) => clean(row.participantId));
    const queries = groupBy(queriesSnapshot.docs.map((doc) => doc.data()), (row) => clean(row.context?.participantId));
    const bounced = new Set(suppressionsSnapshot.docs.map((doc) => clean(doc.data().participantId)).filter(Boolean));
    const previous = new Map(snapshotsSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const users = usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user) => !["inactive", "disabled", "deleted"].includes(lower(user.status)));
    const uidOf = (user) => clean(user.uid) || user.id;
    const userById = new Map(users.map((user) => [user.id, user]));
    const romHeads = users
        .filter((user) => lower(user.role) === "operations" && romDepartmentIds.includes(clean(user.departmentId)))
        .map(uidOf);
    const programCoordinators = (programId) => users
        .filter((user) => ["coordinator", "projectadmin"].includes(lower(user.role)))
        .filter((user) => Array.isArray(user.assignedPrograms) && user.assignedPrograms.map(clean).includes(programId))
        .map(uidOf);
    // One accepted application per SME: the most recently updated.
    const applicationByParticipant = new Map();
    for (const doc of applicationsSnapshot.docs) {
        const participantId = clean(doc.data().participantId);
        if (!participantId)
            continue;
        const current = applicationByParticipant.get(participantId);
        const time = (snapshot) => snapshot.data().updatedAt?.toMillis?.() ?? snapshot.updateTime.toMillis();
        if (!current || time(doc) > time(current))
            applicationByParticipant.set(participantId, doc);
    }
    const writes = [];
    const alerts = [];
    const dateKey = now.toISOString().slice(0, 10);
    for (const [participantId, applicationDoc] of applicationByParticipant) {
        const application = applicationDoc.data();
        if ((0, syntheticData_1.suppressRecordNotifications)(application, applicationDoc.id))
            continue;
        const participant = participants.get(participantId) || {};
        if ((0, syntheticData_1.suppressRecordNotifications)(participant, participantId))
            continue;
        const programId = clean(application.programId);
        const embedded = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
            ? participant.complianceDocuments
            : Array.isArray(application.complianceDocuments) ? application.complianceDocuments : [];
        const { counts } = (0, complianceExpiry_1.assessComplianceDocuments)([...embedded, ...(compliance.subcollectionDocuments.get(applicationDoc.id) || [])], compliance.requirementsFor(programId), now);
        const smeAssignments = assignments.get(participantId) || [];
        const inputs = (0, smeRiskLogic_1.deriveRiskInputs)({
            assignments: smeAssignments,
            appointments: appointments.get(participantId) || [],
            monthlyRevenue: (metrics.get(participantId) || [])
                .map((row) => ({ month: monthOf(row), revenue: Number(row.monthlyRevenue) }))
                .filter((row) => row.month && Number.isFinite(row.revenue)),
            followUps: followUps.get(participantId) || [],
            openQueries: (queries.get(participantId) || []).length,
            emailBounced: bounced.has(participantId),
            compliance: counts,
        }, now.getTime());
        const result = (0, smeRiskLogic_1.computeRiskScore)(inputs);
        const before = previous.get(participantId);
        const reasons = result.breakdown.filter((item) => item.delta > 0 && item.label !== "Recently serviced");
        const suggestion = (0, smeRiskLogic_1.suggestNextStep)(result);
        // People who support this SME: its active assignees plus the programme's coordinators.
        const assigneeUids = Array.from(new Set(smeAssignments
            .filter((row) => !["cancelled", "completed"].includes(lower(row.assignmentStatus)))
            .map((row) => {
            const user = userById.get(clean(row.assigneeId));
            return user ? uidOf(user) : clean(row.assigneeId);
        })
            .filter(Boolean)));
        const ownerIds = Array.from(new Set([...assigneeUids, ...programCoordinators(programId)]));
        const history = [
            ...(Array.isArray(before?.history) ? before.history : []).filter((entry) => entry?.date !== dateKey),
            { date: dateKey, score: result.score, level: result.level },
        ].slice(-HISTORY_LENGTH);
        writes.push({
            id: participantId,
            data: {
                participantId,
                participantName: clean(participant.beneficiaryName) || clean(participant.companyName) || clean(participant.name) || clean(application.beneficiaryName) || "SME",
                programId: programId || null,
                score: result.score,
                level: result.level,
                previousScore: typeof before?.score === "number" ? before.score : null,
                previousLevel: before?.level || null,
                trend: (0, smeRiskLogic_1.riskTrend)(before?.score, result.score),
                reasons: reasons.map((item) => ({ label: item.label, points: item.delta, driver: item.key || null })),
                suggestion,
                ownerIds,
                inputs,
                history,
                computedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
                // A level only counts as alerted once someone has actually been told.
                alertedLevel: before?.alertedLevel || null,
            },
        });
        // The first score for an SME is a baseline, not news: alerting on it would flood
        // everyone with every already-high SME the first night the job runs.
        if (before && (0, smeRiskLogic_1.shouldAlert)(before.level || null, result.level)) {
            alerts.push({
                participantId,
                name: clean(participant.beneficiaryName) || clean(participant.companyName) || "An SME",
                level: result.level,
                reasons: reasons.slice(0, 3).map((item) => item.label),
                recipients: Array.from(new Set([...ownerIds, ...romHeads])),
                programId,
            });
        }
    }
    for (let offset = 0; offset < writes.length; offset += BATCH_SIZE) {
        const batch = firebase_1.db.batch();
        writes.slice(offset, offset + BATCH_SIZE).forEach(({ id, data }) => batch.set(firebase_1.db.collection(SNAPSHOTS).doc(id), data));
        await batch.commit();
    }
    for (const alert of alerts) {
        await (0, inAppNotifications_1.notifyInApp)({
            type: "sme_risk_rising",
            message: `${alert.name} is now ${alert.level} risk: ${alert.reasons.join("; ")}.`,
            recipientIds: alert.recipients,
            participantId: alert.participantId,
            participantName: alert.name,
            programId: alert.programId || null,
            link: "/operations/participants/risk",
        });
        await firebase_1.db.collection(SNAPSHOTS).doc(alert.participantId).update({ alertedLevel: alert.level, alertedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
    }
    return { scored: writes.length, alerted: alerts.length };
}
exports.runSmeRiskScoring = runSmeRiskScoring;
exports.smeRiskScoringCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "0 6 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
}, async () => {
    const heartbeatRef = firebase_1.db.collection("systemHeartbeats").doc("smeRiskScoringCron");
    try {
        const result = await runSmeRiskScoring();
        logger.info("sme_risk_scoring.done", result);
        await heartbeatRef.set({ lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", ...result }, { merge: true });
    }
    catch (error) {
        logger.error("sme_risk_scoring.failed", { error: String(error) });
        await heartbeatRef.set({ lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: String(error) }, { merge: true });
        throw error;
    }
});
//# sourceMappingURL=smeRiskScoring.js.map