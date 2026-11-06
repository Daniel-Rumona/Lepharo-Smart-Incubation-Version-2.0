import { getAuth } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'
import { AI_BASE_URL } from '@/services/aiAssistantService'

// Session copilot: the facts of a prep brief come from the sessionBrief Cloud
// Function (which checks who may see them); the assistant only adds wording.

export type BriefSession = {
    date: string
    held: boolean | null
    title: string
    summary: string
    reasonNotHeld: string
    attendance: string
    actions: string[]
    nextFocus: string
}

export type SessionBrief = {
    appointmentId: string
    sme: { id: string; name: string; sector: string | null }
    session: { title: string; startAt: string | null; deliveryMethod: string | null; plannedCoverage: string[]; isGroup: boolean }
    intervention: { title: string; progress: number | null; dueDate: string | null }
    history: {
        previous: BriefSession[]
        heldCount: number
        attendedCount: number
        noShowCount: number
        plannedSessions: number
        openActions: string[]
        lastFocus: string
    }
    members: { name: string; riskLevel: string | null }[]
    otherInterventions: string[]
    compliance: { outstanding: number; items: string[] }
    risk: { level: string | null; trend: string | null; reasons: string[] } | null
    business: {
        month: string
        revenue: number | null
        jobs: number | null
        revenueChangePercent: number | null
        jobsChange: number | null
    } | null
    declinedBefore: number
}

export async function getSessionBrief(appointmentId: string): Promise<SessionBrief> {
    const { data } = await httpsCallable<{ appointmentId: string }, SessionBrief>(functions, 'sessionBrief')({ appointmentId })
    return data
}

async function postToAssistant<T>(path: string, body: unknown): Promise<T> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Please sign in again to use the assistant.')
    const response = await fetch(`${AI_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify(body)
    })
    if (!response.ok) {
        const detail = await response.json().catch(() => null)
        throw new Error(detail?.detail || 'The assistant is not available right now.')
    }
    return response.json() as Promise<T>
}

/** Two or three "focus today" bullets written from the brief's facts. */
export async function suggestSessionFocus(brief: SessionBrief): Promise<string[]> {
    // Only the facts the bullets need: no ids.
    const { appointmentId: _id, sme, ...facts } = brief
    const result = await postToAssistant<{ focus: string[] }>('/session/focus', {
        brief: { sme: { name: sme.name, sector: sme.sector }, ...facts }
    })
    return Array.isArray(result.focus) ? result.focus : []
}

export type CoverageDraft = {
    held: 'yes' | 'no' | null
    notHeldReason: 'no-show' | 'cancelled' | 'other' | null
    reasonNotHeld: string
    smeAttendance: 'attended' | 'no_show' | null
    summary: string
    topics: string[]
    actions: string[]
    nextFocus: string
    toCheck: string[]
}

/** A draft of the coverage form from rough notes. Nothing is saved. */
export async function draftCoverage(params: {
    notes: string
    sessionTitle: string
    interventionTitle: string
    plannedCoverage: string[]
    formalTopics: boolean
    attendanceLocked: boolean
}): Promise<CoverageDraft> {
    return postToAssistant<CoverageDraft>('/session/draft-coverage', {
        ...params,
        notes: params.notes.slice(0, 4000),
        sessionTitle: params.sessionTitle.slice(0, 200),
        interventionTitle: params.interventionTitle.slice(0, 200),
        plannedCoverage: params.plannedCoverage.slice(0, 30).map(point => point.slice(0, 300))
    })
}
