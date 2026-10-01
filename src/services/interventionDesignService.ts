import { getAuth } from 'firebase/auth'
import type { OutcomeType } from '@/services/evidenceModel'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export type DesignStep = 'outcomes' | 'schedule' | 'breakdown'

export type OutcomeOption = {
    deliverableName: string
    deliverableDescription: string
    intendedOutcome: string
    outcomeType: OutcomeType | ''
    followUpAfterDays: number
}

export type ScheduleOption = {
    label: string
    rationale: string
    frequency: 'as-needed' | 'weekly' | 'bi-weekly' | 'monthly'
    strict: boolean
    endMode: 'fixed-cycles' | 'until-closed' | 'programme-end' | ''
    cycles: number
    plannedSessions: number
}

export type BreakdownOption = {
    label: string
    rationale: string
    hasSubInterventions: boolean
    rotationMode: 'rotate' | 'repeat'
    subInterventions: { title: string; defaultPlannedSessions: number }[]
    plannedSessions: number
}

type OptionsByStep = {
    outcomes: OutcomeOption
    schedule: ScheduleOption
    breakdown: BreakdownOption
}

export type DesignDraft = {
    deliverableName?: string
    intendedOutcome?: string
    recurrencePreset?: string
}

// Answers are reused for the same title and constraints, so going back and
// forth, or reopening the wizard, costs nothing. Two identical requests made
// at once share one call. Failures are never cached. The key is the title and
// constraints (not the wording picked in earlier steps), so the same intervention
// is asked about once per step.
const CACHE_TTL_MS = 30 * 60 * 1000
const answers = new Map<string, { at: number; value: { message: string; options: any[] } }>()
const inFlight = new Map<string, Promise<{ message: string; options: any[] }>>()

const cacheKey = (step: DesignStep, input: { title: string; context: string; departmentId: string; draft: DesignDraft }) =>
    [step, input.departmentId, input.title.trim().toLowerCase(), input.context.trim().toLowerCase()].join('|')

/**
 * Ask the assistant for cards for one wizard step. Suggestion-only: nothing is
 * saved. Throws with a readable message when the assistant is unavailable, and
 * the wizard falls back to manual entry.
 */
export async function suggestForStep<S extends DesignStep>(
    step: S,
    input: { title: string; context: string; departmentId: string; draft: DesignDraft }
): Promise<{ message: string; options: OptionsByStep[S][] }> {
    const key = cacheKey(step, input)
    const cached = answers.get(key)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value as any
    const pending = inFlight.get(key)
    if (pending) return pending as any

    const request = fetchSuggestions(step, input)
        .then((value) => {
            answers.set(key, { at: Date.now(), value })
            return value
        })
        .finally(() => inFlight.delete(key))
    inFlight.set(key, request)
    return request as any
}

async function fetchSuggestions(
    step: DesignStep,
    input: { title: string; context: string; departmentId: string; draft: DesignDraft }
): Promise<{ message: string; options: any[] }> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to use the assistant.')
    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}/intervention/design-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ step, ...input })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `The assistant is unavailable (${response.status}).`)
    }
    return {
        message: String(data?.message || ''),
        options: Array.isArray(data?.options) ? data.options : []
    }
}
