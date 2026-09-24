import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  admin,
  buildMovNotificationContent,
  db,
  getCCRecipients,
  getMERecipients,
  sendStatusChangeNotification,
} from "./emailShared";
import { moderateCadencePhase } from "./reminderCadence";

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Daily nag for movDocuments stuck awaiting validation: `generated` (awaiting
 * CC) or `signed` (awaiting M&E). onMovDocumentWorkflowEmails (emailMov.ts)
 * already sends a one-time email on the transition itself -- this covers the
 * "still not validated N days later" case it doesn't.
 *
 * Recipients are a role group (all CC / all M&E), not one person, so this
 * bypasses the notification email registry (built for one-recipient types)
 * and instead reuses the same broadcast helpers emailMov.ts's one-time
 * version already calls -- getCCRecipients/getMERecipients + buildMovNotificationContent
 * + sendStatusChangeNotification. The in-app notifications doc is written
 * directly with recipientRoles only (no recipientIds), matching how the bell's
 * role-based listener already supports whole-team targeting.
 */
export const movValidationReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "10 8 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const snapshot = await db.collection("movDocuments").where("status", "in", ["generated", "signed"]).get();

    let remindersSent = 0;

    for (const movSnap of snapshot.docs) {
      const mov = movSnap.data() as any;
      const movStatus = String(mov.status || "");
      const notifications = mov.workflowNotifications || {};
      const anchor = movStatus === "generated"
        ? asDate(notifications.ccPackSubmittedNotifiedAt)
        : asDate(notifications.mePackSignedNotifiedAt);
      if (!anchor) continue; // not yet stamped by the one-time transition trigger -- skip, don't guess a fallback anchor

      const daysSince = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
      const phase = moderateCadencePhase(daysSince);
      const previous = mov.lastValidationReminder;
      if (!phase || (previous?.status === movStatus && previous?.phase === phase)) continue;

      const isCcStage = movStatus === "generated";
      const recipients = await (isCcStage ? getCCRecipients() : getMERecipients());
      if (!recipients.length) {
        logger.warn("movValidationReminderCron.noRecipients", { movId: movSnap.id, status: movStatus });
        continue;
      }

      const statusLabel = isCcStage ? "still awaiting CC validation" : "still awaiting M&E validation";
      const content = buildMovNotificationContent({
        statusLabel,
        movId: movSnap.id,
        interventionTitle: mov.interventionTitle,
        beneficiaryName: mov.beneficiaryName,
        facilitatorName: mov.facilitatorName,
      });

      try {
        await sendStatusChangeNotification(recipients, content.subject, content.html, content.text);
      } catch (error) {
        logger.error("movValidationReminderCron.emailFailed", { movId: movSnap.id, error: String(error) });
      }

      const recipientRole = isCcStage ? "projectadmin" : "operations";
      await db.collection("notifications").add({
        type: "mov_validation_reminder",
        message: `MOV for ${mov.beneficiaryName || "a participant"} has been ${statusLabel} for ${daysSince} day${daysSince === 1 ? "" : "s"}.`,
        recipientRoles: [recipientRole],
        movId: movSnap.id,
        movStatus,
        reminderPhase: phase,
        link: isCcStage ? "/project-admin" : "/operations",
        createdAt: new Date(),
        readBy: {},
      });

      await movSnap.ref.update({
        lastValidationReminder: {
          status: movStatus,
          phase,
          at: admin.firestore.Timestamp.now(),
        },
      });

      remindersSent += 1;
    }

    logger.info("movValidationReminderCron.complete", {
      movsScanned: snapshot.size,
      remindersSent,
    });
  }
);
