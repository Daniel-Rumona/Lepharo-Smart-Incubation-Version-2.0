/**
 * SME risk score: the single formula behind the SME Risk Register (browser) and the
 * nightly early-warning job (smeRiskScoring.ts). No imports, so both sides and the
 * tests in smeRiskLogic.test.cjs use the very same code.
 *
 * The first block of inputs is the register's original formula, unchanged. The
 * early-warning signals are optional and default to zero, so a caller that does not
 * supply them gets exactly the register's score.
 */

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type RiskScoreInputs = {
  daysSinceLastService: number | null;
  hasNeverReceivedService: boolean;
  docsMissing: number;
  docsQueried: number;
  docsRejected: number;
  missingDepartmentsCount: number;
  smePendingAcceptanceCount: number;
  smePendingConfirmationCount: number;
  declinedTouches: number;
  /** Early-warning signals, worked out by the nightly job. */
  missedAppointments?: number;
  declinedAppointments?: number;
  overdueInterventions?: number;
  expiredComplianceDocs?: number;
  /** Percentage fall in average monthly revenue, last 3 months against the 3 before. */
  revenueDropPercent?: number | null;
  overdueFollowUps?: number;
  openQueries?: number;
  emailBounced?: boolean;
  poorFeedbackCount?: number;
};

export type RiskDriverKey =
  | "inactivity"
  | "documents"
  | "departments"
  | "unresponsive"
  | "declines"
  | "appointments"
  | "overdue"
  | "expired"
  | "revenue"
  | "followUps"
  | "queries"
  | "bounced"
  | "feedback";

export type RiskBreakdownItem = { label: string; delta: number; key?: RiskDriverKey };

export type RiskScoreResult = {
  score: number;
  level: RiskLevel;
  breakdown: RiskBreakdownItem[];
};

// Values for the original formula are unchanged from the register.
export const RISK_SCORE_WEIGHTS = {
  neverReceivedService: 85,
  unknownLastService: 70,
  inactive6Months: 80,
  inactive3Months: 65,
  inactive1Month: 45,
  recentlyServiced: 15,
  missingDocPerItem: 4,
  missingDocCap: 12,
  queriedDocPerItem: 3,
  queriedDocCap: 9,
  rejectedDocPerItem: 4,
  rejectedDocCap: 12,
  missingDeptPerItem: 5,
  missingDeptCap: 15,
  unresponsivePerItem: 8,
  unresponsiveCap: 24,
  unresponsiveThresholdCount: 3,
  unresponsiveThresholdFloor: 85,
  repeatDeclinePenalty: 8,
  repeatDeclineThreshold: 2,
  // Early-warning signals.
  missedAppointmentPerItem: 6,
  missedAppointmentCap: 18,
  declinedAppointmentPerItem: 3,
  declinedAppointmentCap: 9,
  overdueInterventionPerItem: 4,
  overdueInterventionCap: 12,
  expiredDocPerItem: 5,
  expiredDocCap: 15,
  revenueDropThreshold: 25,
  revenueDropPenalty: 10,
  revenueSevereDropThreshold: 50,
  revenueSevereDropPenalty: 15,
  overdueFollowUpPerItem: 4,
  overdueFollowUpCap: 8,
  openQueryPerItem: 3,
  openQueryCap: 9,
  emailBouncedPenalty: 6,
  poorFeedbackPerItem: 4,
  poorFeedbackCap: 8,
} as const;

const W = RISK_SCORE_WEIGHTS;

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

