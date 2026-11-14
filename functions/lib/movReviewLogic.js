"use strict";
/**
 * Which MOVs a head of department reviews on WhatsApp, and how each is described. Pure, so it can be
 * tested; whatsappMovReview.ts does the reads and writes. The rules follow the web MOV workspace
 * (src/routes/operations/movs): an MOV is "To review" for its department's HOD once the SME has
 * confirmed it and it is neither approved nor queried. SME delivery disputes stay on the web.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkQueryMessage = exports.orderForReview = exports.reviewRow = exports.smeName = exports.hiddenFrom = exports.awaitingReview = exports.hasEvidence = exports.isSmeConfirmed = exports.MAX_LISTED = exports.MAX_QUERY_LENGTH = exports.MIN_QUERY_WORDS = exports.QUERY_TYPE_LABELS = exports.QUERY_TYPES = void 0;
const text = (value) => (value == null ? "" : String(value)).replace(/\s+/g, " ").trim();
const lower = (value) => text(value).toLowerCase();
exports.QUERY_TYPES = ["poe-request", "mov-issue", "general-query"];
exports.QUERY_TYPE_LABELS = {
    "poe-request": "Evidence (POE)",
    "mov-issue": "Session details",
    "general-query": "Something else",
};
exports.MIN_QUERY_WORDS = 4;
exports.MAX_QUERY_LENGTH = 1000;
exports.MAX_LISTED = 10;
/** isSmeConfirmedMov in src/services/movService.ts. */
const isSmeConfirmed = (mov) => !!mov?.confirmationOverride ||
    mov?.smmeAccepted === true ||
    ["confirmed", "accepted", "complete", "completed"].includes(lower(mov?.participantCompletionStatus)) ||
    !!mov?.smmeAcceptedAt ||
    !!mov?.smmeSignedAt;
exports.isSmeConfirmed = isSmeConfirmed;
/** hasMovEvidence in movData.ts; a signed Pre-Incubation Agreement counts as evidence. */
const hasEvidence = (mov) => {
    if (mov?.preIncubationAgreement === true || lower(mov?.verificationMethod) === "signed_preinc_agreement")
        return true;
    const links = Array.isArray(mov?.resources)
        ? mov.resources.map((r) => r?.link || r?.url || r?.href).filter((x) => typeof x === "string" && x.startsWith("http"))
        : [];
    const urls = [...(Array.isArray(mov?.poeUrls) ? mov.poeUrls : []), ...links].filter(Boolean);
    return urls.length > 0 || text(mov?.evidenceNotes).length > 0;
};
exports.hasEvidence = hasEvidence;
/** The web's "To review": confirmed by the SME, not approved, not queried. */
const awaitingReview = (mov) => (0, exports.isSmeConfirmed)(mov) && mov?.approvedByHod !== true && lower(mov?.status) !== "queried";
exports.awaitingReview = awaitingReview;
const CONTROL_DOMAIN = "@quantilytix.co.za";
const isControlEmail = (value) => lower(value).endsWith(CONTROL_DOMAIN);
/** containsControlEmail in src/utils/reportVisibility.ts: any "...email" field, at any depth. */
const containsControlEmail = (value, seen = new Set()) => {
    if (typeof value === "string")
        return isControlEmail(value);
    if (!value || typeof value !== "object" || seen.has(value))
        return false;
    seen.add(value);
    if (Array.isArray(value))
        return value.some((item) => containsControlEmail(item, seen));
    return Object.entries(value).some(([key, nested]) => key.toLowerCase().includes("email") && typeof nested === "string" ? isControlEmail(nested) : containsControlEmail(nested, seen));
};
/** containsDummyMarker: an explicit isDummy / dummy flag, at any depth. */
const containsDummyMarker = (value, seen = new Set()) => {
    if (!value || typeof value !== "object" || seen.has(value))
        return false;
    seen.add(value);
    if (Array.isArray(value))
        return value.some((item) => containsDummyMarker(item, seen));
    return Object.entries(value).some(([key, nested]) => (["isdummy", "dummy"].includes(key.toLowerCase()) && nested === true) || containsDummyMarker(nested, seen));
};
/** Control (internal test) records are hidden from people outside the control domain, as filterMovRecords does on the web. */
const hiddenFrom = (mov, viewerEmail) => !isControlEmail(viewerEmail) && (containsControlEmail(mov) || containsDummyMarker(mov));
exports.hiddenFrom = hiddenFrom;
const smeName = (mov) => text(mov?.smmeCompanyName) || text(mov?.smmeName) || text(mov?.beneficiaryName) || "SME";
exports.smeName = smeName;
const millis = (value) => {
    if (!value)
        return 0;
    if (typeof value.toMillis === "function")
        return value.toMillis();
    if (value instanceof Date)
        return value.getTime();
    if (typeof value === "number")
        return value;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
};
const reviewRow = (id, mov) => {
    const verdict = lower(mov?.evidenceCheck?.verdict);
    return {
        movId: id,
        sme: (0, exports.smeName)(mov),
        intervention: text(mov?.interventionTitle) || "Intervention",
        facilitator: text(mov?.facilitatorName) || null,
        evidence: (0, exports.hasEvidence)(mov),
        evidenceWarning: ["weak", "missing", "unreadable"].includes(verdict) ? verdict : null,
        evidenceSummary: text(mov?.evidenceCheck?.summary).slice(0, 300) || null,
        confirmedAt: millis(mov?.smmeAcceptedAt || mov?.smmeSignedAt || mov?.updatedAt),
    };
};
exports.reviewRow = reviewRow;
/** Oldest first: the MOVs that have waited longest. */
const orderForReview = (rows) => [...rows].sort((a, b) => (a.confirmedAt || Infinity) - (b.confirmedAt || Infinity));
exports.orderForReview = orderForReview;
/** The query text, or the reason it can't be sent. */
const checkQueryMessage = (message) => {
    const cleaned = text(message).replace(/\s+/g, " ");
    if (cleaned.split(" ").filter(Boolean).length < exports.MIN_QUERY_WORDS)
        return { problem: "query_too_short" };
    return { message: cleaned.slice(0, exports.MAX_QUERY_LENGTH) };
};
exports.checkQueryMessage = checkQueryMessage;
//# sourceMappingURL=movReviewLogic.js.map