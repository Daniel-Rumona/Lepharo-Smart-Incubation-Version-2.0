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
exports.refreshInterventionImpact = exports.interventionImpactCron = exports.runInterventionImpact = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("./firebase");
const syntheticData_1 = require("./syntheticData");
const impactLogic_1 = require("./impactLogic");
/**
 * Monthly "which interventions are working" job. Reads revenue (QuantNow sync in
 * participantMonthlyMetrics, falling back to the SME's own monthlyPerformance
 * history), SME-confirmed completions and their check-back outcomes, and writes one
 * interventionImpact/{programId}__{interventionId} document per pair with the
 * measured lift (impactLogic.ts). Demo (seeded) data is included and marked
 * `demo: true`, so the method can be proven on the test project and the same code
 * reports real results once real revenue arrives.
 */
const RESULTS = "interventionImpact";
const BATCH_SIZE = 400;
const REFRESH_ROLES = ["system_admin", "superadmin", "director", "operations"];
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const isMonth = (value) => /^\d{4}-\d{2}$/.test(value);
const monthOfDate = (value) => {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 7) : "";
};
const SME_CONFIRMED = ["confirmed", "done", "completed"];
const OUTCOMES = ["achieved", "partial", "not_yet"];
async function runInterventionImpact() {
    const [applicationsSnapshot, participantsSnapshot, metricsSnapshot, historySnapshot, assignmentsSnapshot] = await Promise.all([
        firebase_1.db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"]).get(),
        firebase_1.db.collection("participants").get(),
        firebase_1.db.collection("participantMonthlyMetrics").get(),
        firebase_1.db.collectionGroup("history").get(),
        firebase_1.db.collection("assignedInterventions").get(),
    ]);
    const participants = new Map(participantsSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const revenue = new Map();
    const put = (participantId, month, value, overwrite) => {
        if (!participantId || !isMonth(month) || !Number.isFinite(value))
            return;
        const series = revenue.get(participantId) || {};
        if (overwrite || series[month] === undefined)
            series[month] = value;
        revenue.set(participantId, series);
    };
    // QuantNow is the system of record; the SME's own report only fills gaps.
    metricsSnapshot.docs.forEach((doc) => {
        const row = doc.data();
        const month = isMonth(clean(row.sourceMonth)) ? clean(row.sourceMonth) : monthOfDate(row.createdAt);
        put(clean(row.participantId), month, Number(row.monthlyRevenue), true);
    });
    historySnapshot.docs.forEach((doc) => {
        const parent = doc.ref.parent.parent;
        if (!parent || parent.parent.id !== "monthlyPerformance")
            return;
        const row = doc.data();
        const month = isMonth(clean(row.month)) ? clean(row.month) : monthOfDate(row.createdAt);
        if (row.revenue !== undefined && row.revenue !== null)
            put(parent.id, month, Number(row.revenue), false);
    });
    const smes = [];
    const programOf = new Map();
    for (const doc of applicationsSnapshot.docs) {
        const application = doc.data();
        const participantId = clean(application.participantId);
        const programId = clean(application.programId);
        if (!participantId || !programId || programOf.has(participantId))
            continue;
        programOf.set(participantId, programId);
        const participant = participants.get(participantId) || {};
        smes.push({
            id: participantId,
            programId,
            sector: lower(participant.sector || participant.industry),
            synthetic: (0, syntheticData_1.isSyntheticData)(participant, participantId) || (0, syntheticData_1.isSyntheticData)(application, doc.id),
            revenue: revenue.get(participantId) || {},
        });
    }
    const treatments = [];
    for (const doc of assignmentsSnapshot.docs) {
        const row = doc.data();
        if (!SME_CONFIRMED.includes(lower(row.participantCompletionStatus)))
            continue;
        const participantId = clean(row.participantId);
        const interventionId = clean(row.interventionId);
        const month = monthOfDate(row.completedAt || row.assigneeCompletedAt || row.updatedAt);
        const programId = clean(row.programId) || programOf.get(participantId) || "";
        if (!participantId || !interventionId || !month || !programId)
            continue;
        const outcome = lower(row.outcome?.status);
        treatments.push({
            participantId,
            programId,
            interventionId,
            interventionTitle: clean(row.interventionTitle) || interventionId,
            month,
            outcome: OUTCOMES.includes(outcome) ? outcome : null,
        });
    }
    const results = (0, impactLogic_1.measureAll)(smes, treatments);
    const runId = new Date().toISOString();
    const keep = new Set(results.map((result) => `${result.programId}__${result.interventionId}`));
    const writes = results.map((result) => ({
        ref: firebase_1.db.collection(RESULTS).doc(`${result.programId}__${result.interventionId}`),
        data: { ...result, runId, computedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() },
    }));
    const stale = (await firebase_1.db.collection(RESULTS).get()).docs.filter((doc) => !keep.has(doc.id));
    for (let offset = 0; offset < writes.length; offset += BATCH_SIZE) {
        const batch = firebase_1.db.batch();
        writes.slice(offset, offset + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
        await batch.commit();
    }
    for (let offset = 0; offset < stale.length; offset += BATCH_SIZE) {
        const batch = firebase_1.db.batch();
        stale.slice(offset, offset + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }
    const summary = {
        pairs: results.length,
        reportable: results.filter((result) => result.status === "reportable").length,
        early: results.filter((result) => result.status === "early").length,
        smesWithRevenue: smes.filter((sme) => Object.keys(sme.revenue).length > 0).length,
        completions: treatments.length,
        runId,
    };
    await firebase_1.db.collection("systemHeartbeats").doc("interventionImpact").set({
        lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: "ok",
        ...summary,
    }, { merge: true });
    return summary;
}
exports.runInterventionImpact = runInterventionImpact;
exports.interventionImpactCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "30 5 1 * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
}, async () => {
    try {
        logger.info("intervention_impact.done", await runInterventionImpact());
    }
    catch (error) {
        logger.error("intervention_impact.failed", { error: String(error) });
        await firebase_1.db.collection("systemHeartbeats").doc("interventionImpact").set({
            lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            lastStatus: "failed",
            lastError: String(error),
        }, { merge: true });
        throw error;
    }
});
/** Lets a manager recompute now instead of waiting for the 1st of the month. */
exports.refreshInterventionImpact = (0, https_1.onCall)({
    region: "us-central1",
    cors: ["http://localhost:5173", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"],
    timeoutSeconds: 540,
    memory: "1GiB",
}, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const user = (await firebase_1.db.collection("users").doc(request.auth.uid).get()).data();
    const role = lower(user?.role || request.auth.token?.role).replace(/\s+/g, "_");
    if (!REFRESH_ROLES.includes(role))
        throw new https_1.HttpsError("permission-denied", "Only managers can refresh impact results.");
    return runInterventionImpact();
});
//# sourceMappingURL=interventionImpact.js.map