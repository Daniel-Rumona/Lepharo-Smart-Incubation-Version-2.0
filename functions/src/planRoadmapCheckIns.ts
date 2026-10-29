import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";
import {
  checkInDue,
  checkInMissed,
  isDone,
  monthKey,
  nextDueDate,
  reminderStage,
  shouldEscalateMilestone,
  shouldEscalateMissedCheckIns,
  summarizeProgress,
  type ReminderStage,
} from "./planRoadmapLogic";

// Tracks HODs against their published implementation-plan roadmap
// (planRoadmaps/{id} + milestones subcollection, drafted by the AI backend's
// /plans/extract-roadmap and published by the HOD after review).
//  - milestone reminders: 7 days before, on the day, then every 3 days overdue
//  - monthly check-in with a progress summary
//  - escalation to the programme's project admin when reminders or check-ins
//    go unanswered
// One digest per roadmap per run, never one email per milestone.

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const escapeHtml = (value: unknown) => clean(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const asDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isActiveUser = (user: any) => !["inactive", "disabled", "deleted"].includes(lower(user?.status));
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "no date");
// There is no roadmap page yet, so links open the implementation-plan hub
// (the plan the roadmap was drafted from), which HODs and project admins both
// have in their nav. Point this at the roadmap page once one exists.
const ROADMAP_PATH = "/operations/documentation";
const roadmapUrl = () => `${APP_BASE_URL.replace(/\/$/, "")}${ROADMAP_PATH}`;

interface Recipient { uid: string; email: string }

// "operations" is this system's HOD/department-manager role.
async function resolveHods(departmentId: string): Promise<Recipient[]> {
  if (!departmentId) return [];
  const snap = await db.collection("users").where("departmentId", "==", departmentId).get();
  return snap.docs.flatMap((doc) => {
    const user = doc.data() as any;
    const email = lower(user.email);
    return isActiveUser(user) && lower(user.role) === "operations" && email.includes("@")
      ? [{ uid: doc.id, email }] : [];
  });
}

// Escalation contact is the programme's project admin: those assigned to the
// roadmap's programme, or every active project admin if none are assigned.
async function resolveProjectAdmins(programId: string): Promise<Recipient[]> {
  const snap = await db.collection("users").where("role", "==", "projectadmin").get();
  const admins = snap.docs.filter((doc) => {
    const user = doc.data() as any;
    return isActiveUser(user) && lower(user.email).includes("@");
  });
  const assigned = programId
    ? admins.filter((doc) => {
      const programs = (doc.data() as any).assignedPrograms;
      return Array.isArray(programs) && programs.map(clean).includes(programId);
    })
    : [];
  return (assigned.length ? assigned : admins).map((doc) => ({
    uid: doc.id,
    email: lower((doc.data() as any).email),
  }));
}

