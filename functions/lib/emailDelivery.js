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
exports.withEmailDeliveryLogging = exports.isTransientSmtpError = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
function flattenAddresses(value) {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value.flatMap(flattenAddresses);
    if (typeof value === "object" && value.address)
        return [String(value.address)];
    return String(value)
        .split(/[;,]+/)
        .map((part) => {
        const angleAddress = part.match(/<([^>]+)>/);
        return (angleAddress?.[1] || part).trim().toLowerCase();
    })
        .filter(Boolean);
}
async function writeDeliveryLogs(options, status, details = {}) {
    const bcc = flattenAddresses(options.bcc);
    const recipients = bcc.length
        ? bcc
        : [...flattenAddresses(options.to), ...flattenAddresses(options.cc)];
    const uniqueRecipients = [...new Set(recipients)];
    const rows = uniqueRecipients.length ? uniqueRecipients : ["(recipient unavailable)"];
    const subject = String(options.subject || "(no subject)");
    const meta = options.__meta || {};
    const batch = db.batch();
    rows.forEach((to) => {
        const ref = db.collection("emailLogs").doc();
        batch.set(ref, {
            type: meta.type || "SYSTEM_EMAIL",
            source: "firebase-functions",
            to,
            subject,
            status,
            error: details.error || null,
            messageId: details.messageId || null,
            accepted: (details.accepted || []).map(String),
            rejected: (details.rejected || []).map(String),
            transportResponse: details.response || null,
            participantId: meta.participantId || null,
            programId: meta.programId || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    try {
        await batch.commit();
    }
    catch (error) {
        // Logging must never turn a successfully accepted SMTP message into a failure.
        logger.error("email_delivery_log.write_failed", {
            subject,
            recipients: rows,
            error: String(error),
        });
    }
}
const TRANSIENT_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNRESET"]);
const SEND_ATTEMPTS = 3;
/**
 * True for failures worth another attempt: a dropped or timed-out connection
 * (pooled sockets the server closed while idle) or a 4xx temporary reply.
 * Auth failures (535) and permanent rejections (550 no such recipient) are not.
 */
function isTransientSmtpError(error) {
    const code = Number(error?.responseCode);
    if (code >= 400 && code < 500)
        return true;
    if (code >= 500)
        return false;
    if (TRANSIENT_CODES.has(String(error?.code || "")))
        return true;
    return /connection closed|timed? ?out|ECONNRESET/i.test(String(error?.message || ""));
}
exports.isTransientSmtpError = isTransientSmtpError;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Adds Firestore delivery-attempt logging to a Nodemailer transport, retrying
 * transient connection errors with backoff (only the final outcome is logged).
 *
 * "sent" means the configured SMTP server accepted the message. Final inbox
 * delivery or a later bounce requires provider webhooks and is not asserted here.
 */
function withEmailDeliveryLogging(transport) {
    const rawSendMail = transport.sendMail.bind(transport);
    const sendMail = async (options) => {
        for (let attempt = 1;; attempt++) {
            try {
                return await rawSendMail(options);
            }
            catch (error) {
                if (attempt >= SEND_ATTEMPTS || !isTransientSmtpError(error))
                    throw error;
                logger.warn("email_delivery.retry", {
                    subject: String(options.subject || ""),
                    attempt,
                    error: String(error?.message || error),
                });
                await sleep(1000 * 2 ** (attempt - 1));
            }
        }
    };
    transport.sendMail = (async (options, callback) => {
        try {
            const info = await sendMail(options);
            await writeDeliveryLogs(options, "sent", {
                messageId: info?.messageId || null,
                accepted: info?.accepted || [],
                rejected: info?.rejected || [],
                response: info?.response || null,
            });
            if (typeof callback === "function")
                callback(null, info);
            return info;
        }
        catch (error) {
            await writeDeliveryLogs(options, "failed", {
                error: String(error?.message || error),
                response: String(error?.response || "") || null,
            });
            if (typeof callback === "function") {
                callback(error);
                return undefined;
            }
            throw error;
        }
    });
    return transport;
}
exports.withEmailDeliveryLogging = withEmailDeliveryLogging;
//# sourceMappingURL=emailDelivery.js.map