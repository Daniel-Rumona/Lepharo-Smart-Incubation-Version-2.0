/**
 * Which SMEs a staff member can find on WhatsApp ("Find an SME"), and which of an SME's interventions
 * they see. Pure, so it can be tested; whatsappStaff.ts does the reads.
 *
 *   coordinator         SMEs they have open interventions with; they see their own interventions.
 *   head of department  SMEs whose development plan both the department and the SME signed off for the
 *                       HOD's department (as the web's assignment page requires); they
 *                       see the department's open interventions for the SME, whoever they're assigned to.
 *   everyone else       every SME on their programmes; they see their own interventions.
 */

const text = (value: unknown) => (value == null ? "" : String(value)).trim();

export const INACTIVE_ASSIGNMENT = ["cancelled", "completed", "declined"];
export const isOpenAssignment = (row: any) => !INACTIVE_ASSIGNMENT.includes(text(row?.assignmentStatus).toLowerCase());

// SME sign-off lives in two maps (the roadmap and the plan builder write different ones); a department
// counts as confirmed when either says so. Shared with devPlanSmeConfirmed.ts.
const isOn = (value: any) => value === true || (value && typeof value === "object" && value.confirmed === true);

export const confirmedDeptIds = (plan: any): Set<string> => {
  const ids = new Set<string>();
  for (const map of [plan?.incubateeDepartmentConfirmationsByDeptId, plan?.smmeConfirmedByDeptId]) {
    Object.entries(map || {}).forEach(([id, value]) => {
      if (isOn(value)) ids.add(id);
    });
  }
  return ids;
};

export type FindScope = "own_work" | "department_plans" | "programmes";

/** How this person's search is limited. Centre coordinators (projectadmin) oversee their programmes. */
export const findScope = (identity: { role?: string | null; roleGroup: string; departmentId?: string | null }): FindScope => {
  if (identity.roleGroup === "hod" && identity.departmentId) return "department_plans";
  if (text(identity.role).toLowerCase().replace(/[\s_-]/g, "") === "coordinator") return "own_work";
  return "programmes";
};

/** Both sign-offs for the department: hasBothConfirmationsForDept in src/routes/operations/assignments. */
export const planConfirmedFor = (plan: any, departmentId: string): boolean =>
  !!departmentId && isOn(plan?.confirmedByDeptId?.[departmentId]) && confirmedDeptIds(plan).has(departmentId);

/** The SMEs whose plans are signed off for the department, from their diagnosticPlans documents. */
export const smesWithConfirmedPlans = (plans: { id: string; data: any }[], departmentId: string): Set<string> => {
  const found = new Set<string>();
  for (const plan of plans) {
    if (planConfirmedFor(plan.data, departmentId)) found.add(text(plan.data?.participantId) || plan.id);
  }
  return found;
};

/** The SMEs this person has open interventions with. */
export const smesWithOpenWork = (assignments: any[]): Set<string> =>
  new Set(assignments.filter(isOpenAssignment).map((row) => text(row?.participantId)).filter(Boolean));