async function notify(
  recipients: Recipient[],
  type: string,
  subject: string,
  message: string,
  bodyHtml: string,
  bodyText: string,
  roadmapId: string,
  roles: string[],
) {
  if (!recipients.length) return;
  const url = roadmapUrl();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#172033;line-height:1.6;max-width:640px;margin:auto">
    <h2 style="color:#1457a6">${escapeHtml(subject)}</h2>${bodyHtml}
    <p><a href="${escapeHtml(url)}">Open the roadmap</a></p></div>`;
  try {
    await sendStatusChangeNotification(recipients.map((r) => r.email), subject, html, `${subject}\n\n${bodyText}\n\nOpen the roadmap: ${url}`);
  } catch (error) {
    logger.error("planRoadmapCheckIns.emailFailed", { roadmapId, type, error: String(error) });
  }
  await db.collection("notifications").add({
    type,
    message,
    recipientIds: recipients.map((r) => r.uid),
    // Who it is for, by role -- informational only. Addressed by uid so a
    // roadmap reminder never reaches every user who merely shares the role.
    audienceRoles: roles,
    roadmapId,
    link: ROADMAP_PATH,
    createdAt: new Date(),
    readBy: {},
  });
}

const STAGE_LABEL: Record<ReminderStage, string> = { upcoming: "Due soon", due: "Due today", overdue: "Overdue" };

export const planRoadmapCheckInCron = onSchedule(
  {
    region: "us-central1",
    schedule: "15 7 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const roadmaps = await db.collection("planRoadmaps").where("status", "==", "published").get();
    let reminded = 0;
    let checkIns = 0;
    let escalations = 0;

    for (const roadmapSnap of roadmaps.docs) {
      const roadmap = roadmapSnap.data() as any;
      const title = clean(roadmap.title) || "Implementation plan";
      const departmentId = clean(roadmap.departmentId);
      const hods = await resolveHods(departmentId);
      if (!hods.length) {
        logger.warn("planRoadmapCheckIns.noHod", { roadmapId: roadmapSnap.id, departmentId });
        continue;
      }

      const milestoneSnaps = (await roadmapSnap.ref.collection("milestones").get()).docs;
      const items = milestoneSnaps.map((snap) => {
        const m = snap.data() as any;
        return { snap, m, dueAt: asDate(m.dueAt) };
      });

      // Recurring milestones that were completed roll forward to their next date.
      for (const it of items) {
        const next = isDone(it.m.status) && it.dueAt ? nextDueDate(it.dueAt, clean(it.m.recurrence)) : null;
        if (!next || next.getTime() > now.getTime() + 14 * 86400000 || it.dueAt!.getTime() > now.getTime()) continue;
        await it.snap.ref.update({
          dueAt: next, status: "not_started", lastStage: null, lastRemindedAt: null,
          overdueReminders: 0, escalatedAt: null, note: "", completedAt: null,
          rolledAt: now,
        });
        it.dueAt = next;
        it.m = { ...it.m, status: "not_started", lastStage: null, lastRemindedAt: null, overdueReminders: 0, escalatedAt: null };
      }

      // --- milestone reminders (one digest) ---
      const toRemind = items.flatMap((it) => {
        const stage = reminderStage({
          status: it.m.status, dueAt: it.dueAt, lastStage: it.m.lastStage,
          lastRemindedAt: asDate(it.m.lastRemindedAt), overdueReminders: it.m.overdueReminders,
        }, now);
        return stage ? [{ ...it, stage }] : [];
      });
      if (toRemind.length) {
        const lines = toRemind.map((it) => `${STAGE_LABEL[it.stage]}: ${clean(it.m.title)} (${fmt(it.dueAt)})`);
        await notify(
          hods, "plan_roadmap_reminder", `Plan reminders: ${title}`,
          `${toRemind.length} milestone(s) on "${title}" need attention.`,
          `<p>These milestones on <strong>${escapeHtml(title)}</strong> need attention:</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p>Please update their status.</p>`,
          lines.join("\n"), roadmapSnap.id, ["operations"],
        );
        for (const it of toRemind) {
          await it.snap.ref.update({
            lastStage: it.stage,
            lastRemindedAt: now,
            overdueReminders: Number(it.m.overdueReminders || 0) + (it.stage === "overdue" ? 1 : 0),
          });
          it.m = { ...it.m, overdueReminders: Number(it.m.overdueReminders || 0) + (it.stage === "overdue" ? 1 : 0) };
        }
        reminded += toRemind.length;
      }

      // --- milestone escalation to the project admin ---
      const stale = items.filter((it) => shouldEscalateMilestone({
        status: it.m.status, dueAt: it.dueAt, overdueReminders: it.m.overdueReminders,
        escalatedAt: asDate(it.m.escalatedAt),
      }, now));
      const admins = (stale.length || checkInDue(roadmap.lastCheckInMonth, now))
        ? await resolveProjectAdmins(clean(roadmap.programId)) : [];
      if (stale.length) {
        const lines = stale.map((it) => `${clean(it.m.title)} (due ${fmt(it.dueAt)})`);
        await notify(
          admins, "plan_roadmap_escalation", `Escalation: overdue milestones on ${title}`,
          `${stale.length} milestone(s) on "${title}" are overdue and unanswered by the HOD.`,
          `<p>The HOD for <strong>${escapeHtml(clean(roadmap.departmentName))}</strong> has not responded to repeated reminders on:</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
          lines.join("\n"), roadmapSnap.id, ["projectadmin"],
        );
        for (const it of stale) await it.snap.ref.update({ escalatedAt: now });
        escalations += 1;
      }

      // --- monthly check-in ---
      if (checkInDue(roadmap.lastCheckInMonth, now)) {
        const lastSent = asDate(roadmap.lastCheckInSentAt);
        const lastHodUpdate = items.reduce<Date | null>((latest, it) => {
          const at = asDate(it.m.updatedAt);
          return at && (!latest || at > latest) ? at : latest;
        }, asDate(roadmap.lastCheckInResponseAt));
        const missed = Number(roadmap.missedCheckIns || 0) + (checkInMissed(lastSent, lastHodUpdate) ? 1 : 0);
        const resetMissed = lastSent && !checkInMissed(lastSent, lastHodUpdate);
        const missedNow = resetMissed ? 0 : missed;

        const progress = summarizeProgress(items.map((it) => ({ status: it.m.status, dueAt: it.dueAt })), now);
        const summary = `${progress.done}/${progress.total} done (${progress.percentDone}%), ${progress.overdue} overdue, ${progress.atRisk} at risk or blocked.`;
        await notify(
          hods, "plan_roadmap_checkin", `Monthly check-in: ${title}`,
          `Monthly check-in for "${title}": ${summary}`,
          `<p>It is time for your monthly check-in on <strong>${escapeHtml(title)}</strong>.</p><p>${escapeHtml(summary)}</p><p>Please review each milestone's status and add a note on anything at risk or blocked.</p>`,
          summary, roadmapSnap.id, ["operations"],
        );

        const alreadyEscalated = Boolean(roadmap.missedEscalatedAt);
        if (shouldEscalateMissedCheckIns(missedNow, alreadyEscalated)) {
          await notify(
            admins, "plan_roadmap_escalation", `Escalation: missed check-ins on ${title}`,
            `The HOD has not responded to ${missedNow} monthly check-ins on "${title}".`,
            `<p>The HOD for <strong>${escapeHtml(clean(roadmap.departmentName))}</strong> has not responded to ${missedNow} monthly check-ins.</p><p>${escapeHtml(summary)}</p>`,
            summary, roadmapSnap.id, ["projectadmin"],
          );
          escalations += 1;
        }

        await roadmapSnap.ref.update({
          lastCheckInMonth: monthKey(now),
          lastCheckInSentAt: now,
          missedCheckIns: missedNow,
          missedEscalatedAt: missedNow === 0 ? null : (alreadyEscalated ? roadmap.missedEscalatedAt : shouldEscalateMissedCheckIns(missedNow, false) ? now : null),
          lastProgress: { ...progress, at: now },
        });
        checkIns += 1;
      }
    }

    logger.info("planRoadmapCheckInCron.complete", { roadmaps: roadmaps.size, reminded, checkIns, escalations });
  }
);
