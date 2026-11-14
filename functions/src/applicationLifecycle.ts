import { scheduledJob } from "./cronHeartbeat";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { APP_BASE_URL, admin, db, sendStatusChangeNotification } from "./emailShared";
import { departmentIdsForRole } from "./departmentRoles";
import { getProgramProjectAdmins } from "./movRecipients";
import { suppressRecordNotifications } from "./syntheticData";
import {
  ESCALATE_AFTER_DAYS,
  REMINDER_AFTER_DAYS,
  escalationStep,
  historyEntryFor,
  normaliseStatus,
  pendingSince,
} from "./applicationLifecycleLogic";

// Audit trail and stalled-application escalation for `applications`.
//
// History: every status change, from any writer (the Applications page,
// onboarding, imports, scripts), is appended to `applicationHistory` by this
// trigger. The collection is server-written only, so it can't be edited from
// the app (firestore.rules).
//
// Escalation: a pending application is chased daily. ROM staff get a reminder
// after REMINDER_AFTER_DAYS; after ESCALATE_AFTER_DAYS the programme's project
// admins are added, and it repeats weekly until a decision is made. Each step
// is sent once, tracked in `applicationEscalations`.

const DAY_MS = 24 * 60 * 60 * 1000;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg has no DST

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const sastDayIndex = (date: Date) => Math.floor((date.getTime() + SAST_OFFSET_MS) / DAY_MS);
const dayKey = (date: Date) => new Date(date.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
const isActiveUser = (user: any) => !["inactive", "disabled", "deleted"].includes(lower(user?.status));
const isInternalEmail = (email: unknown) => lower(email).endsWith("@quantilytix.co.za");

export const onApplicationStatusHistory = onDocumentWritten(
  { region: "us-central1", document: "applications/{appId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const entry = historyEntryFor(before, after);
    if (!entry) return;
    try {
      // The event id makes a retried delivery overwrite, not duplicate.
      await db.collection("applicationHistory").doc(event.id).set({
        ...entry,
        applicationId: event.params.appId,
        participantId: clean(after?.participantId) || null,
        programId: clean(after?.programId) || null,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error("onApplicationStatusHistory.failed", { appId: event.params.appId, error: String(error) });
    }
  }
);

type Recipient = { uid: string; email: string };

async function romStaff(): Promise<Recipient[]> {
  const departmentIds = await departmentIdsForRole("rom");
  const byUid = new Map<string, Recipient>();
  for (const departmentId of departmentIds) {
    const snap = await db.collection("users").where("departmentId", "==", departmentId).get();
    snap.docs.forEach((doc) => {
      const user = doc.data() as any;
      const email = lower(user.email);
      if (isActiveUser(user) && email.includes("@")) byUid.set(doc.id, { uid: doc.id, email });
    });
  }
  return [...byUid.values()];
}

function buildContent(app: any, appId: string, level: "reminder" | "escalated", daysWaiting: number, since: string) {
  const name = clean(app.beneficiaryName || app.businessName || app.applicantName) || "An applicant";
  const programme = clean(app.programName || app.program?.name);
  const link = `${APP_BASE_URL.replace(/\/$/, "")}/applications?app=${encodeURIComponent(appId)}`;
  const heading = level === "reminder"
    ? `Application waiting ${daysWaiting} days`
    : `Escalated: application waiting ${daysWaiting} days`;
  const lead = level === "reminder"
    ? `This application has been waiting for a decision since <strong>${escapeHtml(since)}</strong>.`
    : `This application has been waiting for a decision since <strong>${escapeHtml(since)}</strong>, past the ${ESCALATE_AFTER_DAYS}-day onboarding target. It has been escalated for management attention.`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
    <h2 style="color:${level === "reminder" ? "#1457a6" : "#b42318"}">${escapeHtml(heading)}</h2>
    <p>${lead}</p>
    <div style="border:1px solid #d9e2ef;border-radius:10px;padding:14px 16px;margin:12px 0">
      <div style="font-weight:700">${escapeHtml(name)}</div>
      ${programme ? `<div style="color:#475467">${escapeHtml(programme)}</div>` : ""}
    </div>
    <p>Please accept or reject it, or note why it is on hold.</p>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Open the application</a></p>
  </div>`;
  const text = [heading, "", `${name}${programme ? ` (${programme})` : ""} has been waiting for a decision since ${since}.`, "", link].join("\n");
  return { subject: `${heading}: ${name}`, html, text, name };
}

export const stalledApplicationEscalationCron = scheduledJob("stalledApplicationEscalationCron",
  {
    region: "us-central1",
    schedule: "30 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const today = sastDayIndex(new Date());
    // Older apps store other spellings of pending, so filter in code.
    const snapshot = await db.collection("applications").get();
    const rom = await romStaff();

    let stalled = 0;
    let sent = 0;

    for (const appSnap of snapshot.docs) {
      const app = appSnap.data() as any;
      if (normaliseStatus(app.applicationStatus) !== "pending") continue;
      if (suppressRecordNotifications(app, appSnap.id)) continue;
      if (isInternalEmail(app.applicantEmail || app.email)) continue;
      const since = pendingSince(app);
      if (!since) continue;

      const daysWaiting = today - sastDayIndex(since);
      const step = escalationStep(daysWaiting);
      if (!step) continue;
      stalled += 1;

      // The ledger id includes the waiting-since date, so a reopened
      // application starts its cadence again.
      const ledgerRef = db.collection("applicationEscalations").doc(`${appSnap.id}__${dayKey(since)}__${step.key}`);
      if ((await ledgerRef.get()).exists) continue;

      const recipients = new Map(rom.map((r) => [r.uid, r]));
      if (step.level === "escalated") {
        const { uids } = await getProgramProjectAdmins(app.programId);
        for (const uid of uids) {
          const user = (await db.collection("users").doc(uid).get()).data();
          const email = lower(user?.email);
          if (user && isActiveUser(user) && email.includes("@")) recipients.set(uid, { uid, email });
        }
      }
      if (!recipients.size) {
        logger.warn("stalledApplicationEscalationCron.noRecipients", { appId: appSnap.id, step: step.key });
        continue;
      }

      const sinceLabel = dayKey(since);
      const content = buildContent(app, appSnap.id, step.level, daysWaiting, sinceLabel);
      const list = [...recipients.values()];

      try {
        await sendStatusChangeNotification(list.map((r) => r.email), content.subject, content.html, content.text);
      } catch (error) {
        logger.error("stalledApplicationEscalationCron.emailFailed", { appId: appSnap.id, error: String(error) });
      }

      await db.collection("notifications").add({
        type: step.level === "reminder" ? "application_stalled_reminder" : "application_stalled_escalated",
        message: step.level === "reminder"
          ? `${content.name}'s application has been waiting ${daysWaiting} days for a decision.`
          : `Escalated: ${content.name}'s application has been waiting ${daysWaiting} days for a decision.`,
        recipientIds: list.map((r) => r.uid),
        applicationId: appSnap.id,
        programId: clean(app.programId) || null,
        link: `/applications?app=${appSnap.id}`,
        createdAt: new Date(),
        readBy: {},
      });

      await ledgerRef.set({
        applicationId: appSnap.id,
        step: step.key,
        level: step.level,
        pendingSince: sinceLabel,
        daysWaiting,
        recipientCount: list.length,
        sentAt: new Date(),
      });
      sent += 1;
    }

    logger.info("stalledApplicationEscalationCron.complete", {
      applications: snapshot.size,
      stalled,
      sent,
      reminderAfterDays: REMINDER_AFTER_DAYS,
      escalateAfterDays: ESCALATE_AFTER_DAYS,
    });
  }
);
