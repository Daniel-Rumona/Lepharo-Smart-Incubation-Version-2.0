import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "./emailShared";
import { moderateCadencePhase } from "./reminderCadence";

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Daily nag for workflowQueries left `open` too long. Writes the exact same
 * notification shape as the manual "remind" button in OperationsDashboard.tsx
 * (same `type`, same message shape) so both sources render identically in
 * the bell and share one email registry entry (notificationEmailRegistry.ts).
 * Phase tracking lives directly on the query doc (`lastReminderPhase`) --
 * no separate ledger collection, unlike compliance's per-document ledger,
 * since a workflowQuery is a single long-lived doc with a stable ref.
 */
export const workflowQueryReminderCron = onSchedule(
  {
    region: "us-central1",
    schedule: "0 8 * * *",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 300,
    maxInstances: 1,
  },
  async () => {
    const now = new Date();
    const snapshot = await db.collection("workflowQueries").where("status", "==", "open").get();

    let remindersSent = 0;

    for (const querySnap of snapshot.docs) {
      const query = querySnap.data() as any;
      const anchor = asDate(query.lastReminderAt) || asDate(query.createdAt);
      if (!anchor) continue;

      const daysSince = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
      const phase = moderateCadencePhase(daysSince);
      if (!phase || phase === query.lastReminderPhase) continue;

      const resolverId = String(query.resolverId || "").trim();
      if (!resolverId) {
        logger.warn("workflowQueryReminderCron.noResolver", { queryId: querySnap.id });
        continue;
      }
      const resolverRole = String(query.resolver?.role || "consultant").trim();

      await db.collection("notifications").add({
        type: "workflow-query-reminder",
        message: { [resolverRole]: "Reminder: an open query needs your response." },
        recipientRoles: [resolverRole],
        recipientIds: [resolverId],
        workflowQueryId: querySnap.id,
        programId: query.programId || null,
        reminderPhase: phase,
        createdAt: new Date(),
        readBy: {},
      });

      await querySnap.ref.update({
        lastReminderAt: admin.firestore.Timestamp.now(),
        lastReminderPhase: phase,
        reminders: admin.firestore.FieldValue.arrayUnion({
          sentAt: admin.firestore.Timestamp.now(),
          phase,
          automated: true,
        }),
      });

      remindersSent += 1;
    }

    logger.info("workflowQueryReminderCron.complete", {
      queriesScanned: snapshot.size,
      remindersSent,
    });
  }
);
