"use strict";
// Pure rules for the supplier readiness passport and opportunity matching
// (marketLinkage.ts). No Firestore here so it can be unit tested
// (supplierReadinessLogic.test.cjs).
Object.defineProperty(exports, "__esModule", { value: true });
exports.yesNo = exports.parsePercent = exports.parseBeeLevel = exports.rankMatches = exports.matchOpportunity = exports.buildPassport = exports.STAGES = exports.kindLabel = exports.kindOf = exports.DOCUMENT_KINDS = void 0;
const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLowerCase();
/* ------------------------------------------------------- document kinds */
/** Document kinds an opportunity can ask for, recognised from a requirement's key or title. */
exports.DOCUMENT_KINDS = [
    { kind: "tax", label: "Tax compliance (SARS)", pattern: /\b(tax|sars|tcc|tcs|clearance)\b/i },
    { kind: "bbbee", label: "B-BBEE certificate or affidavit", pattern: /b-?bbee|\bbee\b|affidavit/i },
    { kind: "cipc", label: "CIPC registration", pattern: /cipc|company registration|registration doc|\bcor\s?14|\bck\b/i },
    { kind: "bank", label: "Bank confirmation letter", pattern: /\bbank\b/i },
    { kind: "cidb", label: "CIDB grading", pattern: /cidb/i },
    { kind: "coid", label: "COID letter of good standing", pattern: /coid|good standing|\brma\b/i },
    { kind: "uif", label: "UIF registration", pattern: /\buif\b/i },
    { kind: "insurance", label: "Insurance", pattern: /insurance|indemnity|liability/i },
    { kind: "vat", label: "VAT registration", pattern: /\bvat\b/i },
];
const kindOf = (text) => exports.DOCUMENT_KINDS.find((entry) => entry.pattern.test(text))?.kind ?? null;
exports.kindOf = kindOf;
const kindLabel = (kind) => exports.DOCUMENT_KINDS.find((entry) => entry.kind === kind)?.label || kind;
exports.kindLabel = kindLabel;
const isCurrent = (status) => status === "valid" || status === "expiring-soon";
/** The SME's documents of one kind that are current, optionally still current on a date. */
const currentDocsOfKind = (input, kind, onDate) => input.compliance.filter((item) => (0, exports.kindOf)(`${item.key} ${item.title}`) === kind &&
    isCurrent(item.status) &&
    (!onDate || !item.expires || item.expires.getTime() >= onDate.getTime()));
