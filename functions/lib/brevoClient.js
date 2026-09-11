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
exports.brevoApiKeepAlive = exports.logBrevoSend = exports.sendViaBrevo = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
const emailShared_1 = require("./emailShared");
const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";
/**
 * Sends via Brevo's transactional API (not their SMTP relay) because only the API
 * path fires the bounce/complaint webhook events this app relies on for delivery
 * status -- see emailBounceWebhook.ts.
 */
async function sendViaBrevo(input) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey)
        throw new Error("Missing env: BREVO_API_KEY");
    const senderEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
    const senderName = process.env.MAIL_FROM_NAME || "Smart Incubation Support";
    if (!senderEmail)
        throw new Error("Missing env: MAIL_FROM_EMAIL");
    const res = await fetch(BREVO_SEND_URL, {
        method: "POST",
        headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            sender: { email: senderEmail, name: senderName },
            to: [{ email: input.to }],
            subject: input.subject,
            htmlContent: input.html,
            textContent: input.text,
            tags: input.tags,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = data?.message || data?.code || `Brevo API error (${res.status})`;
        throw new Error(message);
    }
    return { messageId: String(data?.messageId || "") };
}
exports.sendViaBrevo = sendViaBrevo;
/** Mirrors the field shape emailDelivery.ts's withEmailDeliveryLogging already writes,
 * so every existing reader (frontend risk register, /admin/email) works unchanged. */
async function logBrevoSend(input) {
    try {
        await emailShared_1.db.collection("emailLogs").add({
            type: input.type,
            source: "brevo-api",
            to: String(input.to || "").toLowerCase(),
            subject: input.subject,
            status: input.status,
            error: input.error || null,
            messageId: input.messageId || null,
            accepted: input.status === "sent" ? [input.to] : [],
            rejected: input.status === "failed" ? [input.to] : [],
            transportResponse: null,
            participantId: input.participantId || null,
            programId: input.programId || null,
            createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        logger.error("brevo_send_log.write_failed", { subject: input.subject, to: input.to, error: String(error) });
    }
}
exports.logBrevoSend = logBrevoSend;
/**
 * Brevo auto-expires an API key after 90 days with no API activity (warning emails
 * go out on day 83 and day 90 -- see
 * https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys).
 * A read-only "get account details" call is enough to count as activity without any
 * side effects (no email sent, no data changed, doesn't touch the daily send quota).
 */
async function pingBrevoAccount() {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey)
        throw new Error("Missing env: BREVO_API_KEY");
    const res = await fetch(BREVO_ACCOUNT_URL, {
        method: "GET",
        headers: { "api-key": apiKey, "Accept": "application/json" },
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `Brevo API error (${res.status})`);
    }
}
exports.brevoApiKeepAlive = (0, scheduler_1.onSchedule)({ region: "us-central1", schedule: "0 3 * * 1", timeZone: "Africa/Johannesburg" }, async () => {
    const ref = emailShared_1.db.collection("systemHeartbeats").doc("brevoApiKeepAlive");
    try {
        await pingBrevoAccount();
        await ref.set({ lastPingAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "ok", lastError: null }, { merge: true });
    }
    catch (error) {
        const message = String(error?.message || error);
        logger.error("brevo_api_keep_alive.failed", { error: message });
        await ref.set({ lastPingAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(), lastStatus: "failed", lastError: message }, { merge: true });
    }
});
//# sourceMappingURL=brevoClient.js.map