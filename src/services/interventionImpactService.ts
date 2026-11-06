import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import type { ImpactMetric, ImpactResult } from '../../functions/src/impactLogic'

export type { ImpactMetric }

// Results are written monthly by functions/src/interventionImpact.ts; the shape is
// the one impactLogic.ts produces, plus when it ran.
export type InterventionImpact = ImpactResult & {
    id: string
    computedAt: Date | null
}

const toImpact = (id: string, data: Record<string, any>): InterventionImpact => ({
    ...(data as ImpactResult),
    id,
    computedAt: data.computedAt?.toDate ? data.computedAt.toDate() : null
})

/** One result per programme the intervention ran in. */
export async function impactForIntervention(interventionId: string): Promise<InterventionImpact[]> {
    const snapshot = await getDocs(query(collection(db, 'interventionImpact'), where('interventionId', '==', interventionId)))
    return snapshot.docs.map(doc => toImpact(doc.id, doc.data()))
}

/** Every result for a programme, or all programmes when none is given. */
export async function impactForProgramme(programId?: string | null): Promise<InterventionImpact[]> {
    const source = programId && programId !== 'all'
        ? query(collection(db, 'interventionImpact'), where('programId', '==', programId))
        : collection(db, 'interventionImpact')
    const snapshot = await getDocs(source)
    return snapshot.docs.map(doc => toImpact(doc.id, doc.data()))
}

/** Programme id → display name, for labelling results. */
export async function programmeNames(): Promise<Record<string, string>> {
    const snapshot = await getDocs(collection(db, 'programs'))
    const names: Record<string, string> = {}
    snapshot.docs.forEach(doc => {
        const data = doc.data()
        names[doc.id] = String(data.name || data.programName || data.title || 'Programme')
    })
    return names
}

/** Roles that may run the calculation now; matches refreshInterventionImpact. */
export const IMPACT_REFRESH_ROLES = new Set(['system_admin', 'superadmin', 'director', 'operations'])

/** Recomputes now (managers only); otherwise it runs on the 1st of each month. */
export async function refreshImpact() {
    const { data } = await httpsCallable<Record<string, never>, any>(functions, 'refreshInterventionImpact')({})
    return data as { pairs: number; reportable: number; early: number }
}

export const formatPoints = (value: number | null) =>
    value === null ? '—' : `${value > 0 ? '+' : ''}${value}`

/** "+6.4 to +13", or just "-13.4" when every SME moved the same way. */
export const formatRange = (low: number | null, high: number | null) =>
    low === null || high === null ? '—' : low === high ? formatPoints(low) : `${formatPoints(low)} to ${formatPoints(high)}`

/** Results written before jobs were added carry no metric; they are revenue. */
export const metricOf = (row: Pick<ImpactResult, 'metric'>): ImpactMetric => row.metric || 'revenue'

export const IMPACT_METRIC_LABEL: Record<ImpactMetric, { name: string; growth: string; lift: string; change: string }> = {
    revenue: { name: 'Revenue', growth: 'revenue growth', lift: 'pts', change: '%' },
    jobs: { name: 'Jobs', growth: 'jobs', lift: 'jobs', change: 'jobs' }
}

/** The lift with its unit: "+10.6 pts" for revenue, "+1.2 jobs" per SME for jobs. */
export const formatLift = (row: Pick<ImpactResult, 'metric'>, value: number | null) =>
    value === null ? '—' : `${formatPoints(value)} ${IMPACT_METRIC_LABEL[metricOf(row)].lift}`

/** A group's own change: "+3.6%" for revenue, "+0.8 jobs" for jobs. */
export const formatChange = (row: Pick<ImpactResult, 'metric'>, value: number | null) =>
    value === null ? '—' : metricOf(row) === 'jobs' ? `${formatPoints(value)} jobs` : `${formatPoints(value)}%`
