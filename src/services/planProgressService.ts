import { getAuth } from 'firebase/auth'

// @ts-ignore Vite supplies import.meta.env; the repository tsc config uses CommonJS.
const env = import.meta.env
const AI_BASE_URL = String(env.VITE_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-inc.hf.space').replace(/\/$/, '')

export type ProgressVerdict = 'on_track' | 'behind' | 'complete' | 'not_due' | 'insufficient_evidence'
export type PlanProgressResult = {
    documentId: string
    planTitle: string
    departmentName: string
    asOf: string
    checkedAt: string
    overall: ProgressVerdict
    summary: string
    milestones: {
        title: string
        planBasis: string
        target: string
        dueDate: string | null
        dateConfidence: 'exact' | 'inferred' | 'unknown'
        status: ProgressVerdict
        observed: string
        evidenceRefs: string[]
    }[]
    nextSteps: string[]
    limitations: string[]
    metrics: {
        assignments: number
        completedAssignments: number
        overdueAssignments: number
        uniqueSmmes: number
        movs: number
        approvedMovs: number
    }
    evidence: {
        ref: string
        title: string
        detail: string
        businessName: string
        status: string
        dueDate: string | null
        completedAt: string | null
        deliveryDate: string | null
        participantConfirmed: boolean
        approvedByHod: boolean
        evidenceAttached: boolean
        notes: string[]
    }[]
}

export async function checkPlanProgress(documentId: string, signal: AbortSignal): Promise<PlanProgressResult> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Please sign in again to check progress.')
    const response = await fetch(`${AI_BASE_URL}/plans/check-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ documentId }),
        signal
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
        if (response.status === 404) throw new Error('The plan or AI progress service is unavailable. Refresh the page, or ask your administrator to check the AI backend deployment.')
        throw new Error(typeof result.detail === 'string' ? result.detail : `Progress could not be checked (${response.status}). Please retry.`)
    }
    if (result.documentId !== documentId || !Array.isArray(result.milestones) || !result.metrics || !Array.isArray(result.evidence)) {
        throw new Error('The AI service returned an incomplete assessment. Please retry.')
    }
    return result as PlanProgressResult
}