/* --------------------------------------------------------------- passport */
exports.STAGES = [
    { key: "entry", label: "Entry" },
    { key: "developing", label: "Developing" },
    { key: "market_ready", label: "Market Ready" },
    { key: "preferred", label: "Preferred Supplier" },
];
const riskRank = (level) => ({ low: 0, medium: 1, high: 2, critical: 3 }[lower(level)] ?? null);
/** A tax or VAT requirement is met by the number captured on the record, without the upload. */
const capturedFor = (input, item) => {
    const kind = (0, exports.kindOf)(`${item.key} ${item.title}`);
    if (kind === "tax" && input.registrations.taxCompliancePin)
        return true;
    if (kind === "vat" && input.registrations.vatNumber)
        return true;
    return false;
};
function buildPassport(input) {
    const items = input.compliance.map((item) => !isCurrent(item.status) && capturedFor(input, item)
        ? { ...item, status: "captured", current: true }
        : { ...item, current: isCurrent(item.status) });
    const current = items.filter((item) => item.current).length;
    const required = items.length;
    const allCurrent = required > 0 && current === required;
    const checks = {
        tax: !!input.registrations.taxCompliancePin || currentDocsOfKind(input, "tax").length > 0,
        csd: !!input.registrations.csdNumber,
        bbbee: input.beeLevel !== null || currentDocsOfKind(input, "bbbee").length > 0,
        cipc: currentDocsOfKind(input, "cipc").length > 0,
    };
    const risk = riskRank(input.risk?.level);
    const readySteps = [];
    items.filter((item) => !item.current).forEach((item) => readySteps.push(`${item.title}: ${statusPhrase(item.status)}`));
    if (!required)
        readySteps.push("No compliance requirements are set up for this SME's programme");
    if (!checks.tax)
        readySteps.push("Capture the tax compliance status PIN");
    if (!checks.csd)
        readySteps.push(input.capability.csdRegistered === true
            ? "Capture the CSD supplier number (the SME says it is registered)"
            : input.capability.csdRegistered === false
                ? "Register on the Central Supplier Database (CSD)"
                : "Capture the CSD supplier number, or register on the CSD");
    if (risk !== null && risk >= 2)
        readySteps.push(`Bring the risk level down from ${input.risk?.level}`);
    const marketReady = allCurrent && checks.tax && checks.csd && (risk === null || risk < 2);
    const preferredSteps = [];
    if (risk !== 0)
        preferredSteps.push(input.risk ? `Reach a Low risk level (now ${input.risk.level})` : "Needs a risk score (runs nightly)");
    if (input.capability.capacity !== true)
        preferredSteps.push("Confirm the capacity and equipment to deliver");
    if (input.capability.tradeReferences !== true)
        preferredSteps.push("Provide trade references");
    if (input.interventions.completed < 1)
        preferredSteps.push("Complete at least one intervention");
    let stage;
    if (marketReady && !preferredSteps.length)
        stage = "preferred";
    else if (marketReady)
        stage = "market_ready";
    else if (required && current / required >= 0.5 && (checks.tax || checks.csd))
        stage = "developing";
    else
        stage = "entry";
    const nextSteps = stage === "preferred" ? [] : stage === "market_ready" ? preferredSteps : readySteps;
    return {
        participantId: input.participantId,
        name: input.name,
        stage,
        stageLabel: exports.STAGES.find((entry) => entry.key === stage).label,
        nextSteps,
        compliance: { current, required, items },
        checks,
        input,
    };
}
exports.buildPassport = buildPassport;
function statusPhrase(status) {
    switch (status) {
        case "missing": return "not uploaded";
        case "pending": return "awaiting review";
        case "expired": return "expired";
        case "queried": return "queried";
        case "rejected":
        case "invalid": return "rejected, needs replacing";
        default: return status;
    }
}
/** Only say "not registered" when the SME said so; otherwise the number is just missing. */
const csdGap = (registered) => registered === true
    ? "CSD number not captured (the SME says it is registered)"
    : registered === false
        ? "Not registered on the CSD"
        : "No CSD number captured";
