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
exports.proposalDeadlineReminderCron = exports.onProposalWritten = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movRecipients_1 = require("./movRecipients");
const whatsappAlerts_1 = require("./whatsappAlerts");
const syntheticData_1 = require("./syntheticData");
const cronHeartbeat_1 = require("./cronHeartbeat");
const proposalNotificationLogic_1 = require("./proposalNotificationLogic");
// Proposal pipeline notifications. The app writes proposals straight to
// Firestore (src/services/proposalService.ts), so every create, status move
// and team change is caught here in one place; submission deadlines are
// checked once a day. Who hears what lives in proposalNotificationLogic.ts.
const TIME_ZONE = "Africa/Johannesburg";
const SAST_MS = 2 * 60 * 60 * 1000;
const sastDate = (value) => new Date(value.getTime() + SAST_MS).toISOString().slice(0, 10);
const clean = (value) => String(value ?? "").trim();
const escapeHtml = (value) => clean(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const toDate = (value) => {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date : null;
};
/** The people behind a department or centre owner: that department's HODs, or that centre's coordinators. */
async function ownerGroupIds(data) {
    const owner = (0, proposalNotificationLogic_1.ownerTarget)(data);
    if (owner.kind === "department")
        return (await (0, movRecipients_1.getDepartmentHods)(owner.departmentId)).uids;
    if (owner.kind !== "centre")
        return [];
    try {
        const snapshot = await emailShared_1.db.collection("users")
            .where("role", "==", "projectadmin").where("assignedBranch", "==", owner.branchId).get();
        return snapshot.docs.map((doc) => doc.id);
    }
    catch (error) {
        logger.warn("proposalNotifications.centreLookupFailed", { branchId: owner.branchId, error: String(error) });
        return [];
    }
}
/** One message to each recipient on each channel. In-app always; email and WhatsApp only for real (non-seeded) records. */
async function deliver(delivery) {
    const ids = [...new Set(delivery.recipientIds.map(clean).filter(Boolean))];
    if (!ids.length)
        return;
    const snapshots = await emailShared_1.db.getAll(...ids.map((id) => emailShared_1.db.collection("users").doc(id)));
    const people = snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() || {} }))
        .filter((person) => !["inactive", "disabled", "deleted"].includes(clean(person.data.status).toLowerCase()));
    if (!people.length)
        return;
    const path = `/proposals?proposal=${encodeURIComponent(delivery.proposalId)}`;
    await (0, inAppNotifications_1.notifyInApp)({
        type: delivery.type,
        message: `${delivery.headline}. ${delivery.details}`,
        recipientIds: people.map((person) => person.id),
        proposalId: delivery.proposalId,
        link: path,
    });
    if (delivery.quiet)
        return;
    const link = `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}${path}`;
    if (delivery.channels.includes("email")) {
        const emails = people.map((person) => clean(person.data.email).toLowerCase()).filter((email) => email.includes("@"));
        await (0, emailShared_1.sendStatusChangeNotification)(emails, delivery.headline, `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
        <h2 style="color:#1457a6">${escapeHtml(delivery.headline)}</h2>
        <p>${escapeHtml(delivery.details)}</p>
        <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Open the proposal</a></p>
      </div>`, `${delivery.headline}\n${delivery.details}\n${link}`).catch((error) => logger.warn("proposalNotifications.emailFailed", { proposalId: delivery.proposalId, error: String(error) }));
    }
    if (delivery.channels.includes("whatsapp")) {
        for (const person of people) {
            await (0, whatsappAlerts_1.sendWhatsAppAlert)(person.id, {
                name: clean(person.data.name || person.data.fullName),
                headline: delivery.headline.slice(0, 120),
                details: delivery.details.slice(0, 500),
            }, `${delivery.dedupeKey}:${person.id}`);
        }
    }
}
/** The note written with the status change, if the person moving it added one. */
async function latestStatusNote(proposalId, status) {
    try {
        const snapshot = await emailShared_1.db.collection("projectProposals").doc(proposalId).collection("history")
            .orderBy("createdAt", "desc").limit(5).get();
        const entry = snapshot.docs.map((doc) => doc.data()).find((data) => clean(data.toStatus) === status);
        return clean(entry?.note) || null;
    }
    catch (error) {
        logger.warn("proposalNotifications.noteLookupFailed", { proposalId, error: String(error) });
        return null;
    }
}
exports.onProposalWritten = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "projectProposals/{proposalId}" }, async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;
    if (!after)
        return;
    const proposalId = event.params.proposalId;
    try {
        const statusChanged = before && clean(before.status) !== clean(after.status);
        const note = statusChanged ? await latestStatusNote(proposalId, clean(after.status)) : null;
        const events = (0, proposalNotificationLogic_1.proposalEvents)(proposalId, before, after, note);
        if (!events.length)
            return;
        const actor = clean(after.updatedBy?.id || after.createdBy?.id);
        const quiet = (0, syntheticData_1.suppressRecordNotifications)(after, proposalId);
        const group = events.some((item) => item.includeOwnerGroup) ? await ownerGroupIds(after) : [];
        for (const item of events) {
            await deliver({
                proposalId,
                type: `proposal_${item.kind}`,
                recipientIds: [...item.recipientIds, ...(item.includeOwnerGroup ? group : [])].filter((id) => id !== actor),
                channels: item.channels,
                headline: item.headline,
                details: item.details,
                dedupeKey: item.dedupeKey,
                quiet,
            });
        }
    }
    catch (error) {
        logger.error("onProposalWritten.failed", { proposalId, error: String(error) });
    }
});
/**
 * Daily at 07:00: reminds a proposal's team of its submission deadline a week
 * and two days ahead, on the day and the day after, while it is still being
 * prepared. proposalReminderLog makes each reminder go out once per deadline.
 */
exports.proposalDeadlineReminderCron = (0, cronHeartbeat_1.scheduledJob)("proposalDeadlineReminderCron", {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: TIME_ZONE,
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const today = sastDate(new Date());
    const snapshot = await emailShared_1.db.collection("projectProposals").where("status", "in", proposalNotificationLogic_1.PRE_SUBMISSION_STATUSES).get();
    let sent = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const due = toDate(data.submissionDeadline);
        if (!due)
            continue;
        const deadline = sastDate(due);
        const reminder = (0, proposalNotificationLogic_1.deadlineReminder)(data, deadline, today);
        if (!reminder)
            continue;
        try {
            // create() fails when the log entry exists, so a rerun never sends twice.
            await emailShared_1.db.collection("proposalReminderLog").doc(`${doc.id}_${deadline}_${reminder.key}`)
                .create({ proposalId: doc.id, deadline, key: reminder.key, sentAt: new Date() });
        }
        catch {
            continue;
        }
        try {
            const group = await ownerGroupIds(data);
            await deliver({
                proposalId: doc.id,
                type: "proposal_deadline",
                recipientIds: [...(0, proposalNotificationLogic_1.teamMembers)(data).map((member) => member.uid), ...group],
                channels: reminder.channels,
                headline: reminder.headline,
                details: reminder.details,
                dedupeKey: `proposal:${doc.id}:deadline:${deadline}:${reminder.key}`,
                quiet: (0, syntheticData_1.suppressRecordNotifications)(data, doc.id),
            });
            sent += 1;
        }
        catch (error) {
            logger.error("proposalDeadlineReminderCron.failed", { proposalId: doc.id, error: String(error) });
        }
    }
    logger.info("proposalDeadlineReminderCron.done", { checked: snapshot.size, sent });
});
//# sourceMappingURL=proposalNotifications.js.map