export const RISK_LEVEL_RANK: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function computeRiskScore(input: RiskScoreInputs): RiskScoreResult {
  const breakdown: RiskBreakdownItem[] = [];
  let score: number;

  if (input.hasNeverReceivedService) {
    score = W.neverReceivedService;
    breakdown.push({ label: "Never received an expected service", delta: score, key: "inactivity" });
  } else if (input.daysSinceLastService === null) {
    score = W.unknownLastService;
    breakdown.push({ label: "Last service date unknown", delta: score, key: "inactivity" });
  } else if (input.daysSinceLastService >= 180) {
    score = W.inactive6Months;
    breakdown.push({ label: "No service in 6+ months", delta: score, key: "inactivity" });
  } else if (input.daysSinceLastService >= 90) {
    score = W.inactive3Months;
    breakdown.push({ label: "No service in 3+ months", delta: score, key: "inactivity" });
  } else if (input.daysSinceLastService >= 30) {
    score = W.inactive1Month;
    breakdown.push({ label: "No service in 1+ month", delta: score, key: "inactivity" });
  } else {
    score = W.recentlyServiced;
    breakdown.push({ label: "Recently serviced", delta: score, key: "inactivity" });
  }

  const add = (delta: number, label: string, key: RiskDriverKey) => {
    if (delta <= 0) return;
    score += delta;
    breakdown.push({ label, delta, key });
  };

  add(Math.min(input.docsMissing * W.missingDocPerItem, W.missingDocCap), `${input.docsMissing} missing document(s)`, "documents");
  add(Math.min(input.docsQueried * W.queriedDocPerItem, W.queriedDocCap), `${input.docsQueried} queried document(s)`, "documents");
  add(Math.min(input.docsRejected * W.rejectedDocPerItem, W.rejectedDocCap), `${input.docsRejected} rejected document(s)`, "documents");
  add(
    Math.min(input.missingDepartmentsCount * W.missingDeptPerItem, W.missingDeptCap),
    `${input.missingDepartmentsCount} department(s) needing follow-up`,
    "departments"
  );

  const unresponsiveCount = input.smePendingAcceptanceCount + input.smePendingConfirmationCount;
  add(
    Math.min(unresponsiveCount * W.unresponsivePerItem, W.unresponsiveCap),
    `${unresponsiveCount} intervention(s) awaiting SME response`,
    "unresponsive"
  );

  if (unresponsiveCount >= W.unresponsiveThresholdCount && score < W.unresponsiveThresholdFloor) {
    breakdown.push({ label: "SME responsiveness threshold reached", delta: W.unresponsiveThresholdFloor - score, key: "unresponsive" });
    score = W.unresponsiveThresholdFloor;
  }

  if (input.declinedTouches >= W.repeatDeclineThreshold) {
    add(W.repeatDeclinePenalty, `${input.declinedTouches} declined intervention(s)`, "declines");
  }

  const missed = input.missedAppointments || 0;
  add(Math.min(missed * W.missedAppointmentPerItem, W.missedAppointmentCap), `Missed ${plural(missed, "appointment")} in the last 90 days`, "appointments");
  const declinedAppointments = input.declinedAppointments || 0;
  add(
    Math.min(declinedAppointments * W.declinedAppointmentPerItem, W.declinedAppointmentCap),
    `Declined ${plural(declinedAppointments, "appointment")} in the last 90 days`,
    "appointments"
  );
  const overdue = input.overdueInterventions || 0;
  add(Math.min(overdue * W.overdueInterventionPerItem, W.overdueInterventionCap), `${plural(overdue, "intervention")} past due date`, "overdue");
  const expired = input.expiredComplianceDocs || 0;
  add(Math.min(expired * W.expiredDocPerItem, W.expiredDocCap), `${plural(expired, "compliance document")} expired`, "expired");

  const drop = input.revenueDropPercent ?? null;
  if (drop !== null && drop >= W.revenueSevereDropThreshold) {
    add(W.revenueSevereDropPenalty, `Revenue down ${Math.round(drop)}% on the previous quarter`, "revenue");
  } else if (drop !== null && drop >= W.revenueDropThreshold) {
    add(W.revenueDropPenalty, `Revenue down ${Math.round(drop)}% on the previous quarter`, "revenue");
  }

  const followUps = input.overdueFollowUps || 0;
  add(Math.min(followUps * W.overdueFollowUpPerItem, W.overdueFollowUpCap), `${plural(followUps, "outcome check-back")} overdue`, "followUps");
  const queries = input.openQueries || 0;
  add(Math.min(queries * W.openQueryPerItem, W.openQueryCap), `${plural(queries, "open query", "open queries")} or disputes`, "queries");
  if (input.emailBounced) add(W.emailBouncedPenalty, "Emails to this SME are bouncing", "bounced");
  const poor = input.poorFeedbackCount || 0;
  add(Math.min(poor * W.poorFeedbackPerItem, W.poorFeedbackCap), `${plural(poor, "low feedback rating")} on recent support`, "feedback");

  if (score > 100) {
    breakdown.push({ label: "Capped at 100", delta: 100 - score });
    score = 100;
  }

  return { score, level: getRiskLevel(score), breakdown };
}

