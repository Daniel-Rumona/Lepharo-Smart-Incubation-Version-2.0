import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { admin, db } from "./emailShared";

type NotificationDoc = {
  recipientIds?: string[];
  recipientRoles?: string[];
  message?: Record<string, string> | string;
  type?: string;
};

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

function resolveBody(doc: NotificationDoc): string {
  if (typeof doc.message === "string" && doc.message) return doc.message;
  if (doc.message && typeof doc.message === "object") {
    const first = Object.values(doc.message).find(Boolean);
    if (first) return String(first);
  }
  return doc.type ? `Update: ${doc.type.replace(/[_-]+/g, " ")}` : "You have a new notification.";
}

/**
 * Pushes to any registered browser (see src/hooks/usePushNotifications.ts) whenever
 * a new doc lands in `notifications` -- the same collection already written by
 * src/routes/directors/directorDashboard.tsx's sendNotification() and read by
 * onInterventionReminderQueuedEmail in workflowEmailFunctions.ts. This only adds a
 * push; it never changes how those existing writers/readers behave.
 */
export const onNotificationCreatedPush = onDocumentWritten(
  { region: "us-central1", document: "notifications/{notificationId}" },
  async (event) => {
    const before = event.data?.before.data() as NotificationDoc | undefined;
    const after = event.data?.after.data() as NotificationDoc | undefined;
    if (before || !after) return; // only push for brand-new notifications

    const recipientIds = Array.isArray(after.recipientIds)
      ? after.recipientIds.map(String).filter(Boolean)
      : [];
    if (!recipientIds.length) return;

    const userSnaps = await db.getAll(
      ...recipientIds.map((uid) => db.collection("users").doc(uid))
    );

    const tokenToUser = new Map<string, string>();
    userSnaps.forEach((snap) => {
      const tokens: string[] = Array.isArray(snap.data()?.fcmTokens) ? snap.data()!.fcmTokens : [];
      tokens.forEach((token) => tokenToUser.set(token, snap.id));
    });

    const tokens = [...tokenToUser.keys()];
    if (!tokens.length) return;

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: "Smart Incubation",
          body: resolveBody(after),
        },
      });

      await Promise.all(
        response.responses.map(async (result, index) => {
          if (result.success) return;
          const code = (result.error as any)?.code;
          if (!code || !INVALID_TOKEN_CODES.has(code)) return;

          const badToken = tokens[index];
          const uid = tokenToUser.get(badToken);
          if (!uid) return;

          await db.collection("users").doc(uid).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(badToken),
          });
        })
      );
    } catch (error) {
      logger.error("push_notification.send_failed", { error: String(error) });
    }
  }
);
