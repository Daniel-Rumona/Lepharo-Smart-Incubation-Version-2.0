import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";

// Chases operational challenges (operationalChallenges) that are approaching or past their
// due date and are not yet resolved. The recipient is asked whether the challenge has been
// mitigated and, if not, why not - the answer is captured in the app's "Due-date check-in"
// form (success-challenges page) and stored on the challenge as a checkIns entry.
//
// Cadence (per challenge + due date): a heads-up 3 days before, a check-in on the due date,
// then overdue chasers at +1 day, +4 days and every 7 days after that. The ledger id includes
// the due date, so rescheduling a challenge restarts the cadence for the new date.

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

const isClosedStatus = (value: unknown) => ["resolved", "closed"].includes(lower(value));
const isActiveUser = (user: any) => !["inactive", "disabled", "deleted"].includes(lower(user?.status));

/** Whole calendar day index in South African time. */
const sastDayIndex = (date: Date) => Math.floor((date.getTime() + SAST_OFFSET_MS) / DAY_MS);
const dayKey = (date: Date) => new Date(date.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);

type Phase = { key: string; kind: "upcoming" | "due" | "overdue"; daysOverdue: number };

/** Which reminder phase (if any) a challenge is in. Ledger dedupes so a phase is only sent once. */
export function challengeReminderPhase(daysUntilDue: number): Phase | null {
  if (daysUntilDue > 3) return null;
  if (daysUntilDue > 0) return { key: "upcoming-3", kind: "upcoming", daysOverdue: 0 };
  if (daysUntilDue === 0) return { key: "due-today", kind: "due", daysOverdue: 0 };
  const overdue = -daysUntilDue;
  if (overdue < 4) return { key: "overdue-1", kind: "overdue", daysOverdue: overdue };
  if (overdue < 8) return { key: "overdue-4", kind: "overdue", daysOverdue: overdue };
  return { key: `overdue-${4 + Math.floor((overdue - 4) / 7) * 7}`, kind: "overdue", daysOverdue: overdue };
}

async function resolveRecipients(challenge: any): Promise<{ uid: string; email: string }[]> {
  const byEmail = new Map<string, { uid: string; email: string }>();
  const add = (uid: string, user: any) => {
    if (!isActiveUser(user)) return;
    const email = lower(user?.email);
    if (email.includes("@") && !byEmail.has(email)) byEmail.set(email, { uid, email });
  };

  // The person who logged the challenge owns the follow-up.
  const creatorId = clean(challenge.createdById);
  if (creatorId) {
    const creator = await db.collection("users").doc(creatorId).get();
    if (creator.exists) add(creator.id, creator.data());
  }

  // "operations" is this system's department-manager role (same mapping kpiReminders.ts uses).
  const departmentId = clean(challenge.departmentId);
  if (departmentId) {
    const snapshot = await db.collection("users").where("departmentId", "==", departmentId).get();
    snapshot.docs.forEach((doc) => {
      const user = doc.data() as any;
      if (lower(user.role) === "operations") add(doc.id, user);
    });
  }
  return [...byEmail.values()];
}

