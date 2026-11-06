"use strict";
/**
 * Which interventions are linked to a change in SME revenue. Pure functions, no
 * imports, so impactLogic.test.cjs runs without Firebase.
 *
 * For each SME that completed an intervention (SME-confirmed), revenue in the
 * months after completion is compared with the months before. The same comparison
 * is made for similar SMEs in the same programme that had not yet received that
 * intervention, over the same calendar months. The difference is the lift: the
 * change beyond what the cohort did anyway. It shows a link, never proof.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.measureAll = exports.impactHeadline = exports.measureIntervention = exports.bandOf = exports.resampleRange = exports.windowChange = exports.windowAverage = exports.addMonths = exports.DEFAULT_IMPACT_SETTINGS = void 0;
exports.DEFAULT_IMPACT_SETTINGS = {
    beforeMonths: [-3, -2, -1],
    afterMonths: [3, 4, 5, 6],
    minMonthsEachSide: 2,
    minTreated: 10,
    minControls: 10,
    earlyMin: 5,
    resamples: 1000,
    seed: 20261029,
};
/* ------------------------------------------------------------------ helpers */
function addMonths(month, count) {
    const [year, value] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, value - 1 + count, 1));
    return date.toISOString().slice(0, 7);
}
exports.addMonths = addMonths;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round1 = (value) => Math.round(value * 10) / 10;
/** Average revenue over the months given (offsets from `month`), or null if too few months have data. */
function windowAverage(sme, month, offsets, minMonths) {
    const values = offsets
        .map((offset) => sme.revenue[addMonths(month, offset)])
        .filter((value) => typeof value === "number" && Number.isFinite(value));
    return values.length >= minMonths ? mean(values) : null;
}
exports.windowAverage = windowAverage;
/** Percentage change in average revenue across the window, or null without data or a zero baseline. */
function windowChange(sme, month, settings) {
    const before = windowAverage(sme, month, settings.beforeMonths, settings.minMonthsEachSide);
    const after = windowAverage(sme, month, settings.afterMonths, settings.minMonthsEachSide);
    if (before === null || after === null || before <= 0)
        return null;
    return ((after - before) / before) * 100;
}
exports.windowChange = windowChange;
/** Deterministic random numbers so a rerun on the same data gives the same range. */
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** 90% range of the mean, by resampling the SMEs with replacement. */
function resampleRange(values, resamples, seed) {
    if (values.length < 2)
        return null;
    const random = seededRandom(seed);
    const means = [];
    for (let i = 0; i < resamples; i += 1) {
        let sum = 0;
        for (let j = 0; j < values.length; j += 1)
            sum += values[Math.floor(random() * values.length)];
        means.push(sum / values.length);
    }
    means.sort((a, b) => a - b);
    return [means[Math.floor(resamples * 0.05)], means[Math.min(resamples - 1, Math.floor(resamples * 0.95))]];
}
exports.resampleRange = resampleRange;
/** Low / middle / high revenue band, split at the terciles of the baselines given. */
function bandOf(value, baselines) {
    const sorted = [...baselines].sort((a, b) => a - b);
    if (!sorted.length)
        return 1;
    const low = sorted[Math.floor(sorted.length / 3)];
    const high = sorted[Math.floor((sorted.length * 2) / 3)];
    return value < low ? 0 : value < high ? 1 : 2;
}
exports.bandOf = bandOf;
function measureIntervention(programId, interventionId, smes, treatments, settings = exports.DEFAULT_IMPACT_SETTINGS) {
    const cohort = smes.filter((sme) => sme.programId === programId);
    const byId = new Map(cohort.map((sme) => [sme.id, sme]));
    const forThis = treatments.filter((row) => row.programId === programId && row.interventionId === interventionId);
    const title = forThis[0]?.interventionTitle || interventionId;
    // Each SME counts once, at its first completion of this intervention.
    const firstMonth = new Map();
    for (const row of forThis) {
        const current = firstMonth.get(row.participantId);
        if (!current || row.month < current.month)
            firstMonth.set(row.participantId, row);
    }
    const lastAfter = Math.max(...settings.afterMonths);
    const units = [];
    const comparisonIds = new Set();
    let treatedWithoutData = 0;
    const matching = { sectorAndBand: 0, sector: 0, programme: 0 };
    for (const treatment of firstMonth.values()) {
        const sme = byId.get(treatment.participantId);
        const change = sme ? windowChange(sme, treatment.month, settings) : null;
        if (!sme || change === null) {
            treatedWithoutData += 1;
            continue;
        }
        // Comparison SMEs: same programme, not yet given this intervention by the end of
        // the window, with revenue on both sides of the same calendar months.
        const windowEnd = addMonths(treatment.month, lastAfter);
        const candidates = cohort
            .filter((other) => other.id !== sme.id)
            .filter((other) => {
            const theirs = firstMonth.get(other.id);
            return !theirs || theirs.month > windowEnd;
        })
            .map((other) => ({
            other,
            change: windowChange(other, treatment.month, settings),
            baseline: windowAverage(other, treatment.month, settings.beforeMonths, settings.minMonthsEachSide),
        }))
            .filter((row) => row.change !== null && row.baseline !== null);
        if (!candidates.length) {
            treatedWithoutData += 1;
            continue;
        }
        const baseline = windowAverage(sme, treatment.month, settings.beforeMonths, settings.minMonthsEachSide);
        const baselines = [baseline, ...candidates.map((row) => row.baseline)];
        const band = bandOf(baseline, baselines);
        const sameSector = candidates.filter((row) => row.other.sector && row.other.sector === sme.sector);
        const sameBand = sameSector.filter((row) => bandOf(row.baseline, baselines) === band);
        let level;
        let chosen;
        if (sameBand.length >= 3) {
            level = "sectorAndBand";
            chosen = sameBand;
        }
        else if (sameSector.length >= 3) {
            level = "sector";
            chosen = sameSector;
        }
        else {
            level = "programme";
            chosen = candidates;
        }
        matching[level] += 1;
        chosen.forEach((row) => comparisonIds.add(row.other.id));
        const comparisonChange = mean(chosen.map((row) => row.change));
        units.push({ sme, treatment, change, effect: change - comparisonChange, level });
    }
    const treatedCount = units.length;
    const comparisonCount = comparisonIds.size;
    const status = treatedCount >= settings.minTreated && comparisonCount >= settings.minControls
        ? "reportable"
        : treatedCount >= settings.earlyMin && comparisonCount >= settings.earlyMin
            ? "early"
            : "insufficient";
    const effects = units.map((unit) => unit.effect);
    const lift = effects.length ? mean(effects) : null;
    const range = resampleRange(effects, settings.resamples, settings.seed);
    const treatedChange = units.length ? mean(units.map((unit) => unit.change)) : null;
    // Other interventions completed by the same SME inside this window share the credit.
    const overlapping = units.filter((unit) => treatments.some((row) => row.participantId === unit.sme.id &&
        row.interventionId !== interventionId &&
        row.month >= addMonths(unit.treatment.month, Math.min(...settings.beforeMonths)) &&
        row.month <= addMonths(unit.treatment.month, lastAfter))).length;
    const split = (predicate) => {
        const group = units.filter(predicate);
        return { count: group.length, liftPercent: group.length >= 3 ? round1(mean(group.map((unit) => unit.effect))) : null };
    };
    const months = units.map((unit) => unit.treatment.month).sort();
    const period = months.length ? { from: months[0], to: months[months.length - 1] } : null;
    const demo = units.some((unit) => unit.sme.synthetic) ||
        [...comparisonIds].some((id) => byId.get(id)?.synthetic);
    const result = {
        programId,
        interventionId,
        interventionTitle: title,
        status,
        liftPercent: lift === null ? null : round1(lift),
        rangeLowPercent: range ? round1(range[0]) : null,
        rangeHighPercent: range ? round1(range[1]) : null,
        treatedChangePercent: treatedChange === null ? null : round1(treatedChange),
        comparisonChangePercent: treatedChange === null || lift === null ? null : round1(treatedChange - lift),
        treatedCount,
        comparisonCount,
        treatedWithoutData,
        matching,
        overlapShare: treatedCount ? round1(overlapping / treatedCount) : 0,
        byOutcome: {
            achieved: split((unit) => unit.treatment.outcome === "achieved"),
            notAchieved: split((unit) => unit.treatment.outcome === "not_yet" || unit.treatment.outcome === "partial"),
        },
        period,
        demo,
        headline: null,
    };
    result.headline = impactHeadline(result);
    return result;
}
exports.measureIntervention = measureIntervention;
const monthLabel = (month) => {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [year, value] = month.split("-").map(Number);
    return `${names[value - 1]} ${year}`;
};
const signedPoints = (value) => `${value > 0 ? "+" : ""}${value}`;
/** The one line a funder may read. Only for reportable results; always "linked to", never "caused". */
function impactHeadline(result) {
    if (result.status !== "reportable" || result.liftPercent === null || !result.period)
        return null;
    const points = Math.abs(result.liftPercent);
    const finding = points < 1
        ? "linked to no clear difference in revenue growth against similar SMEs"
        : `linked to revenue growth ${points} percentage points ${result.liftPercent > 0 ? "above" : "below"} similar SMEs`;
    const range = result.rangeLowPercent !== null && result.rangeHighPercent !== null
        ? `; likely range ${signedPoints(result.rangeLowPercent)} to ${signedPoints(result.rangeHighPercent)} points`
        : "";
    return `${result.interventionTitle}: ${finding} ` +
        `(${result.treatedCount} SMEs completing it ${monthLabel(result.period.from)}–${monthLabel(result.period.to)}${range}).`;
}
exports.impactHeadline = impactHeadline;
/** Every (programme, intervention) pair with at least one completion. */
function measureAll(smes, treatments, settings = exports.DEFAULT_IMPACT_SETTINGS) {
    const pairs = new Map();
    treatments.forEach((row) => pairs.set(`${row.programId}__${row.interventionId}`, { programId: row.programId, interventionId: row.interventionId }));
    return [...pairs.values()].map((pair) => measureIntervention(pair.programId, pair.interventionId, smes, treatments, settings));
}
exports.measureAll = measureAll;
//# sourceMappingURL=impactLogic.js.map