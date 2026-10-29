import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { suppressRecordNotifications } from "./syntheticData";
import {
  admin,
  db,
  APP_BASE_URL,
  getCCRecipients,
  getHODRecipients,
  getMERecipients,
  sendStatusChangeNotification,
  buildPackReminderEmail,
} from "./emailShared";
import { moderateCadencePhase } from "./reminderCadence";
import { getDepartmentHods, getProgramProjectAdmins, resolvePackProgramId, resolveMovDepartmentId, uidsForEmails } from "./movRecipients";
import { PACK_STATUS, normalizePackStatus, storedPackStatuses } from "./packStatus";

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

type Stage = {
  /** Collection and status the document is waiting in. */
  collection: "movDocuments" | "consolidatedMOVs";
  status: string;
  /** Who has to act, and where they do it. */
  owner: "HOD" | "CC" | "M&E";
  recipients: () => Promise<string[]>;
  /** When set, reminders are split by department and sent only to that department's HODs. */
  byDepartment?: boolean;
  /** When set, reminders are split by programme and sent to that programme's project admins. */
  byProgram?: boolean;
  path: string;
  /** When the document entered this stage. */
  enteredAt: (doc: any) => Date | null;
  describe: (doc: any) => string;
};

const lastApprovalDate = (doc: any, step: string): Date | null => {
  const approvals = Array.isArray(doc.approvals) ? doc.approvals : [];
  for (let i = approvals.length - 1; i >= 0; i -= 1) {
    if (String(approvals[i]?.step || "") === step) return asDate(approvals[i]?.date);
  }
  return null;
};

const packLabel = (doc: any) =>
  `${doc.department || "A department"}'s ${doc.month || ""} MOV pack`.replace(/\s+/g, " ");

const STAGES: Stage[] = [
  {
    collection: "movDocuments",
    status: "awaiting_hod",
    owner: "HOD",
    recipients: getHODRecipients, // fallback only, see byDepartment
    byDepartment: true,
    path: "/operations/movs",
    enteredAt: (d) => asDate(d.smmeSignedAt) || asDate(d.updatedAt) || asDate(d.createdAt),
    describe: (d) => `The MOV for ${d.beneficiaryName || "a participant"} (${d.interventionTitle || "intervention"})`,
  },
  {
    collection: "consolidatedMOVs",
    status: PACK_STATUS.AWAITING_CC,
    owner: "CC",
    recipients: getCCRecipients, // fallback only, see byProgram
    byProgram: true,
    path: "/projectadmin/movs",
    enteredAt: (d) => asDate(d.createdAt),
    describe: packLabel,
  },
  {
    collection: "consolidatedMOVs",
    status: PACK_STATUS.AWAITING_ME,
    owner: "M&E",
    recipients: getMERecipients,
    path: "/operations/monitoring/movs",
    enteredAt: (d) => lastApprovalDate(d, "final_confirmation") || asDate(d.updatedAt) || asDate(d.createdAt),
    describe: packLabel,
  },
];

/**
 * Daily nag for MOV records that have sat too long in a stage that someone
 * has to act on:
 *   awaiting_hod    -> HOD approves the individual MOV
 *   awaiting_cc     -> Centre Coordinator confirms the monthly pack
 *   confirmed       -> M&E does the final validation
 * Same cadence as the other backlog reminders (2 / 5 / then weekly). The
 * reminder phase is stored on the document itself so each phase fires once,
 * and restarts naturally when the document moves to the next status.
 */
