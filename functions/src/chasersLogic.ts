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

export type ChaserCollection = "movDocuments" | "consolidatedMOVs";

/** Statuses an item can wait in, and who it is waiting on. Anything else means it has moved on. */
export const WAITING: Record<ChaserCollection, Record<string, string>> = {
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
export type ChaserStage = "awaiting_smme" | "awaiting_hod" | "queried" | "awaiting_cc" | "awaiting_me";
const STAGES: ChaserStage[] = ["awaiting_smme", "awaiting_hod", "queried", "awaiting_cc", "awaiting_me"];
/** The statuses a stage the person names covers ("queried" includes rejected MOVs, both are the facilitator's). */
export const STAGE_STATUSES: Record<ChaserStage, { collection: ChaserCollection; statuses: string[]; label: string }> = {
  awaiting_smme: { collection: "movDocuments", statuses: ["awaiting_smme"], label: "waiting for the SME to confirm" },
  awaiting_hod: { collection: "movDocuments", statuses: ["awaiting_hod"], label: "waiting for HOD approval" },
  queried: { collection: "movDocuments", statuses: ["queried", "rejected"], label: "queried or rejected" },
  awaiting_cc: { collection: "consolidatedMOVs", statuses: ["awaiting_cc"], label: "waiting for the Centre Coordinator" },
  awaiting_me: { collection: "consolidatedMOVs", statuses: ["awaiting_me"], label: "waiting for M&E" },
};

export const MAX_ACTIVE_CHASERS = 5;
export const MAX_ITEMS = 25;
export const DEFAULT_NUDGES = 2;
export const MAX_NUDGES = 3;
/** "One more round" adds a nudge, up to this many in all at a stage. */
export const MAX_NUDGES_WITH_EXTRA = 5;
export const MAX_DEADLINE_DAYS = 60;
/** After the deadline the chaser keeps checking (without nudging) this long, then stops. */
export const DAYS_AFTER_DEADLINE = 7;
const DAY_MS = 86_400_000;
// Runs are a day apart give or take the schedule, so "a day since" allows a few hours' slack.
const SLACK_MS = 4 * 3_600_000;

export type ChaserSpec = {
  stage?: ChaserStage;
  departmentName?: string;
  programId?: string;
  programName?: string;
  participantNames?: string[];
  /** YYYY-MM-DD, the last day the person wants it done by. */
  deadline: string;
  maxNudges: number;
};

export type ChaserItem = {
  collection: ChaserCollection;
  id: string;
  label: string;
  /** The status it was in when last checked. */
  status: string;
  done: boolean;
  /** Nudges at the current stage; a new stage (a new person to act) starts again at 0. */
  nudges: number;
  /** One more round granted by the owner at this stage. */
  extra: number;
  lastNudgeAt: number;
  /** Who the last nudge went to, for escalation. */
  lastNudgedUids: string[];
  lastNudgedRole: string;
  /** Why it isn't nudged (a test record, nobody on file); it is still tracked. */
  skipped?: string;
  /** The owner has been asked about this item at this stage. */
  asked: boolean;
  escalated: boolean;
};

const clean = (value: unknown) => String(value ?? "").trim();
const text = (value: unknown, max = 120) => clean(value).replace(/\s+/g, " ").slice(0, max);

export const isWaiting = (collection: ChaserCollection, status: string) => Boolean(WAITING[collection][clean(status).toLowerCase()]);
export const waitingOn = (collection: ChaserCollection, status: string) => WAITING[collection][clean(status).toLowerCase()] || "";

/** Midnight at the end of the deadline day, in South Africa (UTC+2). */
export const deadlineEnd = (deadline: string) => Date.parse(`${deadline}T23:59:59+02:00`);

export function normaliseChaserSpec(raw: any, now: number): { spec?: ChaserSpec; error?: string } {
  const deadline = clean(raw?.deadline);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(deadlineEnd(deadline))) {
    return { error: "When should it be done by? Give me a date." };
  }
  const end = deadlineEnd(deadline);
  if (end < now) return { error: "That deadline has already passed." };
  if (end - now > MAX_DEADLINE_DAYS * DAY_MS) return { error: `A chaser can run for up to ${MAX_DEADLINE_DAYS} days. Pick a nearer deadline.` };

  const spec: ChaserSpec = { deadline, maxNudges: DEFAULT_NUDGES };
  const nudges = Math.round(Number(raw?.maxNudges));
  if (Number.isFinite(nudges) && nudges >= 1) spec.maxNudges = Math.min(nudges, MAX_NUDGES);
  if (STAGES.includes(raw?.stage)) spec.stage = raw.stage;
  for (const field of ["departmentName", "programId", "programName"] as const) {
    const value = text(raw?.[field]);
    if (value) spec[field] = value;
  }
  const names = (Array.isArray(raw?.participantNames) ? raw.participantNames : [])
    .map((name: unknown) => text(name))
    .filter(Boolean);
  if (names.length) spec.participantNames = Array.from(new Set<string>(names)).slice(0, MAX_ITEMS);
  if (!spec.stage && !spec.departmentName && !spec.programId && !spec.participantNames) {
    return { error: "Which MOVs? Name a stage (such as waiting for HOD approval), a department, a programme or the SMEs." };
  }
  return { spec };
}

