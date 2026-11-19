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
exports.withPilotGuard = exports.PILOT_SKIPPED_INFO = exports.pilotFilterMail = exports.pilotAllowsPhone = exports.pilotAllowsEmail = exports.pilotModeOn = void 0;
// Pilot guard: while testers try this version on the live project, outgoing
// email, WhatsApp and push reach only the people listed in
// pilotSettings/recipients ({ emails: string[], phones: string[] }).
//
// It is on when PILOT_RECIPIENTS_ONLY=true (functions/.env.lph-smart-inc), so
// the dev project is unaffected. It fails closed: if the list is missing or
// unreadable, nothing is sent. Messages to anyone else are dropped and logged
// (pilot_guard.*), never queued, so turning the guard off later does not
// release a backlog.
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("./firebase");
const CACHE_MS = 60000;
let cached = null;
function pilotModeOn() {
    return String(process.env.PILOT_RECIPIENTS_ONLY || "").trim().toLowerCase() === "true";
}
exports.pilotModeOn = pilotModeOn;
const normalEmail = (value) => String(value ?? "").trim().toLowerCase();
// The last nine digits identify a South African mobile whether it is written
// +27 82 ..., 27 82 ... or 082 ....
function phoneKey(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length >= 9 ? digits.slice(-9) : digits;
}
async function allowlist() {
    if (cached && Date.now() - cached.at < CACHE_MS)
        return cached.list;
    let list = { emails: new Set(), phones: new Set() };
    try {
        const data = (await firebase_1.admin.firestore().doc("pilotSettings/recipients").get()).data() || {};
        list = {
            emails: new Set((Array.isArray(data.emails) ? data.emails : []).map(normalEmail).filter(Boolean)),
            phones: new Set((Array.isArray(data.phones) ? data.phones : []).map(phoneKey).filter(Boolean)),
        };
    }
    catch (error) {
        logger.error("pilot_guard.allowlist_unreadable", { error: String(error) });
    }
    cached = { at: Date.now(), list };
    return list;
}
async function pilotAllowsEmail(address) {
    if (!pilotModeOn())
        return true;
    const email = normalEmail(address);
    return email !== "" && (await allowlist()).emails.has(email);
}
exports.pilotAllowsEmail = pilotAllowsEmail;
async function pilotAllowsPhone(phone) {
    if (!pilotModeOn())
        return true;
    const key = phoneKey(phone);
    return key !== "" && (await allowlist()).phones.has(key);
}
exports.pilotAllowsPhone = pilotAllowsPhone;
// nodemailer accepts "a@x.com, Name <b@y.com>", an array of those, or
// { name, address } objects. Returns the bare address of one entry.
function addressOf(entry) {
    if (entry && typeof entry === "object")
        return normalEmail(entry.address);
    const text = String(entry ?? "");
    const angled = text.match(/<([^>]+)>/);
    return normalEmail(angled ? angled[1] : text);
}
function entriesOf(value) {
    if (value == null || value === "")
        return [];
    if (Array.isArray(value))
        return value.flatMap(entriesOf);
    if (typeof value === "string")
        return value.split(",").map(part => part.trim()).filter(Boolean);
    return [value];
}
/**
 * Narrows a mail's to/cc/bcc to allowed recipients. Returns null when nobody
 * is left, so the caller skips the send.
 */
async function pilotFilterMail(mail) {
    if (!pilotModeOn())
        return mail;
    const list = await allowlist();
    const keep = (value) => entriesOf(value).filter(entry => list.emails.has(addressOf(entry)));
    const to = keep(mail.to), cc = keep(mail.cc), bcc = keep(mail.bcc);
    const dropped = entriesOf(mail.to).length + entriesOf(mail.cc).length + entriesOf(mail.bcc).length -
        (to.length + cc.length + bcc.length);
    if (dropped > 0)
        logger.info("pilot_guard.email_recipients_dropped", { subject: String(mail.subject || ""), dropped });
    if (!to.length && !cc.length && !bcc.length) {
        logger.info("pilot_guard.email_skipped", { subject: String(mail.subject || "") });
        return null;
    }
    return {
        ...mail,
        to: to.length ? to : undefined,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
    };
}
exports.pilotFilterMail = pilotFilterMail;
/** Result returned in place of a send the guard skipped. */
exports.PILOT_SKIPPED_INFO = Object.freeze({
    messageId: "pilot-skipped",
    accepted: [],
    rejected: [],
    response: "skipped by pilot guard",
    pilotSkipped: true,
});
/**
 * Wraps a nodemailer transport so every send goes through pilotFilterMail.
 * A mail with pilotExempt: true is sent as is; that is for mail that must reach
 * real users during the pilot, such as application decisions.
 */
function withPilotGuard(transport) {
    const rawSendMail = transport.sendMail.bind(transport);
    transport.sendMail = (async (options, callback) => {
        try {
            const { pilotExempt, ...mail } = options || {};
            const guarded = pilotExempt === true ? mail : await pilotFilterMail(mail);
            const info = guarded ? await rawSendMail(guarded) : exports.PILOT_SKIPPED_INFO;
            if (typeof callback === "function")
                callback(null, info);
            return info;
        }
        catch (error) {
            if (typeof callback === "function") {
                callback(error);
                return undefined;
            }
            throw error;
        }
    });
    return transport;
}
exports.withPilotGuard = withPilotGuard;
//# sourceMappingURL=pilotGuard.js.map