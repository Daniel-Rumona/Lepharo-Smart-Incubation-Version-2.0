"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHrManagerProfile = exports.departmentNameOf = exports.departmentIdsForRole = exports.isDepartmentInRole = exports.loadDepartmentRoles = exports.departmentHasRole = exports.getDepartmentRole = exports.departmentLineage = exports.normalizeDepartmentRoles = exports.DEPARTMENT_ROLE_KEYS = void 0;
const firebase_1 = require("./firebase");
/**
 * Server-side mirror of src/services/departmentRoleLogic.ts. Departments are
 * identified only by doc id; which department is ROM, M&E, HR, ... comes from
 * systemSettings/departmentRoles = { roleKey: departmentId }. Never match on a
 * department's name.
 */
exports.DEPARTMENT_ROLE_KEYS = [
    "rom",
    "monitoring",
    "hr",
    "inhouseFinance",
    "financialCompliance",
    "hse",
    "legal",
    "training",
    "nvc",
    "qms",
    "pds",
    "wellness",
    "marketing",
    "marketLinkages",
    "stakeholder",
];
const clean = (value) => String(value ?? "").trim();
const normalizeDepartmentRoles = (data) => {
    const source = (data && typeof data === "object" ? data : {});
    const roles = {};
    for (const key of exports.DEPARTMENT_ROLE_KEYS) {
        const id = clean(source[key]);
        if (id)
            roles[key] = id;
    }
    return roles;
};
exports.normalizeDepartmentRoles = normalizeDepartmentRoles;
const departmentLineage = (departmentId, departments) => {
    const byId = new Map(departments.map((department) => [department.id, department]));
    const lineage = [];
    let currentId = clean(departmentId);
    while (currentId && !lineage.includes(currentId)) {
        lineage.push(currentId);
        const current = byId.get(currentId);
        currentId = clean(current?.parentDepartmentId || current?.parentDeptId);
    }
    return lineage;
};
exports.departmentLineage = departmentLineage;
const getDepartmentRole = (departmentId, roles, departments) => {
    const roleByDepartment = new Map();
    for (const key of exports.DEPARTMENT_ROLE_KEYS) {
        const id = clean(roles[key]);
        if (id && !roleByDepartment.has(id))
            roleByDepartment.set(id, key);
    }
    for (const id of (0, exports.departmentLineage)(departmentId, departments)) {
        const role = roleByDepartment.get(id);
        if (role)
            return role;
    }
    return null;
};
exports.getDepartmentRole = getDepartmentRole;
const departmentHasRole = (departmentId, role, roles, departments) => {
    const roleDepartmentId = clean(roles[role]);
    return !!roleDepartmentId &&
        (0, exports.departmentLineage)(departmentId, departments).includes(roleDepartmentId);
};
exports.departmentHasRole = departmentHasRole;
// Short cache so one function invocation doesn't re-read the same docs.
const CACHE_MS = 60000;
let cached = null;
async function loadDepartmentRoles() {
    if (cached && Date.now() - cached.at < CACHE_MS)
        return cached;
    const [rolesSnap, departmentsSnap] = await Promise.all([
        firebase_1.db.collection("systemSettings").doc("departmentRoles").get(),
        firebase_1.db.collection("departments").get(),
    ]);
    cached = {
        at: Date.now(),
        roles: (0, exports.normalizeDepartmentRoles)(rolesSnap.data()),
        departments: departmentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    };
    return cached;
}
exports.loadDepartmentRoles = loadDepartmentRoles;
/** True when the department (or an ancestor) is assigned to `role`. */
async function isDepartmentInRole(departmentId, role) {
    const { roles, departments } = await loadDepartmentRoles();
    return (0, exports.departmentHasRole)(departmentId, role, roles, departments);
}
exports.isDepartmentInRole = isDepartmentInRole;
/** Department ids that belong to `role`: the assigned department and its descendants. */
async function departmentIdsForRole(role) {
    const { roles, departments } = await loadDepartmentRoles();
    return departments
        .filter((department) => (0, exports.departmentHasRole)(department.id, role, roles, departments))
        .map((department) => department.id);
}
exports.departmentIdsForRole = departmentIdsForRole;
async function departmentNameOf(departmentId, fallback = "") {
    const id = clean(departmentId);
    if (!id)
        return fallback;
    const { departments } = await loadDepartmentRoles();
    return clean(departments.find((department) => department.id === id)?.name) || fallback;
}
exports.departmentNameOf = departmentNameOf;
/** HR staff: role 'hr', or operations staff in the HR department. */
async function isHrManagerProfile(profile) {
    const role = clean(profile.role).toLowerCase();
    if (role === "hr")
        return true;
    if (role !== "operations")
        return false;
    return isDepartmentInRole(clean(profile.departmentId), "hr");
}
exports.isHrManagerProfile = isHrManagerProfile;
//# sourceMappingURL=departmentRoles.js.map