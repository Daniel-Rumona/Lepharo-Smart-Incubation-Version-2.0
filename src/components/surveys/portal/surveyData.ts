import { useEffect, useMemo, useState } from 'react'
import {
    Timestamp,
    collection,
    getDocs,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'

export type SurveyField = {
    id: string
    type: string
    label: string
    name?: string
    placeholder?: string
    required?: boolean
    options?: string[]
    description?: string
    defaultValue?: any
}

/** One invited SME's row: sentForms/{id}/responses/{participantId}. */
export type SurveyRecipient = {
    id: string
    participantId: string
    participantName: string
    companyName: string
    email: string
    group: string
    completed: boolean
    submittedAt?: Timestamp | null
    answers: Record<string, any> | any[]
    answersDraft?: Record<string, any>
    questions?: any[]
    fields?: any[]
}

export type SentSurvey = {
    id: string
    title: string
    description?: string
    templateId?: string
    programId?: string
    department?: string
    sentAt?: Timestamp | null
    dueDate?: Timestamp | null
    recipients: SurveyRecipient[]
    /** False until its responses have loaded at least once. */
    loaded: boolean
    completed: number
    total: number
}

export type SurveyTemplate = {
    id: string
    title: string
    description?: string
    status: 'published' | 'draft'
    department?: string
    programId?: string
    createdAt?: Timestamp | string
    updatedAt?: Timestamp | string
    createdBy?: string
    /** Hidden from the Templates list and the Send window; sent surveys keep it. */
    archived?: boolean
    fields: SurveyField[]
}

export type SentStatus = 'pending' | 'completed' | 'closed' | 'empty'

export const toDate = (value?: Timestamp | string | null): Date | null => {
    if (!value) return null
    if (typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
        return (value as Timestamp).toDate()
    }
    if (typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    return null
}

export const formatDay = (value?: Timestamp | string | null) => {
    const date = toDate(value)
    return date ? dayjs(date).format('D MMM YYYY') : ''
}

export const isAnswered = (answer: unknown) =>
    answer !== undefined &&
    answer !== null &&
    answer !== '' &&
    !(Array.isArray(answer) && answer.length === 0)

export const countAnswers = (answers: unknown): number => {
    if (!answers || typeof answers !== 'object') return 0
    const values = Array.isArray(answers)
        ? answers
        : Object.values(answers as Record<string, unknown>)
    return values.filter(isAnswered).length
}

/** Completed once everyone answered; closed once past due with answers missing. */
export const sentStatusOf = (survey: Pick<SentSurvey, 'total' | 'completed' | 'dueDate'>): SentStatus => {
    if (survey.total === 0) return 'empty'
    if (survey.completed >= survey.total) return 'completed'
    if (survey.dueDate && survey.dueDate.toMillis() < Date.now()) return 'closed'
    return 'pending'
}

export const SENT_STATUS_META: Record<SentStatus, { label: string; color: string }> = {
    pending: { label: 'Open', color: 'processing' },
    completed: { label: 'Done', color: 'success' },
    closed: { label: 'Closed', color: 'default' },
    empty: { label: 'No recipients', color: 'default' }
}

export const responseRate = (survey: Pick<SentSurvey, 'total' | 'completed'>) =>
    survey.total ? Math.round((survey.completed / survey.total) * 100) : 0

export const questionCount = (fields: SurveyField[]) =>
    fields.filter(field => field.type !== 'heading').length

// Keeps the builder's other settings (prefill, rating range, …) so a sent
// copy behaves like the template.
const normalizeField = (field: any, index: number): SurveyField => ({
    ...field,
    id: String(field?.id || `field_${index}`),
    type: String(field?.type || 'text'),
    label: String(
        field?.label || field?.question || field?.questionText || `Question ${index + 1}`
    ),
    name: field?.name || undefined,
    placeholder: field?.placeholder ?? undefined,
    required: !!field?.required,
    options: Array.isArray(field?.options) ? field.options.filter(Boolean) : undefined,
    description: field?.description ?? undefined,
    defaultValue: field?.defaultValue
})

/** Template questions; older templates kept them in `questions`. */
export const normalizeTemplateFields = (template: any): SurveyField[] => {
    if (Array.isArray(template?.fields)) return template.fields.map(normalizeField)
    if (Array.isArray(template?.questions)) return template.questions.map(normalizeField)
    return []
}

/** The questions copied onto each response, in the shape the SME screens read. */
export const toResponseQuestions = (fields: SurveyField[]) =>
    fields.map((field, index) => ({
        ...field,
        id: field.id || `q_${index}`,
        question: field.label || `Question ${index + 1}`,
        questionText: field.label || `Question ${index + 1}`,
        label: field.label || `Question ${index + 1}`,
        type: field.type || 'text',
        name: field.name,
        placeholder: field.placeholder,
        required: !!field.required,
        options: Array.isArray(field.options) ? field.options.filter(Boolean) : [],
        description: field.description,
        defaultValue: field.defaultValue
    }))

const toRecipient = (id: string, data: any): SurveyRecipient => ({
    ...data,
    id,
    participantId: String(data.participantId || id),
    participantName: data.participantName || data.name || 'Participant',
    companyName: data.companyName || 'Unnamed Company',
    email: data.email || '',
    group: data.group || '',
    completed: data.completed === true,
    answers: data.answers && typeof data.answers === 'object' ? data.answers : {}
})

/**
 * The department's sent surveys (in the active programme), each with its
 * responses kept live, so counts move as SMEs submit.
 */
export const useSentSurveys = (departmentId?: string | null, programId?: string | null) => {
    const [sentDocs, setSentDocs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [responsesByForm, setResponsesByForm] = useState<Record<string, SurveyRecipient[]>>({})

    useEffect(() => {
        if (!departmentId) {
            setSentDocs([])
            setLoading(false)
            return
        }

        setLoading(true)
        const constraints = [where('department', '==', departmentId)]
        if (programId) constraints.push(where('programId', '==', programId))

        return onSnapshot(
            query(collection(db, 'sentForms'), ...constraints),
            snapshot => {
                setSentDocs(snapshot.docs.map(document => ({ id: document.id, ...(document.data() as any) })))
                setLoading(false)
            },
            error => {
                console.error('Failed to subscribe to sent surveys', error)
                setSentDocs([])
                setLoading(false)
            }
        )
    }, [departmentId, programId])

    const idsKey = useMemo(() => sentDocs.map(sent => sent.id).sort().join('|'), [sentDocs])

    useEffect(() => {
        const ids = idsKey ? idsKey.split('|') : []
        setResponsesByForm(previous =>
            Object.fromEntries(Object.entries(previous).filter(([id]) => ids.includes(id)))
        )
        const unsubscribes = ids.map(id =>
            onSnapshot(
                collection(db, 'sentForms', id, 'responses'),
                snapshot =>
                    setResponsesByForm(previous => ({
                        ...previous,
                        [id]: snapshot.docs.map(response => toRecipient(response.id, response.data()))
                    })),
                error => console.error('Failed to load survey responses', id, error)
            )
        )
        return () => unsubscribes.forEach(unsubscribe => unsubscribe())
    }, [idsKey])

    const surveys = useMemo<SentSurvey[]>(
        () =>
            sentDocs.map(sent => {
                const recipients = responsesByForm[sent.id] || []
                return {
                    id: sent.id,
                    title: sent.title || 'Untitled Survey',
                    description: sent.description || '',
                    templateId: sent.templateId,
                    programId: sent.programId,
                    department: sent.department,
                    sentAt: sent.sentAt || null,
                    dueDate: sent.dueDate || null,
                    recipients,
                    loaded: sent.id in responsesByForm,
                    completed: recipients.filter(r => r.completed).length,
                    total: recipients.length
                }
            }),
        [sentDocs, responsesByForm]
    )

    return { surveys, loading }
}

/** Templates this department can use: its own and shared ones (no department). */
export const useSurveyTemplates = (departmentId?: string | null, programId?: string | null) => {
    const [templates, setTemplates] = useState<SurveyTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        if (!departmentId) {
            setTemplates([])
            setLoading(false)
            return
        }

        let active = true
        setLoading(true)

        getDocs(collection(db, 'formTemplates'))
            .then(snap => {
                if (!active) return
                setTemplates(
                    snap.docs
                        .map(document => ({ id: document.id, ...(document.data() as any) }))
                        .filter(template => {
                            const status = String(template.status || '').toLowerCase()
                            return (
                                ['draft', 'published', 'active'].includes(status) &&
                                (!template.department || String(template.department) === departmentId) &&
                                (!programId || String(template.programId || '') === programId)
                            )
                        })
                        .map(
                            (template): SurveyTemplate => ({
                                id: template.id,
                                title: String(template.title || '').trim() || 'Untitled Template',
                                description: template.description || '',
                                status: String(template.status || '').toLowerCase() === 'draft' ? 'draft' : 'published',
                                department: template.department,
                                programId: template.programId,
                                createdAt: template.createdAt,
                                updatedAt: template.updatedAt,
                                createdBy: template.createdBy,
                                archived: template.archived === true,
                                fields: normalizeTemplateFields(template)
                            })
                        )
                )
            })
            .catch(error => {
                console.error('Failed to load survey templates', error)
                if (active) setTemplates([])
            })
            .finally(() => {
                if (active) setLoading(false)
            })

        return () => {
            active = false
        }
    }, [departmentId, programId, reloadKey])

    return { templates, loading, reload: () => setReloadKey(key => key + 1) }
}

// ─────────────────────────────────────────────────────────────
// Question versions
// ─────────────────────────────────────────────────────────────

/** The questions on one SME's copy, as they were when it reached them. */
export const recipientFields = (recipient: SurveyRecipient): SurveyField[] =>
    normalizeTemplateFields({ fields: recipient.fields, questions: recipient.questions })

/** What makes two question lists different for an SME: ids, wording, type, choices, required. */
export const questionsSignature = (fields: SurveyField[]) =>
    JSON.stringify(
        fields.map(f => [f.id, f.type, f.label, (f.options || []).join('|'), !!f.required])
    )

/**
 * Every question across the copies, in order. Copies differ once questions
 * are updated after sending; the newest (longest) copy sets the order and
 * questions only older copies have are kept at the end.
 */
export const surveyQuestions = (recipients: SurveyRecipient[]): SurveyField[] => {
    const versions = recipients
        .map(recipientFields)
        .filter(fields => fields.length)
        .sort((a, b) => b.length - a.length)
    const seen = new Set<string>()
    const union: SurveyField[] = []
    versions.forEach(fields =>
        fields.forEach(field => {
            if (seen.has(field.id)) return
            seen.add(field.id)
            union.push(field)
        })
    )
    return union
}

/**
 * The questions a newly added SME should get: what the SMEs still answering
 * have (they carry any update), otherwise the fullest submitted copy.
 */
export const currentQuestions = (recipients: SurveyRecipient[]): SurveyField[] => {
    const waiting = recipients.find(r => !r.completed && recipientFields(r).length)
    if (waiting) return recipientFields(waiting)
    return recipients.map(recipientFields).sort((a, b) => b.length - a.length)[0] || []
}

// ─────────────────────────────────────────────────────────────
// Per-question summaries for the Insights tab
// ─────────────────────────────────────────────────────────────

type SummaryBase = {
    field: SurveyField
    /** Submitted SMEs whose copy had this question. */
    asked: number
    answered: number
}

export type QuestionSummary = SummaryBase &
    (
        | { kind: 'choice'; rows: { label: string; count: number }[] }
        | { kind: 'rating'; average: number; rows: { label: string; count: number }[] }
        | { kind: 'text'; samples: string[] }
        | { kind: 'file' }
    )

const CHOICE_TYPES = new Set(['radio', 'select', 'checkbox', 'multiple'])

const answerFor = (recipient: SurveyRecipient, field: SurveyField) => {
    const answers = recipient.answers
    if (Array.isArray(answers)) {
        // Very old responses kept answers by position in their own copy.
        return answers[recipientFields(recipient).findIndex(f => f.id === field.id)]
    }
    if (field.id in answers) return answers[field.id]
    if (field.name && field.name in answers) return answers[field.name]
    return undefined
}

/**
 * Tallies the submitted responses question by question. Each question counts
 * only the SMEs whose copy had it, so one added after sending isn't shown as
 * skipped by everyone who answered before it existed.
 */
export const summarizeQuestions = (recipients: SurveyRecipient[]): QuestionSummary[] => {
    const done = recipients.filter(recipient => recipient.completed)
    const askedIds = new Map(done.map(r => [r, new Set(recipientFields(r).map(f => f.id))]))

    return surveyQuestions(recipients)
        .filter(field => field.type !== 'heading')
        .map((field): QuestionSummary => {
            const askedOf = done.filter(r => askedIds.get(r)?.has(field.id))
            const values = askedOf.map(r => answerFor(r, field)).filter(isAnswered)
            const base = { field, asked: askedOf.length, answered: values.length }

            if (CHOICE_TYPES.has(field.type)) {
                const counts = new Map<string, number>((field.options || []).map(option => [option, 0]))
                values.forEach(value =>
                    (Array.isArray(value) ? value : [value]).forEach(choice => {
                        const key = String(choice)
                        counts.set(key, (counts.get(key) || 0) + 1)
                    })
                )
                return { ...base, kind: 'choice', rows: Array.from(counts, ([label, count]) => ({ label, count })) }
            }

            if (field.type === 'rating') {
                const numbers = values.map(Number).filter(n => Number.isFinite(n) && n > 0)
                const max = Math.max(5, ...numbers)
                return {
                    ...base,
                    answered: numbers.length,
                    kind: 'rating',
                    average: numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0,
                    rows: Array.from({ length: max }, (_, i) => ({
                        label: `${max - i} ★`,
                        count: numbers.filter(n => n === max - i).length
                    }))
                }
            }

            if (field.type === 'file') return { ...base, kind: 'file' }

            return {
                ...base,
                kind: 'text',
                samples: values
                    .map(value =>
                        field.type === 'date' && dayjs(value).isValid()
                            ? dayjs(value).format('D MMM YYYY')
                            : String(value)
                    )
                    .slice(-3)
                    .reverse()
            }
        })
}
