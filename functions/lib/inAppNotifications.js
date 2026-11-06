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
exports.uidForEmail = exports.uidForParticipant = exports.notifyInApp = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const emailShared_1 = require("./emailShared");
const movRecipients_1 = require("./movRecipients");
async function notifyInApp(input) {
    const recipientIds = Array.from(new Set(input.recipientIds.map((id) => String(id || "").trim()).filter(Boolean)));
    if (!recipientIds.length)
        return;
    const doc = Object.fromEntries(Object.entries({ ...input, recipientIds }).filter(([, v]) => v !== undefined && v !== null));
    try {
        await emailShared_1.db.collection("notifications").add({
            ...doc,
            createdAt: new Date(),
            readBy: {},
        });
    }
    catch (error) {
        // In-app is additive: a failure here must never fail the email path.
        logger.warn("in_app_notification.write_failed", { type: input.type, error: String(error) });
    }
}
exports.notifyInApp = notifyInApp;
/**
 * Login uid of an SME behind a participant record. There is no single link
 * field, so try the ones the app uses, in order: participants.uid/userId,
 * users.participantId, then the participant's email against users.
 */
async function uidForParticipant(participantId, fallbackEmail) {
    const id = String(participantId || "").trim();
    let email = String(fallbackEmail || "").trim().toLowerCase();
    try {
        if (id) {
            const snap = await emailShared_1.db.collection("participants").doc(id).get();
            const data = (snap.data() || {});
            const direct = String(data.uid || data.userId || "").trim();
            if (direct)
                return direct;
            if (!email)
                email = String(data.email || "").trim().toLowerCase();
            const linked = await emailShared_1.db.collection("users").where("participantId", "==", id).limit(1).get();
            if (!linked.empty)
                return linked.docs[0].id;
        }
    }
    catch (error) {
        logger.warn("uidForParticipant.failed", { participantId: id, error: String(error) });
    }
    if (!email)
        return null;
    const [uid] = await (0, movRecipients_1.uidsForEmails)([email]);
    return uid || null;
}
exports.uidForParticipant = uidForParticipant;
/** Single-email convenience over uidsForEmails. */
async function uidForEmail(email) {
    const clean = String(email || "").trim().toLowerCase();
    if (!clean.includes("@"))
        return null;
    const [uid] = await (0, movRecipients_1.uidsForEmails)([clean]);
    return uid || null;
}
exports.uidForEmail = uidForEmail;
//# sourceMappingURL=inAppNotifications.js.map