/**
 * Headcounts per centre from staff records. Pure, so the rules can be tested without Firestore.
 * Operations-role users (head of department, M&E) are never centre staff and are not counted.
 */
const lower = (v: any) => String(v ?? '').trim().toLowerCase()

export function branchOf(doc: any): string {
    const a = doc?.assignedBranch
    if (typeof a === 'string' && a) return a
    if (a && typeof a === 'object' && a.id) return String(a.id)
    return String(doc?.branchId || '')
}

const isInactive = (d: any) => d?.active === false || ['inactive', 'disabled', 'suspended', 'terminated'].includes(lower(d?.status)) || !!d?.accountDisabledAt

/** Active coordinators attached to the centre. National coordinators serve every centre and are not centre staff. */
export function countCoordinators(docs: Array<{ id: string } & Record<string, any>>, branchId: string): number {
    const ids = new Set<string>()
    for (const d of docs) {
        if (isInactive(d) || d.isNational === true || d.nationalCoordinator === true) continue
        if (branchOf(d) === branchId || (Array.isArray(d.branchIds) && d.branchIds.includes(branchId))) ids.add(d.id)
    }
    return ids.size
}

/** Active centre coordinators (projectadmin role) assigned to the centre. */
export function countCentreCoordinators(docs: Array<{ id: string } & Record<string, any>>, branchId: string): number {
    const ids = new Set<string>()
    for (const d of docs) if (lower(d.role) === 'projectadmin' && !isInactive(d) && branchOf(d) === branchId) ids.add(d.id)
    return ids.size
}
