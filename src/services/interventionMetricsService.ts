import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    assignedInterventionService,
    dedupeAssignedInterventionViews,
    getAssignedInterventionLifecycle,
    type AssignedInterventionFilters,
    type AssignedInterventionView
} from '@/services/assignedInterventionService'

export type InterventionMetricSummary = {
    totalRequired: number
    assigned: number
    inProgress: number
    completed: number
    pendingAssignment: number
}

export function summarizeAssignedInterventions(
    rows: Array<Record<string, any>>,
    totalRequired = rows.length
): InterventionMetricSummary {
    const uniqueRows = dedupeAssignedInterventionViews(rows)
    let inProgress = 0
    let completed = 0

    uniqueRows.forEach(row => {
        const lifecycle = getAssignedInterventionLifecycle(row)
        if (lifecycle === 'completed') completed += 1
        else if (lifecycle === 'in-progress') inProgress += 1
    })

    const assigned = uniqueRows.length
    return {
        totalRequired,
        assigned,
        inProgress,
        completed,
        pendingAssignment: Math.max(totalRequired - assigned, 0)
    }
}

export type InterventionMetricsOptions = {
    programId?: string | null
    assignedFilters?: AssignedInterventionFilters
    assignedMatches?: (row: AssignedInterventionView) => boolean
    requiredMatches?: (entry: any) => boolean
}

export type InterventionMetricsDetail = {
    summary: InterventionMetricSummary
    /** The deduped rows the summary was counted from. */
    rows: AssignedInterventionView[]
}

/**
 * Same work as loadInterventionMetrics, but hands back the rows it counted.
 *
 * The rows are loaded either way — this only stops them being discarded — so a
 * caller that wants to show the records behind a number does not have to run
 * the query a second time.
 */
export async function loadInterventionMetricsDetailed(
    options: InterventionMetricsOptions
): Promise<InterventionMetricsDetail> {
    const { programId, assignedFilters = {}, assignedMatches, requiredMatches } = options
    const appConstraints: any[] = [where('applicationStatus', '==', 'accepted')]
    if (programId && programId !== 'all') appConstraints.push(where('programId', '==', programId))


    const appsSnap = await getDocs(query(collection(db, 'applications'), ...appConstraints))
    let totalRequired = 0
    appsSnap.forEach(item => {
        const data = item.data() as any
        const required = Array.isArray(data?.interventions?.required)
            ? data.interventions.required
            : []
        totalRequired += required.filter((entry: any) => requiredMatches ? requiredMatches(entry) : true).length
    })

    const loadedRows: AssignedInterventionView[] = await assignedInterventionService.list({
        ...assignedFilters,
        ...(programId && programId !== 'all' ? { programId } : {})
    })
    const rows = assignedMatches ? loadedRows.filter(assignedMatches) : loadedRows

    return {
        summary: summarizeAssignedInterventions(rows, totalRequired),
        rows: dedupeAssignedInterventionViews(rows) as AssignedInterventionView[]
    }
}

export async function loadInterventionMetrics(
    options: InterventionMetricsOptions
): Promise<InterventionMetricSummary> {
    return (await loadInterventionMetricsDetailed(options)).summary
}
