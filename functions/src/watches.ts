import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { scheduledJob } from "./cronHeartbeat";
import { admin, db } from "./emailShared";
import { notifyInApp } from "./inAppNotifications";
import { impactHeadline, type ImpactResult } from "./impactLogic";
import {
  currentMatches, describeWatch, firingMessage, matchByName, MAX_ACTIVE_WATCHES, MAX_FIRINGS_KEPT,
  nextWatchState, normaliseSpec, visibilityFor, WATCH_LIFETIME_DAYS,
  type AssignmentRow, type Visibility, type WatchSpec, type World,
} from "./watchesLogic";

/**
 * Watches (see watchesLogic.ts). manageWatch previews, starts and ends a person's watches;
 * watchesCron checks every active watch each morning after the risk scores are refreshed and
 * before the daily brief, and tells the owner in-app (which the brief then picks up).
 * watches/{id} is readable by its owner only; every write goes through here.
 */

const WATCHES = "watches";
// 5182 is the local dev server this repo runs on (5173 is often taken).
const CALLABLE_CORS = ["http://localhost:5173", "http://localhost:5182", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"];
const DAY_MS = 86_400_000;

const clean = (value: unknown) => String(value ?? "").trim();
const millis = (value: any): number => {
  const date = value?.toDate?.() ?? (value ? new Date(value) : null);
  const time = date ? date.getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
};
const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).map((item: any) => clean(item?.id ?? item)).filter(Boolean);

type Owner = { uid: string; role: string; visibility: Visibility | null };

async function ownerOf(uid: string, email = ""): Promise<Owner> {
  let snapshot = await db.collection("users").doc(uid).get();
  if (!snapshot.exists) {
    const byUid = await db.collection("users").where("uid", "==", uid).limit(1).get();
    if (!byUid.empty) snapshot = byUid.docs[0] as unknown as FirebaseFirestore.DocumentSnapshot;
    else if (email) {
      const byEmail = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!byEmail.empty) snapshot = byEmail.docs[0] as unknown as FirebaseFirestore.DocumentSnapshot;
    }
  }
  const profile: any = snapshot.exists ? snapshot.data() || {} : {};
  const role = clean(profile.role);
  // Programme-limited roles: their programmes, plus their branch's (as the assistant does).
  const programmeIds = [...ids(profile.assignedPrograms), ...ids(profile.assignedProgramId), ...ids(profile.programId)];
  for (const branchId of [...ids(profile.assignedBranch), ...ids(profile.branchId)]) {
    const programs = await db.collection("programs").where("branchId", "==", branchId).limit(100).get().catch(() => null);
    programs?.docs.forEach((doc) => programmeIds.push(doc.id));
  }
  return { uid, role, visibility: visibilityFor(role, Array.from(new Set(programmeIds)), uid) };
}

// ---- Loading what a check reads ----

async function loadWorld(specs: WatchSpec[], now: number): Promise<World> {
  const needs = new Set(specs.map((spec) => spec.type));
  const world: World = { risk: [], nextSession: new Map(), impact: [], assignments: [] };

  if (needs.has("sme_risk")) {
    const [risk, appointments] = await Promise.all([
      db.collection("smeRiskSnapshots").get(),
      db.collection("appointments").get(),
    ]);
    world.risk = risk.docs.map((doc) => {
      const data = doc.data() as any;
      return {
        participantId: doc.id,
        participantName: clean(data.participantName) || "An SME",
        programId: clean(data.programId),
        level: clean(data.level),
        score: Number(data.score) || 0,
        ownerIds: ids(data.ownerIds),
        reasons: (Array.isArray(data.reasons) ? data.reasons : []).map((item: any) => clean(item?.label)).filter(Boolean),
      };
    });
    appointments.docs.forEach((doc) => {
      const data = doc.data() as any;
      if (["cancelled", "declined", "completed"].includes(clean(data.status).toLowerCase())) return;
      const at = millis(data.startAt);
      const sme = clean(data.smeId || data.participantId);
      if (!sme || at < now) return;
      const seen = world.nextSession.get(sme);
      if (!seen || at < seen) world.nextSession.set(sme, at);
    });
  }

  if (needs.has("impact_reportable")) {
    const impact = await db.collection("interventionImpact").get();
    world.impact = impact.docs.map((doc) => {
      const data = doc.data() as ImpactResult;
      return {
        programId: clean(data.programId),
        interventionId: clean(data.interventionId),
        interventionTitle: clean(data.interventionTitle) || "This intervention",
        metric: clean(data.metric) || "revenue",
        status: clean(data.status),
        headline: impactHeadline(data) || "",
      };
    });
  }

  const participants = Array.from(new Set(specs.filter((spec) => spec.type === "intervention_done").map((spec) => spec.participantId || "").filter(Boolean)));
  for (let offset = 0; offset < participants.length; offset += 30) {
    const snapshot = await db.collection("assignedInterventions").where("participantId", "in", participants.slice(offset, offset + 30)).get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as any;
      const row: AssignmentRow = {
        id: doc.id,
        participantId: clean(data.participantId),
        participantName: clean(data.participantName) || "The SME",
        programId: clean(data.programId),
        interventionId: clean(data.interventionId),
        interventionTitle: clean(data.interventionTitle) || "an intervention",
        status: clean(data.assignmentStatus).toLowerCase(),
        assigneeId: clean(data.assigneeId),
        completedAt: millis(data.completedAt),
      };
      world.assignments.push(row);
    });
  }
  return world;
}