/* --------------------------------------------------------- early-warning rules */

export type RiskTrend = "new" | "up" | "down" | "same";

export function riskTrend(previousScore: number | null | undefined, score: number): RiskTrend {
  if (previousScore === null || previousScore === undefined) return "new";
  if (score >= previousScore + 5) return "up";
  if (score <= previousScore - 5) return "down";
  return "same";
}

/** Alert only when an SME moves up into High or Critical, so a steady state never re-alerts. */
export function shouldAlert(previousLevel: RiskLevel | null | undefined, level: RiskLevel): boolean {
  if (RISK_LEVEL_RANK[level] < RISK_LEVEL_RANK.High) return false;
  if (!previousLevel) return true;
  return RISK_LEVEL_RANK[level] > RISK_LEVEL_RANK[previousLevel];
}

export type RiskSuggestion = {
  driver: RiskDriverKey;
  /** Department role best placed to act (keys of systemSettings/departmentRoles), or null for the SME's coordinator. */
  departmentRole: string | null;
  text: string;
};

const SUGGESTIONS: Record<RiskDriverKey, Omit<RiskSuggestion, "driver">> = {
  inactivity: { departmentRole: null, text: "Book a check-in session and agree the next intervention." },
  documents: { departmentRole: "financialCompliance", text: "Send a compliance reminder and offer help with the outstanding documents." },
  expired: { departmentRole: "financialCompliance", text: "Send a compliance reminder for the expired documents." },
  departments: { departmentRole: null, text: "Ask the departments still to confirm the development plan to do so." },
  unresponsive: { departmentRole: null, text: "Call the SME about the interventions waiting on their response." },
  declines: { departmentRole: null, text: "Meet the SME to understand why support keeps being declined." },
  appointments: { departmentRole: null, text: "Call the SME about missed sessions and rebook at a time that suits them." },
  overdue: { departmentRole: null, text: "Review the overdue interventions with their consultants and set new dates." },
  revenue: { departmentRole: "inhouseFinance", text: "Arrange a finance review of the revenue drop." },
  followUps: { departmentRole: "monitoring", text: "Complete the overdue outcome check-backs." },
  queries: { departmentRole: null, text: "Resolve the open queries and disputes with the SME." },
  bounced: { departmentRole: null, text: "Get a working email address for the SME; reminders aren't reaching them." },
  feedback: { departmentRole: null, text: "Follow up on the low feedback ratings with the SME." },
};

/** The single most useful next step, taken from the biggest driver other than the inactivity baseline when there is one. */
export function suggestNextStep(result: RiskScoreResult): RiskSuggestion | null {
  const drivers = result.breakdown.filter((item) => item.key && item.delta > 0);
  if (!drivers.length) return null;
  const nonBaseline = drivers.filter((item) => item.key !== "inactivity");
  const pick = (nonBaseline.length ? nonBaseline : drivers).sort((a, b) => b.delta - a.delta)[0];
  if (pick.key === "inactivity" && result.score < 45) return null;
  const key = pick.key as RiskDriverKey;
  return { driver: key, ...SUGGESTIONS[key] };
}

/** Percentage fall from the earlier window's average to the later window's; null without enough months. */
export function revenueDropPercent(monthly: { month: string; revenue: number }[]): number | null {
  const sorted = monthly
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && Number.isFinite(row.revenue))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length < 4) return null;
  const recent = sorted.slice(-3);
  const before = sorted.slice(-6, -3);
  const average = (rows: { revenue: number }[]) => rows.reduce((sum, row) => sum + row.revenue, 0) / rows.length;
  const previous = average(before);
  if (previous <= 0) return null;
  const drop = ((previous - average(recent)) / previous) * 100;
  return drop > 0 ? Math.round(drop) : 0;
}

/* ---------------------------------------------------- inputs from raw records */

export type RiskRecords = {
  assignments: any[];
  appointments: any[];
  monthlyRevenue: { month: string; revenue: number }[];
  followUps: any[];
  openQueries: number;
  emailBounced: boolean;
  compliance: { missing: number; queried: number; rejected: number; expired: number };
};

const DAY = 24 * 60 * 60 * 1000;
const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();

