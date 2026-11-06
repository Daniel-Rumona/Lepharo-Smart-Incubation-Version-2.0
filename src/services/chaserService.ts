import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '@/firebase'
import type { ChaserItem, ChaserSpec } from '../../functions/src/chasersLogic'

// Chasers (functions/src/chasers.ts): a fixed list of MOVs the assistant gets moving by a deadline,
// nudging whoever has to act within a set allowance and asking before it escalates. The assistant
// drafts one from the person's words; nothing is sent until they press Start chasing. Each person
// reads only their own chasers; manageChaser does every write.

export type { ChaserItem, ChaserSpec }
export type ChaserDraft = Partial<ChaserSpec> & { deadline: string }

export type ChaserPreview = {
    id?: string
    spec?: ChaserSpec
    description?: string
    items?: Array<{ label: string; waitingOn: string }>
    /** Starting it found the same chaser already running. */
    alreadyChasing?: boolean
    nudged?: number
    choose?: { field: 'programme'; options: Array<{ id: string; name: string }> }
    problem?: string
}

export type Chaser = {
    id: string
    description: string
    status: 'active' | 'done' | 'ended' | 'expired'
    spec: ChaserSpec
    items: ChaserItem[]
    log: Array<{ at: number; text: string }>
    createdAt: number
}

const manage = <T,>(data: Record<string, unknown>) =>
    httpsCallable<Record<string, unknown>, T>(functions, 'manageChaser')(data).then(result => result.data)

export const normaliseChaserDraft = (raw: unknown): ChaserDraft | null =>
    raw && typeof raw === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String((raw as any).deadline || '')) ? (raw as ChaserDraft) : null

export const previewChaser = (spec: ChaserDraft) => manage<ChaserPreview>({ action: 'preview', spec })
export const startChaser = (spec: ChaserDraft, words?: string) => manage<ChaserPreview>({ action: 'create', spec, words })
export const endChaser = (id: string) => manage<{ id: string; status: string }>({ action: 'end', id })
/** One more nudge for the items that used their allowance. */
export const extendChaser = (id: string) => manage<{ id: string; extended?: number; nudged?: number; problem?: string }>({ action: 'extend', id })
/** Tell the line managers of whoever the waiting items are stuck with. */
export const escalateChaser = (id: string) => manage<{ id: string; escalated?: string[]; problem?: string }>({ action: 'escalate', id })

const millis = (value: any) => (value?.toMillis ? value.toMillis() : Number(value) || 0)

/** The person's chasers, running ones first, then the newest. */
export async function listMyChasers(): Promise<Chaser[]> {
    const uid = auth.currentUser?.uid
    if (!uid) return []
    const snapshot = await getDocs(query(collection(db, 'chasers'), where('ownerUid', '==', uid)))
    return snapshot.docs
        .map(item => {
            const data = item.data() as any
            return {
                id: item.id,
                description: String(data.description || ''),
                status: data.status,
                spec: data.spec,
                items: Array.isArray(data.items) ? data.items : [],
                log: Array.isArray(data.log) ? data.log : [],
                createdAt: millis(data.createdAt)
            } as Chaser
        })
        .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.createdAt - a.createdAt)
}

/** Items waiting on the owner's decision: they used their nudges and are still stuck. */
export const waitingOnYou = (chaser: Chaser) => chaser.items.filter(item => !item.done && item.asked && !item.escalated)
