import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export type ComplianceVerificationStatus = 'valid' | 'pending' | 'invalid' | 'expired' | string

export type ComplianceVerificationResult = {
    applicationId: string
    documentId: string
    status: ComplianceVerificationStatus
    note: string
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
                note: result.note
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
