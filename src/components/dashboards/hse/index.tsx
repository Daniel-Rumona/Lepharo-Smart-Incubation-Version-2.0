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

    /**
     * Memoised because InterventionsDashboard refetches whenever this identity
     * changes — an inline arrow would make that every render.
     */
    const matchesDepartment = useCallback(
        (entry: Record<string, any>) => !departmentId || entry?.departmentId === departmentId,
        [departmentId]
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