const fmtDay = (deadline: string) =>
  new Date(deadlineEnd(deadline)).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });

export function describeChaser(spec: ChaserSpec, count: number): string {
  const what = spec.stage && STAGE_STATUSES[spec.stage].collection === "consolidatedMOVs" ? "MOV pack" : "MOV";
  const stage = spec.stage ? ` ${STAGE_STATUSES[spec.stage].label}` : "";
  const where = [spec.departmentName && `in ${spec.departmentName}`, spec.programName && `on ${spec.programName}`].filter(Boolean).join(" ");
  const smes = spec.participantNames?.length ? ` for ${spec.participantNames.join(", ")}` : "";
  return (
    `Chase ${count} ${what}${count === 1 ? "" : "s"}${stage}${where ? ` ${where}` : ""}${smes} until ${fmtDay(spec.deadline)}, ` +
    `nudging whoever has to act at most ${spec.maxNudges} time${spec.maxNudges === 1 ? "" : "s"} each.`
  );
}

/** Days between nudges: the allowance spread over the time to the deadline, one to three days apart. */
export function nudgeGapDays(startedAt: number, deadline: string, maxNudges: number): number {
  const days = Math.max(1, Math.floor((deadlineEnd(deadline) - startedAt) / DAY_MS));
  return Math.min(3, Math.max(1, Math.floor(days / Math.max(1, maxNudges))));
}

export const newItem = (collection: ChaserCollection, id: string, label: string, status: string): ChaserItem => ({
  collection, id, label, status, done: !isWaiting(collection, status),
  nudges: 0, extra: 0, lastNudgeAt: 0, lastNudgedUids: [], lastNudgedRole: "", asked: false, escalated: false,
});

export type RunPlan = {
  items: ChaserItem[];
  /** Ids of items to nudge now. */
  nudge: string[];
  /** Ids that just used their allowance and are still waiting: ask the owner about these. */
  ask: string[];
  /** Ids that moved on since the last run. */
  finished: string[];
  allDone: boolean;
  pastDeadline: boolean;
  /** Past the deadline and the time after it: the chaser stops. */
  expired: boolean;
};

/**
 * One morning's run, given each item's status now (absent = the record is gone, counted as moved on).
 * remindedRecently: items someone already reminded in the last day (the Control Tower's limit), which
 * wait for tomorrow without using a nudge.
 */
export function planRun(
  spec: ChaserSpec,
  startedAt: number,
  previous: ChaserItem[],
  statusNow: Map<string, string>,
  remindedRecently: Set<string>,
  now: number,
): RunPlan {
  const gap = nudgeGapDays(startedAt, spec.deadline, spec.maxNudges) * DAY_MS - SLACK_MS;
  const pastDeadline = now > deadlineEnd(spec.deadline);
  const plan: RunPlan = { items: [], nudge: [], ask: [], finished: [], allDone: false, pastDeadline, expired: now > deadlineEnd(spec.deadline) + DAYS_AFTER_DEADLINE * DAY_MS };

  for (const before of previous) {
    const item: ChaserItem = { ...before };
    if (!item.done) {
      const status = statusNow.get(item.id);
      if (status === undefined || !isWaiting(item.collection, status)) {
        item.done = true;
        if (status !== undefined) item.status = status;
        plan.finished.push(item.id);
      } else if (clean(status).toLowerCase() !== clean(item.status).toLowerCase()) {
        // Someone acted and it is waiting on the next person: they get their own allowance.
        Object.assign(item, { status, nudges: 0, extra: 0, lastNudgeAt: 0, lastNudgedUids: [], lastNudgedRole: "", asked: false, escalated: false, skipped: undefined });
      }
    }
    plan.items.push(item);
    if (item.done || item.skipped || pastDeadline) continue;

    const allowance = spec.maxNudges + item.extra;
    const rested = !item.lastNudgeAt || now - item.lastNudgeAt >= gap;
    if (item.nudges < allowance) {
      if (rested && !remindedRecently.has(item.id)) plan.nudge.push(item.id);
    } else if (rested && !item.asked && !item.escalated) {
      plan.ask.push(item.id);
    }
  }
  plan.allDone = plan.items.length > 0 && plan.items.every((item) => item.done);
  return plan;
}

export const progressLine = (items: ChaserItem[]) => {
  const done = items.filter((item) => item.done).length;
  return `${done} of ${items.length} done`;
};

/** What is still waiting, and on whom: "Zungu Trading – Cash Flow Planning (the HOD)". */
export const waitingList = (items: ChaserItem[], limit = 4) => {
  const open = items.filter((item) => !item.done);
  const shown = open.slice(0, limit).map((item) => `${item.label} (${waitingOn(item.collection, item.status) || "pending"})`);
  return shown.join("; ") + (open.length > limit ? ` and ${open.length - limit} more` : "");
};
