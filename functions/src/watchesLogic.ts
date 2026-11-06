/**
 * Watches: conditions a person sets in plain words ("tell me if any Rustenburg SME goes High risk
 * with no session booked"), checked every morning against data the platform already computes.
 * A watch tells you when something *becomes* true: what already matches when it is set is its
 * baseline, not news. Watches on one record end once they fire; wider ones run until they expire.
 * Pure (no imports) so watchesLogic.test.cjs runs without Firebase; watches.ts loads and writes.
 */

export type WatchType = "sme_risk" | "impact_reportable" | "intervention_done";
export const WATCH_TYPES: WatchType[] = ["sme_risk", "impact_reportable", "intervention_done"];
export type RiskLevel = "Medium" | "High" | "Critical";

export type WatchSpec = {
  type: WatchType;
  participantId?: string;
  participantName?: string;
  programId?: string;
  programName?: string;
  interventionId?: string;
  interventionTitle?: string;
  /** sme_risk: the level to reach; higher levels count too. */
  level?: RiskLevel;
  /** sme_risk: only when no session is booked in the next this-many days. */
  noSessionDays?: number;
  /** impact_reportable: one measure, or either. */
  metric?: "revenue" | "jobs";
};

export const WATCH_LIFETIME_DAYS = 90;
export const MAX_ACTIVE_WATCHES = 10;
export const MAX_FIRINGS_KEPT = 10;

/** Who may see what: everything, their programmes, or the SMEs they support. */
export type Visibility =
  | { kind: "all" }
  | { kind: "programmes"; programmeIds: string[] }
  | { kind: "own"; uid: string };

const ALL_ROLES = ["director", "operations", "system_admin", "superadmin"];
const PROGRAMME_ROLES = ["projectadmin", "receptionist", "funder"];
const OWN_ROLES = ["coordinator", "consultant", "mentor", "facilitator", "advisor"];

const normRole = (role: string) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** null when the role may not set watches at all. */
export function visibilityFor(role: string, programmeIds: string[], uid: string): Visibility | null {
  const key = normRole(role);
  if (ALL_ROLES.includes(key)) return { kind: "all" };
  if (PROGRAMME_ROLES.includes(key)) return { kind: "programmes", programmeIds };
  if (OWN_ROLES.includes(key)) return { kind: "own", uid };
  return null;
}

const text = (value: unknown) => String(value ?? "").trim();

/** Checks a spec has what its type needs, and keeps only the fields that type uses. */
export function normaliseSpec(raw: any): { spec?: WatchSpec; error?: string } {
  const type = text(raw?.type) as WatchType;
  if (!WATCH_TYPES.includes(type)) return { error: "That isn't something a watch can follow yet." };
  const pick = (key: keyof WatchSpec) => text(raw?.[key]) || undefined;
  if (type === "sme_risk") {
    const asked = text(raw?.level).toLowerCase();
    const level: RiskLevel = asked === "medium" ? "Medium" : asked === "critical" ? "Critical" : "High";
    const days = Math.round(Number(raw?.noSessionDays));
    const spec: WatchSpec = {
      type, level,
      participantId: pick("participantId"), participantName: pick("participantName"),
      programId: pick("programId"), programName: pick("programName"),
      noSessionDays: Number.isFinite(days) && days > 0 ? Math.min(days, 90) : undefined,
    };
    return { spec: strip(spec) };
  }
  if (type === "impact_reportable") {
    if (!pick("interventionId")) return { error: "Say which intervention to watch." };
    const metric = text(raw?.metric).toLowerCase();
    return {
      spec: strip({
        type, interventionId: pick("interventionId"), interventionTitle: pick("interventionTitle"),
        programId: pick("programId"), programName: pick("programName"),
        metric: metric === "revenue" || metric === "jobs" ? (metric as WatchSpec["metric"]) : undefined,
      }),
    };
  }
  if (!pick("participantId")) return { error: "Say which SME to watch." };
  return {
    spec: strip({
      type, participantId: pick("participantId"), participantName: pick("participantName"),
      interventionId: pick("interventionId"), interventionTitle: pick("interventionTitle"),
    }),
  };
}

const strip = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/** The watch in a sentence, as the person will see it in their list. */
export function describeWatch(spec: WatchSpec): string {
  const programme = spec.programName ? ` in ${spec.programName}` : "";
  if (spec.type === "sme_risk") {
    const who = spec.participantId ? (spec.participantName || "this SME") : `any SME${programme}`;
    const level = spec.level === "Medium" ? "Medium risk or worse" : spec.level === "Critical" ? "Critical risk" : "High or Critical risk";
    const session = spec.noSessionDays ? ` with no session booked in the next ${spec.noSessionDays} days` : "";
    return `Tell me when ${who} goes ${level}${session}.`;
  }
  if (spec.type === "impact_reportable") {
    const what = spec.interventionTitle || "this intervention";
    const measure = spec.metric ? ` on ${spec.metric === "jobs" ? "jobs" : "revenue"}` : "";
    return `Tell me when ${what}${programme} has a reportable impact result${measure}.`;
  }
  const what = spec.interventionTitle ? ` ${spec.interventionTitle}` : " an intervention";
  return `Tell me when ${spec.participantName || "this SME"} completes${what}.`;
}

