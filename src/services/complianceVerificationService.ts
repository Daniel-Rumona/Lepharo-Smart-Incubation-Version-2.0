import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-inc.hf.space'
).replace(/\/$/, '')

export type ComplianceVerificationStatus = 'valid' | 'pending' | 'invalid' | 'expired' | string

/**
 * The AI's suggestion for a document, stored on it as `aiReview` by the AI
 * backend (ai-backend/compliance_check.py). Staff accept or reject it; it never
 * changes the status itself, except to expired when the recorded dates say so.
 */
export type ComplianceAiReview = {
    recommendation: 'valid' | 'invalid' | 'expired' | 'unclear'
    reason: string
    confidence: 'high' | 'medium' | 'low'
    /** What the AI read from the file; only fields it found. */
    extracted: {
        issueDate?: string
        expiryDate?: string
        holderName?: string
        registrationNumber?: string
        idNumber?: string
    }
    /** The registration number on the file compared with the SME's. */
    identity: 'match' | 'mismatch' | 'unknown'
    /** YYYY-MM-DD, from the requirement's rule and the dates recorded or read. */
    expiresOn?: string
    /** The file that was checked; a replaced file needs a new check. */
    url: string
    model?: string
    checkedAt?: string
    checkedBy?: string
}

export type ComplianceVerificationResult = {
    applicationId: string
    documentId: string
    status: ComplianceVerificationStatus
    note: string
    aiReview?: ComplianceAiReview
}

export async function verifyComplianceDocument(
    applicationId: string,
    documentId: string
): Promise<ComplianceVerificationResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to run AI verification.')
    }

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}/compliance/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ applicationId, documentId })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `AI verification failed (${response.status}).`)
    }

    return data as ComplianceVerificationResult
}

export type BatchVerifyTarget = {
    applicationId: string
    documentId: string
    label?: string
}

export type BatchVerifyOutcome = BatchVerifyTarget & {
    ok: boolean
    status?: ComplianceVerificationStatus
    note?: string
    aiReview?: ComplianceAiReview
    error?: string
}

export type BatchVerifyOptions = {
    // Kept low deliberately: each verification can cost an AI call against a
    // shared, rate-limited quota — a large fan-out risks 429s mid-batch.
    concurrency?: number
    onProgress?: (completed: number, total: number, outcome: BatchVerifyOutcome) => void
}

export async function verifyComplianceDocumentsBatch(
    targets: BatchVerifyTarget[],
    options: BatchVerifyOptions = {}
): Promise<BatchVerifyOutcome[]> {
    const concurrency = Math.max(1, options.concurrency ?? 2)
    const results: BatchVerifyOutcome[] = new Array(targets.length)
    let cursor = 0
    let completed = 0

    const runNext = async (): Promise<void> => {
        const index = cursor++
        if (index >= targets.length) return
        const target = targets[index]

        try {
            const result = await verifyComplianceDocument(target.applicationId, target.documentId)
            const outcome: BatchVerifyOutcome = {
                ...target,
                ok: true,
                status: result.status,
                note: result.note,
                aiReview: result.aiReview
            }
            results[index] = outcome
            completed += 1
            options.onProgress?.(completed, targets.length, outcome)
        } catch (error: any) {
            const outcome: BatchVerifyOutcome = {
                ...target,
                ok: false,
                error: error?.message || 'AI verification failed.'
            }
            results[index] = outcome
            completed += 1
            options.onProgress?.(completed, targets.length, outcome)
        }

        await runNext()
    }

    const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => runNext())
    await Promise.all(workers)

    return results
}

/** The AI's reading of a file an applicant has chosen, before it is uploaded. */
export type ApplicationPrecheck = {
    review: Omit<ComplianceAiReview, 'url' | 'checkedAt' | 'checkedBy'>
    /** The programme's own rules for this document. */
    requirement: { title: string; hasExpiry: boolean; expiryMonths?: number | null }
    /** Checks this applicant has left today. */
    checksLeft: number
}

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('The file could not be read.'))
        reader.readAsDataURL(file)
    })

/**
 * Advice while an SME applies: the AI backend reads the file as they choose it
 * (POST /compliance/precheck) and says whether it looks like the required,
 * current document, with the dates printed on it. Nothing is stored and it
 * never decides anything; staff still verify every document.
 */
export async function precheckApplicationDocument(input: {
    programId: string
    requirementKey: string
    requirementTitle: string
    participantId?: string | null
    file: File
}): Promise<ApplicationPrecheck> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to check this document.')

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}/compliance/precheck`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            programId: input.programId,
            requirementKey: input.requirementKey,
            requirementTitle: input.requirementTitle,
            participantId: input.participantId || '',
            fileBase64: await readAsDataUrl(input.file),
            fileName: input.file.name,
            mimeType: input.file.type
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `The document check failed (${response.status}).`)
    }
    return data as ApplicationPrecheck
}
