import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { scheduledJob } from "./cronHeartbeat";
import { admin, APP_BASE_URL, db, sendStatusChangeNotification } from "./emailShared";
import { notifyInApp } from "./inAppNotifications";
import { canRemind, sendMovReminder } from "./movReminders";
import { normalizePackStatus, storedPackStatuses } from "./packStatus";
import { suppressRecordNotifications } from "./syntheticData";
import { matchByName } from "./watchesLogic";
import {
  deadlineEnd, describeChaser, MAX_ACTIVE_CHASERS, MAX_ITEMS, MAX_NUDGES_WITH_EXTRA, newItem, planRun,
  progressLine, STAGE_STATUSES, WAITING, waitingList, waitingOn,
  normaliseChaserSpec, scopeToDepartment, type ChaserCollection, type ChaserItem, type ChaserSpec,
} from "./chasersLogic";

/**
 * Chasers (see chasersLogic.ts). manageChaser previews, starts, ends, extends and escalates a
 * person's chasers; chasersCron runs every weekday morning, nudging through the Control Tower's
 * own reminder (sendMovReminder) and telling the owner in-app only when something needs them:
 * everything is done, an item has used its allowance, or the deadline has come.
 * chasers/{id} is readable by its owner only; every write goes through here.
 */

const CHASERS = "chasers";
const CALLABLE_CORS = ["http://localhost:5173", "http://localhost:5182", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"];
const LINK = "/chat?open=chasers";
const DAY_MS = 86_400_000;
const MAX_LOG = 20;

const clean = (value: unknown) => String(value ?? "").trim();
const fold = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const millis = (value: any): number => {
  const date = value?.toDate?.() ?? (value ? new Date(value) : null);
  const time = date ? date.getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
};
/** Every word the person said appears in the name: "legal" finds "Legal Advisory Services". */
const nameHas = (name: unknown, wanted: string) => {
  const folded = ` ${fold(name)} `;
  return fold(wanted).split(" ").every((word) => folded.includes(` ${word}`));
};

/** departmentId: a head of department outside ROM and M&E, who chases only their department's queried MOVs. */
type Owner = { uid: string; name: string; email: string; allowed: boolean; departmentId: string | null };

async function ownerOf(uid: string): Promise<Owner> {
  const snapshot = await db.collection("users").doc(uid).get();
  const profile = (snapshot.data() || {}) as Record<string, any>;
  const everything = snapshot.exists && (await canRemind(profile));
  const departmentId = !everything && clean(profile.role).toLowerCase() === "operations" ? clean(profile.departmentId) || null : null;
  return {
    uid,
    name: clean(profile.name || profile.displayName || profile.email) || "A colleague",
    email: clean(profile.email),
    allowed: everything || !!departmentId,
    departmentId,
  };
}

// ---- Which records a chaser covers ----

const smeName = (doc: any) => clean(doc.smmeCompanyName || doc.beneficiaryName || doc.smmeName || doc.participantName) || "An SME";
const labelFor = (collection: ChaserCollection, doc: any) =>
  collection === "movDocuments"
    ? `${smeName(doc)} – ${clean(doc.interventionTitle) || "intervention"}`
    : `${clean(doc.department || doc.departmentName) || "A department"}'s ${clean(doc.month)} MOV pack`.replace(/\s+/g, " ");

type Found = { collection: ChaserCollection; id: string; label: string; status: string };
type Preview = {
  spec?: ChaserSpec;
  description?: string;
  items?: Array<{ label: string; waitingOn: string }>;
  choose?: { field: "programme"; options: Array<{ id: string; name: string }> };
  problem?: string;
  found?: Found[];
};

async function findItems(spec: ChaserSpec): Promise<Found[]> {
  // A stage names one collection; otherwise MOVs, plus packs unless the person named SMEs (packs have none).
  const wanted: Array<{ collection: ChaserCollection; statuses: string[] }> = spec.stage
    ? [{ collection: STAGE_STATUSES[spec.stage].collection, statuses: STAGE_STATUSES[spec.stage].statuses }]
    : [
        { collection: "movDocuments", statuses: Object.keys(WAITING.movDocuments) },
        ...(spec.participantNames ? [] : [{ collection: "consolidatedMOVs" as const, statuses: Object.keys(WAITING.consolidatedMOVs) }]),
      ];
  const found: Found[] = [];
  for (const { collection, statuses } of wanted) {
    const stored = collection === "consolidatedMOVs" ? statuses.flatMap(storedPackStatuses) : statuses;
    const snapshot = await db.collection(collection).where("status", "in", stored).get();
    for (const doc of snapshot.docs) {
      const data = doc.data() as any;
      if (spec.departmentId && clean(data.departmentId) !== spec.departmentId) continue;
      if (spec.programId && clean(data.programId) !== spec.programId) continue;
      if (spec.departmentName && !nameHas(data.departmentName || data.department, spec.departmentName)) continue;
      if (spec.participantNames && !spec.participantNames.some((name) =>
        [data.smmeCompanyName, data.beneficiaryName, data.smmeName, data.participantName].some((value) => clean(value) && nameHas(value, name)))) continue;
      const status = collection === "consolidatedMOVs" ? normalizePackStatus(data.status) : clean(data.status);
      found.push({ collection, id: doc.id, label: labelFor(collection, data), status });
    }
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

async function preview(raw: any, now: number, owner: Owner): Promise<Preview> {
  const out = { ...(raw || {}) };
  if (clean(raw?.programName) && !clean(raw?.programId)) {
    const programs = await db.collection("programs").get();
    const found = matchByName(raw.programName, programs.docs.map((doc) => ({ id: doc.id, name: clean(doc.get("name") || doc.get("programName")) })));
    if (!found.length) return { problem: `I couldn't find a programme called "${raw.programName}".` };
    if (found.length > 1) return { choose: { field: "programme", options: found.slice(0, 8) } };
    out.programId = found[0].id;
    out.programName = found[0].name;
  }
  const normalised = normaliseChaserSpec(out, now);
  const { spec, error } = normalised.spec && owner.departmentId ? scopeToDepartment(normalised.spec, owner.departmentId) : normalised;
  if (!spec) return { problem: error };
  const found = await findItems(spec);
  if (!found.length) return { spec, problem: "Nothing matching that is waiting on anyone right now." };
  if (found.length > MAX_ITEMS) {
    return { spec, problem: `That's ${found.length} records; a chaser takes up to ${MAX_ITEMS}. Narrow it by department, programme, stage or SME.` };
  }
  return {
    spec,
    found,
    description: describeChaser(spec, found.length),
    items: found.map((item) => ({ label: item.label, waitingOn: waitingOn(item.collection, item.status) })),
  };
}

const sameSpec = (a: any, b: ChaserSpec) => {
  const key = (spec: any) => JSON.stringify(Object.keys(spec || {}).sort().map((field) => [field, spec[field]]));
  return key(a) === key(b);
};

const logEntry = (now: number, text: string) => ({ at: now, text });
const withLog = (data: any, entries: Array<{ at: number; text: string }>) =>
  [...entries.reverse(), ...(Array.isArray(data.log) ? data.log : [])].slice(0, MAX_LOG);

export const manageChaser = onCall({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
  const owner = await ownerOf(request.auth.uid);
  if (!owner.allowed) throw new HttpsError("permission-denied", "Chasers are for the people who can send reminders from the Control Tower, and heads of department.");
  const action = clean(request.data?.action);
  const now = Date.now();

  if (action === "preview" || action === "create") {
    const { found, ...shown } = await preview(request.data?.spec, now, owner);
    if (!found || !shown.spec) return shown;
    const spec = shown.spec;
    const active = await db.collection(CHASERS).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
    // A card reopened from chat history, or pressed twice: it is the chaser already running.
    const same = active.docs.find((doc) => sameSpec(doc.get("spec"), spec));
    if (action === "preview" || same) return { ...shown, ...(same ? { id: same.id, alreadyChasing: true } : {}) };
    if (active.size >= MAX_ACTIVE_CHASERS) return { ...shown, problem: `You already have ${MAX_ACTIVE_CHASERS} chasers running. End one first.` };
    const ref = await db.collection(CHASERS).add({
      ownerUid: owner.uid,
      spec,
      description: shown.description,
      words: clean(request.data?.words).slice(0, 300) || null,
      status: "active",
      items: found.map((item) => newItem(item.collection, item.id, item.label, item.status)),
      startedAt: now,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      deadlineAt: admin.firestore.Timestamp.fromMillis(deadlineEnd(spec.deadline)),
      deadlineReported: false,
      log: [logEntry(now, `Started: ${shown.description}`)],
    });
    // The first nudges go out now rather than tomorrow morning.
    const result = await runChaser(await ref.get(), owner, now);
    return { ...shown, id: ref.id, nudged: result.nudged };
  }

  const id = clean(request.data?.id);
  const ref = id ? db.collection(CHASERS).doc(id) : null;
  const snapshot = ref ? await ref.get() : null;
  if (!ref || !snapshot?.exists || snapshot.get("ownerUid") !== owner.uid) throw new HttpsError("not-found", "That chaser isn't yours or no longer exists.");
  const data = snapshot.data() as any;
  if (data.status !== "active") throw new HttpsError("failed-precondition", "That chaser has already stopped.");
  const items = (data.items || []) as ChaserItem[];

  if (action === "end") {
    await ref.update({ status: "ended", endedAt: admin.firestore.FieldValue.serverTimestamp(), log: withLog(data, [logEntry(now, "You stopped it.")]) });
    return { id, status: "ended" };
  }

  if (action === "extend") {
    // One more nudge for each item that used its allowance; asked about again only if that runs out too.
    const spec = data.spec as ChaserSpec;
    let extended = 0;
    const next = items.map((item) => {
      if (item.done || !item.asked || item.escalated || spec.maxNudges + item.extra >= MAX_NUDGES_WITH_EXTRA) return item;
      extended += 1;
      return { ...item, extra: item.extra + 1, asked: false };
    });
    if (!extended) return { id, status: "active", problem: "Nothing is waiting on another round." };
    await ref.update({ items: next, log: withLog(data, [logEntry(now, `You allowed one more nudge for ${extended}.`)]) });
    const result = await runChaser(await ref.get(), owner, now);
    return { id, status: "active", extended, nudged: result.nudged };
  }

  if (action === "escalate") return escalate(snapshot, owner, now);
  if (action === "check") return runChaser(snapshot, owner, now);
  throw new HttpsError("invalid-argument", "Unknown chaser action.");
});

// ---- Escalating, only when the owner says so ----

async function lineManagersOf(uids: string[]): Promise<Array<{ uid: string; email: string; name: string }>> {
  const people = await Promise.all(uids.slice(0, 10).map((uid) => db.collection("users").doc(uid).get()));
  const managerIds = Array.from(new Set(people.map((doc) => clean(doc.get("lineManagerId"))).filter((uid) => uid && !uids.includes(uid))));
  const managers = await Promise.all(managerIds.map((uid) => db.collection("users").doc(uid).get()));
  return managers
    .filter((doc) => doc.exists && clean(doc.get("email")))
    .map((doc) => ({ uid: doc.id, email: clean(doc.get("email")), name: clean(doc.get("name") || doc.get("displayName")) }));
}

async function escalate(snapshot: FirebaseFirestore.DocumentSnapshot, owner: Owner, now: number) {
  const data = snapshot.data() as any;
  const items = (data.items || []) as ChaserItem[];
  const due = items.filter((item) => !item.done && item.asked && !item.escalated);
  if (!due.length) return { id: snapshot.id, status: "active", problem: "Nothing is waiting to be escalated." };

  const base = APP_BASE_URL.replace(/\/$/, "");
  const results: string[] = [];
  const next = [...items];
  for (const item of due) {
    const record = await db.collection(item.collection).doc(item.id).get();
    const index = next.findIndex((entry) => entry.id === item.id);
    if (record.exists && suppressRecordNotifications(record.data(), record.id)) {
      results.push(`${item.label}: a test record, so nothing was sent`);
      next[index] = { ...item, escalated: true };
      continue;
    }
    const managers = await lineManagersOf(item.lastNudgedUids || []);
    if (!managers.length) {
      results.push(`${item.label}: no line manager is on file for ${waitingOn(item.collection, item.status)}`);
      continue;
    }
    const text =
      `${owner.name} has chased ${item.label} ${item.nudges} time${item.nudges === 1 ? "" : "s"} and it is still waiting on ` +
      `${waitingOn(item.collection, item.status)}, who report${item.lastNudgedUids.length === 1 ? "s" : ""} to you. ` +
      `It's needed by ${new Date(deadlineEnd(data.spec.deadline)).toLocaleDateString("en-ZA", { day: "numeric", month: "long", timeZone: "Africa/Johannesburg" })}. Could you help move it along?`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;"><p>Hi there,</p><p>${text}</p><p><a href="${base}/operations/movs" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:6px;">Open Smart Incubation</a></p></div>`;
    try {
      await sendStatusChangeNotification(managers.map((m) => m.email), `Escalated: ${item.label}`, html, text);
    } catch (error) {
      logger.error("chasers.escalate_email_failed", { id: snapshot.id, item: item.id, error: String(error) });
    }
    await notifyInApp({ type: "chaser_escalation", message: text, recipientIds: managers.map((m) => m.uid), link: "/operations/movs", chaserId: snapshot.id });
    results.push(`${item.label}: sent to ${managers.map((m) => m.name || m.email).join(", ")}`);
    next[index] = { ...item, escalated: true };
  }
  await snapshot.ref.update({ items: next, log: withLog(data, results.map((line) => logEntry(now, `Escalated ${line}.`))) });
  return { id: snapshot.id, status: "active", escalated: results };
}

// ---- The morning run ----

async function runChaser(snapshot: FirebaseFirestore.DocumentSnapshot, owner: Owner, now: number) {
  const data = snapshot.data() as any;
  const spec = data.spec as ChaserSpec;
  if (!owner.allowed) {
    await snapshot.ref.update({ status: "ended", endedReason: "The owner can no longer send reminders.", endedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id: snapshot.id, status: "ended", nudged: 0 };
  }
  const previous = (data.items || []) as ChaserItem[];
  const refs = previous.map((item) => db.collection(item.collection).doc(item.id));
  const records = refs.length ? await db.getAll(...refs) : [];
  const statusNow = new Map<string, string>();
  const recently = new Set<string>();
  const docs = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  records.forEach((record, index) => {
    const item = previous[index];
    if (!record.exists) return;
    const doc = record.data() as any;
    docs.set(item.id, record);
    statusNow.set(item.id, item.collection === "consolidatedMOVs" ? normalizePackStatus(doc.status) : clean(doc.status));
    const last = doc.lastManualReminder;
    // Someone else's reminder today: the Control Tower allows one a day, so wait for tomorrow.
    if (last && clean(last.chaserId) !== snapshot.id && now - millis(last.at) < DAY_MS) recently.add(item.id);
  });

  const plan = planRun(spec, Number(data.startedAt) || millis(data.createdAt) || now, previous, statusNow, recently, now);
  const items = plan.items;
  const log: Array<{ at: number; text: string }> = [];
  plan.finished.forEach((id) => log.push(logEntry(now, `${items.find((item) => item.id === id)?.label} moved on.`)));
  const due = new Date(deadlineEnd(spec.deadline)).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });

  let nudged = 0;
  for (const id of plan.nudge) {
    const index = items.findIndex((item) => item.id === id);
    const item = items[index];
    const record = docs.get(id);
    if (!record) continue;
    if (suppressRecordNotifications(record.data(), record.id)) {
      items[index] = { ...item, skipped: "A test record, so no nudges are sent." };
      continue;
    }
    try {
      const sent = await sendMovReminder(record.ref, { collection: item.collection, id }, record.data() as any, {}, { uid: owner.uid, name: owner.name, email: owner.email }, "", {
        chaserId: snapshot.id,
        skipSender: true,
        footer: `It's needed by ${due}.`,
      });
      items[index] = { ...item, nudges: item.nudges + 1, lastNudgeAt: now, lastNudgedUids: sent.uids, lastNudgedRole: sent.audience };
      log.push(logEntry(now, `Nudged ${sent.audience} about ${item.label} (${item.nudges + 1} of ${spec.maxNudges + item.extra}).`));
      nudged += 1;
    } catch (error) {
      // Nobody on file to remind: keep tracking it, and say why it isn't being nudged.
      const reason = error instanceof HttpsError ? error.message : "The reminder couldn't be sent.";
      items[index] = { ...item, skipped: reason };
      log.push(logEntry(now, `Can't nudge about ${item.label}: ${reason}`));
      logger.warn("chasers.nudge_failed", { id: snapshot.id, item: id, error: String(error) });
    }
  }

  const update: Record<string, unknown> = { lastRunAt: now };
  const tell = async (title: string, message: string) =>
    notifyInApp({ type: "chaser_update", title, message, link: LINK, recipientIds: [owner.uid], chaserId: snapshot.id });

  if (plan.allDone) {
    update.status = "done";
    update.endedAt = admin.firestore.FieldValue.serverTimestamp();
    await tell(`Chaser done: all ${items.length} moved on`, `${data.description} Everything has moved on.`);
    log.push(logEntry(now, "Everything has moved on."));
  } else {
    if (plan.ask.length) {
      const asked = items.filter((item) => plan.ask.includes(item.id));
      plan.ask.forEach((id) => {
        const index = items.findIndex((item) => item.id === id);
        items[index] = { ...items[index], asked: true };
      });
      await tell(
        `Chaser: ${asked.length} still waiting after ${spec.maxNudges} nudge${spec.maxNudges === 1 ? "" : "s"}`,
        `${waitingList(asked)}. Escalate to their line managers, allow one more nudge, or leave it? ${progressLine(items)}.`,
      );
      log.push(logEntry(now, `Asked you about ${asked.length} that used their nudges.`));
    }
    if (plan.pastDeadline && !data.deadlineReported) {
      update.deadlineReported = true;
      await tell(`Chaser deadline: ${progressLine(items)}`, `Still waiting: ${waitingList(items)}. No more nudges will go out.`);
      log.push(logEntry(now, `Deadline passed with ${progressLine(items)}.`));
    }
    if (plan.expired) {
      update.status = "expired";
      update.endedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }
  update.items = items;
  if (log.length) update.log = withLog(data, log);
  await snapshot.ref.update(update);
  return { id: snapshot.id, status: (update.status as string) || "active", nudged, progress: progressLine(items) };
}

export async function runChasers(now = Date.now()) {
  const active = await db.collection(CHASERS).where("status", "==", "active").get();
  const owners = new Map<string, Owner>();
  let nudged = 0;
  for (const doc of active.docs) {
    try {
      const uid = clean(doc.get("ownerUid"));
      if (!owners.has(uid)) owners.set(uid, await ownerOf(uid));
      nudged += (await runChaser(doc, owners.get(uid) as Owner, now)).nudged;
    } catch (error) {
      logger.warn("chasers.run_failed", { id: doc.id, error: String(error) });
    }
  }
  return { checked: active.size, nudged };
}

// 07:45 SAST on weekdays: nudges arrive at the start of the working day, before the 08:20 stage reminders.
export const chasersCron = scheduledJob("chasersCron",
  { region: "us-central1", schedule: "45 7 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    logger.info("chasers.done", await runChasers());
  }
);
