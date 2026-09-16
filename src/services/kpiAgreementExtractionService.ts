import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export interface ExtractedKpiNumericTarget {
    kpiName: string
    annual: number
    q1: number
    q2: number
    q3: number
    q4: number
}

export interface ExtractedKpiDeliverable {
    kpiArea: string
    deliverable: string
    measurementIndicator: string
    frequency: string
}

export interface KpiAgreementExtractionResult {
    serviceName: string
    fyLabel: string
    formNo: string
    revisionNo: string
    effectiveDate: string
    monthlyCapacity: string
    numericTargets: ExtractedKpiNumericTarget[]
    deliverables: ExtractedKpiDeliverable[]
    warnings: string[]
}

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

/**
 * Ask the AI backend to read an uploaded KPI agreement letter (LEP-QMS 054 F)
 * and draft a structured agreement for the user to review before saving.
 * Nothing is persisted by this call - it only returns a draft.
 */
export async function extractKpiAgreement(file: File): Promise<KpiAgreementExtractionResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to import a KPI agreement.')
    }

    const fileBase64 = await readFileAsBase64(file)
    const token = await firebaseUser.getIdToken()

    const response = await fetch(`${AI_BACKEND_URL}/kpi/extract-agreement`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            fileBase64,
            fileName: file.name,
            mimeType: file.type
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `KPI agreement extraction failed (${response.status}).`)
    }

    return data as KpiAgreementExtractionResult
}

export interface KpiAgreementChatMessage {
    role: 'user' | 'assistant'
    content: string
}

export interface KpiAgreementChatTurnResult {
    done: boolean
    message: string
    draft: KpiAgreementExtractionResult | null
}

/**
 * Send one turn of the KPI agreement conversation. The caller holds the
 * message history and resends it each turn (the backend is stateless); once
 * the response comes back `done`, `draft` is the same shape the document
 * upload path returns, so the review screen is shared between both.
 */
export async function sendKpiAgreementChatTurn(
    messages: KpiAgreementChatMessage[]
): Promise<KpiAgreementChatTurnResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to use the KPI assistant.')
    }

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}/kpi/agreement-chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ messages })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `The assistant is unavailable (${response.status}).`)
    }

    return data as KpiAgreementChatTurnResult
}
