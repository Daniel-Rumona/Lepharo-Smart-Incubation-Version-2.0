import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { admin, db } from "./emailShared";
import { logBrevoSend, sendViaBrevo } from "./brevoClient";
import { NOTIFICATION_REGISTRY, type NotificationDoc } from "./notificationEmailRegistry";

const REGION = "us-central1";
const ACTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Same fallback pattern as functions/src/utils/crypto.ts's OAUTH_BASE_URL.
const FUNCTIONS_BASE_URL =
  process.env.NOTIFICATION_FUNCTIONS_BASE_URL ||
  `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;

/**
 * Mints one single-use, expiring notificationActions/{token} doc per action
 * declared on the notification, and returns a map of actionId -> confirm-page
 * URL for the email template to render as buttons. No-ops (returns {}) if the
 * notification declares no actions or no actionTarget.
 */
async function mintActionLinks(
  notificationId: string,
  after: NotificationDoc,
  recipientEmail: string
): Promise<Record<string, string>> {
  const actions = Array.isArray(after.actions) ? after.actions : [];
  const target = after.actionTarget;
  if (!actions.length || !target?.collection || !target?.docId) return {};

  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ACTION_TOKEN_TTL_MS);
  const links: Record<string, string> = {};
  const batch = db.batch();

  for (const action of actions) {
    if (!action?.actionId) continue;
    const token = crypto.randomBytes(32).toString("hex");
    const ref = db.collection("notificationActions").doc(token);
    batch.set(ref, {
      notificationId,
      actionId: action.actionId,
      label: action.label || action.actionId,
      targetCollection: target.collection,
      targetDocId: target.docId,
      patch: action.patch || {},
      recipientEmail,
      allowedUids: Array.isArray(after.recipientIds) ? after.recipientIds : null,
      expiresAt,
      used: false,
      usedAt: null,
      usedByIp: null,
      resultStatus: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    links[action.actionId] = `${FUNCTIONS_BASE_URL}/notificationAction?token=${token}`;
  }

  await batch.commit();
  return links;
}

/**
 * Generalized notification -> email fan-out. Supersedes the old
 * onInterventionReminderQueuedEmail (removed from workflowEmailFunctions.ts):
 * instead of one hardcoded type, this looks up NOTIFICATION_REGISTRY by
 * `type` so any notification type can opt into an email by adding a registry
 * entry, without a new Cloud Function trigger.
 */
export const onNotificationCreatedEmail = onDocumentWritten(
  { region: REGION, document: "notifications/{notificationId}" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data() as NotificationDoc | undefined;
    if (before || !after) return; // only brand-new notifications

    const type = String(after.type || "");
    const config = NOTIFICATION_REGISTRY[type]?.email;
    if (!config) return;

    const notificationId = event.params.notificationId;
    const participantId = after.participantId ? String(after.participantId) : null;
    const programId = after.programId ? String(after.programId) : null;

    let recipientEmail = "";
    try {
      const recipient = await config.resolveRecipient(after);
      if (!recipient?.email) {
        logger.warn("notification_email.no_recipient", { notificationId, type });
        return;
      }
      recipientEmail = recipient.email;

      const suppressed = await db.collection("emailSuppressions").doc(recipientEmail).get();
      if (suppressed.exists) {
        logger.warn("notification_email.suppressed", { notificationId, to: recipientEmail });
        return;
      }

      const actionLinks = await mintActionLinks(notificationId, after, recipientEmail);
      const { subject, html, text } = config.template(after, recipient, actionLinks);

      const { messageId } = await sendViaBrevo({ to: recipientEmail, subject, html, text, tags: [config.tag] });
      await logBrevoSend({
        type: type.toUpperCase(),
        to: recipientEmail,
        subject,
        status: "sent",
        messageId,
        participantId,
        programId,
      });

      await event.data!.after.ref.update({
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSentTo: recipientEmail,
      });
    } catch (err: any) {
      const message = String(err?.message || err);
      logger.error("notification_email.failed", { notificationId, type, error: message });
      await logBrevoSend({
        type: (type || "NOTIFICATION").toUpperCase(),
        to: recipientEmail,
        subject: "",
        status: "failed",
        error: message,
        participantId,
        programId,
      });
    }
  },
);
