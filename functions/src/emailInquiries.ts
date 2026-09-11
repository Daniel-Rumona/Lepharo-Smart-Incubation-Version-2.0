import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { admin, db, getTransporter, APP_BASE_URL } from "./emailShared";

type InquiryDoc = {
  branchId?: string;
  source?: string;
  contactInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  inquiryDetails?: {
    inquiryType?: string;
    servicesOfInterest?: string[];
    description?: string;
    message?: string;
  };
};

const escapeHtml = (value: any) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

async function getBranchName(branchId: string): Promise<string> {
  try {
    const snap = await db.collection("branches").doc(branchId).get();
    const data = snap.data() as any;
    return String(data?.name || data?.branchName || "your branch");
  } catch {
    return "your branch";
  }
}

async function getBranchStaffEmails(branchId: string, role: "receptionist" | "projectadmin"): Promise<string[]> {
  const recipients = new Set<string>();
  try {
    const snap = await db.collection("users")
      .where("role", "==", role)
      .where("assignedBranch", "==", branchId)
      .get();
    snap.docs.forEach((doc) => {
      const email = String((doc.data() as any).email || "").trim().toLowerCase();
      if (email.includes("@")) recipients.add(email);
    });
  } catch (e) {
    logger.warn("getBranchStaffEmails.failed", { branchId, role, err: String(e) });
  }
  return Array.from(recipients);
}

function buildNotificationEmail(opts: {
  inquiry: InquiryDoc;
  branchName: string;
  detailUrl: string;
}) {
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

export const onInquiryCreatedNotifyStaff = onDocumentWritten(
  { region: "us-central1", document: "inquiries/{inquiryId}" },
  async (event) => {
    try {
      const before = event.data?.before?.data() as InquiryDoc | undefined;
      const after = event.data?.after?.data() as InquiryDoc | undefined;
      if (!after || before) return; // Only newly-created inquiries
      if (after.source !== "SME") return; // Only SME self-submitted inquiries

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

      const transporter = getTransporter();
      const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
      const base = APP_BASE_URL.replace(/\/$/, "");

      const sends: Promise<any>[] = [];

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

      await event.data!.after!.ref.set({
        notificationFlags: {
          staffNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    } catch (e) {
      logger.error("onInquiryCreatedNotifyStaff.failed", { err: String(e) });
    }
  }
);
