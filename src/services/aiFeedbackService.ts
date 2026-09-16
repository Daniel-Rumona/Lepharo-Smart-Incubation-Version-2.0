import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export type AiFeedbackAction = 'accepted' | 'edited' | 'declined'

export interface AiFeedbackItem {
    /** What kind of thing this was, e.g. "numericTarget", "field:serviceName". */
    entityType: string
    /** What the AI suggested (any JSON-serialisable value). */
    suggested?: unknown
    /** What the user actually kept. Omit/undefined when declined outright. */
    final?: unknown
    action: AiFeedbackAction
    /** Optional free-text reason the user gave for the change, if collected. */
    reason?: string
}

/**
 * Log what a user did with a batch of AI-drafted suggestions, for a given
 * `feature` key. Reusable by any AI-drafting flow — pass your own feature
 * name (e.g. "kpi_agreement") and this posts to the same shared backend
 * endpoint, which future drafts for that feature will learn from.
 *
 * Fire-and-forget by design: a logging failure must never block or surface
 * as an error on the caller's actual save, so this resolves to `null`
 * instead of throwing.
 */
export async function recordAiFeedback(
    feature: string,
    items: AiFeedbackItem[],
    sourceExcerpt?: string
): Promise<{ written: number } | null> {
    if (!items.length) return { written: 0 }

    try {
        const firebaseUser = getAuth().currentUser
        if (!firebaseUser) return null

        const token = await firebaseUser.getIdToken()
        const response = await fetch(`${AI_BACKEND_URL}/ai-feedback/record`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ feature, items, sourceExcerpt })
        })

        if (!response.ok) return null
        return await response.json()
    } catch (error) {
        console.warn('recordAiFeedback failed (non-fatal):', error)
        return null
    }
}

/**
 * Compare one AI-suggested scalar field to what the user actually saved and
 * push the right feedback item, if any. Reusable by any review-before-save
 * flow — skips fields the AI never suggested anything for in the first
 * place (nothing to learn from there).
 */
export function diffScalarFeedback(
    entityType: string,
    suggested: unknown,
    final: unknown,
    items: AiFeedbackItem[]
): void {
    const suggestedText = suggested == null ? '' : String(suggested).trim()
    const finalText = final == null ? '' : String(final).trim()
    if (!suggestedText) return

    if (!finalText) {
        items.push({ entityType, suggested, final: null, action: 'declined' })
        return
    }
    items.push({
        entityType,
        suggested,
        final,
        action: suggestedText === finalText ? 'accepted' : 'edited'
    })
}

/**
 * Compare an AI-suggested list of rows to the final saved list, positionally.
 * Rows the AI suggested that no longer exist in `final` are logged as
 * declined; rows still present are accepted/edited depending on whether they
 * changed. Rows the user added beyond the AI's suggestions are not the AI's
 * work, so they're skipped — there's nothing to learn from a fresh addition.
 */
export function diffArrayFeedback(
    entityType: string,
    suggestedRows: unknown[],
    finalRows: unknown[],
    items: AiFeedbackItem[]
): void {
    suggestedRows.forEach((suggested, index) => {
        const final = finalRows[index]
        if (final === undefined) {
            items.push({ entityType, suggested, final: null, action: 'declined' })
            return
        }
        const unchanged = JSON.stringify(suggested) === JSON.stringify(final)
        items.push({ entityType, suggested, final, action: unchanged ? 'accepted' : 'edited' })
    })
}
