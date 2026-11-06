import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { emptySources, TWIN_COLLECTIONS, type TwinSources } from '@/services/digitalTwin/processTwin'

/** Current source subscriptions, not historical event capture. Clear data immediately on scope changes. */
export function useProcessTwin(programId: string, enabled: boolean, branchId = '') {
    const key = enabled ? `${programId}:${branchId}` : ''
    const [state, setState] = useState<{key: string; sources: TwinSources; ready: string[]; error: string | null; updatedAt: number | null; cached: boolean}>({key:'', sources:emptySources(), ready:[], error:null, updatedAt:null, cached:true})
    useEffect(() => {
        setState({key, sources:emptySources(), ready:[], error:null, updatedAt:null, cached:true})
        if (!key) return
        let active = true
        const ready = new Set<string>(), cache = new Map<string, boolean>()
        const stop = TWIN_COLLECTIONS.map(name => onSnapshot(query(collection(db, name), where('programId', '==', programId),
            ...(['movDocuments', 'appointments', 'appointmentSessions', 'inquiries'].includes(name) && branchId ? [where('branchId', '==', branchId)] : [])), {includeMetadataChanges:true}, snapshot => {
            if (!active) return
            ready.add(name); cache.set(name, snapshot.metadata.fromCache)
            setState(prev => ({...prev, key, sources:{...prev.sources, [name]:snapshot.docs.map(d => ({...d.data(), id:d.id}))}, ready:[...ready], updatedAt:Date.now(), cached:[...cache.values()].some(Boolean)}))
        }, () => { if (active) setState(prev => ({...prev, error:`Cannot read ${name}. Check access and connectivity; partial results are hidden.`})) }))
        return () => { active=false; stop.forEach(unsubscribe => unsubscribe()) }
    }, [key, programId, branchId])
    const current = state.key === key ? state : {key, sources:emptySources(), ready:[], error:null, updatedAt:null, cached:true}
    return {...current, loading:!!key && current.ready.length !== TWIN_COLLECTIONS.length}
}
