import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { message } from 'antd'
import { db } from '@/firebase'
import {
    fetchProgramQuestionMap,
    isInternalEmail,
    normalizeApplication,
    type Application,
    type ProgramQuestionMap
} from './applicationData'

type Scope = {
    activeProgramId?: string | null
    isAllPrograms: boolean
    /** Project admins and managers only ever see the active programme. */
    isRestrictedRole: boolean
    /** Control accounts also see the team's internal test applications. */
    isControlAccount: boolean
}

/** Whether the current scope can show applications at all. */
export const hasApplicationScope = ({ activeProgramId, isAllPrograms, isRestrictedRole }: Scope) =>
    isRestrictedRole ? !!activeProgramId : isAllPrograms || !!activeProgramId

/**
 * Loads the applications for the current programme scope, plus the
 * onboarding-question labels each one's profile answers need. `refreshOne`
 * re-reads a single document after a decision instead of reloading the list.
 */
export const useApplications = (scope: Scope) => {
    const { activeProgramId, isAllPrograms, isRestrictedRole, isControlAccount } = scope
    const [applications, setApplications] = useState<Application[]>([])
    const [loading, setLoading] = useState(false)
    const [questionMaps, setQuestionMaps] = useState<Record<string, ProgramQuestionMap>>({})
    const requested = useRef(new Set<string>())

    const loadQuestionMaps = useCallback(async (programIds: string[]) => {
        const missing = programIds.filter(id => id && !requested.current.has(id))
        missing.forEach(id => requested.current.add(id))
        if (!missing.length) return
        const entries = await Promise.all(
            missing.map(async id => {
                try {
                    return [id, await fetchProgramQuestionMap(id)] as const
                } catch (e) {
                    console.error('[applications] onboarding questions failed for', id, e)
                    return [id, {}] as const
                }
            })
        )
        setQuestionMaps(prev => ({ ...prev, ...Object.fromEntries(entries) }))
    }, [])

    const load = useCallback(async () => {
        if (!hasApplicationScope(scope)) {
            setApplications([])
            return
        }
        setLoading(true)
        try {
            const constraints: QueryConstraint[] = []
            if ((isRestrictedRole || !isAllPrograms) && activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }
            const snap = await getDocs(query(collection(db, 'applications'), ...constraints))
            let apps = snap.docs.map(normalizeApplication)
            if (!isControlAccount) apps = apps.filter(a => !isInternalEmail(a.email))
            setApplications(apps)
            void loadQuestionMaps(Array.from(new Set(apps.map(a => String(a.programId || '').trim()))))
        } catch (e) {
            console.error('[applications] load failed:', e)
            message.error('Failed to load applications')
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProgramId, isAllPrograms, isRestrictedRole, isControlAccount, loadQuestionMaps])

    useEffect(() => {
        void load()
    }, [load])

    const refreshOne = useCallback(async (id: string) => {
        const snap = await getDoc(doc(db, 'applications', id))
        if (!snap.exists()) {
            setApplications(prev => prev.filter(a => a.id !== id))
            return null
        }
        const next = normalizeApplication(snap)
        setApplications(prev => prev.map(a => (a.id === id ? next : a)))
        return next
    }, [])

    return { applications, loading, reload: load, refreshOne, questionMaps }
}
