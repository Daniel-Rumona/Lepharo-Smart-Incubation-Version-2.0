import * as logger from "firebase-functions/logger";
import { admin, db } from "./firebase";
import { scheduledJob } from "./cronHeartbeat";
import { clean, normalizePhone } from "./whatsappCommon";
import { isDepartmentInRole } from "./departmentRoles";
import { loadComplianceContext, participantComplianceRecords, requirementStates } from "./complianceExpiry";
import { documentAccess, sessionsTodayFor, staffIdentityFromUser, StaffIdentity } from "./whatsappStaff";
import { sessionsAwaitingCoverage } from "./whatsappCoverage";

/**
 * Proactive Lepharo WhatsApp alerts. Outside the 24 hours after someone last messaged us WhatsApp only delivers
 * approved templates, so every alert is the lph_alert template (first name, headline, details, "Open menu"),
 * sent through the router's dispatch endpoint, which owns the WhatsApp credentials (WHATSAPP_DISPATCH_URL/SECRET).
 *
 * Only people who said yes to WhatsApp get alerts: users/{uid}.whatsappConsent.status === "granted", set in the
 * app (src/services/whatsappConsent.ts) or by replying START on WhatsApp; STOP sets it to declined.
 * Every send has a dedupe key, so a job that runs twice never sends twice. Nothing here may break a job:
 * failures are logged and the next person is tried.
 */

const CONSENT_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const lower = (value: unknown) => clean(value).toLowerCase();
const firstName = (name: string) => clean(name).split(/\s+/)[0] || "there";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// South Africa has no daylight saving, so SAST dates are UTC+2 throughout the year.
const SAST_MS = 2 * 60 * 60 * 1000;
const sastDate = (value: Date) => new Date(value.getTime() + SAST_MS).toISOString().slice(0, 10);
const sastTime = (value: Date) => new Date(value.getTime() + SAST_MS).toISOString().slice(11, 16);
const sastMidnight = (offsetDays: number) => {
  const today = sastDate(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) - SAST_MS + offsetDays * DAY_MS);
};

/* ----------------------------------------------------------------- consent */

/**
 * The users records a WhatsApp sender's consent lives on: the staff member's, or the SME's
 * login(s) by users.participantId (docs/sme-identity-migration-plan.md).
 */
export async function consentUserIds(target: { kind: "staff"; userId: string } | { kind: "sme"; participantId?: string | null; email: string | null }) {
  if (target.kind === "staff") return [target.userId];
  const participantId = clean((target as { participantId?: string | null }).participantId);
  if (participantId) {
    const linked = await db.collection("users").where("participantId", "==", participantId).limit(5).get();
    const ids = linked.docs.filter((doc) => lower(doc.data().role) === "incubatee").map((doc) => doc.id);
    if (ids.length) return ids;
  }
  // email fallback until Phase 4 (docs/sme-identity-migration-plan.md)
  const email = lower(target.email);
  if (!email) return [];
  const snapshot = await db.collection("users").where("email", "==", email).limit(5).get();
  return snapshot.docs.filter((doc) => lower(doc.data().role) === "incubatee").map((doc) => doc.id);
}

/** STOP / START on WhatsApp, recorded the way the app records the choice. */
export async function setAlertConsent(userIds: string[], phoneNumber: string, granted: boolean) {
  const digits = normalizePhone(phoneNumber);
  const consent = granted
    ? { status: "granted", number: `+${digits}`, answeredAt: admin.firestore.FieldValue.serverTimestamp(), version: CONSENT_VERSION, source: "whatsapp" }
    : { status: "declined", answeredAt: admin.firestore.FieldValue.serverTimestamp(), version: CONSENT_VERSION, source: "whatsapp" };
  const batch = db.batch();
  userIds.forEach((id) => batch.set(db.collection("users").doc(id), { whatsappConsent: consent }, { merge: true }));
  await batch.commit();
  return userIds.length;
}

type Recipient = { id: string; data: FirebaseFirestore.DocumentData; number: string };

async function consentingUsers(): Promise<Recipient[]> {
  const snapshot = await db.collection("users").where("whatsappConsent.status", "==", "granted").get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data(), number: normalizePhone(doc.data().whatsappConsent?.number) }))
    .filter((user) => user.number.length >= 9 && !["inactive", "disabled", "deleted"].includes(lower(user.data.status)));
}

/* ----------------------------------------------------------------- sending */

type Alert = { name: string; headline: string; details: string };

