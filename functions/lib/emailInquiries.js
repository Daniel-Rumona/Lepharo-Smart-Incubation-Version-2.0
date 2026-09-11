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
exports.onInquiryCreatedNotifyStaff = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const firestore_1 = require("firebase-functions/v2/firestore");
const emailShared_1 = require("./emailShared");
const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
async function getBranchName(branchId) {
    try {
        const snap = await emailShared_1.db.collection("branches").doc(branchId).get();
        const data = snap.data();
        return String(data?.name || data?.branchName || "your branch");
    }
    catch {
        return "your branch";
    }
}
async function getBranchStaffEmails(branchId, role) {
    const recipients = new Set();
    try {
        const snap = await emailShared_1.db.collection("users")
            .where("role", "==", role)
            .where("assignedBranch", "==", branchId)
            .get();
        snap.docs.forEach((doc) => {
            const email = String(doc.data().email || "").trim().toLowerCase();
            if (email.includes("@"))
                recipients.add(email);
        });
    }
    catch (e) {
        logger.warn("getBranchStaffEmails.failed", { branchId, role, err: String(e) });
    }
    return Array.from(recipients);
}
function buildNotificationEmail(opts) {
    const { inquiry, branchName, detailUrl } = opts;
    const contact = inquiry.contactInfo || {};
    const details = inquiry.inquiryDetails || {};
    const submitterName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "An SME";
    const inquiryType = details.inquiryType || "General Inquiry";
    const description = details.description || details.message || "No details provided.";
    const services = (details.servicesOfInterest || []).join(", ");
    const subject = `New SME inquiry: ${inquiryType} — ${branchName}`;
    const html = `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px;color:#111827">
  <p>Hi there,</p>
  <p><strong>${escapeHtml(submitterName)}</strong> submitted a new inquiry for <strong>${escapeHtml(branchName)}</strong> through the SME portal.</p>
  <table style="border-collapse:collapse;font-size:14px;margin:12px 0;min-width:320px">
    <tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Type</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(inquiryType)}</td></tr>
    ${services ? `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Services of Interest</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(services)}</td></tr>` : ""}
    ${contact.email ? `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Email</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(contact.email)}</td></tr>` : ""}
    ${contact.phone ? `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb"><b>Phone</b></td><td style="padding:6px 10px;border:1px solid #e5e7eb">${escapeHtml(contact.phone)}</td></tr>` : ""}
  </table>
  <p><strong>Message:</strong></p>
  <p style="white-space:pre-wrap">${escapeHtml(description)}</p>
  <p><a href="${detailUrl}" style="display:inline-block;padding:11px 18px;background:#1677ff;color:#fff;text-decoration:none;border-radius:7px;font-weight:600">View Inquiry</a></p>
  <p>Regards,<br/><strong>Lepharo Smart Incubation System</strong></p>
</div>`;
    const text = [
        `${submitterName} submitted a new inquiry for ${branchName}.`,
        `Type: ${inquiryType}`,
        services ? `Services of Interest: ${services}` : null,
        contact.email ? `Email: ${contact.email}` : null,
        contact.phone ? `Phone: ${contact.phone}` : null,
        ``,
        `Message: ${description}`,
        ``,
        `View: ${detailUrl}`,
    ].filter(Boolean).join("\n");
    return { subject, html, text };
}
exports.onInquiryCreatedNotifyStaff = (0, firestore_1.onDocumentWritten)({ region: "us-central1", document: "inquiries/{inquiryId}" }, async (event) => {
    try {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!after || before)
            return; // Only newly-created inquiries
        if (after.source !== "SME")
            return; // Only SME self-submitted inquiries
        const branchId = String(after.branchId || "").trim();
        if (!branchId) {
            logger.warn("inquiry_notify.skip_no_branch", { inquiryId: event.params.inquiryId });
            return;
        }
        const [branchName, receptionistEmails, projectAdminEmails] = await Promise.all([
            getBranchName(branchId),
            getBranchStaffEmails(branchId, "receptionist"),
            getBranchStaffEmails(branchId, "projectadmin"),
        ]);
        if (!receptionistEmails.length && !projectAdminEmails.length) {
            logger.warn("inquiry_notify.skip_no_recipients", { inquiryId: event.params.inquiryId, branchId });
            return;
        }
        const transporter = (0, emailShared_1.getTransporter)();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER;
        const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
        const sends = [];
        if (receptionistEmails.length) {
            const { subject, html, text } = buildNotificationEmail({
                inquiry: after,
                branchName,
                detailUrl: `${base}/receptionist/inquiries/${event.params.inquiryId}`,
            });
            sends.push(transporter.sendMail({ from, to: receptionistEmails, subject, html, text }));
        }
        if (projectAdminEmails.length) {
            const { subject, html, text } = buildNotificationEmail({
                inquiry: after,
                branchName,
                detailUrl: `${base}/projectadmin/inquiries/${event.params.inquiryId}`,
            });
            sends.push(transporter.sendMail({ from, to: projectAdminEmails, subject, html, text }));
        }
        await Promise.all(sends);
        logger.info("inquiry_notify.sent", {
            inquiryId: event.params.inquiryId,
            branchId,
            receptionistCount: receptionistEmails.length,
            projectAdminCount: projectAdminEmails.length,
        });
        await event.data.after.ref.set({
            notificationFlags: {
                staffNotifiedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
    }
    catch (e) {
        logger.error("onInquiryCreatedNotifyStaff.failed", { err: String(e) });
    }
});
//# sourceMappingURL=emailInquiries.js.map