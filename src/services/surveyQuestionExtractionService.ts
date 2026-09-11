import { getAuth } from 'firebase/auth'

const AI_BACKEND_URL = String(
    import.meta.env.VITE_AI_BACKEND_URL ||
    'https://yoursdvniel-lepharo-smart-incubation.hf.space'
).replace(/\/$/, '')

/** Mirrors MAX_SURVEY_FILE_BYTES in ai-backend/app.py. */
export const MAX_SURVEY_DOCUMENT_BYTES = 10 * 1024 * 1024

export const SURVEY_DOCUMENT_ACCEPT =
    '.pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp'

/** Matches SurveyField in src/components/surveys/index.tsx. */
export type ExtractedSurveyField = {
    id: string
    type: string
    label: string
    name: string
    placeholder?: string | null
    required: boolean
    options?: string[] | null
    description?: string | null
}

export type SurveyExtractionResult = {
    title: string
    description: string
    category: string
    fields: ExtractedSurveyField[]
    warnings: string[]
}

const readAsBase64 = (file: File | Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('The document could not be read.'))
        reader.onload = () => {
            const result = String(reader.result || '')
            // readAsDataURL gives "data:<mime>;base64,<payload>" — send the payload only.
            resolve(result.slice(result.indexOf(',') + 1))
        }
        reader.readAsDataURL(file)
    })

/**
 * Send an uploaded questionnaire to the AI backend and get back fields shaped
 * for the survey builder.
 */
export async function extractSurveyQuestions(
    file: File,
    options: { category?: string } = {}
): Promise<SurveyExtractionResult> {
    const firebaseUser = getAuth().currentUser
    if (!firebaseUser) {
        throw new Error('Please sign in again to import questions.')
    }
    if (!file.size) {
        throw new Error('The selected file is empty.')
    }
    if (file.size > MAX_SURVEY_DOCUMENT_BYTES) {
        throw new Error(
            `The document is larger than ${MAX_SURVEY_DOCUMENT_BYTES / (1024 * 1024)}MB.`
        )
    }

    const [token, fileBase64] = await Promise.all([
        firebaseUser.getIdToken(),
        readAsBase64(file)
    ])

    const response = await fetch(`${AI_BACKEND_URL}/surveys/extract-questions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            fileBase64,
            fileName: file.name,
            mimeType: file.type,
            category: options.category
        })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
        throw new Error(
            data?.detail || `Could not read questions from this document (${response.status}).`
        )
    }

    return {
        title: String(data?.title || ''),
        description: String(data?.description || ''),
        category: String(data?.category || ''),
        fields: Array.isArray(data?.fields) ? (data.fields as ExtractedSurveyField[]) : [],
        warnings: Array.isArray(data?.warnings) ? data.warnings.map(String) : []
    }
}
