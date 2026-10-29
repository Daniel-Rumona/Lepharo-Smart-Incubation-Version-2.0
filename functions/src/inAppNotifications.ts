import * as logger from "firebase-functions/logger";
import { db } from "./emailShared";
import { uidsForEmails } from "./movRecipients";

/**
 * In-app companion for the email/WhatsApp senders. Every user-facing email
 * should also land in `notifications` so the NotificationBell (and push, via
 * onNotificationCreatedPush) see the same event.
 *
 * Always addressed by uid -- never by role -- so a personal notice (an SME's
 * compliance status, someone's leave decision) can't surface for everyone who
 * shares the recipient's role. Use types that are NOT in NOTIFICATION_REGISTRY:
 * these callers already send their own email, and a registered type would
 * make onNotificationCreatedEmail send it a second time.
 */
export type InAppNotification = {
  type: string;
  message: string;
  recipientIds: Array<string | null | undefined>;
  link?: string | null;
  [key: string]: unknown;
};

export async function notifyInApp(input: InAppNotification): Promise<void> {
  const recipientIds = Array.from(
    new Set(input.recipientIds.map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!recipientIds.length) return;

  const doc: Record<string, unknown> = Object.fromEntries(
    Object.entries({ ...input, recipientIds }).filter(([, v]) => v !== undefined && v !== null)
  );

  try {
    await db.collection("notifications").add({
      ...doc,
      createdAt: new Date(),
      readBy: {},
    });
  } catch (error) {
    // In-app is additive: a failure here must never fail the email path.
    logger.warn("in_app_notification.write_failed", { type: input.type, error: String(error) });
  }
}

/**
 * Login uid of an SME behind a participant record. There is no single link
 * field, so try the ones the app uses, in order: participants.uid/userId,
 * users.participantId, then the participant's email against users.
 */
export async function uidForParticipant(
  participantId?: string | null,
  fallbackEmail?: string | null
): Promise<string | null> {
  const id = String(participantId || "").trim();
  let email = String(fallbackEmail || "").trim().toLowerCase();

  try {
    if (id) {
      const snap = await db.collection("participants").doc(id).get();
      const data = (snap.data() || {}) as any;
      const direct = String(data.uid || data.userId || "").trim();
      if (direct) return direct;
      if (!email) email = String(data.email || "").trim().toLowerCase();

      const linked = await db.collection("users").where("participantId", "==", id).limit(1).get();
      if (!linked.empty) return linked.docs[0].id;
    }
  } catch (error) {
    logger.warn("uidForParticipant.failed", { participantId: id, error: String(error) });
  }

  if (!email) return null;
  const [uid] = await uidsForEmails([email]);
  return uid || null;
}

/** Single-email convenience over uidsForEmails. */
export async function uidForEmail(email?: string | null): Promise<string | null> {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean.includes("@")) return null;
  const [uid] = await uidsForEmails([clean]);
  return uid || null;
}
