import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import type { ImpactResult } from '../../functions/src/impactLogic'

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

/** Recomputes now (managers only); otherwise it runs on the 1st of each month. */
export async function refreshImpact() {
    const { data } = await httpsCallable<Record<string, never>, any>(functions, 'refreshInterventionImpact')({})
    return data as { pairs: number; reportable: number; early: number }
}

export const formatPoints = (value: number | null) =>
    value === null ? '—' : `${value > 0 ? '+' : ''}${value}`
