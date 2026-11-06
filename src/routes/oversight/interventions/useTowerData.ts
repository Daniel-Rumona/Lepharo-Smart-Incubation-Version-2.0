import { useCallback, useEffect, useState } from 'react'
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/firebase'

type Rows = Array<Record<string, any>>

export type TowerData = {
    assignments: Rows
    movs: Rows
    packs: Rows
    loading: boolean
    error: string | null
    loadedAt: number | null
    reload: () => void
}

/**
 * Programme-wide read of the three collections the tower needs. One fetch per
 * collection (no listeners): the tower is a review screen, and a manual
 * refresh is cheaper than three live subscriptions over the whole programme.
 */
export function useTowerData(programId: string | null | undefined): TowerData {
    const [state, setState] = useState<Omit<TowerData, 'reload'>>({
        assignments: [],
        movs: [],
        packs: [],
        loading: true,
        error: null,
        loadedAt: null
    })
    const [tick, setTick] = useState(0)

    useEffect(() => {
        let cancelled = false
        setState(prev => ({ ...prev, loading: true, error: null }))

        const constraints: QueryConstraint[] =
            programId && programId !== 'all' ? [where('programId', '==', programId)] : []
        const read = async (name: string): Promise<Rows> => {
            const snap = await getDocs(query(collection(db, name), ...constraints))
            return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }

        Promise.all([read('assignedInterventions'), read('movDocuments'), read('consolidatedMOVs')])
            .then(([assignments, movs, packs]) => {
                if (cancelled) return
                setState({ assignments, movs, packs, loading: false, error: null, loadedAt: Date.now() })
            })
            .catch(err => {
                if (cancelled) return
                console.error(err)
                setState(prev => ({ ...prev, loading: false, error: 'Could not load intervention data.' }))
            })

        return () => {
            cancelled = true
        }
    }, [programId, tick])

    const reload = useCallback(() => setTick(value => value + 1), [])
    return { ...state, reload }
}
