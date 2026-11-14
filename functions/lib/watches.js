"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchesCron = exports.runWatches = exports.manageWatch = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const cronHeartbeat_1 = require("./cronHeartbeat");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const impactLogic_1 = require("./impactLogic");
const watchesLogic_1 = require("./watchesLogic");
/**
 * Watches (see watchesLogic.ts). manageWatch previews, starts and ends a person's watches;
 * watchesCron checks every active watch each morning after the risk scores are refreshed and
 * before the daily brief, and tells the owner in-app (which the brief then picks up).
 * watches/{id} is readable by its owner only; every write goes through here.
 */
const WATCHES = "watches";
// 5182 is the local dev server this repo runs on (5173 is often taken).
const CALLABLE_CORS = ["http://localhost:5173", "http://localhost:5182", "https://lepharosmartinc.co.za", "https://www.lepharosmartinc.co.za"];
const DAY_MS = 86400000;
const clean = (value) => String(value ?? "").trim();
const millis = (value) => {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null);
    const time = date ? date.getTime() : NaN;
    return Number.isFinite(time) ? time : 0;
};
const ids = (value) => (Array.isArray(value) ? value : [value]).map((item) => clean(item?.id ?? item)).filter(Boolean);
async function ownerOf(uid, email = "") {
    let snapshot = await emailShared_1.db.collection("users").doc(uid).get();
    if (!snapshot.exists) {
        const byUid = await emailShared_1.db.collection("users").where("uid", "==", uid).limit(1).get();
        if (!byUid.empty)
            snapshot = byUid.docs[0];
        else if (email) {
            const byEmail = await emailShared_1.db.collection("users").where("email", "==", email).limit(1).get();
            if (!byEmail.empty)
                snapshot = byEmail.docs[0];
        }
    }
    const profile = snapshot.exists ? snapshot.data() || {} : {};
    const role = clean(profile.role);
    // Programme-limited roles: their programmes, plus their branch's (as the assistant does).
    const programmeIds = [...ids(profile.assignedPrograms), ...ids(profile.assignedProgramId), ...ids(profile.programId)];
    for (const branchId of [...ids(profile.assignedBranch), ...ids(profile.branchId)]) {
        const programs = await emailShared_1.db.collection("programs").where("branchId", "==", branchId).limit(100).get().catch(() => null);
        programs?.docs.forEach((doc) => programmeIds.push(doc.id));
    }
    return { uid, role, visibility: (0, watchesLogic_1.visibilityFor)(role, Array.from(new Set(programmeIds)), uid) };
}
// ---- Loading what a check reads ----
async function loadWorld(specs, now) {
    const needs = new Set(specs.map((spec) => spec.type));
    const world = { risk: [], nextSession: new Map(), impact: [], assignments: [] };
    if (needs.has("sme_risk")) {
        const [risk, appointments] = await Promise.all([
            emailShared_1.db.collection("smeRiskSnapshots").get(),
            emailShared_1.db.collection("appointments").get(),
        ]);
        world.risk = risk.docs.map((doc) => {
            const data = doc.data();
            return {
                participantId: doc.id,
                participantName: clean(data.participantName) || "An SME",
                programId: clean(data.programId),
                level: clean(data.level),
                score: Number(data.score) || 0,
                ownerIds: ids(data.ownerIds),
                reasons: (Array.isArray(data.reasons) ? data.reasons : []).map((item) => clean(item?.label)).filter(Boolean),
            };
        });
        appointments.docs.forEach((doc) => {
            const data = doc.data();
            if (["cancelled", "declined", "completed"].includes(clean(data.status).toLowerCase()))
                return;
            const at = millis(data.startAt);
            const sme = clean(data.smeId || data.participantId);
            if (!sme || at < now)
                return;
            const seen = world.nextSession.get(sme);
            if (!seen || at < seen)
                world.nextSession.set(sme, at);
        });
    }
    if (needs.has("impact_reportable")) {
        const impact = await emailShared_1.db.collection("interventionImpact").get();
        world.impact = impact.docs.map((doc) => {
            const data = doc.data();
            return {
                programId: clean(data.programId),
                interventionId: clean(data.interventionId),
                interventionTitle: clean(data.interventionTitle) || "This intervention",
                metric: clean(data.metric) || "revenue",
                status: clean(data.status),
                headline: (0, impactLogic_1.impactHeadline)(data) || "",
            };
        });
    }
    const participants = Array.from(new Set(specs.filter((spec) => spec.type === "intervention_done").map((spec) => spec.participantId || "").filter(Boolean)));
    for (let offset = 0; offset < participants.length; offset += 30) {
        const snapshot = await emailShared_1.db.collection("assignedInterventions").where("participantId", "in", participants.slice(offset, offset + 30)).get();
        snapshot.docs.forEach((doc) => {
            const data = doc.data();
            const row = {
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
async function resolveNames(raw, owner) {
    const visibility = owner.visibility;
    const out = { ...raw };
    const wantsSme = clean(raw?.participantName) && !clean(raw?.participantId);
    if (wantsSme) {
        // Every active SME has a risk snapshot, with its programme and who supports it.
        const snapshots = await emailShared_1.db.collection("smeRiskSnapshots").get();
        const candidates = snapshots.docs
            .map((doc) => ({ id: doc.id, name: clean(doc.get("participantName")), programId: clean(doc.get("programId")), ownerIds: ids(doc.get("ownerIds")) }))
            .filter((item) => visibility.kind === "all" ||
            (visibility.kind === "programmes" && visibility.programmeIds.includes(item.programId)) ||
            (visibility.kind === "own" && item.ownerIds.includes(visibility.uid)));
        const found = (0, watchesLogic_1.matchByName)(raw.participantName, candidates);
        if (!found.length)
            return { problem: `I couldn't find an SME called "${raw.participantName}" among the ones you support.` };
        if (found.length > 1)
            return { choose: { field: "participant", options: found.slice(0, 8).map(({ id, name }) => ({ id, name })) } };
        out.participantId = found[0].id;
        out.participantName = found[0].name;
    }
    if (clean(raw?.programName) && !clean(raw?.programId)) {
        const programs = await emailShared_1.db.collection("programs").get();
        const candidates = programs.docs
            .map((doc) => ({ id: doc.id, name: clean(doc.get("name") || doc.get("programName")) }))
            .filter((item) => visibility.kind !== "programmes" || visibility.programmeIds.includes(item.id));
        const found = (0, watchesLogic_1.matchByName)(raw.programName, candidates);
        if (!found.length)
            return { problem: `I couldn't find a programme called "${raw.programName}" that you can see.` };
        if (found.length > 1)
            return { choose: { field: "programme", options: found.slice(0, 8) } };
        out.programId = found[0].id;
        out.programName = found[0].name;
    }
    if (clean(raw?.interventionTitle) && !clean(raw?.interventionId)) {
        const interventions = await emailShared_1.db.collection("interventions").get();
        const candidates = interventions.docs.map((doc) => ({ id: doc.id, name: clean(doc.get("interventionTitle") || doc.get("title")) }));
        const found = (0, watchesLogic_1.matchByName)(raw.interventionTitle, candidates);
        if (!found.length)
            return { problem: `I couldn't find an intervention called "${raw.interventionTitle}".` };
        // The same title can exist per department; any one of them is the same intervention to the person.
        const titles = new Set(found.map((item) => item.name.toLowerCase()));
        if (titles.size > 1)
            return { choose: { field: "intervention", options: found.slice(0, 8) } };
        out.interventionId = found[0].id;
        out.interventionTitle = found[0].name;
    }
    return { spec: out };
}
async function preview(raw, owner, now) {
    const resolved = await resolveNames(raw, owner);
    if (!resolved.spec)
        return resolved;
    const { spec, error } = (0, watchesLogic_1.normaliseSpec)(resolved.spec);
    if (!spec)
        return { problem: error };
    const matches = (0, watchesLogic_1.currentMatches)(spec, await loadWorld([spec], now), owner.visibility, now);
    return { spec, description: (0, watchesLogic_1.describeWatch)(spec), alreadyMatching: matches.map((match) => match.title), keys: matches.map((match) => match.key) };
}
exports.manageWatch = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 60 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const owner = await ownerOf(request.auth.uid, clean(request.auth.token?.email));
    if (!owner.visibility)
        throw new https_1.HttpsError("permission-denied", "Watches are for staff who support SMEs.");
    const action = clean(request.data?.action);
    const now = Date.now();
    if (action === "preview") {
        const { keys, ...shown } = await preview(request.data?.spec || {}, owner, now);
        if (!shown.spec)
            return shown;
        // A card reopened from chat history: say it is already running rather than offer it again.
        const active = await emailShared_1.db.collection(WATCHES).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
        return { ...shown, alreadyWatching: active.docs.some((doc) => sameSpec(doc.get("spec"), shown.spec)) };
    }
    if (action === "create") {
        const { keys, ...checked } = await preview(request.data?.spec || {}, owner, now);
        if (!checked.spec)
            return checked;
        const spec = checked.spec;
        const active = await emailShared_1.db.collection(WATCHES).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
        // The same card pressed twice (or again after reopening the chat) is the watch already running.
        const same = active.docs.find((doc) => sameSpec(doc.get("spec"), spec));
        if (same)
            return { id: same.id, spec, description: checked.description, alreadyMatching: checked.alreadyMatching, alreadyWatching: true };
        if (active.size >= watchesLogic_1.MAX_ACTIVE_WATCHES)
            return { problem: `You already have ${watchesLogic_1.MAX_ACTIVE_WATCHES} watches running. End one first.` };
        // A watch on one record that is already true has nothing left to tell you.
        if (checked.alreadyMatching?.length && (spec.type !== "sme_risk" || spec.participantId)) {
            return { ...checked, problem: `That's already true: ${checked.alreadyMatching[0]}.` };
        }
        const ref = await emailShared_1.db.collection(WATCHES).add({
            ownerUid: owner.uid,
            spec,
            description: checked.description,
            words: clean(request.data?.words).slice(0, 300) || null,
            status: "active",
            // What already matches is the baseline: only changes after this are news.
            matchedKeys: keys || [],
            firings: [],
            createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            endsAt: emailShared_1.admin.firestore.Timestamp.fromMillis(now + watchesLogic_1.WATCH_LIFETIME_DAYS * DAY_MS),
            lastCheckedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        return { id: ref.id, spec, description: checked.description, alreadyMatching: checked.alreadyMatching };
    }
    const id = clean(request.data?.id);
    const ref = id ? emailShared_1.db.collection(WATCHES).doc(id) : null;
    const snapshot = ref ? await ref.get() : null;
    if (!ref || !snapshot?.exists || snapshot.get("ownerUid") !== owner.uid)
        throw new https_1.HttpsError("not-found", "That watch isn't yours or no longer exists.");
    if (action === "end") {
        await ref.update({ status: "ended", endedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() });
        return { id, status: "ended" };
    }
    if (action === "check")
        return checkWatch(snapshot, owner, now, await loadWorld([snapshot.get("spec")], now));
    throw new https_1.HttpsError("invalid-argument", "Unknown watch action.");
});
const sameSpec = (a, b) => {
    const key = (spec) => JSON.stringify(Object.keys(spec || {}).sort().map((field) => [field, spec[field]]));
    return key((0, watchesLogic_1.normaliseSpec)(a).spec) === key(b);
};
// ---- The morning check ----
async function checkWatch(snapshot, owner, now, world) {
    const data = snapshot.data();
    const { spec } = (0, watchesLogic_1.normaliseSpec)(data.spec);
    if (!spec || !owner.visibility) {
        await snapshot.ref.update({ status: "ended", endedReason: "no longer valid", lastCheckedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() });
        return { id: snapshot.id, status: "ended", fired: 0 };
    }
    const state = (0, watchesLogic_1.nextWatchState)(spec, ids(data.matchedKeys), (0, watchesLogic_1.currentMatches)(spec, world, owner.visibility, now));
    const update = { matchedKeys: state.keys, lastCheckedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() };
    if (state.fired.length) {
        const note = (0, watchesLogic_1.firingMessage)(spec, state.fired);
        await (0, inAppNotifications_1.notifyInApp)({ type: "watch_triggered", title: note.title, message: note.message, link: note.link, recipientIds: [owner.uid], watchId: snapshot.id });
        update.firings = [{ at: now, title: note.title, message: note.message, link: note.link }, ...(Array.isArray(data.firings) ? data.firings : [])].slice(0, watchesLogic_1.MAX_FIRINGS_KEPT);
        update.lastFiredAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
    }
    if (state.done) {
        update.status = "done";
        update.endedAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
    }
    else if (millis(data.endsAt) && millis(data.endsAt) <= now) {
        update.status = "expired";
        update.endedAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
    }
    await snapshot.ref.update(update);
    return { id: snapshot.id, status: update.status || "active", fired: state.fired.length };
}
async function runWatches(now = Date.now()) {
    const active = await emailShared_1.db.collection(WATCHES).where("status", "==", "active").get();
    if (active.empty)
        return { checked: 0, fired: 0 };
    const world = await loadWorld(active.docs.map((doc) => doc.get("spec")).filter(Boolean), now);
    const owners = new Map();
    let fired = 0;
    for (const doc of active.docs) {
        try {
            const uid = clean(doc.get("ownerUid"));
            if (!owners.has(uid))
                owners.set(uid, await ownerOf(uid));
            fired += (await checkWatch(doc, owners.get(uid), now, world)).fired;
        }
        catch (error) {
            logger.warn("watches.check_failed", { id: doc.id, error: String(error) });
        }
    }
    return { checked: active.size, fired };
}
exports.runWatches = runWatches;
// 06:30 SAST: after the 06:00 risk scores, before the 09:30 brief.
exports.watchesCron = (0, cronHeartbeat_1.scheduledJob)("watchesCron", { region: "us-central1", schedule: "30 6 * * *", timeZone: "Africa/Johannesburg", timeoutSeconds: 300, memory: "512MiB", maxInstances: 1 }, async () => {
    logger.info("watches.done", await runWatches());
});
//# sourceMappingURL=watches.js.map