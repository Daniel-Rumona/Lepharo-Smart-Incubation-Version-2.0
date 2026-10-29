/**
 * Pure twin event capture, replay and reconciliation. No Firebase imports, so the
 * same rules can be unit-tested and called from triggers, backfills and workers.
 * Events are append-only facts; twinStates are rebuilt from them and never edited.
 */
export const TWIN_RULE_VERSION = "twin-events-1.0";

export const MILESTONES = [
  "assigned",
  "delivery",
  "confirmed",
  "approved",
  "validated",
  "outcome",
] as const;
export type Milestone = (typeof MILESTONES)[number];

/** `source_timestamp`: the record carries an explicit transition time.
 *  `observed_at_import`: only today's state is known; occurrence time stays unknown. */
export type TimeBasis = "source_timestamp" | "observed_at_import";

export type TwinEvent = {
  id: string;
  programId: string;
  branchId: string | null;
  assignmentId: string;
  milestone: Milestone;
  occurredAt: number | null;
  recordedAt: number;
  timeBasis: TimeBasis;
  sourceCollection: string;
  sourceId: string;
  /** Source revision (e.g. updateTime millis) so corrections supersede, not duplicate. */
  sourceRevision: number;
  deleted: boolean;
  dataOrigin: "synthetic" | "real";
  seedRunId: string | null;
  ruleVersion: string;
};

export type SourceDoc = Record<string, any> & { id: string };
export type CaptureContext = {
  collection: string;
  revision: number;
  now: number;
};

export function millis(value: any): number | null {
  const n =
    typeof value?.toMillis === "function"
      ? value.toMillis()
      : value instanceof Date
      ? value.getTime()
      : typeof value?.seconds === "number"
      ? value.seconds * 1000
      : typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
      ? value
      : NaN;
  return Number.isFinite(n) ? n : null;
}

export function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Identity excludes revision and recordedAt: replays and corrections hit the same document. */
export function eventId(
  e: Pick<
    TwinEvent,
    "assignmentId" | "milestone" | "sourceCollection" | "sourceId"
  >
): string {
  const key = `${e.assignmentId}|${e.milestone}|${e.sourceCollection}|${e.sourceId}`;
  return `${key.replace(/[\/\s|]/g, "_")}__${hash(key)}`;
}

function milestonesOf(
  collection: string,
  d: SourceDoc
): Array<{ assignmentId: string; milestone: Milestone; at: any }> {
  switch (collection) {
    case "assignedInterventions":
      return [
        { assignmentId: d.id, milestone: "assigned", at: d.assignedAt },
        {
          assignmentId: d.id,
          milestone: "delivery",
          at: d.assigneeCompletedAt,
        },
        {
          assignmentId: d.id,
          milestone: "confirmed",
          at: d.participantConfirmedAt,
        },
      ];
    case "movDocuments": {
      const a = d.assignedInterventionId;
      return [
        { assignmentId: a, milestone: "approved", at: d.hodApprovedAt },
        {
          assignmentId: a,
          milestone: "validated",
          at: d.monitoringApprovedAt || d.monitoringValidation?.validatedAt,
        },
      ];
    }
    case "outcomeAssessments":
      return [
        {
          assignmentId: d.assignedInterventionId,
          milestone: "outcome",
          at: d.at,
        },
      ];
    default:
      return [];
  }
}

/**
 * Events for one source document. A milestone only becomes an event when the record
 * carries an explicit time for it. Never infer a transition time from updatedAt.
 * For a deleted source pass `doc = null` and the last known document as `removedDoc`:
 * tombstone events are produced so projections drop the milestone.
 */
export function deriveEvents(
  doc: SourceDoc | null,
  ctx: CaptureContext,
  opts: { removedDoc?: SourceDoc } = {}
): { events: TwinEvent[]; issues: string[] } {
  const source = doc || opts.removedDoc;
  const issues: string[] = [];
  if (!source) return { events: [], issues };
  const synthetic =
    source.dataOrigin === "synthetic" || String(source.id).startsWith("dtseed_");
  const events: TwinEvent[] = [];
  for (const m of milestonesOf(ctx.collection, source)) {
    if (m.at == null) continue;
    if (!m.assignmentId) {
      issues.push(
        `${ctx.collection}/${source.id}: ${m.milestone} has no assignment link`
      );
      continue;
    }
    const at = millis(m.at);
    if (at === null) {
      issues.push(`${ctx.collection}/${source.id}: invalid ${m.milestone} date`);
      continue;
    }
    if (at > ctx.now) {
      issues.push(
        `${ctx.collection}/${source.id}: ${m.milestone} date is in the future`
      );
      continue;
    }
    const key = {
      assignmentId: m.assignmentId,
      milestone: m.milestone,
      sourceCollection: ctx.collection,
      sourceId: source.id,
    };
    events.push({
      id: eventId(key),
      programId: String(source.programId || ""),
      branchId: source.branchId || null,
      ...key,
      occurredAt: at,
      recordedAt: ctx.now,
      timeBasis: "source_timestamp",
      sourceRevision: ctx.revision,
      deleted: !doc,
      dataOrigin: synthetic ? "synthetic" : "real",
      seedRunId: source.seedRunId || null,
      ruleVersion: TWIN_RULE_VERSION,
    });
  }
  return { events, issues };
}

