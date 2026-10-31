/**
 * IPM reminders: what is outstanding in a performance cycle and whose move it
 * is. Pure functions only.
 *
 * outstandingActions mirrors the web app's copy in
 * src/routes/operations/hr/performance/ipm.ts (the HR dashboard lists the
 * same actions); ipmReminderLogic.test.cjs runs both over the same cases so
 * they cannot drift apart.
 */

export type PhaseKey = "midYear" | "yearEnd";
type DateWindow = { from: string; to: string };
export type IpmCycle = {
  id: string;
  label: string;
  status: string;
  startDate: string;
  endDate: string;
  windows: { compacting: DateWindow; midYear: DateWindow; yearEnd: DateWindow };
  reminders?: boolean;
};

type Signature = { uid?: string; at?: string } | null | undefined;
type Signoff = { manager?: Signature; employee?: Signature; hr?: Signature };
export type IpmReview = {
  selfSubmittedAt?: string | null;
  managerSubmittedAt?: string | null;
  dispute?: { resolution?: string } | null;
  signoff?: Signoff;
  calibration?: unknown;
  validation?: unknown;
};

export type ActionOwner = "employee" | "manager" | "hr" | "ceo";
export type ActionKind =
  | "assign-manager"
  | "compact-manager"
  | "compact-employee"
  | "compact-hr"
  | "check-in"
  | "book-review"
  | "self-assessment"
  | "manager-assessment"
  | "sign-review"
  | "dispute"
  | "calibrate"
  | "validate";

export type OutstandingAction = { kind: ActionKind; owner: ActionOwner; employeeUid: string; phase?: PhaseKey; overdue?: boolean };

export type EmployeeIpmState = {
  uid: string;
  lineManagerId?: string | null;
  compact?: { signoff?: Signoff } | null;
  checkInDates: string[];
  reviews: Partial<Record<PhaseKey, IpmReview>>;
};

const PHASES: PhaseKey[] = ["midYear", "yearEnd"];
const PHASE_LABELS: Record<PhaseKey, string> = { midYear: "mid-year review", yearEnd: "year-end review" };
export const CHECK_IN_DUE_DAYS = 14;
export const BOOK_REVIEW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (value: string) => Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((dayStart(to) - dayStart(from)) / DAY_MS);

function compactStatus(signoff: Signoff = {}) {
  if (signoff.hr && signoff.manager && signoff.employee) return "hr-checked";
  if (signoff.manager && signoff.employee) return "agreed";
  if (signoff.manager) return "awaiting-employee";
  if (signoff.employee) return "awaiting-manager";
  return "draft";
}

function reviewStage(review?: IpmReview | null) {
  if (!review) return "self";
  if (review.validation) return "validated";
  if (review.dispute && !review.dispute.resolution) return "disputed";
  if (review.signoff?.manager && review.signoff?.employee) return review.calibration ? "validation" : "calibration";
  if (review.managerSubmittedAt) return "discussion";
  if (review.selfSubmittedAt) return "manager";
  return "self";
}

function checkInDue(dates: string[], today: string) {
  const past = dates.filter(Boolean).map((d) => d.slice(0, 10)).filter((d) => d <= today).sort();
  if (!past.length) return true;
  return daysBetween(past[past.length - 1], today) >= CHECK_IN_DUE_DAYS;
}

export function outstandingActions(
  cycle: Pick<IpmCycle, "status" | "endDate" | "windows">,
  today: string,
  state: EmployeeIpmState
): OutstandingAction[] {
  const day = today.slice(0, 10);
  const uid = state.uid;
  if (cycle.status === "closed" || day < cycle.windows.compacting.from) return [];
  if (!state.lineManagerId) return [{ kind: "assign-manager", owner: "hr", employeeUid: uid }];

  const actions: OutstandingAction[] = [];
  const signoff = state.compact?.signoff || {};
  const status = compactStatus(signoff);
  const compactOverdue = day > cycle.windows.compacting.to;
  if (status === "draft" || status === "awaiting-manager") {
    return [{ kind: "compact-manager", owner: "manager", employeeUid: uid, overdue: compactOverdue }];
  }
  if (status === "awaiting-employee") {
    return [{ kind: "compact-employee", owner: "employee", employeeUid: uid, overdue: compactOverdue }];
  }
  if (status === "agreed") actions.push({ kind: "compact-hr", owner: "hr", employeeUid: uid });

  if (day <= cycle.endDate) {
    const agreedOn = [signoff.manager?.at, signoff.employee?.at].filter(Boolean).map((at) => String(at).slice(0, 10)).sort().pop();
    if (checkInDue([...state.checkInDates, ...(agreedOn ? [agreedOn] : [])], day)) {
      actions.push({ kind: "check-in", owner: "employee", employeeUid: uid });
      actions.push({ kind: "check-in", owner: "manager", employeeUid: uid });
    }
  }

  PHASES.forEach((phase) => {
    const window = cycle.windows[phase];
    const record = state.reviews[phase] || null;
    const stage = reviewStage(record);
    const until = daysBetween(day, window.from);
    if (until > 0) {
      if (until <= BOOK_REVIEW_DAYS && stage === "self") actions.push({ kind: "book-review", owner: "manager", employeeUid: uid, phase });
      return;
    }
    const overdue = day > window.to;
    const add = (kind: ActionKind, owner: ActionOwner) => actions.push({ kind, owner, employeeUid: uid, phase, overdue });
    if (stage === "self") {
      add("self-assessment", "employee");
      if (overdue) add("manager-assessment", "manager");
    } else if (stage === "manager") add("manager-assessment", "manager");
    else if (stage === "discussion") {
      if (!record?.signoff?.manager) add("sign-review", "manager");
      if (!record?.signoff?.employee) add("sign-review", "employee");
    } else if (stage === "disputed") add("dispute", "hr");
    else if (stage === "calibration") add("calibrate", "hr");
    else if (stage === "validation") add("validate", "ceo");
  });
  return actions;
}

