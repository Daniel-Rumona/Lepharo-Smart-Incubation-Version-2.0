/**
 * Departments are identified only by their document id. Behaviour that used to
 * hang off a department's *name* (ROM finalises plans, M&E sees everything, HR
 * manages staff, Legal has its own dashboard, ...) is driven by the role map in
 * `systemSettings/departmentRoles`: { [roleKey]: departmentId }.
 *
 * This file is pure so it can be unit tested and mirrored in Cloud Functions
 * (functions/src/departmentRoles.ts) and ai-backend.
 */

export const DEPARTMENT_ROLES = [
    { key: 'rom', label: 'Recruitment, Onboarding & Maintenance (ROM)', description: 'Owns onboarding, GAP confirmation and finalising Developmental Plans; sees every department.' },
    { key: 'monitoring', label: 'Monitoring & Evaluation (M&E)', description: 'Oversight of every department; reviews MOVs and receives M&E notifications.' },
    { key: 'hr', label: 'Human Resources (HRM)', description: 'Manages staff records, leave and performance.' },
    { key: 'inhouseFinance', label: 'In-House Finance (IHF)', description: 'Internal finance and invoicing.' },
    { key: 'financialCompliance', label: 'Financial Compliance', description: 'SME financial compliance dashboard and menus.' },
    { key: 'hse', label: 'Health, Safety & Environment (HSE)', description: 'HSE and labour compliance dashboard.' },
    { key: 'legal', label: 'Legal Advisory', description: 'Legal dashboard; submits narrative summaries instead of evidence files.' },
    { key: 'training', label: 'Training Academy', description: 'Training dashboard and training programmes; delivers the GAP training and quality sections.' },
    { key: 'nvc', label: 'New Venture Creation (NVC)', description: 'Views the GAP training section.' },
    { key: 'qms', label: 'Quality Management System (QMS)', description: 'Delivers the GAP quality section.' },
    { key: 'pds', label: 'Personal Development Services (PDS)', description: 'PDS dashboard; submits narrative summaries.' },
    { key: 'wellness', label: 'Wellness Services', description: 'Wellness dashboard; submits narrative summaries.' },
    { key: 'marketing', label: 'Marketing & Communication', description: 'Marketing dashboard and forms.' },
    { key: 'marketLinkages', label: 'Market Linkages', description: 'Market linkages dashboard.' },
    { key: 'stakeholder', label: 'Stakeholder Engagement', description: 'Stakeholder engagement dashboard.' }
] as const

export type DepartmentRoleKey = typeof DEPARTMENT_ROLES[number]['key']
export type DepartmentRoleMap = Partial<Record<DepartmentRoleKey, string>>

export type DepartmentLike = {
    id: string
    name?: string
    parentDepartmentId?: string | null
    parentDeptId?: string | null
}

const clean = (value: unknown) => String(value ?? '').trim()

const parentIdOf = (department?: DepartmentLike) =>
    clean(department?.parentDepartmentId || department?.parentDeptId)

/** The department followed by its ancestors, nearest first. */
export const departmentLineage = (departmentId: string | null | undefined, departments: DepartmentLike[]) => {
    const byId = new Map(departments.map(department => [department.id, department]))
    const lineage: string[] = []
    let currentId = clean(departmentId)
    while (currentId && !lineage.includes(currentId)) {
        lineage.push(currentId)
        currentId = parentIdOf(byId.get(currentId))
    }
    return lineage
}

/**
 * The role a department plays. A sub-department inherits its nearest
 * ancestor's role unless it has one of its own.
 */
export const getDepartmentRole = (
    departmentId: string | null | undefined,
    roles: DepartmentRoleMap,
    departments: DepartmentLike[]
): DepartmentRoleKey | null => {
    const roleByDepartment = new Map<string, DepartmentRoleKey>()
    for (const { key } of DEPARTMENT_ROLES) {
        const id = clean(roles[key])
        if (id && !roleByDepartment.has(id)) roleByDepartment.set(id, key)
    }
    for (const id of departmentLineage(departmentId, departments)) {
        const role = roleByDepartment.get(id)
        if (role) return role
    }
    return null
}

export const departmentHasRole = (
    departmentId: string | null | undefined,
    role: DepartmentRoleKey,
    roles: DepartmentRoleMap,
    departments: DepartmentLike[]
) => {
    const roleDepartmentId = clean(roles[role])
    return !!roleDepartmentId && departmentLineage(departmentId, departments).includes(roleDepartmentId)
}

export const departmentIdForRole = (role: DepartmentRoleKey, roles: DepartmentRoleMap) =>
    clean(roles[role]) || null

export const departmentNameOf = (
    departmentId: string | null | undefined,
    departments: DepartmentLike[],
    fallback = 'Unassigned'
) => {
    const id = clean(departmentId)
    if (!id) return fallback
    return clean(departments.find(department => department.id === id)?.name) || fallback
}

export const normalizeDepartmentRoles = (data: unknown): DepartmentRoleMap => {
    const source = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    const roles: DepartmentRoleMap = {}
    for (const { key } of DEPARTMENT_ROLES) {
        const id = clean(source[key])
        if (id) roles[key] = id
    }
    return roles
}
