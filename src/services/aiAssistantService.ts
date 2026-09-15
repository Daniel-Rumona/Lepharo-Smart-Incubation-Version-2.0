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

export type AskAssistantResult = {
    answer: string
    chart: ChartSpec | null
    guide: CatalogGuide | null
    sources: string[]
    sessionId?: string
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
        sources: Array.isArray(data.sources) ? data.sources.filter((s: unknown) => typeof s === 'string') : [],
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined
    }
}
