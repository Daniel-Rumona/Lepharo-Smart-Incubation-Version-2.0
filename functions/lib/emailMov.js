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
exports.movReminderCron = exports.onMovDocumentWorkflowEmails = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
exports.onMovDocumentWorkflowEmails = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "movDocuments/{movId}" }, async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists)
        return;
    const beforeStatus = before?.exists ? String(before.data().status || "") : "";
    const afterData = after.data();
    const afterStatus = String(afterData.status || "");
    const movId = String(event.params.movId || "");
    const notifications = afterData.workflowNotifications || {};
    if (afterStatus === "generated" && beforeStatus !== "generated" && !notifications.ccPackSubmittedNotifiedAt) {
        const recipients = await (0, emailShared_1.getCCRecipients)();
        if (recipients.length) {
            const content = (0, emailShared_1.buildMovNotificationContent)({
                statusLabel: "submitted",
                movId,
                interventionTitle: afterData.interventionTitle,
                beneficiaryName: afterData.beneficiaryName,
                facilitatorName: afterData.facilitatorName,
            });
            await (0, emailShared_1.sendStatusChangeNotification)(recipients, content.subject, content.html, content.text);
            await after.ref.set({
                workflowNotifications: {
                    ...notifications,
                    ccPackSubmittedNotifiedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        }
    }
    if (afterStatus === "signed" && beforeStatus !== "signed" && !notifications.mePackSignedNotifiedAt) {
        const recipients = await (0, emailShared_1.getMERecipients)();
        if (recipients.length) {
            const content = (0, emailShared_1.buildMovNotificationContent)({
                statusLabel: "signed",
                movId,
                interventionTitle: afterData.interventionTitle,
                beneficiaryName: afterData.beneficiaryName,
                facilitatorName: afterData.facilitatorName,
            });
            await (0, emailShared_1.sendStatusChangeNotification)(recipients, content.subject, content.html, content.text);
            await after.ref.set({
                workflowNotifications: {
                    ...notifications,
                    mePackSignedNotifiedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
                },
            }, { merge: true });
        }
    }
});
/**
 * One daily scheduler replaces the former HOD, CC and M&E scheduler resources.
 * HOD reminders run daily, with CC and M&E reminders added on the 4th and 7th.
 */
exports.movReminderCron = (0, scheduler_1.onSchedule)({ region: "us-central1", schedule: "0 8 * * *", timeZone: "Africa/Johannesburg" }, async () => {
    const dayOfMonth = Number(new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Johannesburg",
        day: "2-digit",
    }).format(new Date()));
    const jobs = [
        {
            type: "HOD",
            recipients: () => (0, emailShared_1.getHODRecipients)(),
            message: "Please submit the previous month’s MOV pack as soon as possible. This reminder runs daily through the month.",
            url: `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/operations`,
        },
    ];
    if (dayOfMonth === 4) {
        jobs.push({
            type: "CC",
            recipients: () => (0, emailShared_1.getCCRecipients)(),
            message: "Please review any MOV packs submitted by HODs for the previous month and progress them accordingly.",
            url: `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/project-admin`,
        });
    }
    if (dayOfMonth === 7) {
        jobs.push({
            type: "M&E",
            recipients: () => (0, emailShared_1.getMERecipients)(),
            message: "Please verify MOVs that have been signed by CCs and complete the M&E review process.",
            url: `${emailShared_1.APP_BASE_URL.replace(/\/$/, "")}/operations`,
        });
    }
    for (const job of jobs) {
        const recipients = await job.recipients();
        if (!recipients.length)
            continue;
        const content = (0, emailShared_1.buildPackReminderEmail)(job.type, job.message, job.url);
        await (0, emailShared_1.sendStatusChangeNotification)(recipients, content.subject, content.html, content.text);
        logger.info("movReminderCron.sent", {
            reminderType: job.type,
            count: recipients.length,
            dayOfMonth,
        });
    }
});
//# sourceMappingURL=emailMov.js.map