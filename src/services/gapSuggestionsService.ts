import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    SECTION_ADAPTERS,
    SectionKey,
    getOwnedSectionsForDept
} from '@/routes/gap/sections'
import { mapGapToInterventions } from './gapInterventionMappingService'

export type GapSuggestion = {
    /** Intervention id from the department's own catalogue */
    id: string
    title: string
    section: SectionKey
    questionIndex: number
    question: string
    answer: string
    comment: string
    confidence: number
    rationale: string
}

export type GapSuggestionsResult = {
    gapId: string | null
    /** True when the GAP exists but ROM has not confirmed it yet */
    unconfirmed: boolean
    suggestions: GapSuggestion[]
    /** Set when a mapping had to be generated rather than read from the record */
    generated: boolean
}

const EMPTY: GapSuggestionsResult = {
    gapId: null,
    unconfirmed: false,
    suggestions: [],
    generated: false
}

type StoredEdge = {
    questionIndex?: number
    interventionId?: string
    confidence?: number
    rationale?: string
}

const isConfirmed = (gap: any) =>
    gap?.confirmationStatus === 'Confirmed' ||
    gap?.romReview?.status === 'Confirmed' ||
    !!gap?.romReview?.confirmedAt

const answerAt = (gap: any, section: SectionKey, index: number) => {
    const qas = SECTION_ADAPTERS[section]?.getQA(gap) ?? []
    const entry = qas?.[index]
    return {
        answer: String(entry?.answer || '').trim() || 'Unanswered',
        comment: String(entry?.comment || '').trim()
    }
}

/**
 * Gap-derived intervention suggestions for a department's diagnostic plan.
 *
 * Reads the mapping already saved on the GAP record and only calls the AI
 * backend for sections that have none yet, so the first planner to open the
 * builder pays for the mapping and everyone after reuses it.
 *
 * `catalogueTitles` is the department's own intervention catalogue. Anything
 * not in it is dropped: the plan builder rejects out-of-department items on
 * save, so suggesting one would only produce a dead Accept button.
 */
export async function loadGapSuggestions(
    participantId: string,
    departmentName: string,
    catalogueTitles: Map<string, string>
): Promise<GapSuggestionsResult> {
    const sections = getOwnedSectionsForDept(departmentName)
    if (!participantId || !sections.length) return EMPTY

    const snap = await getDocs(
        query(
            collection(db, 'gapAnalysis'),
            where('participantId', '==', String(participantId)),
            limit(1)
        )
    )
    if (snap.empty) return EMPTY

    const gapDoc = snap.docs[0]
    const gap = { id: gapDoc.id, ...(gapDoc.data() as any) }

    if (!isConfirmed(gap)) {
        return { ...EMPTY, gapId: gap.id, unconfirmed: true }
    }

    const stored = (gap?.interventionMapping || {}) as Record<string, any>
    const missing = sections.filter(section => !Array.isArray(stored?.[section]?.edges))

    let mapping: Record<string, { edges: StoredEdge[] }> = {}
    sections.forEach(section => {
        if (Array.isArray(stored?.[section]?.edges)) {
            mapping[section] = { edges: stored[section].edges }
        }
    })

    let generated = false
    // Nothing to match against, so spending an AI call would be pointless.
    if (missing.length && catalogueTitles.size > 0) {
        try {
            const result = await mapGapToInterventions(gap.id, missing)
            generated = true
            result.sections.forEach(entry => {
                mapping[entry.section] = { edges: entry.edges }
            })
        } catch (error) {
            // A mapping failure must not block plan building — the SME and
            // Department steps still work without any suggestions.
            console.error('Gap suggestion mapping failed', error)
        }
    }

    const suggestions: GapSuggestion[] = []
    const seen = new Set<string>()

    sections.forEach(section => {
        const questions = SECTION_ADAPTERS[section]?.qText ?? []
        const edges = mapping[section]?.edges ?? []

        edges.forEach(edge => {
            const interventionId = String(edge?.interventionId || '').trim()
            const questionIndex = Number(edge?.questionIndex)
            const title = catalogueTitles.get(interventionId)

            if (!interventionId || !title) return
            if (!Number.isInteger(questionIndex) || questionIndex < 0) return

            const key = `${interventionId}::${section}::${questionIndex}`
            if (seen.has(key)) return
            seen.add(key)

            const { answer, comment } = answerAt(gap, section, questionIndex)

            suggestions.push({
                id: interventionId,
                title,
                section,
                questionIndex,
                question: questions[questionIndex] || `Question ${questionIndex + 1}`,
                answer,
                comment,
                confidence: Math.max(0, Math.min(100, Number(edge?.confidence) || 0)),
                rationale: String(edge?.rationale || '').trim()
            })
        })
    })

    suggestions.sort((a, b) => b.confidence - a.confidence)

    return { gapId: gap.id, unconfirmed: false, suggestions, generated }
}
