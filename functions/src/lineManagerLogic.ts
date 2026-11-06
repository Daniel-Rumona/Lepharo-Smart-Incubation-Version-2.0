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

export type StaffProfile = {
  id: string;
  role?: string;
  departmentId?: string | null;
  assignedBranch?: string | null;
  branchId?: string | null;
  status?: string;
  lineManagerId?: string | null;
  lineManagerSource?: string;
};

export type ManagerTier = "director" | "operations" | "projectadmin";

const clean = (value: unknown) => String(value ?? "").trim();

const ROLE_ALIASES: Record<string, string> = {
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
export function normalizeStaffRole(role: unknown): string {
  return ROLE_ALIASES[clean(role).toLowerCase().replace(/[\s_]+/g, "")] || "";
}

export function isActiveProfile(profile: StaffProfile): boolean {
  return clean(profile.status).toLowerCase() !== "inactive";
}

/** Which manager tiers to try, in order, for an employee's role. */
export function managerTiersFor(role: unknown): ManagerTier[] {
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

const branchOf = (profile: StaffProfile) => clean(profile.assignedBranch || profile.branchId);

function candidatesFor(tier: ManagerTier, employee: StaffProfile, staff: StaffProfile[]) {
  const pool = staff.filter(
    (person) => person.id !== employee.id && isActiveProfile(person) && normalizeStaffRole(person.role) === tier
  );
  if (tier === "director") return pool;
  if (tier === "operations") {
    const departmentId = clean(employee.departmentId);
    return departmentId ? pool.filter((person) => clean(person.departmentId) === departmentId) : [];
  }
  const branch = branchOf(employee);
  return branch ? pool.filter((person) => branchOf(person) === branch) : [];
}

/** The default line manager's users doc id, or null when there is none. */
export function defaultLineManagerId(employee: StaffProfile, staff: StaffProfile[]): string | null {
  for (const tier of managerTiersFor(employee.role)) {
    // Several candidates (two HoDs in one department) resolve to the lowest
    // id so the result is stable; HR overrides it when that is wrong.
    const [first] = candidatesFor(tier, employee, staff).map((person) => person.id).sort();
    if (first) return first;
  }
  return null;
}

/** users/{uid} patches that bring every non-manual employee to their default. */
export function lineManagerPatches(staff: StaffProfile[]): { id: string; lineManagerId: string | null }[] {
  const patches: { id: string; lineManagerId: string | null }[] = [];
  for (const employee of staff) {
    if (clean(employee.lineManagerSource) === "manual") continue;
    if (!normalizeStaffRole(employee.role)) continue;
    const next = defaultLineManagerId(employee, staff);
    if ((clean(employee.lineManagerId) || null) !== next) {
      patches.push({ id: employee.id, lineManagerId: next });
    }
  }
  return patches;
}
