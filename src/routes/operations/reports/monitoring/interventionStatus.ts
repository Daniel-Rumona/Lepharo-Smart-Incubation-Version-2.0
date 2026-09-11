export type CanonicalInterventionStatus =
  | "assigned"
  | "in-progress"
  | "completed"
  | "declined"
  | "unknown";

export type InterventionLifecycleFields = {
  status?: unknown;
  interventionStatus?: unknown;
  assignmentStatus?: unknown;
  assigneeAcceptanceStatus?: unknown;
  participantAcceptanceStatus?: unknown;
  assigneeCompletionStatus?: unknown;
  participantCompletionStatus?: unknown;
  beneficiaryCompletionStatus?: unknown;
  completionStatus?: unknown;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

const isOneOf = (value: unknown, values: string[]) =>
  values.includes(normalize(value));

const DECLINED = ["declined", "rejected", "cancelled", "canceled"];
const COMPLETED = [
  "done",
  "completed",
  "complete",
  "confirmed",
  "closed",
  "finished",
  "finalized",
];
const ACCEPTED = ["accepted", "confirmed", "approved"];
const IN_PROGRESS = [
  "in-progress",
  "in progress",
  "ongoing",
  "active",
  "started",
  "running",
];
const ASSIGNED = [
  "assigned",
  "pending",
  "awaiting",
  "new",
  "queued",
  "approved",
];

/**
 * Derives the actual intervention lifecycle state.
 *
 * `assignmentStatus` is intentionally not treated as authoritative because it
 * commonly remains "assigned" after acceptance and completion are captured in
 * the dedicated lifecycle fields.
 */
export const getCanonicalInterventionStatus = (
  row: InterventionLifecycleFields
): CanonicalInterventionStatus => {
  const primaryStatuses = [
    normalize(row.status),
    normalize(row.interventionStatus),
    normalize(row.assignmentStatus),
  ].filter(Boolean);
  const assigneeAcceptance = normalize(row.assigneeAcceptanceStatus);
  const participantAcceptance = normalize(row.participantAcceptanceStatus);
  const assigneeCompletion = normalize(row.assigneeCompletionStatus);
  const participantCompletion = normalize(
    row.participantCompletionStatus || row.beneficiaryCompletionStatus
  );
  const completion = normalize(row.completionStatus);

  if (
    primaryStatuses.some((status) => isOneOf(status, DECLINED)) ||
    isOneOf(assigneeAcceptance, DECLINED) ||
    isOneOf(participantAcceptance, DECLINED) ||
    isOneOf(assigneeCompletion, DECLINED) ||
    isOneOf(participantCompletion, DECLINED) ||
    isOneOf(completion, DECLINED)
  ) {
    return "declined";
  }

  if (
    primaryStatuses.some((status) => isOneOf(status, COMPLETED)) ||
    isOneOf(completion, COMPLETED) ||
    isOneOf(participantCompletion, COMPLETED) ||
    (isOneOf(assigneeCompletion, COMPLETED) &&
      isOneOf(participantCompletion, COMPLETED))
  ) {
    return "completed";
  }

  if (
    primaryStatuses.some((status) => isOneOf(status, IN_PROGRESS)) ||
    isOneOf(assigneeCompletion, COMPLETED) ||
    isOneOf(assigneeAcceptance, ACCEPTED) ||
    isOneOf(participantAcceptance, ACCEPTED)
  ) {
    return "in-progress";
  }

  if (
    primaryStatuses.some((status) => isOneOf(status, ASSIGNED)) ||
    !primaryStatuses.length
  ) {
    return "assigned";
  }

  return "unknown";
};
