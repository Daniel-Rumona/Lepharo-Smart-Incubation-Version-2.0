// Pure rules for the supplier readiness passport and opportunity matching
// (marketLinkage.ts). No Firestore here so it can be unit tested
// (supplierReadinessLogic.test.cjs).

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();

/* ---------------------------------------------------------------- inputs */

/** One programme upload requirement and where the SME stands (complianceExpiry.requirementStates). */
export type ComplianceItem = {
  key: string;
  title: string;
  /** missing, pending, valid, invalid, queried, rejected, expired or expiring-soon. */
  status: string;
  expires: Date | null;
};

export type PassportInput = {
  participantId: string;
  name: string;
  sector: string;
  province: string;
  town: string;
  beeLevel: number | null;
  /** True when the record says the SME is not B-BBEE compliant (so it has no level). */
  beeNonCompliant?: boolean;
  ownership: { black: number | null; women: number | null; youth: number | null };
  registrations: { incomeTaxNumber: string; vatNumber: string; csdNumber: string; taxCompliancePin: string };
  compliance: ComplianceItem[];
  risk: { score: number; level: string } | null;
  interventions: { completed: number; total: number };
  performance: { annualRevenue: number | null; employees: number | null; monthsReported: number };
  /** Gap analysis market-linkage answers; null when the question was not answered. */
  capability: { csdRegistered: boolean | null; capacity: boolean | null; tradeReferences: boolean | null; clientList: boolean | null };
};

/* ------------------------------------------------------- document kinds */

/** Document kinds an opportunity can ask for, recognised from a requirement's key or title. */
export const DOCUMENT_KINDS = [
  { kind: "tax", label: "Tax compliance (SARS)", pattern: /\b(tax|sars|tcc|tcs|clearance)\b/i },
  { kind: "bbbee", label: "B-BBEE certificate or affidavit", pattern: /b-?bbee|\bbee\b|affidavit/i },
  { kind: "cipc", label: "CIPC registration", pattern: /cipc|company registration|registration doc|\bcor\s?14|\bck\b/i },
  { kind: "bank", label: "Bank confirmation letter", pattern: /\bbank\b/i },
  { kind: "cidb", label: "CIDB grading", pattern: /cidb/i },
  { kind: "coid", label: "COID letter of good standing", pattern: /coid|good standing|\brma\b/i },
  { kind: "uif", label: "UIF registration", pattern: /\buif\b/i },
  { kind: "insurance", label: "Insurance", pattern: /insurance|indemnity|liability/i },
  { kind: "vat", label: "VAT registration", pattern: /\bvat\b/i },
] as const;

export type DocumentKind = typeof DOCUMENT_KINDS[number]["kind"];

export const kindOf = (text: string): DocumentKind | null =>
  DOCUMENT_KINDS.find((entry) => entry.pattern.test(text))?.kind ?? null;

export const kindLabel = (kind: string) => DOCUMENT_KINDS.find((entry) => entry.kind === kind)?.label || kind;

const isCurrent = (status: string) => status === "valid" || status === "expiring-soon";

/** The SME's documents of one kind that are current, optionally still current on a date. */
const currentDocsOfKind = (input: PassportInput, kind: DocumentKind, onDate?: Date | null) =>
  input.compliance.filter((item) =>
    kindOf(`${item.key} ${item.title}`) === kind &&
    isCurrent(item.status) &&
    (!onDate || !item.expires || item.expires.getTime() >= onDate.getTime())
  );

/* --------------------------------------------------------------- passport */

export const STAGES = [
  { key: "entry", label: "Entry" },
  { key: "developing", label: "Developing" },
  { key: "market_ready", label: "Market Ready" },
  { key: "preferred", label: "Preferred Supplier" },
] as const;

export type StageKey = typeof STAGES[number]["key"];

export type Passport = {
  participantId: string;
  name: string;
  stage: StageKey;
  stageLabel: string;
  /** What would move the SME to the next stage, most important first. */
  nextSteps: string[];
  compliance: { current: number; required: number; items: Array<ComplianceItem & { current: boolean }> };
  checks: { tax: boolean; csd: boolean; bbbee: boolean; cipc: boolean };
  input: PassportInput;
};

const riskRank = (level?: string) => ({ low: 0, medium: 1, high: 2, critical: 3 } as Record<string, number>)[lower(level)] ?? null;