const asTime = (value: any): number | null => {
  if (!value) return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

const isClosedAssignment = (row: any) =>
  ["cancelled", "declined", "needs reassignment", "needs-reassignment"].includes(norm(row.assignmentStatus));
const assigneeDone = (row: any) => ["done", "complete", "completed"].includes(norm(row.assigneeCompletionStatus));
const smeConfirmed = (row: any) => ["confirmed", "done", "completed"].includes(norm(row.participantCompletionStatus));
const smeAcceptance = (row: any) => {
  const status = norm(row.participantAcceptanceStatus);
  if (status === "accepted" || status === "confirmed") return "accepted";
  if (status === "declined" || status === "rejected") return "declined";
  return "pending";
};

/**
 * Works out the score inputs for one SME from its raw records. Mirrors the register's
 * reading of assignments: service dates come from completed work and attended
 * sessions; "waiting on the SME" is an unanswered assignment or an unconfirmed
 * completion. The register's department follow-up count needs the diagnostic plan
 * walk and is left at zero here.
 */
export function deriveRiskInputs(records: RiskRecords, now: number): RiskScoreInputs {
  const active = records.assignments.filter((row) => !isClosedAssignment(row));

  const serviceTimes: number[] = [];
  for (const row of records.assignments) {
    for (const value of [row.assigneeCompletedAt, row.completedAt]) {
      const time = asTime(value);
      if (time && time <= now) serviceTimes.push(time);
    }
  }
  for (const appointment of records.appointments) {
    if (norm(appointment.attendance?.status) !== "attended") continue;
    const time = asTime(appointment.attendance?.checkedInAt) ?? asTime(appointment.completedAt);
    if (time && time <= now) serviceTimes.push(time);
  }
  const lastService = serviceTimes.length ? Math.max(...serviceTimes) : null;

  const pendingAcceptance = active.filter(
    (row) => smeAcceptance(row) === "pending" && norm(row.assigneeAcceptanceStatus) !== "declined"
  ).length;
  const pendingConfirmation = active.filter((row) => assigneeDone(row) && !smeConfirmed(row)).length;
  const declined = records.assignments.filter((row) => smeAcceptance(row) === "declined").length;
  const overdue = active.filter((row) => {
    const due = asTime(row.dueDate);
    return due !== null && due < now && !(assigneeDone(row) && smeConfirmed(row));
  }).length;

  const since = now - 90 * DAY;
  const recentAppointments = records.appointments.filter((appointment) => {
    const time = asTime(appointment.startAt) ?? asTime(appointment.createdAt);
    return time !== null && time >= since && time <= now;
  });
  const missed = recentAppointments.filter((appointment) => norm(appointment.attendance?.status) === "absent").length;
  const declinedAppointments = recentAppointments.filter((appointment) => norm(appointment.smeConfirmation) === "declined").length;

  const overdueFollowUps = records.followUps.filter((followUp) => {
    const due = asTime(followUp.dueAt);
    return due !== null && due < now && !followUp.answer && !["answered", "closed", "cancelled"].includes(norm(followUp.status));
  }).length;

  const poorFeedback = records.assignments.filter((row) => {
    const rating = Number(row.feedback?.rating);
    const at = asTime(row.feedback?.submittedAt) ?? asTime(row.completedAt) ?? asTime(row.updatedAt);
    return Number.isFinite(rating) && rating > 0 && rating <= 2 && (at === null || at >= now - 180 * DAY);
  }).length;

  return {
    daysSinceLastService: lastService === null ? null : Math.floor((now - lastService) / DAY),
    hasNeverReceivedService: lastService === null && records.assignments.length > 0,
    docsMissing: records.compliance.missing,
    docsQueried: records.compliance.queried,
    docsRejected: records.compliance.rejected,
    missingDepartmentsCount: 0,
    smePendingAcceptanceCount: pendingAcceptance,
    smePendingConfirmationCount: pendingConfirmation,
    declinedTouches: declined,
    missedAppointments: missed,
    declinedAppointments,
    overdueInterventions: overdue,
    expiredComplianceDocs: records.compliance.expired,
    revenueDropPercent: revenueDropPercent(records.monthlyRevenue),
    overdueFollowUps,
    openQueries: records.openQueries,
    emailBounced: records.emailBounced,
    poorFeedbackCount: poorFeedback,
  };
}
