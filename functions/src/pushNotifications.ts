import * as logger from "firebase-functions/logger";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { suppressRecordNotifications } from "./syntheticData";
import { admin, db } from "./emailShared";
import { APP_BASE_URL } from "./config";

type NotificationDoc = {
  recipientIds?: string[];
  recipientRoles?: string[];
  message?: Record<string, string> | string;
  type?: string;
  link?: string;
  actionPath?: string;
};

const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);
const FCM_MULTICAST_LIMIT = 500;

function resolveTitle(doc: NotificationDoc): string {
  const type = String(doc.type || "").replace(/[_-]+/g, " ").trim();
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Smart Incubation";
}

function resolveBody(doc: NotificationDoc, role?: string): string {
  if (typeof doc.message === "string" && doc.message) return doc.message;
  if (doc.message && typeof doc.message === "object") {
    if (role && doc.message[role]) return doc.message[role];
    const first = Object.values(doc.message).find(Boolean);
    if (first) return String(first);
  }
  return doc.type ? `Update: ${doc.type.replace(/[_-]+/g, " ")}` : "You have a new notification.";
}

function resolveLink(doc: NotificationDoc): string {
  const link = String(doc.link || doc.actionPath || "");
  return link.startsWith("/") && !link.startsWith("//") ? link : "/";
}

/**
 * Same audience the NotificationBell shows: the named uids when there are any
 * (a targeted doc is theirs alone), otherwise everyone holding one of the
 * recipientRoles.
 */
async function resolveRecipients(doc: NotificationDoc): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const ids = Array.isArray(doc.recipientIds) ? [...new Set(doc.recipientIds.map(String).filter(Boolean))] : [];
  if (ids.length) return db.getAll(...ids.map((uid) => db.collection("users").doc(uid)));

  const roles = Array.isArray(doc.recipientRoles) ? [...new Set(doc.recipientRoles.map(String).filter(Boolean))] : [];
  const snaps: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < roles.length; i += 10) {
    const result = await db.collection("users").where("role", "in", roles.slice(i, i + 10)).get();
    snaps.push(...result.docs);
  }
  return snaps;
}

/**
 * Pushes every new `notifications` doc to the recipients' registered browsers
 * (see src/hooks/usePushNotifications.ts). Sent as a data-only message so the
 * service worker (src/sw.ts) is the single place that displays it -- a
 * `notification` payload is also auto-displayed by the FCM SDK and would show
 * twice. In the foreground nothing is shown from here; useNotificationCenter's
 * live listener toasts instead.
 */
export const onNotificationCreatedPush = onDocumentWritten(
  { region: "us-central1", document: "notifications/{notificationId}" },
  async (event) => {
    const before = event.data?.before.data() as NotificationDoc | undefined;
    const after = event.data?.after.data() as NotificationDoc | undefined;
    if (suppressRecordNotifications(after, event.params.notificationId)) return;
    if (before || !after) return; // only push for brand-new notifications

    const userSnaps = await resolveRecipients(after);

    // token -> owner, so a role-keyed message reads right for each person.
    const tokenOwner = new Map<string, { uid: string; role?: string }>();
    userSnaps.forEach((snap) => {
      const data = snap.data() || {};
      const tokens: string[] = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
      tokens.forEach((token) => tokenOwner.set(token, { uid: snap.id, role: data.role }));
    });
    if (!tokenOwner.size) return;

    const title = resolveTitle(after);
    const link = resolveLink(after);
    const absoluteLink = `${APP_BASE_URL.replace(/\/$/, "")}${link}`;

    // Group tokens by the body each person should see, then send in FCM-sized chunks.
    const byBody = new Map<string, string[]>();
    tokenOwner.forEach((owner, token) => {
      const body = resolveBody(after, owner.role);
      byBody.set(body, [...(byBody.get(body) || []), token]);
    });

    for (const [body, allTokens] of byBody) {
      for (let i = 0; i < allTokens.length; i += FCM_MULTICAST_LIMIT) {
        const tokens = allTokens.slice(i, i + FCM_MULTICAST_LIMIT);
        try {
          const response = await admin.messaging().sendEachForMulticast({
            tokens,
            data: { title, body, link, tag: event.params.notificationId },
            webpush: { fcmOptions: { link: absoluteLink } },
          });

          await Promise.all(
            response.responses.map(async (result, index) => {
              if (result.success) return;
              const code = (result.error as any)?.code;
              if (!code || !INVALID_TOKEN_CODES.has(code)) return;

              const badToken = tokens[index];
              const uid = tokenOwner.get(badToken)?.uid;
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
    }
  }
);