/** A tax or VAT requirement is met by the number captured on the record, without the upload. */
const capturedFor = (input: PassportInput, item: ComplianceItem) => {
  const kind = kindOf(`${item.key} ${item.title}`);
  if (kind === "tax" && input.registrations.taxCompliancePin) return true;
  if (kind === "vat" && input.registrations.vatNumber) return true;
  return false;
};

export function buildPassport(input: PassportInput): Passport {
  const items = input.compliance.map((item) =>
    !isCurrent(item.status) && capturedFor(input, item)
      ? { ...item, status: "captured", current: true }
      : { ...item, current: isCurrent(item.status) }
  );
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

  const readySteps: string[] = [];
  items.filter((item) => !item.current).forEach((item) => readySteps.push(`${item.title}: ${statusPhrase(item.status)}`));
  if (!required) readySteps.push("No compliance requirements are set up for this SME's programme");
  if (!checks.tax) readySteps.push("Capture the tax compliance status PIN");
  if (!checks.csd) readySteps.push(
    input.capability.csdRegistered === true
      ? "Capture the CSD supplier number (the SME says it is registered)"
      : input.capability.csdRegistered === false
        ? "Register on the Central Supplier Database (CSD)"
        : "Capture the CSD supplier number, or register on the CSD"
  );
  if (risk !== null && risk >= 2) readySteps.push(`Bring the risk level down from ${input.risk?.level}`);

  const marketReady = allCurrent && checks.tax && checks.csd && (risk === null || risk < 2);

  const preferredSteps: string[] = [];
  if (risk !== 0) preferredSteps.push(input.risk ? `Reach a Low risk level (now ${input.risk.level})` : "Needs a risk score (runs nightly)");
  if (input.capability.capacity !== true) preferredSteps.push("Confirm the capacity and equipment to deliver");
  if (input.capability.tradeReferences !== true) preferredSteps.push("Provide trade references");
  if (input.interventions.completed < 1) preferredSteps.push("Complete at least one intervention");

  let stage: StageKey;
  if (marketReady && !preferredSteps.length) stage = "preferred";
  else if (marketReady) stage = "market_ready";
  else if (required && current / required >= 0.5 && (checks.tax || checks.csd)) stage = "developing";
  else stage = "entry";

  const nextSteps = stage === "preferred" ? [] : stage === "market_ready" ? preferredSteps : readySteps;
  return {
    participantId: input.participantId,
    name: input.name,
    stage,
    stageLabel: STAGES.find((entry) => entry.key === stage)!.label,
    nextSteps,
    compliance: { current, required, items },
    checks,
    input,
  };
}