async function sendAlert(number: string, alert: Alert, dedupeKey: string): Promise<boolean> {
  const url = clean(process.env.WHATSAPP_DISPATCH_URL);
  const secret = clean(process.env.WHATSAPP_DISPATCH_SECRET);
  if (!url || !secret) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-whatsapp-dispatch-secret": secret },
      body: JSON.stringify({
        engine: "LPH",
        type: "alert",
        to: number,
        variables: [firstName(alert.name), alert.headline, alert.details],
        dedupeKey,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) logger.warn("whatsappAlerts.dispatchRejected", { status: response.status, dedupeKey });
    return response.ok;
  } catch (error) {
    logger.warn("whatsappAlerts.dispatchFailed", { dedupeKey, error: String(error) });
    return false;
  }
}

/** One alert to one person, only if they said yes to WhatsApp. Returns whether it was sent. */
export async function sendWhatsAppAlert(userId: string, alert: Alert, dedupeKey: string): Promise<boolean> {
  const user = (await db.collection("users").doc(userId).get()).data();
  const number = normalizePhone(user?.whatsappConsent?.number);
  if (user?.whatsappConsent?.status !== "granted" || number.length < 9) return false;
  if (["inactive", "disabled", "deleted"].includes(lower(user?.status))) return false;
  return sendAlert(number, alert, dedupeKey);
}

/** Headline from the most urgent item; the rest become the details line. */
function compose(items: string[], closing: string): { headline: string; details: string } | null {
  if (!items.length) return null;
  const [headline, ...rest] = items;
  return { headline, details: [...rest, closing].filter(Boolean).join(" · ") };
}

/* ------------------------------------------------------- staff morning summary */

const STAFF_GROUPS = ["system_admin", "director", "hod", "coordinator", "employee", "receptionist"];
const NEEDS_REASSIGNMENT = new Set(["needs-reassignment", "needs_reassignment", "needsreassignment", "reassignment-needed"]);

/** Documents awaiting review, and expiring within a week, across all accepted SMEs (for ROM, M&E and overseers). */
async function complianceWorkload(): Promise<Workload> {
  const [context, applications] = await Promise.all([
    loadComplianceContext(),
    db.collection("applications").where("applicationStatus", "in", ["accepted", "Accepted"])
      .select("programId", "complianceDocuments").get(),
  ]);
  const weekAhead = Date.now() + 7 * DAY_MS;
  let awaitingReview = 0;
  let expiringThisWeek = 0;
  for (const application of applications.docs) {
    const data = application.data();
    const documents = [
      ...(Array.isArray(data.complianceDocuments) ? data.complianceDocuments : []),
      ...(context.subcollectionDocuments.get(application.id) || []),
    ];
    for (const state of requirementStates(documents, context.requirementsFor(clean(data.programId)))) {
      if (state.status === "pending") awaitingReview += 1;
      if (state.status === "expiring-soon" && state.expires && state.expires.getTime() <= weekAhead) expiringThisWeek += 1;
    }
  }
  return { awaitingReview, expiringThisWeek };
}

async function reassignmentsFor(identity: StaffIdentity) {
  if (identity.roleGroup !== "hod" || !identity.departmentId) return 0;
  const snapshot = await db.collection("assignedInterventions")
    .where("departmentId", "==", identity.departmentId).select("assignmentStatus").get();
  return snapshot.docs.filter((doc) => NEEDS_REASSIGNMENT.has(lower(doc.data().assignmentStatus).replace(/\s+/g, "-"))).length;
}

type Workload = { awaitingReview: number; expiringThisWeek: number };

/** One staff member's morning summary, or null when there is nothing to tell them. */
export async function staffSummaryAlert(identity: StaffIdentity, workload: () => Promise<Workload>): Promise<Alert | null> {
  if (!STAFF_GROUPS.includes(identity.roleGroup)) return null;
  const items: string[] = [];
  // Their own finished sessions with no coverage yet (recordable from the menu's "Record a session").
  const awaiting = (await sessionsAwaitingCoverage(identity)).length;
  if (awaiting) items.push(`${plural(awaiting, "session")} of yours ${awaiting === 1 ? "needs its" : "need their"} coverage recorded`);
  if ((await documentAccess(identity)).allowed) {
    const counts = await workload();
    if (counts.awaitingReview) items.push(`${plural(counts.awaitingReview, "SME document")} waiting for review`);
    if (counts.expiringThisWeek) items.push(`${plural(counts.expiringThisWeek, "SME document")} expiring this week`);
  }
  const reassignments = await reassignmentsFor(identity);
  if (reassignments) items.push(`${plural(reassignments, "intervention")} in your department need reassigning`);
  const sessions = await sessionsTodayFor(identity);
  if (sessions.length) {
    const first = sessions.slice(0, 2).map((session) => `${clean(session.start).slice(11)} ${session.title}`).join(", ");
    items.push(`${plural(sessions.length, "session")} today: ${first}${sessions.length > 2 ? ", ..." : ""}`);
  }
  const message = compose(items, "Open the menu for details.");
  return message ? { name: identity.name, ...message } : null;
}

