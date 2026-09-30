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
exports.notifyInquirySpecialist = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const emailShared_1 = require("./emailShared");
const SUPPORT_FROM_NAME = "Lepharo Smart Incubation Support";
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAFF_ROLES = ["receptionist", "projectadmin", "director", "admin", "coordinator", "operations"];
const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
/**
 * A staff member refers an inquiry to a specialist. The specialist is emailed and,
 * when they have an account, gets an in-system notification (the notifications
 * bell and its pop-up). The account is found here, on the server, because staff
 * cannot look other users up by email from the browser.
 */
exports.notifyInquirySpecialist = (0, https_1.onRequest)({ region: "us-central1", invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method_not_allowed" });
        return;
    }
    const header = req.headers.authorization || "";
    const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!idToken) {
        res.status(401).json({ ok: false, error: "missing_id_token" });
        return;
    }
    let callerUid = "";
    try {
        callerUid = (await emailShared_1.admin.auth().verifyIdToken(idToken)).uid;
    }
    catch {
        res.status(401).json({ ok: false, error: "invalid_id_token" });
        return;
    }
    const { inquiryId, specialistName, specialistEmail, subject, text } = (req.body || {});
    const email = String(specialistEmail || "").trim().toLowerCase();
    if (!inquiryId || typeof inquiryId !== "string") {
        res.status(400).json({ ok: false, error: "inquiry_required" });
        return;
    }
    if (!emailRx.test(email)) {
        res.status(400).json({ ok: false, error: "invalid_specialist_email" });
        return;
    }
    if (!specialistName || !String(specialistName).trim()) {
        res.status(400).json({ ok: false, error: "specialist_name_required" });
        return;
    }
    if (!subject || typeof subject !== "string" || subject.length > 200) {
        res.status(400).json({ ok: false, error: "invalid_subject" });
        return;
    }
    if (!text || typeof text !== "string" || text.length > 10000) {
        res.status(400).json({ ok: false, error: "invalid_body" });
        return;
    }
    try {
        const [callerSnap, inquirySnap] = await Promise.all([
            emailShared_1.db.collection("users").doc(callerUid).get(),
            emailShared_1.db.collection("inquiries").doc(inquiryId).get(),
        ]);
        const caller = (callerSnap.data() || {});
        const inquiry = (inquirySnap.data() || {});
        if (!STAFF_ROLES.includes(String(caller.role || "").toLowerCase())) {
            res.status(403).json({ ok: false, error: "not_staff" });
            return;
        }
        if (!inquirySnap.exists) {
            res.status(404).json({ ok: false, error: "inquiry_not_found" });
            return;
        }
        if (["receptionist", "projectadmin"].includes(String(caller.role).toLowerCase()) &&
            caller.assignedBranch !== inquiry.branchId) {
            res.status(403).json({ ok: false, error: "different_branch" });
            return;
        }
        // The specialist may or may not have an account.
        let specialistUid = null;
        try {
            specialistUid = (await emailShared_1.admin.auth().getUserByEmail(email)).uid;
        }
        catch {
            const byEmail = await emailShared_1.db.collection("users").where("email", "==", email).limit(1).get();
            specialistUid = byEmail.empty ? null : byEmail.docs[0].id;
        }
        const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
        const from = `"${SUPPORT_FROM_NAME}" <${(fromAddress.match(/<([^>]+)>/)?.[1] || fromAddress).trim()}>`;
        await (0, emailShared_1.getTransporter)().sendMail({
            from,
            to: email,
            subject,
            text,
            html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.6">${escapeHtml(text)}</div>`,
        });
        let notified = false;
        if (specialistUid) {
            const contact = inquiry.contactInfo || {};
            const who = contact.company || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "an SME";
            await emailShared_1.db.collection("notifications").add({
                type: "inquiry_referral",
                message: `${caller.name || "A colleague"} referred an inquiry to you: ${inquiry.inquiryDetails?.inquiryType || "Inquiry"} from ${who}. Please contact them within 24 hours.`,
                recipientIds: [specialistUid],
                recipientRoles: [],
                inquiryId,
                referredBy: callerUid,
                referredByName: caller.name || "",
                createdAt: new Date(),
                readBy: {},
            });
            notified = true;
        }
        logger.info("inquiry_specialist_notified", { callerUid, inquiryId, emailed: true, notified });
        res.status(200).json({ ok: true, emailed: true, notified });
    }
    catch (error) {
        logger.error("inquiry_specialist_notify_failed", { inquiryId, error: String(error?.message || error) });
        res.status(500).json({ ok: false, error: "send_failed" });
    }
});
//# sourceMappingURL=inquiryReferral.js.map