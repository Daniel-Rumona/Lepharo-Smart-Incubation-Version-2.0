/**
 * Which MOVs a head of department reviews on WhatsApp, and how each is described. Pure, so it can be
 * tested; whatsappMovReview.ts does the reads and writes. The rules follow the web MOV workspace
 * (src/routes/operations/movs): an MOV is "To review" for its department's HOD once the SME has
 * confirmed it and it is neither approved nor queried. SME delivery disputes stay on the web.
 */

const text = (value: unknown) => (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
const lower = (value: unknown) => text(value).toLowerCase();

export const QUERY_TYPES = ["poe-request", "mov-issue", "general-query"] as const;
export type QueryType = (typeof QUERY_TYPES)[number];
export const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  "poe-request": "Evidence (POE)",
  "mov-issue": "Session details",
  "general-query": "Something else",
};
export const MIN_QUERY_WORDS = 4;
export const MAX_QUERY_LENGTH = 1000;
export const MAX_LISTED = 10;

/** isSmeConfirmedMov in src/services/movService.ts. */
export const isSmeConfirmed = (mov: any): boolean =>
  !!mov?.confirmationOverride ||
  mov?.smmeAccepted === true ||
  ["confirmed", "accepted", "complete", "completed"].includes(lower(mov?.participantCompletionStatus)) ||
  !!mov?.smmeAcceptedAt ||
  !!mov?.smmeSignedAt;

/** hasMovEvidence in movData.ts; a signed Pre-Incubation Agreement counts as evidence. */
export const hasEvidence = (mov: any): boolean => {
  if (mov?.preIncubationAgreement === true || lower(mov?.verificationMethod) === "signed_preinc_agreement") return true;
  const links = Array.isArray(mov?.resources)
    ? mov.resources.map((r: any) => r?.link || r?.url || r?.href).filter((x: unknown) => typeof x === "string" && x.startsWith("http"))
    : [];
  const urls = [...(Array.isArray(mov?.poeUrls) ? mov.poeUrls : []), ...links].filter(Boolean);
  return urls.length > 0 || text(mov?.evidenceNotes).length > 0;
};

/** The web's "To review": confirmed by the SME, not approved, not queried. */
export const awaitingReview = (mov: any): boolean =>
  isSmeConfirmed(mov) && mov?.approvedByHod !== true && lower(mov?.status) !== "queried";

const CONTROL_DOMAIN = "@quantilytix.co.za";
const isControlEmail = (value: unknown) => lower(value).endsWith(CONTROL_DOMAIN);

/** containsControlEmail in src/utils/reportVisibility.ts: any "...email" field, at any depth. */
const containsControlEmail = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value === "string") return isControlEmail(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsControlEmail(item, seen));
  return Object.entries(value).some(([key, nested]) =>
    key.toLowerCase().includes("email") && typeof nested === "string" ? isControlEmail(nested) : containsControlEmail(nested, seen));
};

/** containsDummyMarker: an explicit isDummy / dummy flag, at any depth. */
const containsDummyMarker = (value: unknown, seen = new Set<object>()): boolean => {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsDummyMarker(item, seen));
  return Object.entries(value).some(([key, nested]) =>
    (["isdummy", "dummy"].includes(key.toLowerCase()) && nested === true) || containsDummyMarker(nested, seen));
};

/** Control (internal test) records are hidden from people outside the control domain, as filterMovRecords does on the web. */
export const hiddenFrom = (mov: any, viewerEmail: unknown): boolean =>
  !isControlEmail(viewerEmail) && (containsControlEmail(mov) || containsDummyMarker(mov));

export const smeName = (mov: any) => text(mov?.smmeCompanyName) || text(mov?.smmeName) || text(mov?.beneficiaryName) || "SME";

export type ReviewRow = {
  movId: string;
  sme: string;
  intervention: string;
  facilitator: string | null;
  evidence: boolean;
  /** The AI evidence check, when it found a problem: "weak", "missing" or "unreadable". */
  evidenceWarning: string | null;
  evidenceSummary: string | null;
  confirmedAt: number;
};

const millis = (value: any): number => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const reviewRow = (id: string, mov: any): ReviewRow => {
  const verdict = lower(mov?.evidenceCheck?.verdict);
  return {
    movId: id,
    sme: smeName(mov),
    intervention: text(mov?.interventionTitle) || "Intervention",
    facilitator: text(mov?.facilitatorName) || null,
    evidence: hasEvidence(mov),
    evidenceWarning: ["weak", "missing", "unreadable"].includes(verdict) ? verdict : null,
    evidenceSummary: text(mov?.evidenceCheck?.summary).slice(0, 300) || null,
    confirmedAt: millis(mov?.smmeAcceptedAt || mov?.smmeSignedAt || mov?.updatedAt),
  };
};

/** Oldest first: the MOVs that have waited longest. */
export const orderForReview = (rows: ReviewRow[]) => [...rows].sort((a, b) => (a.confirmedAt || Infinity) - (b.confirmedAt || Infinity));

/** The query text, or the reason it can't be sent. */
export const checkQueryMessage = (message: unknown): { message: string } | { problem: string } => {
  const cleaned = text(message).replace(/\s+/g, " ");
  if (cleaned.split(" ").filter(Boolean).length < MIN_QUERY_WORDS) return { problem: "query_too_short" };
  return { message: cleaned.slice(0, MAX_QUERY_LENGTH) };
};
