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
exports.chasersCron = exports.runChasers = exports.manageChaser = void 0;
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const cronHeartbeat_1 = require("./cronHeartbeat");
const emailShared_1 = require("./emailShared");
const inAppNotifications_1 = require("./inAppNotifications");
const movReminders_1 = require("./movReminders");
const packStatus_1 = require("./packStatus");
const syntheticData_1 = require("./syntheticData");
const watchesLogic_1 = require("./watchesLogic");
const chasersLogic_1 = require("./chasersLogic");
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
const DAY_MS = 86400000;
const MAX_LOG = 20;
const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const millis = (value) => {
    const date = value?.toDate?.() ?? (value ? new Date(value) : null);
    const time = date ? date.getTime() : NaN;
    return Number.isFinite(time) ? time : 0;
};
/** Every word the person said appears in the name: "legal" finds "Legal Advisory Services". */
const nameHas = (name, wanted) => {
    const folded = ` ${fold(name)} `;
    return fold(wanted).split(" ").every((word) => folded.includes(` ${word}`));
};
async function ownerOf(uid) {
    const snapshot = await emailShared_1.db.collection("users").doc(uid).get();
    const profile = (snapshot.data() || {});
    const everything = snapshot.exists && (await (0, movReminders_1.canRemind)(profile));
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
const smeName = (doc) => clean(doc.smmeCompanyName || doc.beneficiaryName || doc.smmeName || doc.participantName) || "An SME";
const labelFor = (collection, doc) => collection === "movDocuments"
    ? `${smeName(doc)} – ${clean(doc.interventionTitle) || "intervention"}`
    : `${clean(doc.department || doc.departmentName) || "A department"}'s ${clean(doc.month)} MOV pack`.replace(/\s+/g, " ");
async function findItems(spec) {
    // A stage names one collection; otherwise MOVs, plus packs unless the person named SMEs (packs have none).
    const wanted = spec.stage
        ? [{ collection: chasersLogic_1.STAGE_STATUSES[spec.stage].collection, statuses: chasersLogic_1.STAGE_STATUSES[spec.stage].statuses }]
        : [
            { collection: "movDocuments", statuses: Object.keys(chasersLogic_1.WAITING.movDocuments) },
            ...(spec.participantNames ? [] : [{ collection: "consolidatedMOVs", statuses: Object.keys(chasersLogic_1.WAITING.consolidatedMOVs) }]),
        ];
    const found = [];
    for (const { collection, statuses } of wanted) {
        const stored = collection === "consolidatedMOVs" ? statuses.flatMap(packStatus_1.storedPackStatuses) : statuses;
        const snapshot = await emailShared_1.db.collection(collection).where("status", "in", stored).get();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (spec.departmentId && clean(data.departmentId) !== spec.departmentId)
                continue;
            if (spec.programId && clean(data.programId) !== spec.programId)
                continue;
            if (spec.departmentName && !nameHas(data.departmentName || data.department, spec.departmentName))
                continue;
            if (spec.participantNames && !spec.participantNames.some((name) => [data.smmeCompanyName, data.beneficiaryName, data.smmeName, data.participantName].some((value) => clean(value) && nameHas(value, name))))
                continue;
            const status = collection === "consolidatedMOVs" ? (0, packStatus_1.normalizePackStatus)(data.status) : clean(data.status);
            found.push({ collection, id: doc.id, label: labelFor(collection, data), status });
        }
    }
    return found.sort((a, b) => a.label.localeCompare(b.label));
}
async function preview(raw, now, owner) {
    const out = { ...(raw || {}) };
    if (clean(raw?.programName) && !clean(raw?.programId)) {
        const programs = await emailShared_1.db.collection("programs").get();
        const found = (0, watchesLogic_1.matchByName)(raw.programName, programs.docs.map((doc) => ({ id: doc.id, name: clean(doc.get("name") || doc.get("programName")) })));
        if (!found.length)
            return { problem: `I couldn't find a programme called "${raw.programName}".` };
        if (found.length > 1)
            return { choose: { field: "programme", options: found.slice(0, 8) } };
        out.programId = found[0].id;
        out.programName = found[0].name;
    }
    const normalised = (0, chasersLogic_1.normaliseChaserSpec)(out, now);
    const { spec, error } = normalised.spec && owner.departmentId ? (0, chasersLogic_1.scopeToDepartment)(normalised.spec, owner.departmentId) : normalised;
    if (!spec)
        return { problem: error };
    const found = await findItems(spec);
    if (!found.length)
        return { spec, problem: "Nothing matching that is waiting on anyone right now." };
    if (found.length > chasersLogic_1.MAX_ITEMS) {
        return { spec, problem: `That's ${found.length} records; a chaser takes up to ${chasersLogic_1.MAX_ITEMS}. Narrow it by department, programme, stage or SME.` };
    }
    return {
        spec,
        found,
        description: (0, chasersLogic_1.describeChaser)(spec, found.length),
        items: found.map((item) => ({ label: item.label, waitingOn: (0, chasersLogic_1.waitingOn)(item.collection, item.status) })),
    };
}
const sameSpec = (a, b) => {
    const key = (spec) => JSON.stringify(Object.keys(spec || {}).sort().map((field) => [field, spec[field]]));
    return key(a) === key(b);
};
const logEntry = (now, text) => ({ at: now, text });
const withLog = (data, entries) => [...entries.reverse(), ...(Array.isArray(data.log) ? data.log : [])].slice(0, MAX_LOG);
exports.manageChaser = (0, https_1.onCall)({ region: "us-central1", cors: CALLABLE_CORS, timeoutSeconds: 120 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Please sign in again.");
    const owner = await ownerOf(request.auth.uid);
    if (!owner.allowed)
        throw new https_1.HttpsError("permission-denied", "Chasers are for the people who can send reminders from the Control Tower, and heads of department.");
    const action = clean(request.data?.action);
    const now = Date.now();
    if (action === "preview" || action === "create") {
        const { found, ...shown } = await preview(request.data?.spec, now, owner);
        if (!found || !shown.spec)
            return shown;
        const spec = shown.spec;
        const active = await emailShared_1.db.collection(CHASERS).where("ownerUid", "==", owner.uid).where("status", "==", "active").get();
        // A card reopened from chat history, or pressed twice: it is the chaser already running.
        const same = active.docs.find((doc) => sameSpec(doc.get("spec"), spec));
        if (action === "preview" || same)
            return { ...shown, ...(same ? { id: same.id, alreadyChasing: true } : {}) };
        if (active.size >= chasersLogic_1.MAX_ACTIVE_CHASERS)
            return { ...shown, problem: `You already have ${chasersLogic_1.MAX_ACTIVE_CHASERS} chasers running. End one first.` };
        const ref = await emailShared_1.db.collection(CHASERS).add({
            ownerUid: owner.uid,
            spec,
            description: shown.description,
            words: clean(request.data?.words).slice(0, 300) || null,
            status: "active",
            items: found.map((item) => (0, chasersLogic_1.newItem)(item.collection, item.id, item.label, item.status)),
            startedAt: now,
            createdAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(),
            deadlineAt: emailShared_1.admin.firestore.Timestamp.fromMillis((0, chasersLogic_1.deadlineEnd)(spec.deadline)),
            deadlineReported: false,
            log: [logEntry(now, `Started: ${shown.description}`)],
        });
        // The first nudges go out now rather than tomorrow morning.
        const result = await runChaser(await ref.get(), owner, now);
        return { ...shown, id: ref.id, nudged: result.nudged };
    }
    const id = clean(request.data?.id);
    const ref = id ? emailShared_1.db.collection(CHASERS).doc(id) : null;
    const snapshot = ref ? await ref.get() : null;
    if (!ref || !snapshot?.exists || snapshot.get("ownerUid") !== owner.uid)
        throw new https_1.HttpsError("not-found", "That chaser isn't yours or no longer exists.");
    const data = snapshot.data();
    if (data.status !== "active")
        throw new https_1.HttpsError("failed-precondition", "That chaser has already stopped.");
    const items = (data.items || []);
    if (action === "end") {
        await ref.update({ status: "ended", endedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp(), log: withLog(data, [logEntry(now, "You stopped it.")]) });
        return { id, status: "ended" };
    }
    if (action === "extend") {
        // One more nudge for each item that used its allowance; asked about again only if that runs out too.
        const spec = data.spec;
        let extended = 0;
        const next = items.map((item) => {
            if (item.done || !item.asked || item.escalated || spec.maxNudges + item.extra >= chasersLogic_1.MAX_NUDGES_WITH_EXTRA)
                return item;
            extended += 1;
            return { ...item, extra: item.extra + 1, asked: false };
        });
        if (!extended)
            return { id, status: "active", problem: "Nothing is waiting on another round." };
        await ref.update({ items: next, log: withLog(data, [logEntry(now, `You allowed one more nudge for ${extended}.`)]) });
        const result = await runChaser(await ref.get(), owner, now);
        return { id, status: "active", extended, nudged: result.nudged };
    }
    if (action === "escalate")
        return escalate(snapshot, owner, now);
    if (action === "check")
        return runChaser(snapshot, owner, now);
    throw new https_1.HttpsError("invalid-argument", "Unknown chaser action.");
});
// ---- Escalating, only when the owner says so ----
async function lineManagersOf(uids) {
    const people = await Promise.all(uids.slice(0, 10).map((uid) => emailShared_1.db.collection("users").doc(uid).get()));
    const managerIds = Array.from(new Set(people.map((doc) => clean(doc.get("lineManagerId"))).filter((uid) => uid && !uids.includes(uid))));
    const managers = await Promise.all(managerIds.map((uid) => emailShared_1.db.collection("users").doc(uid).get()));
    return managers
        .filter((doc) => doc.exists && clean(doc.get("email")))
        .map((doc) => ({ uid: doc.id, email: clean(doc.get("email")), name: clean(doc.get("name") || doc.get("displayName")) }));
}
async function escalate(snapshot, owner, now) {
    const data = snapshot.data();
    const items = (data.items || []);
    const due = items.filter((item) => !item.done && item.asked && !item.escalated);
    if (!due.length)
        return { id: snapshot.id, status: "active", problem: "Nothing is waiting to be escalated." };
    const base = emailShared_1.APP_BASE_URL.replace(/\/$/, "");
    const results = [];
    const next = [...items];
    for (const item of due) {
        const record = await emailShared_1.db.collection(item.collection).doc(item.id).get();
        const index = next.findIndex((entry) => entry.id === item.id);
        if (record.exists && (0, syntheticData_1.suppressRecordNotifications)(record.data(), record.id)) {
            results.push(`${item.label}: a test record, so nothing was sent`);
            next[index] = { ...item, escalated: true };
            continue;
        }
        const managers = await lineManagersOf(item.lastNudgedUids || []);
        if (!managers.length) {
            results.push(`${item.label}: no line manager is on file for ${(0, chasersLogic_1.waitingOn)(item.collection, item.status)}`);
            continue;
        }
        const text = `${owner.name} has chased ${item.label} ${item.nudges} time${item.nudges === 1 ? "" : "s"} and it is still waiting on ` +
            `${(0, chasersLogic_1.waitingOn)(item.collection, item.status)}, who report${item.lastNudgedUids.length === 1 ? "s" : ""} to you. ` +
            `It's needed by ${new Date((0, chasersLogic_1.deadlineEnd)(data.spec.deadline)).toLocaleDateString("en-ZA", { day: "numeric", month: "long", timeZone: "Africa/Johannesburg" })}. Could you help move it along?`;
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.6;"><p>Hi there,</p><p>${text}</p><p><a href="${base}/operations/movs" style="display:inline-block;padding:10px 16px;background:#0ea5e9;color:#ffffff;text-decoration:none;border-radius:6px;">Open Smart Incubation</a></p></div>`;
        try {
            await (0, emailShared_1.sendStatusChangeNotification)(managers.map((m) => m.email), `Escalated: ${item.label}`, html, text);
        }
        catch (error) {
            logger.error("chasers.escalate_email_failed", { id: snapshot.id, item: item.id, error: String(error) });
        }
        await (0, inAppNotifications_1.notifyInApp)({ type: "chaser_escalation", message: text, recipientIds: managers.map((m) => m.uid), link: "/operations/movs", chaserId: snapshot.id });
        results.push(`${item.label}: sent to ${managers.map((m) => m.name || m.email).join(", ")}`);
        next[index] = { ...item, escalated: true };
    }
    await snapshot.ref.update({ items: next, log: withLog(data, results.map((line) => logEntry(now, `Escalated ${line}.`))) });
    return { id: snapshot.id, status: "active", escalated: results };
}
// ---- The morning run ----
async function runChaser(snapshot, owner, now) {
    const data = snapshot.data();
    const spec = data.spec;
    if (!owner.allowed) {
        await snapshot.ref.update({ status: "ended", endedReason: "The owner can no longer send reminders.", endedAt: emailShared_1.admin.firestore.FieldValue.serverTimestamp() });
        return { id: snapshot.id, status: "ended", nudged: 0 };
    }
    const previous = (data.items || []);
    const refs = previous.map((item) => emailShared_1.db.collection(item.collection).doc(item.id));
    const records = refs.length ? await emailShared_1.db.getAll(...refs) : [];
    const statusNow = new Map();
    const recently = new Set();
    const docs = new Map();
    records.forEach((record, index) => {
        const item = previous[index];
        if (!record.exists)
            return;
        const doc = record.data();
        docs.set(item.id, record);
        statusNow.set(item.id, item.collection === "consolidatedMOVs" ? (0, packStatus_1.normalizePackStatus)(doc.status) : clean(doc.status));
        const last = doc.lastManualReminder;
        // Someone else's reminder today: the Control Tower allows one a day, so wait for tomorrow.
        if (last && clean(last.chaserId) !== snapshot.id && now - millis(last.at) < DAY_MS)
            recently.add(item.id);
    });
    const plan = (0, chasersLogic_1.planRun)(spec, Number(data.startedAt) || millis(data.createdAt) || now, previous, statusNow, recently, now);
    const items = plan.items;
    const log = [];
    plan.finished.forEach((id) => log.push(logEntry(now, `${items.find((item) => item.id === id)?.label} moved on.`)));
    const due = new Date((0, chasersLogic_1.deadlineEnd)(spec.deadline)).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });
    let nudged = 0;
    for (const id of plan.nudge) {
        const index = items.findIndex((item) => item.id === id);
        const item = items[index];
        const record = docs.get(id);
        if (!record)
            continue;
        if ((0, syntheticData_1.suppressRecordNotifications)(record.data(), record.id)) {
            items[index] = { ...item, skipped: "A test record, so no nudges are sent." };
            continue;
        }
        try {
            const sent = await (0, movReminders_1.sendMovReminder)(record.ref, { collection: item.collection, id }, record.data(), {}, { uid: owner.uid, name: owner.name, email: owner.email }, "", {
                chaserId: snapshot.id,
                skipSender: true,
                footer: `It's needed by ${due}.`,
            });
            items[index] = { ...item, nudges: item.nudges + 1, lastNudgeAt: now, lastNudgedUids: sent.uids, lastNudgedRole: sent.audience };
            log.push(logEntry(now, `Nudged ${sent.audience} about ${item.label} (${item.nudges + 1} of ${spec.maxNudges + item.extra}).`));
            nudged += 1;
        }
        catch (error) {
            // Nobody on file to remind: keep tracking it, and say why it isn't being nudged.
            const reason = error instanceof https_1.HttpsError ? error.message : "The reminder couldn't be sent.";
            items[index] = { ...item, skipped: reason };
            log.push(logEntry(now, `Can't nudge about ${item.label}: ${reason}`));
            logger.warn("chasers.nudge_failed", { id: snapshot.id, item: id, error: String(error) });
        }
    }
    const update = { lastRunAt: now };
    const tell = async (title, message) => (0, inAppNotifications_1.notifyInApp)({ type: "chaser_update", title, message, link: LINK, recipientIds: [owner.uid], chaserId: snapshot.id });
    if (plan.allDone) {
        update.status = "done";
        update.endedAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
        await tell(`Chaser done: all ${items.length} moved on`, `${data.description} Everything has moved on.`);
        log.push(logEntry(now, "Everything has moved on."));
    }
    else {
        if (plan.ask.length) {
            const asked = items.filter((item) => plan.ask.includes(item.id));
            plan.ask.forEach((id) => {
                const index = items.findIndex((item) => item.id === id);
                items[index] = { ...items[index], asked: true };
            });
            await tell(`Chaser: ${asked.length} still waiting after ${spec.maxNudges} nudge${spec.maxNudges === 1 ? "" : "s"}`, `${(0, chasersLogic_1.waitingList)(asked)}. Escalate to their line managers, allow one more nudge, or leave it? ${(0, chasersLogic_1.progressLine)(items)}.`);
            log.push(logEntry(now, `Asked you about ${asked.length} that used their nudges.`));
        }
        if (plan.pastDeadline && !data.deadlineReported) {
            update.deadlineReported = true;
            await tell(`Chaser deadline: ${(0, chasersLogic_1.progressLine)(items)}`, `Still waiting: ${(0, chasersLogic_1.waitingList)(items)}. No more nudges will go out.`);
            log.push(logEntry(now, `Deadline passed with ${(0, chasersLogic_1.progressLine)(items)}.`));
        }
        if (plan.expired) {
            update.status = "expired";
            update.endedAt = emailShared_1.admin.firestore.FieldValue.serverTimestamp();
        }
    }
    update.items = items;
    if (log.length)
        update.log = withLog(data, log);
    await snapshot.ref.update(update);
    return { id: snapshot.id, status: update.status || "active", nudged, progress: (0, chasersLogic_1.progressLine)(items) };
}
async function runChasers(now = Date.now()) {
    const active = await emailShared_1.db.collection(CHASERS).where("status", "==", "active").get();
    const owners = new Map();
    let nudged = 0;
    for (const doc of active.docs) {
        try {
            const uid = clean(doc.get("ownerUid"));
            if (!owners.has(uid))
                owners.set(uid, await ownerOf(uid));
            nudged += (await runChaser(doc, owners.get(uid), now)).nudged;
        }
        catch (error) {
            logger.warn("chasers.run_failed", { id: doc.id, error: String(error) });
        }
    }
    return { checked: active.size, nudged };
}
exports.runChasers = runChasers;
// 07:45 SAST on weekdays: nudges arrive at the start of the working day, before the 08:20 stage reminders.
exports.chasersCron = (0, cronHeartbeat_1.scheduledJob)("chasersCron", { region: "us-central1", schedule: "45 7 * * 1-5", timeZone: "Africa/Johannesburg", timeoutSeconds: 300, maxInstances: 1 }, async () => {
    logger.info("chasers.done", await runChasers());
});
//# sourceMappingURL=chasers.js.map