import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { scheduledJob } from "./cronHeartbeat";
import { admin, APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";
import { buildBrief, renderBriefEmail, sastDate, type Brief, type DigestItem } from "./dailyBriefLogic";

/**
 * Daily digest. Someone who turns it on (users/{uid}.dailyDigest.enabled) stops getting the scheduled
 * reminder emails one by one: holdForDigest() saves each as a digestItems row instead. On weekdays at
 * 09:30, after the morning reminder jobs, the brief gathers those rows and the person's in-app
 * notifications since their last brief, stores it as dailyBriefs/{uid}__{date} (the Data Assistant
 * shows it) and sends one email. People not on digest are unaffected, and anything a person triggers
 * directly (a colleague's nudge, invitations, approvals) still sends at once.
 */

const ITEMS = "digestItems";
const BRIEFS = "dailyBriefs";
const CALLABLE_CORS = ["http://localhost:5173", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"];
// In-app notifications the brief already covers as held reminders.
const COVERED_NOTIFICATION_TYPES = new Set(["mov_stage_reminder"]);
const LOOKBACK_MS = 4 * 24 * 3600 * 1000; // a long weekend at most

/** uid is the sign-in id (briefs and notifications use it); docId is the users/ record. */
type DigestUser = { uid: string; docId: string; email: string; name: string; lastBriefAt: number };

const clean = (value: unknown) => String(value ?? "").trim();
const millis = (value: any): number => value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0);

let cached: { at: number; byEmail: Map<string, DigestUser> } | null = null;

/** Everyone on digest, by email. Cached briefly so a reminder job's loop reads it once. */
async function digestUsersByEmail(): Promise<Map<string, DigestUser>> {
  if (cached && Date.now() - cached.at < 60_000) return cached.byEmail;
  const snapshot = await db.collection("users").where("dailyDigest.enabled", "==", true).get();
  const byEmail = new Map<string, DigestUser>();
  snapshot.docs.forEach((doc) => {
    const data = doc.data() as any;
    const email = clean(data.email).toLowerCase();
    if (email) byEmail.set(email, { uid: clean(data.uid || data.authUid) || doc.id, docId: doc.id, email, name: clean(data.name || data.displayName), lastBriefAt: millis(data.dailyDigest?.lastBriefAt) });
  });
  cached = { at: Date.now(), byEmail };
  return byEmail;
}

/**
 * Splits a reminder's recipients: people on digest get it saved for their brief, everyone else is
 * returned to be emailed now. If anything goes wrong reading digest settings, everyone is emailed.
 */
export async function holdForDigest(emails: string[], item: Omit<DigestItem, "createdAt">): Promise<string[]> {
  const unique = [...new Set(emails.map((email) => clean(email).toLowerCase()).filter((email) => email.includes("@")))];
  if (!unique.length) return [];
  let digest: Map<string, DigestUser>;
  try {
    digest = await digestUsersByEmail();
  } catch (error) {
    logger.warn("daily_digest.lookup_failed", { error: String(error) });
    return unique;
  }
  const held = unique.filter((email) => digest.has(email));
  if (!held.length) return unique;
  const batch = db.batch();
  held.forEach((email) => {
    const user = digest.get(email)!;
    batch.set(db.collection(ITEMS).doc(), {
      ...item,
      uid: user.uid,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      briefedAt: null,
    });
  });
  try {
    await batch.commit();
  } catch (error) {
    logger.warn("daily_digest.hold_failed", { error: String(error) });
    return unique; // never lose a reminder: send it after all
  }
  return unique.filter((email) => !digest.has(email));
}

async function itemsFor(uid: string, now: number, lastBriefAt: number) {
  const since = now - LOOKBACK_MS;
  const [held, notifications] = await Promise.all([
    db.collection(ITEMS).where("uid", "==", uid).where("briefedAt", "==", null).get(),
    db.collection("notifications").where("recipientIds", "array-contains", uid).orderBy("createdAt", "desc").limit(60).get(),
  ]);
  const items: DigestItem[] = held.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      category: data.category,
      title: clean(data.title),
      detail: clean(data.detail),
      link: clean(data.link) || "/",
      dedupeKey: clean(data.dedupeKey),
      createdAt: millis(data.createdAt) || now,
    };
  });
  // In-app notifications since the person's last brief, so the brief is the whole picture.
  const after = Math.max(since, lastBriefAt);
  notifications.docs.forEach((doc) => {
    const data = doc.data() as any;
    const at = millis(data.createdAt);
    if (at <= after || COVERED_NOTIFICATION_TYPES.has(clean(data.type))) return;
    const message = clean(data.message || data.body);
    items.push({
      // A watch or chaser the person set is what they asked to hear about, so it leads the brief.
      category: ["watch_triggered", "chaser_update"].includes(clean(data.type)) ? "watch" : "notification",
      title: clean(data.title) || message.slice(0, 90) || "Notification",
      detail: clean(data.title) ? message.slice(0, 160) : "",
      link: clean(data.link) || "/",
      dedupeKey: doc.id,
      createdAt: at,
    });
  });
  return { items, heldRefs: held.docs.map((doc) => doc.ref) };
}

