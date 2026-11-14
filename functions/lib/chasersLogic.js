"use strict";
/**
 * Chasers: "get these MOVs approved by Friday". The person hands the assistant a fixed list of
 * MOVs (or MOV packs) and a deadline. Each weekday morning the chaser checks where every item is,
 * nudges whoever has to act next through the Control Tower's own reminder (remindMovOwner), and
 * stops when everything has moved on. Its allowance is fixed when it starts: at most a few nudges
 * per item at each stage, spread out before the deadline. When an item has used its allowance and
 * is still waiting, the chaser asks its owner before escalating to the line managers; it never
 * escalates on its own.
 *
 * Pure: chasers.ts loads the records and sends. Tests in chasersLogic.test.cjs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitingList = exports.progressLine = exports.planRun = exports.newItem = exports.nudgeGapDays = exports.describeChaser = exports.normaliseChaserSpec = exports.deadlineEnd = exports.waitingOn = exports.isWaiting = exports.scopeToDepartment = exports.DAYS_AFTER_DEADLINE = exports.MAX_DEADLINE_DAYS = exports.MAX_NUDGES_WITH_EXTRA = exports.MAX_NUDGES = exports.DEFAULT_NUDGES = exports.MAX_ITEMS = exports.MAX_ACTIVE_CHASERS = exports.STAGE_STATUSES = exports.WAITING = void 0;
/** Statuses an item can wait in, and who it is waiting on. Anything else means it has moved on. */
exports.WAITING = {
    movDocuments: {
        awaiting_smme: "the SME",
        awaiting_hod: "the HOD",
        queried: "the facilitator",
        rejected: "the facilitator",
    },
    consolidatedMOVs: {
        awaiting_cc: "the Centre Coordinator",
        awaiting_me: "M&E",
    },
};
const STAGES = ["awaiting_smme", "awaiting_hod", "queried", "awaiting_cc", "awaiting_me"];
/** The statuses a stage the person names covers ("queried" includes rejected MOVs, both are the facilitator's). */
exports.STAGE_STATUSES = {
    awaiting_smme: { collection: "movDocuments", statuses: ["awaiting_smme"], label: "waiting for the SME to confirm" },
    awaiting_hod: { collection: "movDocuments", statuses: ["awaiting_hod"], label: "waiting for HOD approval" },
    queried: { collection: "movDocuments", statuses: ["queried", "rejected"], label: "queried or rejected" },
    awaiting_cc: { collection: "consolidatedMOVs", statuses: ["awaiting_cc"], label: "waiting for the Centre Coordinator" },
    awaiting_me: { collection: "consolidatedMOVs", statuses: ["awaiting_me"], label: "waiting for M&E" },
};
exports.MAX_ACTIVE_CHASERS = 5;
exports.MAX_ITEMS = 25;
exports.DEFAULT_NUDGES = 2;
exports.MAX_NUDGES = 3;
/** "One more round" adds a nudge, up to this many in all at a stage. */
exports.MAX_NUDGES_WITH_EXTRA = 5;
exports.MAX_DEADLINE_DAYS = 60;
/** After the deadline the chaser keeps checking (without nudging) this long, then stops. */
exports.DAYS_AFTER_DEADLINE = 7;
const DAY_MS = 86400000;
// Runs are a day apart give or take the schedule, so "a day since" allows a few hours' slack.
const SLACK_MS = 4 * 3600000;
/**
 * Heads of department outside ROM and M&E chase their own department's queried MOVs: the ones waiting
 * on a facilitator to fix what the HOD queried. Each ends once it is answered; the HOD is never chased.
 */