function statusPhrase(status: string) {
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

/* ----------------------------------------------------------- opportunities */

export type OpportunityRequirements = {
  sectors: string[];
  provinces: string[];
  documents: string[];
  /** Highest B-BBEE level accepted (1 is best); null for no limit. */
  maxBeeLevel: number | null;
  /** Minimum ownership percentages, e.g. { black: 51 }. */
  ownership: { black?: number; women?: number; youth?: number };
  requireCsd: boolean;
  minStage: StageKey | null;
};

export type MatchResult = {
  participantId: string;
  name: string;
  stage: StageKey;
  eligible: boolean;
  score: number;
  /** How the score was reached, e.g. [{ label: "Readiness: Entry", points: 10 }]. */
  scoreParts: Array<{ label: string; points: number }>;
  /** Why the SME is not eligible; each one is something that can be fixed or explained. */
  gaps: string[];
  strengths: string[];
};

/** Only say "not registered" when the SME said so; otherwise the number is just missing. */
const csdGap = (registered: boolean | null) =>
  registered === true
    ? "CSD number not captured (the SME says it is registered)"
    : registered === false
      ? "Not registered on the CSD"
      : "No CSD number captured";

const STAGE_POINTS: Record<StageKey, number> = { entry: 10, developing: 35, market_ready: 60, preferred: 75 };
const stageIndex = (key: StageKey) => STAGES.findIndex((entry) => entry.key === key);
const sameText = (a: string, b: string) => lower(a) === lower(b);
const OWNERSHIP_LABEL = { black: "black-owned", women: "women-owned", youth: "youth-owned" } as const;

export function matchOpportunity(passport: Passport, requirements: OpportunityRequirements, closingDate: Date | null): MatchResult {
  const input = passport.input;
  const gaps: string[] = [];
  const strengths: string[] = [];
  const scoreParts: Array<{ label: string; points: number }> = [];
  const add = (label: string, points: number) => scoreParts.push({ label, points });
  add(`Readiness: ${passport.stageLabel}`, STAGE_POINTS[passport.stage]);

  if (requirements.sectors.length) {
    if (requirements.sectors.some((sector) => sameText(sector, input.sector))) {
      add("Sector matches", 10);
      strengths.push(`Sector: ${input.sector}`);
    } else gaps.push(input.sector ? `Sector is ${input.sector}, not ${requirements.sectors.join(" or ")}` : "Sector not captured");
  } else add("Any sector accepted", 5);

  if (requirements.provinces.length) {
    if (requirements.provinces.some((province) => sameText(province, input.province))) {
      add("Location matches", 10);
      strengths.push(`Based in ${input.province}`);
    } else gaps.push(input.province ? `Based in ${input.province}, not ${requirements.provinces.join(" or ")}` : "Province not captured");
  } else add("Any location accepted", 5);

  for (const raw of requirements.documents) {
    const kind = kindOf(raw);
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
    if (match.length) continue;
    const anyCurrent = kind ? currentDocsOfKind(input, kind).length > 0 : false;
    const label = kind ? kindLabel(kind) : raw;
    gaps.push(anyCurrent ? `${label} expires before the closing date` : `No current ${label}`);
  }

  if (requirements.requireCsd && !input.registrations.csdNumber) {
    gaps.push(csdGap(input.capability.csdRegistered));
  }

  if (requirements.maxBeeLevel !== null) {
    if (input.beeLevel === null) gaps.push(input.beeNonCompliant ? "Not B-BBEE compliant" : "B-BBEE level not captured");
    else if (input.beeLevel > requirements.maxBeeLevel) gaps.push(`B-BBEE level ${input.beeLevel}, needs level ${requirements.maxBeeLevel} or better`);
    else strengths.push(`B-BBEE level ${input.beeLevel}`);
  }

  (Object.keys(OWNERSHIP_LABEL) as Array<keyof typeof OWNERSHIP_LABEL>).forEach((key) => {
    const minimum = requirements.ownership[key];
    if (minimum === undefined || minimum === null) return;
    const actual = input.ownership[key];
    if (actual === null) gaps.push(`${OWNERSHIP_LABEL[key]} percentage not captured`);
    else if (actual < minimum) gaps.push(`${actual}% ${OWNERSHIP_LABEL[key]}, needs ${minimum}%`);
    else {
      strengths.push(`${actual}% ${OWNERSHIP_LABEL[key]}`);
      add(`${actual}% ${OWNERSHIP_LABEL[key]}`, 3);
    }
  });

  if (requirements.minStage && stageIndex(passport.stage) < stageIndex(requirements.minStage)) {
    gaps.push(`Readiness is ${passport.stageLabel}, needs ${STAGES.find((entry) => entry.key === requirements.minStage)!.label}`);
  }

  const risk = riskRank(input.risk?.level);
  if (risk === 0) add("Low risk", 5);
  else if (risk !== null && risk >= 2) add(`${input.risk?.level} risk`, -10);
  if (input.capability.capacity === true) strengths.push("Has capacity and equipment");
  if (input.capability.tradeReferences === true) strengths.push("Has trade references");

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

/** Eligible first, then by score; ties alphabetically so the order is stable. */
export const rankMatches = (matches: MatchResult[]) =>
  [...matches].sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.name.localeCompare(b.name)
  );

/* --------------------------------------------------------------- parsing */

/** "Level 2", "L2", 2 → 2; anything else → null. Level 5+ reads as its number. */
export function parseBeeLevel(value: unknown): number | null {
  const match = /([1-8])/.exec(clean(value));
  return match ? Number(match[1]) : null;
}

export const parsePercent = (value: unknown): number | null => {
  if (value === null || value === undefined || clean(value) === "") return null;
  const number = Number(String(value).replace("%", ""));
  return Number.isFinite(number) ? number : null;
};

export const yesNo = (answer: unknown): boolean | null => {
  const text = lower(answer);
  if (text === "yes") return true;
  if (text === "no") return false;
  return null;
};