/** Builds (and stores) one person's brief for today. Emails it only when asked and there is something in it. */
async function briefFor(user: DigestUser, options: { email: boolean; now?: number }): Promise<Brief> {
  const now = options.now ?? Date.now();
  const date = sastDate(now);
  const { items, heldRefs } = await itemsFor(user.uid, now, user.lastBriefAt);
  const brief = buildBrief(items, date);
  const ref = db.collection(BRIEFS).doc(`${user.uid}__${date}`);
  await ref.set({ uid: user.uid, ...brief, createdAt: admin.firestore.FieldValue.serverTimestamp(), emailedAt: null }, { merge: true });

  if (options.email && brief.total > 0) {
    const { subject, html, text } = renderBriefEmail(user.name, brief, APP_BASE_URL);
    await sendStatusChangeNotification([user.email], subject, html, text);
    await ref.set({ emailedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  if (options.email) {
    await db.collection("users").doc(user.docId).set({ dailyDigest: { lastBriefAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
  }
  if (options.email && heldRefs.length) {
    // Only the scheduled send clears the held items; a preview leaves them for the morning.
    for (let at = 0; at < heldRefs.length; at += 400) {
      const batch = db.batch();
      heldRefs.slice(at, at + 400).forEach((itemRef) => batch.update(itemRef, { briefedAt: admin.firestore.FieldValue.serverTimestamp() }));
      await batch.commit();
    }
  }
  return brief;
}

export const dailyBriefCron = scheduledJob("dailyBriefCron",
  { region: "us-central1", schedule: "30 9 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 540, memory: "512MiB", maxInstances: 1 },
  async () => {
    cached = null;
    const users = [...(await digestUsersByEmail()).values()];
    let sent = 0;
    let failed = 0;
    for (const user of users) {
      try {
        const brief = await briefFor(user, { email: true });
        if (brief.total) sent++;
      } catch (error) {
        failed++;
        logger.error("daily_brief.failed", { uid: user.uid, error: String(error) });
      }
    }
    logger.info("daily_brief.done", { users: users.length, sent, failed });
  }
);

/** The caller's brief for today, built now (nothing is emailed or cleared). For the Data Assistant. */
export const buildMyDailyBrief = onCall({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
  const profile = (await db.collection("users").doc(request.auth.uid).get()).data() || {};
  const user: DigestUser = {
    uid: request.auth.uid,
    docId: request.auth.uid,
    email: clean(profile.email || request.auth.token?.email).toLowerCase(),
    name: clean(profile.name || profile.displayName),
    lastBriefAt: millis((profile as any).dailyDigest?.lastBriefAt),
  };
  return briefFor(user, { email: false });
});
