"use strict";
/**
 * Default line managers for individual performance management (IPM).
 *
 * - Head of Department (operations) -> the CEO (director)
 * - Coordinators and HR staff -> the HoD of their department
 * - Centre Coordinators (projectadmin) -> the HoD of their department, if any
 * - Employees, receptionists, auxiliary staff -> the Centre Coordinator of their branch
 *
 * Every step falls back to the next level up, ending at the director. HR can
 * override the result per employee (users/{uid}.lineManagerSource = 'manual').
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineManagerPatches = exports.defaultLineManagerId = exports.managerTiersFor = exports.isActiveProfile = exports.normalizeStaffRole = void 0;
const clean = (value) => String(value ?? "").trim();
const ROLE_ALIASES = {
    director: "director",
    operations: "operations",
    headofdepartment: "operations",
    hod: "operations",
    projectadmin: "projectadmin",
    centercoordinator: "projectadmin",
    coordinator: "coordinator",
    consultant: "coordinator",
    hr: "hr",
    employee: "employee",
    auxiliary: "employee",
    receptionist: "employee",
    projectmanager: "employee",
};
/** Staff role in one spelling; '' for non-staff (SMEs, funders, admins). */
function normalizeStaffRole(role) {
    return ROLE_ALIASES[clean(role).toLowerCase().replace(/[\s_]+/g, "")] || "";
}
exports.normalizeStaffRole = normalizeStaffRole;
function isActiveProfile(profile) {
    return clean(profile.status).toLowerCase() !== "inactive";
}
exports.isActiveProfile = isActiveProfile;
/** Which manager tiers to try, in order, for an employee's role. */
function managerTiersFor(role) {
    switch (normalizeStaffRole(role)) {
        case "operations":
            return ["director"];
        case "coordinator":
        case "hr":
        case "projectadmin":
            return ["operations", "director"];
        case "employee":
            return ["projectadmin", "operations", "director"];
        default:
            return [];
    }
}
exports.managerTiersFor = managerTiersFor;
const branchOf = (profile) => clean(profile.assignedBranch || profile.branchId);
function candidatesFor(tier, employee, staff) {
    const pool = staff.filter((person) => person.id !== employee.id && isActiveProfile(person) && normalizeStaffRole(person.role) === tier);
    if (tier === "director")
        return pool;
    if (tier === "operations") {
        const departmentId = clean(employee.departmentId);
        return departmentId ? pool.filter((person) => clean(person.departmentId) === departmentId) : [];
    }
    const branch = branchOf(employee);
    return branch ? pool.filter((person) => branchOf(person) === branch) : [];
}
/** The default line manager's users doc id, or null when there is none. */
function defaultLineManagerId(employee, staff) {
    for (const tier of managerTiersFor(employee.role)) {
        // Several candidates (two HoDs in one department) resolve to the lowest
        // id so the result is stable; HR overrides it when that is wrong.
        const [first] = candidatesFor(tier, employee, staff).map((person) => person.id).sort();
        if (first)
            return first;
    }
    return null;
}
exports.defaultLineManagerId = defaultLineManagerId;
/** users/{uid} patches that bring every non-manual employee to their default. */
function lineManagerPatches(staff) {
    const patches = [];
    for (const employee of staff) {
        if (clean(employee.lineManagerSource) === "manual")
            continue;
        if (!normalizeStaffRole(employee.role))
            continue;
        const next = defaultLineManagerId(employee, staff);
        if ((clean(employee.lineManagerId) || null) !== next) {
            patches.push({ id: employee.id, lineManagerId: next });
        }
    }
    return patches;
}
exports.lineManagerPatches = lineManagerPatches;
//# sourceMappingURL=lineManagerLogic.js.map