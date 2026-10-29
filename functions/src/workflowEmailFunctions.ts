import * as logger from "firebase-functions/logger";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { suppressRecordNotifications } from "./syntheticData";
import { onRequest } from "firebase-functions/v2/https";
import { admin, APP_BASE_URL, db, getHODRecipients, getTransporter } from "./emailShared";
import { getDepartmentHods, resolveMovDepartmentId, uidsForEmails } from "./movRecipients";
import { logBrevoSend, sendViaBrevo } from "./brevoClient";
import { notifyInApp, uidForEmail, uidForParticipant } from "./inAppNotifications";
import { BREVO_EGRESS } from "./config";
import { departmentNameOf } from "./departmentRoles";

type Doc = Record<string, any>;
const REGION = "us-central1";
const FROM = () => process.env.SMTP_FROM || process.env.SMTP_USER!;
const LOGIN_URL = APP_BASE_URL.replace(/\/$/, "");

/** Sends and logs a direct SME intervention reminder. The client supplies
 * only the assignment context; the recipient is resolved server-side from the
 * participant record. The in-app copy uses 'intervention_reminder_sme', which
 * is deliberately absent from NOTIFICATION_REGISTRY so it never emails twice. */
export const sendInterventionReminderEmail = onRequest(
  { ...BREVO_EGRESS, region: REGION, cors: true },
  (req, res) => {
    (async () => {
    let recipientEmail: string | null = null;
    let participantId = '';
    let programId: string | null = null;
    let subject = 'Reminder: action required on your intervention';
    try {
      const match = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
      if (!match) return res.status(401).json({ ok: false, error: 'Missing or invalid auth.' });
      await admin.auth().verifyIdToken(match[1]);

      const body = req.body || {};
      participantId = clean(body.participantId);
      programId = clean(body.programId) || null;
      const interventionTitle = clean(body.interventionTitle) || 'your intervention';
      const participantName = clean(body.participantName);
      const reminderReason = clean(body.reminderReason) || 'confirmation';
      if (!participantId) return res.status(400).json({ ok: false, error: 'Missing participantId.' });
      const sourceParticipant = await db.collection('participants').doc(participantId).get();
      // A seeded assignment on a real participant must not email them either.
      const assignmentId = clean(body.assignedInterventionId);
      const assignment = assignmentId ? (await db.collection('assignedInterventions').doc(assignmentId).get()).data() : null;
      if (suppressRecordNotifications(sourceParticipant.data(), participantId) || suppressRecordNotifications({ programId }) || (assignment && suppressRecordNotifications(assignment, assignmentId))) {
        return res.status(200).json({ ok: true, suppressed: true });
      }

      const recipient = await participant({
        participantId,
        participantEmail: body.participantEmail,
        participantName,
      });
      recipientEmail = recipient.email;
      if (!recipientEmail) return res.status(422).json({ ok: false, error: 'No valid participant email found.' });

      subject = `Reminder: action required for ${interventionTitle}`;
      const action = reminderReason === 'confirmation'
        ? 'Please confirm completion of this intervention in the incubatee dashboard.'
        : 'Please review and respond to this intervention in the incubatee dashboard.';
      const content = buildNotificationContent('Intervention reminder', [
        `Hello ${recipient.name || participantName || 'there'},`,
        action,
        interventionTitle,
      ], '/incubatee/interventions');

      const { messageId } = await sendViaBrevo({ to: recipientEmail, subject, html: content.html, text: content.text, tags: ['intervention-reminder'] });
      await logBrevoSend({ type: 'INTERVENTION_REMINDER', to: recipientEmail, subject, status: 'sent', messageId, participantId, programId });
      await notifyInApp({
        type: 'intervention_reminder_sme',
        message: `Reminder for ${interventionTitle}: ${action.replace(' in the incubatee dashboard', '')}`,
        recipientIds: [await uidForParticipant(participantId, recipientEmail)],
        participantId,
        programId,
        link: '/incubatee/interventions',
      });
      return res.status(200).json({ ok: true, sent: 1, email: recipientEmail });
    } catch (err: any) {
      const error = String(err?.message || err);
      await logBrevoSend({ type: 'INTERVENTION_REMINDER', to: recipientEmail || '', subject, status: 'failed', error, participantId: participantId || null, programId });
      logger.error('sendInterventionReminderEmail.failed', { error, participantId, programId });
      return res.status(500).json({ ok: false, error: error || 'Failed to send reminder.' });
    }
    })();
  },
);

