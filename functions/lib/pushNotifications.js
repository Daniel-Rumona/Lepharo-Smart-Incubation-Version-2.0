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
exports.onNotificationCreatedPush = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const INVALID_TOKEN_CODES = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
]);
function resolveBody(doc) {
    if (typeof doc.message === "string" && doc.message)
        return doc.message;
    if (doc.message && typeof doc.message === "object") {
        const first = Object.values(doc.message).find(Boolean);
        if (first)
            return String(first);
    }
    return doc.type ? `Update: ${doc.type.replace(/[_-]+/g, " ")}` : "You have a new notification.";
}
/**
 * Pushes to any registered browser (see src/hooks/usePushNotifications.ts) whenever
 * a new doc lands in `notifications` -- the same collection already written by
 * src/routes/directors/directorDashboard.tsx's sendNotification() and read by
 * onInterventionReminderQueuedEmail in workflowEmailFunctions.ts. This only adds a
 * push; it never changes how those existing writers/readers behave.
 */
exports.onNotificationCreatedPush = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "notifications/{notificationId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before || !after)
        return; // only push for brand-new notifications
    const recipientIds = Array.isArray(after.recipientIds)
        ? after.recipientIds.map(String).filter(Boolean)
        : [];
    if (!recipientIds.length)
        return;
    const userSnaps = await emailShared_1.db.getAll(...recipientIds.map((uid) => emailShared_1.db.collection("users").doc(uid)));
    const tokenToUser = new Map();
    userSnaps.forEach((snap) => {
        const tokens = Array.isArray(snap.data()?.fcmTokens) ? snap.data().fcmTokens : [];
        tokens.forEach((token) => tokenToUser.set(token, snap.id));
    });
    const tokens = [...tokenToUser.keys()];
    if (!tokens.length)
        return;
    try {
        const response = await emailShared_1.admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
                title: "Smart Incubation",
                body: resolveBody(after),
            },
        });
        await Promise.all(response.responses.map(async (result, index) => {
            if (result.success)
                return;
            const code = result.error?.code;
            if (!code || !INVALID_TOKEN_CODES.has(code))
                return;
            const badToken = tokens[index];
            const uid = tokenToUser.get(badToken);
            if (!uid)
                return;
            await emailShared_1.db.collection("users").doc(uid).update({
                fcmTokens: emailShared_1.admin.firestore.FieldValue.arrayRemove(badToken),
            });
        }));
    }
    catch (error) {
        logger.error("push_notification.send_failed", { error: String(error) });
    }
});
//# sourceMappingURL=pushNotifications.js.map