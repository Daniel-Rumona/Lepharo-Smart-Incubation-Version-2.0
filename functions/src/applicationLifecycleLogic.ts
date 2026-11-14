// Pure rules for the application audit trail and stalled-application
// escalation (applicationLifecycle.ts). No Firestore here so it can be unit
// tested (applicationLifecycleLogic.test.cjs).

export type ApplicationStatus = "pending" | "accepted" | "rejected";

const clean = (value: unknown) => String(value ?? "").trim();

/** Same mapping as the Applications page: anything unrecognised is pending. */
export function normaliseStatus(value: unknown): ApplicationStatus {
  const status = clean(value).toLowerCase();
  return status === "accepted" || status === "rejected" ? status : "pending";
}

export type HistoryEntry = {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  decidedByUid: string | null;
  decidedByEmail: string | null;
  reason: string | null;
  reopenedFrom: string | null;
  /** "decision" when the Applications page recorded who decided; otherwise "system" (onboarding, imports, scripts). */
  source: "decision" | "system";
};

/**
 * The audit entry for a write, or null when the status did not change.
 * A new application counts as a change from nothing to its first status.
 */
export function historyEntryFor(before: any, after: any): HistoryEntry | null {
  if (!after) return null;
  const toStatus = normaliseStatus(after.applicationStatus);
  const fromStatus = before ? normaliseStatus(before.applicationStatus) : null;
  if (fromStatus === toStatus) return null;

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

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * When the application started waiting for a decision: the reopen time if a
 * decision was reopened, otherwise when it was submitted.
 */
export function pendingSince(app: any): Date | null {
  if (normaliseStatus(app?.decision?.status) === "pending" && app?.decision?.reopenedFrom) {
    const reopened = toDate(app.decision.decidedAt);
    if (reopened) return reopened;
  }
  return toDate(app?.submittedAt) || toDate(app?.createdAt) || toDate(app?.appliedAt);
}

/** Days before a pending application gets a reminder, then is escalated to management. */
export const REMINDER_AFTER_DAYS = 7;
export const ESCALATE_AFTER_DAYS = 14;
/** After escalation, chase again this often until a decision is made. */
export const REPEAT_EVERY_DAYS = 7;

export type EscalationStep = { key: string; level: "reminder" | "escalated" };

/**
 * The step a pending application is in after `daysWaiting` whole days. Each
 * key is sent once (the caller keeps a ledger), so a run that is skipped
 * still catches up the next day without double-sending.
 */
export function escalationStep(daysWaiting: number): EscalationStep | null {
  if (daysWaiting < REMINDER_AFTER_DAYS) return null;
  if (daysWaiting < ESCALATE_AFTER_DAYS) return { key: `reminder-${REMINDER_AFTER_DAYS}`, level: "reminder" };
  const repeats = Math.floor((daysWaiting - ESCALATE_AFTER_DAYS) / REPEAT_EVERY_DAYS);
  return { key: `escalated-${ESCALATE_AFTER_DAYS + repeats * REPEAT_EVERY_DAYS}`, level: "escalated" };
}
