export type DepartmentCapabilityRecord = {
    id: string
    parentDepartmentId?: string
    parentDeptId?: string
    isTraining?: boolean
}

const parentIdOf = (department?: DepartmentCapabilityRecord) =>
    String(department?.parentDepartmentId || department?.parentDeptId || '').trim()

/**
 * A department inherits training coverage requirements from any ancestor
 * marked `isTraining: true`.
 */
export const departmentUsesTrainingCoverage = (
    departmentId: string | undefined,
    departments: DepartmentCapabilityRecord[]
) => {
    let currentId = String(departmentId || '').trim()
    if (!currentId) return false

    const byId = new Map(departments.map(department => [department.id, department]))
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
        visited.add(currentId)
        const current = byId.get(currentId)
        if (!current) return false
        if (current.isTraining === true) return true
        currentId = parentIdOf(current)
    }

    return false
}

/** Return every descendant, not only direct children. */
export const getDepartmentDescendants = <T extends DepartmentCapabilityRecord>(
    departmentId: string,
    departments: T[]
) => {
    const descendants: T[] = []
    const pendingParentIds = [departmentId]
    const visited = new Set<string>()

    while (pendingParentIds.length) {
        const parentId = pendingParentIds.shift()!
        if (visited.has(parentId)) continue
        visited.add(parentId)

        const children = departments.filter(
            department => parentIdOf(department) === parentId
        )
        descendants.push(...children)
        pendingParentIds.push(...children.map(child => child.id))
    }

    return descendants
}
