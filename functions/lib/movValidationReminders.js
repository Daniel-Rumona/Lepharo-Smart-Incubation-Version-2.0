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
exports.movValidationReminderCron = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
const reminderCadence_1 = require("./reminderCadence");
const DAY_MS = 24 * 60 * 60 * 1000;
function asDate(value) {
    if (!value)
        return null;
    if (typeof value?.toDate === "function")
        return value.toDate();
    if (value instanceof Date)
        return value;
    return null;
}
/**
 * Daily nag for movDocuments stuck awaiting validation: `generated` (awaiting
 * CC) or `signed` (awaiting M&E). onMovDocumentWorkflowEmails (emailMov.ts)
 * already sends a one-time email on the transition itself -- this covers the
 * "still not validated N days later" case it doesn't.
 *
 * Recipients are a role group (all CC / all M&E), not one person, so this
 * bypasses the notification email registry (built for one-recipient types)
 * and instead reuses the same broadcast helpers emailMov.ts's one-time
 * version already calls -- getCCRecipients/getMERecipients + buildMovNotificationContent
 * + sendStatusChangeNotification. The in-app notifications doc is written
 * directly with recipientRoles only (no recipientIds), matching how the bell's
 * role-based listener already supports whole-team targeting.
 */
exports.movValidationReminderCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "10 8 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const now = new Date();
    const snapshot = await emailShared_1.db.collection("movDocuments").where("status", "in", ["generated", "signed"]).get();
    let remindersSent = 0;
    for (const movSnap of snapshot.docs) {
        const mov = movSnap.data();
        const movStatus = String(mov.status || "");
        const notifications = mov.workflowNotifications || {};
        const anchor = movStatus === "generated"
            ? asDate(notifications.ccPackSubmittedNotifiedAt)
            : asDate(notifications.mePackSignedNotifiedAt);
        if (!anchor)
            continue; // not yet stamped by the one-time transition trigger -- skip, don't guess a fallback anchor
        const daysSince = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
        const phase = (0, reminderCadence_1.moderateCadencePhase)(daysSince);
        const previous = mov.lastValidationReminder;
        if (!phase || (previous?.status === movStatus && previous?.phase === phase))
            continue;
        const isCcStage = movStatus === "generated";
        const recipients = await (isCcStage ? (0, emailShared_1.getCCRecipients)() : (0, emailShared_1.getMERecipients)());
        if (!recipients.length) {
            logger.warn("movValidationReminderCron.noRecipients", { movId: movSnap.id, status: movStatus });
            continue;
        }
        const statusLabel = isCcStage ? "still awaiting CC validation" : "still awaiting M&E validation";
        const content = (0, emailShared_1.buildMovNotificationContent)({
            statusLabel,
            movId: movSnap.id,
            interventionTitle: mov.interventionTitle,
            beneficiaryName: mov.beneficiaryName,
            facilitatorName: mov.facilitatorName,
        });
        try {
            await (0, emailShared_1.sendStatusChangeNotification)(recipients, content.subject, content.html, content.text);
        }
        catch (error) {
            logger.error("movValidationReminderCron.emailFailed", { movId: movSnap.id, error: String(error) });
        }
        const recipientRole = isCcStage ? "projectadmin" : "operations";
        await emailShared_1.db.collection("notifications").add({
            type: "mov_validation_reminder",
            message: `MOV for ${mov.beneficiaryName || "a participant"} has been ${statusLabel} for ${daysSince} day${daysSince === 1 ? "" : "s"}.`,
            recipientRoles: [recipientRole],
            movId: movSnap.id,
            movStatus,
            reminderPhase: phase,
            link: isCcStage ? "/project-admin" : "/operations",
            createdAt: new Date(),
            readBy: {},
        });
        await movSnap.ref.update({
            lastValidationReminder: {
                status: movStatus,
                phase,
                at: emailShared_1.admin.firestore.Timestamp.now(),
            },
        });
        remindersSent += 1;
    }
    logger.info("movValidationReminderCron.complete", {
        movsScanned: snapshot.size,
        remindersSent,
    });
});
//# sourceMappingURL=movValidationReminders.js.map