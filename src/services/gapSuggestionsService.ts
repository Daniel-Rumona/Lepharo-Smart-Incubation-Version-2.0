import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    SECTION_ADAPTERS,
    SectionKey,
    getOwnedSectionsForDept
} from '@/routes/gap/sections'
import { mapGapToInterventions } from './gapInterventionMappingService'
import type { DepartmentRoleKey } from './departmentRoleLogic'

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

const gapMillis = (gap: any) => {
    const v = gap?.submittedAt || gap?.createdAt || gap?.updatedAt
    if (!v) return 0
    if (typeof v?.toMillis === 'function') return v.toMillis()
    if (typeof v?.seconds === 'number') return v.seconds * 1000
    const ms = new Date(v).getTime()
    return Number.isFinite(ms) ? ms : 0
}

/**
 * A participant's current GAP Analysis for a programme: the latest one filed
 * for it, or — for records from before GAPs carried a programId — the latest
 * one with no programme. GAPs from other programmes never count.
 */
export function pickLatestGap<T extends { programId?: string }>(gaps: T[], programId?: string | null): T | null {
    const pid = String(programId || '')
    const inScope = gaps.filter(g => !pid || !g?.programId || String(g.programId) === pid)
    const own = pid ? inScope.filter(g => String(g?.programId || '') === pid) : []
    const pool = own.length ? own : inScope
    return pool.reduce<T | null>((best, g) => (!best || gapMillis(g) > gapMillis(best) ? g : best), null)
}

export const isConfirmed = (gap: any) =>
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
    departmentRole: DepartmentRoleKey | null | undefined,
    catalogueTitles: Map<string, string>,
    programId?: string | null
): Promise<GapSuggestionsResult> {
    const sections = getOwnedSectionsForDept(departmentRole)
    if (!participantId || !sections.length) return EMPTY

    // Not limit(1): that returned an arbitrary GAP, possibly an old or other-programme one.
    const snap = await getDocs(
        query(
            collection(db, 'gapAnalysis'),
            where('participantId', '==', String(participantId))
        )
    )
    const gap = pickLatestGap(
        snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
        programId
    )
    if (!gap) return EMPTY

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
