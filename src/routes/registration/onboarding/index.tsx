import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Button,
    Card,
    DatePicker,
    Divider,
    Input,
    Progress,
    Grid,
    Space,
    Tag,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import {
    AppstoreOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CheckCircleFilled,
    CheckOutlined,
    CloseOutlined,
    EditOutlined,
    FileTextOutlined,
    MessageOutlined,
    PlusOutlined,
    SearchOutlined,
    UploadOutlined
} from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Helmet } from 'react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    FieldValue,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    where,
    type DocumentReference
} from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import SHA256 from 'crypto-js/sha256'

import { auth, db, functions, storage } from '@/firebase'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

dayjs.extend(customParseFormat)

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

type FlowScreen =
    | 'welcome'
    | 'motivation'
    | 'challenges'
    | 'profileIntro'
    | 'profileQuestion'
    | 'supportIntro'
    | 'supportAreas'
    | 'supportDepartment'
    | 'documentsIntro'
    | 'documents'
    | 'review'

type FlowDirection = 'forward' | 'backward'

type ReviewEditSection =
    | 'motivation'
    | 'challenges'
    | 'profile'
    | 'support'
    | 'documents'
    | null

type ProgramQuestion = {
    id: string
    label: string
    type?: 'text' | 'dropdown' | string
    options?: string[] | string
    placeholder?: string
}

type InterventionItem = {
    id: string
    title: string
}

type InterventionGroup = {
    area: string
    interventions: InterventionItem[]
}

type DocField = {
    key: string
    title: string
    requiresExpiry: boolean
    expiryMonths?: number | null
    file: File | null
    savedFileName?: string | null
    issueDate: Dayjs | null
    expiryDate: Dayjs | null
    completed: boolean
}

type Group = 'A' | 'B' | 'C' | 'Graduated'

type GroupHistoryEntry = {
    from: Group | null
    to: Group
    date: string
    by: string
    reason: string
    docs: string[]
    requirementsMet: string[]
}

/**
 * The shape a document takes once it is in Storage and ready to be written
 * onto the application. `missing` rows are kept deliberately so a reviewer
 * can see which requirements were left unmet.
 */
type UploadedDoc = {
    key: string
    type: string
    url: string | null
    fileName: string | null
    issueDate: string | null
    expiryDate: string | null
    status: 'valid' | 'missing'
}

const MIN_MOTIVATION_WORDS = 100
const MAX_FILE_MB = 10

// An application with no usable document cannot be assessed, so submission
// is held until at least this share of the programme's requirements is met.
const MIN_COMPLIANCE_PERCENT = 10

const DOCUMENT_STORAGE_FOLDER = 'participant_documents'
const ACCEPTED_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
]

type TypewriterPhraseProps = {
    text: string
    reducedMotion: boolean
    speed?: number
    delay?: number
}

const TypewriterPhrase: React.FC<TypewriterPhraseProps> = ({
    text,
    reducedMotion,
    speed = 42,
    delay = 320
}) => {
    const [visibleCharacters, setVisibleCharacters] = useState(
        reducedMotion ? text.length : 0
    )

    useEffect(() => {
        if (reducedMotion) {
            setVisibleCharacters(text.length)
            return
        }

        setVisibleCharacters(0)

        let intervalId: number | null = null

        const delayId = window.setTimeout(() => {
            intervalId = window.setInterval(() => {
                setVisibleCharacters(current => {
                    if (current >= text.length) {
                        if (intervalId !== null) {
                            window.clearInterval(intervalId)
                        }

                        return text.length
                    }

                    return current + 1
                })
            }, speed)
        }, delay)

        return () => {
            window.clearTimeout(delayId)

            if (intervalId !== null) {
                window.clearInterval(intervalId)
            }
        }
    }, [delay, reducedMotion, speed, text])

    const typing = visibleCharacters < text.length

    return (
        <>
            <span
                aria-hidden='true'
                style={{
                    borderRight: typing ? '2px solid currentColor' : '2px solid transparent',
                    paddingRight: 2
                }}
            >
                {text.slice(0, visibleCharacters)}
            </span>
            <span
                style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: 'hidden',
                    clip: 'rect(0, 0, 0, 0)',
                    whiteSpace: 'nowrap',
                    border: 0
                }}
            >
                {text}
            </span>
        </>
    )
}

const countWords = (value: string) =>
    value
        .trim()
        .split(/\s+/)
        .filter(Boolean).length

const normaliseChallengeItems = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map(item => String(item || '').trim())
            .filter(Boolean)
    }

    if (typeof value === 'string' && value.trim()) {
        const lines = value
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean)

        return lines.length > 0 ? lines : [value.trim()]
    }

    return []
}

const normaliseOptions = (value: ProgramQuestion['options']): string[] => {
    if (Array.isArray(value)) {
        return value
            .map(option => String(option || '').trim())
            .filter(Boolean)
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(option => option.trim())
            .filter(Boolean)
    }

    return []
}

const slug = (value: string) =>
    String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 60)

const fmtBytes = (bytes: number) =>
    bytes < 1024
        ? `${bytes} B`
        : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const norm = (value?: string) => String(value || '').trim().toLowerCase()

/**
 * A requirement counts toward compliance once its document is uploaded with
 * the dates that requirement asks for, and is not about to lapse -- a document
 * expiring inside a week would be stale before a reviewer reaches it.
 */
const isDocumentCompliant = (field: DocField) => {
    if (!field.completed || !field.file) return false

    if (field.expiryDate && !field.expiryDate.isAfter(dayjs().add(7, 'day'))) {
        return false
    }

    return true
}

/**
 * Firestore rejects `undefined`, so every payload is passed through this
 * before it is written. Dayjs values become ISO strings because a Dayjs
 * instance is a plain object to Firestore and would be stored as one;
 * Date and Timestamp are already storable and are left alone.
 *
 * FieldValue is passed through untouched. Rebuilding a sentinel such as
 * serverTimestamp() as a plain object strips its prototype, and Firestore
 * would then store the literal map `{ _methodName: 'serverTimestamp' }`
 * instead of stamping a time.
 */
const pruneUndefinedDeep = (value: any): any => {
    if (value === undefined) return undefined
    if (value === null) return null

    if (Array.isArray(value)) {
        return value
            .map(item => pruneUndefinedDeep(item))
            .filter(item => item !== undefined)
    }

    if (typeof value === 'object') {
        if (
            value instanceof Timestamp ||
            value instanceof Date ||
            value instanceof FieldValue
        ) {
            return value
        }

        if (dayjs.isDayjs(value)) return value.toISOString()

        const entries = Object.entries(value)
            .map(([key, child]) => [key, pruneUndefinedDeep(child)] as const)
            .filter(([, child]) => child !== undefined)

        return Object.fromEntries(entries)
    }

    return value
}

/**
 * Age comes from the South African ID number the participant captured on
 * their profile. It is derived rather than asked for again, and stays
 * optional: a profile without a usable ID submits with no age group, the
 * same as an application created by a consultant.
 */
const getAgeFromID = (id?: string): number | null => {
    const digits = String(id || '').replace(/\D/g, '')
    if (digits.length < 6) return null

    const yearDigits = digits.slice(0, 2)
    const monthAndDay = digits.slice(2, 6)
    const century = Number(yearDigits) <= dayjs().year() % 100 ? '20' : '19'

    const birthDate = dayjs(
        `${century}${yearDigits}${monthAndDay}`,
        'YYYYMMDD',
        true
    )

    if (!birthDate.isValid() || birthDate.isAfter(dayjs())) return null

    const age = dayjs().diff(birthDate, 'year')

    return age >= 0 && age <= 120 ? age : null
}

const getAgeGroup = (age: number | null): 'Youth' | 'Adult' | 'Senior' | null => {
    if (age === null) return null
    if (age <= 35) return 'Youth'
    if (age <= 59) return 'Adult'
    return 'Senior'
}

const REVENUE_STAGE_CEILINGS: Array<{ ceiling: number; stage: string }> = [
    { ceiling: 100000, stage: 'Ideation' },
    { ceiling: 500000, stage: 'Startup' },
    { ceiling: 1000000, stage: 'Early Stage' },
    { ceiling: 5000000, stage: 'Growth' }
]

/**
 * Stage is inferred from the last two years of turnover already captured on
 * the participant profile. Newer profiles nest it under
 * `revenueHistory.annual`; older records kept flat `revenue<year>` keys, so
 * both shapes are read.
 */
const deriveStageFromRevenue = (values: Record<string, any>): string => {
    const currentYear = dayjs().year()
    const years = [currentYear - 1, currentYear - 2]
    const annual = values?.revenueHistory?.annual || {}

    const revenues = years.map(year =>
        Number(annual?.[String(year)] ?? values?.[`revenue${year}`] ?? 0) || 0
    )

    const average =
        revenues.reduce((total, revenue) => total + revenue, 0) / revenues.length

    return (
        REVENUE_STAGE_CEILINGS.find(({ ceiling }) => average < ceiling)?.stage ||
        'Maturity'
    )
}

const initialGapGroupEntry = (): GroupHistoryEntry => ({
    from: null,
    to: 'A',
    date: dayjs().toISOString(),
    by: 'Applicant',
    reason: 'Initial application placement',
    docs: [],
    requirementsMet: []
})

/**
 * Reviewers work off `applications/{id}/complianceDocuments`, not the array
 * on the application itself, so the same uploads are mirrored into the
 * subcollection. Keyed by requirement so a re-submission updates a row
 * instead of adding a duplicate. Mirrors the consultant-side writer in
 * routes/operations/participants/new/ParticipantOnboardingForm.tsx.
 */
