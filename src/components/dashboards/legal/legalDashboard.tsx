import React, { useCallback } from 'react'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import InterventionsDashboard from '../shared/InterventionsDashboard'

/**
 * Legal Advisory Services dashboard.
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

    const departmentId = (user as any)?.departmentId
    // The original defaulted to this when a user carried no department, and
    // some legal records are only matchable by that literal name.
    const departmentName = String(
        (user as any)?.departmentName || 'Legal Advisory Services'
    )
        .toLowerCase()
        .trim()

    /**
     * Memoised because InterventionsDashboard refetches whenever this identity
     * changes — an inline arrow would make that every render.
     */
    const matchesDepartment = useCallback(
        (entry: Record<string, any>) => {
            if (departmentId && entry?.departmentId === departmentId) return true

            return (
                String(entry?.areaOfSupport || entry?.area || entry?.departmentName || '')
                    .toLowerCase()
                    .trim() === departmentName
            )
        },
        [departmentId, departmentName]
    )

    return (
        <InterventionsDashboard
            title="Legal Advisory Services"
            matchesDepartment={matchesDepartment}
        />
    )
}

export default LegalDashboard
