"use strict";
// Pure rules for the application audit trail and stalled-application
// escalation (applicationLifecycle.ts). No Firestore here so it can be unit
// tested (applicationLifecycleLogic.test.cjs).
Object.defineProperty(exports, "__esModule", { value: true });
exports.escalationStep = exports.REPEAT_EVERY_DAYS = exports.ESCALATE_AFTER_DAYS = exports.REMINDER_AFTER_DAYS = exports.pendingSince = exports.historyEntryFor = exports.normaliseStatus = void 0;
const clean = (value) => String(value ?? "").trim();
/** Same mapping as the Applications page: anything unrecognised is pending. */
function normaliseStatus(value) {
    const status = clean(value).toLowerCase();
    return status === "accepted" || status === "rejected" ? status : "pending";
}
exports.normaliseStatus = normaliseStatus;
/**
 * The audit entry for a write, or null when the status did not change.
 * A new application counts as a change from nothing to its first status.
 */
function historyEntryFor(before, after) {
    if (!after)
        return null;
    const toStatus = normaliseStatus(after.applicationStatus);
    const fromStatus = before ? normaliseStatus(before.applicationStatus) : null;
    if (fromStatus === toStatus)
        return null;
    // The decision record describes this change only if it names the same status.
    const decision = after.decision && normaliseStatus(after.decision.status) === toStatus ? after.decision : null;
    const decidedByUid = clean(decision?.decidedBy?.uid) || null;
    const decidedByEmail = clean(decision?.decidedBy?.email) || null;
    return {
        fromStatus,
        toStatus,
        decidedByUid,
        decidedByEmail,
        reason: clean(decision?.reason || (toStatus === "rejected" ? after.rejectionReason : "")) || null,
        reopenedFrom: clean(decision?.reopenedFrom) || null,
        source: decidedByUid || decidedByEmail ? "decision" : "system",
    };
}
exports.historyEntryFor = historyEntryFor;
const toDate = (value) => {
    if (!value)
        return null;
    if (typeof value.toDate === "function")
        return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
/**
 * When the application started waiting for a decision: the reopen time if a
 * decision was reopened, otherwise when it was submitted.
 */
function pendingSince(app) {
    if (normaliseStatus(app?.decision?.status) === "pending" && app?.decision?.reopenedFrom) {
        const reopened = toDate(app.decision.decidedAt);
        if (reopened)
            return reopened;
    }
    return toDate(app?.submittedAt) || toDate(app?.createdAt) || toDate(app?.appliedAt);
}
exports.pendingSince = pendingSince;
/** Days before a pending application gets a reminder, then is escalated to management. */
exports.REMINDER_AFTER_DAYS = 7;
exports.ESCALATE_AFTER_DAYS = 14;
/** After escalation, chase again this often until a decision is made. */
exports.REPEAT_EVERY_DAYS = 7;
/**
 * The step a pending application is in after `daysWaiting` whole days. Each
 * key is sent once (the caller keeps a ledger), so a run that is skipped
 * still catches up the next day without double-sending.
 */
function escalationStep(daysWaiting) {
    if (daysWaiting < exports.REMINDER_AFTER_DAYS)
        return null;
    if (daysWaiting < exports.ESCALATE_AFTER_DAYS)
        return { key: `reminder-${exports.REMINDER_AFTER_DAYS}`, level: "reminder" };
    const repeats = Math.floor((daysWaiting - exports.ESCALATE_AFTER_DAYS) / exports.REPEAT_EVERY_DAYS);
    return { key: `escalated-${exports.ESCALATE_AFTER_DAYS + repeats * exports.REPEAT_EVERY_DAYS}`, level: "escalated" };
}
exports.escalationStep = escalationStep;
//# sourceMappingURL=applicationLifecycleLogic.js.map