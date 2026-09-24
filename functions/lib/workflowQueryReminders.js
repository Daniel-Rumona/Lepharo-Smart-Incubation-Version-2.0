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
exports.workflowQueryReminderCron = void 0;
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
 * Daily nag for workflowQueries left `open` too long. Writes the exact same
 * notification shape as the manual "remind" button in OperationsDashboard.tsx
 * (same `type`, same message shape) so both sources render identically in
 * the bell and share one email registry entry (notificationEmailRegistry.ts).
 * Phase tracking lives directly on the query doc (`lastReminderPhase`) --
 * no separate ledger collection, unlike compliance's per-document ledger,
 * since a workflowQuery is a single long-lived doc with a stable ref.
 */
exports.workflowQueryReminderCron = (0, scheduler_1.onSchedule)({
    region: "us-central1",
    schedule: "0 8 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
}, async () => {
    const now = new Date();
    const snapshot = await emailShared_1.db.collection("workflowQueries").where("status", "==", "open").get();
    let remindersSent = 0;
    for (const querySnap of snapshot.docs) {
        const query = querySnap.data();
        const anchor = asDate(query.lastReminderAt) || asDate(query.createdAt);
        if (!anchor)
            continue;
        const daysSince = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
        const phase = (0, reminderCadence_1.moderateCadencePhase)(daysSince);
        if (!phase || phase === query.lastReminderPhase)
            continue;
        const resolverId = String(query.resolverId || "").trim();
        if (!resolverId) {
            logger.warn("workflowQueryReminderCron.noResolver", { queryId: querySnap.id });
            continue;
        }
        const resolverRole = String(query.resolver?.role || "consultant").trim();
        await emailShared_1.db.collection("notifications").add({
            type: "workflow-query-reminder",
            message: { [resolverRole]: "Reminder: an open query needs your response." },
            recipientRoles: [resolverRole],
            recipientIds: [resolverId],
            workflowQueryId: querySnap.id,
            programId: query.programId || null,
            reminderPhase: phase,
            createdAt: new Date(),
            readBy: {},
        });
        await querySnap.ref.update({
            lastReminderAt: emailShared_1.admin.firestore.Timestamp.now(),
            lastReminderPhase: phase,
            reminders: emailShared_1.admin.firestore.FieldValue.arrayUnion({
                sentAt: emailShared_1.admin.firestore.Timestamp.now(),
                phase,
                automated: true,
            }),
        });
        remindersSent += 1;
    }
    logger.info("workflowQueryReminderCron.complete", {
        queriesScanned: snapshot.size,
        remindersSent,
    });
});
//# sourceMappingURL=workflowQueryReminders.js.map