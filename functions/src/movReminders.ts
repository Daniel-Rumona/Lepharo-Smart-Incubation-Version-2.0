import * as logger from "firebase-functions/logger";
import { suppressRecordNotifications } from "./syntheticData";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  admin,
  db,
  APP_BASE_URL,
  getCCRecipients,
  getMERecipients,
  sendStatusChangeNotification,
  buildPackReminderEmail,
} from "./emailShared";
import { getDepartmentHods, getProgramProjectAdmins, resolvePackProgramId, resolveMovDepartmentId, uidsForEmails } from "./movRecipients";
import { assignee, participant } from "./workflowEmailFunctions";
import { PACK_STATUS, normalizePackStatus } from "./packStatus";
import { isDepartmentInRole } from "./departmentRoles";

const DAY_MS = 24 * 60 * 60 * 1000;

type Collection = "movDocuments" | "consolidatedMOVs" | "assignedInterventions";
type Target = { collection: Collection; id: string };
type Role = "HOD" | "Facilitator" | "SME" | "CC" | "M&E";

/** One group of people who get one tailored message. */
type Group = {
  role: Role;
  emails: string[];
  uids: string[];
  path: string;
  /** What this group is being asked to do, in a sentence. */
  ask: string;
};

const clean = (value: unknown) => String(value ?? "").trim();

/**
 * Same people who may open the Control Tower: ROM and M&E (operations
 * department users), project admins, and system admins.
 */
async function canRemind(caller: Record<string, any>): Promise<boolean> {
  const role = clean(caller.role).toLowerCase();
  if (role === "system_admin" || role === "projectadmin") return true;
  if (role !== "operations") return false;
  const departmentId = clean(caller.departmentId);
  return (await isDepartmentInRole(departmentId, "rom")) || (await isDepartmentInRole(departmentId, "monitoring"));
}

const withUids = async (role: Role, emails: string[], path: string, ask: string): Promise<Group> => ({
  role,
  emails,
  uids: await uidsForEmails(emails),
  path,
  ask,
});

/** HODs of the document's department, or null when the department / HOD can't be found. */
async function hodGroup(doc: Record<string, any>, path: string, ask: string): Promise<Group | null> {
  const departmentId = await resolveMovDepartmentId(doc);
  if (!departmentId) return null;
  const hods = await getDepartmentHods(departmentId);
  return hods.emails.length ? { role: "HOD", emails: hods.emails, uids: hods.uids, path, ask } : null;
}

/** The facilitator on a MOV (facilitator* fields) or on an assignment (assignee* fields). */
async function facilitatorGroup(doc: Record<string, any>, path: string, ask: string): Promise<Group | null> {
  const person = await assignee({
    assigneeEmail: doc.facilitatorEmail ?? doc.assigneeEmail,
    assigneeId: doc.facilitatorId ?? doc.assigneeId,
    assigneeName: doc.facilitatorName ?? doc.assigneeName,
  });
  return person.email ? withUids("Facilitator", [person.email], path, ask) : null;
}

/** The SME, found the same way the existing "remind SME" action finds them. */
async function smeGroup(doc: Record<string, any>, ask: string): Promise<Group | null> {
  const person = await participant({
    participantId: doc.participantId ?? doc.beneficiaryId ?? doc.smmeId,
    participantEmail: doc.participantEmail ?? doc.smmeEmail,
    participantName: doc.participantName ?? doc.beneficiaryName,
  });
  return person.email ? withUids("SME", [person.email], "/incubatee/interventions", ask) : null;
}

const compact = <T>(items: Array<T | null>): T[] => items.filter((item): item is T => item !== null);

async function resolveGroups(target: Target, doc: Record<string, any>, request: Record<string, any>): Promise<{ groups: Group[]; empty: string }> {
  const status = clean(doc.status);

  if (target.collection === "movDocuments") {
    if (status === "awaiting_smme") {
      return { groups: compact([await smeGroup(doc, "confirm the work delivered to you so the MOV can move on")]), empty: "No contact email was found for this SME." };
    }
    if (status === "awaiting_hod" || status === "approved") {
      // `approved` with no pack is also the HOD's job: they still have to submit the monthly pack.
      const ask = status === "awaiting_hod" ? "approve this MOV" : "include this approved MOV in the monthly pack";
      return { groups: compact([await hodGroup(doc, "/operations/movs", ask)]), empty: `No HOD is on file for ${clean(doc.departmentName) || "this department"}.` };
    }
    if (status === "queried" || status === "rejected") {
      // The facilitator has to answer or fix it; the HOD raised it, so keeps it in view.
      const groups = compact([
        await facilitatorGroup(doc, "/coordinator/movs", status === "queried" ? "respond to the query raised on this MOV" : "fix and resubmit this rejected MOV"),
        await hodGroup(doc, "/operations/movs", status === "queried" ? "follow up on the query still open on this MOV" : "follow up on this rejected MOV"),
      ]);
      return { groups, empty: "Neither the facilitator nor a HOD could be found for this MOV." };
    }
    throw new HttpsError("failed-precondition", "There is no one to remind at this MOV stage.");
  }

  if (target.collection === "consolidatedMOVs") {
    const packStatus = normalizePackStatus(status);
    if (packStatus === PACK_STATUS.AWAITING_CC) {
      // The programme's own Center Coordinator; every project admin only if none is linked.
      const own = await getProgramProjectAdmins(resolvePackProgramId(doc));
      const emails = own.emails.length ? own.emails : await getCCRecipients();
      return { groups: emails.length ? [await withUids("CC", emails, "/projectadmin/movs", "confirm this MOV pack")] : [], empty: "No project admin recipients found." };
    }
    if (packStatus === PACK_STATUS.AWAITING_ME) {
      const emails = await getMERecipients();
      return { groups: emails.length ? [await withUids("M&E", emails, "/operations/monitoring/movs", "validate this MOV pack")] : [], empty: "No M&E recipients found." };
    }
    throw new HttpsError("failed-precondition", "There is no one to remind at this pack stage.");
  }

  // assignedInterventions: the client says which kind of delivery stall this is.
  const state = clean(request.state);
  switch (state) {
    case "awaiting-acceptance":
      return { groups: compact([await smeGroup(doc, "respond to the appointment for this intervention")]), empty: "No contact email was found for this SME." };
    case "awaiting-confirmation":
      return { groups: compact([await smeGroup(doc, "confirm completion of this intervention")]), empty: "No contact email was found for this SME." };
    case "in-delivery":
      return { groups: compact([await facilitatorGroup(doc, "/coordinator/allocated", "deliver and record this intervention")]), empty: "No facilitator email found." };
    case "declined":
      return {
        groups: compact([
          await facilitatorGroup(doc, "/coordinator/allocated", "reschedule this intervention - the SME declined"),
          await hodGroup(doc, "/operations/assignments", "follow up on this intervention - the SME declined"),
        ]),
        empty: "Neither the facilitator nor a HOD could be found.",
      };
    case "rejected":
      return {
        groups: compact([
          await facilitatorGroup(doc, "/coordinator/allocated", "redo or correct this intervention - the SME rejected completion"),
          await hodGroup(doc, "/operations/assignments", "follow up on this intervention - the SME rejected completion"),
        ]),
        empty: "Neither the facilitator nor a HOD could be found.",
      };
    case "needs-reassignment":
      return { groups: compact([await hodGroup(doc, "/operations/assignments", "reassign this intervention to a facilitator")]), empty: `No HOD is on file for ${clean(doc.departmentName) || "this department"}.` };
    default:
      throw new HttpsError("invalid-argument", "Unknown delivery state.");
  }
}

