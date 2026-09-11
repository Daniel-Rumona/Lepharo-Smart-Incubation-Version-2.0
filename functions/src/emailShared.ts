import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import nodemailer from "nodemailer";
import { withEmailDeliveryLogging } from "./emailDelivery";

if (!admin.apps.length) {
  admin.initializeApp();
}

export { admin };
export const db = admin.firestore();
export const APP_BASE_URL = process.env.APP_BASE_URL || 'https://lepharosmartinc.co.za';

export type Priority = "low" | "medium" | "high" | "urgent";
export type Status = "todo" | "in_progress" | "cancelled" | "done";
export type Assignment = { userId: string; branchId?: string | null; departmentId?: string | null };

export type TaskDoc = {
  title: string;
  description: string;
  programId: string;
  departmentId: string;
  priority: Priority;
  status: Status;
  startAt?: FirebaseFirestore.Timestamp | null;
  dueAt: FirebaseFirestore.Timestamp;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  createdBy: string;
  assignees: Assignment[];
  interventionId?: string | null;
  reminderFlags?: {
    dueSoonSent?: boolean;
    overdueSent?: boolean;
    lastReminderAt?: FirebaseFirestore.Timestamp;
    overdueLastSentDay?: string | null;
  };
};

export type Delivery = "in_person" | "telephonically" | "virtual";
export type ApptDoc = {
  assigneeId?: string;
  assigneeName?: string;
  assigneeEmail?: string;
  assigneeRole?: string;
  consultantId: string;
  consultantName: string;
  participantId: string;
  participantName: string;
  departmentId?: string;
  interventionId: string;
  interventionTitle: string;
  deliveryMethod: Delivery;
  date: string;
  startTime: FirebaseFirestore.Timestamp | Date;
  endTime: FirebaseFirestore.Timestamp | Date;
  meetingLink?: string;
  location?: string;
  status: "scheduled" | "completed" | "cancelled" | "pending";
  userConfirmation: "pending" | "confirmed" | "declined";
  createdAt: FirebaseFirestore.Timestamp;
  programId?: string;
  rescheduleRequest?: any;
  appointmentGroupKey?: string;
  sessionCoverage?: {
    latest?: {
      held?: boolean;
    } | null;
  };
  coverageReminder?: {
    lastSentAt?: FirebaseFirestore.Timestamp | Date;
    lastSentDay?: string;
    lastAttemptDay?: string;
    sentCount?: number;
  };
};

export type EditReqStatus = "pending" | "approved" | "rejected";
export type DevPlanEditRequestDoc = {
  programId?: string | null;
  participantId?: string | null;
  requesterDeptName?: string | null;
  requesterDeptId?: string | null;
  requesterUid?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  reason?: string | null;
  status?: EditReqStatus;
  createdAt?: FirebaseFirestore.Timestamp | Date | null;
  meRespondedAt?: FirebaseFirestore.Timestamp | Date | null;
  meRespondedBy?: string | null;
  meRespondedByName?: string | null;
  meResponseReason?: string | null;
  notifications?: any;
};

export const REMINDER_STATUSES: Status[] = ["todo", "in_progress"];
export const fmtDate = (d: Date) =>
  d.toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function safeStr(v: any, fallback = "—") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export async function getProgramName(programId?: string | null) {
  if (!programId) return null;
  try {
    const s = await db.collection("programs").doc(String(programId)).get();
    return s.exists ? (s.data() as any)?.name || null : null;
  } catch {
    return null;
  }
}

export async function getParticipantName(participantId?: string | null) {
  if (!participantId) return null;
  try {
    const s = await db.collection("participants").doc(String(participantId)).get();
    return s.exists ? (s.data() as any)?.beneficiaryName || (s.data() as any)?.participantName || null : null;
  } catch {
    return null;
  }
}