export function clean(value: any) {
  return String(value ?? "").trim();
}

function email(value: any): string | null {
  const result = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null;
}

function esc(value: any) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function status(value: any) {
  return clean(value).toLowerCase();
}

function changedTo(before: Doc | undefined, after: Doc, allowed: string[]) {
  const next = status(after.status);
  return allowed.includes(next) && (!before || status(before.status) !== next);
}

function notificationPatch(key: string, state: string, to: string) {
  return {
    [`emailNotifications.${key}.${state}.sentAt`]: admin.firestore.FieldValue.serverTimestamp(),
    [`emailNotifications.${key}.${state}.to`]: to,
  };
}

export function buildNotificationContent(heading: string, lines: string[], actionPath?: string, extraHtml?: string) {
  const safeLines = lines.filter(Boolean);
  const actionUrl = actionPath ? `${LOGIN_URL}${actionPath}` : LOGIN_URL;
  const html = `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6">
    <h2>${esc(heading)}</h2>
    ${safeLines.map((line) => `<p>${esc(line)}</p>`).join("")}
    <p><a href="${esc(actionUrl)}" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px">Open Smart Incubation</a></p>
    ${extraHtml || ""}
    <p>Regards,<br><b>Lepharo Smart Incubation System</b></p>
  </div>`;
  const text = `${heading}\n\n${safeLines.join("\n\n")}\n\nOpen Smart Incubation: ${actionUrl}`;
  return { html, text };
}

async function send(to: string, subject: string, heading: string, lines: string[], actionPath?: string) {
  const { html, text } = buildNotificationContent(heading, lines, actionPath);
  await getTransporter().sendMail({ from: FROM(), to, subject, html, text });
}

async function userEmail(data: Doc): Promise<string | null> {
  const direct = [
    data.userEmail, data.requesterEmail, data.requestedByEmail,
    data.participantEmail, data.applicantEmail, data.email,
  ].map(email).find(Boolean);
  if (direct) return direct;
  if (email(data.requestedBy)) return email(data.requestedBy);
  const id = clean(data.userId || data.requesterId || data.requestedByUid);
  if (!id) return null;
  const snap = await db.collection("users").doc(id).get();
  return email(snap.data()?.email);
}

/** The requester's uid for the in-app copy of a decision email. */
async function requesterUid(data: Doc, to: string): Promise<string | null> {
  return clean(data.userId || data.requesterId || data.requestedByUid) || uidForEmail(to);
}

export async function participant(data: Doc): Promise<{ email: string | null; name: string }> {
  const direct = email(data.participantEmail || data.applicantEmail || data.userEmail);
  const id = clean(data.participantId);
  if (direct) return { email: direct, name: clean(data.participantName || data.beneficiaryName) || "Participant" };
  if (id) {
    const p = await db.collection("participants").doc(id).get();
    if (p.exists) {
      const d = p.data() || {};
      return {
        email: email(d.email || d.contactEmail),
        name: clean(d.beneficiaryName || d.participantName || data.participantName) || "Participant",
      };
    }
    const apps = await db.collection("applications").where("participantId", "==", id).limit(1).get();
    if (!apps.empty) {
      const d = apps.docs[0].data();
      return {
        email: email(d.applicantEmail || d.email),
        name: clean(d.applicantName || d.businessOwnerName || data.participantName) || "Participant",
      };
    }
  }
  return { email: null, name: clean(data.participantName || data.beneficiaryName) || "Participant" };
}

