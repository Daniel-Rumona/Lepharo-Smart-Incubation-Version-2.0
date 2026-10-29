import { getAuth } from 'firebase/auth'
import type { CatalogGuide } from '@/components/guide-me/guideCatalog'

const AI_BASE_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

export type ChartType = 'donut' | 'spline'

export type ChartSeries = {
    name: string
    data: number[]
}

export type ChartSpec = {
    type: ChartType
    title: string | null
    subtitle: string | null
    categories: string[]
    series: ChartSeries[]
}

export const normaliseChart = (raw: unknown): ChartSpec | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>

    const type = value.type === 'donut' || value.type === 'spline' ? value.type : null
    const categories = Array.isArray(value.categories)
        ? value.categories.map(item => String(item))
        : null
    const rawSeries = Array.isArray(value.series) ? value.series : null

    if (!type || !categories || !categories.length || !rawSeries) return null

    const series = rawSeries.reduce<ChartSeries[]>((acc, entry) => {
        if (!entry || typeof entry !== 'object') return acc
        const record = entry as Record<string, unknown>
        const data = Array.isArray(record.data) ? record.data.map(Number) : null
        const name = typeof record.name === 'string' ? record.name : ''
        if (!name || !data || data.length !== categories.length || data.some(Number.isNaN)) {
            return acc
        }
        acc.push({ name, data })
        return acc
    }, [])

    if (!series.length) return null

    return {
        type,
        title: typeof value.title === 'string' ? value.title : null,
        subtitle: typeof value.subtitle === 'string' ? value.subtitle : null,
        categories,
        series
    }
}

export type AiUserContext = {
    uid?: string | null
    email?: string | null
    role?: string | null
    participantId?: string | null
    consultantId?: string | null
    departmentId?: string | null
    programId?: string | null
}

export type AskAssistantParams = {
    message: string
    route: string
    user: AiUserContext
    pageContext?: Record<string, unknown>
    history?: { role: 'user' | 'assistant'; content: string }[]
    sessionId?: string
    signal?: AbortSignal
    /** For dedicated chart-replot UIs — biases the backend toward always
     * producing a chart and keeps the prose answer to a short caption. */
    chartOnly?: boolean
}

/** An interactive flow the backend proposes opening (the user completes it in a form). */
export type AssistantAction = {
    kind: 'schedule_appointment'
    sme: string | null
}

/** A page the assistant offers to open and walk the user through. */
export type ShowMeRequest = {
    route: string
    label: string
    goal: string
}

export type AgentProposalKind =
    | 'schedule_appointment'
    | 'create_task'
    | 'send_nudge'
    | 'send_compliance_reminder'
    | 'assign_intervention'

/** A change the assistant drafted. Nothing happens until the agentProposeAction
 * function validates it and the user confirms the result. */
export type AgentProposalDraft = {
    kind: AgentProposalKind
    params: Record<string, unknown>
}

export type AskAssistantResult = {
    answer: string
    chart: ChartSpec | null
    guide: CatalogGuide | null
    action: AssistantAction | null
    showMe: ShowMeRequest | null
    proposal: AgentProposalDraft | null
    sources: string[]
    sessionId?: string
}

const PROPOSAL_KINDS: AgentProposalKind[] = [
    'schedule_appointment',
    'create_task',
    'send_nudge',
    'send_compliance_reminder',
    'assign_intervention'
]

const normaliseShowMe = (raw: unknown): ShowMeRequest | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.route !== 'string' || !value.route.startsWith('/')) return null
    return {
        route: value.route,
        label: typeof value.label === 'string' ? value.label : '',
        goal: typeof value.goal === 'string' ? value.goal : ''
    }
}

const normaliseProposal = (raw: unknown): AgentProposalDraft | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    const kind = PROPOSAL_KINDS.find(item => item === value.kind)
    if (!kind) return null
    const params = value.params && typeof value.params === 'object'
        ? value.params as Record<string, unknown>
        : {}
    return { kind, params }
}

