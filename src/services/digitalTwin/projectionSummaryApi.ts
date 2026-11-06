import { getAuth } from 'firebase/auth'
import type { ProjectionFacts } from './projectionSummary'

const AI_BASE_URL = String(
    // @ts-ignore import.meta is not accepted by this project's tsc module setting
    (import.meta?.env as Record<string, string | undefined> | undefined)?.VITE_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

/** Asks the assistant to put the comparison into two or three sentences. Throws when it is unavailable so the built-in wording is used. */
export async function askProjectionSummary(facts: ProjectionFacts, signal?: AbortSignal): Promise<string> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Not signed in.')
    const token = await user.getIdToken()
    const response = await fetch(`${AI_BASE_URL}/twin/projection-summary`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ facts }), signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || `The assistant returned an error (${response.status}).`)
    const text = typeof data?.summary === 'string' ? data.summary.trim() : ''
    if (!text) throw new Error('Empty summary.')
    return text.slice(0, 700)
}
