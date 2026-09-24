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
exports.onNotificationCreatedEmail = void 0;
const crypto = __importStar(require("crypto"));
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const brevoClient_1 = require("./brevoClient");
const notificationEmailRegistry_1 = require("./notificationEmailRegistry");
const REGION = "us-central1";
const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Same fallback pattern as functions/src/utils/crypto.ts's OAUTH_BASE_URL.
const FUNCTIONS_BASE_URL = process.env.NOTIFICATION_FUNCTIONS_BASE_URL ||
    `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;
/**
 * Mints one single-use, expiring notificationActions/{token} doc per action
 * declared on the notification, and returns a map of actionId -> confirm-page
 * URL for the email template to render as buttons. No-ops (returns {}) if the
 * notification declares no actions or no actionTarget.
 */
async function mintActionLinks(notificationId, after, recipientEmail) {
    const actions = Array.isArray(after.actions) ? after.actions : [];
    const target = after.actionTarget;
    if (!actions.length || !target?.collection || !target?.docId)
        return {};
    const expiresAt = emailShared_1.admin.firestore.Timestamp.fromMillis(Date.now() + ACTION_TOKEN_TTL_MS);
    const links = {};
    const batch = emailShared_1.db.batch();
    for (const action of actions) {
        if (!action?.actionId)
            continue;
        const token = crypto.randomBytes(32).toString("hex");
        const ref = emailShared_1.db.collection("notificationActions").doc(token);
        batch.set(ref, {
            notificationId,
            actionId: action.actionId,
            label: action.label || action.actionId,
            targetCollection: target.collection,
            targetDocId: target.docId,
            patch: action.patch || {},
            recipientEmail,
            allowedUids: Array.isArray(after.recipientIds) ? after.recipientIds : null,
            expiresAt,
            used: false,
            usedAt: null,
            usedByIp: null,
            resultStatus: null,
            createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        links[action.actionId] = `${FUNCTIONS_BASE_URL}/notificationAction?token=${token}`;
    }
    await batch.commit();
    return links;
}
/**
 * Generalized notification -> email fan-out. Supersedes the old
 * onInterventionReminderQueuedEmail (removed from workflowEmailFunctions.ts):
 * instead of one hardcoded type, this looks up NOTIFICATION_REGISTRY by
 * `type` so any notification type can opt into an email by adding a registry
 * entry, without a new Cloud Function trigger.
 */
exports.onNotificationCreatedEmail = (0, firestore_1.onDocumentWritten)({ region: REGION, document: "notifications/{notificationId}" }, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before || !after)
        return; // only brand-new notifications
    const type = String(after.type || "");
    const config = notificationEmailRegistry_1.NOTIFICATION_REGISTRY[type]?.email;
    if (!config)
        return;
    const notificationId = event.params.notificationId;
    const participantId = after.participantId ? String(after.participantId) : null;
    const programId = after.programId ? String(after.programId) : null;
    let recipientEmail = "";
    try {
        const recipient = await config.resolveRecipient(after);
        if (!recipient?.email) {
            logger.warn("notification_email.no_recipient", { notificationId, type });
            return;
        }
        recipientEmail = recipient.email;
        const suppressed = await emailShared_1.db.collection("emailSuppressions").doc(recipientEmail).get();
        if (suppressed.exists) {
            logger.warn("notification_email.suppressed", { notificationId, to: recipientEmail });
            return;
        }
        const actionLinks = await mintActionLinks(notificationId, after, recipientEmail);
        const { subject, html, text } = config.template(after, recipient, actionLinks);
        const { messageId } = await (0, brevoClient_1.sendViaBrevo)({ to: recipientEmail, subject, html, text, tags: [config.tag] });
        await (0, brevoClient_1.logBrevoSend)({
            type: type.toUpperCase(),
            to: recipientEmail,
            subject,
            status: "sent",
            messageId,
            participantId,
            programId,
        });
        await event.data.after.ref.update({
            emailSentAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            emailSentTo: recipientEmail,
        });
    }
    catch (err) {
        const message = String(err?.message || err);
        logger.error("notification_email.failed", { notificationId, type, error: message });
        await (0, brevoClient_1.logBrevoSend)({
            type: (type || "NOTIFICATION").toUpperCase(),
            to: recipientEmail,
            subject: "",
            status: "failed",
            error: message,
            participantId,
            programId,
        });
    }
});
//# sourceMappingURL=notificationEmailFanout.js.map