/** A cycle needs reminders from compacting until its year-end window closes. */
export function cycleNeedsReminders(cycle: IpmCycle, today: string) {
  const day = today.slice(0, 10);
  const lastDay = [cycle.endDate, cycle.windows.yearEnd.to].sort().pop() as string;
  return cycle.reminders === true && cycle.status !== "closed" && day >= cycle.windows.compacting.from && day <= lastDay;
}

/** Monday of the ISO week, used to send each person at most one digest a week. */
export function weekKey(today: string) {
  const date = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export type Recipients = { hr: string[]; ceo: string[] };
export type DigestLine = { text: string; overdue: boolean; kind: ActionKind; phase?: PhaseKey };

/** Who receives an action: the employee, their line manager, or every HR / CEO user. */
export function recipientsOf(action: OutstandingAction, lineManagerId: string | null | undefined, people: Recipients) {
  if (action.owner === "employee") return [action.employeeUid];
  if (action.owner === "manager") return lineManagerId ? [lineManagerId] : [];
  return action.owner === "hr" ? people.hr : people.ceo;
}

/**
 * One line per action for the person who owns it. The employee's own items
 * read in the second person; others name the employee. HR and the CEO get
 * counts rather than a name per review.
 */
export function digestLines(
  actions: { action: OutstandingAction; recipient: string; cycleLabel: string }[],
  nameOf: (uid: string) => string
): Map<string, DigestLine[]> {
  const byRecipient = new Map<string, DigestLine[]>();
  const push = (uid: string, line: DigestLine) => byRecipient.set(uid, [...(byRecipient.get(uid) || []), line]);
  const counted = new Map<string, { recipient: string; kind: ActionKind; phase?: PhaseKey; cycleLabel: string; count: number; overdue: boolean }>();

  actions.forEach(({ action, recipient, cycleLabel }) => {
    const phase = action.phase ? PHASE_LABELS[action.phase] : "";
    const who = nameOf(action.employeeUid);
    const self = recipient === action.employeeUid;
    const overdue = !!action.overdue;
    if (action.owner === "hr" || action.owner === "ceo") {
      const key = `${recipient}|${cycleLabel}|${action.kind}|${action.phase || ""}`;
      const current = counted.get(key) || { recipient, kind: action.kind, phase: action.phase, cycleLabel, count: 0, overdue: false };
      current.count += 1;
      current.overdue = current.overdue || overdue;
      counted.set(key, current);
      return;
    }
    const text: Partial<Record<ActionKind, string>> = self
      ? {
          "compact-employee": `Sign your ${cycleLabel} performance compact`,
          "check-in": "Have a check-in with your line manager: none in the last two weeks",
          "self-assessment": `Complete your ${phase} self-assessment`,
          "sign-review": `Sign your ${phase}`,
        }
      : {
          "compact-manager": `Agree and sign ${who}'s ${cycleLabel} compact`,
          "check-in": `Check in with ${who}: none in the last two weeks`,
          "book-review": `Book ${who}'s ${phase} meeting: the window opens within a week`,
          "manager-assessment": `Complete ${who}'s ${phase} assessment`,
          "sign-review": `Sign ${who}'s ${phase}`,
        };
    const line = text[action.kind];
    if (line) push(recipient, { text: line, overdue, kind: action.kind, phase: action.phase });
  });

  counted.forEach(({ recipient, kind, phase, cycleLabel, count, overdue }) => {
    const reviews = `${count} ${phase ? PHASE_LABELS[phase] : "review"}${count === 1 ? "" : "s"}`;
    const text: Partial<Record<ActionKind, string>> = {
      "assign-manager": `${count} employee${count === 1 ? " has" : "s have"} no line manager (${cycleLabel})`,
      "compact-hr": `${count} agreed compact${count === 1 ? "" : "s"} to check (${cycleLabel})`,
      dispute: `${reviews} disputed: mediate (${cycleLabel})`,
      calibrate: `${reviews} signed and ready to calibrate (${cycleLabel})`,
      validate: `${reviews} calibrated and awaiting your validation (${cycleLabel})`,
    };
    const line = text[kind];
    if (line) push(recipient, { text: line, overdue, kind, phase });
  });
  return byRecipient;
}
