"use strict";
/**
 * Watches: conditions a person sets in plain words ("tell me if any Rustenburg SME goes High risk
 * with no session booked"), checked every morning against data the platform already computes.
 * A watch tells you when something *becomes* true: what already matches when it is set is its
 * baseline, not news. Watches on one record end once they fire; wider ones run until they expire.
 * Pure (no imports) so watchesLogic.test.cjs runs without Firebase; watches.ts loads and writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchByName = exports.firingMessage = exports.nextWatchState = exports.currentMatches = exports.endsOnFire = exports.describeWatch = exports.normaliseSpec = exports.visibilityFor = exports.MAX_FIRINGS_KEPT = exports.MAX_ACTIVE_WATCHES = exports.WATCH_LIFETIME_DAYS = exports.WATCH_TYPES = void 0;
exports.WATCH_TYPES = ["sme_risk", "impact_reportable", "intervention_done"];
exports.WATCH_LIFETIME_DAYS = 90;
exports.MAX_ACTIVE_WATCHES = 10;
exports.MAX_FIRINGS_KEPT = 10;
// Receptionists run the front desk: nothing a watch follows is theirs to act on. Funders watch impact.
const ALL_ROLES = ["director", "operations", "system_admin"];
const PROGRAMME_ROLES = ["projectadmin", "funder"];
const OWN_ROLES = ["coordinator"];
const normRole = (role) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
/** null when the role may not set watches at all. */
function visibilityFor(role, programmeIds, uid) {
    const key = normRole(role);
    if (ALL_ROLES.includes(key))
        return { kind: "all" };
    if (PROGRAMME_ROLES.includes(key))
        return { kind: "programmes", programmeIds };
    if (OWN_ROLES.includes(key))
        return { kind: "own", uid };
    return null;
}
exports.visibilityFor = visibilityFor;
const text = (value) => String(value ?? "").trim();
/** Checks a spec has what its type needs, and keeps only the fields that type uses. */
function normaliseSpec(raw) {
    const type = text(raw?.type);
    if (!exports.WATCH_TYPES.includes(type))
        return { error: "That isn't something a watch can follow yet." };
    const pick = (key) => text(raw?.[key]) || undefined;
    if (type === "sme_risk") {
        const asked = text(raw?.level).toLowerCase();
        const level = asked === "medium" ? "Medium" : asked === "critical" ? "Critical" : "High";
        const days = Math.round(Number(raw?.noSessionDays));
        const spec = {
            type, level,
            participantId: pick("participantId"), participantName: pick("participantName"),
            programId: pick("programId"), programName: pick("programName"),
            noSessionDays: Number.isFinite(days) && days > 0 ? Math.min(days, 90) : undefined,
        };
        return { spec: strip(spec) };
    }
    if (type === "impact_reportable") {
        if (!pick("interventionId"))
            return { error: "Say which intervention to watch." };
        const metric = text(raw?.metric).toLowerCase();
        return {
            spec: strip({
                type, interventionId: pick("interventionId"), interventionTitle: pick("interventionTitle"),
                programId: pick("programId"), programName: pick("programName"),
                metric: metric === "revenue" || metric === "jobs" ? metric : undefined,
            }),
        };
    }
    if (!pick("participantId"))
        return { error: "Say which SME to watch." };
    return {
        spec: strip({
            type, participantId: pick("participantId"), participantName: pick("participantName"),
            interventionId: pick("interventionId"), interventionTitle: pick("interventionTitle"),
        }),
    };
}
exports.normaliseSpec = normaliseSpec;
const strip = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
/** The watch in a sentence, as the person will see it in their list. */
function describeWatch(spec) {
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
exports.describeWatch = describeWatch;
/** Whether a watch on one record ends after it fires. */
const endsOnFire = (spec) => spec.type !== "sme_risk" || Boolean(spec.participantId);
exports.endsOnFire = endsOnFire;
const DAY_MS = 86400000;
const sees = (visibility, programId, ownerIds) => visibility.kind === "all" ||
    (visibility.kind === "programmes" && visibility.programmeIds.includes(programId)) ||
    (visibility.kind === "own" && ownerIds.includes(visibility.uid));
const LEVEL_RANK = { Low: 0, Medium: 1, High: 2, Critical: 3 };
const levelMeets = (level, wanted) => (LEVEL_RANK[level] ?? -1) >= LEVEL_RANK[wanted || "High"];
/** Everything that meets the watch right now, limited to what its owner may see. */
function currentMatches(spec, world, visibility, now) {
    if (spec.type === "sme_risk") {
        return world.risk
            .filter((row) => !spec.participantId || row.participantId === spec.participantId)
            .filter((row) => !spec.programId || row.programId === spec.programId)
            .filter((row) => sees(visibility, row.programId, row.ownerIds))
            .filter((row) => levelMeets(row.level, spec.level))
            .filter((row) => {
            if (!spec.noSessionDays)
                return true;
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
exports.currentMatches = currentMatches;
/**
 * What a run should report: matches that weren't matching last time. Keeping only the current
 * keys means something that stops matching and matches again is news again.
 */
function nextWatchState(spec, previousKeys, matches) {
    const before = new Set(previousKeys);
    const fresh = matches.filter((match) => !before.has(match.key));
    return {
        fired: fresh,
        keys: matches.map((match) => match.key),
        done: fresh.length > 0 && (0, exports.endsOnFire)(spec),
    };
}
exports.nextWatchState = nextWatchState;
/** One notification line for a run that found something. */
function firingMessage(spec, fired) {
    const first = fired[0];
    if (fired.length === 1) {
        return { title: `Watch: ${first.title}`, message: first.detail ? `${first.title}. ${first.detail}` : `${first.title}.`, link: first.link };
    }
    const names = fired.slice(0, 3).map((match) => match.title).join("; ");
    const more = fired.length > 3 ? `; and ${fired.length - 3} more` : "";
    return { title: `Watch: ${fired.length} new matches`, message: `${describeWatch(spec)} ${names}${more}.`, link: first.link };
}
exports.firingMessage = firingMessage;
// ---- Matching names from the person's words to records ----
const fold = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Records whose name matches: exact first, else every one containing the words. */
function matchByName(query, candidates) {
    const wanted = fold(query);
    if (!wanted)
        return [];
    const exact = candidates.filter((item) => fold(item.name) === wanted);
    if (exact.length)
        return exact;
    const words = wanted.split(" ");
    return candidates.filter((item) => {
        const name = fold(item.name);
        return words.every((word) => name.includes(word));
    });
}
exports.matchByName = matchByName;
//# sourceMappingURL=watchesLogic.js.map