import { getAuth } from 'firebase/auth'
import { SECTION_ADAPTERS, SectionKey } from '@/routes/gap/sections'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export type GapMappingEdge = {
    questionIndex: number
    interventionId: string
    confidence: number
    rationale: string
}

export type GapMappingGap = {
    questionIndex: number
    question: string
    answer: string
    comment: string
}

export type GapMappingIntervention = {
    id: string
    title: string
    areaOfSupport: string
}

export type GapMappingSection = {
    section: SectionKey
    departmentName: string
    gaps: GapMappingGap[]
    interventions: GapMappingIntervention[]
    edges: GapMappingEdge[]
    note: string
}

export type GapMappingResult = {
    gapId: string
    generatedAt: string
    cached: boolean
    sections: GapMappingSection[]
}

/**
 * Ask the AI backend to map a GAP's unmet answers onto the interventions the
 * owning department offers.
 *
 * Only question wording travels from here — the backend reads the answers from
 * the GAP document and narrows the sections to whatever the caller's stored
 * department allows, so this list is a request, not a grant.
 */
export async function mapGapToInterventions(
    gapId: string,
    sections: SectionKey[],
    options: { regenerate?: boolean } = {}
): Promise<GapMappingResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to run intervention mapping.')
    }

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BACKEND_URL}/gap/intervention-mapping`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            gapId,
            regenerate: !!options.regenerate,
            sections: sections.map(section => ({
                section,
                questions: SECTION_ADAPTERS[section]?.qText ?? []
            }))
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(data?.detail || `Intervention mapping failed (${response.status}).`)
    }

    return data as GapMappingResult
}
