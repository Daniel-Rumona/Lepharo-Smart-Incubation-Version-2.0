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
exports.recalculateDigitalTwin = exports.digitalTwinNightly = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("./firebase");
const rules_1 = require("./twin/rules");
// Digital twin: one record per SME per programme application, recalculated
// every night from data the platform already holds (see the Digital Twin Build
// Plan). Every number comes from ./twin/rules, the same code the web app's live
// twin screen runs, so a saved record and the screen can never disagree.
//
//   digitalTwins/{participantId}_{programId}             today's record
//   digitalTwins/{participantId}_{programId}/days/{date} one record per day
//
// Past days are never edited. A recalculation only replaces today's day record.
// Only this server code writes; firestore.rules lets staff read and no browser write.
const TWINS = "digitalTwins";
const BATCH_WRITE_SIZE = 200; // two writes per twin: current record and its day record
const STAFF_ROLES = new Set(rules_1.TWIN_STAFF_ROLES);
// Same reminder types the Risk Register counts as contact with the SME.
const REMINDER_EMAIL_TYPES = [
    "DEV_PLAN_SME_REMINDER",
    "INTERVENTION_REMINDER",
    "COMPLIANCE_REMINDER",
    "COMPLIANCE_EXPIRY_REMINDER",
];
const clean = (value) => String(value ?? "").trim();
const isAcceptedApplication = (application) => clean(application.applicationStatus || application.decision?.status).toLowerCase() === "accepted";
const docsOf = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const groupBy = (items, keyOf) => {
    const groups = new Map();
    items.forEach((item) => {
        const keys = [].concat(keyOf(item)).map(clean).filter(Boolean);
        keys.forEach((key) => {
            const list = groups.get(key) || [];
            list.push(item);
            groups.set(key, list);
        });
    });
    return groups;
};
/** Firestore rejects undefined; records are plain JSON, so round-trip them. */
const plain = (value) => JSON.parse(JSON.stringify(value));
function sourcesFor(application, index) {
    const participantId = (0, rules_1.getParticipantId)(application);
    return {
        application,
        participant: index.participants.get(participantId) || {},
        program: index.programs.get(clean(application.programId)) || null,
        diagnosticPlans: index.plans.get(participantId) || [],
        assignments: index.assignments.get(participantId) || [],
        departments: index.departments,
        movs: index.movs.get(participantId) || [],
        complianceUploads: index.compliance.get(clean(application.id)) || [],
        challenges: index.challenges.get(participantId) || [],
        reminderEmails: index.reminders.get(participantId) || [],
        monthlyMetrics: index.metrics.get(participantId) || [],
        jobContracts: index.jobs.get(participantId) || [],
    };
}
/** Reads every source collection once and groups by SME, instead of querying per SME. */
async function loadAllSources() {
    const [applications, participants, programs, departments, assignments, plans, movs, compliance, challenges, reminders, metrics, jobs,] = await Promise.all([
        firebase_1.db.collection("applications").get(),
        firebase_1.db.collection("participants").get(),
        firebase_1.db.collection("programs").get(),
        firebase_1.db.collection("departments").get(),
        firebase_1.db.collection("assignedInterventions").get(),
        firebase_1.db.collection("diagnosticPlans").get(),
        firebase_1.db.collection("movDocuments").get(),
        firebase_1.db.collectionGroup("complianceDocuments").get(),
        firebase_1.db.collection("operationalChallenges").get(),
        firebase_1.db.collection("emailLogs").where("type", "in", REMINDER_EMAIL_TYPES).get(),
        firebase_1.db.collection("participantMonthlyMetrics").get(),
        firebase_1.db.collection("hseJobContracts").get(),
    ]);
    const complianceByApplication = new Map();
    compliance.docs.forEach((snapshot) => {
        const applicationRef = snapshot.ref.parent.parent;
        if (!applicationRef || applicationRef.parent.id !== "applications")
            return;
        const list = complianceByApplication.get(applicationRef.id) || [];
        list.push({ id: snapshot.id, ...snapshot.data() });
        complianceByApplication.set(applicationRef.id, list);
    });
    return {
        applications: docsOf(applications).filter(isAcceptedApplication),
        index: {
            participants: new Map(docsOf(participants).map((item) => [item.id, item])),
            programs: new Map(docsOf(programs).map((item) => [item.id, item])),
            departments: docsOf(departments),
            assignments: groupBy(docsOf(assignments), (item) => item.participantId),
            plans: groupBy(docsOf(plans), (item) => item.participantId),
            movs: groupBy(docsOf(movs), (item) => item.participantId || item.smmeId),
            compliance: complianceByApplication,
            challenges: groupBy(docsOf(challenges), (item) => (Array.isArray(item.smeIds) ? item.smeIds : [])),
            reminders: groupBy(docsOf(reminders), (item) => item.participantId),
            metrics: groupBy(docsOf(metrics), (item) => item.participantId),
            jobs: groupBy(docsOf(jobs), (item) => item.participantId),
        },
    };
}
function attachPeers(records, extraPeers = []) {
    const profiles = [...records.map(rules_1.peerProfileOf), ...extraPeers];
    records.forEach((record) => {
        record.peers = (0, rules_1.comparePeers)((0, rules_1.peerProfileOf)(record), profiles);
    });
}
async function writeRecords(records) {
    for (let offset = 0; offset < records.length; offset += BATCH_WRITE_SIZE) {
        const batch = firebase_1.db.batch();
        records.slice(offset, offset + BATCH_WRITE_SIZE).forEach((record) => {
            const data = plain(record);
            const ref = firebase_1.db.collection(TWINS).doc(record.twinId);
            batch.set(ref, { ...data, savedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp() });
            batch.set(ref.collection("days").doc(record.day), data);
        });
        await batch.commit();
    }
}
exports.digitalTwinNightly = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    // After revenueMetricsSyncCron (05:00) so today's revenue is included.
    schedule: "30 5 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 1,
}, async () => {
    const heartbeatRef = firebase_1.db.collection("systemHeartbeats").doc("digitalTwinNightly");
    const now = new Date();
    try {
        const { applications, index } = await loadAllSources();
        const records = [];
        let failed = 0;
        applications.forEach((application) => {
            if (!(0, rules_1.getParticipantId)(application))
                return;
            try {
                records.push((0, rules_1.buildTwinRecord)(sourcesFor(application, index), { now, source: "daily" }));
            }
            catch (error) {
                failed += 1;
                logger.warn("digitalTwinNightly.recordFailed", { applicationId: application.id, error: String(error) });
            }
        });
        attachPeers(records);
        await writeRecords(records);
        const summary = { applications: applications.length, recordsWritten: records.length, failed };
        logger.info("digitalTwinNightly.complete", summary);
        await heartbeatRef.set({ lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", lastError: null, ...summary }, { merge: true });
    }
    catch (error) {
        const message = String(error?.message || error);
        logger.error("digitalTwinNightly.failed", { error: message });
        await heartbeatRef.set({ lastRunAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message }, { merge: true });
    }
});
/** "Recalculate now": recomputes one SME and replaces today's record. Staff only. */
exports.recalculateDigitalTwin = (0, https_1.onCall)({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to recalculate a twin.");
    const caller = (await firebase_1.db.collection("users").doc(request.auth.uid).get()).data() || {};
    const role = clean(caller.role).toLowerCase().replace(/\s+/g, "_");
    if (!STAFF_ROLES.has(role))
        throw new https_1.HttpsError("permission-denied", "The digital twin is for staff only.");
    const applicationId = clean(request.data?.applicationId);
    if (!applicationId)
        throw new https_1.HttpsError("invalid-argument", "applicationId is required.");
    const applicationSnap = await firebase_1.db.collection("applications").doc(applicationId).get();
    if (!applicationSnap.exists)
        throw new https_1.HttpsError("not-found", "Application not found.");
    const application = { id: applicationSnap.id, ...applicationSnap.data() };
    const participantId = (0, rules_1.getParticipantId)(application);
    if (!participantId)
        throw new https_1.HttpsError("failed-precondition", "This application is not linked to an SME yet.");
    const programId = clean(application.programId);
    const byParticipant = (name, field = "participantId") => firebase_1.db.collection(name).where(field, "==", participantId).get().then(docsOf);
    const [participantSnap, programSnap, departments, assignments, plans, movs, uploads, challenges, reminders, metrics, jobs, twins] = await Promise.all([
        firebase_1.db.collection("participants").doc(participantId).get(),
        programId ? firebase_1.db.collection("programs").doc(programId).get() : Promise.resolve(null),
        firebase_1.db.collection("departments").get().then(docsOf),
        byParticipant("assignedInterventions"),
        byParticipant("diagnosticPlans"),
        byParticipant("movDocuments"),
        firebase_1.db.collection("applications").doc(applicationId).collection("complianceDocuments").get().then(docsOf),
        firebase_1.db.collection("operationalChallenges").where("smeIds", "array-contains", participantId).get().then(docsOf),
        byParticipant("emailLogs").then((rows) => rows.filter((row) => REMINDER_EMAIL_TYPES.includes(clean(row.type)))),
        byParticipant("participantMonthlyMetrics"),
        byParticipant("hseJobContracts"),
        firebase_1.db.collection(TWINS).get(),
    ]);
    const record = (0, rules_1.buildTwinRecord)({
        application,
        participant: participantSnap.exists ? { id: participantSnap.id, ...participantSnap.data() } : {},
        program: programSnap && programSnap.exists ? programSnap.data() : null,
        diagnosticPlans: plans,
        assignments,
        departments,
        movs,
        complianceUploads: uploads,
        challenges,
        reminderEmails: reminders,
        monthlyMetrics: metrics,
        jobContracts: jobs,
    }, { now: new Date(), source: "manual" });
    // Peers come from everyone else's latest saved record.
    const otherProfiles = twins.docs
        .filter((item) => item.id !== record.twinId)
        .map((item) => (0, rules_1.peerProfileOf)(item.data()));
    attachPeers([record], otherProfiles);
    await writeRecords([record]);
    return plain(record);
});
//# sourceMappingURL=digitalTwin.js.map