/** Computed at most once per run, and only if someone with document access is summarised. */
export const workloadOnce = () => {
  let pending: Promise<Workload> | null = null;
  return () => (pending = pending || complianceWorkload());
};

export const whatsappStaffMorningSummary = scheduledJob("whatsappStaffMorningSummary",
  { region: "us-central1", schedule: "30 7 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const staff = (await consentingUsers()).filter((user) => lower(user.data.role) !== "incubatee");
    const workload = workloadOnce();
    const today = sastDate(new Date());
    let sent = 0;
    for (const user of staff) {
      try {
        const alert = await staffSummaryAlert(staffIdentityFromUser(user.id, user.data, user.number), workload);
        if (alert && await sendAlert(user.number, alert, `summary:${user.id}:${today}`)) sent += 1;
      } catch (error) {
        logger.warn("whatsappAlerts.summaryFailed", { userId: user.id, error: String(error) });
      }
    }
    logger.info("WhatsApp staff morning summary", { recipients: staff.length, sent });
  });

/* ---------------------------------------------------------------- SME alerts */

/** Consenting SME logins, by participant id (users.participantId, docs/sme-identity-migration-plan.md). */
async function consentingSmes() {
  const smes = (await consentingUsers()).filter((user) => lower(user.data.role) === "incubatee");
  const byParticipant = new Map<string, Recipient & { participantName: string }>();
  for (const sme of smes) {
    const linkedId = clean(sme.data.participantId);
    let participant: FirebaseFirestore.DocumentSnapshot | undefined;
    if (linkedId) {
      const snap = await db.collection("participants").doc(linkedId).get();
      if (snap.exists) participant = snap;
    }
    if (!participant) {
      // email fallback until Phase 4 (docs/sme-identity-migration-plan.md)
      const email = lower(sme.data.email);
      if (!email) continue;
      participant = (await db.collection("participants").where("email", "==", email).limit(1).get()).docs[0];
    }
    if (!participant) continue;
    const data = participant.data() || {};
    byParticipant.set(participant.id, {
      ...sme,
      participantName: clean(data.beneficiaryName || data.participantName || data.businessName || data.companyName || sme.data.name),
    });
  }
  return byParticipant;
}

const OUTSTANDING_LABELS: Record<string, string> = {
  missing: "not uploaded",
  expired: "expired",
  invalid: "needs a new upload",
  rejected: "needs a new upload",
  queried: "queried",
  "expiring-soon": "expiring soon",
};

/** An SME's weekly reminder of documents still needed, or null when they're up to date. */
export async function smeDocumentAlert(participantId: string, name: string): Promise<Alert | null> {
  const records = await participantComplianceRecords(participantId);
  if (!records.application) return null;
  const owed = requirementStates(records.documents, records.requirements).filter((state) => OUTSTANDING_LABELS[state.status]);
  if (!owed.length) return null;
  const list = owed.slice(0, 5).map((state) =>
    `${state.title} (${OUTSTANDING_LABELS[state.status]}${state.expires && state.status !== "missing" ? ` ${sastDate(state.expires)}` : ""})`).join(", ");
  return {
    name,
    headline: `${plural(owed.length, "compliance document")} still needed`,
    details: `${list}${owed.length > 5 ? ", ..." : ""} · Reply here with a photo or PDF of each one.`,
  };
}

export const whatsappSmeDocumentReminders = scheduledJob("whatsappSmeDocumentReminders",
  { region: "us-central1", schedule: "0 9 * * 1", timeZone: "Africa/Johannesburg", timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const smes = await consentingSmes();
    const week = sastDate(new Date());
    let sent = 0;
    for (const [participantId, sme] of smes) {
      try {
        const alert = await smeDocumentAlert(participantId, clean(sme.data.name) || sme.participantName);
        if (alert && await sendAlert(sme.number, alert, `documents:${participantId}:${week}`)) sent += 1;
      } catch (error) {
        logger.warn("whatsappAlerts.documentReminderFailed", { participantId, error: String(error) });
      }
    }
    logger.info("WhatsApp SME document reminders", { recipients: smes.size, sent });
  });

const DELIVERY = { in_person: "in person", virtual: "online", telephonically: "by phone" } as Record<string, string>;