/** Whether a watch on one record ends after it fires. */
export const endsOnFire = (spec: WatchSpec) => spec.type !== "sme_risk" || Boolean(spec.participantId);

// ---- The data a check reads ----

export type RiskRow = { participantId: string; participantName: string; programId: string; level: string; score: number; ownerIds: string[]; reasons: string[] };
export type ImpactRow = { programId: string; interventionId: string; interventionTitle: string; metric: string; status: string; headline: string };
export type AssignmentRow = { id: string; participantId: string; participantName: string; programId: string; interventionId: string; interventionTitle: string; status: string; assigneeId: string; completedAt: number };

export type World = {
  risk: RiskRow[];
  /** Earliest future session per SME (ms), from appointments. */
  nextSession: Map<string, number>;
  impact: ImpactRow[];
  assignments: AssignmentRow[];
};

/** Something that matches the watch now; key identifies it between runs. */
export type Match = { key: string; title: string; detail: string; link: string };

const DAY_MS = 86_400_000;
const sees = (visibility: Visibility, programId: string, ownerIds: string[]) =>
  visibility.kind === "all" ||
  (visibility.kind === "programmes" && visibility.programmeIds.includes(programId)) ||
  (visibility.kind === "own" && ownerIds.includes(visibility.uid));

const LEVEL_RANK: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };
const levelMeets = (level: string, wanted: RiskLevel | undefined) =>
  (LEVEL_RANK[level] ?? -1) >= LEVEL_RANK[wanted || "High"];

/** Everything that meets the watch right now, limited to what its owner may see. */
export function currentMatches(spec: WatchSpec, world: World, visibility: Visibility, now: number): Match[] {
  if (spec.type === "sme_risk") {
    return world.risk
      .filter((row) => !spec.participantId || row.participantId === spec.participantId)
      .filter((row) => !spec.programId || row.programId === spec.programId)
      .filter((row) => sees(visibility, row.programId, row.ownerIds))
      .filter((row) => levelMeets(row.level, spec.level))
      .filter((row) => {
        if (!spec.noSessionDays) return true;
        const next = world.nextSession.get(row.participantId);
        return !(next && next >= now && next <= now + spec.noSessionDays * DAY_MS);
      })
      .map((row) => ({
        key: row.participantId,
        title: `${row.participantName} is ${row.level} risk${spec.noSessionDays ? " with no session booked" : ""}`,
        detail: row.reasons.slice(0, 3).join("; "),
        link: "/participants/risk",
      }));
  }
  if (spec.type === "impact_reportable") {
    return world.impact
      .filter((row) => row.interventionId === spec.interventionId && row.status === "reportable")
      .filter((row) => !spec.programId || row.programId === spec.programId)
      .filter((row) => !spec.metric || row.metric === spec.metric)
      // Impact is a programme-level result: SME-level visibility doesn't limit it, programmes do.
      .filter((row) => visibility.kind !== "programmes" || visibility.programmeIds.includes(row.programId))
      .map((row) => ({
        key: `${row.programId}__${row.metric}`,
        title: `${row.interventionTitle} now has a reportable ${row.metric === "jobs" ? "jobs" : "revenue"} result`,
        detail: row.headline,
        link: `/impact?intervention=${encodeURIComponent(row.interventionId)}`,
      }));
  }
  return world.assignments
    .filter((row) => row.participantId === spec.participantId)
    .filter((row) => !spec.interventionId || row.interventionId === spec.interventionId)
    .filter((row) => row.status === "completed")
    .filter((row) => sees(visibility, row.programId, [row.assigneeId]))
    .map((row) => ({
      key: row.id,
      title: `${row.participantName} completed ${row.interventionTitle}`,
      detail: "",
      link: "/interventions",
    }));
}

/**
 * What a run should report: matches that weren't matching last time. Keeping only the current
 * keys means something that stops matching and matches again is news again.
 */
export function nextWatchState(spec: WatchSpec, previousKeys: string[], matches: Match[]) {
  const before = new Set(previousKeys);
  const fresh = matches.filter((match) => !before.has(match.key));
  return {
    fired: fresh,
    keys: matches.map((match) => match.key),
    done: fresh.length > 0 && endsOnFire(spec),
  };
}

/** One notification line for a run that found something. */
export function firingMessage(spec: WatchSpec, fired: Match[]): { title: string; message: string; link: string } {
  const first = fired[0];
  if (fired.length === 1) {
    return { title: `Watch: ${first.title}`, message: first.detail ? `${first.title}. ${first.detail}` : `${first.title}.`, link: first.link };
  }
  const names = fired.slice(0, 3).map((match) => match.title).join("; ");
  const more = fired.length > 3 ? `; and ${fired.length - 3} more` : "";
  return { title: `Watch: ${fired.length} new matches`, message: `${describeWatch(spec)} ${names}${more}.`, link: first.link };
}

// ---- Matching names from the person's words to records ----

const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Records whose name matches: exact first, else every one containing the words. */
export function matchByName<T extends { id: string; name: string }>(query: string, candidates: T[]): T[] {
  const wanted = fold(query);
  if (!wanted) return [];
  const exact = candidates.filter((item) => fold(item.name) === wanted);
  if (exact.length) return exact;
  const words = wanted.split(" ");
  return candidates.filter((item) => {
    const name = fold(item.name);
    return words.every((word) => name.includes(word));
  });
}