const STAGE_POINTS = { entry: 10, developing: 35, market_ready: 60, preferred: 75 };
const stageIndex = (key) => exports.STAGES.findIndex((entry) => entry.key === key);
const sameText = (a, b) => lower(a) === lower(b);
const OWNERSHIP_LABEL = { black: "black-owned", women: "women-owned", youth: "youth-owned" };
function matchOpportunity(passport, requirements, closingDate) {
    const input = passport.input;
    const gaps = [];
    const strengths = [];
    const scoreParts = [];
    const add = (label, points) => scoreParts.push({ label, points });
    add(`Readiness: ${passport.stageLabel}`, STAGE_POINTS[passport.stage]);
    if (requirements.sectors.length) {
        if (requirements.sectors.some((sector) => sameText(sector, input.sector))) {
            add("Sector matches", 10);
            strengths.push(`Sector: ${input.sector}`);
        }
        else
            gaps.push(input.sector ? `Sector is ${input.sector}, not ${requirements.sectors.join(" or ")}` : "Sector not captured");
    }
    else
        add("Any sector accepted", 5);
    if (requirements.provinces.length) {
        if (requirements.provinces.some((province) => sameText(province, input.province))) {
            add("Location matches", 10);
            strengths.push(`Based in ${input.province}`);
        }
        else
            gaps.push(input.province ? `Based in ${input.province}, not ${requirements.provinces.join(" or ")}` : "Province not captured");
    }
    else
        add("Any location accepted", 5);
    for (const raw of requirements.documents) {
        const kind = (0, exports.kindOf)(raw);
        if (kind === "tax" && input.registrations.taxCompliancePin && !currentDocsOfKind(input, "tax").length) {
            strengths.push("Tax compliance PIN on file");
            continue;
        }
        if (kind === "vat" && input.registrations.vatNumber && !currentDocsOfKind(input, "vat").length) {
            strengths.push("VAT number on file");
            continue;
        }
        const match = kind
            ? currentDocsOfKind(input, kind, closingDate)
            : input.compliance.filter((item) => isCurrent(item.status) && lower(`${item.key} ${item.title}`).includes(lower(raw)));
        if (match.length)
            continue;
        const anyCurrent = kind ? currentDocsOfKind(input, kind).length > 0 : false;
        const label = kind ? (0, exports.kindLabel)(kind) : raw;
        gaps.push(anyCurrent ? `${label} expires before the closing date` : `No current ${label}`);
    }
    if (requirements.requireCsd && !input.registrations.csdNumber) {
        gaps.push(csdGap(input.capability.csdRegistered));
    }
    if (requirements.maxBeeLevel !== null) {
        if (input.beeLevel === null)
            gaps.push(input.beeNonCompliant ? "Not B-BBEE compliant" : "B-BBEE level not captured");
        else if (input.beeLevel > requirements.maxBeeLevel)
            gaps.push(`B-BBEE level ${input.beeLevel}, needs level ${requirements.maxBeeLevel} or better`);
        else
            strengths.push(`B-BBEE level ${input.beeLevel}`);
    }
    Object.keys(OWNERSHIP_LABEL).forEach((key) => {
        const minimum = requirements.ownership[key];
        if (minimum === undefined || minimum === null)
            return;
        const actual = input.ownership[key];
        if (actual === null)
            gaps.push(`${OWNERSHIP_LABEL[key]} percentage not captured`);
        else if (actual < minimum)
            gaps.push(`${actual}% ${OWNERSHIP_LABEL[key]}, needs ${minimum}%`);
        else {
            strengths.push(`${actual}% ${OWNERSHIP_LABEL[key]}`);
            add(`${actual}% ${OWNERSHIP_LABEL[key]}`, 3);
        }
    });
    if (requirements.minStage && stageIndex(passport.stage) < stageIndex(requirements.minStage)) {
        gaps.push(`Readiness is ${passport.stageLabel}, needs ${exports.STAGES.find((entry) => entry.key === requirements.minStage).label}`);
    }
    const risk = riskRank(input.risk?.level);
    if (risk === 0)
        add("Low risk", 5);
    else if (risk !== null && risk >= 2)
        add(`${input.risk?.level} risk`, -10);
    if (input.capability.capacity === true)
        strengths.push("Has capacity and equipment");
    if (input.capability.tradeReferences === true)
        strengths.push("Has trade references");
    return {
        participantId: passport.participantId,
        name: passport.name,
        stage: passport.stage,
        eligible: gaps.length === 0,
        score: Math.max(0, Math.min(100, scoreParts.reduce((sum, part) => sum + part.points, 0))),
        scoreParts,
        gaps,
        strengths,
    };
}
exports.matchOpportunity = matchOpportunity;
/** Eligible first, then by score; ties alphabetically so the order is stable. */
const rankMatches = (matches) => [...matches].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.name.localeCompare(b.name));
exports.rankMatches = rankMatches;
/* --------------------------------------------------------------- parsing */
/** "Level 2", "L2", 2 → 2; anything else → null. Level 5+ reads as its number. */
function parseBeeLevel(value) {
    const match = /([1-8])/.exec(clean(value));
    return match ? Number(match[1]) : null;
}
exports.parseBeeLevel = parseBeeLevel;
const parsePercent = (value) => {
    if (value === null || value === undefined || clean(value) === "")
        return null;
    const number = Number(String(value).replace("%", ""));
    return Number.isFinite(number) ? number : null;
};
exports.parsePercent = parsePercent;
const yesNo = (answer) => {
    const text = lower(answer);
    if (text === "yes")
        return true;
    if (text === "no")
        return false;
    return null;
};
exports.yesNo = yesNo;
//# sourceMappingURL=supplierReadinessLogic.js.map