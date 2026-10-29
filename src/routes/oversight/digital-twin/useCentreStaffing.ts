import { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { defaultOperatingHours, validateOperatingHours, type BranchOperatingHours } from '@/utils/branchOperatingHours'
import { countCentreCoordinators, countCoordinators } from '@/services/digitalTwin/centreHeadcounts'

export type CentreBase = { branchId: string; name: string; hours: BranchOperatingHours; hoursConfigured: boolean; coordinators: number | null; centreCoordinators: number; centreCoordinatorsSource: 'records' | 'assumed' }
type Row = { id: string } & Record<string, any>
const fetchRows = async (q: ReturnType<typeof query>): Promise<Row[]> => (await getDocs(q)).docs.map(d => ({ ...(d.data() as Record<string, any>), id: d.id }))
const settled = async (reads: Array<Promise<Row[]>>) => {
    const results = await Promise.allSettled(reads)
    return { ok: results.every(r => r.status === 'fulfilled'), rows: results.flatMap(r => r.status === 'fulfilled' ? r.value : []) }
}

/**
 * Reads each centre's own operating hours and headcounts straight from the branch, coordinator and user records.
 * Operations-role staff are never counted. If a read is refused or returns nothing, coordinators fall back to the people seen
 * on recent sessions (done by the caller) and centre coordinators to an assumed 1, each labelled with its source.
 */
export function useCentreStaffing(branchIds: string[], enabled: boolean) {
    const key = enabled ? [...branchIds].sort().join('|') : ''
    const [state, setState] = useState<{ key: string; centres: CentreBase[]; error: string | null }>({ key: '', centres: [], error: null })
    useEffect(() => {
        if (!key) { setState({ key: '', centres: [], error: null }); return }
        let active = true
        Promise.all(key.split('|').map(async (branchId): Promise<CentreBase | null> => {
            const snapshot = await getDoc(doc(db, 'branches', branchId))
            if (!snapshot.exists()) return null
            const data: any = snapshot.data()
            let hours = defaultOperatingHours(), hoursConfigured = false
            try { if (data.operatingHours) { validateOperatingHours(data.operatingHours); hours = data.operatingHours; hoursConfigured = true } } catch { /* fall back to the default week and say so */ }
            const [coordinatorRead, adminRead] = await Promise.all([
                settled([
                    fetchRows(query(collection(db, 'coordinators'), where('branchId', '==', branchId))),
                    fetchRows(query(collection(db, 'coordinators'), where('assignedBranch', '==', branchId))),
                    fetchRows(query(collection(db, 'coordinators'), where('branchIds', 'array-contains', branchId)))
                ]),
                settled([
                    fetchRows(query(collection(db, 'users'), where('role', '==', 'projectadmin'), where('assignedBranch', '==', branchId))),
                    fetchRows(query(collection(db, 'users'), where('role', '==', 'projectadmin'), where('branchId', '==', branchId)))
                ])
            ])
            const coordinators = coordinatorRead.ok ? countCoordinators(coordinatorRead.rows, branchId) : 0
            const centreCoordinators = adminRead.ok ? countCentreCoordinators(adminRead.rows, branchId) : 0
            return { branchId, name: String(data.name || 'Centre'), hours, hoursConfigured, coordinators: coordinators || null, centreCoordinators: centreCoordinators || 1, centreCoordinatorsSource: centreCoordinators ? 'records' : 'assumed' }
        })).then(rows => { if (active) setState({ key, centres: rows.filter((r): r is CentreBase => !!r), error: null }) })
            .catch(() => { if (active) setState({ key, centres: [], error: 'Could not read the centres’ operating hours.' }) })
        return () => { active = false }
    }, [key])
    const current = state.key === key ? state : { key, centres: [] as CentreBase[], error: null as string | null }
    return { centres: current.centres, error: current.error, loading: !!key && state.key !== key }
}