/** Tomorrow's SME invitations that are still on, each with its reminder (before checking consent). */
export async function sessionReminderAlerts(): Promise<Array<{ appointmentId: string; smeId: string; alert: Omit<Alert, "name"> }>> {
  const sessions = await db.collection("appointmentSessions")
    .where("startAt", ">=", admin.firestore.Timestamp.fromDate(sastMidnight(1)))
    .where("startAt", "<", admin.firestore.Timestamp.fromDate(sastMidnight(2)))
    .get();
  const reminders = [];
  for (const session of sessions.docs.filter((doc) => !["cancelled", "completed"].includes(lower(doc.data().status)))) {
    const data = session.data();
    const start = data.startAt.toDate();
    const how = DELIVERY[clean(data.deliveryMethod)] || "";
    const where = clean(data.deliveryMethod) === "in_person" && clean(data.location) ? ` at ${clean(data.location)}` : "";
    const invitations = await db.collection("appointments").where("appointmentSessionId", "==", session.id).get();
    for (const invitation of invitations.docs) {
      const invite = invitation.data();
      if (["cancelled", "completed"].includes(lower(invite.status)) || lower(invite.smeConfirmation) === "declined") continue;
      const confirm = lower(invite.smeConfirmation) === "accepted"
        ? "See you there!"
        : "Please confirm you'll attend: open the menu and choose Respond to an invitation.";
      reminders.push({
        appointmentId: invitation.id,
        smeId: clean(invite.smeId),
        alert: {
          headline: `Reminder: your session tomorrow at ${sastTime(start)}`,
          details: `${clean(data.interventionTitle) || clean(data.title) || "Your session"}${how ? `, ${how}` : ""}${where} · ${confirm}`,
        },
      });
    }
  }
  return reminders;
}

export const whatsappSmeSessionReminders = scheduledJob("whatsappSmeSessionReminders",
  { region: "us-central1", schedule: "0 8 * * *", timeZone: "Africa/Johannesburg", timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const reminders = await sessionReminderAlerts();
    if (!reminders.length) return;
    const smes = await consentingSmes();
    let sent = 0;
    for (const reminder of reminders) {
      const sme = smes.get(reminder.smeId);
      if (!sme) continue;
      const alert = { name: clean(sme.data.name) || sme.participantName, ...reminder.alert };
      if (await sendAlert(sme.number, alert, `session:${reminder.appointmentId}`)) sent += 1;
    }
    logger.info("WhatsApp SME session reminders", { reminders: reminders.length, sent });
  });

/* ------------------------------------------------- new SME uploads, for ROM */

const NOTICE_STATE = db.collection("systemSettings").doc("whatsappUploadNotices");

export const whatsappSmeUploadNotices = scheduledJob("whatsappSmeUploadNotices",
  { region: "us-central1", schedule: "5 8-17 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const now = admin.firestore.Timestamp.now();
    // Since the last run, so uploads overnight and over the weekend are in the first notice of the day.
    const since = (await NOTICE_STATE.get()).data()?.lastRunAt || admin.firestore.Timestamp.fromMillis(now.toMillis() - 60 * 60 * 1000);
    const uploads = await db.collection("whatsappUploads")
      .where("attachedAt", ">", since).where("attachedAt", "<=", now).get();
    const filed = uploads.docs.filter((doc) => ["attached", "appended"].includes(doc.data().status));
    if (filed.length) {
      const lines: string[] = [];
      for (const doc of filed.slice(0, 5)) {
        const data = doc.data();
        const target = data.status === "appended" ? (await db.collection("whatsappUploads").doc(clean(data.appendedTo)).get()).data() : data;
        const participant = (await db.collection("participants").doc(clean(data.participantId)).get()).data() || {};
        const name = clean(participant.beneficiaryName || participant.participantName || participant.businessName || participant.companyName) || "An SME";
        lines.push(`${name}: ${clean(target?.title) || "a document"}${data.status === "appended" ? " (extra page)" : ""}`);
      }
      const rom = [];
      for (const user of (await consentingUsers()).filter((item) => lower(item.data.role) !== "incubatee")) {
        const identity = staffIdentityFromUser(user.id, user.data, user.number);
        if (["hod", "coordinator"].includes(identity.roleGroup) && await isDepartmentInRole(identity.departmentId, "rom")) rom.push({ user, identity });
      }
      let sent = 0;
      for (const { user, identity } of rom) {
        const alert = {
          name: identity.name,
          headline: `${plural(filed.length, "new document")} from SMEs on WhatsApp`,
          details: `${lines.join(", ")}${filed.length > 5 ? ", ..." : ""} · Review them on the Lepharo compliance page.`,
        };
        // Keyed on the window's start, so a retried run doesn't send again.
        if (await sendAlert(user.number, alert, `uploads:${user.id}:${since.toMillis()}`)) sent += 1;
      }
      logger.info("WhatsApp SME upload notices", { uploads: filed.length, recipients: rom.length, sent });
    }
    await NOTICE_STATE.set({ lastRunAt: now }, { merge: true });
  });