// ---- Turning the person's words into a watch ----

type Choice = { id: string; name: string };
type Preview = {
  spec?: WatchSpec;
  description?: string;
  /** What already matches: the watch reports only what changes after it is set. */
  alreadyMatching?: string[];
  /** When a name matched more than one record. */
  choose?: { field: "participant" | "programme" | "intervention"; options: Choice[] };
  problem?: string;
};

async function resolveNames(raw: any, owner: Owner): Promise<Preview> {
  const visibility = owner.visibility as Visibility;
  const out: any = { ...raw };

  const wantsSme = clean(raw?.participantName) && !clean(raw?.participantId);
  if (wantsSme) {
    // Every active SME has a risk snapshot, with its programme and who supports it.
    const snapshots = await db.collection("smeRiskSnapshots").get();
    const candidates = snapshots.docs
      .map((doc) => ({ id: doc.id, name: clean(doc.get("participantName")), programId: clean(doc.get("programId")), ownerIds: ids(doc.get("ownerIds")) }))
      .filter((item) => visibility.kind === "all" ||
        (visibility.kind === "programmes" && visibility.programmeIds.includes(item.programId)) ||
        (visibility.kind === "own" && item.ownerIds.includes(visibility.uid)));
    const found = matchByName(raw.participantName, candidates);
    if (!found.length) return { problem: `I couldn't find an SME called "${raw.participantName}" among the ones you support.` };
    if (found.length > 1) return { choose: { field: "participant", options: found.slice(0, 8).map(({ id, name }) => ({ id, name })) } };
    out.participantId = found[0].id;
    out.participantName = found[0].name;
  }

  if (clean(raw?.programName) && !clean(raw?.programId)) {
    const programs = await db.collection("programs").get();
    const candidates = programs.docs
      .map((doc) => ({ id: doc.id, name: clean(doc.get("name") || doc.get("programName")) }))
      .filter((item) => visibility.kind !== "programmes" || visibility.programmeIds.includes(item.id));
    const found = matchByName(raw.programName, candidates);
    if (!found.length) return { problem: `I couldn't find a programme called "${raw.programName}" that you can see.` };
    if (found.length > 1) return { choose: { field: "programme", options: found.slice(0, 8) } };
    out.programId = found[0].id;
    out.programName = found[0].name;
  }

  if (clean(raw?.interventionTitle) && !clean(raw?.interventionId)) {
    const interventions = await db.collection("interventions").get();
    const candidates = interventions.docs.map((doc) => ({ id: doc.id, name: clean(doc.get("interventionTitle") || doc.get("title")) }));
    const found = matchByName(raw.interventionTitle, candidates);
    if (!found.length) return { problem: `I couldn't find an intervention called "${raw.interventionTitle}".` };
    // The same title can exist per department; any one of them is the same intervention to the person.
    const titles = new Set(found.map((item) => item.name.toLowerCase()));
    if (titles.size > 1) return { choose: { field: "intervention", options: found.slice(0, 8) } };
    out.interventionId = found[0].id;
    out.interventionTitle = found[0].name;
  }
  return { spec: out };
}

async function preview(raw: any, owner: Owner, now: number): Promise<Preview & { keys?: string[] }> {
  const resolved = await resolveNames(raw, owner);
  if (!resolved.spec) return resolved;
  const { spec, error } = normaliseSpec(resolved.spec);
  if (!spec) return { problem: error };
  const matches = currentMatches(spec, await loadWorld([spec], now), owner.visibility as Visibility, now);
  return { spec, description: describeWatch(spec), alreadyMatching: matches.map((match) => match.title), keys: matches.map((match) => match.key) };
}

