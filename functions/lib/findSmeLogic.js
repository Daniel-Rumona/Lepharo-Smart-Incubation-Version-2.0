"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.smesWithOpenWork = exports.smesWithConfirmedPlans = exports.planConfirmedFor = exports.findScope = exports.confirmedDeptIds = exports.isOpenAssignment = exports.INACTIVE_ASSIGNMENT = void 0;
const text = (value) => (value == null ? "" : String(value)).trim();
exports.INACTIVE_ASSIGNMENT = ["cancelled", "completed", "declined"];
const isOpenAssignment = (row) => !exports.INACTIVE_ASSIGNMENT.includes(text(row?.assignmentStatus).toLowerCase());
exports.isOpenAssignment = isOpenAssignment;
// SME sign-off lives in two maps (the roadmap and the plan builder write different ones); a department
// counts as confirmed when either says so. Shared with devPlanSmeConfirmed.ts.
const isOn = (value) => value === true || (value && typeof value === "object" && value.confirmed === true);
const confirmedDeptIds = (plan) => {
    const ids = new Set();
    for (const map of [plan?.incubateeDepartmentConfirmationsByDeptId, plan?.smmeConfirmedByDeptId]) {
        Object.entries(map || {}).forEach(([id, value]) => {
            if (isOn(value))
                ids.add(id);
        });
    }
    return ids;
};
exports.confirmedDeptIds = confirmedDeptIds;
/** How this person's search is limited. Centre coordinators (projectadmin) oversee their programmes. */
const findScope = (identity) => {
    if (identity.roleGroup === "hod" && identity.departmentId)
        return "department_plans";
    if (text(identity.role).toLowerCase().replace(/[\s_-]/g, "") === "coordinator")
        return "own_work";
    return "programmes";
};
exports.findScope = findScope;
/** Both sign-offs for the department: hasBothConfirmationsForDept in src/routes/operations/assignments. */
const planConfirmedFor = (plan, departmentId) => !!departmentId && isOn(plan?.confirmedByDeptId?.[departmentId]) && (0, exports.confirmedDeptIds)(plan).has(departmentId);
exports.planConfirmedFor = planConfirmedFor;
/** The SMEs whose plans are signed off for the department, from their diagnosticPlans documents. */
const smesWithConfirmedPlans = (plans, departmentId) => {
    const found = new Set();
    for (const plan of plans) {
        if ((0, exports.planConfirmedFor)(plan.data, departmentId))
            found.add(text(plan.data?.participantId) || plan.id);
    }
    return found;
};
exports.smesWithConfirmedPlans = smesWithConfirmedPlans;
/** The SMEs this person has open interventions with. */
const smesWithOpenWork = (assignments) => new Set(assignments.filter(exports.isOpenAssignment).map((row) => text(row?.participantId)).filter(Boolean));
exports.smesWithOpenWork = smesWithOpenWork;
//# sourceMappingURL=findSmeLogic.js.map