import { db } from "./firebase";

/**
 * Server-side mirror of src/services/departmentRoleLogic.ts. Departments are
 * identified only by doc id; which department is ROM, M&E, HR, ... comes from
 * systemSettings/departmentRoles = { roleKey: departmentId }. Never match on a
 * department's name.
 */
export const DEPARTMENT_ROLE_KEYS = [
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
] as const;

export type DepartmentRoleKey = typeof DEPARTMENT_ROLE_KEYS[number];
export type DepartmentRoleMap = Partial<Record<DepartmentRoleKey, string>>;
export type DepartmentRecord = {
  id: string;
  name?: string;
  parentDepartmentId?: string | null;
  parentDeptId?: string | null;
  [key: string]: any;
};

const clean = (value: unknown) => String(value ?? "").trim();

export const normalizeDepartmentRoles = (data: unknown): DepartmentRoleMap => {
  const source = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const roles: DepartmentRoleMap = {};
  for (const key of DEPARTMENT_ROLE_KEYS) {
    const id = clean(source[key]);
    if (id) roles[key] = id;
  }
  return roles;
};

export const departmentLineage = (
  departmentId: string | null | undefined,
  departments: DepartmentRecord[]
) => {
  const byId = new Map(departments.map((department) => [department.id, department]));
  const lineage: string[] = [];
  let currentId = clean(departmentId);
  while (currentId && !lineage.includes(currentId)) {
    lineage.push(currentId);
    const current = byId.get(currentId);
    currentId = clean(current?.parentDepartmentId || current?.parentDeptId);
  }
  return lineage;
};

export const getDepartmentRole = (
  departmentId: string | null | undefined,
  roles: DepartmentRoleMap,
  departments: DepartmentRecord[]
): DepartmentRoleKey | null => {
  const roleByDepartment = new Map<string, DepartmentRoleKey>();
  for (const key of DEPARTMENT_ROLE_KEYS) {
    const id = clean(roles[key]);
    if (id && !roleByDepartment.has(id)) roleByDepartment.set(id, key);
  }
  for (const id of departmentLineage(departmentId, departments)) {
    const role = roleByDepartment.get(id);
    if (role) return role;
  }
  return null;
};

export const departmentHasRole = (
  departmentId: string | null | undefined,
  role: DepartmentRoleKey,
  roles: DepartmentRoleMap,
  departments: DepartmentRecord[]
) => {
  const roleDepartmentId = clean(roles[role]);
  return !!roleDepartmentId &&
    departmentLineage(departmentId, departments).includes(roleDepartmentId);
};

// Short cache so one function invocation doesn't re-read the same docs.
const CACHE_MS = 60_000;
let cached: { at: number; roles: DepartmentRoleMap; departments: DepartmentRecord[] } | null = null;

export async function loadDepartmentRoles() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  const [rolesSnap, departmentsSnap] = await Promise.all([
    db.collection("systemSettings").doc("departmentRoles").get(),
    db.collection("departments").get(),
  ]);
  cached = {
    at: Date.now(),
    roles: normalizeDepartmentRoles(rolesSnap.data()),
    departments: departmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })),
  };
  return cached;
}

/** True when the department (or an ancestor) is assigned to `role`. */
export async function isDepartmentInRole(
  departmentId: string | null | undefined,
  role: DepartmentRoleKey
) {
  const { roles, departments } = await loadDepartmentRoles();
  return departmentHasRole(departmentId, role, roles, departments);
}

/** Department ids that belong to `role`: the assigned department and its descendants. */
export async function departmentIdsForRole(role: DepartmentRoleKey) {
  const { roles, departments } = await loadDepartmentRoles();
  return departments
    .filter((department) => departmentHasRole(department.id, role, roles, departments))
    .map((department) => department.id);
}

export async function departmentNameOf(departmentId: string | null | undefined, fallback = "") {
  const id = clean(departmentId);
  if (!id) return fallback;
  const { departments } = await loadDepartmentRoles();
  return clean(departments.find((department) => department.id === id)?.name) || fallback;
}

/** HR staff: role 'hr', or operations staff in the HR department. */
export async function isHrManagerProfile(profile: FirebaseFirestore.DocumentData) {
  const role = clean(profile.role).toLowerCase();
  if (role === "hr") return true;
  if (role !== "operations") return false;
  return isDepartmentInRole(clean(profile.departmentId), "hr");
}