const normaliseAction = (raw: unknown): AssistantAction | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (value.kind !== 'schedule_appointment') return null
    return {
        kind: 'schedule_appointment',
        sme: typeof value.sme === 'string' && value.sme.trim() ? value.sme.trim() : null
    }
}

const normaliseGuide = (raw: unknown): CatalogGuide | null => {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>

    const pageId = typeof value.pageId === 'string' ? value.pageId : null
    const guideId = typeof value.guideId === 'string' ? value.guideId : null
    const route = typeof value.route === 'string' ? value.route : null

    if (!pageId || !guideId || !route) return null

    return {
        pageId,
        guideId,
        route,
        pageTitle: typeof value.title === 'string' ? value.title : '',
        title: typeof value.title === 'string' ? value.title : '',
        description: ''
    }
}

export async function askAssistant(params: AskAssistantParams): Promise<AskAssistantResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to use the assistant.')

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            message: params.message,
            sessionId: params.sessionId || null,
            route: params.route,
            language: navigator.language?.split('-')[0] || 'en',
            user: params.user,
            pageContext: params.pageContext || {},
            history: params.history || [],
            chartOnly: params.chartOnly || false
        }),
        signal: params.signal
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            data?.detail || data?.error || `The assistant returned an error (${response.status}).`
        )
    }

    return {
        answer:
            String(data.answer || data.reply || '').trim() ||
            'I could not find enough data to answer that.',
        chart: normaliseChart(data.chart),
        guide: normaliseGuide(data.guide),
        action: normaliseAction(data.action),
        showMe: normaliseShowMe(data.showMe),
        proposal: normaliseProposal(data.proposal),
        sources: Array.isArray(data.sources) ? data.sources.filter((s: unknown) => typeof s === 'string') : [],
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined
    }
}

export type ComposedTour = {
    guideId: string | null
    intro: string
    steps: { target: string | null; title: string; description: string }[]
}

/**
 * Asks the backend to turn a goal into a tour of the page that is open now. Only the
 * route, the page's guide titles and the visible labels of its guide targets are sent.
 */
export async function composeTour(params: {
    goal: string
    route: string
    pageTitle?: string
    targets: { name: string; text: string; kind: string }[]
    guides: { id: string; title: string; description?: string }[]
}): Promise<ComposedTour> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to use the assistant.')

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BASE_URL}/guide/compose`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            goal: params.goal.slice(0, 400),
            route: params.route.slice(0, 200),
            pageTitle: (params.pageTitle || '').slice(0, 120),
            targets: params.targets.slice(0, 120),
            guides: params.guides.slice(0, 30).map(guide => ({
                id: guide.id.slice(0, 80),
                title: guide.title.slice(0, 160),
                description: (guide.description || '').slice(0, 300)
            }))
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.detail || `The tour could not be prepared (${response.status}).`)

    return {
        guideId: typeof data.guideId === 'string' ? data.guideId : null,
        intro: typeof data.intro === 'string' ? data.intro : '',
        steps: Array.isArray(data.steps)
            ? data.steps
                .filter((step: any) => step && typeof step.title === 'string')
                .map((step: any) => ({
                    target: typeof step.target === 'string' ? step.target : null,
                    title: step.title,
                    description: String(step.description || '')
                }))
            : []
    }
}

/**
 * Turns a reply into speech via the backend's /tts route (ElevenLabs,
 * keyed server-side — no key ever reaches the client). Throws if voice
 * output isn't configured or the request fails; callers should fall back
 * to a silent/text-only experience rather than surface this as a hard error.
 */
export async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to use voice output.')

    const token = await firebaseUser.getIdToken()
    const response = await fetch(`${AI_BASE_URL}/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text }),
        signal
    })

    if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.detail || `Voice output failed (${response.status}).`)
    }

    return response.blob()
}
