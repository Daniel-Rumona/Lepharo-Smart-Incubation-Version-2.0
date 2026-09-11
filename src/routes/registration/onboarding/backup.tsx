import React, { useEffect, useState } from 'react'
import {
    Form,
    Input,
    Select,
    Upload,
    Button,
    DatePicker,
    Space,
    Typography,
    message,
    Card,
    Steps,
    Row,
    Col,
    Checkbox,
    Collapse,
    Divider,
    Progress,
    Grid,
    Alert,
    Badge,
    Descriptions,
    Tag
} from 'antd'
import SHA256 from 'crypto-js/sha256'
import {
    LeftOutlined,
    RightOutlined,
    FileOutlined,
    PicCenterOutlined,
    UploadOutlined,
    CheckCircleTwoTone,
    ExclamationCircleTwoTone,
    WarningTwoTone
} from '@ant-design/icons'
import {
    useNavigate,
    useSearchParams
} from 'react-router-dom'
import {
    onAuthStateChanged
} from 'firebase/auth'
import {
    collection,
    getDoc,
    doc,
    getDocs,
    query,
    where,
    updateDoc,
    addDoc,
    setDoc,
    deleteDoc,
    Timestamp,
    serverTimestamp
} from 'firebase/firestore'
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import moment from 'moment'
import dayjs, { type Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'

import {
    auth,
    db,
    storage,
    functions
} from '@/firebase'
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { LoadingBlob } from './LoadingBlob'
import { toDateStr } from '@/lib/utils'

const { Title } = Typography

type Group =
    | 'A'
    | 'B'
    | 'C'
    | 'Graduated'

type GroupHistoryEntry = {
    from: Group | null
    to: Group
    date: string
    by: string
    reason: string
    docs: string[]
    requirementsMet: string[]
}

type InterventionRow = {
    id: string
    title: string
    area: string
    internal?: boolean
    compulsory?: boolean
}

type DocField = {
    key: string
    title: string
    requiresExpiry: boolean
    expiryMonths?: number | null
    file: File | null
    issueDate: Dayjs | null
    expiryDate: Dayjs | null
}

type UploadedDoc = {
    key: string
    type: string
    url: string | null
    fileName: string | null
    issueDate: string | null
    expiryDate: string | null
    status: 'valid' | 'missing'
}

const MAX_FILE_MB = 10

const ACCEPTED_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
]

const fmtBytes = (bytes: number) =>
    bytes < 1024
        ? `${bytes} B`
        : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const norm = (value?: string) =>
    String(value || '')
        .trim()
        .toLowerCase()

const slug = (value: string) =>
    String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 60)

const resolveActor = () =>
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    'System'

const initialAEntry = (): GroupHistoryEntry => ({
    from: null,
    to: 'A',
    date: dayjs().toISOString(),
    by: resolveActor(),
    reason: 'Initial onboarding placement',
    docs: [],
    requirementsMet: []
})

/**
 * Firestore does not accept undefined by default.
 *
 * Important:
 * - removes undefined object properties
 * - removes undefined array entries
 * - preserves Timestamp / Date
 * - converts Dayjs to an ISO string
 */
const removeUndefinedDeep = (
    value: any
): any => {
    if (value === undefined) {
        return undefined
    }

    if (Array.isArray(value)) {
        return value
            .map(item =>
                removeUndefinedDeep(item)
            )
            .filter(
                item =>
                    item !== undefined
            )
    }

    if (
        value !== null &&
        typeof value === 'object'
    ) {
        if (
            value instanceof Timestamp ||
            value instanceof Date
        ) {
            return value
        }

        if (dayjs.isDayjs(value)) {
            return value.toISOString()
        }

        return Object.fromEntries(
            Object.entries(value)
                .filter(
                    ([, child]) =>
                        child !== undefined
                )
                .map(([key, child]) => [
                    key,
                    removeUndefinedDeep(child)
                ])
                .filter(
                    ([, child]) =>
                        child !== undefined
                )
        )
    }

    return value
}

const upsertComplianceSubdocs = async (
    appRef: import('firebase/firestore').DocumentReference,
    uploadedDocs: UploadedDoc[],
    ctx: {
        programId?: string | null
        programName?: string | null
        uploadedByEmail?: string | null
    }
) => {
    const {
        programId,
        programName,
        uploadedByEmail
    } = ctx

    await Promise.all(
        uploadedDocs.map(async uploadedDoc => {
            const subId =
                norm(
                    uploadedDoc.key ||
                    uploadedDoc.type
                ) ||
                `doc_${Date.now()}`

            const complianceRef = doc(
                appRef,
                'complianceDocuments',
                subId
            )

            const status =
                uploadedDoc.url
                    ? 'pending'
                    : 'missing'

            await setDoc(
                complianceRef,
                {
                    type:
                        uploadedDoc.type,

                    documentName:
                        uploadedDoc.type,

                    presetId:
                        norm(
                            uploadedDoc.key ||
                            uploadedDoc.type
                        ),

                    status,

                    url:
                        uploadedDoc.url || null,

                    issueDate:
                        uploadedDoc.issueDate || null,

                    expiryDate:
                        uploadedDoc.expiryDate || null,

                    uploadedAt:
                        serverTimestamp(),

                    uploadedBy:
                        uploadedByEmail || null,

                    programId:
                        programId || null,

                    programName:
                        programName || null,

                    kind: 'upload',

                    slug:
                        norm(
                            uploadedDoc.key ||
                            uploadedDoc.type
                        ),

                    createdBy:
                        uploadedByEmail || null,

                    updatedAt:
                        serverTimestamp()
                },
                {
                    merge: true
                }
            )
        })
    )
}