export const manageWatch = onCall({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in again.");
  const owner = await ownerOf(request.auth.uid, clean(request.auth.token?.email));
  if (!owner.visibility) throw new HttpsError("permission-denied", "Watches are for staff who support SMEs.");
  const action = clean(request.data?.action);
  const now = Date.now();

  if (action === "preview") {
    const { keys, ...shown } = await preview(request.data?.spec || {}, owner, now);
    if (!shown.spec) return shown;
    // A card reopened from chat history: say it is already running rather than offer it again.
    const active = await db.collection(WATCHES).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
    return { ...shown, alreadyWatching: active.docs.some((doc) => sameSpec(doc.get("spec"), shown.spec as WatchSpec)) };
  }

  if (action === "create") {
    const { keys, ...checked } = await preview(request.data?.spec || {}, owner, now);
    if (!checked.spec) return checked;
    const spec = checked.spec;
    const active = await db.collection(WATCHES).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
    // The same card pressed twice (or again after reopening the chat) is the watch already running.
    const same = active.docs.find((doc) => sameSpec(doc.get("spec"), spec));
    if (same) return { id: same.id, spec, description: checked.description, alreadyMatching: checked.alreadyMatching, alreadyWatching: true };
    if (active.size >= MAX_ACTIVE_WATCHES) return { problem: `You already have ${MAX_ACTIVE_WATCHES} watches running. End one first.` };
    // A watch on one record that is already true has nothing left to tell you.
    if (checked.alreadyMatching?.length && (spec.type !== "sme_risk" || spec.participantId)) {
      return { ...checked, problem: `That's already true: ${checked.alreadyMatching[0]}.` };
    }
    const ref = await db.collection(WATCHES).add({
      ownerUid: owner.uid,
      spec,
      description: checked.description,
      words: clean(request.data?.words).slice(0, 300) || null,
      status: "active",
      // What already matches is the baseline: only changes after this are news.
      matchedKeys: keys || [],
      firings: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      endsAt: admin.firestore.Timestamp.fromMillis(now + WATCH_LIFETIME_DAYS * DAY_MS),
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: ref.id, spec, description: checked.description, alreadyMatching: checked.alreadyMatching };
  }

  const id = clean(request.data?.id);
  const ref = id ? db.collection(WATCHES).doc(id) : null;
  const snapshot = ref ? await ref.get() : null;
  if (!ref || !snapshot?.exists || snapshot.get("ownerUid") !== owner.uid) throw new HttpsError("not-found", "That watch isn't yours or no longer exists.");

  if (action === "end") {
    await ref.update({ status: "ended", endedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id, status: "ended" };
  }
  if (action === "check") return checkWatch(snapshot, owner, now, await loadWorld([snapshot.get("spec")], now));
  throw new HttpsError("invalid-argument", "Unknown watch action.");
});

const sameSpec = (a: any, b: WatchSpec) => {
  const key = (spec: any) => JSON.stringify(Object.keys(spec || {}).sort().map((field) => [field, spec[field]]));
  return key(normaliseSpec(a).spec) === key(b);
};

// ---- The morning check ----

async function checkWatch(snapshot: FirebaseFirestore.DocumentSnapshot, owner: Owner, now: number, world: World) {
  const data = snapshot.data() as any;
  const { spec } = normaliseSpec(data.spec);
  if (!spec || !owner.visibility) {
    await snapshot.ref.update({ status: "ended", endedReason: "no longer valid", lastCheckedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id: snapshot.id, status: "ended", fired: 0 };
  }
  const state = nextWatchState(spec, ids(data.matchedKeys), currentMatches(spec, world, owner.visibility, now));
  const update: Record<string, unknown> = { matchedKeys: state.keys, lastCheckedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (state.fired.length) {
    const note = firingMessage(spec, state.fired);
    await notifyInApp({ type: "watch_triggered", title: note.title, message: note.message, link: note.link, recipientIds: [owner.uid], watchId: snapshot.id });
    update.firings = [{ at: now, title: note.title, message: note.message, link: note.link }, ...(Array.isArray(data.firings) ? data.firings : [])].slice(0, MAX_FIRINGS_KEPT);
    update.lastFiredAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (state.done) {
    update.status = "done";
    update.endedAt = admin.firestore.FieldValue.serverTimestamp();
  } else if (millis(data.endsAt) && millis(data.endsAt) <= now) {
    update.status = "expired";
    update.endedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await snapshot.ref.update(update);
  return { id: snapshot.id, status: (update.status as string) || "active", fired: state.fired.length };
}

export async function runWatches(now = Date.now()) {
  const active = await db.collection(WATCHES).where("status", "==", "active").get();
  if (active.empty) return { checked: 0, fired: 0 };
  const world = await loadWorld(active.docs.map((doc) => doc.get("spec")).filter(Boolean), now);
  const owners = new Map<string, Owner>();
  let fired = 0;
  for (const doc of active.docs) {
    try {
      const uid = clean(doc.get("ownerUid"));
      if (!owners.has(uid)) owners.set(uid, await ownerOf(uid));
      fired += (await checkWatch(doc, owners.get(uid) as Owner, now, world)).fired;
    } catch (error) {
      logger.warn("watches.check_failed", { id: doc.id, error: String(error) });
    }
  }
  return { checked: active.size, fired };
}

// 06:30 SAST: after the 06:00 risk scores, before the 09:30 brief.
export const watchesCron = scheduledJob("watchesCron",
  { region: "us-central1", schedule: "30 6 * * *", timeZone: "Africa/Johannesburg", timeoutSeconds: 300, memory: "512MiB", maxInstances: 1 },
  async () => {
    logger.info("watches.done", await runWatches());
  }
);
