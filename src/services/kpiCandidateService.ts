import { getAuth } from 'firebase/auth'
import type { KpiCandidateChatMessage, KpiCandidateDraft } from '@/types/types'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = String(reader.result || '')
            const [, base64] = result.split(',', 2)
            resolve(base64 || result)
        }
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })

const authedFetch = async (path: string, body: Record<string, unknown>) => {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to use the KPI assistant.')
    }
    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `The assistant is unavailable (${response.status}).`)
    }
    return data
}

/**
 * Ask the AI backend to read an uploaded KPI letter and draft candidate KPIs.
 * Each candidate is checked against live data sources for the given
 * department, so an obviously computable row comes back with a proposed
 * mapping instead of a flat number. Nothing is persisted by this call.
 */
export async function extractKpiCandidates(file: File, departmentId: string): Promise<KpiCandidateDraft> {
    const fileBase64 = await readFileAsBase64(file)
    const data = await authedFetch('/kpi/extract-candidates', {
        fileBase64,
        fileName: file.name,
        mimeType: file.type,
        departmentId
    })
    return data as KpiCandidateDraft
}

export interface KpiCandidateChatTurnResult {
    done: boolean
    message: string
    draft: KpiCandidateDraft | null
}

/**
 * Send one turn of the KPI drafting conversation. The caller holds the
 * message history and resends it each turn (the backend is stateless); once
 * the response comes back `done`, `draft` is the same candidate shape the
 * document upload path returns, so the review screen is shared between both.
 */
export async function sendKpiCandidateChatTurn(
    messages: KpiCandidateChatMessage[],
    departmentId: string
): Promise<KpiCandidateChatTurnResult> {
    const data = await authedFetch('/kpi/candidate-chat', { messages, departmentId })
    return data as KpiCandidateChatTurnResult
}