/** Current-state evidence with no timestamp (real-record backfill). Occurrence stays unknown. */
export function observeAtImport(
  assignmentId: string,
  milestone: Milestone,
  doc: SourceDoc,
  ctx: CaptureContext
): TwinEvent {
  const key = {
    assignmentId,
    milestone,
    sourceCollection: ctx.collection,
    sourceId: doc.id,
  };
  return {
    id: eventId(key),
    programId: String(doc.programId || ""),
    branchId: doc.branchId || null,
    ...key,
    occurredAt: null,
    recordedAt: ctx.now,
    timeBasis: "observed_at_import",
    sourceRevision: ctx.revision,
    deleted: false,
    dataOrigin: doc.dataOrigin === "synthetic" ? "synthetic" : "real",
    seedRunId: doc.seedRunId || null,
    ruleVersion: TWIN_RULE_VERSION,
  };
}

/** Last-writer-wins per event id by source revision, regardless of arrival order. */
export function mergeEvents(
  existing: TwinEvent[],
  incoming: TwinEvent[]
): TwinEvent[] {
  const byId = new Map<string, TwinEvent>();
  for (const e of [...existing, ...incoming]) {
    const prev = byId.get(e.id);
    if (
      !prev ||
      e.sourceRevision > prev.sourceRevision ||
      (e.sourceRevision === prev.sourceRevision && e.recordedAt > prev.recordedAt)
    )
      byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export type AssignmentTwinState = {
  assignmentId: string;
  programId: string;
  reached: Partial<
    Record<Milestone, { at: number | null; basis: TimeBasis; sources: number }>
  >;
  watermark: number;
};

/** Deterministic rebuild: independent of input order or duplicates. */
export function projectStates(events: TwinEvent[]): AssignmentTwinState[] {
  const live = mergeEvents([], events).filter((e) => !e.deleted);
  const states = new Map<string, AssignmentTwinState>();
  for (const e of live) {
    const s = states.get(e.assignmentId) || {
      assignmentId: e.assignmentId,
      programId: e.programId,
      reached: {},
      watermark: 0,
    };
    states.set(e.assignmentId, s);
    const prev = s.reached[e.milestone];
    // Earliest evidenced time wins when several sources show one milestone (e.g. per-SME MOVs).
    const better =
      !prev ||
      (e.occurredAt !== null && (prev.at === null || e.occurredAt < prev.at));
    s.reached[e.milestone] = better
      ? {
          at: e.occurredAt,
          basis: e.timeBasis,
          sources: (prev?.sources || 0) + 1,
        }
      : { ...prev!, sources: prev!.sources + 1 };
    s.watermark = Math.max(s.watermark, e.recordedAt);
  }
  return [...states.values()].sort((a, b) =>
    a.assignmentId.localeCompare(b.assignmentId)
  );
}

export type Discrepancy = {
  assignmentId: string;
  milestone: Milestone;
  kind: "missing_event" | "orphan_event" | "time_mismatch";
};

/** Compare projected states with events freshly derived from sources. */
export function reconcile(
  states: AssignmentTwinState[],
  sources: Array<{ collection: string; docs: SourceDoc[] }>,
  now: number
): { discrepancies: Discrepancy[]; checked: number; issues: string[] } {
  const expected: TwinEvent[] = [];
  const issues: string[] = [];
  for (const { collection, docs } of sources)
    for (const d of docs) {
      const r = deriveEvents(d, { collection, revision: 0, now });
      expected.push(...r.events);
      issues.push(...r.issues);
    }
  const want = new Map(projectStates(expected).map((s) => [s.assignmentId, s]));
  const have = new Map(states.map((s) => [s.assignmentId, s]));
  const discrepancies: Discrepancy[] = [];
  for (const id of new Set([...want.keys(), ...have.keys()]))
    for (const m of MILESTONES) {
      const w = want.get(id)?.reached[m],
        h = have.get(id)?.reached[m];
      if (w && !h)
        discrepancies.push({ assignmentId: id, milestone: m, kind: "missing_event" });
      else if (!w && h && h.basis === "source_timestamp")
        discrepancies.push({ assignmentId: id, milestone: m, kind: "orphan_event" });
      else if (w && h && h.basis === "source_timestamp" && w.at !== h.at)
        discrepancies.push({ assignmentId: id, milestone: m, kind: "time_mismatch" });
    }
  return { discrepancies, checked: want.size, issues };
}