function scopeToDepartment(spec, departmentId) {
    if (spec.stage && spec.stage !== "queried") {
        return { error: "As a head of department you can chase your department's queried MOVs: the ones waiting on a facilitator to fix them." };
    }
    return { spec: { ...spec, stage: "queried", departmentId, stageOnly: true } };
}
exports.scopeToDepartment = scopeToDepartment;
const clean = (value) => String(value ?? "").trim();
const text = (value, max = 120) => clean(value).replace(/\s+/g, " ").slice(0, max);
const isWaiting = (collection, status) => Boolean(exports.WAITING[collection][clean(status).toLowerCase()]);
exports.isWaiting = isWaiting;
const waitingOn = (collection, status) => exports.WAITING[collection][clean(status).toLowerCase()] || "";
exports.waitingOn = waitingOn;
/** Midnight at the end of the deadline day, in South Africa (UTC+2). */
const deadlineEnd = (deadline) => Date.parse(`${deadline}T23:59:59+02:00`);
exports.deadlineEnd = deadlineEnd;
function normaliseChaserSpec(raw, now) {
    const deadline = clean(raw?.deadline);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN((0, exports.deadlineEnd)(deadline))) {
        return { error: "When should it be done by? Give me a date." };
    }
    const end = (0, exports.deadlineEnd)(deadline);
    if (end < now)
        return { error: "That deadline has already passed." };
    if (end - now > exports.MAX_DEADLINE_DAYS * DAY_MS)
        return { error: `A chaser can run for up to ${exports.MAX_DEADLINE_DAYS} days. Pick a nearer deadline.` };
    const spec = { deadline, maxNudges: exports.DEFAULT_NUDGES };
    const nudges = Math.round(Number(raw?.maxNudges));
    if (Number.isFinite(nudges) && nudges >= 1)
        spec.maxNudges = Math.min(nudges, exports.MAX_NUDGES);
    if (STAGES.includes(raw?.stage))
        spec.stage = raw.stage;
    for (const field of ["departmentName", "programId", "programName"]) {
        const value = text(raw?.[field]);
        if (value)
            spec[field] = value;
    }
    const names = (Array.isArray(raw?.participantNames) ? raw.participantNames : [])
        .map((name) => text(name))
        .filter(Boolean);
    if (names.length)
        spec.participantNames = Array.from(new Set(names)).slice(0, exports.MAX_ITEMS);
    if (!spec.stage && !spec.departmentName && !spec.programId && !spec.participantNames) {
        return { error: "Which MOVs? Name a stage (such as waiting for HOD approval), a department, a programme or the SMEs." };
    }
    return { spec };
}
exports.normaliseChaserSpec = normaliseChaserSpec;
const fmtDay = (deadline) => new Date((0, exports.deadlineEnd)(deadline)).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });
function describeChaser(spec, count) {
    const what = spec.stage && exports.STAGE_STATUSES[spec.stage].collection === "consolidatedMOVs" ? "MOV pack" : "MOV";
    const stage = spec.stage ? ` ${exports.STAGE_STATUSES[spec.stage].label}` : "";
    const where = [spec.departmentName && `in ${spec.departmentName}`, spec.programName && `on ${spec.programName}`].filter(Boolean).join(" ");
    const smes = spec.participantNames?.length ? ` for ${spec.participantNames.join(", ")}` : "";
    return (`Chase ${count} ${what}${count === 1 ? "" : "s"}${stage}${where ? ` ${where}` : ""}${smes} until ${fmtDay(spec.deadline)}, ` +
        `nudging whoever has to act at most ${spec.maxNudges} time${spec.maxNudges === 1 ? "" : "s"} each.`);
}
exports.describeChaser = describeChaser;
/** Days between nudges: the allowance spread over the time to the deadline, one to three days apart. */
function nudgeGapDays(startedAt, deadline, maxNudges) {
    const days = Math.max(1, Math.floor(((0, exports.deadlineEnd)(deadline) - startedAt) / DAY_MS));
    return Math.min(3, Math.max(1, Math.floor(days / Math.max(1, maxNudges))));
}
exports.nudgeGapDays = nudgeGapDays;
const newItem = (collection, id, label, status) => ({
    collection, id, label, status, done: !(0, exports.isWaiting)(collection, status),
    nudges: 0, extra: 0, lastNudgeAt: 0, lastNudgedUids: [], lastNudgedRole: "", asked: false, escalated: false,
});
exports.newItem = newItem;
/**
 * One morning's run, given each item's status now (absent = the record is gone, counted as moved on).
 * remindedRecently: items someone already reminded in the last day (the Control Tower's limit), which
 * wait for tomorrow without using a nudge.
 */
function planRun(spec, startedAt, previous, statusNow, remindedRecently, now) {
    const gap = nudgeGapDays(startedAt, spec.deadline, spec.maxNudges) * DAY_MS - SLACK_MS;
    const pastDeadline = now > (0, exports.deadlineEnd)(spec.deadline);
    const plan = { items: [], nudge: [], ask: [], finished: [], allDone: false, pastDeadline, expired: now > (0, exports.deadlineEnd)(spec.deadline) + exports.DAYS_AFTER_DEADLINE * DAY_MS };
    for (const before of previous) {
        const item = { ...before };
        if (!item.done) {
            const status = statusNow.get(item.id);
            const leftStage = !!spec.stageOnly && !!spec.stage && status !== undefined &&
                !exports.STAGE_STATUSES[spec.stage].statuses.includes(clean(status).toLowerCase());
            if (status === undefined || !(0, exports.isWaiting)(item.collection, status) || leftStage) {
                item.done = true;
                if (status !== undefined)
                    item.status = status;
                plan.finished.push(item.id);
            }
            else if (clean(status).toLowerCase() !== clean(item.status).toLowerCase()) {
                // Someone acted and it is waiting on the next person: they get their own allowance.
                Object.assign(item, { status, nudges: 0, extra: 0, lastNudgeAt: 0, lastNudgedUids: [], lastNudgedRole: "", asked: false, escalated: false, skipped: undefined });
            }
        }
        plan.items.push(item);
        if (item.done || item.skipped || pastDeadline)
            continue;
        const allowance = spec.maxNudges + item.extra;
        const rested = !item.lastNudgeAt || now - item.lastNudgeAt >= gap;
        if (item.nudges < allowance) {
            if (rested && !remindedRecently.has(item.id))
                plan.nudge.push(item.id);
        }
        else if (rested && !item.asked && !item.escalated) {
            plan.ask.push(item.id);
        }
    }
    plan.allDone = plan.items.length > 0 && plan.items.every((item) => item.done);
    return plan;
}
exports.planRun = planRun;
const progressLine = (items) => {
    const done = items.filter((item) => item.done).length;
    return `${done} of ${items.length} done`;
};
exports.progressLine = progressLine;
/** What is still waiting, and on whom: "Zungu Trading – Cash Flow Planning (the HOD)". */
const waitingList = (items, limit = 4) => {
    const open = items.filter((item) => !item.done);
    const shown = open.slice(0, limit).map((item) => `${item.label} (${(0, exports.waitingOn)(item.collection, item.status) || "pending"})`);
    return shown.join("; ") + (open.length > limit ? ` and ${open.length - limit} more` : "");
};
exports.waitingList = waitingList;
//# sourceMappingURL=chasersLogic.js.map