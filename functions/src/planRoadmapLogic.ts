// Pure decisions for implementation-plan roadmap check-ins. No Firestore, no
// clock: everything takes its inputs so the rules can be tested without the
// emulator.

export const UPCOMING_DAYS = 7;
/** Days between overdue nudges for the same milestone. */
export const OVERDUE_GAP_DAYS = 3;
/** Overdue nudges to the HOD before the programme's project admin hears of it. */
export const ESCALATE_AFTER_OVERDUE_REMINDERS = 3;
/** Consecutive monthly check-ins with no HOD response before escalating. */
export const ESCALATE_AFTER_MISSED_CHECKINS = 2;

export const MILESTONE_STATUSES = ["not_started", "in_progress", "at_risk", "blocked", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export type ReminderStage = "upcoming" | "due" | "overdue";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MilestoneState {
  status?: string;
  dueAt: Date | null;
  recurrence?: string;
  lastStage?: string | null;
  lastRemindedAt?: Date | null;
  overdueReminders?: number;
  escalatedAt?: Date | null;
}

export const isDone = (status: unknown) => String(status ?? "").trim().toLowerCase() === "done";

/** Whole-day difference ignoring time of day (positive = due is in the future). */
export function daysUntil(due: Date, now: Date): number {
  const d = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - n) / DAY_MS);
}

/** Which reminder (if any) this milestone should receive today. */
export function reminderStage(m: MilestoneState, now: Date): ReminderStage | null {
  if (!m.dueAt || isDone(m.status)) return null;
  const days = daysUntil(m.dueAt, now);
  if (days > UPCOMING_DAYS) return null;
  if (days > 0) return m.lastStage === "upcoming" ? null : "upcoming";
  if (days === 0) return m.lastStage === "due" ? null : "due";
  const gapOk = !m.lastRemindedAt || now.getTime() - m.lastRemindedAt.getTime() >= OVERDUE_GAP_DAYS * DAY_MS;
  return gapOk ? "overdue" : null;
}

/** Escalate once, after enough overdue nudges have gone unanswered. */
export function shouldEscalateMilestone(m: MilestoneState, now: Date): boolean {
  if (isDone(m.status) || !m.dueAt || m.escalatedAt) return false;
  return daysUntil(m.dueAt, now) < 0 && (m.overdueReminders ?? 0) >= ESCALATE_AFTER_OVERDUE_REMINDERS;
}

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Monthly check-in goes out on the first run of each new month. */
export function checkInDue(lastCheckInMonth: string | null | undefined, now: Date): boolean {
  return (lastCheckInMonth ?? "") !== monthKey(now);
}

/**
 * A check-in is "missed" when the HOD did not touch the roadmap between it
 * being sent and the next one going out.
 */
export function checkInMissed(lastCheckInSentAt: Date | null, lastHodUpdateAt: Date | null): boolean {
  if (!lastCheckInSentAt) return false;
  return !lastHodUpdateAt || lastHodUpdateAt.getTime() < lastCheckInSentAt.getTime();
}

export function shouldEscalateMissedCheckIns(missed: number, alreadyEscalated: boolean): boolean {
  return !alreadyEscalated && missed >= ESCALATE_AFTER_MISSED_CHECKINS;
}

/** The next due date for a recurring milestone that was completed. */
export function nextDueDate(due: Date, recurrence: string): Date | null {
  if (recurrence === "weekly") return new Date(due.getTime() + 7 * DAY_MS);
  if (recurrence !== "monthly" && recurrence !== "quarterly") return null;
  const step = recurrence === "monthly" ? 1 : 3;
  const first = new Date(due.getFullYear(), due.getMonth() + step, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(due.getDate(), lastDay));
}

export interface ProgressSummary {
  total: number;
  done: number;
  overdue: number;
  atRisk: number;
  percentDone: number;
}

export function summarizeProgress(items: { status?: string; dueAt: Date | null }[], now: Date): ProgressSummary {
  let done = 0;
  let overdue = 0;
  let atRisk = 0;
  for (const it of items) {
    const status = String(it.status ?? "").toLowerCase();
    if (status === "done") { done += 1; continue; }
    if (status === "at_risk" || status === "blocked") atRisk += 1;
    if (it.dueAt && daysUntil(it.dueAt, now) < 0) overdue += 1;
  }
  const total = items.length;
  return { total, done, overdue, atRisk, percentDone: total ? Math.round((done / total) * 100) : 0 };
}
