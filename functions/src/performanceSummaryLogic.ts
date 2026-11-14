import {
  compactStatus,
  digestLines,
  outstandingActions,
  recipientsOf,
  reviewStage,
  type EmployeeIpmState,
  type IpmCycle,
  type OutstandingAction,
  type PhaseKey,
} from "./ipmReminderLogic";

/**
 * The director's (CEO's) view of a performance cycle, for WhatsApp: where the organisation is and what is
 * waiting on them. Pure; whatsappPerformance.ts does the reads. What counts as outstanding comes from
 * ipmReminderLogic.outstandingActions, so this agrees with the reminder emails and the Performance page.
 */

export type Phase = "compacting" | "midYear" | "yearEnd";
export const PHASE_LABEL: Record<Phase, string> = { compacting: "Compacting", midYear: "Mid-year reviews", yearEnd: "Year-end reviews" };

/** A cycle is running from the start of compacting until its year-end window closes. */
export function isRunning(cycle: IpmCycle, today: string) {
  const day = today.slice(0, 10);
  const lastDay = [cycle.endDate, cycle.windows.yearEnd.to].sort().pop() as string;
  return cycle.status !== "closed" && day >= cycle.windows.compacting.from && day <= lastDay;
}

/** The window open today, or else the one that opened most recently. */
export function currentPhase(cycle: IpmCycle, today: string): { phase: Phase; open: boolean } {
  const day = today.slice(0, 10);
  const order: Phase[] = ["compacting", "midYear", "yearEnd"];
  const open = order.find((phase) => day >= cycle.windows[phase].from && day <= cycle.windows[phase].to);
  if (open) return { phase: open, open: true };
  const started = order.filter((phase) => day >= cycle.windows[phase].from);
  return { phase: started.length ? started[started.length - 1] : "compacting", open: false };
}

export type StaffState = EmployeeIpmState & { name: string };

export type PerformanceSummary = {
  cycle: string;
  phase: Phase;
  phaseOpen: boolean;
  phaseClosesOn: string;
  staff: number;
  noLineManager: number;
  compacts: { agreed: number; awaitingSignature: number; notStarted: number };
  /** For the review phase under way: how many reviews are at each step. */
  reviews: { phase: PhaseKey; notStarted: number; inProgress: number; awaitingCalibration: number; awaitingValidation: number; disputed: number; validated: number } | null;
  overdue: number;
  waitingOnYou: { text: string; overdue: boolean }[];
};

export function summarise(cycle: IpmCycle, today: string, staff: StaffState[], directorId: string): PerformanceSummary {
  const { phase, open } = currentPhase(cycle, today);
  const compacts = { agreed: 0, awaitingSignature: 0, notStarted: 0 };
  let noLineManager = 0;
  let overdue = 0;
  const queued: { action: OutstandingAction; recipient: string; cycleLabel: string }[] = [];
  const reviewPhase: PhaseKey | null = phase === "compacting" ? null : phase;
  const reviews = reviewPhase
    ? { phase: reviewPhase, notStarted: 0, inProgress: 0, awaitingCalibration: 0, awaitingValidation: 0, disputed: 0, validated: 0 }
    : null;

  for (const person of staff) {
    if (!person.lineManagerId) noLineManager += 1;
    const status = compactStatus(person.compact?.signoff || {});
    if (status === "agreed" || status === "hr-checked") compacts.agreed += 1;
    else if (status === "draft") compacts.notStarted += 1;
    else compacts.awaitingSignature += 1;

    if (reviews && reviewPhase) {
      const record = person.reviews[reviewPhase];
      const stage = reviewStage(record);
      if (!record) reviews.notStarted += 1;
      else if (stage === "validated") reviews.validated += 1;
      else if (stage === "validation") reviews.awaitingValidation += 1;
      else if (stage === "calibration") reviews.awaitingCalibration += 1;
      else if (stage === "disputed") reviews.disputed += 1;
      else reviews.inProgress += 1;
    }

    for (const action of outstandingActions(cycle, today, person)) {
      if (action.overdue) overdue += 1;
      if (recipientsOf(action, person.lineManagerId, { hr: [], ceo: [directorId] }).includes(directorId)) {
        queued.push({ action, recipient: directorId, cycleLabel: cycle.label });
      }
    }
  }

  const names = new Map(staff.map((person) => [person.uid, person.name]));
  const lines = digestLines(queued, (uid) => names.get(uid) || "a colleague").get(directorId) || [];
  return {
    cycle: cycle.label,
    phase,
    phaseOpen: open,
    phaseClosesOn: cycle.windows[phase].to,
    staff: staff.length,
    noLineManager,
    compacts,
    reviews,
    overdue,
    waitingOnYou: [...lines].sort((a, b) => Number(b.overdue) - Number(a.overdue)).map(({ text, overdue: late }) => ({ text, overdue: late })),
  };
}
