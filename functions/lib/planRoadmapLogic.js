"use strict";
// Pure decisions for implementation-plan roadmap check-ins. No Firestore, no
// clock: everything takes its inputs so the rules can be tested without the
// emulator.
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeProgress = exports.nextDueDate = exports.shouldEscalateMissedCheckIns = exports.checkInMissed = exports.checkInDue = exports.monthKey = exports.shouldEscalateMilestone = exports.reminderStage = exports.daysUntil = exports.isDone = exports.MILESTONE_STATUSES = exports.ESCALATE_AFTER_MISSED_CHECKINS = exports.ESCALATE_AFTER_OVERDUE_REMINDERS = exports.OVERDUE_GAP_DAYS = exports.UPCOMING_DAYS = void 0;
exports.UPCOMING_DAYS = 7;
/** Days between overdue nudges for the same milestone. */
exports.OVERDUE_GAP_DAYS = 3;
/** Overdue nudges to the HOD before the programme's project admin hears of it. */
exports.ESCALATE_AFTER_OVERDUE_REMINDERS = 3;
/** Consecutive monthly check-ins with no HOD response before escalating. */
exports.ESCALATE_AFTER_MISSED_CHECKINS = 2;
exports.MILESTONE_STATUSES = ["not_started", "in_progress", "at_risk", "blocked", "done"];
const DAY_MS = 24 * 60 * 60 * 1000;
const isDone = (status) => String(status ?? "").trim().toLowerCase() === "done";
exports.isDone = isDone;
/** Whole-day difference ignoring time of day (positive = due is in the future). */
function daysUntil(due, now) {
    const d = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
    const n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((d - n) / DAY_MS);
}
exports.daysUntil = daysUntil;
/** Which reminder (if any) this milestone should receive today. */
function reminderStage(m, now) {
    if (!m.dueAt || (0, exports.isDone)(m.status))
        return null;
    const days = daysUntil(m.dueAt, now);
    if (days > exports.UPCOMING_DAYS)
        return null;
    if (days > 0)
        return m.lastStage === "upcoming" ? null : "upcoming";
    if (days === 0)
        return m.lastStage === "due" ? null : "due";
    const gapOk = !m.lastRemindedAt || now.getTime() - m.lastRemindedAt.getTime() >= exports.OVERDUE_GAP_DAYS * DAY_MS;
    return gapOk ? "overdue" : null;
}
exports.reminderStage = reminderStage;
/** Escalate once, after enough overdue nudges have gone unanswered. */
function shouldEscalateMilestone(m, now) {
    if ((0, exports.isDone)(m.status) || !m.dueAt || m.escalatedAt)
        return false;
    return daysUntil(m.dueAt, now) < 0 && (m.overdueReminders ?? 0) >= exports.ESCALATE_AFTER_OVERDUE_REMINDERS;
}
exports.shouldEscalateMilestone = shouldEscalateMilestone;
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
exports.monthKey = monthKey;
/** Monthly check-in goes out on the first run of each new month. */
function checkInDue(lastCheckInMonth, now) {
    return (lastCheckInMonth ?? "") !== (0, exports.monthKey)(now);
}
exports.checkInDue = checkInDue;
/**
 * A check-in is "missed" when the HOD did not touch the roadmap between it
 * being sent and the next one going out.
 */
function checkInMissed(lastCheckInSentAt, lastHodUpdateAt) {
    if (!lastCheckInSentAt)
        return false;
    return !lastHodUpdateAt || lastHodUpdateAt.getTime() < lastCheckInSentAt.getTime();
}
exports.checkInMissed = checkInMissed;
function shouldEscalateMissedCheckIns(missed, alreadyEscalated) {
    return !alreadyEscalated && missed >= exports.ESCALATE_AFTER_MISSED_CHECKINS;
}
exports.shouldEscalateMissedCheckIns = shouldEscalateMissedCheckIns;
/** The next due date for a recurring milestone that was completed. */
function nextDueDate(due, recurrence) {
    if (recurrence === "weekly")
        return new Date(due.getTime() + 7 * DAY_MS);
    if (recurrence !== "monthly" && recurrence !== "quarterly")
        return null;
    const step = recurrence === "monthly" ? 1 : 3;
    const first = new Date(due.getFullYear(), due.getMonth() + step, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(due.getDate(), lastDay));
}
exports.nextDueDate = nextDueDate;
function summarizeProgress(items, now) {
    let done = 0;
    let overdue = 0;
    let atRisk = 0;
    for (const it of items) {
        const status = String(it.status ?? "").toLowerCase();
        if (status === "done") {
            done += 1;
            continue;
        }
        if (status === "at_risk" || status === "blocked")
            atRisk += 1;
        if (it.dueAt && daysUntil(it.dueAt, now) < 0)
            overdue += 1;
    }
    const total = items.length;
    return { total, done, overdue, atRisk, percentDone: total ? Math.round((done / total) * 100) : 0 };
}
exports.summarizeProgress = summarizeProgress;
//# sourceMappingURL=planRoadmapLogic.js.map