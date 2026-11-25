import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { admin, db, APP_BASE_URL } from "./emailShared";
import { sendSystemEmail } from "./mail/mailer";

/*
 * Staff email SMEs from the system ("Send message" on the Incubatees page).
 *
 * The sender's role is read from their users document, never from the browser,
 * and decides which SMEs they may email:
 *   - system_admin / director: any SME
 *   - projectadmin (centre coordinator): SMEs accepted on their branch's programmes
 *   - coordinator: SMEs accepted on their assigned programmes, or SMEs they have an
 *     intervention assigned for
 *   - operations (incl. HODs/HR): SMEs accepted on the programmes their department
 *     takes part in
 * Incubatees and other roles cannot send. SMEs are identified by participantId; the
 * address comes from the SME's own records on the server. Mail goes out through
 * sendSystemEmail, so the pilot guard applies, with replies going to the sender.
 */

const MAX_RECIPIENTS = 200;
const DAILY_LIMIT = 300;
const MAX_SUBJECT = 200;
const MAX_BODY = 10000;
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: unknown) => String(value ?? "").trim();
const roleKey = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, "_");
const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Administrator",
  director: "Director",
  projectadmin: "Centre Coordinator",
  coordinator: "Coordinator",
  operations: "Operations",
};
const ALL_SME_ROLES = ["system_admin", "director"];
export const MESSAGE_SENDER_ROLES = [...ALL_SME_ROLES, "projectadmin", "coordinator", "operations"];

// Programme references are stored as ids, numbers or { id } objects.
const idOf = (value: any) => clean(typeof value === "object" && value ? value.id : value);
const programBranchId = (data: any) =>
  clean(data.normalizedAssignedBranchId) || clean(data.branchId) || idOf(data.assignedBranch);

type Sender = { docId: string; uid: string; name: string; email: string; role: string; data: FirebaseFirestore.DocumentData };

async function loadSender(uid: string): Promise<Sender> {
  let snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    const byUid = await db.collection("users").where("uid", "==", uid).limit(1).get();
    if (!byUid.empty) snap = byUid.docs[0];
  }
  const data = snap.data() || {};
  return {
    docId: snap.id,
    uid,
    name: clean(data.name) || clean(data.displayName) || "A staff member",
    email: clean(data.email).toLowerCase(),
    role: roleKey(data.role),
    data,
  };
}

/** Accepted applications for these SMEs: participantId -> programme ids. */
async function acceptedProgrammes(participantIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < participantIds.length; i += 30) {
    const snap = await db.collection("applications")
      .where("participantId", "in", participantIds.slice(i, i + 30))
      .select("participantId", "programId", "applicationStatus")
      .get();
    snap.docs
      .filter((doc) => clean(doc.get("applicationStatus")).toLowerCase() === "accepted")
      .forEach((doc) => {
        const pid = clean(doc.get("participantId"));
        if (!out.has(pid)) out.set(pid, new Set());
        out.get(pid)!.add(clean(doc.get("programId")));
      });
  }
  return out;
}

/** The SMEs (of those asked for) this sender may email. */
async function allowedParticipants(sender: Sender, participantIds: string[]): Promise<Set<string>> {
  if (ALL_SME_ROLES.includes(sender.role)) return new Set(participantIds);
  const programmes = await acceptedProgrammes(participantIds);
  const onProgrammes = (allowed: Set<string>) =>
    new Set(participantIds.filter((pid) => Array.from(programmes.get(pid) || []).some((id) => allowed.has(id))));

  if (sender.role === "projectadmin") {
    const branchId = clean(sender.data.assignedBranch) || clean(sender.data.branchId);
    if (!branchId) return new Set();
    const programs = await db.collection("programs").get();
    const branchProgrammes = new Set(programs.docs.filter((doc) => programBranchId(doc.data()) === branchId).map((doc) => doc.id));
    return onProgrammes(branchProgrammes);
  }

  if (sender.role === "operations") {
    // As the programme switcher: the active programmes their department takes part in
    // (or that list no departments); without a department, every active programme.
    const departmentId = clean(sender.data.departmentId);
    const programs = await db.collection("programs").get();
    const theirs = programs.docs.filter((doc) => {
      const data = doc.data();
      if (data.isActive === false) return false;
      const ids = data.participatingDepartmentIds;
      return !departmentId || !Array.isArray(ids) || ids.length === 0 || ids.includes(departmentId);
    });
    return onProgrammes(new Set(theirs.map((doc) => doc.id)));
  }

  if (sender.role === "coordinator") {
    const assigned = Array.isArray(sender.data.assignedPrograms) ? sender.data.assignedPrograms : [sender.data.assignedProgramId];
    const allowed = onProgrammes(new Set(assigned.map(idOf).filter(Boolean)));
    const remaining = participantIds.filter((pid) => !allowed.has(pid));
    const ownerIds = Array.from(new Set([sender.docId, sender.uid].filter(Boolean)));
    for (let i = 0; i < remaining.length; i += 30) {
      const snap = await db.collection("assignedInterventions")
        .where("participantId", "in", remaining.slice(i, i + 30))
        .select("participantId", "assigneeId")
        .get();
      snap.docs
        .filter((doc) => ownerIds.includes(clean(doc.get("assigneeId"))))
        .forEach((doc) => allowed.add(clean(doc.get("participantId"))));
    }
    return allowed;
  }

  return new Set();
}

