import { getAuth } from 'firebase/auth'
import { AI_BASE_URL } from '@/services/aiAssistantService'

// Automatic evidence checks: the ai-backend reads an MOV's evidence (the POE files,
// signed MOV and notes), records the result on the MOV as `evidenceCheck` and
// returns it. Reviewers see it before approving; facilitators see what to fix.

export type EvidenceVerdict = 'strong' | 'adequate' | 'weak' | 'missing' | 'unreadable'

export type EvidenceCheck = {
    verdict: EvidenceVerdict
    summary: string
    issues: string[]
    outcomes: { label: string; value: number; unit: string; source: string }[]
    files: {
        label: string
        readable: boolean
        matchesIntervention: 'yes' | 'partly' | 'no' | null
        namesSme: boolean | null
        dated: 'in_period' | 'outside_period' | 'undated' | null
        signed: boolean | null
        note: string
    }[]
    checkedAt: string | { toDate: () => Date } | null
    checkedBy: string
    checkedLinks: string[]
}

export const EVIDENCE_VERDICT: Record<EvidenceVerdict, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
    strong: { label: 'Strong evidence', tone: 'success' },
    adequate: { label: 'Adequate evidence', tone: 'info' },
    weak: { label: 'Weak evidence', tone: 'warning' },
    missing: { label: 'No evidence', tone: 'danger' },
    unreadable: { label: 'Evidence unreadable', tone: 'neutral' }
}

export async function checkMovEvidence(movId: string): Promise<EvidenceCheck> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Please sign in again.')
    const response = await fetch(`${AI_BASE_URL}/evidence/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ movId })
    })
    if (!response.ok) {
        const detail = await response.json().catch(() => null)
        throw new Error(detail?.detail || 'The evidence check is not available right now.')
    }
    return response.json() as Promise<EvidenceCheck>
}

/** Starts checks in the background, e.g. right after completion. Failures are only logged. */
export function checkMovEvidenceInBackground(movIds: string[]) {
    movIds.filter(Boolean).forEach(id => {
        checkMovEvidence(id).catch(error => console.warn('Evidence check did not run for', id, error))
    })
}

/**
 * True when evidence was added after the last check. Only additions count: the
 * check also reads the signed MOV, which the screen's evidence list may not show.
 */
export function isEvidenceCheckStale(check: EvidenceCheck | null | undefined, currentLinks: string[]) {
    if (!check) return false
    const checked = new Set(check.checkedLinks || [])
    return currentLinks.some(link => !checked.has(link))
}

export const checkedAtDate = (value: EvidenceCheck['checkedAt']): Date | null => {
    if (!value) return null
    if (typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    return typeof value.toDate === 'function' ? value.toDate() : null
}
