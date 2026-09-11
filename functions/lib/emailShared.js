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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPackReminderEmail = exports.buildMovNotificationContent = exports.sendStatusChangeNotification = exports.getConsultantMapByIds = exports.getTransporter = exports.requireEnv = exports.formatWhere = exports.toDate = exports.getHODRecipients = exports.getCCRecipients = exports.getMERecipients = exports.getParticipantName = exports.getProgramName = exports.safeStr = exports.fmtDate = exports.REMINDER_STATUSES = exports.APP_BASE_URL = exports.db = exports.admin = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
exports.admin = admin;
const nodemailer_1 = __importDefault(require("nodemailer"));
const emailDelivery_1 = require("./emailDelivery");
if (!admin.apps.length) {
    admin.initializeApp();
}
exports.db = admin.firestore();
exports.APP_BASE_URL = process.env.APP_BASE_URL || 'https://lepharosmartinc.co.za';
exports.REMINDER_STATUSES = ["todo", "in_progress"];
const fmtDate = (d) => d.toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
exports.fmtDate = fmtDate;
function safeStr(v, fallback = "—") {
    const s = String(v ?? "").trim();
    return s || fallback;
}
exports.safeStr = safeStr;
async function getProgramName(programId) {
    if (!programId)
        return null;
    try {
        const s = await exports.db.collection("programs").doc(String(programId)).get();
        return s.exists ? s.data()?.name || null : null;
    }
    catch {
        return null;
    }
}
exports.getProgramName = getProgramName;
async function getParticipantName(participantId) {
    if (!participantId)
        return null;
    try {
        const s = await exports.db.collection("participants").doc(String(participantId)).get();
        return s.exists ? s.data()?.beneficiaryName || s.data()?.participantName || null : null;
    }
    catch {
        return null;
    }
}
exports.getParticipantName = getParticipantName;
async function getMERecipients() {
    const recipients = new Set();
    recipients.add("egar@lepharo.co.za");
    try {
        let meDeptId = null;
        {
            let q = exports.db.collection("departments");
            const snap = await q.get();
            for (const d of snap.docs) {
                const data = d.data();
                const name = String(data.departmentName || data.name || "").toLowerCase();
                const isME = name.includes("monitoring") ||
                    name.includes("m&e") ||
                    name.includes("m & e") ||
                    name.replace(/\s+/g, "").includes("m&e");
                if (isME) {
                    meDeptId = d.id;
                    break;
                }
            }
        }
        let uq = exports.db.collection("users").where("role", "==", "operations");
        if (meDeptId)
            uq = uq.where("departmentId", "==", meDeptId);
        const usersSnap = await uq.get();
        usersSnap.docs.forEach((u) => {
            const data = u.data();
            if (!meDeptId) {
                const dn = String(data.departmentName || "").toLowerCase();
                const ok = dn.includes("monitoring") ||
                    dn.includes("m&e") ||
                    dn.includes("m & e") ||
                    dn.replace(/\s+/g, "").includes("m&e");
                if (!ok)
                    return;
            }
            const email = String(data.email || "").trim().toLowerCase();
            if (email.includes("@"))
                recipients.add(email);
        });
    }
    catch (e) {
        logger.warn("getMERecipients.failed", { err: String(e) });
    }
    return Array.from(recipients);
}
exports.getMERecipients = getMERecipients;
async function getCCRecipients() {
    const recipients = new Set();
    try {
        let q = exports.db.collection("users").where("role", "==", "projectadmin");
        const snap = await q.get();
        for (const doc of snap.docs) {
            const email = String(doc.data().email || "").trim().toLowerCase();
            if (email.includes("@"))
                recipients.add(email);
        }
    }
    catch (e) {
        logger.warn("getCCRecipients.failed", { err: String(e) });
    }
    return Array.from(recipients);
}
exports.getCCRecipients = getCCRecipients;
async function getHODRecipients() {
    const recipients = new Set();
    try {
        let q = exports.db.collection("users").where("role", "==", "operations");
        const snap = await q.get();
        for (const doc of snap.docs) {
            const email = String(doc.data().email || "").trim().toLowerCase();
            if (email.includes("@"))
                recipients.add(email);
        }
    }
    catch (e) {
        logger.warn("getHODRecipients.failed", { err: String(e) });
    }
    return Array.from(recipients);
}
exports.getHODRecipients = getHODRecipients;
function toDate(v) {
    try {
        if (v?.toDate && typeof v.toDate === "function")
            return v.toDate();
        if (v instanceof Date)
            return v;
        return null;
    }
    catch {
        return null;
    }
}
exports.toDate = toDate;
function formatWhere(a, participantPhone) {
    if (a.deliveryMethod === "virtual" && a.meetingLink)
        return `Virtual • Link: ${a.meetingLink}`;
    if (a.deliveryMethod === "in_person" && a.location)
        return `In person • Location: ${a.location}`;
    if (a.deliveryMethod === "telephonically")
        return `Telephonic • ${participantPhone ? `We’ll call: ${participantPhone}` : "We’ll call you"}`;
    return "—";
}
exports.formatWhere = formatWhere;
function requireEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
exports.requireEnv = requireEnv;
let _tx = null;
function getTransporter() {
    if (_tx)
        return _tx;
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = process.env.SMTP_SECURE == null
        ? port === 465
        : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
    _tx = (0, emailDelivery_1.withEmailDeliveryLogging)(nodemailer_1.default.createTransport({
        host: requireEnv("SMTP_HOST"),
        port,
        secure,
        auth: {
            user: requireEnv("SMTP_USER"),
            pass: requireEnv("SMTP_PASS"),
        },
    }));
    return _tx;
}
exports.getTransporter = getTransporter;
async function getConsultantMapByIds(ids) {
    if (!ids.length)
        return new Map();
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10)
        chunks.push(ids.slice(i, i + 10));
    const out = new Map();
    for (const group of chunks) {
        const snap = await exports.db.collection("consultants")
            .where(admin.firestore.FieldPath.documentId(), "in", group)
            .get();
        snap.docs.forEach((d) => {
            const c = d.data();
            out.set(d.id, { email: c.email || null, name: c.name || null });
        });
    }
    return out;
}
exports.getConsultantMapByIds = getConsultantMapByIds;
async function sendStatusChangeNotification(recipients, subject, html, text) {
    if (!recipients.length)
        return;
    const transporter = getTransporter();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await transporter.sendMail({ from, to: from, bcc: recipients, subject, html, text });
}
exports.sendStatusChangeNotification = sendStatusChangeNotification;
function buildMovNotificationContent(opts) {
    const title = safeStr(opts.interventionTitle, "MOV document");
    const beneficiary = safeStr(opts.beneficiaryName, "Participant");
    const facilitator = safeStr(opts.facilitatorName, "Facilitator");
    const targetUrl = `${exports.APP_BASE_URL.replace(/\/$/, "")}/movs/${opts.movId}`;
    const subject = `MOV ${opts.statusLabel} — action required`;
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;">
      <p>Hi there,</p>
      <p>A MOV document has changed status to <strong>${opts.statusLabel}</strong>.</p>
      <p><strong>Intervention</strong>: ${title}<br/>
      <strong>Participant</strong>: ${beneficiary}<br/>
      <strong>Facilitator</strong>: ${facilitator}</p>
      <p>Please follow up in the system as soon as possible.</p>
      <p><a href="${targetUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:6px;">Open MOV document</a></p>
      <p>Regards,<br/>Lepharo Smart Incubation System</p>
    </div>`;
    const text = `A MOV document has changed status to ${opts.statusLabel}.

` +
        `Intervention: ${title}
` +
        `Participant: ${beneficiary}
` +
        `Facilitator: ${facilitator}

` +
        `Open the document here: ${targetUrl}
` +
        `
Regards,
Lepharo Smart Incubation System`;
    return { subject, html, text };
}
exports.buildMovNotificationContent = buildMovNotificationContent;
function buildPackReminderEmail(recipientType, reminderText, actionUrl) {
    const subject = `Reminder: ${recipientType} MOV pack action required`;
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;">
      <p>Hi there,</p>
      <p>${reminderText}</p>
      <p><a href="${actionUrl}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:6px;">Open Smart Incubation</a></p>
      <p>Regards,<br/>Lepharo Smart Incubation System</p>
    </div>`;
    const text = `${reminderText}

Open the system here: ${actionUrl}

Regards,
Lepharo Smart Incubation System`;
    return { subject, html, text };
}
exports.buildPackReminderEmail = buildPackReminderEmail;
//# sourceMappingURL=emailShared.js.map