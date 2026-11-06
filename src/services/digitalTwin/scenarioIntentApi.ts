import { getAuth } from 'firebase/auth'
import { normaliseIntent, type IntentContext, type ScenarioIntent } from './scenarioIntent'

// Vite injects import.meta.env; the same variable and default as the Data Assistant.
// @ts-ignore import.meta is not accepted by this project's tsc module setting
const viteEnv: Record<string, string | undefined> | undefined = import.meta?.env
const AI_BASE_URL = String(
    viteEnv?.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

/**
 * Asks the assistant to read a sentence into scenario levers. The backend only classifies the sentence; it
 * validates and converts the numbers itself, and this page validates the answer again before using it.
 * Throws when the assistant is unavailable so the caller can fall back to the built-in reader.
 */
export async function askScenarioIntent(text: string, context: IntentContext, signal?: AbortSignal): Promise<ScenarioIntent> {
    const user = getAuth().currentUser
    if (!user) throw new Error('Not signed in.')
    const token = await user.getIdToken()
    const response = await fetch(`${AI_BASE_URL}/twin/scenario-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, context }),
        signal
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || `The assistant returned an error (${response.status}).`)
    return { ...normaliseIntent(data), reader: 'assistant' }
}