export async function assignee(data: Doc): Promise<{ email: string | null; name: string }> {
  const direct = email(data.assigneeEmail);
  const id = clean(data.assigneeId);
  if (direct) return { email: direct, name: clean(data.assigneeName) || "Facilitator" };
  if (id) {
    for (const collection of ["coordinators", "users"]) {
      const snap = await db.collection(collection).doc(id).get();
      if (snap.exists) {
        const d = snap.data() || {};
        const found = email(d.email);
        if (found) return { email: found, name: clean(d.name || d.displayName || data.assigneeName) || "Facilitator" };
      }
    }
  }
  return { email: null, name: clean(data.assigneeName) || "Facilitator" };
}

/** Resolves a notification's target user (e.g. a workflow query resolver) by
 * uid -- a fresh users/{uid} lookup rather than a payload snapshot, so it
 * reflects the user's current email even if it changed after the doc was
 * assigned. */
export async function resolverEmail(data: Doc): Promise<{ email: string | null; name: string }> {
  const uid = clean(data.recipientIds?.[0]) || clean(data.resolverId);
  if (!uid) return { email: null, name: "there" };
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return { email: null, name: "there" };
  const d = snap.data() || {};
  return { email: email(d.email), name: clean(d.name || d.displayName) || "there" };
}

export const onLeaveRequestDecisionEmail = onDocumentWritten(
  { region: REGION, document: "leaveRequests/{requestId}" },
  async (event) => {
    const before = event.data?.before.data() as Doc | undefined;
    const after = event.data?.after.data() as Doc | undefined;
    if (!after || !changedTo(before, after, ["approved", "rejected"])) return;
    const decision = status(after.status);
    const to = await userEmail(after);
    if (!to) return logger.warn("leave_email.no_recipient", { requestId: event.params.requestId });
    await send(to, `Leave request ${decision}`, "Leave request decision", [
      `Hello ${clean(after.userName) || "there"},`,
      `Your ${clean(after.type || after.leaveType) || "leave"} request has been ${decision}.`,
      after.from || after.startDate ? `From: ${clean(after.from || after.startDate)}` : "",
      after.to || after.endDate ? `To: ${clean(after.to || after.endDate)}` : "",
      decision === "rejected" && after.rejectionReason ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/operations/hr/leave");
    await notifyInApp({
      type: `leave_${decision}`,
      message: `Your ${clean(after.type || after.leaveType) || "leave"} request has been ${decision}.`,
      recipientIds: [await requesterUid(after, to)],
      leaveRequestId: event.params.requestId,
      link: "/leave",
    });
    await event.data!.after.ref.update(notificationPatch("leaveDecision", decision, to));
  },
);

export const onResourceRequestDecisionEmail = onDocumentWritten(
  { region: REGION, document: "resourceRequests/{requestId}" },
  async (event) => {
    const before = event.data?.before.data() as Doc | undefined;
    const after = event.data?.after.data() as Doc | undefined;
    if (!after || !changedTo(before, after, ["approved", "rejected"])) return;
    const decision = status(after.status);
    const to = await userEmail(after);
    if (!to) return logger.warn("resource_email.no_recipient", { requestId: event.params.requestId });
    await send(to, `Resource request ${decision}`, "Resource request decision", [
      `Your request for ${clean(after.resourceName) || "a resource"} has been ${decision}.`,
      after.purpose ? `Purpose: ${clean(after.purpose)}` : "",
      decision === "rejected" && after.rejectionReason ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/resources/internal");
    await notifyInApp({
      type: `resource_request_${decision}`,
      message: `Your request for ${clean(after.resourceName) || "a resource"} has been ${decision}.`,
      recipientIds: [await requesterUid(after, to)],
      resourceRequestId: event.params.requestId,
      link: "/resources/internal",
    });
    await event.data!.after.ref.update(notificationPatch("resourceDecision", decision, to));
  },
);

/**
 * In-app notice to the HODs of the requested intervention's department when
 * an SME asks for one. Done here rather than in the SME's browser because the
 * SME can't read staff user docs; addressed by uid so it doesn't reach every
 * operations user across all companies. Falls back to all HODs (still by uid)
 * only when the department is unknown or has none, so a request isn't missed.
 */
export const onInterventionRequestCreated = onDocumentCreated(
  { region: REGION, document: "interventionRequests/{requestId}" },
  async (event) => {
    const after = event.data?.data() as Doc | undefined;
    if (!after || suppressRecordNotifications(after, event.params.requestId)) return;

    const departmentId = await resolveMovDepartmentId(after);
    let recipientIds = departmentId ? (await getDepartmentHods(departmentId)).uids : [];
    if (!recipientIds.length) {
      logger.warn("intervention_request_in_app.hodFallback", { requestId: event.params.requestId, departmentId });
      recipientIds = await uidsForEmails(await getHODRecipients());
    }

    const title = clean(after.interventionTitle) || "an intervention";
    const departmentName = await departmentNameOf(departmentId);
    await notifyInApp({
      type: "intervention-request",
      message: `A new intervention "${title}" has been requested${departmentName ? ` in ${departmentName}` : ""}.` +
        (clean(after.reason) ? ` Reason: ${clean(after.reason)}` : ""),
      recipientIds,
      interventionRequestId: event.params.requestId,
      participantId: after.participantId,
      programId: after.programId,
      departmentId,
      interventionTitle: after.interventionTitle,
      link: "/operations/requests",
    });
  },
);

export const onInterventionRequestDecisionEmail = onDocumentWritten(
  { region: REGION, document: "interventionRequests/{requestId}" },
  async (event) => {
    const before = event.data?.before.data() as Doc | undefined;
    const after = event.data?.after.data() as Doc | undefined;
    if (!after || !changedTo(before, after, ["accepted", "approved", "rejected", "declined"])) return;
    const decision = status(after.status);
    const recipient = await participant(after);
    if (!recipient.email) return logger.warn("intervention_request_email.no_recipient", { requestId: event.params.requestId });
    const requested = clean(after.interventionTitle) || await departmentNameOf(after.departmentId) || "an intervention";
    await send(recipient.email, `Intervention request ${decision}`, "Intervention request decision", [
      `Hello ${recipient.name},`,
      `Your request for ${requested} has been ${decision}.`,
      after.reason ? `Your request: ${clean(after.reason)}` : "",
      (decision === "rejected" || decision === "declined") && after.rejectionReason
        ? `Reason: ${clean(after.rejectionReason)}` : "",
    ], "/incubatee/interventions");
    await notifyInApp({
      type: `intervention_request_${decision}`,
      message: `Your request for ${requested} has been ${decision}.`,
      recipientIds: [await uidForParticipant(after.participantId, recipient.email)],
      interventionRequestId: event.params.requestId,
      participantId: after.participantId,
      link: "/incubatee/interventions",
    });
    await event.data!.after.ref.update(notificationPatch("interventionDecision", decision, recipient.email));
  },
);

export const onAssignedInterventionEmail = onDocumentWritten(
  { region: REGION, document: "assignedInterventions/{assignmentId}" },
  async (event) => {
    const before = event.data?.before.data() as Doc | undefined;
    const after = event.data?.after.data() as Doc | undefined;
    if (!after) return;
    // Seeded or test data opts out of every assignment email by setting this on the document.
    if (suppressRecordNotifications(after, event.params.assignmentId)) return;
    const ref = event.data!.after.ref;
    const title = clean(after.interventionTitle || after.title) || "Intervention";
    const assigneeUid = clean(after.assigneeId);
    const smeUid = () => uidForParticipant(after.participantId, after.participantEmail);
    const inApp = (type: string, message: string, recipientIds: Array<string | null>, link: string) =>
      notifyInApp({ type, message, recipientIds, assignedInterventionId: event.params.assignmentId, participantId: after.participantId, link });

    if (!before || clean(before.assigneeId) !== clean(after.assigneeId)) {
      const assigned = await assignee(after);
      const sme = await participant(after);
      if (assigned.email) {
        await send(assigned.email, `Intervention assigned: ${title}`, "New intervention assignment", [
          `Hello ${assigned.name},`,
          `${title} has been assigned to you for ${sme.name}.`,
          after.dueDate ? `Due date: ${clean(after.dueDate)}` : "",
        ], "/coordinator/allocated");
        await ref.update(notificationPatch("assignment", "assignee", assigned.email));
      }
      if (sme.email) {
        await send(sme.email, `Intervention assigned: ${title}`, "Your intervention has been assigned", [
          `Hello ${sme.name},`,
          `${title} has been assigned to ${assigned.name}.`,
          "Please sign in to review and accept the intervention.",
        ], "/incubatee/interventions");
        await ref.update(notificationPatch("assignment", "participant", sme.email));
      }
      await inApp("intervention_assigned", `${title} has been assigned to you for ${sme.name}.`, [assigneeUid], "/coordinator/allocated");
      await inApp("intervention_assigned_sme", `${title} has been assigned to ${assigned.name}. Please review and accept it.`, [await smeUid()], "/incubatee/interventions");
    }

    if (before && status(before.assigneeCompletionStatus) !== "completed" &&
        status(after.assigneeCompletionStatus) === "completed") {
      const sme = await participant(after);
      if (sme.email) {
        await send(sme.email, `Please confirm completion: ${title}`, "Completion confirmation required", [
          `Hello ${sme.name},`,
          `The facilitator marked ${title} as completed.`,
          "Please review the work and confirm or reject completion.",
        ], "/incubatee/interventions");
        await ref.update(notificationPatch("assignmentLifecycle", "completionRequested", sme.email));
      }
      await inApp("intervention_completion_requested", `The facilitator marked ${title} as completed. Please confirm or reject completion.`, [await smeUid()], "/incubatee/interventions");
    }

    if (before && status(before.participantAcceptanceStatus) !== status(after.participantAcceptanceStatus) &&
        ["accepted", "declined"].includes(status(after.participantAcceptanceStatus))) {
      const assigned = await assignee(after);
      if (assigned.email) {
        const decision = status(after.participantAcceptanceStatus);
        await send(assigned.email, `Participant ${decision}: ${title}`, "Intervention acceptance update", [
          `${clean(after.participantName) || "The participant"} has ${decision} ${title}.`,
        ], "/coordinator/allocated");
        await ref.update(notificationPatch("assignmentLifecycle", `participant${decision}`, assigned.email));
      }
      const decision = status(after.participantAcceptanceStatus);
      await inApp(`intervention-${decision}`, `${clean(after.participantName) || "The participant"} has ${decision} ${title}.`, [assigneeUid], "/coordinator/allocated");
    }

    if (before && status(before.participantCompletionStatus) !== status(after.participantCompletionStatus) &&
        ["confirmed", "rejected"].includes(status(after.participantCompletionStatus))) {
      const assigned = await assignee(after);
      if (assigned.email) {
        const decision = status(after.participantCompletionStatus);
        const reason = clean(after.participantCompletionRejectionReason);
        await send(assigned.email, `Completion ${decision}: ${title}`, "Completion review update", [
          `${clean(after.participantName) || "The participant"} has ${decision} completion of ${title}.`,
          ...(decision === "rejected" && reason ? [`Their reason: “${reason}”`, "Correct it, deliver what's missing, or explain in the system; the HOD decides if you can't agree."] : []),
        ], "/coordinator/allocated");
        await ref.update(notificationPatch("assignmentLifecycle", `completion${decision}`, assigned.email));
      }
      const decision = status(after.participantCompletionStatus);
      // A rejection's in-app notice (with the reason) comes from onWorkflowQueryChanged, as a delivery dispute.
      if (decision === "confirmed") {
        await inApp("intervention-confirmed", `${clean(after.participantName) || "The participant"} has confirmed completion of ${title}.`, [assigneeUid], "/coordinator/allocated");
      }
    }
  },
);

// `intervention_reminder` notification emails are now handled generically by
// onNotificationCreatedEmail (see notificationEmailFanout.ts), which looks up
// NOTIFICATION_REGISTRY by `type` instead of hardcoding one type here. Do not
// re-add a per-type trigger on `notifications/{id}` in this file -- two
// triggers on the same new-doc guard would double-send.
