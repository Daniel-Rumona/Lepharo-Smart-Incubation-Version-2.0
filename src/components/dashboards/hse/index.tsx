import { useCallback } from 'react'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import { SmeJobsProvider } from '@/contexts/SmeJobsContext'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import InterventionsDashboard from '../shared/InterventionsDashboard'
import HseJobsParticipantsCard from './JobsMetricsRow'

/**
 * HSE department dashboard.
 *
 * The metrics row, workflow breakdown and appointments card are the same on
 * every department dashboard, so they live in InterventionsDashboard. What is
 * genuinely HSE-specific is the jobs card, passed as a side card.
 *
 * The previous version hand-rolled its own intervention metrics fetch — the
 * only one of the five dashboards to do so, while legal, marketing and linkage
 * already shared loadInterventionMetrics. That duplicate query is gone.
 */
export default function HSEDashboard() {
    const { user } = useFullIdentity() as any
    const { range } = useDashboardDateRange()

    const departmentId = user?.departmentId
    const departmentName = String(user?.departmentName || '').toLowerCase().trim()

    /**
     * Memoised because InterventionsDashboard refetches whenever this identity
     * changes — an inline arrow would make that every render.
     */
    const matchesDepartment = useCallback(
        (entry: Record<string, any>) => {
            if (!departmentName) return true
            if (departmentId && entry?.departmentId === departmentId) return true

            const area = String(entry?.area || entry?.areaOfSupport || '')
                .toLowerCase()
                .trim()
            const department = String(entry?.departmentName || '').toLowerCase().trim()

            return area === departmentName || department === departmentName
        },
        [departmentId, departmentName]
    )

    return (
        <InterventionsDashboard
            title="HSE Dashboard"
            matchesDepartment={matchesDepartment}
            sideCards={
                <SmeJobsProvider>
                    <HseJobsParticipantsCard dateRange={range} />
                </SmeJobsProvider>
            }
        />
    )
}