function buildContent(challenge: any, challengeId: string, phase: Phase, dueLabel: string) {
  const title = clean(challenge.title) || "Operational challenge";
  const link = `${APP_BASE_URL.replace(/\/$/, "")}/operations/success-challenges?challenge=${encodeURIComponent(challengeId)}&checkin=1`;
  const heading = phase.kind === "upcoming"
    ? "Challenge due soon"
    : phase.kind === "due"
      ? "Challenge due today"
      : `Challenge overdue by ${phase.daysOverdue} day${phase.daysOverdue === 1 ? "" : "s"}`;
  const lead = phase.kind === "upcoming"
    ? `The following challenge is due on <strong>${escapeHtml(dueLabel)}</strong>. Is the mitigation on track?`
    : phase.kind === "due"
      ? `The following challenge is due <strong>today</strong> (${escapeHtml(dueLabel)}). Has it been mitigated?`
      : `The following challenge was due on <strong>${escapeHtml(dueLabel)}</strong> and has not been marked as resolved. Has it been mitigated?`;
  const steps: string[] = Array.isArray(challenge.mitigationSteps) ? challenge.mitigationSteps.map(clean).filter(Boolean) : [];

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
    <h2 style="color:#1457a6">${escapeHtml(heading)}</h2>
    <p>${lead}</p>
    <div style="border:1px solid #d9e2ef;border-radius:10px;padding:14px 16px;margin:12px 0">
      <div style="font-weight:700">${escapeHtml(title)}</div>
      ${clean(challenge.details) ? `<div style="margin-top:6px;color:#475467">${escapeHtml(challenge.details)}</div>` : ""}
      ${steps.length ? `<div style="margin-top:10px"><strong>Proposed mitigation</strong><ol style="margin:6px 0 0 18px;padding:0">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol></div>` : ""}
    </div>
    <p>Please complete the short check-in and tell us:</p>
    <ul>
      <li>Has the challenge been mitigated?</li>
      <li>If not, why not, and what is blocking it?</li>
      <li>What support you need and the new target date</li>
    </ul>
    <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Complete the check-in</a></p>
  </div>`;
  const text = [
    heading,
    "",
    phase.kind === "overdue"
      ? `"${title}" was due on ${dueLabel} and is not marked as resolved. Has it been mitigated?`
      : `"${title}" is due ${phase.kind === "due" ? "today" : `on ${dueLabel}`}. Has it been mitigated?`,
    "",
    "Please complete the check-in: has it been mitigated, if not why not, what support you need, and the new target date.",
    link,
  ].join("\n");

  return { subject: `${heading}: ${title}`, html, text, title };
}

export const challengeDueReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const today = sastDayIndex(now);
    const snapshot = await db.collection("operationalChallenges").get();

    let scanned = 0;
    let remindersSent = 0;

    for (const challengeSnap of snapshot.docs) {
      const challenge = challengeSnap.data() as any;
      if (isClosedStatus(challenge.status)) continue;
      const due: Date | null = challenge.dueDate?.toDate?.() || null;
      if (!due) continue;
      scanned += 1;

      const phase = challengeReminderPhase(sastDayIndex(due) - today);
      if (!phase) continue;

      const ledgerRef = db.collection("challengeReminderNotifications").doc(`${challengeSnap.id}__${dayKey(due)}__${phase.key}`);
      if ((await ledgerRef.get()).exists) continue;

      const recipients = await resolveRecipients(challenge);
      if (!recipients.length) {
        logger.warn("challengeDueReminderCron.noRecipients", { challengeId: challengeSnap.id });
        continue;
      }

      const dueLabel = dayKey(due);
      const content = buildContent(challenge, challengeSnap.id, phase, dueLabel);

      try {
        await sendStatusChangeNotification(recipients.map((r) => r.email), content.subject, content.html, content.text);
      } catch (error) {
        logger.error("challengeDueReminderCron.emailFailed", { challengeId: challengeSnap.id, error: String(error) });
      }

      await db.collection("notifications").add({
        type: "challenge_due_reminder",
        message: phase.kind === "overdue"
          ? `Overdue: "${content.title}" was due ${dueLabel}. Has it been mitigated?`
          : `"${content.title}" is due ${phase.kind === "due" ? "today" : dueLabel}. Has it been mitigated?`,
        recipientIds: recipients.map((r) => r.uid),
        challengeId: challengeSnap.id,
        challengeTitle: content.title,
        phase: phase.key,
        link: `/operations/success-challenges?challenge=${challengeSnap.id}&checkin=1`,
        createdAt: new Date(),
        readBy: {},
      });

      await ledgerRef.set({
        challengeId: challengeSnap.id,
        phase: phase.key,
        dueDate: dueLabel,
        recipientCount: recipients.length,
        sentAt: new Date(),
      });

      remindersSent += 1;
    }

    logger.info("challengeDueReminderCron.complete", { challengesScanned: scanned, remindersSent });
  }
);