const describe = (target: Target, doc: Record<string, any>) => {
  if (target.collection === "consolidatedMOVs") {
    return `${clean(doc.department) || "a department"}'s ${clean(doc.month)} MOV pack`.replace(/\s+/g, " ");
  }
  const who = clean(doc.beneficiaryName || doc.participantName) || "a participant";
  const what = clean(doc.interventionTitle) || "intervention";
  return target.collection === "movDocuments" ? `the MOV for ${who} (${what})` : `the ${what} intervention for ${who}`;
};

/**
 * Manual "nudge" from the Control Tower. Works out who has to act next for the
 * item's current state (SME, facilitator, HOD, Centre Coordinator or M&E),
 * emails each group a message tailored to what they must do, adds an in-app
 * notification, and records the reminder on the document so the team can see
 * who chased what. One reminder per document per day.
 */
export const remindMovOwner = onCall({ timeoutSeconds: 60 }, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "You must be signed in.");

  const raw = clean(request.data?.collection);
  const collection: Collection =
    raw === "consolidatedMOVs" ? "consolidatedMOVs" : raw === "assignedInterventions" ? "assignedInterventions" : "movDocuments";
  const target: Target = { collection, id: clean(request.data?.id) };
  if (!target.id) throw new HttpsError("invalid-argument", "Provide the record id.");
  const note = clean(request.data?.note).slice(0, 500);

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = (callerSnap.data() || {}) as Record<string, any>;
  if (!callerSnap.exists || !(await canRemind(caller))) {
    throw new HttpsError("permission-denied", "You are not allowed to send reminders.");
  }

  const ref = db.collection(target.collection).doc(target.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That record no longer exists.");
  const doc = snap.data() as Record<string, any>;
  if (suppressRecordNotifications(doc, target.id)) {
    return { ok: true, suppressed: true, reason: "Synthetic data does not send reminders." };
  }

  const lastAt: Date | null = doc.lastManualReminder?.at?.toDate?.() ?? null;
  if (lastAt && Date.now() - lastAt.getTime() < DAY_MS) {
    const by = clean(doc.lastManualReminder?.byName) || "someone";
    throw new HttpsError("resource-exhausted", `Already reminded today by ${by}. Try again tomorrow.`);
  }

  const { groups, empty } = await resolveGroups(target, doc, request.data || {});
  if (!groups.length) throw new HttpsError("failed-precondition", empty);

  const callerName = clean(caller.name || caller.displayName || caller.email) || "A colleague";
  const base = APP_BASE_URL.replace(/\/$/, "");
  const subject = describe(target, doc);

  for (const group of groups) {
    const text =
      `${callerName} is asking for your action: please ${group.ask} - ${subject}.` + (note ? ` Note: "${note}"` : "");
    const content = buildPackReminderEmail(group.role, text, `${base}${group.path}`);
    try {
      await sendStatusChangeNotification(group.emails, content.subject, content.html, content.text);
    } catch (error) {
      logger.error("remindMovOwner.emailFailed", { target, role: group.role, error: String(error) });
    }
    // In-app copy only where we know the person's account; the email always goes out.
    if (group.uids.length) {
      await db.collection("notifications").add({
        type: "mov_manual_reminder",
        message: text,
        recipientIds: group.uids,
        movCollection: target.collection,
        movId: target.id,
        link: group.path,
        createdAt: new Date(),
        readBy: {},
      });
    }
  }

  const audience = groups.map((g) => g.role).join(" + ");
  const entry = {
    at: admin.firestore.Timestamp.now(),
    byUid: callerUid,
    byName: callerName,
    owner: audience,
    note: note || null,
    count: groups.reduce((sum, g) => sum + g.emails.length, 0),
  };
  await ref.update({
    lastManualReminder: entry,
    manualReminders: admin.firestore.FieldValue.arrayUnion(entry),
  });

  return { sent: entry.count, owner: audience, audience };
});