const upsertComplianceSubdocs = async (
    appRef: DocumentReference,
    uploadedDocs: UploadedDoc[],
    ctx: {
        programId?: string | null
        programName?: string | null
        uploadedByEmail?: string | null
    }
) => {
    const { programId, programName, uploadedByEmail } = ctx

    await Promise.all(
        uploadedDocs.map(async uploadedDoc => {
            const presetId = norm(uploadedDoc.key || uploadedDoc.type)
            const subId = presetId || `doc_${Date.now()}`

            await setDoc(
                doc(appRef, 'complianceDocuments', subId),
                {
                    type: uploadedDoc.type,
                    documentName: uploadedDoc.type,
                    presetId,
                    slug: presetId,
                    kind: 'upload',
                    status: uploadedDoc.url ? 'pending' : 'missing',
                    url: uploadedDoc.url || null,
                    issueDate: uploadedDoc.issueDate || null,
                    expiryDate: uploadedDoc.expiryDate || null,
                    uploadedAt: serverTimestamp(),
                    uploadedBy: uploadedByEmail || null,
                    createdBy: uploadedByEmail || null,
                    programId: programId || null,
                    programName: programName || null,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )
        })
    )
}

const ParticipantRegistrationConversational: React.FC = () => {
    const { token } = theme.useToken()
    const [messageApi, contextHolder] = message.useMessage()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const reduceMotion = useReducedMotion()
    const screens = Grid.useBreakpoint()

    const programId = searchParams.get('id')

    // The link carries a programme name, but the programme document is
    // authoritative -- a renamed programme should not be recorded under the
    // stale name a bookmarked link still holds.
    const [programName, setProgramName] = useState<string | null>(
        searchParams.get('program')
    )

    // Applications are reported on per branch, so the programme's assigned
    // branch is resolved while its configuration loads rather than at submit.
    const [programBranch, setProgramBranch] = useState<{
        id: string | null
        name: string | null
    }>({ id: null, name: null })

    const [initialising, setInitialising] = useState(true)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [screen, setScreen] = useState<FlowScreen>('welcome')
    const [direction, setDirection] = useState<FlowDirection>('forward')
    const [reviewEditSection, setReviewEditSection] = useState<ReviewEditSection>(null)

    const [motivation, setMotivation] = useState('')
    const [challengeInput, setChallengeInput] = useState('')
    const [challenges, setChallenges] = useState<string[]>([])
    const [saving, setSaving] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [submitStage, setSubmitStage] = useState('Submitting your application...')

    // A ref as well as state: the state drives the overlay, the ref closes the
    // gap between two clicks landing before React has re-rendered the button.
    const submittingRef = useRef(false)

    const [programQuestions, setProgramQuestions] = useState<ProgramQuestion[]>([])
    const [programQuestionsLoaded, setProgramQuestionsLoaded] = useState(false)
    const [profileIndex, setProfileIndex] = useState(0)
    const [profileAnswers, setProfileAnswers] = useState<Record<string, string>>({})
    const [profileOptionSearch, setProfileOptionSearch] = useState('')

    const [programRequirements, setProgramRequirements] = useState<any[]>([])
    const [interventionGroups, setInterventionGroups] = useState<InterventionGroup[]>([])
    const [interventionSelections, setInterventionSelections] = useState<Record<string, string[]>>({})
    const [activeSupportArea, setActiveSupportArea] = useState<string | null>(null)

    const [documentFields, setDocumentFields] = useState<DocField[]>([])
    const [draftDocumentMeta, setDraftDocumentMeta] = useState<any[]>([])
    const [openDocumentKey, setOpenDocumentKey] = useState<string | null>(null)

    const restoredFormValuesRef = useRef<Record<string, unknown>>({})

    const motivationWords = useMemo(
        () => countWords(motivation),
        [motivation]
    )

    const motivationProgress = Math.min(
        100,
        Math.round((motivationWords / MIN_MOTIVATION_WORDS) * 100)
    )

    const canContinueMotivation = motivationWords >= MIN_MOTIVATION_WORDS

    const activeProfileQuestion = programQuestions[profileIndex]
    const activeProfileAnswer = activeProfileQuestion
        ? profileAnswers[activeProfileQuestion.id] || ''
        : ''

    const activeProfileOptions = activeProfileQuestion
        ? normaliseOptions(activeProfileQuestion.options)
        : []

    const activeProfileUsesChoiceCards =
        activeProfileQuestion?.type === 'dropdown' &&
        activeProfileOptions.length >= 1 &&
        activeProfileOptions.length <= 8

    const activeProfileUsesSearchList =
        activeProfileQuestion?.type === 'dropdown' &&
        activeProfileOptions.length > 8

    const activeProfileIsYesNo =
        activeProfileOptions.length === 2 &&
        activeProfileOptions.some(option => option.trim().toLowerCase() === 'yes') &&
        activeProfileOptions.some(option => option.trim().toLowerCase() === 'no')

    const orderedChoiceOptions = useMemo(() => {
        if (!activeProfileUsesChoiceCards || activeProfileOptions.length % 2 === 0) {
            return activeProfileOptions
        }

        let longestIndex = 0

        activeProfileOptions.forEach((option, index) => {
            if (option.length > activeProfileOptions[longestIndex].length) {
                longestIndex = index
            }
        })

        const longestOption = activeProfileOptions[longestIndex]

        return [
            ...activeProfileOptions.filter((_, index) => index !== longestIndex),
            longestOption
        ]
    }, [activeProfileOptions, activeProfileUsesChoiceCards])

    const choiceCardColumns = (() => {
        const count = orderedChoiceOptions.length
        const evenCount = count % 2 === 1 ? count - 1 : count

        if (count <= 1) return 1

        if (!screens.md) {
            return 2
        }

        if (evenCount === 6) return 3
        if (evenCount === 8) return 4
        if (evenCount === 4) return 4

        return Math.min(2, evenCount || 1)
    })()

    const filteredLargeProfileOptions = useMemo(() => {
        const search = profileOptionSearch.trim().toLowerCase()

        if (!search) return activeProfileOptions

        return activeProfileOptions.filter(option =>
            option.toLowerCase().includes(search)
        )
    }, [activeProfileOptions, profileOptionSearch])

    useEffect(() => {
        setProfileOptionSearch('')
    }, [activeProfileQuestion?.id])

    const profileProgress = programQuestions.length
        ? Math.round(((profileIndex + 1) / programQuestions.length) * 100)
        : 0

    useEffect(() => {
        let mounted = true

        const loadProgramConfiguration = async () => {
            try {
                if (!programId) {
                    if (mounted) {
                        setProgramQuestions([])
                        setProgramRequirements([])
                        setProgramBranch({ id: null, name: null })
                    }
                    return
                }

                const programSnap = await getDoc(doc(db, 'programs', programId))

                if (!mounted) return

                if (!programSnap.exists()) {
                    setProgramQuestions([])
                    setProgramRequirements([])
                    return
                }

                const data = programSnap.data()
                const questions = Array.isArray(data.onboardingQuestions)
                    ? data.onboardingQuestions
                    : []
                const requirements = Array.isArray(data.programRequirements)
                    ? data.programRequirements
                    : []

                const resolvedName =
                    data.programName || data.name || data.title || null

                if (resolvedName) setProgramName(resolvedName)

                // Tolerant of both shapes in use: a nested assignedBranch
                // object (or array) and the older flat fields.
                const assignedBranch =
                    data.assignedBranch ||
                    (Array.isArray(data.assignedBranches)
                        ? data.assignedBranches[0]
                        : null) ||
                    null

                setProgramBranch({
                    id: assignedBranch?.id || data.assignedBranchId || null,
                    name: assignedBranch?.name || data.assignedBranchName || null
                })

                setProgramQuestions(
                    questions.filter(
                        (question: any) =>
                            question &&
                            typeof question.id === 'string' &&
                            typeof question.label === 'string'
                    )
                )

                setProgramRequirements(
                    requirements.filter((requirement: any) =>
                        requirement?.requiredAtApplication === true
                    )
                )
            } catch (error) {
                console.error('[Application Flow] Failed to load programme configuration:', error)
                if (mounted) {
                    setProgramQuestions([])
                    setProgramRequirements([])
                }
            } finally {
                if (mounted) setProgramQuestionsLoaded(true)
            }
        }

        void loadProgramConfiguration()

        return () => {
            mounted = false
        }
    }, [programId])

    useEffect(() => {
        let mounted = true

        const loadInterventions = async () => {
            try {
                const snap = await getDocs(collection(db, 'interventions'))
                if (!mounted) return

                const grouped = new Map<string, InterventionItem[]>()

                snap.docs.forEach(interventionDoc => {
                    const data = interventionDoc.data()
                    const title = String(data.interventionTitle || data.title || '').trim()
                    const area = String(data.areaOfSupport || 'General').trim()

                    if (!title || data.internal === true || data.compulsory === true) return

                    const current = grouped.get(area) || []
                    current.push({ id: interventionDoc.id, title })
                    grouped.set(area, current)
                })

                setInterventionGroups(
                    Array.from(grouped.entries())
                        .map(([area, interventions]) => ({
                            area,
                            interventions: [...interventions].sort((a, b) => a.title.localeCompare(b.title))
                        }))
                        .sort((a, b) => a.area.localeCompare(b.area))
                )
            } catch (error) {
                console.error('[Application Flow] Failed to load interventions:', error)
                if (mounted) setInterventionGroups([])
            }
        }

        void loadInterventions()

        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        let mounted = true
        let handled = false

        const unsubscribe = onAuthStateChanged(auth, async user => {
            if (!mounted || handled) return
            handled = true

            try {
                if (!user?.email) {
                    messageApi.error('Please sign in again to continue your application.')
                    return
                }

                const participantSnap = await getDocs(
                    query(
                        collection(db, 'participants'),
                        where('email', '==', user.email)
                    )
                )

                if (!mounted) return

                if (participantSnap.empty) {
                    messageApi.error('We could not find your participant profile.')
                    return
                }

                const participantDoc = participantSnap.docs[0]
                const participantData = participantDoc.data()
                const id = participantDoc.id
                setParticipantId(id)

                const draftSnap = await getDoc(
                    doc(db, 'applicationDrafts', id)
                )

                if (!mounted) return

                const draft = draftSnap.exists() ? draftSnap.data() : {}
                const draftValues =
                    draft.formValues && typeof draft.formValues === 'object'
                        ? (draft.formValues as Record<string, unknown>)
                        : {}

                const formValues = {
                    ...participantData,
                    ...draftValues
                }

                restoredFormValuesRef.current = formValues

                if (typeof formValues.motivation === 'string') {
                    setMotivation(formValues.motivation)
                }

                const restoredChallenges = normaliseChallengeItems(
                    formValues.challengeItems ?? formValues.challenges
                )
                setChallenges(restoredChallenges)

                if (
                    formValues.profile &&
                    typeof formValues.profile === 'object' &&
                    !Array.isArray(formValues.profile)
                ) {
                    const restoredProfile = Object.fromEntries(
                        Object.entries(formValues.profile as Record<string, unknown>)
                            .map(([key, value]) => [key, String(value ?? '')])
                    )

                    setProfileAnswers(restoredProfile)
                }

                if (
                    draft.interventionSelections &&
                    typeof draft.interventionSelections === 'object' &&
                    !Array.isArray(draft.interventionSelections)
                ) {
                    setInterventionSelections(
                        Object.fromEntries(
                            Object.entries(draft.interventionSelections as Record<string, unknown>)
                                .map(([key, value]) => [
                                    key,
                                    Array.isArray(value)
                                        ? value.map(item => String(item)).filter(Boolean)
                                        : []
                                ])
                        )
                    )
                }

                if (Array.isArray(draft.documentFields)) {
                    setDraftDocumentMeta(draft.documentFields)
                }
            } catch (error) {
                console.error('[Application Flow] Failed to restore draft:', error)
                messageApi.error('We could not restore your saved application.')
            } finally {
                if (mounted) setInitialising(false)
            }
        })

        return () => {
            mounted = false
            unsubscribe()
        }
    }, [messageApi])

    useEffect(() => {
        const draftMap = new Map<string, any>()

        draftDocumentMeta.forEach(item => {
            const key = String(item?.key || '').trim()
            if (key) draftMap.set(key, item)
        })

        setDocumentFields(previous =>
            programRequirements.map((requirement: any) => {
                const key =
                    requirement.key ||
                    requirement.preset ||
                    requirement.id ||
                    `title:${slug(requirement.title || 'document')}`

                const existing = previous.find(item => item.key === key)
                const saved = draftMap.get(key)

                return {
                    key,
                    title:
                        requirement.title ||
                        requirement.preset ||
                        requirement.key ||
                        'Document',
                    requiresExpiry: Boolean(requirement.hasExpiry),
                    expiryMonths: requirement.expiryMonths ?? null,
                    file: existing?.file || null,
                    savedFileName: saved?.fileName || existing?.savedFileName || null,
                    issueDate:
                        existing?.issueDate ||
                        (saved?.issueDate ? dayjs(saved.issueDate) : null),
                    expiryDate:
                        existing?.expiryDate ||
                        (saved?.expiryDate ? dayjs(saved.expiryDate) : null),
                    completed: Boolean(existing?.completed && existing?.file)
                }
            })
        )
    }, [draftDocumentMeta, programRequirements])

    const selectedInterventionCount = useMemo(
        () => (Object.values(interventionSelections) as string[][])
            .reduce((total, ids) => total + ids.length, 0),
        [interventionSelections]
    )

    const activeInterventionGroup = useMemo(
        () => interventionGroups.find(group => group.area === activeSupportArea) || null,
        [activeSupportArea, interventionGroups]
    )

    const readyDocuments = useMemo(
        () => documentFields.filter(document => document.completed),
        [documentFields]
    )

    const pendingDocuments = useMemo(
        () => documentFields.filter(document => !document.completed),
        [documentFields]
    )

    const documentsProgress = documentFields.length
        ? Math.round((readyDocuments.length / documentFields.length) * 100)
        : 100

    const allDocumentsReady = pendingDocuments.length === 0

    const selectedSupportByArea = useMemo(() =>
        interventionGroups
            .map(group => ({
                area: group.area,
                interventions: group.interventions.filter(intervention =>
                    (interventionSelections[group.area] || []).includes(intervention.id)
                )
            }))
            .filter(group => group.interventions.length > 0),
        [interventionGroups, interventionSelections]
    )

    // Flattened for storage: the grouping is presentation, the records
    // downstream want a flat list carrying its area.
    const selectedInterventions = useMemo(
        () =>
            selectedSupportByArea.flatMap(group =>
                group.interventions.map(intervention => ({
                    id: intervention.id,
                    title: intervention.title,
                    area: group.area
                }))
            ),
        [selectedSupportByArea]
    )

    const compliantDocumentKeys = useMemo(
        () => documentFields.filter(isDocumentCompliant).map(document => document.key),
        [documentFields]
    )

    /**
     * Every requirement in this flow is required at application time
     * (programRequirements is filtered on requiredAtApplication), so the score
     * is simply the share of them met.
     *
     * Read from local state rather than from the upload results, so the
     * threshold can be enforced before anything reaches Storage.
     */
    const complianceScore = documentFields.length
        ? Math.round((compliantDocumentKeys.length / documentFields.length) * 100)
        : 0

    const saveDraft = useCallback(async () => {
        if (!participantId) return

        setSaving(true)

        try {
            const mergedFormValues = {
                ...restoredFormValuesRef.current,
                motivation: motivation.trim(),
                challenges: challenges.join('\n'),
                challengeItems: challenges,
                profile: profileAnswers
            }

            restoredFormValuesRef.current = mergedFormValues

            await setDoc(
                doc(db, 'applicationDrafts', participantId),
                {
                    participantId,
                    programId: programId || null,
                    programName: programName || null,
                    formValues: mergedFormValues,
                    interventionSelections,
                    documentFields: documentFields.map(document => ({
                        key: document.key,
                        title: document.title,
                        issueDate: document.issueDate?.format('YYYY-MM-DD') || null,
                        expiryDate: document.expiryDate?.format('YYYY-MM-DD') || null,
                        fileName: document.file?.name || document.savedFileName || null
                    })),
                    onboardingFlowVersion: 7,
                    onboardingFlowSection: screen,
                    profileQuestionIndex: profileIndex,
                    activeSupportArea,
                    savedAt: new Date().toISOString(),
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )
        } catch (error) {
            console.error('[Application Flow] Failed to save draft:', error)
            messageApi.warning('Your latest answer could not be saved. Please try again.')
        } finally {
            setSaving(false)
        }
    }, [
        activeSupportArea,
        challenges,
        documentFields,
        interventionSelections,
        motivation,
        participantId,
        profileAnswers,
        profileIndex,
        programId,
        programName,
        screen,
        messageApi
    ])

    useEffect(() => {
        // Held off during submission: submitApplication saves the draft itself
        // and then deletes it, and a debounced write landing after that delete
        // would resurrect a draft for an application already submitted.
        if (!participantId || initialising || submitting || screen === 'welcome') {
            return
        }

        const timer = window.setTimeout(() => {
            void saveDraft()
        }, 900)

        return () => window.clearTimeout(timer)
    }, [
        motivation,
        challenges,
        profileAnswers,
        interventionSelections,
        documentFields,
        participantId,
        initialising,
        submitting,
        screen,
        saveDraft
    ])

    const uploadDocument = async (file: File) => {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const fileName = `${Date.now()}_${safeName}`
        const fileRef = storageRef(
            storage,
            `${DOCUMENT_STORAGE_FOLDER}/${fileName}`
        )

        await uploadBytes(fileRef, file)

        return { url: await getDownloadURL(fileRef), fileName }
    }

    /**
     * Uploaded one at a time so the applicant sees which document is in
     * flight, and so a slow connection is not asked to run every upload at
     * once. Requirements left empty still produce a row, marked `missing`,
     * because a reviewer needs to see the gap.
     */
    const uploadAllDocuments = async (): Promise<UploadedDoc[]> => {
        const uploaded: UploadedDoc[] = []

        for (let index = 0; index < documentFields.length; index += 1) {
            const field = documentFields[index]

            const base = {
                key: field.key,
                type: field.title,
                issueDate: field.issueDate?.format('YYYY-MM-DD') || null,
                expiryDate: field.expiryDate?.format('YYYY-MM-DD') || null
            }

            if (!field.file) {
                uploaded.push({
                    ...base,
                    url: null,
                    fileName: null,
                    status: 'missing'
                })
                continue
            }

            setSubmitStage(
                `Uploading ${field.title} (${index + 1} of ${documentFields.length})...`
            )

            const { url, fileName } = await uploadDocument(field.file)

            uploaded.push({ ...base, url, fileName, status: 'valid' })
        }

        return uploaded
    }

    /**
     * A second application to the same programme is refused rather than
     * stacked: the tracker hides programmes already applied to, so reaching
     * here twice means a stale tab or a re-used link.
     */
    const findExistingApplication = async (id: string) => {
        const snapshot = await getDocs(
            query(collection(db, 'applications'), where('participantId', '==', id))
        )

        return (
            snapshot.docs.find(entry => {
                const data = entry.data()
                const sameProgram =
                    String(data.programId || '') === String(programId || '')

                return (
                    sameProgram &&
                    ['pending', 'accepted', 'active'].includes(
                        norm(data.applicationStatus)
                    )
                )
            }) || null
        )
    }

    const submitApplication = async () => {
        if (submittingRef.current) return

        if (!participantId) {
            messageApi.error(
                'We could not find your participant profile. Please sign in again.'
            )
            return
        }

        // The same checks each screen applies, re-run here so an answer edited
        // back out on the review screen cannot slip through.
        if (motivationWords < MIN_MOTIVATION_WORDS) {
            messageApi.error(
                `Your motivation needs at least ${MIN_MOTIVATION_WORDS} words.`
            )
            await startReviewEdit('motivation', 'motivation')
            return
        }

        if (challenges.length === 0) {
            messageApi.error('Please list at least one challenge.')
            await startReviewEdit('challenges', 'challenges')
            return
        }

        const unansweredIndex = programQuestions.findIndex(
            question => !(profileAnswers[question.id] || '').trim()
        )

        if (unansweredIndex >= 0) {
            messageApi.error('Please answer every profile question.')
            await startReviewEdit('profile', 'profileQuestion')
            setProfileIndex(unansweredIndex)
            return
        }

        if (documentFields.length > 0 && complianceScore < MIN_COMPLIANCE_PERCENT) {
            messageApi.error(
                'Please upload at least one of the required documents before submitting.'
            )
            await startReviewEdit('documents', 'documents')
            return
        }

        submittingRef.current = true
        setSubmitting(true)
        setSubmitStage('Checking your application...')

        try {
            const participantRef = doc(db, 'participants', participantId)
            const participantSnap = await getDoc(participantRef)

            if (!participantSnap.exists()) {
                messageApi.error(
                    'Your participant profile is no longer available. Please contact support.'
                )
                return
            }

            const participantData = participantSnap.data() as Record<string, any>
            const email = String(
                participantData.email || auth.currentUser?.email || ''
            ).trim()

            if (!email) {
                messageApi.error(
                    'Your profile is missing an email address. Please add one before applying.'
                )
                return
            }

            const duplicate = await findExistingApplication(participantId)

            if (duplicate) {
                messageApi.warning(
                    'You have already applied to this programme. Track it from your applications.'
                )
                navigate('/applicant/tracker', { replace: true })
                return
            }

            // Keep the draft current before the irreversible part, so a failure
            // part-way through still leaves the answers recoverable.
            setSubmitStage('Saving your answers...')
            await saveDraft()

            const uploadedDocs = await uploadAllDocuments()

            setSubmitStage('Submitting your application...')

            const complianceSummary = {
                required: documentFields.map(document => document.key),
                completed: compliantDocumentKeys
            }

            const derivedAge = getAgeFromID(participantData.idNumber)
            const ageGroup = getAgeGroup(derivedAge)
            const stage = deriveStageFromRevenue(participantData)

            const registrationDate = participantData.dateOfRegistration
            const registrationDateString = registrationDate
                ? dayjs(
                    typeof registrationDate?.toDate === 'function'
                        ? registrationDate.toDate()
                        : registrationDate
                ).format('YYYY-MM-DD')
                : ''

            // Ties the submission to this applicant, programme and profile. The
            // GAP analysis reads it back to co-sign the agreement.
            const digitalSignature = SHA256(
                [
                    email,
                    participantData.participantName || '',
                    registrationDateString,
                    programId || '',
                    participantId
                ].join('|')
            )
                .toString()
                .slice(0, 16)

            const businessName =
                participantData.beneficiaryName ||
                participantData.companyName ||
                participantData.participantName ||
                ''

            // A profile question can nominate the nearest hub; that answer is
            // more current than whatever the profile was last saved with.
            const hub =
                (profileAnswers['nearest-hub'] || '').trim() ||
                participantData.hub ||
                null

            const interventionsPayload = {
                required: selectedInterventions,
                // Preserved rather than reset: an SME applying to a second
                // programme must not lose interventions already under way.
                assigned: Array.isArray(participantData.interventions?.assigned)
                    ? participantData.interventions.assigned
                    : [],
                completed: Array.isArray(participantData.interventions?.completed)
                    ? participantData.interventions.completed
                    : [],
                participationRate:
                    Number(participantData.interventions?.participationRate) || 0
            }

            const submittedAtISO = new Date().toISOString()

            const applicationRef = await addDoc(
                collection(db, 'applications'),
                pruneUndefinedDeep({
                    participantId,
                    programId: programId || null,
                    programName: programName || null,
                    branchId: programBranch.id,
                    branchName: programBranch.name,
                    applicationStatus: 'pending',
                    submittedAt: submittedAtISO,
                    createdAt: serverTimestamp(),
                    createdAtISO: submittedAtISO,
                    createdMonth: dayjs().format('YYYY-MM'),
                    createdYear: dayjs().format('YYYY'),
                    updatedAt: serverTimestamp(),
                    email,
                    applicantEmail: email,
                    applicantName: participantData.participantName || businessName,
                    beneficiaryName: participantData.beneficiaryName || businessName,
                    businessName,
                    companyName: businessName,
                    phone: participantData.phone || null,
                    gender: participantData.gender || null,
                    ageGroup,
                    stage,
                    province: participantData.province || null,
                    hub,
                    motivation,
                    challenges: challenges.join('\n'),
                    challengeItems: challenges,
                    profile: profileAnswers,
                    interventions: interventionsPayload,
                    complianceScore,
                    complianceDocuments: uploadedDocs,
                    complianceSummary,
                    digitalSignature,
                    gapGroup: 'A' as Group,
                    groupHistory: [initialGapGroupEntry()] as GroupHistoryEntry[],
                    // Reviewer-side enrichment fills these in; the reviewer
                    // table already renders a pending evaluation as "N/A".
                    aiEvaluation: null,
                    aiEvaluationStatus: 'pending'
                })
            )

            /*
             * Past this point the application exists, so the submission has
             * happened. The steps below are reported if they fail but are not
             * allowed to throw: raising them as a failed submission would send
             * the applicant back to a review screen whose duplicate guard now
             * refuses them, with no way forward.
             */
            try {
                await upsertComplianceSubdocs(applicationRef, uploadedDocs, {
                    programId,
                    programName,
                    uploadedByEmail: email
                })
            } catch (error) {
                console.error(
                    '[Application Flow] Compliance documents could not be indexed:',
                    error
                )
            }

            /*
             * The SME side of the submission. Everything downstream -- the SME
             * overview, funder analytics, intervention assignment -- reads the
             * participant record rather than the application, so the answers
             * captured in this flow are written back onto it. Merged, never
             * replaced: the profile the SME filled in earlier stays intact.
             */
            setSubmitStage('Updating your business profile...')

            try {
                await setDoc(
                    participantRef,
                    pruneUndefinedDeep({
                        motivation,
                        challenges: challenges.join('\n'),
                        challengeItems: challenges,
                        profile: profileAnswers,
                        programId: programId || null,
                        programName: programName || null,
                        branchId: programBranch.id,
                        branchName: programBranch.name,
                        hub,
                        stage,
                        ageGroup,
                        interventions: interventionsPayload,
                        complianceScore,
                        complianceDocuments: uploadedDocs,
                        complianceSummary,
                        applicationId: applicationRef.id,
                        applicationStatus: 'pending',
                        appliedAt: submittedAtISO,
                        digitalSignature,
                        setup: true,
                        updatedAt: serverTimestamp()
                    }),
                    { merge: true }
                )
            } catch (error) {
                console.error(
                    '[Application Flow] Participant record could not be updated:',
                    error
                )
                messageApi.warning(
                    'Your application was received, but your business profile could not be updated. Please let your coordinator know.'
                )
            }

            // The draft has served its purpose; the application is the record
            // now. A draft left behind is harmless -- the duplicate check keeps
            // it from becoming a second application.
            try {
                await deleteDoc(doc(db, 'applicationDrafts', participantId))
            } catch (error) {
                console.warn(
                    '[Application Flow] Draft could not be cleared:',
                    error
                )
            }

            // A courtesy confirmation. Failing to send it must not make a stored
            // application look like it failed.
            try {
                await httpsCallable(functions, 'sendApplicationReceivedEmail')({
                    email,
                    name: participantData.participantName || businessName || 'there',
                    programName: programName || ''
                })
            } catch (error) {
                console.warn(
                    '[Application Flow] Confirmation email could not be sent:',
                    error
                )
            }

            messageApi.success('Application submitted. Next: your gap analysis.')

            navigate('/incubatee/gap-analysis', {
                replace: true,
                state: {
                    participantId,
                    applicationId: applicationRef.id,
                    programId,
                    programName,
                    fromSubmission: true,
                    prefillData: {
                        companyName: businessName,
                        region: participantData.province || '',
                        contactDetails:
                            participantData.phone || participantData.contactNumber || '',
                        email,
                        dateOfEngagement: dayjs().format('YYYY-MM-DD')
                    }
                }
            })
        } catch (error: any) {
            console.error('[Application Flow] Submission failed:', error)
            messageApi.error(
                error?.message ||
                'We could not submit your application. Your answers are saved -- please try again.'
            )
        } finally {
            submittingRef.current = false
            setSubmitting(false)
        }
    }

    const goTo = async (
        nextScreen: FlowScreen,
        nextDirection: FlowDirection = 'forward'
    ) => {
        if (screen !== 'welcome') {
            await saveDraft()
        }

        setDirection(nextDirection)
        setScreen(nextScreen)
    }

    const startReviewEdit = async (
        section: Exclude<ReviewEditSection, null>,
        targetScreen: FlowScreen
    ) => {
        await saveDraft()

        setReviewEditSection(section)

        if (section === 'profile') {
            setProfileIndex(0)
        }

        setDirection('backward')
        setScreen(targetScreen)
    }

    const finishReviewEdit = async () => {
        await saveDraft()
        setReviewEditSection(null)
        setDirection('forward')
        setScreen('review')
    }

    const addChallenge = () => {
        const value = challengeInput.trim()
        if (!value) return

        const duplicate = challenges.some(
            item => item.toLowerCase() === value.toLowerCase()
        )

        if (duplicate) {
            messageApi.info('That challenge is already in your list.')
            return
        }

        setChallenges(previous => [...previous, value])
        setChallengeInput('')
    }

    const removeChallenge = (index: number) => {
        setChallenges(previous => previous.filter((_, itemIndex) => itemIndex !== index))
    }

    const openProfileSection = async () => {
        await saveDraft()
        setProfileIndex(0)
        setDirection('forward')
        setScreen('profileIntro')
    }

    const startProfileQuestions = async () => {
        await saveDraft()

        if (programQuestions.length === 0) {
            setDirection('forward')
            setScreen('supportIntro')
            return
        }

        setProfileIndex(0)
        setDirection('forward')
        setScreen('profileQuestion')
    }

    const continueProfileQuestion = async () => {
        if (!activeProfileQuestion) return

        if (!activeProfileAnswer.trim()) {
            messageApi.error('Please answer this question before continuing.')
            return
        }

        await saveDraft()

        if (profileIndex >= programQuestions.length - 1) {
            if (reviewEditSection === 'profile') {
                setReviewEditSection(null)
                setDirection('forward')
                setScreen('review')
                return
            }

            setDirection('forward')
            setScreen('supportIntro')
            return
        }

        setDirection('forward')
        setProfileIndex(index => index + 1)
    }

    const backProfileQuestion = async () => {
        await saveDraft()
        setDirection('backward')

        if (profileIndex === 0) {
            if (reviewEditSection === 'profile') {
                setReviewEditSection(null)
                setScreen('review')
                return
            }

            setScreen('profileIntro')
            return
        }

        setProfileIndex(index => Math.max(0, index - 1))
    }

    const openSupportArea = async (area: string) => {
        await saveDraft()
        setActiveSupportArea(area)
        setDirection('forward')
        setScreen('supportDepartment')
    }

    const toggleIntervention = (area: string, interventionId: string) => {
        setInterventionSelections(previous => {
            const current = previous[area] || []
            const selected = current.includes(interventionId)

            return {
                ...previous,
                [area]: selected
                    ? current.filter(id => id !== interventionId)
                    : [...current, interventionId]
            }
        })
    }

    const handleFileUpload = (file: File, key: string) => {
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            messageApi.error(
                `"${file.name}" is ${fmtBytes(file.size)}. Maximum size is ${MAX_FILE_MB} MB.`
            )
            return Upload.LIST_IGNORE
        }

        if (!ACCEPTED_MIME.includes(file.type)) {
            messageApi.error('Unsupported file type. Please upload PDF, PNG or JPG.')
            return Upload.LIST_IGNORE
        }

        setDocumentFields(previous =>
            previous.map(document =>
                document.key === key
                    ? {
                        ...document,
                        file,
                        savedFileName: file.name,
                        completed: false
                    }
                    : document
            )
        )

        return false
    }

    const clearDocumentFile = (key: string) => {
        setDocumentFields(previous =>
            previous.map(document =>
                document.key === key
                    ? {
                        ...document,
                        file: null,
                        savedFileName: null,
                        issueDate: null,
                        expiryDate: null,
                        completed: false
                    }
                    : document
            )
        )
    }

    const updateDocument = (
        key: string,
        patch: Partial<Pick<DocField, 'issueDate' | 'expiryDate'>>
    ) => {
        setDocumentFields(previous =>
            previous.map(document =>
                document.key === key
                    ? { ...document, ...patch, completed: false }
                    : document
            )
        )
    }

    const completeDocument = (key: string) => {
        const document = documentFields.find(item => item.key === key)
        if (!document) return

        if (!document.file) {
            messageApi.error(`Please upload ${document.title}.`)
            return
        }

        if (!document.issueDate) {
            messageApi.error(`Please provide the issue date for ${document.title}.`)
            return
        }

        if (document.requiresExpiry && !document.expiryDate) {
            messageApi.error(`Please provide the expiry date for ${document.title}.`)
            return
        }

        setDocumentFields(previous =>
            previous.map(item =>
                item.key === key
                    ? { ...item, completed: true }
                    : item
            )
        )
        setOpenDocumentKey(null)
    }

    const disabledExpiryDate = (document: DocField) => (currentDate: Dayjs) => {
        if (!currentDate) return false

        const today = dayjs().startOf('day')
        if (currentDate.isBefore(today)) return true

        if (document.expiryMonths) {
            const max = dayjs().add(document.expiryMonths, 'month').endOf('day')
            if (currentDate.isAfter(max)) return true
        }

        return false
    }

    const transition = reduceMotion
        ? {
            initial: { opacity: 1, x: 0 },
            animate: { opacity: 1, x: 0 },
            exit: { opacity: 1, x: 0 },
            transition: { duration: 0 }
        }
        : {
            initial: {
                opacity: 0,
                x: direction === 'forward' ? 48 : -48
            },
            animate: {
                opacity: 1,
                x: 0
            },
            exit: {
                opacity: 0,
                x: direction === 'forward' ? -48 : 48
            },
            transition: {
                duration: 0.24,
                ease: [0.22, 1, 0.36, 1] as const
            }
        }

    const motionKey = screen === 'profileQuestion'
        ? `${screen}-${profileIndex}`
        : screen === 'supportDepartment'
            ? `${screen}-${activeSupportArea || 'none'}`
            : screen

    const renderHeader = () => {
        if (
            screen === 'welcome' ||
            screen === 'profileIntro' ||
            screen === 'supportIntro' ||
            screen === 'documentsIntro' ||
            screen === 'review'
        ) {
            return null
        }

        if (screen === 'profileQuestion') {
            return (
                <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            marginBottom: 6
                        }}
                    >
                        <Text type='secondary' style={{ fontSize: 13 }}>
                            Programme questions
                        </Text>

                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {profileIndex + 1} of {programQuestions.length}
                        </Text>
                    </div>

                    <Progress
                        percent={profileProgress}
                        showInfo={false}
                        size='small'
                        strokeColor={token.colorPrimary}
                        trailColor={token.colorBorderSecondary}
                    />
                </div>
            )
        }

        if (screen === 'supportAreas' || screen === 'supportDepartment') {
            return (
                <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <Text type='secondary' style={{ fontSize: 13 }}>Support needs</Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {selectedInterventionCount} selected
                        </Text>
                    </div>
                </div>
            )
        }

        if (screen === 'documents') {
            return (
                <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <Text type='secondary' style={{ fontSize: 13 }}>Documents</Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {readyDocuments.length} of {documentFields.length} ready
                        </Text>
                    </div>
                    <Progress
                        percent={documentsProgress}
                        showInfo={false}
                        size='small'
                        strokeColor={allDocumentsReady ? token.colorSuccess : token.colorPrimary}
                        trailColor={token.colorBorderSecondary}
                    />
                </div>
            )
        }

        return (
            <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 6
                    }}
                >
                    <Text type='secondary' style={{ fontSize: 13 }}>
                        Getting to know your business
                    </Text>

                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {screen === 'motivation' ? '1 of 2' : '2 of 2'}
                    </Text>
                </div>

                <Progress
                    percent={screen === 'motivation' ? 50 : 100}
                    showInfo={false}
                    size='small'
                    strokeColor={token.colorPrimary}
                    trailColor={token.colorBorderSecondary}
                />
            </div>
        )
    }

    const renderDocumentCard = (document: DocField) => {
        const open = openDocumentKey === document.key
        const hasFile = Boolean(document.file)
        const restoredFileNeedsUpload = Boolean(document.savedFileName && !document.file)

        return (
            <Card
                key={document.key}
                size='small'
                styles={{ body: { padding: 0 } }}
                style={{
                    borderRadius: 14,
                    borderColor: document.completed
                        ? token.colorSuccessBorder
                        : token.colorBorderSecondary,
                    overflow: 'hidden'
                }}
            >
                <button
                    type='button'
                    onClick={() => setOpenDocumentKey(open ? null : document.key)}
                    style={{
                        width: '100%',
                        border: 0,
                        background: 'transparent',
                        padding: '13px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: token.colorText
                    }}
                >
                    <div style={{ minWidth: 0 }}>
                        <Text strong>{document.title}</Text>
                        {restoredFileNeedsUpload && (
                            <Text
                                type='secondary'
                                style={{ display: 'block', fontSize: 12, marginTop: 2 }}
                            >
                                Re-upload required after restoring your draft
                            </Text>
                        )}
                    </div>

                    <Tag
                        color={document.completed ? 'success' : undefined}
                        icon={document.completed ? <CheckOutlined /> : undefined}
                        style={{ marginInlineEnd: 0, flex: '0 0 auto' }}
                    >
                        {document.completed ? 'Ready' : 'Missing'}
                    </Tag>
                </button>

                {open && (
                    <div
                        style={{
                            borderTop: `1px solid ${token.colorBorderSecondary}`,
                            padding: 14,
                            background: token.colorFillQuaternary
                        }}
                    >
                        <Upload
                            accept={ACCEPTED_MIME.join(',')}
                            beforeUpload={file => handleFileUpload(file as File, document.key)}
                            fileList={document.file ? [{
                                uid: document.key,
                                name: document.file.name,
                                status: 'done'
                            }] : []}
                            onRemove={() => {
                                clearDocumentFile(document.key)
                                return true
                            }}
                            maxCount={1}
                        >
                            <Button icon={<UploadOutlined />}>
                                {hasFile ? 'Replace document' : 'Upload document'}
                            </Button>
                        </Upload>

                        {!hasFile && (
                            <Text
                                type='secondary'
                                style={{ display: 'block', marginTop: 8, fontSize: 12 }}
                            >
                                PDF, PNG or JPG. Maximum {MAX_FILE_MB} MB.
                            </Text>
                        )}

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns:
                                    document.requiresExpiry && screens.sm
                                        ? 'repeat(2, minmax(0, 1fr))'
                                        : '1fr',
                                gap: 10,
                                marginTop: 14
                            }}
                        >
                            <div>
                                <Text
                                    type='secondary'
                                    style={{ display: 'block', fontSize: 12, marginBottom: 5 }}
                                >
                                    Issue date
                                </Text>
                                <DatePicker
                                    value={document.issueDate}
                                    disabled={!hasFile}
                                    disabledDate={currentDate =>
                                        Boolean(currentDate && currentDate.isAfter(dayjs(), 'day'))
                                    }
                                    onChange={date => updateDocument(document.key, { issueDate: date })}
                                    style={{ width: '100%' }}
                                />
                            </div>

                            {document.requiresExpiry && (
                                <div>
                                    <Text
                                        type='secondary'
                                        style={{ display: 'block', fontSize: 12, marginBottom: 5 }}
                                    >
                                        Expiry date
                                    </Text>
                                    <DatePicker
                                        value={document.expiryDate}
                                        disabled={!hasFile}
                                        disabledDate={disabledExpiryDate(document)}
                                        onChange={date => updateDocument(document.key, { expiryDate: date })}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            )}
                        </div>

                        <Button
                            type='primary'
                            size='middle'
                            onClick={() => completeDocument(document.key)}
                            style={{ width: '100%', borderRadius: 10, marginTop: 14 }}
                        >
                            Done
                        </Button>
                    </div>
                )}
            </Card>
        )
    }

    if (initialising) {
        return (
            <div>
                <Helmet>
                    <title>Application | Smart Incubation Platform</title>
                </Helmet>
                <LoadingOverlay tip='Preparing your application...' />
            </div>
        )
    }

    if (submitting) {
        return (
            <div>
                {contextHolder}
                <Helmet>
                    <title>Application | Smart Incubation Platform</title>
                </Helmet>
                <LoadingOverlay tip={submitStage} />
            </div>
        )
    }

    return (
        <div
            style={{
                height: '100dvh',
                boxSizing: 'border-box',
                overflow: 'hidden',
                background: token.colorBgLayout,
                display: 'flex',
                justifyContent: 'center',
                padding: '20px 16px'
            }}
        >
            {contextHolder}

            <Helmet>
                <title>Application | Smart Incubation Platform</title>
                <meta
                    name='description'
                    content='A guided application experience for Smart Incubation participants.'
                />
            </Helmet>

            <div
                style={{
                    width: '100%',
                    maxWidth: screen === 'review' ? 1120 : 760,
                    minWidth: 0,
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                {renderHeader()}

                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden'
                    }}
                >
                    <AnimatePresence mode='wait' initial={false}>
                        <motion.div
                            key={motionKey}
                            {...transition}
                            style={{
                                height: '100%',
                                minHeight: 0,
                                overflow: 'auto',
                                scrollbarGutter: 'stable',
                                display: 'grid',
                                alignItems: [
                                    'welcome',
                                    'profileIntro',
                                    'supportIntro',
                                    'documentsIntro'
                                ].includes(screen)
                                    ? 'center'
                                    : 'start',
                                padding: '8px 0 16px'
                            }}
                        >
                            {screen === 'welcome' && (
                                <Card
                                    variant='borderless'
                                    styles={{
                                        body: {
                                            padding: 'clamp(28px, 5vw, 48px)',
                                            textAlign: 'center'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 76,
                                            height: 76,
                                            margin: '0 auto 22px',
                                            borderRadius: 24,
                                            display: 'grid',
                                            placeItems: 'center',
                                            background: token.colorPrimaryBg,
                                            color: token.colorPrimary,
                                            fontSize: 30
                                        }}
                                        aria-hidden='true'
                                    >
                                        <MessageOutlined />
                                    </div>

                                    <Text
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            color: token.colorPrimary,
                                            fontWeight: 700,
                                            letterSpacing: 0.2
                                        }}
                                    >
                                        Thuso
                                    </Text>

                                    <Title
                                        level={2}
                                        style={{
                                            margin: '0 auto 14px',
                                            maxWidth: 560,
                                            lineHeight: 1.18
                                        }}
                                    >
                                        Hi, I&apos;m Thuso.{' '}
                                        <TypewriterPhrase
                                            reducedMotion={Boolean(reduceMotion)}
                                            text={
                                                programName
                                                    ? `I'll help you apply to ${programName}.`
                                                    : "I'll help you apply to the programme."
                                            }
                                        />
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            maxWidth: 570,
                                            margin: '0 auto 28px',
                                            fontSize: 16,
                                            lineHeight: 1.7
                                        }}
                                    >
                                        I&apos;ll guide you through a few short questions about your
                                        business, the support you need, and the documents required for
                                        your application. We&apos;ll do one question at a time, and your
                                        progress will be saved as you go.
                                    </Paragraph>

                                    <Button
                                        type='primary'
                                        size='large'
                                        icon={<ArrowRightOutlined />}
                                        iconPosition='end'
                                        onClick={() => void goTo('motivation')}
                                        style={{
                                            minWidth: 180,
                                            height: 48,
                                            borderRadius: 12,
                                            fontWeight: 600
                                        }}
                                    >
                                        Let&apos;s begin
                                    </Button>
                                </Card>
                            )}

                            {screen === 'motivation' && (
                                <Card
                                    styles={{
                                        body: {
                                            padding: 'clamp(22px, 4vw, 36px)'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Title level={2} style={{ marginBottom: 8 }}>
                                        Why do you want to join this programme?
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            fontSize: 15,
                                            marginBottom: 18,
                                            maxWidth: 620
                                        }}
                                    >
                                        Tell us where your business is now, what you want to achieve,
                                        and how you hope the programme can help you get there.
                                    </Paragraph>

                                    <TextArea
                                        value={motivation}
                                        onChange={event => setMotivation(event.target.value)}
                                        placeholder='Write your motivation here...'
                                        style={{
                                            height: 'clamp(220px, 34dvh, 300px)',
                                            fontSize: 16,
                                            lineHeight: 1.65,
                                            borderRadius: 14,
                                            resize: 'none',
                                            overflowY: 'auto'
                                        }}
                                    />

                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 12,
                                            marginTop: 12,
                                            flexWrap: 'wrap'
                                        }}
                                    >
                                        <Space size={8}>
                                            <Progress
                                                type='circle'
                                                percent={motivationProgress}
                                                size={28}
                                                showInfo={false}
                                                strokeColor={
                                                    canContinueMotivation
                                                        ? token.colorSuccess
                                                        : token.colorPrimary
                                                }
                                            />
                                            <Text type='secondary' style={{ fontSize: 13 }}>
                                                {motivationWords} / {MIN_MOTIVATION_WORDS} words
                                            </Text>
                                        </Space>

                                        {saving && (
                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                Saving...
                                            </Text>
                                        )}
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 22
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() =>
                                                reviewEditSection === 'motivation'
                                                    ? void finishReviewEdit()
                                                    : void goTo('welcome', 'backward')
                                            }
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {reviewEditSection === 'motivation' ? 'Back to review' : 'Back'}
                                        </Button>

                                        <Button
                                            type='primary'
                                            size='middle'
                                            disabled={!canContinueMotivation}
                                            icon={reviewEditSection === 'motivation' ? <CheckOutlined /> : <ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() =>
                                                reviewEditSection === 'motivation'
                                                    ? void finishReviewEdit()
                                                    : void goTo('challenges')
                                            }
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {reviewEditSection === 'motivation' ? 'Done' : 'Continue'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'challenges' && (
                                <Card
                                    styles={{
                                        body: {
                                            padding: 'clamp(22px, 4vw, 36px)'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Title level={2} style={{ marginBottom: 8 }}>
                                        What challenges are holding your business back?
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            fontSize: 15,
                                            marginBottom: 18,
                                            maxWidth: 620
                                        }}
                                    >
                                        Add one challenge at a time. This helps us understand where you
                                        need support without making you write one long paragraph.
                                    </Paragraph>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                                            gap: 10
                                        }}
                                    >
                                        <Input
                                            size='large'
                                            value={challengeInput}
                                            placeholder='e.g. Finding new customers'
                                            onChange={event => setChallengeInput(event.target.value)}
                                            onPressEnter={event => {
                                                event.preventDefault()
                                                addChallenge()
                                            }}
                                            style={{ borderRadius: 12 }}
                                        />

                                        <Button
                                            type='primary'
                                            size='large'
                                            icon={<PlusOutlined />}
                                            disabled={!challengeInput.trim()}
                                            onClick={addChallenge}
                                            style={{ borderRadius: 12 }}
                                        >
                                            Add
                                        </Button>
                                    </div>

                                    <div
                                        style={{
                                            marginTop: 18,
                                            display: 'grid',
                                            gap: 10,
                                            maxHeight: 'clamp(170px, 27dvh, 250px)',
                                            overflowY: 'auto',
                                            paddingRight: challenges.length > 2 ? 4 : 0
                                        }}
                                    >
                                        {challenges.length === 0 ? (
                                            <div
                                                style={{
                                                    padding: '24px 18px',
                                                    borderRadius: 14,
                                                    border: `1px dashed ${token.colorBorder}`,
                                                    textAlign: 'center',
                                                    color: token.colorTextSecondary
                                                }}
                                            >
                                                No challenges added yet. You can add one above or continue
                                                without adding any.
                                            </div>
                                        ) : (
                                            challenges.map((challenge, index) => (
                                                <div
                                                    key={`${challenge}-${index}`}
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '34px minmax(0, 1fr) 36px',
                                                        alignItems: 'center',
                                                        gap: 10,
                                                        padding: '12px 12px 12px 14px',
                                                        borderRadius: 14,
                                                        border: `1px solid ${token.colorBorderSecondary}`,
                                                        background: token.colorFillQuaternary
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: 30,
                                                            height: 30,
                                                            borderRadius: 10,
                                                            display: 'grid',
                                                            placeItems: 'center',
                                                            background: token.colorPrimaryBg,
                                                            color: token.colorPrimary,
                                                            fontWeight: 700,
                                                            fontSize: 12
                                                        }}
                                                    >
                                                        {index + 1}
                                                    </div>

                                                    <Text style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                                                        {challenge}
                                                    </Text>

                                                    <Button
                                                        type='text'
                                                        danger
                                                        aria-label={`Remove challenge ${index + 1}`}
                                                        icon={<CloseOutlined />}
                                                        onClick={() => removeChallenge(index)}
                                                    />
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            fontSize: 12,
                                            marginTop: 14
                                        }}
                                    >
                                        {saving ? 'Saving...' : `${challenges.length} added`}
                                    </Text>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 12
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() =>
                                                reviewEditSection === 'challenges'
                                                    ? void finishReviewEdit()
                                                    : void goTo('motivation', 'backward')
                                            }
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {reviewEditSection === 'challenges' ? 'Back to review' : 'Back'}
                                        </Button>

                                        <Button
                                            type='primary'
                                            size='middle'
                                            icon={reviewEditSection === 'challenges' ? <CheckOutlined /> : <ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() =>
                                                reviewEditSection === 'challenges'
                                                    ? void finishReviewEdit()
                                                    : void openProfileSection()
                                            }
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {reviewEditSection === 'challenges' ? 'Done' : 'Continue'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'profileIntro' && (
                                <Card
                                    variant='borderless'
                                    styles={{
                                        body: {
                                            padding: 'clamp(28px, 5vw, 48px)',
                                            textAlign: 'center'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 68,
                                            height: 68,
                                            margin: '0 auto 20px',
                                            borderRadius: 22,
                                            display: 'grid',
                                            placeItems: 'center',
                                            background: token.colorPrimaryBg,
                                            color: token.colorPrimary,
                                            fontSize: 26
                                        }}
                                        aria-hidden='true'
                                    >
                                        <MessageOutlined />
                                    </div>

                                    <Text
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            color: token.colorPrimary,
                                            fontWeight: 700
                                        }}
                                    >
                                        Thuso
                                    </Text>

                                    <Title level={2} style={{ marginBottom: 10 }}>
                                        Great.{' '}
                                        <TypewriterPhrase
                                            reducedMotion={Boolean(reduceMotion)}
                                            text='Now I need a little more about your business.'
                                            speed={42}
                                        />
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            maxWidth: 540,
                                            margin: '0 auto 24px',
                                            fontSize: 15,
                                            lineHeight: 1.7
                                        }}
                                    >
                                        These questions are specific to
                                        {programName ? ` ${programName}` : ' this programme'}.
                                        I&apos;ll ask them one at a time so you can focus on each answer.
                                    </Paragraph>

                                    {!programQuestionsLoaded && (
                                        <Text
                                            type='secondary'
                                            style={{ display: 'block', marginBottom: 18 }}
                                        >
                                            Loading programme questions...
                                        </Text>
                                    )}

                                    {programQuestionsLoaded && programQuestions.length === 0 && (
                                        <Text
                                            type='secondary'
                                            style={{ display: 'block', marginBottom: 18 }}
                                        >
                                            There are no additional programme questions configured.
                                        </Text>
                                    )}

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            maxWidth: 520,
                                            margin: '0 auto'
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => void goTo('challenges', 'backward')}
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            Back
                                        </Button>

                                        <Button
                                            type='primary'
                                            size='middle'
                                            loading={!programQuestionsLoaded}
                                            disabled={!programQuestionsLoaded}
                                            icon={<ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() => void startProfileQuestions()}
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {programQuestions.length > 0 ? 'Continue' : 'Next section'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'profileQuestion' && activeProfileQuestion && (
                                <Card
                                    styles={{
                                        body: {
                                            padding: 'clamp(26px, 5vw, 44px)'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            fontSize: 13
                                        }}
                                    >
                                        Question {profileIndex + 1}
                                    </Text>

                                    <Title level={2} style={{ marginBottom: 22 }}>
                                        {activeProfileQuestion.label}
                                    </Title>

                                    {activeProfileQuestion.type === 'dropdown' ? (
                                        activeProfileUsesChoiceCards ? (
                                            <div
                                                role='radiogroup'
                                                aria-label={activeProfileQuestion.label}
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: `repeat(${choiceCardColumns}, minmax(0, 1fr))`,
                                                    gap: 10,
                                                    width: '100%'
                                                }}
                                            >
                                                {orderedChoiceOptions.map((option, optionIndex) => {
                                                    const selected = activeProfileAnswer === option
                                                    const optionKey = option.trim().toLowerCase()
                                                    const yesNoIcon = activeProfileIsYesNo
                                                        ? optionKey === 'yes'
                                                            ? <CheckOutlined />
                                                            : <CloseOutlined />
                                                        : null
                                                    const isOddFullWidthCard =
                                                        orderedChoiceOptions.length % 2 === 1 &&
                                                        optionIndex === orderedChoiceOptions.length - 1

                                                    return (
                                                        <button
                                                            key={option}
                                                            type='button'
                                                            role='radio'
                                                            aria-checked={selected}
                                                            onClick={() =>
                                                                setProfileAnswers(previous => ({
                                                                    ...previous,
                                                                    [activeProfileQuestion.id]: option
                                                                }))
                                                            }
                                                            style={{
                                                                appearance: 'none',
                                                                width: '100%',
                                                                gridColumn: isOddFullWidthCard ? '1 / -1' : undefined,
                                                                minHeight: activeProfileIsYesNo ? 78 : 64,
                                                                padding: activeProfileIsYesNo
                                                                    ? '12px 14px'
                                                                    : '10px 12px',
                                                                borderRadius: 14,
                                                                border: `1px solid ${selected
                                                                        ? token.colorPrimary
                                                                        : token.colorBorder
                                                                    }`,
                                                                background: selected
                                                                    ? token.colorPrimaryBg
                                                                    : token.colorBgContainer,
                                                                color: selected
                                                                    ? token.colorPrimary
                                                                    : token.colorText,
                                                                cursor: 'pointer',
                                                                font: 'inherit',
                                                                fontWeight: selected ? 700 : 600,
                                                                textAlign: 'center',
                                                                transition: 'border-color .2s ease, background .2s ease, color .2s ease',
                                                                outline: 'none'
                                                            }}
                                                            onFocus={event => {
                                                                event.currentTarget.style.boxShadow =
                                                                    `0 0 0 2px ${token.colorPrimaryBorder}`
                                                            }}
                                                            onBlur={event => {
                                                                event.currentTarget.style.boxShadow = 'none'
                                                            }}
                                                        >
                                                            {activeProfileIsYesNo ? (
                                                                <span
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        gap: 10
                                                                    }}
                                                                >
                                                                    <span
                                                                        aria-hidden='true'
                                                                        style={{
                                                                            width: 34,
                                                                            height: 34,
                                                                            borderRadius: 12,
                                                                            display: 'grid',
                                                                            placeItems: 'center',
                                                                            background: selected
                                                                                ? token.colorPrimary
                                                                                : token.colorFillSecondary,
                                                                            color: selected
                                                                                ? token.colorTextLightSolid
                                                                                : token.colorTextSecondary,
                                                                            fontSize: 16,
                                                                            flex: '0 0 auto'
                                                                        }}
                                                                    >
                                                                        {yesNoIcon}
                                                                    </span>
                                                                    <span>{option}</span>
                                                                </span>
                                                            ) : (
                                                                <span>{option}</span>
                                                            )}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        ) : activeProfileUsesSearchList ? (
                                            <div>
                                                <Input
                                                    size='large'
                                                    allowClear
                                                    prefix={<SearchOutlined />}
                                                    value={profileOptionSearch}
                                                    placeholder={`Search ${activeProfileOptions.length} options`}
                                                    onChange={event => setProfileOptionSearch(event.target.value)}
                                                    style={{
                                                        borderRadius: 12,
                                                        marginBottom: 10
                                                    }}
                                                />

                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        gap: 10,
                                                        marginBottom: 8
                                                    }}
                                                >
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        Select one option
                                                    </Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {filteredLargeProfileOptions.length} of {activeProfileOptions.length}
                                                    </Text>
                                                </div>

                                                <div
                                                    role='radiogroup'
                                                    aria-label={activeProfileQuestion.label}
                                                    style={{
                                                        display: 'grid',
                                                        gap: 8,
                                                        maxHeight: 'clamp(210px, 32dvh, 300px)',
                                                        overflowY: 'auto',
                                                        paddingRight: 4,
                                                        scrollbarGutter: 'stable'
                                                    }}
                                                >
                                                    {filteredLargeProfileOptions.length > 0 ? (
                                                        filteredLargeProfileOptions.map(option => {
                                                            const selected = activeProfileAnswer === option

                                                            return (
                                                                <button
                                                                    key={option}
                                                                    type='button'
                                                                    role='radio'
                                                                    aria-checked={selected}
                                                                    onClick={() =>
                                                                        setProfileAnswers(previous => ({
                                                                            ...previous,
                                                                            [activeProfileQuestion.id]: option
                                                                        }))
                                                                    }
                                                                    style={{
                                                                        appearance: 'none',
                                                                        width: '100%',
                                                                        minHeight: 48,
                                                                        display: 'grid',
                                                                        gridTemplateColumns: 'minmax(0, 1fr) 28px',
                                                                        alignItems: 'center',
                                                                        gap: 12,
                                                                        padding: '10px 12px 10px 14px',
                                                                        borderRadius: 12,
                                                                        border: `1px solid ${selected
                                                                                ? token.colorPrimary
                                                                                : token.colorBorderSecondary
                                                                            }`,
                                                                        background: selected
                                                                            ? token.colorPrimaryBg
                                                                            : token.colorBgContainer,
                                                                        color: selected
                                                                            ? token.colorPrimary
                                                                            : token.colorText,
                                                                        cursor: 'pointer',
                                                                        font: 'inherit',
                                                                        fontWeight: selected ? 700 : 500,
                                                                        textAlign: 'left',
                                                                        outline: 'none'
                                                                    }}
                                                                >
                                                                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                                                                        {option}
                                                                    </span>

                                                                    <span
                                                                        aria-hidden='true'
                                                                        style={{
                                                                            width: 26,
                                                                            height: 26,
                                                                            borderRadius: 9,
                                                                            display: 'grid',
                                                                            placeItems: 'center',
                                                                            background: selected
                                                                                ? token.colorPrimary
                                                                                : token.colorFillSecondary,
                                                                            color: selected
                                                                                ? token.colorTextLightSolid
                                                                                : 'transparent',
                                                                            fontSize: 12
                                                                        }}
                                                                    >
                                                                        <CheckOutlined />
                                                                    </span>
                                                                </button>
                                                            )
                                                        })
                                                    ) : (
                                                        <div
                                                            style={{
                                                                padding: '22px 16px',
                                                                textAlign: 'center',
                                                                border: `1px dashed ${token.colorBorder}`,
                                                                borderRadius: 12,
                                                                color: token.colorTextSecondary
                                                            }}
                                                        >
                                                            No options match &quot;{profileOptionSearch}&quot;.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null
                                    ) : (
                                        <Input
                                            size='large'
                                            value={activeProfileAnswer}
                                            placeholder={activeProfileQuestion.placeholder || 'Type your answer'}
                                            onChange={event =>
                                                setProfileAnswers(previous => ({
                                                    ...previous,
                                                    [activeProfileQuestion.id]: event.target.value
                                                }))
                                            }
                                            onPressEnter={() => {
                                                if (activeProfileAnswer.trim()) {
                                                    void continueProfileQuestion()
                                                }
                                            }}
                                            style={{ borderRadius: 12 }}
                                        />
                                    )}

                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            minHeight: 20,
                                            marginTop: 12,
                                            fontSize: 12
                                        }}
                                    >
                                        {saving ? 'Saving...' : 'Your answer is saved automatically.'}
                                    </Text>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 22
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => void backProfileQuestion()}
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {reviewEditSection === 'profile' && profileIndex === 0
                                                ? 'Back to review'
                                                : 'Back'}
                                        </Button>

                                        <Button
                                            type='primary'
                                            size='middle'
                                            disabled={!activeProfileAnswer.trim()}
                                            icon={
                                                reviewEditSection === 'profile' &&
                                                    profileIndex === programQuestions.length - 1
                                                    ? <CheckOutlined />
                                                    : <ArrowRightOutlined />
                                            }
                                            iconPosition='end'
                                            onClick={() => void continueProfileQuestion()}
                                            style={{
                                                width: '100%',
                                                borderRadius: 10,
                                                fontWeight: 600
                                            }}
                                        >
                                            {profileIndex === programQuestions.length - 1
                                                ? reviewEditSection === 'profile'
                                                    ? 'Done'
                                                    : 'Finish section'
                                                : 'Continue'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'supportIntro' && (
                                <Card
                                    variant='borderless'
                                    styles={{
                                        body: {
                                            padding: 'clamp(28px, 5vw, 48px)',
                                            textAlign: 'center'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 68,
                                            height: 68,
                                            margin: '0 auto 20px',
                                            borderRadius: 22,
                                            display: 'grid',
                                            placeItems: 'center',
                                            background: token.colorPrimaryBg,
                                            color: token.colorPrimary,
                                            fontSize: 26
                                        }}
                                        aria-hidden='true'
                                    >
                                        <AppstoreOutlined />
                                    </div>

                                    <Text
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            color: token.colorPrimary,
                                            fontWeight: 700
                                        }}
                                    >
                                        Thuso
                                    </Text>

                                    <Title level={2} style={{ marginBottom: 10 }}>
                                        Almost there.{' '}
                                        <TypewriterPhrase
                                            reducedMotion={Boolean(reduceMotion)}
                                            text="Let's look at the support your business needs."
                                            speed={42}
                                            delay={260}
                                        />
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            maxWidth: 560,
                                            margin: '0 auto 24px',
                                            fontSize: 15,
                                            lineHeight: 1.7
                                        }}
                                    >
                                        You do not need to choose something from every area. Open the
                                        areas that matter to your business and select as many support
                                        options as you need.
                                    </Paragraph>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            maxWidth: 520,
                                            margin: '0 auto'
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => {
                                                if (programQuestions.length > 0) {
                                                    setProfileIndex(Math.max(programQuestions.length - 1, 0))
                                                    void goTo('profileQuestion', 'backward')
                                                } else {
                                                    void goTo('profileIntro', 'backward')
                                                }
                                            }}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Back
                                        </Button>

                                        <Button
                                            type='primary'
                                            size='middle'
                                            icon={<ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() => void goTo('supportAreas')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            View support areas
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'supportAreas' && (
                                <Card
                                    styles={{ body: { padding: 'clamp(20px, 3.5vw, 32px)' } }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            justifyContent: 'space-between',
                                            gap: 16,
                                            marginBottom: 18,
                                            flexWrap: 'wrap'
                                        }}
                                    >
                                        <div>
                                            <Title level={2} style={{ marginBottom: 6 }}>
                                                What areas would you like support with?
                                            </Title>
                                            <Text type='secondary'>
                                                Open an area to see its available support options.
                                            </Text>
                                        </div>

                                        {selectedInterventionCount > 0 && (
                                            <Tag color='processing' style={{ marginInlineEnd: 0 }}>
                                                {selectedInterventionCount} selected
                                            </Tag>
                                        )}
                                    </div>

                                    {interventionGroups.length === 0 ? (
                                        <div
                                            style={{
                                                padding: 28,
                                                textAlign: 'center',
                                                border: `1px dashed ${token.colorBorder}`,
                                                borderRadius: 14,
                                                color: token.colorTextSecondary
                                            }}
                                        >
                                            There are no optional support areas available for this application.
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: screens.sm
                                                    ? 'repeat(2, minmax(0, 1fr))'
                                                    : '1fr',
                                                gap: 12,
                                                maxHeight: 'clamp(330px, 57dvh, 520px)',
                                                overflowY: 'auto',
                                                paddingRight: 4
                                            }}
                                        >
                                            {interventionGroups.map(group => {
                                                const selectedCount =
                                                    (interventionSelections[group.area] || []).length
                                                const examples = group.interventions
                                                    .slice(0, 2)
                                                    .map(item => item.title)
                                                    .join(', ')

                                                return (
                                                    <button
                                                        type='button'
                                                        key={group.area}
                                                        onClick={() => void openSupportArea(group.area)}
                                                        style={{
                                                            border: `1px solid ${selectedCount > 0
                                                                    ? token.colorPrimaryBorder
                                                                    : token.colorBorderSecondary
                                                                }`,
                                                            borderRadius: 15,
                                                            padding: 16,
                                                            background:
                                                                selectedCount > 0
                                                                    ? token.colorPrimaryBg
                                                                    : token.colorBgContainer,
                                                            color: token.colorText,
                                                            cursor: 'pointer',
                                                            textAlign: 'left',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            minHeight: 148
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                justifyContent: 'space-between',
                                                                gap: 10,
                                                                width: '100%'
                                                            }}
                                                        >
                                                            <Text strong style={{ fontSize: 15 }}>
                                                                {group.area}
                                                            </Text>
                                                            <ArrowRightOutlined
                                                                style={{ color: token.colorTextSecondary }}
                                                            />
                                                        </div>

                                                        <Text
                                                            type='secondary'
                                                            style={{
                                                                display: 'block',
                                                                marginTop: 8,
                                                                fontSize: 12,
                                                                lineHeight: 1.5,
                                                                flex: 1
                                                            }}
                                                        >
                                                            {examples
                                                                ? `Includes ${examples}${group.interventions.length > 2 ? ' and more.' : '.'}`
                                                                : 'Open to view support options.'}
                                                        </Text>

                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                gap: 8,
                                                                marginTop: 12
                                                            }}
                                                        >
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                {group.interventions.length} option{group.interventions.length === 1 ? '' : 's'}
                                                            </Text>
                                                            {selectedCount > 0 && (
                                                                <Tag color='processing' style={{ marginInlineEnd: 0 }}>
                                                                    {selectedCount} selected
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 22
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() =>
                                                reviewEditSection === 'support'
                                                    ? void finishReviewEdit()
                                                    : void goTo('supportIntro', 'backward')
                                            }
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            {reviewEditSection === 'support' ? 'Back to review' : 'Back'}
                                        </Button>
                                        <Button
                                            type='primary'
                                            size='middle'
                                            icon={reviewEditSection === 'support' ? <CheckOutlined /> : <ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() =>
                                                reviewEditSection === 'support'
                                                    ? void finishReviewEdit()
                                                    : void goTo('documentsIntro')
                                            }
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            {reviewEditSection === 'support' ? 'Done' : 'Continue'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'supportDepartment' && activeInterventionGroup && (
                                <Card
                                    styles={{ body: { padding: 'clamp(20px, 3.5vw, 32px)' } }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <div style={{ marginBottom: 16 }}>
                                        <Text
                                            type='secondary'
                                            style={{ display: 'block', fontSize: 12, marginBottom: 5 }}
                                        >
                                            {activeInterventionGroup.area}
                                        </Text>
                                        <Title level={2} style={{ marginBottom: 6 }}>
                                            What support would help your business?
                                        </Title>
                                        <Text type='secondary'>Select as many as you need.</Text>
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gap: 9,
                                            maxHeight: 'clamp(300px, 53dvh, 480px)',
                                            overflowY: 'auto',
                                            paddingRight: 4
                                        }}
                                    >
                                        {activeInterventionGroup.interventions.map(intervention => {
                                            const selected = (
                                                interventionSelections[activeInterventionGroup.area] || []
                                            ).includes(intervention.id)

                                            return (
                                                <button
                                                    type='button'
                                                    key={intervention.id}
                                                    onClick={() =>
                                                        toggleIntervention(
                                                            activeInterventionGroup.area,
                                                            intervention.id
                                                        )
                                                    }
                                                    style={{
                                                        border: `1px solid ${selected
                                                                ? token.colorPrimary
                                                                : token.colorBorderSecondary
                                                            }`,
                                                        background: selected
                                                            ? token.colorPrimaryBg
                                                            : token.colorBgContainer,
                                                        color: token.colorText,
                                                        borderRadius: 12,
                                                        padding: '12px 13px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: 12,
                                                        cursor: 'pointer',
                                                        textAlign: 'left'
                                                    }}
                                                >
                                                    <span>{intervention.title}</span>
                                                    <span
                                                        style={{
                                                            width: 25,
                                                            height: 25,
                                                            borderRadius: 8,
                                                            border: `1px solid ${selected
                                                                    ? token.colorPrimary
                                                                    : token.colorBorder
                                                                }`,
                                                            background: selected
                                                                ? token.colorPrimary
                                                                : 'transparent',
                                                            color: selected
                                                                ? token.colorTextLightSolid
                                                                : token.colorTextSecondary,
                                                            display: 'grid',
                                                            placeItems: 'center',
                                                            flex: '0 0 auto'
                                                        }}
                                                    >
                                                        {selected && <CheckOutlined />}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 22
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => void goTo('supportAreas', 'backward')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Back to areas
                                        </Button>
                                        <Button
                                            type='primary'
                                            size='middle'
                                            icon={<CheckOutlined />}
                                            onClick={() => void goTo('supportAreas')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Done
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'documentsIntro' && (
                                <Card
                                    variant='borderless'
                                    styles={{
                                        body: {
                                            padding: 'clamp(28px, 5vw, 48px)',
                                            textAlign: 'center'
                                        }
                                    }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 68,
                                            height: 68,
                                            margin: '0 auto 20px',
                                            borderRadius: 22,
                                            display: 'grid',
                                            placeItems: 'center',
                                            background: token.colorPrimaryBg,
                                            color: token.colorPrimary,
                                            fontSize: 26
                                        }}
                                        aria-hidden='true'
                                    >
                                        <FileTextOutlined />
                                    </div>

                                    <Text
                                        style={{
                                            display: 'block',
                                            marginBottom: 8,
                                            color: token.colorPrimary,
                                            fontWeight: 700
                                        }}
                                    >
                                        Thuso
                                    </Text>

                                    <Title level={2} style={{ marginBottom: 10 }}>
                                        You&apos;re almost done.{' '}
                                        <TypewriterPhrase
                                            reducedMotion={Boolean(reduceMotion)}
                                            text='I just need a few documents to complete your application.'
                                            speed={42}
                                            delay={260}
                                        />
                                    </Title>

                                    <Paragraph
                                        type='secondary'
                                        style={{
                                            maxWidth: 560,
                                            margin: '0 auto 24px',
                                            fontSize: 15,
                                            lineHeight: 1.7
                                        }}
                                    >
                                        Open each item, upload the document, and I&apos;ll keep track of
                                        what is still missing. Document files are not saved in drafts,
                                        so they must be uploaded again if you leave and return.
                                    </Paragraph>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            maxWidth: 520,
                                            margin: '0 auto'
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => void goTo('supportAreas', 'backward')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            type='primary'
                                            size='middle'
                                            icon={<ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() => void goTo('documents')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            {documentFields.length > 0 ? 'View documents' : 'Continue'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'documents' && (
                                <Card
                                    styles={{ body: { padding: 'clamp(20px, 3.5vw, 32px)' } }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            justifyContent: 'space-between',
                                            gap: 16,
                                            marginBottom: 18,
                                            flexWrap: 'wrap'
                                        }}
                                    >
                                        <div>
                                            <Title level={2} style={{ marginBottom: 6 }}>
                                                Your document checklist
                                            </Title>
                                            <Text type='secondary'>
                                                {documentFields.length > 0
                                                    ? `${readyDocuments.length} of ${documentFields.length} ready`
                                                    : 'This programme does not require documents at application.'}
                                            </Text>
                                        </div>

                                        {documentFields.length > 0 && (
                                            <Tag
                                                color={allDocumentsReady ? 'success' : 'processing'}
                                                style={{ marginInlineEnd: 0 }}
                                            >
                                                {documentsProgress}% complete
                                            </Tag>
                                        )}
                                    </div>

                                    {documentFields.length === 0 ? (
                                        <div
                                            style={{
                                                padding: 28,
                                                textAlign: 'center',
                                                border: `1px dashed ${token.colorBorder}`,
                                                borderRadius: 14,
                                                color: token.colorTextSecondary
                                            }}
                                        >
                                            Nothing to upload here. You can continue to review your application.
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                maxHeight: 'clamp(330px, 58dvh, 520px)',
                                                overflowY: 'auto',
                                                paddingRight: 4
                                            }}
                                        >
                                            {pendingDocuments.length > 0 && (
                                                <div>
                                                    <Text
                                                        strong
                                                        style={{ display: 'block', marginBottom: 9, fontSize: 13 }}
                                                    >
                                                        Still needed · {pendingDocuments.length}
                                                    </Text>
                                                    <div style={{ display: 'grid', gap: 9 }}>
                                                        {pendingDocuments.map(renderDocumentCard)}
                                                    </div>
                                                </div>
                                            )}

                                            {readyDocuments.length > 0 && (
                                                <div style={{ marginTop: pendingDocuments.length > 0 ? 18 : 0 }}>
                                                    <Text
                                                        strong
                                                        style={{ display: 'block', marginBottom: 9, fontSize: 13 }}
                                                    >
                                                        Ready · {readyDocuments.length}
                                                    </Text>
                                                    <div style={{ display: 'grid', gap: 9 }}>
                                                        {readyDocuments.map(renderDocumentCard)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10,
                                            marginTop: 22
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() =>
                                                reviewEditSection === 'documents'
                                                    ? void finishReviewEdit()
                                                    : void goTo('documentsIntro', 'backward')
                                            }
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            {reviewEditSection === 'documents' ? 'Back to review' : 'Back'}
                                        </Button>
                                        <Button
                                            type='primary'
                                            size='middle'
                                            disabled={!allDocumentsReady}
                                            icon={reviewEditSection === 'documents' ? <CheckOutlined /> : <ArrowRightOutlined />}
                                            iconPosition='end'
                                            onClick={() =>
                                                reviewEditSection === 'documents'
                                                    ? void finishReviewEdit()
                                                    : void goTo('review')
                                            }
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            {reviewEditSection === 'documents' ? 'Done' : 'Review application'}
                                        </Button>
                                    </div>
                                </Card>
                            )}

                            {screen === 'review' && (
                                <Card
                                    styles={{ body: { padding: 'clamp(18px, 2.5vw, 28px)' } }}
                                    style={{
                                        borderRadius: 24,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <div style={{ textAlign: 'center', marginBottom: 16 }}>
                                        <div
                                            style={{
                                                width: 54,
                                                height: 54,
                                                margin: '0 auto 11px',
                                                borderRadius: 18,
                                                display: 'grid',
                                                placeItems: 'center',
                                                background: token.colorSuccessBg,
                                                color: token.colorSuccess,
                                                fontSize: 22
                                            }}
                                            aria-hidden='true'
                                        >
                                            <CheckCircleFilled />
                                        </div>
                                        <Text
                                            style={{
                                                display: 'block',
                                                marginBottom: 5,
                                                color: token.colorPrimary,
                                                fontWeight: 700
                                            }}
                                        >
                                            Thuso
                                        </Text>
                                        <Title level={2} style={{ margin: '0 auto 6px' }}>
                                            <TypewriterPhrase
                                                reducedMotion={Boolean(reduceMotion)}
                                                text='Everything is ready for you to review.'
                                                speed={42}
                                                delay={260}
                                            />
                                        </Title>
                                        <Text type='secondary'>
                                            Check your answers before the final submission step.
                                        </Text>
                                    </div>

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: screens.lg
                                                ? 'repeat(2, minmax(0, 1fr))'
                                                : 'minmax(0, 1fr)',
                                            gap: 12,
                                            maxHeight: 'clamp(410px, 64dvh, 620px)',
                                            overflowY: 'auto',
                                            paddingRight: 4,
                                            alignItems: 'start'
                                        }}
                                    >
                                        <Card
                                            size='small'
                                            title='Motivation'
                                            extra={
                                                <Button
                                                    type='link'
                                                    size='small'
                                                    icon={<EditOutlined />}
                                                    onClick={() => void startReviewEdit('motivation', 'motivation')}
                                                >
                                                    Edit
                                                </Button>
                                            }
                                            style={{ borderRadius: 14, height: '100%' }}
                                        >
                                            <Paragraph
                                                style={{
                                                    marginBottom: 0,
                                                    whiteSpace: 'pre-wrap',
                                                    lineHeight: 1.6,
                                                    maxHeight: 150,
                                                    overflowY: 'auto',
                                                    paddingRight: 4
                                                }}
                                            >
                                                {motivation || 'Not provided'}
                                            </Paragraph>
                                        </Card>

                                        <Card
                                            size='small'
                                            title={`Challenges · ${challenges.length}`}
                                            extra={
                                                <Button
                                                    type='link'
                                                    size='small'
                                                    icon={<EditOutlined />}
                                                    onClick={() => void startReviewEdit('challenges', 'challenges')}
                                                >
                                                    Edit
                                                </Button>
                                            }
                                            style={{ borderRadius: 14, height: '100%' }}
                                        >
                                            {challenges.length > 0 ? (
                                                <Space wrap size={[6, 6]}>
                                                    {challenges.map(challenge => (
                                                        <Tag key={challenge}>{challenge}</Tag>
                                                    ))}
                                                </Space>
                                            ) : (
                                                <Text type='secondary'>No challenges added.</Text>
                                            )}
                                        </Card>

                                        {programQuestions.length > 0 && (
                                            <Card
                                                size='small'
                                                title='Programme questions'
                                                extra={
                                                    <Button
                                                        type='link'
                                                        size='small'
                                                        icon={<EditOutlined />}
                                                        onClick={() => void startReviewEdit('profile', 'profileQuestion')}
                                                    >
                                                        Edit
                                                    </Button>
                                                }
                                                style={{
                                                    borderRadius: 14,
                                                    gridColumn: screens.lg ? '1 / -1' : undefined
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: screens.xl
                                                            ? 'repeat(3, minmax(0, 1fr))'
                                                            : screens.md
                                                                ? 'repeat(2, minmax(0, 1fr))'
                                                                : 'minmax(0, 1fr)',
                                                        gap: '10px 18px'
                                                    }}
                                                >
                                                    {programQuestions.map(question => (
                                                        <div key={question.id} style={{ minWidth: 0 }}>
                                                            <Text
                                                                type='secondary'
                                                                style={{
                                                                    display: 'block',
                                                                    fontSize: 12,
                                                                    marginBottom: 2
                                                                }}
                                                            >
                                                                {question.label}
                                                            </Text>
                                                            <Text style={{ overflowWrap: 'anywhere' }}>
                                                                {profileAnswers[question.id] || 'Not provided'}
                                                            </Text>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        )}

                                        <Card
                                            size='small'
                                            title={`Support needs · ${selectedInterventionCount}`}
                                            extra={
                                                <Button
                                                    type='link'
                                                    size='small'
                                                    icon={<EditOutlined />}
                                                    onClick={() => void startReviewEdit('support', 'supportAreas')}
                                                >
                                                    Edit
                                                </Button>
                                            }
                                            style={{ borderRadius: 14, height: '100%' }}
                                        >
                                            {selectedSupportByArea.length > 0 ? (
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: screens.xl
                                                            ? 'repeat(2, minmax(0, 1fr))'
                                                            : 'minmax(0, 1fr)',
                                                        gap: 10
                                                    }}
                                                >
                                                    {selectedSupportByArea.map(group => (
                                                        <div key={group.area} style={{ minWidth: 0 }}>
                                                            <Text
                                                                strong
                                                                style={{ display: 'block', marginBottom: 5 }}
                                                            >
                                                                {group.area}
                                                            </Text>
                                                            <Space wrap size={[5, 5]}>
                                                                {group.interventions.map(intervention => (
                                                                    <Tag key={intervention.id}>
                                                                        {intervention.title}
                                                                    </Tag>
                                                                ))}
                                                            </Space>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <Text type='secondary'>No optional support selected.</Text>
                                            )}
                                        </Card>

                                        <Card
                                            size='small'
                                            title={`Documents · ${readyDocuments.length}/${documentFields.length}`}
                                            extra={
                                                <Button
                                                    type='link'
                                                    size='small'
                                                    icon={<EditOutlined />}
                                                    onClick={() => void startReviewEdit('documents', 'documents')}
                                                >
                                                    Edit
                                                </Button>
                                            }
                                            style={{ borderRadius: 14, height: '100%' }}
                                        >
                                            {documentFields.length > 0 ? (
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: screens.xl
                                                            ? 'repeat(2, minmax(0, 1fr))'
                                                            : 'minmax(0, 1fr)',
                                                        gap: 7
                                                    }}
                                                >
                                                    {documentFields.map(document => (
                                                        <div
                                                            key={document.key}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                gap: 8,
                                                                minWidth: 0
                                                            }}
                                                        >
                                                            <Text
                                                                ellipsis={{ tooltip: document.title }}
                                                                style={{ minWidth: 0 }}
                                                            >
                                                                {document.title}
                                                            </Text>
                                                            <Tag
                                                                color={document.completed ? 'success' : 'error'}
                                                                style={{ marginInlineEnd: 0, flex: '0 0 auto' }}
                                                            >
                                                                {document.completed ? 'Ready' : 'Missing'}
                                                            </Tag>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <Text type='secondary'>
                                                    No application documents required.
                                                </Text>
                                            )}
                                        </Card>
                                    </div>

                                    <Divider style={{ margin: '16px 0' }} />

                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                            gap: 10
                                        }}
                                    >
                                        <Button
                                            size='middle'
                                            icon={<ArrowLeftOutlined />}
                                            disabled={submitting}
                                            onClick={() => void goTo('documents', 'backward')}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            type='primary'
                                            size='middle'
                                            loading={submitting}
                                            icon={submitting ? undefined : <CheckOutlined />}
                                            onClick={() => void submitApplication()}
                                            style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                        >
                                            Submit application
                                        </Button>
                                    </div>
                                </Card>
                            )}

                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}

export default ParticipantRegistrationConversational