export async function getMERecipients() {
  const recipients = new Set<string>();
  recipients.add("egar@lepharo.co.za");
  try {
    let meDeptId: string | null = null;
    {
      let q: FirebaseFirestore.Query = db.collection("departments");
      const snap = await q.get();
      for (const d of snap.docs) {
        const data = d.data() as any;
        const name = String(data.departmentName || data.name || "").toLowerCase();
        const isME =
          name.includes("monitoring") ||
          name.includes("m&e") ||
          name.includes("m & e") ||
          name.replace(/\s+/g, "").includes("m&e");
        if (isME) { meDeptId = d.id; break; }
      }
    }

    let uq: FirebaseFirestore.Query = db.collection("users").where("role", "==", "operations");
    if (meDeptId) uq = uq.where("departmentId", "==", meDeptId);

    const usersSnap = await uq.get();
    usersSnap.docs.forEach((u) => {
      const data = u.data() as any;
      if (!meDeptId) {
        const dn = String(data.departmentName || "").toLowerCase();
        const ok =
          dn.includes("monitoring") ||
          dn.includes("m&e") ||
          dn.includes("m & e") ||
          dn.replace(/\s+/g, "").includes("m&e");
        if (!ok) return;
      }
      const email = String(data.email || "").trim().toLowerCase();
      if (email.includes("@")) recipients.add(email);
    });
  } catch (e) {
    logger.warn("getMERecipients.failed", { err: String(e) });
  }
  return Array.from(recipients);
}

export async function getCCRecipients() {
  const recipients = new Set<string>();
  try {
    let q: FirebaseFirestore.Query = db.collection("users").where("role", "==", "projectadmin");
    const snap = await q.get();
    for (const doc of snap.docs) {
      const email = String((doc.data() as any).email || "").trim().toLowerCase();
      if (email.includes("@")) recipients.add(email);
    }
  } catch (e) {
    logger.warn("getCCRecipients.failed", { err: String(e) });
  }
  return Array.from(recipients);
}

export async function getHODRecipients() {
  const recipients = new Set<string>();
  try {
    let q: FirebaseFirestore.Query = db.collection("users").where("role", "==", "operations");
    const snap = await q.get();
    for (const doc of snap.docs) {
      const email = String((doc.data() as any).email || "").trim().toLowerCase();
      if (email.includes("@")) recipients.add(email);
    }
  } catch (e) {
    logger.warn("getHODRecipients.failed", { err: String(e) });
  }
  return Array.from(recipients);
}

export function toDate(v: any): Date | null {
  try {
    if (v?.toDate && typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    return null;
  } catch {
    return null;
  }
}

export function formatWhere(a: ApptDoc, participantPhone?: string) {
  if (a.deliveryMethod === "virtual" && a.meetingLink)
    return `Virtual • Link: ${a.meetingLink}`;
  if (a.deliveryMethod === "in_person" && a.location)
    return `In person • Location: ${a.location}`;
  if (a.deliveryMethod === "telephonically")
    return `Telephonic • ${participantPhone ? `We’ll call: ${participantPhone}` : "We’ll call you"}`;
  return "—";
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _tx: nodemailer.Transporter | null = null;
export function getTransporter() {
  if (_tx) return _tx;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE == null
    ? port === 465
    : process.env.SMTP_SECURE.trim().toLowerCase() === "true";
  _tx = withEmailDeliveryLogging(nodemailer.createTransport({
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

export async function getConsultantMapByIds(ids: string[]) {
  if (!ids.length) return new Map<string, { email?: string | null; name?: string | null }>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  const out = new Map<string, { email?: string | null; name?: string | null }>();

  for (const group of chunks) {
    const snap = await db.collection("consultants")
      .where(admin.firestore.FieldPath.documentId(), "in", group)
      .get();
    snap.docs.forEach((d) => {
      const c = d.data() as any;
      out.set(d.id, { email: c.email || null, name: c.name || null });
    });
  }

  return out;
}

export async function sendStatusChangeNotification(recipients: string[], subject: string, html: string, text: string) {
  if (!recipients.length) return;
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  await transporter.sendMail({ from, to: from, bcc: recipients, subject, html, text });
}

export function buildMovNotificationContent(opts: { statusLabel: string; movId: string; interventionTitle?: string; beneficiaryName?: string; facilitatorName?: string }) {
  const title = safeStr(opts.interventionTitle, "MOV document");
  const beneficiary = safeStr(opts.beneficiaryName, "Participant");
  const facilitator = safeStr(opts.facilitatorName, "Facilitator");
  const targetUrl = `${APP_BASE_URL.replace(/\/$/, "")}/movs/${opts.movId}`;
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

export function buildPackReminderEmail(recipientType: string, reminderText: string, actionUrl: string) {
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
