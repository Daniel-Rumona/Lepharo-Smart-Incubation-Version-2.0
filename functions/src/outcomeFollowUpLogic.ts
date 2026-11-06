// Pure decisions for outcome check-backs. No Firestore, no clock: everything
// takes its inputs so the rules can be tested without the emulator.

export const FACILITATOR_ANSWERS = ["not_yet", "partial", "achieved"] as const;
export const SME_ANSWERS = ["yes", "partly", "no"] as const;
export type FacilitatorAnswer = (typeof FACILITATOR_ANSWERS)[number];
export type SmeAnswer = (typeof SME_ANSWERS)[number];
export type Assessment = FacilitatorAnswer;

export const DEFAULT_FOLLOW_UP_DAYS = 60;
/** Reminders stop after this many; the HOD hears about it at ESCALATE_AT. */
export const MAX_REMINDERS = 4;
export const ESCALATE_AT = 3;
export const REMINDER_GAP_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const isFacilitatorAnswer = (value: unknown): value is FacilitatorAnswer =>
  FACILITATOR_ANSWERS.includes(value as FacilitatorAnswer);

export const isSmeAnswer = (value: unknown): value is SmeAnswer =>
  SME_ANSWERS.includes(value as SmeAnswer);

/** The moment an assignment became a confirmed, finished piece of work. */
export function isConfirmed(data: Record<string, any> | undefined | null): boolean {
  if (!data) return false;
  const participant = String(data.participantCompletionStatus ?? "").trim().toLowerCase();
  const status = String(data.assignmentStatus ?? "").trim().toLowerCase();
  return participant === "confirmed" || status === "completed";
}

export function followUpDays(outcomeDef: Record<string, any> | undefined | null): number {
  const days = Math.round(Number(outcomeDef?.followUpAfterDays));
  return Number.isFinite(days) && days >= 1 ? days : DEFAULT_FOLLOW_UP_DAYS;
}

export function dueAtFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

export type ReminderState = {
  status?: string;
  dueAt: Date | null;
  remindersSent?: number;
  lastRemindedAt: Date | null;
};

export function shouldRemind(state: ReminderState, now: Date): boolean {
  if (!state.dueAt || state.dueAt.getTime() > now.getTime()) return false;
  if (state.status === "answered" || state.status === "closed") return false;
  const sent = state.remindersSent ?? 0;
  if (sent >= MAX_REMINDERS) return false;
  if (sent === 0 || !state.lastRemindedAt) return true;
  return now.getTime() - state.lastRemindedAt.getTime() >= REMINDER_GAP_DAYS * DAY_MS;
}

/** Fires once, on the reminder that reaches the threshold. */
export const shouldEscalate = (remindersSentAfter: number) => remindersSentAfter === ESCALATE_AT;

export function smeToAssessment(answer: SmeAnswer): Assessment {
  return answer === "yes" ? "achieved" : answer === "partly" ? "partial" : "not_yet";
}

/**
 * Confidence is derived here, never chosen by a person. A facilitator's
 * assessment is `facilitator_verified`; it becomes `artefact_supported` only
 * when the deliverable is actually on file. An SME's own answer is always
 * `self_reported`. Nothing here can produce `system_observed`.
 */
export function deriveConfidence(input: {
  byRole: "facilitator" | "hod" | "sme";
  hasDeliverable: boolean;
}): "self_reported" | "facilitator_verified" | "artefact_supported" {
  if (input.byRole === "sme") return "self_reported";
  return input.hasDeliverable ? "artefact_supported" : "facilitator_verified";
}

const DELIVERABLE_TYPES = ["poe", "document", "evidence"];

/** Mirrors the client's classifyResource: legacy poe/document files are deliverables. */
export function hasDeliverableFile(resources: unknown): boolean {
  if (!Array.isArray(resources)) return false;
  return resources.some((item: any) => {
    if (!/^https?:\/\//i.test(String(item?.link ?? ""))) return false;
    const role = String(item?.role ?? "").trim().toLowerCase();
    if (role === "deliverable") return true;
    if (role === "other") return false;
    return DELIVERABLE_TYPES.includes(String(item?.type ?? "").trim().toLowerCase());
  });
}
