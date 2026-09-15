import { getAuth } from 'firebase/auth'

/**
 * Client for the guided course builder's AI endpoints in ai-backend/app.py.
 * Every call is authenticated with the signed-in author's Firebase ID token.
 */
export const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

/** Mirrors MAX_OUTLINE_DOCUMENTS / MAX_SURVEY_FILE_BYTES in ai-backend/app.py. */
export const MAX_OUTLINE_DOCUMENTS = 3
export const MAX_COURSE_FILE_BYTES = 10 * 1024 * 1024

export type OutlineKind = 'lesson' | 'assignment' | 'quiz' | 'test'

export type CourseAiContext = {
    title?: string
    description?: string
    audience?: string
    level?: string
    goal?: string
}

export type OutlineItem = {
    kind: OutlineKind
    title: string
    minutes: number
    summary: string
    /** Facts taken from the author's documents, used to ground drafting. */
    notes: string
    suggested: boolean
}

export type CourseOutline = {
    title: string
    description: string
    modules: { title: string; items: OutlineItem[] }[]
    warnings: string[]
}

export type DraftedQuestion = {
    text: string
    options: string[]
    answer: number
    feedback: string
}

export type DraftedItem = {
    objective: string
    content: string
    minutes: number | null
    rubric: string
    submissionType: 'text' | 'file' | 'either' | null
    questions: DraftedQuestion[]
    warnings: string[]
}

export type AssistAction =
    | 'simplify'
    | 'shorten'
    | 'example'
    | 'objective'
    | 'rubric'
    | 'instructions'
    | 'description'

export type SuggestedItem = {
    moduleIndex: number
    kind: OutlineKind
    title: string
    minutes: number
    reason: string
}

export const readAsBase64 = (file: File | Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('The document could not be read.'))
        reader.onload = () => {
            const result = String(reader.result || '')
            resolve(result.slice(result.indexOf(',') + 1))
        }
        reader.readAsDataURL(file)
    })

export async function aiBackendPost<T>(path: string, body: unknown, failure: string): Promise<T> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) throw new Error('Please sign in again to use AI help.')
    const token = await firebaseUser.getIdToken()
    let response: Response
    try {
        response = await fetch(`${AI_BACKEND_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
        })
    } catch {
        throw new Error(`${failure} The AI service could not be reached — check your connection and try again.`)
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : ''
        throw new Error(detail || `${failure} (${response.status})`)
    }
    return data as T
}

export async function draftOutline(brief: {
    mode: 'describe' | 'documents'
    topic?: string
    audience?: string
    goal?: string
    level: string
    length: 'short' | 'medium' | 'long'
    include: string[]
    documents?: File[]
}): Promise<CourseOutline> {
    const documents = await Promise.all(
        (brief.documents || []).map(async file => {
            if (file.size > MAX_COURSE_FILE_BYTES)
                throw new Error(`"${file.name}" is larger than ${MAX_COURSE_FILE_BYTES / (1024 * 1024)}MB.`)
            return { fileBase64: await readAsBase64(file), fileName: file.name, mimeType: file.type }
        })
    )
    const data = await aiBackendPost<CourseOutline>(
        '/academy/outline',
        { ...brief, documents },
        'The outline could not be drafted.'
    )
    return {
        title: String(data.title || ''),
        description: String(data.description || ''),
        modules: Array.isArray(data.modules) ? data.modules : [],
        warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : []
    }
}

export async function draftItem(request: {
    kind: OutlineKind
    title: string
    summary?: string
    notes?: string
    moduleTitle?: string
    minutes?: number
    course: CourseAiContext
    lessons?: { title: string; content: string }[]
    questionCount?: number
    style?: 'scenario' | 'recall' | 'mixed'
}): Promise<DraftedItem> {
    const data = await aiBackendPost<DraftedItem>('/academy/draft-item', request, 'The item could not be drafted.')
    return {
        objective: String(data.objective || ''),
        content: String(data.content || ''),
        minutes: Number.isFinite(data.minutes) ? Number(data.minutes) : null,
        rubric: String(data.rubric || ''),
        submissionType: ['text', 'file', 'either'].includes(String(data.submissionType))
            ? data.submissionType
            : null,
        questions: Array.isArray(data.questions) ? data.questions : [],
        warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : []
    }
}

export async function assistWriting(request: {
    action: AssistAction
    text: string
    title?: string
    kind?: string
    course: CourseAiContext
}): Promise<string> {
    const data = await aiBackendPost<{ text: string }>('/academy/assist', request, 'No suggestion could be written.')
    return String(data.text || '')
}

export async function suggestMissingItems(request: {
    course: CourseAiContext
    modules: { title: string; items: { kind: string; title: string }[] }[]
}): Promise<SuggestedItem[]> {
    const data = await aiBackendPost<{ suggestions: SuggestedItem[] }>(
        '/academy/suggest-items',
        request,
        'The outline could not be reviewed.'
    )
    return Array.isArray(data.suggestions) ? data.suggestions : []
}
