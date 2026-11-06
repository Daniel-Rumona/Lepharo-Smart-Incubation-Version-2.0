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
exports.onOutcomeFollowUpAnswered = exports.outcomeFollowUpReminderCron = exports.onAssignmentConfirmedScheduleFollowUp = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const syntheticData_1 = require("./syntheticData");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
const workflowEmailFunctions_1 = require("./workflowEmailFunctions");
const whatsappCheckBack_1 = require("./whatsappCheckBack");
const outcomeFollowUpLogic_1 = require("./outcomeFollowUpLogic");
// Outcome check-backs.
//
//   1. When an assignment is confirmed and its intervention asks for a
//      check-back, outcomeFollowUps/{assignmentId} is created with the due
//      date and a frozen copy of what was intended.
//   2. A daily cron reminds the facilitator (in-app + email, both with
//      one-tap answer buttons) once it is due, and the SME too if the HOD
//      asked for that. The HOD is told if it is still unanswered.
//   3. Answers arrive as a patch on the follow-up doc (from the bell, an
//      email link, or the Check-backs page). The trigger below turns each
//      answer into an append-only outcomeAssessments record and updates the
//      summary cached on the assignment. Clients never write assessments.
const REGION = "us-central1";
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const asDate = (value) => {
    if (!value)
        return null;
    if (typeof value?.toDate === "function")
        return value.toDate();
    if (value instanceof Date)
        return value;
    return null;
};
async function resolveAssignee(assignment) {
    const id = clean(assignment.assigneeId);
    let email = lower(assignment.assigneeEmail);
    let name = clean(assignment.assigneeName);
    if (id && !email.includes("@")) {
        for (const collection of ["users", "coordinators", "operationsStaff"]) {
            const snap = await emailShared_1.db.collection(collection).doc(id).get();
            const data = snap.data();
            if (data?.email) {
                email = lower(data.email);
                name = name || clean(data.name || data.fullName);
                break;
            }
        }
    }
    return { email: email.includes("@") ? email : "", name: name || "Facilitator" };
}
async function findIncubateeUid(email) {
    if (!email)
        return null;
    const snap = await emailShared_1.db.collection("users").where("email", "==", lower(email)).limit(5).get();
    const match = snap.docs.find((doc) => lower(doc.data().role) === "incubatee");
    return match ? match.id : null;
}
/** 1. Schedule the check-back when the work is confirmed. */
exports.onAssignmentConfirmedScheduleFollowUp = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "assignedInterventions/{assignmentId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || (0, outcomeFollowUpLogic_1.isConfirmed)(before) || !(0, outcomeFollowUpLogic_1.isConfirmed)(after))
        return;
    const assignmentId = event.params.assignmentId;
    const ref = emailShared_1.db.collection("outcomeFollowUps").doc(assignmentId);
    if ((await ref.get()).exists)
        return;
    const interventionId = clean(after.interventionId);
    if (!interventionId)
        return;
    const intervention = (await emailShared_1.db.collection("interventions").doc(interventionId).get()).data();
    // Prefer what the assignment was created with; fall back to the live definition for older assignments.
    const def = after.definitionSnapshot?.outcomeDef || intervention?.outcomeDef;
    if (!def?.followUp?.required || !clean(def.intendedOutcome))
        return;
    const base = asDate(after.participantConfirmedAt) || asDate(after.completedAt) || new Date();
    const days = (0, outcomeFollowUpLogic_1.followUpDays)(def);
    const assignee = await resolveAssignee(after);
    const smeContact = await (0, workflowEmailFunctions_1.participant)({ participantId: after.participantId });
    await ref.set({
        ...(0, syntheticData_1.syntheticMetadata)(after),
        assignedInterventionId: assignmentId,
        participantId: clean(after.participantId),
        participantName: clean(after.participantName),
        participantEmail: smeContact.email ? lower(smeContact.email) : "",
        interventionId,
        interventionTitle: clean(after.interventionTitle),
        programId: clean(after.programId) || null,
        departmentId: clean(after.departmentId) || clean(intervention?.departmentId) || null,
        assigneeId: clean(after.assigneeId),
        assigneeName: assignee.name,
        assigneeEmail: assignee.email,
        deliverableName: clean(def.deliverable?.name),
        intendedOutcome: clean(def.intendedOutcome),
        outcomeType: clean(def.outcomeType),
        smeCheckIn: def.followUp.smeCheckIn === true,
        afterDays: days,
        dueAt: emailShared_1.admin.firestore.Timestamp.fromDate((0, outcomeFollowUpLogic_1.dueAtFrom)(base, days)),
        status: "scheduled",
        remindersSent: 0,
        lastRemindedAt: null,
        smeNotified: false,
        createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info("outcomeFollowUp.scheduled", { assignmentId, days });
});
const facilitatorActions = () => [
    { actionId: "achieved", label: "Achieved", style: "primary", patch: { answer: "achieved" } },
    { actionId: "partial", label: "Partially", style: "default", patch: { answer: "partial" } },
    { actionId: "not_yet", label: "Not yet", style: "danger", patch: { answer: "not_yet" } },
];
const smeActions = () => [
    { actionId: "yes", label: "Yes, still using it", style: "primary", patch: { smeAnswer: "yes" } },
    { actionId: "partly", label: "Partly", style: "default", patch: { smeAnswer: "partly" } },
    { actionId: "no", label: "No", style: "danger", patch: { smeAnswer: "no" } },
];
/** 2. Daily reminders. */
exports.outcomeFollowUpReminderCron = (0, scheduler_1.onSchedule)({
    region: REGION,
    schedule: "30 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const now = new Date();
    // Single-field range query (no composite index); status is filtered below.
    const snapshot = await emailShared_1.db.collection("outcomeFollowUps")
        .where("dueAt", "<=", emailShared_1.admin.firestore.Timestamp.fromDate(now))
        .get();
    let reminded = 0;
    for (const snap of snapshot.docs) {
        const f = snap.data();
        if ((0, syntheticData_1.suppressRecordNotifications)(f, snap.id))
            continue;
        const state = {
            status: f.status,
            dueAt: asDate(f.dueAt),
            remindersSent: Number(f.remindersSent || 0),
            lastRemindedAt: asDate(f.lastRemindedAt),
        };
        if (f.answer || !(0, outcomeFollowUpLogic_1.shouldRemind)(state, now))
            continue;
        const sent = state.remindersSent + 1;
        const what = clean(f.deliverableName) || clean(f.interventionTitle) || "the intervention";
        const notificationRef = await emailShared_1.db.collection("notifications").add({
            type: "outcome_follow_up",
            message: `Check-back due: has ${clean(f.participantName) || "the SME"} kept up the change from ${clean(f.interventionTitle)}? ${clean(f.intendedOutcome)}`,
            recipientIds: [clean(f.assigneeId)],
            recipientEmail: clean(f.assigneeEmail),
            recipientName: clean(f.assigneeName),
            participantId: clean(f.participantId),
            participantName: clean(f.participantName),
            interventionTitle: clean(f.interventionTitle),
            deliverableName: what,
            intendedOutcome: clean(f.intendedOutcome),
            programId: f.programId || null,
            actionTarget: { collection: "outcomeFollowUps", docId: snap.id },
            actions: facilitatorActions(),
            link: "/coordinator/check-backs",
            reminderNumber: sent,
            createdAt: new Date(),
            readBy: {},
        });
        const patch = {
            status: "due",
            remindersSent: sent,
            lastRemindedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            notificationIds: emailShared_1.admin.firestore.FieldValue.arrayUnion(notificationRef.id),
        };
        if (f.smeCheckIn === true && f.smeNotified !== true && !f.smeAnswer) {
            const smeUid = await findIncubateeUid(f.participantEmail);
            const smeRef = await emailShared_1.db.collection("notifications").add({
                type: "outcome_follow_up_sme",
                message: `A quick question about ${clean(f.interventionTitle)}: are you still using what you put in place?`,
                recipientIds: smeUid ? [smeUid] : [],
                participantId: clean(f.participantId),
                participantName: clean(f.participantName),
                interventionTitle: clean(f.interventionTitle),
                deliverableName: what,
                intendedOutcome: clean(f.intendedOutcome),
                programId: f.programId || null,
                actionTarget: { collection: "outcomeFollowUps", docId: snap.id },
                actions: smeActions(),
                link: "/incubatee/interventions",
                createdAt: new Date(),
                readBy: {},
            });
            patch.smeNotified = true;
            patch.smeNotificationId = smeRef.id;
        }
        if ((0, outcomeFollowUpLogic_1.shouldEscalate)(sent)) {
            const hods = await emailShared_1.db.collection("users")
                .where("departmentId", "==", clean(f.departmentId))
                .get();
            const hodUids = hods.docs
                .filter((d) => lower(d.data().role) === "operations")
                .map((d) => d.id);
            if (hodUids.length) {
                await emailShared_1.db.collection("notifications").add({
                    type: "outcome_follow_up_overdue",
                    message: `Check-back still unanswered after ${sent} reminders: ${clean(f.interventionTitle)} for ${clean(f.participantName)} (facilitator: ${clean(f.assigneeName)}).`,
                    recipientIds: hodUids,
                    participantId: clean(f.participantId),
                    programId: f.programId || null,
                    link: "/coordinator/check-backs",
                    createdAt: new Date(),
                    readBy: {},
                });
            }
        }
        // WhatsApp goes out alongside the in-app notice and email, on the same schedule.
        // It can never block them: failures are logged and recorded, nothing more.
        const whatsapp = await (0, whatsappCheckBack_1.sendCheckBackWhatsApp)(snap.id, f, {
            sendToSme: patch.smeNotified === true,
        });
        if (whatsapp.facilitator !== "skipped") {
            patch.whatsappFacilitatorStatus = whatsapp.facilitator;
            patch.whatsappFacilitatorAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
        }
        if (whatsapp.sme !== "skipped") {
            patch.whatsappSmeStatus = whatsapp.sme;
            patch.whatsappSmeAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
        }
        await snap.ref.update(patch);
        reminded += 1;
    }
    logger.info("outcomeFollowUpReminderCron.complete", { scanned: snapshot.size, reminded });
});
/** 3. Turn answers into append-only assessments and refresh the cached summary. */
exports.onOutcomeFollowUpAnswered = (0, firestore_1.onDocumentUpdated)({ region: REGION, document: "outcomeFollowUps/{followUpId}" }, async (event) => {
    const before = (event.data?.before.data() || {});
    const after = (event.data?.after.data() || {});
    const followUpId = event.params.followUpId;
    const ref = event.data.after.ref;
    const assignmentRef = emailShared_1.db.collection("assignedInterventions").doc(clean(after.assignedInterventionId));
    const base = {
        ...(0, syntheticData_1.syntheticMetadata)(after),
        followUpId,
        assignedInterventionId: clean(after.assignedInterventionId),
        participantId: clean(after.participantId),
        participantName: clean(after.participantName),
        interventionId: clean(after.interventionId),
        interventionTitle: clean(after.interventionTitle),
        programId: after.programId || null,
        departmentId: after.departmentId || null,
        kind: "follow_up",
        at: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!before.answer && (0, outcomeFollowUpLogic_1.isFacilitatorAnswer)(after.answer)) {
        const answeredBy = clean(after.answeredBy) || clean(after.assigneeId);
        const byRole = answeredBy === clean(after.assigneeId) ? "facilitator" : "hod";
        const assignment = ((await assignmentRef.get()).data() || {});
        const confidence = (0, outcomeFollowUpLogic_1.deriveConfidence)({ byRole, hasDeliverable: (0, outcomeFollowUpLogic_1.hasDeliverableFile)(assignment.resources) });
        const evidence = (0, outcomeFollowUpLogic_1.hasDeliverableFile)(assignment.resources)
            ? [{ sourceType: "deliverable", sourceRef: { collection: "assignedInterventions", id: assignmentRef.id } }]
            : [];
        await emailShared_1.db.collection("outcomeAssessments").add({
            ...base,
            assessment: after.answer,
            note: clean(after.answerNote).slice(0, 1000),
            by: answeredBy,
            byRole,
            via: clean(after.answeredVia) || "notification",
            confidence,
            evidence,
        });
        await assignmentRef.set({
            outcome: {
                status: after.answer,
                confidence,
                lastAssessedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
        await ref.update({
            status: "answered",
            answeredAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            answeredBy,
        });
        logger.info("outcomeFollowUp.answered", { followUpId, answer: after.answer, byRole });
    }
    if (!before.smeAnswer && (0, outcomeFollowUpLogic_1.isSmeAnswer)(after.smeAnswer)) {
        await emailShared_1.db.collection("outcomeAssessments").add({
            ...base,
            assessment: (0, outcomeFollowUpLogic_1.smeToAssessment)(after.smeAnswer),
            smeAnswer: after.smeAnswer,
            note: "",
            by: clean(after.participantId),
            byRole: "sme",
            via: "notification",
            confidence: (0, outcomeFollowUpLogic_1.deriveConfidence)({ byRole: "sme", hasDeliverable: false }),
            evidence: [],
        });
        // The SME's view sits beside the facilitator's; it never overwrites it.
        await assignmentRef.set({
            outcome: { smeStatus: (0, outcomeFollowUpLogic_1.smeToAssessment)(after.smeAnswer), smeAssessedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() },
        }, { merge: true });
        await ref.update({ smeAnsweredAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() });
    }
});
//# sourceMappingURL=outcomeFollowUps.js.map