const ParticipantRegistrationStepForm = () => {
    const [form] = Form.useForm()

    const navigate =
        useNavigate()

    const [searchParams] =
        useSearchParams()

    const programId =
        searchParams.get('id')

    const programName =
        searchParams.get('program')

    const [
        initialisingApplication,
        setInitialisingApplication
    ] = useState(true)

    const [
        programConfigLoaded,
        setProgramConfigLoaded
    ] = useState(false)

    const [
        draftLookupComplete,
        setDraftLookupComplete
    ] = useState(false)

    const [
        draftWasRestored,
        setDraftWasRestored
    ] = useState(false)

    const draftMessageShownRef =
        React.useRef(false)

    const submittingRef =
        React.useRef(false)

    const [
        current,
        setCurrent
    ] = useState(0)

    const [
        uploading,
        setUploading
    ] = useState(false)

    const [
        suspendEffects,
        setSuspendEffects
    ] = useState(false)

    const [
        openPanels,
        setOpenPanels
    ] = useState<string[]>([])

    const [
        interventionGroups,
        setInterventionGroups
    ] = useState<any[]>([])

    const [
        interventionSelections,
        setInterventionSelections
    ] = useState<
        Record<string, string[]>
    >({})

    const [
        participantData,
        setParticipantData
    ] = useState<any>({})

    const [
        participantId,
        setParticipantId
    ] = useState<string | null>(
        null
    )

    const [
        complianceScore,
        setComplianceScore
    ] = useState(0)

    const [
        programQuestions,
        setProgramQuestions
    ] = useState<any[]>([])

    const [
        allProgramRequirements,
        setAllProgramRequirements
    ] = useState<any[]>([])

    const [
        documentFields,
        setDocumentFields
    ] = useState<DocField[]>([])

    const [
        draftDocs,
        setDraftDocs
    ] = useState<any[] | null>(
        null
    )

    const [
        requiredKeys,
        setRequiredKeys
    ] = useState<string[]>([])

    const [
        progressModalVisible,
        setProgressModalVisible
    ] = useState(false)

    const [
        submissionStep,
        setSubmissionStep
    ] = useState(0)

    const hasProgramProfile =
        programQuestions.length > 0

    /*
     * Final order:
     *
     * 0 Motivation
     * 1 Program Profile, if configured
     * 1/2 Interventions
     * 2/3 Documents
     * 3/4 Review
     */
    const INTERVENTIONS_STEP_INDEX =
        hasProgramProfile ? 2 : 1

    const DOCUMENTS_STEP_INDEX =
        hasProgramProfile ? 3 : 2

    const FOOTER_H = 56

    /*
     * ---------------------------------------------------------
     * PROGRAM CONFIG
     * ---------------------------------------------------------
     *
     * Loads questions and requirements from ONE program read.
     */
    useEffect(() => {
        let mounted = true

        const loadProgramConfiguration =
            async () => {
                try {
                    if (!programId) {
                        if (mounted) {
                            setProgramQuestions([])
                            setAllProgramRequirements([])
                        }

                        return
                    }

                    const programSnap =
                        await getDoc(
                            doc(
                                db,
                                'programs',
                                programId
                            )
                        )

                    if (!mounted) return

                    if (!programSnap.exists()) {
                        setProgramQuestions([])
                        setAllProgramRequirements([])
                        return
                    }

                    const data =
                        programSnap.data()

                    setProgramQuestions(
                        Array.isArray(
                            data.onboardingQuestions
                        )
                            ? data.onboardingQuestions
                            : []
                    )

                    setAllProgramRequirements(
                        Array.isArray(
                            data.programRequirements
                        )
                            ? data.programRequirements
                            : []
                    )
                } catch (error) {
                    console.error(
                        '[Application] Failed to load program configuration:',
                        error
                    )

                    if (mounted) {
                        setProgramQuestions([])
                        setAllProgramRequirements([])
                    }
                } finally {
                    if (mounted) {
                        setProgramConfigLoaded(
                            true
                        )
                    }
                }
            }

        void loadProgramConfiguration()

        return () => {
            mounted = false
        }
    }, [programId])

    /*
     * ---------------------------------------------------------
     * REQUIRED DOCUMENTS
     * ---------------------------------------------------------
     *
     * Builds the compliance UI from program requirements.
     *
     * Drafts only restore metadata such as issue / expiry date.
     * The actual File is deliberately never restored.
     */
    useEffect(() => {
        const applicationRequirements =
            allProgramRequirements.filter(
                (requirement: any) =>
                    requirement
                        ?.requiredAtApplication ===
                    true
            )

        const draftMap =
            new Map<string, any>()

        for (
            const savedDocument of
            draftDocs || []
        ) {
            const savedKey =
                savedDocument?.key ||
                norm(
                    savedDocument?.title
                )

            if (savedKey) {
                draftMap.set(
                    savedKey,
                    savedDocument
                )
            }
        }

        const mapped: DocField[] =
            applicationRequirements.map(
                (requirement: any) => {
                    const stableKey =
                        requirement.key ||
                        requirement.preset ||
                        requirement.id ||
                        `title:${slug(
                            requirement.title ||
                            'document'
                        )}`

                    const saved =
                        draftMap.get(
                            stableKey
                        ) ||
                        draftMap.get(
                            norm(
                                requirement.title
                            )
                        )

                    return {
                        key:
                            stableKey,

                        title:
                            requirement.title ||
                            requirement.preset ||
                            requirement.key ||
                            'Document',

                        requiresExpiry:
                            Boolean(
                                requirement.hasExpiry
                            ),

                        expiryMonths:
                            requirement.expiryMonths ??
                            null,

                        file:
                            null,

                        issueDate:
                            saved?.issueDate
                                ? dayjs(
                                    saved.issueDate
                                )
                                : null,

                        expiryDate:
                            saved?.expiryDate
                                ? dayjs(
                                    saved.expiryDate
                                )
                                : null
                    }
                }
            )

        setDocumentFields(
            previous =>
                mapped.map(
                    document => {
                        const existing =
                            previous.find(
                                item =>
                                    item.key ===
                                    document.key
                            )

                        /*
                         * Keep a file if this effect somehow
                         * re-runs after the user selects one.
                         */
                        return {
                            ...document,
                            file:
                                existing?.file ||
                                document.file,

                            issueDate:
                                document.issueDate ||
                                existing?.issueDate ||
                                null,

                            expiryDate:
                                document.expiryDate ||
                                existing?.expiryDate ||
                                null
                        }
                    }
                )
        )

        setRequiredKeys(
            applicationRequirements
                .map(
                    (requirement: any) =>
                        requirement.key ||
                        requirement.preset ||
                        requirement.id ||
                        (
                            requirement.title
                                ? `title:${slug(
                                    requirement.title
                                )}`
                                : null
                        )
                )
                .filter(
                    (
                        key
                    ): key is string =>
                        typeof key ===
                        'string' &&
                        key.trim().length >
                        0
                )
        )
    }, [
        allProgramRequirements,
        draftDocs
    ])

    /*
     * ---------------------------------------------------------
     * PARTICIPANT + DRAFT
     * ---------------------------------------------------------
     */
    useEffect(() => {
        let mounted = true
        let handled = false

        const unsubscribe =
            onAuthStateChanged(
                auth,
                async user => {
                    if (
                        handled ||
                        !mounted
                    ) {
                        return
                    }

                    handled = true

                    try {
                        if (!user) {
                            message.error(
                                'Not authenticated. Please log in again.'
                            )
                            return
                        }

                        const participantQuery =
                            query(
                                collection(
                                    db,
                                    'participants'
                                ),
                                where(
                                    'email',
                                    '==',
                                    user.email
                                )
                            )

                        const participantSnap =
                            await getDocs(
                                participantQuery
                            )

                        if (!mounted) return

                        if (
                            participantSnap.empty
                        ) {
                            console.warn(
                                '[Application] No participant profile found for:',
                                user.email
                            )
                            return
                        }

                        const participantDoc =
                            participantSnap.docs[0]

                        const data =
                            participantDoc.data()

                        const id =
                            participantDoc.id

                        setParticipantData(
                            data
                        )

                        setParticipantId(
                            id
                        )

                        const dateOfRegistration =
                            data.dateOfRegistration
                                ? coerceDateForForm(
                                    data.dateOfRegistration
                                )
                                : undefined

                        form.setFieldsValue({
                            ...data,

                            participantName:
                                data.ownerName ||
                                data.participantName ||
                                data.name ||
                                '',

                            email:
                                data.email ||
                                user.email ||
                                '',

                            ...(dateOfRegistration
                                ? {
                                    dateOfRegistration
                                }
                                : {})
                        })

                        if (data.idNumber) {
                            const age =
                                getAgeFromID(
                                    data.idNumber
                                )

                            const stage =
                                deriveStageFromRevenue(
                                    data
                                )

                            form.setFieldsValue({
                                age,
                                stage
                            })
                        }

                        const draftSnap =
                            await getDoc(
                                doc(
                                    db,
                                    'applicationDrafts',
                                    id
                                )
                            )

                        if (!mounted) return

                        if (
                            !draftSnap.exists()
                        ) {
                            return
                        }

                        const draft =
                            draftSnap.data()

                        if (
                            draft.formValues &&
                            typeof draft.formValues ===
                            'object'
                        ) {
                            const restoredValues = {
                                ...draft.formValues
                            }

                            if (
                                restoredValues.dateOfRegistration
                            ) {
                                restoredValues.dateOfRegistration =
                                    coerceDateForForm(
                                        restoredValues.dateOfRegistration
                                    )
                            }

                            form.setFieldsValue(
                                restoredValues
                            )
                        }

                        if (
                            Array.isArray(
                                draft.documentFields
                            )
                        ) {
                            setDraftDocs(
                                draft.documentFields
                            )
                        }

                        if (
                            draft.interventionSelections &&
                            typeof draft.interventionSelections ===
                            'object'
                        ) {
                            setInterventionSelections(
                                draft.interventionSelections
                            )
                        }

                        /*
                         * We deliberately DO NOT restore the
                         * old currentStep.
                         *
                         * Files cannot be restored from a draft,
                         * so any restored application resumes on
                         * Documents / Compliance.
                         */
                        setDraftWasRestored(
                            true
                        )
                    } catch (error) {
                        console.error(
                            '[Application] Failed to retrieve participant/draft:',
                            error
                        )
                    } finally {
                        if (mounted) {
                            setDraftLookupComplete(
                                true
                            )
                        }
                    }
                }
            )

        return () => {
            mounted = false
            unsubscribe()
        }
    }, [form])

    /*
     * ---------------------------------------------------------
     * FINISH INITIALISATION
     * ---------------------------------------------------------
     *
     * We wait for BOTH:
     * - program configuration
     * - participant/draft lookup
     *
     * The form is not shown before this finishes.
     */
    useEffect(() => {
        if (
            !programConfigLoaded ||
            !draftLookupComplete
        ) {
            return
        }

        if (draftWasRestored) {
            setCurrent(
                DOCUMENTS_STEP_INDEX
            )

            if (
                !draftMessageShownRef.current
            ) {
                draftMessageShownRef.current =
                    true

                message.open({
                    key:
                        'application-draft-restored',

                    type: 'info',

                    content:
                        'Your saved draft has been restored. Please re-upload your compliance documents before continuing.'
                })
            }
        } else {
            setCurrent(0)
        }

        setInitialisingApplication(
            false
        )
    }, [
        programConfigLoaded,
        draftLookupComplete,
        draftWasRestored,
        DOCUMENTS_STEP_INDEX
    ])

    /*
     * ---------------------------------------------------------
     * INTERVENTIONS
     * ---------------------------------------------------------
     */
    useEffect(() => {
        let mounted = true

        const fetchInterventions =
            async () => {
                try {
                    const snap =
                        await getDocs(
                            query(
                                collection(
                                    db,
                                    'interventions'
                                )
                            )
                        )

                    if (!mounted) return

                    const rows: InterventionRow[] =
                        snap.docs.map(
                            interventionDoc => {
                                const data =
                                    interventionDoc.data()

                                return {
                                    id:
                                        interventionDoc.id,

                                    title:
                                        data.interventionTitle,

                                    area:
                                        data.areaOfSupport ||
                                        'General',

                                    internal:
                                        Boolean(
                                            data.internal
                                        ),

                                    compulsory:
                                        Boolean(
                                            data.compulsory
                                        )
                                }
                            }
                        )

                    const selectable =
                        rows.filter(
                            intervention =>
                                intervention.internal !==
                                true &&
                                intervention.compulsory !==
                                true
                        )

                    const areaMap: Record<
                        string,
                        Array<{
                            id: string
                            title: string
                        }>
                    > = {}

                    selectable.forEach(
                        intervention => {
                            if (
                                !intervention.title
                            ) {
                                return
                            }

                            if (
                                !areaMap[
                                intervention.area
                                ]
                            ) {
                                areaMap[
                                    intervention.area
                                ] = []
                            }

                            areaMap[
                                intervention.area
                            ].push({
                                id:
                                    intervention.id,
                                title:
                                    intervention.title
                            })
                        }
                    )

                    const grouped =
                        Object.entries(
                            areaMap
                        ).map(
                            ([
                                area,
                                interventions
                            ]) => ({
                                area,
                                interventions
                            })
                        )

                    setInterventionGroups(
                        grouped
                    )
                } catch (error) {
                    console.error(
                        '[Application] Failed to load interventions:',
                        error
                    )

                    if (mounted) {
                        setInterventionGroups(
                            []
                        )
                    }
                }
            }

        void fetchInterventions()

        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        if (
            !interventionGroups.length
        ) {
            return
        }

        const validKeys =
            new Set(
                interventionGroups.map(
                    group =>
                        group.area
                )
            )

        setOpenPanels(
            previous =>
                previous.filter(
                    key =>
                        validKeys.has(
                            key
                        )
                )
        )
    }, [interventionGroups])

    /*
     * ---------------------------------------------------------
     * COMPLIANCE SCORE
     * ---------------------------------------------------------
     */
    useEffect(() => {
        const uploadedLikeDocs =
            documentFields.map(
                document => ({
                    ...document,

                    status:
                        document.file
                            ? 'valid'
                            : 'missing',

                    expiryDate:
                        document.expiryDate?.format(
                            'YYYY-MM-DD'
                        ) || null
                })
            )

        setComplianceScore(
            calculateCompliance(
                uploadedLikeDocs
            )
        )
    }, [
        documentFields,
        requiredKeys
    ])

    /*
     * ---------------------------------------------------------
     * AUTOSAVE
     * ---------------------------------------------------------
     *
     * Only one autosave interval exists.
     */
    useEffect(() => {
        if (
            initialisingApplication ||
            suspendEffects ||
            !participantId
        ) {
            return
        }

        const interval =
            window.setInterval(
                () => {
                    void saveDraft()
                },
                60_000
            )

        return () => {
            window.clearInterval(
                interval
            )
        }
    }, [
        form,
        documentFields,
        interventionSelections,
        current,
        suspendEffects,
        initialisingApplication,
        participantId
    ])

    const getAgeGroup = (
        age: number
    ):
        | 'Youth'
        | 'Adult'
        | 'Senior' => {
        if (age <= 35) {
            return 'Youth'
        }

        if (age <= 59) {
            return 'Adult'
        }

        return 'Senior'
    }

    const getAgeFromID = (
        id?: string
    ): number | null => {
        const value =
            String(id || '').trim()

        if (
            !/^\d{6}/.test(
                value
            )
        ) {
            return null
        }

        const birthYear =
            parseInt(
                value.substring(
                    0,
                    2
                ),
                10
            )

        const birthMonth =
            parseInt(
                value.substring(
                    2,
                    4
                ),
                10
            ) - 1

        const birthDay =
            parseInt(
                value.substring(
                    4,
                    6
                ),
                10
            )

        const currentYear =
            new Date().getFullYear()

        const century =
            birthYear <=
                currentYear % 100
                ? 2000
                : 1900

        const birthDate =
            new Date(
                century +
                birthYear,
                birthMonth,
                birthDay
            )

        if (
            Number.isNaN(
                birthDate.getTime()
            )
        ) {
            return null
        }

        const today =
            new Date()

        let age =
            today.getFullYear() -
            birthDate.getFullYear()

        const monthDifference =
            today.getMonth() -
            birthDate.getMonth()

        if (
            monthDifference < 0 ||
            (
                monthDifference === 0 &&
                today.getDate() <
                birthDate.getDate()
            )
        ) {
            age--
        }

        return age
    }

    const getYearFields = () => {
        const currentYear =
            moment().year()

        return [
            currentYear - 1,
            currentYear - 2
        ]
    }

    const deriveStageFromRevenue = (
        values: any
    ): string => {
        const years =
            getYearFields()

        const revenues =
            years.map(
                year =>
                    Number(
                        values[
                        `revenue${year}`
                        ] || 0
                    )
            )

        const avgRevenue =
            revenues.reduce(
                (
                    total,
                    revenue
                ) =>
                    total +
                    revenue,
                0
            ) /
            revenues.length

        if (
            avgRevenue <
            100000
        ) {
            return 'Ideation'
        }

        if (
            avgRevenue <
            500000
        ) {
            return 'Startup'
        }

        if (
            avgRevenue <
            1000000
        ) {
            return 'Early Stage'
        }

        if (
            avgRevenue <
            5000000
        ) {
            return 'Growth'
        }

        return 'Maturity'
    }

    const coerceDateForForm = (
        value: any
    ) => {
        if (!value) {
            return null
        }

        if (
            typeof value?.toDate ===
            'function'
        ) {
            return dayjs(
                value.toDate()
            )
        }

        if (
            typeof value?.seconds ===
            'number' &&
            typeof value?.nanoseconds ===
            'number'
        ) {
            return dayjs(
                new Timestamp(
                    value.seconds,
                    value.nanoseconds
                ).toDate()
            )
        }

        if (
            typeof value?.$y ===
            'number' &&
            typeof value?.$M ===
            'number' &&
            typeof value?.$D ===
            'number'
        ) {
            return dayjs(
                new Date(
                    value.$y,
                    value.$M,
                    value.$D
                )
            )
        }

        const parsed =
            dayjs(value)

        return parsed.isValid()
            ? parsed
            : null
    }

    const saveDraft =
        async () => {
            if (
                suspendEffects ||
                submittingRef.current
            ) {
                return
            }

            const user =
                auth.currentUser

            if (
                !user ||
                !participantId
            ) {
                return
            }

            const values =
                form.getFieldsValue(
                    true
                )

            const draft =
                removeUndefinedDeep({
                    participantId,

                    programId:
                        programId ||
                        null,

                    programName:
                        programName ||
                        null,

                    formValues:
                        values,

                    documentFields:
                        documentFields.map(
                            document => ({
                                key:
                                    document.key,

                                title:
                                    document.title,

                                issueDate:
                                    document.issueDate?.format(
                                        'YYYY-MM-DD'
                                    ) ||
                                    null,

                                expiryDate:
                                    document.expiryDate?.format(
                                        'YYYY-MM-DD'
                                    ) ||
                                    null,

                                fileName:
                                    document.file?.name ||
                                    null
                            })
                        ),

                    interventionSelections,

                    currentStep:
                        current,

                    savedAt:
                        new Date().toISOString()
                })

            try {
                await setDoc(
                    doc(
                        db,
                        'applicationDrafts',
                        participantId
                    ),
                    draft
                )

                console.log(
                    '[Application] Draft saved.'
                )
            } catch (error) {
                console.warn(
                    '[Application] Could not save draft:',
                    error
                )
            }
        }

    const sendApplicationEmail =
        async (
            email: string,
            name: string
        ) => {
            try {
                const sendEmail =
                    httpsCallable(
                        functions,
                        'sendApplicationReceivedEmail'
                    )

                await sendEmail({
                    email,
                    name
                })

                console.log(
                    '[Application] Application email sent successfully.'
                )
            } catch (error) {
                console.error(
                    '[Application] Failed to send application email:',
                    error
                )
            }
        }

    const evaluateWithAI =
        async (
            participant: any
        ) => {
            const controller =
                new AbortController()

            const timeout =
                window.setTimeout(
                    () =>
                        controller.abort(),
                    12_000
                )

            try {
                const {
                    participantName,
                    beneficiaryName,
                    sector,
                    city,
                    province,
                    yearsOfTrading,
                    motivation,
                    natureOfBusiness,
                    challenges,
                    stage,
                    ageGroup,
                    developmentType,
                    complianceDocuments = []
                } = participant

                const structuredInfo = {
                    name:
                        participantName,

                    business_name:
                        beneficiaryName,

                    sector,

                    location:
                        `${city || ''}, ${province || ''}`,

                    years_operating:
                        yearsOfTrading,

                    description:
                        motivation,

                    business_model:
                        natureOfBusiness,

                    challenges,

                    stage,

                    ageGroup,

                    developmentType,

                    complianceSummary:
                        complianceDocuments.map(
                            (
                                complianceDocument: any
                            ) => ({
                                type:
                                    complianceDocument.title ||
                                    complianceDocument.type,

                                status:
                                    complianceDocument.status,

                                expiryDate:
                                    complianceDocument.expiryDate ||
                                    'N/A',

                                hasUrl:
                                    Boolean(
                                        complianceDocument.url
                                    )
                            })
                        )
                }

                const response =
                    await fetch(
                        'https://rairo-incu-api.hf.space/api/lepharo_evaluate',
                        {
                            method:
                                'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            signal:
                                controller.signal,

                            body:
                                JSON.stringify(
                                    {
                                        participantId:
                                            `applicant-${Date.now()}`,

                                        participantInfo:
                                            structuredInfo
                                    }
                                )
                        }
                    )

                if (
                    !response.ok
                ) {
                    throw new Error(
                        'AI API call failed.'
                    )
                }

                const data =
                    await response.json()

                const evaluation =
                    data.raw_response ??
                    data.evaluation

                return (
                    evaluation ||
                    null
                )
            } catch {
                return null
            } finally {
                window.clearTimeout(
                    timeout
                )
            }
        }

    const disabledDateForDoc =
        (
            document: DocField
        ) =>
            (
                currentDate:
                    Dayjs
            ) => {
                if (
                    !currentDate
                ) {
                    return false
                }

                const today =
                    dayjs().startOf(
                        'day'
                    )

                if (
                    currentDate.isBefore(
                        today
                    )
                ) {
                    return true
                }

                if (
                    document.expiryMonths
                ) {
                    const max =
                        dayjs()
                            .add(
                                document.expiryMonths,
                                'month'
                            )
                            .endOf(
                                'day'
                            )

                    if (
                        currentDate.isAfter(
                            max
                        )
                    ) {
                        return true
                    }
                }

                return false
            }

    const handleDateChange = (
        date: Dayjs | null,
        key: string
    ) => {
        setDocumentFields(
            documents =>
                documents.map(
                    document =>
                        document.key ===
                            key
                            ? {
                                ...document,
                                expiryDate:
                                    date
                            }
                            : document
                )
        )
    }

    const getExpiredDocuments =
        () =>
            documentFields.filter(
                document =>
                    document.requiresExpiry &&
                    document.file &&
                    (
                        !document.expiryDate ||
                        document.expiryDate.isBefore(
                            dayjs().add(
                                7,
                                'day'
                            ),
                            'day'
                        )
                    )
            )

    const getMissingDocuments =
        () =>
            documentFields.filter(
                document =>
                    !document.file
            )

    const handleFileUpload = (
        file: File,
        key: string
    ) => {
        const tooBig =
            file.size >
            MAX_FILE_MB *
            1024 *
            1024

        const badType =
            !ACCEPTED_MIME.includes(
                file.type
            )

        if (tooBig) {
            message.error(
                `"${file.name}" is ${fmtBytes(file.size)} (max ${MAX_FILE_MB} MB).`
            )

            return Upload.LIST_IGNORE
        }

        if (badType) {
            message.error(
                'Unsupported file type. Please upload PDF, PNG, or JPG.'
            )

            return Upload.LIST_IGNORE
        }

        setDocumentFields(
            documents =>
                documents.map(
                    document =>
                        document.key ===
                            key
                            ? {
                                ...document,
                                file
                            }
                            : document
                )
        )

        return false
    }

    const clearFile = (
        key: string
    ) => {
        setDocumentFields(
            documents =>
                documents.map(
                    document =>
                        document.key ===
                            key
                            ? {
                                ...document,
                                file:
                                    null,
                                issueDate:
                                    null,
                                expiryDate:
                                    null
                            }
                            : document
                )
        )
    }

    const uploadFileAndGetURL =
        async (
            file: File,
            folder =
                'participant_documents'
        ) => {
            const fileName =
                `${Date.now()}_${file.name}`

            const fileRef =
                ref(
                    storage,
                    `${folder}/${fileName}`
                )

            await uploadBytes(
                fileRef,
                file
            )

            const url =
                await getDownloadURL(
                    fileRef
                )

            return {
                url,
                name:
                    fileName
            }
        }

    const uploadAllDocuments =
        async (): Promise<
            UploadedDoc[]
        > => {
            const uploadedDocs:
                UploadedDoc[] = []

            for (
                const documentField of
                documentFields
            ) {
                if (
                    !documentField.file
                ) {
                    uploadedDocs.push({
                        key:
                            documentField.key,

                        type:
                            documentField.title,

                        url:
                            null,

                        fileName:
                            null,

                        issueDate:
                            null,

                        expiryDate:
                            null,

                        status:
                            'missing'
                    })

                    continue
                }

                try {
                    const {
                        url,
                        name
                    } =
                        await uploadFileAndGetURL(
                            documentField.file
                        )

                    uploadedDocs.push({
                        key:
                            documentField.key,

                        type:
                            documentField.title,

                        url,

                        fileName:
                            name,

                        issueDate:
                            documentField.issueDate?.format(
                                'YYYY-MM-DD'
                            ) ||
                            null,

                        expiryDate:
                            documentField.requiresExpiry
                                ? documentField.expiryDate?.format(
                                    'YYYY-MM-DD'
                                ) ||
                                null
                                : null,

                        status:
                            'valid'
                    })
                } catch (error) {
                    console.error(
                        '[Application] Document upload failed:',
                        error
                    )

                    message.error(
                        `Failed to upload ${documentField.title}`
                    )

                    throw error
                }
            }

            return uploadedDocs
        }

    const calculateCompliance = (
        docs: any[] = []
    ) => {
        const applicationRequiredDocs =
            docs.filter(
                document =>
                    requiredKeys.includes(
                        document.key
                    )
            )

        const totalRequired =
            applicationRequiredDocs.length

        const oneWeekFromNow =
            new Date(
                Date.now() +
                7 *
                24 *
                60 *
                60 *
                1000
            )

        const validDocs =
            applicationRequiredDocs.filter(
                document => {
                    if (
                        document.status !==
                        'valid'
                    ) {
                        return false
                    }

                    if (
                        document.expiryDate &&
                        new Date(
                            document.expiryDate
                        ) <=
                        oneWeekFromNow
                    ) {
                        return false
                    }

                    return true
                }
            )

        return totalRequired ===
            0
            ? 0
            : Math.round(
                (
                    validDocs.length /
                    totalRequired
                ) * 100
            )
    }

    const renderQuestionField = (
        question: any
    ) => {
        let options: string[] =
            []

        if (
            Array.isArray(
                question.options
            )
        ) {
            options =
                question.options
        } else if (
            typeof question.options ===
            'string'
        ) {
            options =
                question.options
                    .split(',')
                    .map(
                        (
                            option: string
                        ) =>
                            option.trim()
                    )
                    .filter(Boolean)
        }

        switch (
        question.type
        ) {
            case 'text':
                return (
                    <Form.Item
                        key={
                            question.id
                        }
                        name={[
                            'profile',
                            question.id
                        ]}
                        label={
                            question.label
                        }
                        rules={[
                            {
                                required:
                                    true,

                                message:
                                    `Please provide ${question.label}`
                            }
                        ]}
                    >
                        <Input />
                    </Form.Item>
                )

            case 'dropdown':
                return (
                    <Form.Item
                        key={
                            question.id
                        }
                        name={[
                            'profile',
                            question.id
                        ]}
                        label={
                            question.label
                        }
                        rules={[
                            {
                                required:
                                    true,

                                message:
                                    `Please select ${question.label}`
                            }
                        ]}
                    >
                        <Select>
                            {options.map(
                                option => (
                                    <Select.Option
                                        key={
                                            option
                                        }
                                        value={
                                            option
                                        }
                                    >
                                        {
                                            option
                                        }
                                    </Select.Option>
                                )
                            )}
                        </Select>
                    </Form.Item>
                )

            default:
                return null
        }
    }

    const next =
        async () => {
            const values =
                form.getFieldsValue(
                    true
                )

            /*
             * Motivation
             */
            if (
                current === 0
            ) {
                const motivation =
                    String(
                        values.motivation ||
                        ''
                    ).trim()

                const wordCount =
                    motivation
                        .split(/\s+/)
                        .filter(
                            Boolean
                        ).length

                if (
                    !motivation ||
                    wordCount <
                    100
                ) {
                    message.error(
                        'Please provide a motivation of at least 100 words before continuing.'
                    )

                    return
                }
            }

            /*
             * Program Profile
             */
            if (
                hasProgramProfile &&
                current === 1
            ) {
                const profileAnswers =
                    values.profile ||
                    {}

                const unanswered =
                    programQuestions.filter(
                        question =>
                            !profileAnswers[
                            question.id
                            ] ||
                            String(
                                profileAnswers[
                                question.id
                                ]
                            ).trim() ===
                            ''
                    )

                if (
                    unanswered.length >
                    0
                ) {
                    message.error(
                        'Please answer all Program Profile questions before continuing.'
                    )

                    return
                }
            }

            /*
             * Documents / Compliance
             */
            if (
                current ===
                DOCUMENTS_STEP_INDEX
            ) {
                for (
                    const documentField of
                    documentFields
                ) {
                    if (
                        !documentField.file
                    ) {
                        message.error(
                            `Please upload the required document: ${documentField.title}`
                        )

                        return
                    }

                    if (
                        !documentField.issueDate
                    ) {
                        message.error(
                            `Please provide an issue date for ${documentField.title}.`
                        )

                        return
                    }

                    if (
                        documentField.requiresExpiry &&
                        !documentField.expiryDate
                    ) {
                        message.error(
                            `Please set an expiry date for ${documentField.title}.`
                        )

                        return
                    }

                    const today =
                        dayjs().startOf(
                            'day'
                        )

                    if (
                        documentField.expiryDate &&
                        documentField.expiryDate.isBefore(
                            today
                        )
                    ) {
                        message.error(
                            `${documentField.title}: expiry date cannot be in the past.`
                        )

                        return
                    }
                }
            }

            await saveDraft()

            setCurrent(
                step =>
                    step + 1
            )
        }

    const prev =
        async () => {
            await saveDraft()

            setCurrent(
                step =>
                    Math.max(
                        step - 1,
                        0
                    )
            )
        }

    const handleSubmit =
        async () => {
            submittingRef.current =
                true

            setSuspendEffects(
                true
            )

            setUploading(true)

            setProgressModalVisible(
                true
            )

            setSubmissionStep(
                5
            )

            try {
                await form.validateFields()

                setSubmissionStep(
                    15
                )

                const values =
                    form.getFieldsValue(
                        true
                    )

                const idForAge =
                    values.idNumber ||
                    participantData?.idNumber

                if (!idForAge) {
                    message.error(
                        'ID Number is required to submit. Please update your profile.'
                    )

                    setProgressModalVisible(
                        false
                    )

                    setCurrent(0)

                    return
                }

                /*
                 * Upload files once.
                 */
                const uploadedDocs =
                    await uploadAllDocuments()

                const complianceScoreCalc =
                    calculateCompliance(
                        uploadedDocs
                    )

                setComplianceScore(
                    complianceScoreCalc
                )

                if (
                    complianceScoreCalc <
                    10
                ) {
                    message.error(
                        'Compliance must be 10% or higher to approve this application.'
                    )

                    setProgressModalVisible(
                        false
                    )

                    return
                }

                /*
                 * Build stable requirement keys.
                 *
                 * This is important because:
                 *
                 * allProgramRequirements.map(r => r.key)
                 *
                 * previously allowed undefined values into
                 * complianceSummary.required.
                 */
                const complianceRequiredKeys =
                    allProgramRequirements
                        .map(
                            (
                                requirement: any
                            ) =>
                                requirement.key ||
                                requirement.preset ||
                                requirement.id ||
                                (
                                    requirement.title
                                        ? `title:${slug(
                                            requirement.title
                                        )}`
                                        : null
                                )
                        )
                        .filter(
                            (
                                key
                            ): key is string =>
                                typeof key ===
                                'string' &&
                                key.trim()
                                    .length >
                                0
                        )

                const completedKeys =
                    uploadedDocs
                        .filter(
                            uploadedDocument =>
                                Boolean(
                                    uploadedDocument.url
                                ) &&
                                uploadedDocument.status ===
                                'valid'
                        )
                        .map(
                            uploadedDocument =>
                                uploadedDocument.key
                        )

                const complianceSummary =
                {
                    required:
                        complianceRequiredKeys,

                    completed:
                        completedKeys
                }

                setSubmissionStep(
                    35
                )

                const derivedAge =
                    getAgeFromID(
                        idForAge
                    )

                if (
                    derivedAge ===
                    null
                ) {
                    message.error(
                        'Please provide a valid South African ID number.'
                    )

                    setProgressModalVisible(
                        false
                    )

                    setCurrent(0)

                    return
                }

                /*
                 * Resolve selected intervention details.
                 */
                const selectedRequired =
                    Object.values(
                        interventionSelections
                    )
                        .flat()
                        .map(
                            interventionId => {
                                const group =
                                    interventionGroups.find(
                                        (
                                            candidateGroup: any
                                        ) =>
                                            candidateGroup.interventions.some(
                                                (
                                                    intervention: any
                                                ) =>
                                                    intervention.id ===
                                                    interventionId
                                            )
                                    )

                                const match =
                                    group?.interventions.find(
                                        (
                                            intervention: any
                                        ) =>
                                            intervention.id ===
                                            interventionId
                                    )

                                return match
                                    ? {
                                        id:
                                            match.id,

                                        title:
                                            match.title,

                                        area:
                                            group?.area
                                    }
                                    : null
                            }
                        )
                        .filter(
                            Boolean
                        ) as Array<{
                            id: string
                            title: string
                            area?: string
                        }>

                const participant = {
                    ...values,

                    dateOfRegistration:
                        values.dateOfRegistration
                            ? dayjs(
                                values.dateOfRegistration.toDate?.() ||
                                values.dateOfRegistration
                            )
                            : null,

                    rating:
                        0,

                    ageGroup:
                        getAgeGroup(
                            derivedAge
                        ),

                    applicationStatus:
                        'pending',

                    complianceScore:
                        complianceScoreCalc,

                    complianceDocuments:
                        uploadedDocs,

                    complianceSummary,

                    interventions: {
                        required:
                            selectedRequired,

                        assigned:
                            [],

                        completed:
                            [],

                        participationRate:
                            0
                    },

                    stage:
                        deriveStageFromRevenue(
                            values
                        )
                }

                const dateStr =
                    values.dateOfRegistration
                        ? dayjs(
                            values.dateOfRegistration.toDate?.() ||
                            values.dateOfRegistration
                        ).format(
                            'YYYY-MM-DD'
                        )
                        : ''

                const digitalSignature =
                    SHA256(
                        `${values.email || ''}|${values.participantName || ''}|${dateStr}|${programId || ''}|${participantId || ''}`
                    )
                        .toString()
                        .slice(
                            0,
                            16
                        )

                setSubmissionStep(
                    60
                )

                /*
                 * Program branch.
                 */
                let branchId:
                    string | null =
                    null

                if (programId) {
                    const programSnap =
                        await getDoc(
                            doc(
                                db,
                                'programs',
                                programId
                            )
                        )

                    branchId =
                        programSnap.exists()
                            ? programSnap.data()
                                ?.assignedBranch
                                ?.id ||
                            null
                            : null
                }

                /*
                 * Build the application payload separately,
                 * clean it, then send it to Firestore.
                 */
                const applicationPayload =
                    removeUndefinedDeep({
                        participantId:
                            participantId ||
                            null,

                        programName:
                            programName ||
                            null,

                        programId:
                            programId ||
                            null,

                        branchId,

                        applicationStatus:
                            'pending',

                        submittedAt:
                            new Date().toISOString(),

                        beneficiaryName:
                            values.beneficiaryName ||
                            '',

                        gender:
                            values.gender ||
                            null,

                        ageGroup:
                            getAgeGroup(
                                derivedAge
                            ),

                        stage:
                            participant.stage,

                        province:
                            values.province ||
                            null,

                        hub:
                            values.hub ||
                            null,

                        email:
                            values.email ||
                            '',

                        motivation:
                            values.motivation ||
                            '',

                        challenges:
                            values.challenges ||
                            '',

                        complianceScore:
                            complianceScoreCalc,

                        complianceDocuments:
                            uploadedDocs,

                        complianceSummary,

                        interventions:
                            participant.interventions,

                        aiEvaluation:
                            null,

                        aiEvaluationStatus:
                            'pending',

                        profile:
                            values.profile ||
                            {},

                        digitalSignature,

                        gapGroup:
                            'A' as Group,

                        groupHistory: [
                            initialAEntry()
                        ] as GroupHistoryEntry[]
                    })

                console.log(
                    '[Application] Firestore payload:',
                    applicationPayload
                )

                /*
                 * Durable application write.
                 */
                const appRef =
                    await addDoc(
                        collection(
                            db,
                            'applications'
                        ),
                        applicationPayload
                    )

                setSubmissionStep(
                    75
                )

                /*
                 * Compliance subcollection.
                 */
                await upsertComplianceSubdocs(
                    appRef,
                    uploadedDocs,
                    {
                        programId,
                        programName,
                        uploadedByEmail:
                            values.email
                    }
                )

                /*
                 * AI enrichment happens only AFTER the
                 * application is safely stored.
                 */
                void evaluateWithAI(
                    participant
                )
                    .then(
                        aiEvaluation =>
                            updateDoc(
                                appRef,
                                {
                                    aiEvaluation:
                                        aiEvaluation ||
                                        null,

                                    aiEvaluationStatus:
                                        aiEvaluation
                                            ? 'completed'
                                            : 'unavailable',

                                    aiEvaluatedAt:
                                        new Date().toISOString()
                                }
                            )
                    )
                    .catch(
                        error => {
                            console.warn(
                                '[Application] AI evaluation enrichment failed:',
                                error
                            )
                        }
                    )

                setSubmissionStep(
                    85
                )

                await sendApplicationEmail(
                    values.email ||
                    '',
                    values.participantName ||
                    values.beneficiaryName ||
                    'Participant'
                )

                setSubmissionStep(
                    95
                )

                if (
                    participantId
                ) {
                    await deleteDoc(
                        doc(
                            db,
                            'applicationDrafts',
                            participantId
                        )
                    )
                }

                /*
                 * Role update.
                 */
                const userEmail =
                    auth.currentUser
                        ?.email

                if (userEmail) {
                    const usersQuery =
                        query(
                            collection(
                                db,
                                'users'
                            ),
                            where(
                                'email',
                                '==',
                                userEmail
                            )
                        )

                    const usersSnapshot =
                        await getDocs(
                            usersQuery
                        )

                    if (
                        !usersSnapshot.empty
                    ) {
                        await updateDoc(
                            doc(
                                db,
                                'users',
                                usersSnapshot
                                    .docs[0].id
                            ),
                            {
                                role:
                                    'Incubatee'
                            }
                        )
                    }
                }

                setSubmissionStep(
                    100
                )

                message.success(
                    'Application submitted successfully! Moving on to Gap Analysis.'
                )

                navigate(
                    '/incubatee/gap-analysis',
                    {
                        replace:
                            true,

                        state: {
                            participantId,

                            applicationId:
                                appRef.id,

                            programId,

                            programName,

                            prefillData:
                            {
                                companyName:
                                    values?.beneficiaryName ||
                                    '',

                                region:
                                    values?.province ||
                                    '',

                                contactDetails:
                                    values?.phone ||
                                    values?.contactNumber ||
                                    '',

                                email:
                                    values?.email ||
                                    '',

                                dateOfEngagement:
                                    dayjs().format(
                                        'YYYY-MM-DD'
                                    )
                            },

                            fromSubmission:
                                true
                        }
                    }
                )

                setCurrent(0)

                form.resetFields()

                setDocumentFields(
                    previous =>
                        previous.map(
                            document => ({
                                ...document,
                                file:
                                    null,
                                issueDate:
                                    null,
                                expiryDate:
                                    null
                            })
                        )
                )

                setInterventionSelections(
                    {}
                )
            } catch (error: any) {
                console.error(
                    '[Application] Submission failed:',
                    error
                )

                /*
                 * AntD validation errors are already shown
                 * against the fields.
                 */
                if (
                    Array.isArray(
                        error?.errorFields
                    )
                ) {
                    return
                }

                message.error(
                    error?.message ||
                    'Failed to register participant.'
                )
            } finally {
                submittingRef.current =
                    false

                setSuspendEffects(
                    false
                )

                setUploading(
                    false
                )

                /*
                 * If we navigated successfully, this page
                 * disappears anyway.
                 *
                 * If submission failed, don't leave the
                 * progress overlay stuck.
                 */
                setProgressModalVisible(
                    false
                )
            }
        }

    type DocumentsListProps = {
        items: DocField[]

        onSelectFile: (
            file: File,
            key: string
        ) => void

        onClear: (
            key: string
        ) => void

        onDateChange: (
            date: Dayjs | null,
            key: string
        ) => void

        disabledDateForDoc: (
            document: DocField
        ) => (
            current: Dayjs
        ) => boolean
    }

    const DocumentsList:
        React.FC<
            DocumentsListProps
        > = ({
            items,
            onSelectFile,
            onClear,
            onDateChange,
            disabledDateForDoc
        }) => (
            <Row
                gutter={[
                    12,
                    12
                ]}
            >
                {items.map(
                    document => {
                        const hasFile =
                            Boolean(
                                document.file
                            )

                        const statusColor =
                            hasFile
                                ? 'green'
                                : 'red'

                        const statusText =
                            hasFile
                                ? 'Ready'
                                : 'Missing'

                        const expiryHint =
                            document.expiryMonths
                                ? ` ≤ ${document.expiryMonths} month${document.expiryMonths > 1 ? 's' : ''} from today`
                                : ''

                        return (
                            <Col
                                xs={24}
                                md={12}
                                key={
                                    document.key
                                }
                            >
                                <Card
                                    size='small'
                                    styles={{
                                        body: {
                                            padding:
                                                12
                                        }
                                    }}
                                >
                                    <div
                                        style={{
                                            display:
                                                'flex',

                                            alignItems:
                                                'center',

                                            justifyContent:
                                                'space-between',

                                            gap:
                                                12,

                                            marginBottom:
                                                8
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontWeight:
                                                    600
                                            }}
                                        >
                                            {
                                                document.title
                                            }
                                        </span>

                                        <Tag
                                            color={
                                                statusColor
                                            }
                                        >
                                            {
                                                statusText
                                            }
                                        </Tag>
                                    </div>

                                    <Upload
                                        accept={
                                            ACCEPTED_MIME.join(
                                                ','
                                            )
                                        }
                                        beforeUpload={
                                            file => {
                                                onSelectFile(
                                                    file as File,
                                                    document.key
                                                )

                                                return false
                                            }
                                        }
                                        fileList={
                                            document.file
                                                ? [
                                                    {
                                                        uid:
                                                            document.key,

                                                        name:
                                                            document.file
                                                                .name,

                                                        status:
                                                            'done'
                                                    }
                                                ]
                                                : []
                                        }
                                        onRemove={() => {
                                            onClear(
                                                document.key
                                            )

                                            return true
                                        }}
                                        maxCount={
                                            1
                                        }
                                        showUploadList={{
                                            showRemoveIcon:
                                                true
                                        }}
                                    >
                                        <Button
                                            icon={
                                                <UploadOutlined />
                                            }
                                        >
                                            {hasFile
                                                ? 'Replace file'
                                                : 'Upload'}
                                        </Button>
                                    </Upload>

                                    <div
                                        style={{
                                            marginTop:
                                                8,

                                            fontSize:
                                                12,

                                            opacity:
                                                0.85
                                        }}
                                    >
                                        {hasFile ? (
                                            <>
                                                <span
                                                    style={{
                                                        marginRight:
                                                            8
                                                    }}
                                                >
                                                    <strong>
                                                        File:
                                                    </strong>{' '}
                                                    {
                                                        document.file
                                                            ?.name
                                                    }
                                                </span>

                                                <span>
                                                    <strong>
                                                        Size:
                                                    </strong>{' '}
                                                    {fmtBytes(
                                                        document.file!
                                                            .size
                                                    )}
                                                </span>
                                            </>
                                        ) : (
                                            <span>
                                                Accepted:
                                                PDF,
                                                PNG,
                                                JPG ·
                                                Max{' '}
                                                {
                                                    MAX_FILE_MB
                                                }{' '}
                                                MB
                                            </span>
                                        )}
                                    </div>

                                    <Row
                                        gutter={
                                            8
                                        }
                                        style={{
                                            marginTop:
                                                10
                                        }}
                                    >
                                        <Col
                                            span={
                                                12
                                            }
                                        >
                                            <DatePicker
                                                placeholder='Issue Date'
                                                style={{
                                                    width:
                                                        '100%'
                                                }}
                                                value={
                                                    document.issueDate
                                                }
                                                disabled={
                                                    !hasFile
                                                }
                                                disabledDate={
                                                    currentDate =>
                                                        Boolean(
                                                            currentDate &&
                                                            currentDate.isAfter(
                                                                dayjs(),
                                                                'day'
                                                            )
                                                        )
                                                }
                                                onChange={
                                                    date =>
                                                        setDocumentFields(
                                                            previous =>
                                                                previous.map(
                                                                    item =>
                                                                        item.key ===
                                                                            document.key
                                                                            ? {
                                                                                ...item,
                                                                                issueDate:
                                                                                    date
                                                                            }
                                                                            : item
                                                                )
                                                        )
                                                }
                                            />

                                            <div
                                                style={{
                                                    fontSize:
                                                        12,

                                                    marginTop:
                                                        4,

                                                    color:
                                                        'rgba(0,0,0,.45)'
                                                }}
                                            >
                                                Required
                                                when a
                                                file is
                                                attached
                                            </div>
                                        </Col>

                                        <Col
                                            span={
                                                12
                                            }
                                        >
                                            {document.requiresExpiry && (
                                                <>
                                                    <DatePicker
                                                        placeholder={`Expiry Date${expiryHint}`}
                                                        style={{
                                                            width:
                                                                '100%'
                                                        }}
                                                        value={
                                                            document.expiryDate
                                                        }
                                                        disabled={
                                                            !hasFile
                                                        }
                                                        disabledDate={
                                                            disabledDateForDoc(
                                                                document
                                                            )
                                                        }
                                                        onChange={
                                                            date =>
                                                                onDateChange(
                                                                    date,
                                                                    document.key
                                                                )
                                                        }
                                                    />

                                                    <div
                                                        style={{
                                                            fontSize:
                                                                12,

                                                            marginTop:
                                                                4,

                                                            color:
                                                                'rgba(0,0,0,.45)'
                                                        }}
                                                    >
                                                        Must
                                                        be in
                                                        the
                                                        future
                                                        {document.expiryMonths
                                                            ? `, within ${document.expiryMonths} month${document.expiryMonths > 1 ? 's' : ''}`
                                                            : ''}
                                                    </div>
                                                </>
                                            )}
                                        </Col>
                                    </Row>

                                    {hasFile && (
                                        <div
                                            style={{
                                                marginTop:
                                                    8
                                            }}
                                        >
                                            {!document.issueDate && (
                                                <Tag
                                                    color='red'
                                                    style={{
                                                        marginRight:
                                                            6
                                                    }}
                                                >
                                                    Issue
                                                    date
                                                    required
                                                </Tag>
                                            )}

                                            {document.requiresExpiry &&
                                                !document.expiryDate && (
                                                    <Tag color='volcano'>
                                                        Expiry
                                                        date
                                                        required
                                                    </Tag>
                                                )}
                                        </div>
                                    )}
                                </Card>
                            </Col>
                        )
                    }
                )}
            </Row>
        )

    const DocumentsStep = (
        <>
            <MotionCard
                style={{
                    background:
                        'linear-gradient(90deg,#eef4ff, #f9fbff)'
                }}
            >
                <div
                    style={{
                        display:
                            'flex',
                        alignItems:
                            'center',
                        gap:
                            8
                    }}
                >
                    <FileOutlined />

                    <Title
                        level={
                            4
                        }
                        style={{
                            margin:
                                0
                        }}
                    >
                        Upload Your
                        Documents
                    </Title>
                </div>
            </MotionCard>

            <DocumentsList
                items={
                    documentFields
                }
                onSelectFile={
                    handleFileUpload
                }
                onClear={
                    clearFile
                }
                onDateChange={
                    handleDateChange
                }
                disabledDateForDoc={
                    disabledDateForDoc
                }
            />
        </>
    )

    const scoreColor = (
        score: number
    ) => {
        if (score >= 80) {
            return {
                color:
                    'success',
                tag:
                    'green',
                text:
                    'Excellent'
            }
        }

        if (score >= 60) {
            return {
                color:
                    'processing',
                tag:
                    'blue',
                text:
                    'Good'
            }
        }

        if (score >= 40) {
            return {
                color:
                    'warning',
                tag:
                    'gold',
                text:
                    'Fair'
            }
        }

        return {
            color:
                'exception',
            tag:
                'red',
            text:
                'Poor'
        }
    }

    type ReviewSummaryCardProps = {
        values: any

        questions:
        Array<{
            id: string
            label: string
        }>

        expiredDocs:
        Array<{
            title: string
            expiryDate?: any
        }>

        missingDocs:
        Array<{
            title: string
        }>

        score: number
    }

    const ReviewSummaryCard:
        React.FC<
            ReviewSummaryCardProps
        > = ({
            values,
            questions,
            expiredDocs,
            missingDocs,
            score
        }) => {
            const screens =
                Grid.useBreakpoint()

            const cols =
                screens.lg
                    ? 2
                    : 1

            const labelW =
                screens.lg
                    ? 160
                    : undefined

            const status =
                scoreColor(
                    score
                )

            const chips = (
                <Space
                    wrap
                    size={[
                        8,
                        8
                    ]}
                >
                    <Tag
                        color={
                            status.tag
                        }
                    >
                        {
                            status.text
                        }
                    </Tag>

                    {expiredDocs.length >
                        0 && (
                            <Tag color='volcano'>
                                {
                                    expiredDocs.length
                                }{' '}
                                expiring
                            </Tag>
                        )}

                    {missingDocs.length >
                        0 && (
                            <Tag color='red'>
                                {
                                    missingDocs.length
                                }{' '}
                                missing
                            </Tag>
                        )}
                </Space>
            )

            return (
                <Card
                    title='Review & Compliance Summary'
                    extra={
                        chips
                    }
                    style={{
                        borderRadius:
                            14
                    }}
                >
                    <Row
                        gutter={[
                            16,
                            16
                        ]}
                    >
                        <Col
                            xs={
                                24
                            }
                            md={
                                8
                            }
                        >
                            <Card
                                size='small'
                                style={{
                                    borderRadius:
                                        12
                                }}
                            >
                                <Space
                                    direction='vertical'
                                    style={{
                                        width:
                                            '100%'
                                    }}
                                >
                                    <div
                                        style={{
                                            display:
                                                'flex',

                                            justifyContent:
                                                'space-between',

                                            gap:
                                                12
                                        }}
                                    >
                                        <strong>
                                            Compliance
                                            Score
                                        </strong>

                                        <Badge
                                            status={
                                                status.color as any
                                            }
                                            text={
                                                status.text
                                            }
                                        />
                                    </div>

                                    <Progress
                                        percent={
                                            score
                                        }
                                        status={
                                            status.color as any
                                        }
                                        strokeWidth={
                                            10
                                        }
                                        showInfo
                                    />
                                </Space>
                            </Card>
                        </Col>

                        <Col
                            xs={
                                24
                            }
                            md={
                                16
                            }
                        >
                            <Card
                                size='small'
                                style={{
                                    borderRadius:
                                        12
                                }}
                            >
                                <Descriptions
                                    size='small'
                                    column={
                                        cols
                                    }
                                    bordered
                                    labelStyle={{
                                        width:
                                            labelW,

                                        whiteSpace:
                                            'normal',

                                        wordBreak:
                                            'break-word'
                                    }}
                                    contentStyle={{
                                        whiteSpace:
                                            'normal',

                                        wordBreak:
                                            'break-word'
                                    }}
                                    style={{
                                        width:
                                            '100%'
                                    }}
                                >
                                    <Descriptions.Item label='Beneficiary'>
                                        {values?.beneficiaryName ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Owner'>
                                        {values?.participantName ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Email'>
                                        {values?.email ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Stage'>
                                        <Tag color='blue'>
                                            {values?.stage ||
                                                '-'}
                                        </Tag>
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Sector'>
                                        {values?.sector ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Province / City'>
                                        {values?.province ||
                                            '-'}{' '}
                                        /{' '}
                                        {values?.city ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Registration #'>
                                        {values?.registrationNumber ||
                                            '-'}
                                    </Descriptions.Item>

                                    <Descriptions.Item label='Date of Registration'>
                                        {toDateStr(
                                            values?.dateOfRegistration
                                        )}
                                    </Descriptions.Item>
                                </Descriptions>
                            </Card>
                        </Col>
                    </Row>

                    <Divider
                        style={{
                            margin:
                                '16px 0'
                        }}
                    />

                    {questions.length >
                        0 && (
                            <Card
                                size='small'
                                title='Program Profile'
                                style={{
                                    borderRadius:
                                        12,

                                    marginBottom:
                                        12
                                }}
                            >
                                <Descriptions
                                    size='small'
                                    column={{
                                        xs:
                                            1,
                                        sm:
                                            1,
                                        md:
                                            2
                                    }}
                                    bordered
                                >
                                    {questions.map(
                                        question => (
                                            <Descriptions.Item
                                                key={
                                                    question.id
                                                }
                                                label={
                                                    question.label
                                                }
                                            >
                                                {values?.profile?.[
                                                    question.id
                                                ] || (
                                                        <Tag>
                                                            —
                                                        </Tag>
                                                    )}
                                            </Descriptions.Item>
                                        )
                                    )}
                                </Descriptions>
                            </Card>
                        )}

                    <Row
                        gutter={[
                            16,
                            16
                        ]}
                    >
                        <Col
                            xs={
                                24
                            }
                            md={
                                12
                            }
                        >
                            <Card
                                size='small'
                                title='Motivation'
                                style={{
                                    borderRadius:
                                        12
                                }}
                            >
                                <div
                                    style={{
                                        whiteSpace:
                                            'pre-wrap'
                                    }}
                                >
                                    {values?.motivation || (
                                        <Tag>
                                            Not
                                            provided
                                        </Tag>
                                    )}
                                </div>
                            </Card>
                        </Col>

                        <Col
                            xs={
                                24
                            }
                            md={
                                12
                            }
                        >
                            <Card
                                size='small'
                                title='Challenges'
                                style={{
                                    borderRadius:
                                        12
                                }}
                            >
                                <div
                                    style={{
                                        whiteSpace:
                                            'pre-wrap'
                                    }}
                                >
                                    {values?.challenges || (
                                        <Tag>
                                            Not
                                            provided
                                        </Tag>
                                    )}
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    <Space
                        direction='vertical'
                        style={{
                            width:
                                '100%',
                            marginTop:
                                12
                        }}
                    >
                        {expiredDocs.length >
                            0 && (
                                <Alert
                                    type='warning'
                                    showIcon
                                    message={
                                        <Space>
                                            <ExclamationCircleTwoTone twoToneColor='#faad14' />

                                            <strong>
                                                Expired
                                                /
                                                Expiring
                                                soon
                                            </strong>
                                        </Space>
                                    }
                                    description={
                                        <Space
                                            direction='vertical'
                                            size={
                                                6
                                            }
                                            style={{
                                                width:
                                                    '100%'
                                            }}
                                        >
                                            {expiredDocs.map(
                                                (
                                                    document,
                                                    index
                                                ) => (
                                                    <div
                                                        key={
                                                            index
                                                        }
                                                        style={{
                                                            display:
                                                                'flex',

                                                            gap:
                                                                8,

                                                            alignItems:
                                                                'center'
                                                        }}
                                                    >
                                                        <Tag color='gold'>
                                                            {
                                                                document.title
                                                            }
                                                        </Tag>

                                                        <span
                                                            style={{
                                                                opacity:
                                                                    0.8
                                                            }}
                                                        >
                                                            {toDateStr(
                                                                document.expiryDate
                                                            )}
                                                        </span>
                                                    </div>
                                                )
                                            )}
                                        </Space>
                                    }
                                />
                            )}

                        {missingDocs.length >
                            0 && (
                                <Alert
                                    type='error'
                                    showIcon
                                    message={
                                        <Space>
                                            <WarningTwoTone twoToneColor='#ff4d4f' />

                                            <strong>
                                                Missing
                                                documents
                                            </strong>
                                        </Space>
                                    }
                                    description={
                                        <Space
                                            wrap
                                            size={[
                                                6,
                                                6
                                            ]}
                                        >
                                            {missingDocs.map(
                                                (
                                                    document,
                                                    index
                                                ) => (
                                                    <Tag
                                                        key={
                                                            index
                                                        }
                                                        color='red'
                                                    >
                                                        {
                                                            document.title
                                                        }
                                                    </Tag>
                                                )
                                            )}
                                        </Space>
                                    }
                                />
                            )}

                        {expiredDocs.length ===
                            0 &&
                            missingDocs.length ===
                            0 && (
                                <Alert
                                    type='success'
                                    showIcon
                                    message={
                                        <Space>
                                            <CheckCircleTwoTone twoToneColor='#52c41a' />
                                            All
                                            documents
                                            look
                                            good.
                                        </Space>
                                    }
                                />
                            )}
                    </Space>
                </Card>
            )
        }

    const ReviewStep:
        React.FC = () => {
            const reviewValues =
                form.getFieldsValue(
                    true
                )

            const expired =
                getExpiredDocuments().map(
                    document => ({
                        title:
                            document.title,

                        expiryDate:
                            document.expiryDate
                    })
                )

            const missing =
                getMissingDocuments().map(
                    document => ({
                        title:
                            document.title
                    })
                )

            return (
                <ReviewSummaryCard
                    values={
                        reviewValues
                    }
                    questions={
                        programQuestions
                    }
                    expiredDocs={
                        expired
                    }
                    missingDocs={
                        missing
                    }
                    score={
                        complianceScore
                    }
                />
            )
        }

    /*
     * ---------------------------------------------------------
     * STEPS
     *
     * Interventions deliberately comes BEFORE compliance.
     * ---------------------------------------------------------
     */
    const steps = [
        {
            title:
                'Motivation',

            content: (
                <MotionCard>
                    <Form.Item
                        name='stage'
                        hidden
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        name='age'
                        hidden
                    >
                        <Input />
                    </Form.Item>

                    <Form.Item
                        name='motivation'
                        label='Motivation (min 100 words)'
                        rules={[
                            {
                                required:
                                    true
                            }
                        ]}
                    >
                        <Input.TextArea
                            rows={
                                4
                            }
                        />
                    </Form.Item>

                    <Form.Item
                        name='challenges'
                        label='Challenges'
                    >
                        <Input.TextArea
                            rows={
                                3
                            }
                        />
                    </Form.Item>
                </MotionCard>
            )
        },

        ...(hasProgramProfile
            ? [
                {
                    title:
                        'Program Profile',

                    content: (
                        <MotionCard>
                            <Title
                                level={
                                    5
                                }
                            >
                                Answer
                                All To
                                Proceed
                            </Title>

                            {programQuestions.map(
                                question =>
                                    renderQuestionField(
                                        question
                                    )
                            )}
                        </MotionCard>
                    )
                }
            ]
            : []),

        {
            title:
                'Interventions',

            content: (
                <>
                    <Card
                        style={{
                            background:
                                'linear-gradient(90deg,#eef4ff, #f9fbff)',

                            marginBottom:
                                10
                        }}
                    >
                        <div
                            style={{
                                display:
                                    'flex',

                                alignItems:
                                    'center',

                                gap:
                                    8
                            }}
                        >
                            <PicCenterOutlined
                                style={{
                                    fontSize:
                                        20
                                }}
                            />

                            <Title
                                level={
                                    4
                                }
                                style={{
                                    margin:
                                        0
                                }}
                            >
                                Pick
                                Your
                                Required
                                Interventions
                            </Title>
                        </div>
                    </Card>

                    <Collapse
                        activeKey={
                            openPanels
                        }
                        onChange={
                            keys =>
                                setOpenPanels(
                                    Array.isArray(
                                        keys
                                    )
                                        ? (
                                            keys as string[]
                                        )
                                        : [
                                            keys as string
                                        ]
                                )
                        }
                        collapsible='icon'
                        destroyInactivePanel={
                            false
                        }
                    >
                        {interventionGroups.map(
                            group => (
                                <Collapse.Panel
                                    header={
                                        group.area
                                    }
                                    key={
                                        group.area
                                    }
                                >
                                    <div
                                        onClick={
                                            event =>
                                                event.stopPropagation()
                                        }
                                    >
                                        <Checkbox.Group
                                            value={
                                                interventionSelections[
                                                group
                                                    .area
                                                ] ||
                                                []
                                            }
                                            onChange={
                                                values =>
                                                    setInterventionSelections(
                                                        previous => ({
                                                            ...previous,

                                                            [group.area]:
                                                                values as string[]
                                                        })
                                                    )
                                            }
                                        >
                                            <Space direction='vertical'>
                                                {group.interventions.map(
                                                    (
                                                        intervention: any
                                                    ) => (
                                                        <Checkbox
                                                            key={
                                                                intervention.id
                                                            }
                                                            value={
                                                                intervention.id
                                                            }
                                                        >
                                                            {
                                                                intervention.title
                                                            }
                                                        </Checkbox>
                                                    )
                                                )}
                                            </Space>
                                        </Checkbox.Group>
                                    </div>
                                </Collapse.Panel>
                            )
                        )}
                    </Collapse>
                </>
            )
        },

        {
            title:
                'Documents',

            content: (
                <Space
                    direction='vertical'
                    style={{
                        width:
                            '100%'
                    }}
                >
                    {
                        DocumentsStep
                    }
                </Space>
            )
        },

        {
            title:
                'Review',

            content: (
                <ReviewStep />
            )
        }
    ]

    /*
     * Keep current inside the available step count if the
     * optional Program Profile changes.
     */
    useEffect(() => {
        setCurrent(
            currentStep =>
                Math.min(
                    currentStep,
                    Math.max(
                        steps.length -
                        1,
                        0
                    )
                )
        )
    }, [steps.length])

    const FooterActions:
        React.FC<{
            hasPrev: boolean
            hasNext: boolean

            onPrev:
            () => void

            onNext:
            () => void

            onSubmit?:
            () => void

            submitting?:
            boolean
        }> = ({
            hasPrev,
            hasNext,
            onPrev,
            onNext,
            onSubmit,
            submitting
        }) => (
            <div
                style={{
                    position:
                        'fixed',

                    left:
                        0,

                    right:
                        0,

                    bottom:
                        0,

                    height:
                        FOOTER_H,

                    background:
                        '#fff',

                    borderTop:
                        '1px solid rgba(0,0,0,0.06)',

                    boxShadow:
                        '0 -2px 8px rgba(0,0,0,0.04)',

                    display:
                        'flex',

                    alignItems:
                        'center',

                    zIndex:
                        100
                }}
            >
                <div
                    style={{
                        width:
                            '100%',

                        maxWidth:
                            1200,

                        margin:
                            '0 auto',

                        padding:
                            '0 16px',

                        display:
                            'flex',

                        justifyContent:
                            'space-between',

                        gap:
                            8
                    }}
                >
                    <div>
                        {hasPrev && (
                            <Button
                                onClick={
                                    onPrev
                                }
                                size='middle'
                                disabled={
                                    submitting
                                }
                                icon={
                                    <LeftOutlined />
                                }
                            >
                                Back
                            </Button>
                        )}
                    </div>

                    <div>
                        {hasNext ? (
                            <Button
                                type='primary'
                                onClick={
                                    onNext
                                }
                                size='middle'
                                icon={
                                    <RightOutlined />
                                }
                                disabled={
                                    submitting
                                }
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type='primary'
                                onClick={
                                    onSubmit
                                }
                                loading={
                                    submitting
                                }
                                size='middle'
                                icon={
                                    <RightOutlined />
                                }
                                disabled={
                                    submitting
                                }
                            >
                                Submit
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        )

    const ContentWithResponsiveSteps:
        React.FC = () => {
            const screens =
                Grid.useBreakpoint()

            const isMobile =
                Boolean(
                    screens.xs &&
                    !screens.sm
                )

            return (
                <div
                    style={{
                        width:
                            '100%',

                        maxWidth:
                            1200,

                        padding:
                            '0 16px',

                        display:
                            'flex',

                        flexDirection:
                            'column',

                        minHeight:
                            0
                    }}
                >
                    {!isMobile && (
                        <Steps
                            labelPlacement='vertical'
                            current={
                                current
                            }
                            style={{
                                margin:
                                    8
                            }}
                            items={steps.map(
                                step => ({
                                    title:
                                        step.title
                                })
                            )}
                        />
                    )}

                    <Form
                        key={
                            current
                        }
                        layout='vertical'
                        form={
                            form
                        }
                        preserve
                        style={{
                            flex:
                                1,
                            minHeight:
                                0
                        }}
                    >
                        <div
                            style={{
                                height:
                                    '100%',

                                minHeight:
                                    0,

                                overflow:
                                    'auto',

                                paddingRight:
                                    6,

                                paddingBottom:
                                    FOOTER_H +
                                    12
                            }}
                        >
                            {
                                steps[
                                    current
                                ]?.content
                            }
                        </div>
                    </Form>
                </div>
            )
        }

    /*
     * ---------------------------------------------------------
     * INITIAL FULL-PAGE LOADING
     * ---------------------------------------------------------
     */
    if (
        initialisingApplication
    ) {
        return (
            <div
                style={{
                    minHeight:
                        '100vh'
                }}
            >
                <Helmet>
                    <title>
                        Participant
                        Registration
                        | Smart
                        Incubation
                        Platform
                    </title>
                </Helmet>

                <LoadingOverlay
                    tip='Retrieving your saved application...'
                />
            </div>
        )
    }

    return (
        <div
            style={
                {
                    minHeight:
                        '100vh',

                    padding:
                        24,

                    display:
                        'flex',

                    flexDirection:
                        'column',

                    '--footer-h':
                        `${FOOTER_H}px`
                } as React.CSSProperties
            }
        >
            <Helmet>
                <title>
                    Participant
                    Registration |
                    Smart Incubation
                    Platform
                </title>

                <meta
                    name='description'
                    content='Register as a participant to access tailored business development support through the Smart Incubation Platform.'
                />
            </Helmet>

            <div
                style={{
                    width:
                        '100%'
                }}
            >
                <div
                    style={{
                        maxWidth:
                            1200,

                        margin:
                            '0 auto',

                        padding:
                            '0 16px'
                    }}
                >
                    <DashboardHeaderCard
                        subtitle='A draft is saved every 60 seconds and after each step. Uploaded document files are not saved in drafts for privacy and security reasons.'
                        title={`Application Form: ${programName || ''}`}
                        extraRight={
                            <Button
                                type='link'
                                onClick={() =>
                                    navigate(
                                        -1
                                    )
                                }
                            >
                                ← Back
                                to
                                Selection
                            </Button>
                        }
                    />
                </div>
            </div>

            <div
                style={{
                    flex:
                        1,

                    minHeight:
                        0,

                    display:
                        'flex',

                    justifyContent:
                        'center',

                    pointerEvents:
                        uploading
                            ? 'none'
                            : 'auto',

                    filter:
                        uploading
                            ? 'blur(1px)'
                            : 'none'
                }}
            >
                <ContentWithResponsiveSteps />
            </div>

            <FooterActions
                hasPrev={
                    current > 0
                }
                hasNext={
                    current <
                    steps.length -
                    1
                }
                onPrev={() => {
                    void prev()
                }}
                onNext={() => {
                    void next()
                }}
                onSubmit={() => {
                    void handleSubmit()
                }}
                submitting={
                    uploading
                }
            />

            {progressModalVisible && (
                <LoadingBlob
                    message='Submitting your application...'
                    progress={
                        submissionStep
                    }
                />
            )}
        </div>
    )
}

export default ParticipantRegistrationStepForm
