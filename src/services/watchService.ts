import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '@/firebase'
import type { WatchSpec } from '../../functions/src/watchesLogic'

// Watches (functions/src/watches.ts): conditions checked every morning that tell the person when
// something becomes true. The assistant drafts one from their words; nothing is saved until they
// press Start watching. Each person reads only their own watches; manageWatch does every write.

export type { WatchSpec }
/** What the assistant drafted: the watch type and the names it heard, not yet matched to records. */
export type WatchDraft = Partial<WatchSpec> & {
    type: WatchSpec['type']
    /** Offered by the assistant after an answer rather than asked for: the card asks first. */
    offer?: boolean
}

export type WatchChoice = { id: string; name: string }
export type WatchPreview = {
    id?: string
    spec?: WatchSpec
    description?: string
    alreadyMatching?: string[]
    /** Starting it found the same watch already running. */
    alreadyWatching?: boolean
    choose?: { field: 'participant' | 'programme' | 'intervention'; options: WatchChoice[] }
    problem?: string
}

export type WatchFiring = { at: number; title: string; message: string; link: string }
export type Watch = {
    id: string
    description: string
    status: 'active' | 'done' | 'ended' | 'expired'
    firings: WatchFiring[]
    createdAt: number
    endsAt: number
}

const manage = <T,>(data: Record<string, unknown>) =>
    httpsCallable<Record<string, unknown>, T>(functions, 'manageWatch')(data).then(result => result.data)

const WATCH_TYPES = ['sme_risk', 'impact_reportable', 'intervention_done']
export const normaliseWatchDraft = (raw: unknown): WatchDraft | null =>
    raw && typeof raw === 'object' && WATCH_TYPES.includes((raw as any).type) ? (raw as WatchDraft) : null

export const previewWatch = (spec: WatchDraft) => manage<WatchPreview>({ action: 'preview', spec })
export const startWatch = (spec: WatchDraft, words?: string) => manage<WatchPreview>({ action: 'create', spec, words })
export const endWatch = (id: string) => manage<{ id: string; status: string }>({ action: 'end', id })
export const checkWatchNow = (id: string) => manage<{ id: string; status: string; fired: number }>({ action: 'check', id })

/** A draft with a choice made: the chosen record's id and name in place of the words. */
export function withChoice(spec: WatchDraft, field: NonNullable<WatchPreview['choose']>['field'], choice: WatchChoice): WatchDraft {
    if (field === 'participant') return { ...spec, participantId: choice.id, participantName: choice.name }
    if (field === 'programme') return { ...spec, programId: choice.id, programName: choice.name }
    return { ...spec, interventionId: choice.id, interventionTitle: choice.name }
}

const millis = (value: any) => (value?.toMillis ? value.toMillis() : Number(value) || 0)

/** The person's watches, running ones first, then the newest. */
export async function listMyWatches(): Promise<Watch[]> {
    const uid = auth.currentUser?.uid
    if (!uid) return []
    const snapshot = await getDocs(query(collection(db, 'watches'), where('ownerUid', '==', uid)))
    return snapshot.docs
        .map(item => {
            const data = item.data() as any
            return {
                id: item.id,
                description: String(data.description || ''),
                status: data.status,
                firings: Array.isArray(data.firings) ? data.firings : [],
                createdAt: millis(data.createdAt),
                endsAt: millis(data.endsAt)
            } as Watch
        })
        .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.createdAt - a.createdAt)
}
