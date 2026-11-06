import React, { useCallback } from 'react'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import InterventionsDashboard from '../shared/InterventionsDashboard'

/**
 * Legal department dashboard.
 *
 * The metrics row, workflow breakdown and appointments card are the same on
 * every department dashboard, so they live in InterventionsDashboard. Legal has
 * no department-specific cards, which is why this file is only a matcher.
 *
 * Two things were dropped rather than migrated:
 *
 *  - The `assignments` state and its `filtered` memo. Both were populated from a
 *    listCompleted() query on every load and neither was ever rendered — the
 *    same dead-code pattern HSE had. That query is gone.
 *  - The card's own RangePicker and refresh button. The reporting period now
 *    comes from the topbar filter, and the breakdown card carries its own
 *    refresh.
 */
const LegalDashboard: React.FC = () => {
    const { user } = useFullIdentity()

    const { nameOf } = useDepartmentRoles()
    const departmentId = (user as any)?.departmentId

    /**
     * Memoised because InterventionsDashboard refetches whenever this identity
     * changes — an inline arrow would make that every render.
     */
    const matchesDepartment = useCallback(
        (entry: Record<string, any>) => !!departmentId && entry?.departmentId === departmentId,
        [departmentId]
    )

    return (
        <InterventionsDashboard
            title={nameOf(departmentId, 'Legal')}
            matchesDepartment={matchesDepartment}
        />
    )
}

export default LegalDashboard
