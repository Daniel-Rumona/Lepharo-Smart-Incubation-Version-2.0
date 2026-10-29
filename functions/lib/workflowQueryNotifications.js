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
exports.onWorkflowQueryChanged = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const departmentRoles_1 = require("./departmentRoles");
const syntheticData_1 = require("./syntheticData");
// Query hand-offs, in-app (and push), the moment they happen:
//   raised      -> the person it's for (usually the facilitator)
//   answered    -> the person who raised it, who accepts or sends it back
//   sent back   -> the facilitator, with what's still needed
//   accepted    -> the facilitator
// SME delivery disputes (type completion-rejected) also keep the department's
// HOD informed, and ask them to decide when the facilitator escalates.
// Types are not in NOTIFICATION_REGISTRY, so these add no extra email.
const REGION = "us-central1";
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
const short = (text, max = 140) => {
    const t = clean(text).replace(/\s+/g, " ");
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const isDispute = (q) => ["completion-rejected", "completion-rejection"].includes(lower(q?.type));
/** Where a person goes to see this query, by their role. */
const linkFor = (role, q, inMonitoring = false) => {
    const r = lower(role).replace(/\s+/g, "");
    const movId = clean(q?.context?.movId || (q?.target?.type === "mov" ? q?.target?.id : ""));
    if (r === "coordinator")
        return q?.target?.type === "assigned-intervention" ? "/coordinator/allocated" : "/coordinator/movs";
    if (r === "incubatee" || r === "beneficiary")
        return "/incubatee/interventions";
    if (r === "projectadmin")
        return "/projectadmin/movs";
    if (r === "operations") {
        if (inMonitoring)
            return "/operations/monitoring/movs";
        return movId ? `/operations/movs?mov=${encodeURIComponent(movId)}` : "/operations/movs";
    }
    return null;
};
/** The raiser's login: their uid, or (for older SME disputes) the SME's account found from the participant. */
async function raiserUid(q) {
    const id = clean(q?.raisedById);
    if (!id)
        return null;
    try {
        if ((await emailShared_1.db.collection("users").doc(id).get()).exists)
            return id;
    }
    catch {
        // fall through
    }
    return (0, inAppNotifications_1.uidForParticipant)(clean(q?.context?.participantId) || id, q?.raisedBy?.email || null);
}
async function disputeHods(q) {
    const assignmentId = clean(q?.target?.id);
    if (!assignmentId)
        return [];
    try {
        const a = (await emailShared_1.db.collection("assignedInterventions").doc(assignmentId).get()).data();
        const departmentId = clean(a?.departmentId);
        return departmentId ? (await (0, movRecipients_1.getDepartmentHods)(departmentId)).uids : [];
    }
    catch (error) {
        logger.warn("workflowQueryNotifications.hodLookupFailed", { assignmentId, error: String(error) });
        return [];
    }
}
exports.onWorkflowQueryChanged = (0, firestore_1.onDocumentWritten)({ document: "workflowQueries/{queryId}", region: REGION }, async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    if (!after)
        return;
    if ((0, syntheticData_1.suppressRecordNotifications)(after, event.params.queryId))
        return;
    const queryId = event.params.queryId;
    const title = clean(after.context?.interventionTitle) || "an intervention";
    const raiserName = clean(after.raisedBy?.name) || (["incubatee", "beneficiary"].includes(lower(after.raisedBy?.role)) ? "The SME" : "Someone");
    const resolverName = clean(after.resolver?.name) || "The facilitator";
    const base = { queryId, programId: clean(after.programId) || null };
    const dispute = isDispute(after);
    const toResolver = (type, message) => (0, inAppNotifications_1.notifyInApp)({ ...base, type, message, link: linkFor(after.resolver?.role || "coordinator", after), recipientIds: [after.resolverId] });
    const toRaiser = async (type, message) => (0, inAppNotifications_1.notifyInApp)({ ...base, type, message, link: linkFor(after.raisedBy?.role || "", after, await (0, departmentRoles_1.isDepartmentInRole)(clean(after.raisedBy?.departmentId), "monitoring")), recipientIds: [await raiserUid(after)] });
    // Raised.
    if (!before) {
        if (dispute) {
            await toResolver("delivery_dispute_raised", `${raiserName} disputes the completion of ${title}: “${short(after.message)}”. Correct it, deliver what's missing, or explain.`);
            await (0, inAppNotifications_1.notifyInApp)({
                ...base,
                type: "delivery_dispute_raised_hod",
                message: `${raiserName} disputes the completion of ${title} by ${resolverName}: “${short(after.message)}”. You'll be asked to decide only if they can't settle it.`,
                recipientIds: await disputeHods(after),
            });
        }
        else {
            await toResolver("query_raised", `${raiserName} raised a query on ${title}: “${short(after.message)}”.`);
        }
        return;
    }
    const was = lower(before.status);
    const now = lower(after.status);
    // Escalated to the HOD by the facilitator.
    if (dispute && !before.escalation && after.escalation && !after.escalation.decision) {
        const hods = await disputeHods(after);
        const movId = clean(after.context?.movId);
        await (0, inAppNotifications_1.notifyInApp)({
            ...base,
            type: "delivery_dispute_escalated",
            message: `Your decision is needed: ${raiserName} disputes ${title}; ${resolverName} says it was delivered as recorded.`,
            link: movId ? `/operations/movs?mov=${encodeURIComponent(movId)}` : "/operations/movs",
            recipientIds: hods,
        });
        await toRaiser("delivery_dispute_escalated_sme", `${resolverName} says ${title} was delivered as recorded. The department's HOD will decide.`);
        return;
    }
    // HOD decision.
    if (dispute && after.escalation?.decision && !before.escalation?.decision) {
        const sme = after.escalation.decision === "sme";
        const notes = short(after.escalation.decisionNotes);
        await toResolver("delivery_dispute_decided", sme
            ? `The HOD sided with the SME on ${title}: “${notes}”. Please redo or correct it.`
            : `The HOD sided with you on ${title}: “${notes}”. The delivery is confirmed.`);
        await toRaiser("delivery_dispute_decided_sme", sme
            ? `The HOD agreed with you on ${title}: “${notes}”. The facilitator will put it right.`
            : `The HOD reviewed your dispute on ${title} and found it was delivered as recorded: “${notes}”.`);
        return;
    }
    // Answered.
    if (now === "answered" && was !== "answered") {
        if (dispute) {
            const outcome = lower(after.response?.outcome);
            if (outcome === "corrected")
                await toRaiser("delivery_dispute_corrected", `${resolverName} corrected ${title}: “${short(after.response?.message)}”. Please check it and confirm.`);
            if (outcome === "redeliver")
                await toRaiser("delivery_dispute_redeliver", `${resolverName} will deliver what's missing on ${title}: “${short(after.response?.message)}”. You'll be asked to confirm afterwards.`);
            // delivered-as-recorded is told via the escalation above.
            return;
        }
        const evidence = after.response?.noNewEvidence ? " (no new evidence)" : "";
        await toRaiser("query_answered", `${resolverName} answered your query on ${title}${evidence}: “${short(after.response?.message)}”. Accept it or send it back.`);
        return;
    }
    // Sent back (answered -> open).
    if (now === "open" && was === "answered") {
        const notes = short(after.lastSentBack?.notes);
        await toResolver(dispute ? "delivery_dispute_rejected_again" : "query_sent_back", dispute
            ? `${raiserName} still disputes ${title}: “${notes}”.`
            : `${raiserName} sent your answer on ${title} back: “${notes}”.`);
        return;
    }
    // Accepted / closed.
    if (now === "resolved" && was !== "resolved") {
        await toResolver(dispute ? "delivery_dispute_closed" : "query_resolved", dispute
            ? `${raiserName} confirmed ${title}. The dispute is closed.`
            : `${raiserName} accepted your answer on ${title}.`);
    }
});
//# sourceMappingURL=workflowQueryNotifications.js.map