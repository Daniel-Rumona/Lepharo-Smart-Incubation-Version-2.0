import { getAuth } from 'firebase/auth'
import type { TwinFacts } from './twinAsk'

// Vite injects import.meta.env; the same variable and default as the Data Assistant.
// @ts-ignore import.meta is not accepted by this project's tsc module setting
const viteEnv: Record<string, string | undefined> | undefined = import.meta?.env
const AI_BASE_URL = String(
    viteEnv?.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-inc.hf.space'
).replace(/\/$/, '')

export type TwinAction =
    | { kind: 'records'; stage: string; label: string }
    | { kind: 'scenario'; change: string; label: string }

export type TwinAnswer = { answer: string; stages: string[]; action: TwinAction | null }

/** Asks the twin a question; answered only from the facts sent. Throws when the assistant can't answer. */
export async function askTwin(
    question: string,
    facts: TwinFacts,
    previous: { question: string; answer: string }[],
    signal?: AbortSignal
): Promise<TwinAnswer> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Not signed in.')
    const response = await fetch(`${AI_BASE_URL}/twin/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ question, facts, previous: previous.slice(-2) }),
        signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || `The twin couldn't answer that (${response.status}).`)
    return {
        answer: String(data.answer || ''),
        stages: Array.isArray(data.stages) ? data.stages.map(String) : [],
        action: data.action && (data.action.kind === 'records' || data.action.kind === 'scenario') ? data.action : null
    }
}