export const movStageReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "20 8 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = Date.now();
    let remindersSent = 0;
    let scanned = 0;

    for (const stage of STAGES) {
      // Packs written before the status rename still carry the old names, so match both spellings.
      const statuses = stage.collection === "consolidatedMOVs" ? storedPackStatuses(stage.status) : [stage.status];
      const snapshot = await db.collection(stage.collection).where("status", "in", statuses).get();
      scanned += snapshot.size;

      // Collect what is due first so each owner gets one digest per run, not one email per document.
      type Due = { ref: FirebaseFirestore.DocumentReference; phase: string; days: number; departmentId: string | null; departmentName: string; programId: string | null };
      const due: Due[] = [];
      for (const snap of snapshot.docs) {
        const doc = snap.data() as any;
        if (suppressRecordNotifications(doc, snap.id)) continue;
        const entered = stage.enteredAt(doc);
        if (!entered) continue; // can't age it without an anchor -- skip rather than guess
        const days = Math.floor((now - entered.getTime()) / DAY_MS);
        const phase = moderateCadencePhase(days);
        const previous = doc.lastStageReminder;
        if (!phase || (normalizePackStatus(previous?.status) === normalizePackStatus(stage.status) && previous?.phase === phase)) continue;
        due.push({
          ref: snap.ref,
          phase,
          days,
          departmentId: stage.byDepartment ? await resolveMovDepartmentId(doc) : null,
          departmentName: String(doc.departmentName || doc.department || "").trim(),
          programId: stage.byProgram ? resolvePackProgramId(doc) : null,
        });
      }
      if (!due.length) continue;

      const noun = stage.collection === "movDocuments" ? "MOV" : "MOV pack";
      const url = `${APP_BASE_URL.replace(/\/$/, "")}${stage.path}`;

      // Department-targeted stages go out once per department; the rest in a single batch.
      const batches = new Map<string, Due[]>();
      for (const item of due) {
        const key = stage.byDepartment ? item.departmentId || "" : stage.byProgram ? item.programId || "" : "all";
        batches.set(key, [...(batches.get(key) || []), item]);
      }

      for (const [departmentId, items] of batches) {
        let emails: string[] = [];
        let uids: string[] = [];
        if (stage.byDepartment && departmentId) {
          const hods = await getDepartmentHods(departmentId);
          emails = hods.emails;
          uids = hods.uids;
        }
        if (stage.byProgram && departmentId) {
          // Here the batch key is the programme: its own Center Coordinator.
          const admins = await getProgramProjectAdmins(departmentId);
          emails = admins.emails;
          uids = admins.uids;
        }
        // Unknown department, or a department with no HOD on file: fall back to all
        // HODs rather than let the MOV sit unseen.
        const usedFallback = !emails.length;
        if (usedFallback) {
          emails = await stage.recipients();
          if (stage.byProgram) {
            logger.warn("movStageReminderCron.ccFallback", { programId: departmentId || null, count: items.length });
          }
          if (stage.byDepartment) {
            logger.warn("movStageReminderCron.hodFallback", {
              departmentId: departmentId || null,
              count: items.length,
            });
          }
        }
        if (!emails.length) {
          logger.warn("movStageReminderCron.noRecipients", { owner: stage.owner, status: stage.status });
          continue;
        }

        const oldest = Math.max(...items.map((d) => d.days));
        const where = stage.byDepartment && items[0].departmentName && !usedFallback ? ` in ${items[0].departmentName}` : "";
        const text =
          `${items.length} ${noun}${items.length === 1 ? " is" : "s are"} waiting for ${stage.owner} action${where} ` +
          `(oldest: ${oldest} day${oldest === 1 ? "" : "s"}). Please review ${items.length === 1 ? "it" : "them"} in the system.`;
        const content = buildPackReminderEmail(stage.owner, text, url);

        try {
          await sendStatusChangeNotification(emails, content.subject, content.html, content.text);
        } catch (error) {
          logger.error("movStageReminderCron.emailFailed", { owner: stage.owner, error: String(error) });
        }

        // Always by uid: the people just emailed, never the whole role (which
        // would reach every operations/projectadmin user across all companies).
        const recipientIds = uids.length && !usedFallback ? uids : await uidsForEmails(emails);
        if (recipientIds.length) {
          await db.collection("notifications").add({
            type: "mov_stage_reminder",
            message: text,
            recipientIds,
            movStatus: stage.status,
            count: items.length,
            link: stage.path,
            createdAt: new Date(),
            readBy: {},
          });
        }

        for (const item of items) {
          await item.ref.update({
            lastStageReminder: {
              status: stage.status,
              phase: item.phase,
              at: admin.firestore.Timestamp.now(),
            },
          });
          remindersSent += 1;
        }
      }
    }

    logger.info("movStageReminderCron.complete", { scanned, remindersSent });
  }
);
