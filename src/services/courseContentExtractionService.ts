import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

/** Mirrors MAX_SURVEY_FILE_BYTES in ai-backend/app.py, which this endpoint reuses. */
export const MAX_COURSE_DOCUMENT_BYTES = 10 * 1024 * 1024

export const COURSE_DOCUMENT_ACCEPT =
    '.pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp'

/** Mirrors COURSE_EXTRACTION_KINDS in ai-backend/app.py. */
export type ExtractableKind = 'lesson' | 'assignment' | 'quiz' | 'test'

export const isExtractableKind = (kind: string): kind is ExtractableKind =>
    ['lesson', 'assignment', 'quiz', 'test'].includes(kind)

export type ExtractedCourseQuestion = {
    text: string
    options: string[]
    /** -1 when the document does not mark the correct answer. */
    answer: number
    feedback: string
}

export type CourseExtractionResult = {
    title: string
    objective: string
    content: string
    minutes: number | null
    rubric: string
    submissionType: 'text' | 'file' | 'either' | null
    questions: ExtractedCourseQuestion[]
    warnings: string[]
}

const readAsBase64 = (file: File | Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('The document could not be read.'))
        reader.onload = () => {
            const result = String(reader.result || '')
            resolve(result.slice(result.indexOf(',') + 1))
        }
        reader.readAsDataURL(file)
    })

/**
 * Send a document to the AI backend and get back content shaped for one
 * course builder item (lesson text, assignment brief and rubric, or quiz questions).
 */
export async function extractCourseContent(
    file: File,
    kind: ExtractableKind
): Promise<CourseExtractionResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to extract content.')
    }
    if (!file.size) {
        throw new Error('The selected file is empty.')
    }
    if (file.size > MAX_COURSE_DOCUMENT_BYTES) {
        throw new Error(
            `The document is larger than ${MAX_COURSE_DOCUMENT_BYTES / (1024 * 1024)}MB.`
        )
    }

    const [token, fileBase64] = await Promise.all([
        firebaseUser.getIdToken(),
        readAsBase64(file)
    ])

    const response = await fetch(`${AI_BACKEND_URL}/academy/extract-content`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            fileBase64,
            fileName: file.name,
            mimeType: file.type,
            kind
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            data?.detail || `Could not extract content from this document (${response.status}).`
        )
    }

    return {
        title: String(data?.title || ''),
        objective: String(data?.objective || ''),
        content: String(data?.content || ''),
        minutes: Number.isFinite(data?.minutes) ? Number(data.minutes) : null,
        rubric: String(data?.rubric || ''),
        submissionType: ['text', 'file', 'either'].includes(data?.submissionType)
            ? data.submissionType
            : null,
        questions: Array.isArray(data?.questions)
            ? (data.questions as ExtractedCourseQuestion[])
            : [],
        warnings: Array.isArray(data?.warnings) ? data.warnings.map(String) : []
    }
}
