"use strict";
// Pure decisions for outcome check-backs. No Firestore, no clock: everything
// takes its inputs so the rules can be tested without the emulator.
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasDeliverableFile = exports.deriveConfidence = exports.smeToAssessment = exports.shouldEscalate = exports.shouldRemind = exports.dueAtFrom = exports.followUpDays = exports.isConfirmed = exports.isSmeAnswer = exports.isFacilitatorAnswer = exports.REMINDER_GAP_DAYS = exports.ESCALATE_AT = exports.MAX_REMINDERS = exports.DEFAULT_FOLLOW_UP_DAYS = exports.SME_ANSWERS = exports.FACILITATOR_ANSWERS = void 0;
exports.FACILITATOR_ANSWERS = ["not_yet", "partial", "achieved"];
exports.SME_ANSWERS = ["yes", "partly", "no"];
exports.DEFAULT_FOLLOW_UP_DAYS = 60;
/** Reminders stop after this many; the HOD hears about it at ESCALATE_AT. */
exports.MAX_REMINDERS = 4;
exports.ESCALATE_AT = 3;
exports.REMINDER_GAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const isFacilitatorAnswer = (value) => exports.FACILITATOR_ANSWERS.includes(value);
exports.isFacilitatorAnswer = isFacilitatorAnswer;
const isSmeAnswer = (value) => exports.SME_ANSWERS.includes(value);
exports.isSmeAnswer = isSmeAnswer;
/** The moment an assignment became a confirmed, finished piece of work. */
function isConfirmed(data) {
    if (!data)
        return false;
    const participant = String(data.participantCompletionStatus ?? "").trim().toLowerCase();
    const status = String(data.assignmentStatus ?? "").trim().toLowerCase();
    return participant === "confirmed" || status === "completed";
}
exports.isConfirmed = isConfirmed;
function followUpDays(outcomeDef) {
    const days = Math.round(Number(outcomeDef?.followUpAfterDays));
    return Number.isFinite(days) && days >= 1 ? days : exports.DEFAULT_FOLLOW_UP_DAYS;
}
exports.followUpDays = followUpDays;
function dueAtFrom(base, days) {
    return new Date(base.getTime() + days * DAY_MS);
}
exports.dueAtFrom = dueAtFrom;
function shouldRemind(state, now) {
    if (!state.dueAt || state.dueAt.getTime() > now.getTime())
        return false;
    if (state.status === "answered" || state.status === "closed")
        return false;
    const sent = state.remindersSent ?? 0;
    if (sent >= exports.MAX_REMINDERS)
        return false;
    if (sent === 0 || !state.lastRemindedAt)
        return true;
    return now.getTime() - state.lastRemindedAt.getTime() >= exports.REMINDER_GAP_DAYS * DAY_MS;
}
exports.shouldRemind = shouldRemind;
/** Fires once, on the reminder that reaches the threshold. */
const shouldEscalate = (remindersSentAfter) => remindersSentAfter === exports.ESCALATE_AT;
exports.shouldEscalate = shouldEscalate;
function smeToAssessment(answer) {
    return answer === "yes" ? "achieved" : answer === "partly" ? "partial" : "not_yet";
}
exports.smeToAssessment = smeToAssessment;
/**
 * Confidence is derived here, never chosen by a person. A facilitator's
 * assessment is `facilitator_verified`; it becomes `artefact_supported` only
 * when the deliverable is actually on file. An SME's own answer is always
 * `self_reported`. Nothing here can produce `system_observed`.
 */
function deriveConfidence(input) {
    if (input.byRole === "sme")
        return "self_reported";
    return input.hasDeliverable ? "artefact_supported" : "facilitator_verified";
}
exports.deriveConfidence = deriveConfidence;
const DELIVERABLE_TYPES = ["poe", "document", "evidence"];
/** Mirrors the client's classifyResource: legacy poe/document files are deliverables. */
function hasDeliverableFile(resources) {
    if (!Array.isArray(resources))
        return false;
    return resources.some((item) => {
        if (!/^https?:\/\//i.test(String(item?.link ?? "")))
            return false;
        const role = String(item?.role ?? "").trim().toLowerCase();
        if (role === "deliverable")
            return true;
        if (role === "other")
            return false;
        return DELIVERABLE_TYPES.includes(String(item?.type ?? "").trim().toLowerCase());
    });
}
exports.hasDeliverableFile = hasDeliverableFile;
//# sourceMappingURL=outcomeFollowUpLogic.js.map