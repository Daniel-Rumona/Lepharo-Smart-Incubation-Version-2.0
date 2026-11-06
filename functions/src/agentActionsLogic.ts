/**
 * Pure rules for the web assistant's write actions (no Firebase imports, so the
 * tests in agentActionsLogic.test.cjs run without emulators).
 */

export type AgentKind =
  | "send_nudge"
  | "send_compliance_reminder"
  | "create_task"
  | "schedule_appointment"
  | "assign_intervention";

type RoleGroupName = "system_admin" | "director" | "hod" | "coordinator" | "receptionist" | "employee" | "external" | "unknown";

/** Who may run each action. Mirrors ROLE_ALLOWED_PROPOSALS in ai-backend/agent_proposals.py, but this list is the one enforced. */
export const KIND_ROLE_GROUPS: Record<AgentKind, RoleGroupName[]> = {
  send_nudge: ["system_admin", "director", "hod", "coordinator"],
  send_compliance_reminder: ["system_admin", "hod", "coordinator"],
  create_task: ["system_admin", "director", "hod", "coordinator"],
  schedule_appointment: ["hod", "coordinator", "employee"],
  assign_intervention: ["hod", "coordinator"],
};

export const MAX_RECIPIENTS = 50;

const clean = (value: unknown) => String(value ?? "").trim();

export const shortText = (value: unknown, max: number) => clean(value).replace(/\s+/g, " ").slice(0, max);

/** Distinct document ids, at most MAX_RECIPIENTS; anything path-like is dropped. */
export function cleanIdList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const ids = list
    .map((item) => clean(item))
    .filter((item) => item && item.length <= 200 && !item.includes("/"));
  return Array.from(new Set(ids)).slice(0, MAX_RECIPIENTS);
}

export function validDate(value: unknown): string | null {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text;
}