type Recipient = { participantId: string; name: string; email: string | null };

async function resolveRecipient(participantId: string): Promise<Recipient> {
  const snap = await db.collection("participants").doc(participantId).get();
  const data = snap.data() || {};
  const name = clean(data.beneficiaryName) || clean(data.companyName) || clean(data.name) || "SME";
  let email = clean(data.email).toLowerCase();
  if (!EMAIL_RX.test(email) && clean(data.uid)) {
    const user = await db.collection("users").doc(clean(data.uid)).get();
    email = clean(user.get("email")).toLowerCase();
  }
  return { participantId, name, email: EMAIL_RX.test(email) ? email : null };
}

function buildHtml(body: string, sender: Sender, recipientName: string) {
  const paragraphs = body.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join("");
  const roleLabel = ROLE_LABELS[sender.role] || "Staff";
  return `
<div style="font-family:Inter,Arial,sans-serif;line-height:1.55;font-size:14px;color:#111827;max-width:640px">
  <p>Dear ${escapeHtml(recipientName)},</p>
  ${paragraphs}
  <p style="margin-top:24px">Kind regards,<br><strong>${escapeHtml(sender.name)}</strong><br>${escapeHtml(roleLabel)}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="font-size:12px;color:#6b7280">Sent through the Smart Incubation platform. Reply to this email to reach ${escapeHtml(sender.name)}, or sign in at <a href="${APP_BASE_URL}">${APP_BASE_URL.replace(/^https?:\/\//, "")}</a>.</p>
</div>`;
}

const buildText = (body: string, sender: Sender, recipientName: string) =>
  `Dear ${recipientName},\n\n${body}\n\nKind regards,\n${sender.name}\n${ROLE_LABELS[sender.role] || "Staff"}`;

// One counter per sender per day (SAST), reserved before sending so two tabs can't
// both slip under the limit.
async function reserveDailyQuota(senderUid: string, count: number) {
  const day = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const ref = db.collection("userMessageQuota").doc(`${senderUid}_${day}`);
  await db.runTransaction(async (tx) => {
    const used = Number((await tx.get(ref)).get("count") || 0);
    if (used + count > DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", `That would pass the daily limit of ${DAILY_LIMIT} messages (${used} sent today).`);
    }
    tx.set(ref, { senderUid, day, count: used + count, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

export type SendUserMessageResult = {
  sent: number;
  skipped: { participantId: string; name: string; reason: "not_permitted" | "no_email" | "failed" }[];
};

export const sendUserMessage = onCall({ region: "us-central1", cors: true }, async (req): Promise<SendUserMessageResult> => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
  const sender = await loadSender(req.auth.uid);
  if (!MESSAGE_SENDER_ROLES.includes(sender.role)) {
    throw new HttpsError("permission-denied", "Your role cannot send messages to SMEs.");
  }

  const participantIds = Array.from(new Set((Array.isArray(req.data?.participantIds) ? req.data.participantIds : []).map(clean).filter(Boolean))) as string[];
  const subject = clean(req.data?.subject);
  const body = String(req.data?.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!participantIds.length) throw new HttpsError("invalid-argument", "Choose at least one SME.");
  if (participantIds.length > MAX_RECIPIENTS) throw new HttpsError("invalid-argument", `You can message up to ${MAX_RECIPIENTS} SMEs at a time.`);
  if (!subject || subject.length > MAX_SUBJECT) throw new HttpsError("invalid-argument", "Add a subject (up to 200 characters).");
  if (!body || body.length > MAX_BODY) throw new HttpsError("invalid-argument", "Add a message (up to 10,000 characters).");

  const allowed = await allowedParticipants(sender, participantIds);
  await reserveDailyQuota(sender.uid, participantIds.filter((pid) => allowed.has(pid)).length);
  const result: SendUserMessageResult = { sent: 0, skipped: [] };
  const batchId = db.collection("userMessages").doc().id;

  for (const participantId of participantIds) {
    const recipient = await resolveRecipient(participantId);
    if (!allowed.has(participantId)) {
      result.skipped.push({ participantId, name: recipient.name, reason: "not_permitted" });
      continue;
    }
    if (!recipient.email) {
      result.skipped.push({ participantId, name: recipient.name, reason: "no_email" });
      continue;
    }

    let status: "sent" | "failed" = "sent";
    let error: string | null = null;
    try {
      await sendSystemEmail({
        to: recipient.email,
        subject,
        html: buildHtml(body, sender, recipient.name),
        text: buildText(body, sender, recipient.name),
        replyTo: sender.email || undefined,
      });
      result.sent += 1;
    } catch (err) {
      status = "failed";
      error = String((err as Error)?.message || err);
      result.skipped.push({ participantId, name: recipient.name, reason: "failed" });
      logger.error("user_message.send_failed", { participantId, sender: sender.uid, error });
    }

    await db.collection("userMessages").add({
      batchId,
      channel: "email",
      participantId,
      participantName: recipient.name,
      to: recipient.email,
      subject,
      body,
      status,
      error,
      sentBy: sender.uid,
      sentByName: sender.name,
      sentByRole: sender.role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logger.info("user_message.batch", { batchId, sender: sender.uid, role: sender.role, sent: result.sent, skipped: result.skipped.length });
  return result;
});
