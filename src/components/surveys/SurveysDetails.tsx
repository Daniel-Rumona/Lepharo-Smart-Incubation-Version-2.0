// src/components/surveys/SurveysDetails.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    App,
    Button,
    Empty,
    Input,
    Modal,
    Row,
    Col,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    theme,
    Avatar,
    Pagination,
    Progress
} from 'antd'
import {
    AppstoreOutlined,
    ArrowLeftOutlined,
    BarChartOutlined,
    CalendarOutlined,
    CheckCircleFilled,
    ClockCircleOutlined,
    EditOutlined,
    EyeOutlined,
    FileSearchOutlined,
    FileTextOutlined,
    PlusOutlined,
    SearchOutlined,
    SendOutlined,
    TableOutlined
} from '@ant-design/icons'
import {
    AnimatePresence,
    motion
} from 'framer-motion'
import { Helmet } from 'react-helmet'
import {
    Timestamp,
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    setDoc,
    where
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '../dashboards/metrics/Header'
import SurveyResponseViewer from './response/viewer'

type ViewKey = 'sent' | 'templates'
type SentStatusFilter = 'completed' | 'pending'
type TemplateStatusFilter = 'published' | 'draft'

const { Title, Text } = Typography
const SURVEY_RESPONSE_PAGE_SIZE = 4
const SEND_SURVEY_PARTICIPANT_PAGE_SIZE = 4
const SEND_SURVEY_TEMPLATE_PAGE_SIZE = 4

type SendSurveyStep = 'template' | 'participants'

type ParticipantSelectionRow = {
    key: string
    participantName: string
    companyName: string
    email: string
    group: string
    branchId?: string
    branch: string
}

type SurveyField = {
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

type SentSurveyRow = {
    id: string
    title: string
    participants: any[]
    completed: number
    total: number
    sentAt?: Timestamp
    templateId?: string
    department?: string
    programId?: string
}

type TemplateRow = {
    id: string
    title: string
    description?: string
    status: 'published' | 'draft'
    category?: string
    department?: string
    programId?: string
    createdAt?: Timestamp | string
    updatedAt?: Timestamp | string
    createdBy?: string
    fields: SurveyField[]
}

const toDate = (
    value?: Timestamp | string | null
): Date | null => {
    if (!value) return null

    if (
        typeof value === 'object' &&
        typeof (value as Timestamp).toDate === 'function'
    ) {
        return (value as Timestamp).toDate()
    }

    if (typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime())
            ? null
            : parsed
    }

    return null
}

const normalizeTemplateFields = (
    template: any
): SurveyField[] => {
    if (Array.isArray(template?.fields)) {
        return template.fields.map(
            (field: any, index: number) => ({
                id:
                    String(
                        field?.id ||
                        `field_${index}`
                    ),
                type:
                    String(
                        field?.type ||
                        'text'
                    ),
                label:
                    String(
                        field?.label ||
                        field?.question ||
                        field?.questionText ||
                        `Question ${index + 1}`
                    ),
                name:
                    field?.name ||
                    undefined,
                placeholder:
                    field?.placeholder ??
                    undefined,
                required:
                    !!field?.required,
                options:
                    Array.isArray(
                        field?.options
                    )
                        ? field.options.filter(
                            Boolean
                        )
                        : undefined,
                description:
                    field?.description ??
                    undefined,
                defaultValue:
                    field?.defaultValue
            })
        )
    }

    /*
     * Backward compatibility for older templates that used `questions`.
     * New templates should use `fields`.
     */
    if (Array.isArray(template?.questions)) {
        return template.questions.map(
            (question: any, index: number) => ({
                id:
                    String(
                        question?.id ||
                        `field_${index}`
                    ),
                type:
                    String(
                        question?.type ||
                        'text'
                    ),
                label:
                    String(
                        question?.label ||
                        question?.questionText ||
                        question?.question ||
                        `Question ${index + 1}`
                    ),
                name:
                    question?.name ||
                    undefined,
                placeholder:
                    question?.placeholder ??
                    undefined,
                required:
                    !!question?.required,
                options:
                    Array.isArray(
                        question?.options
                    )
                        ? question.options.filter(
                            Boolean
                        )
                        : undefined,
                description:
                    question?.description ??
                    undefined,
                defaultValue:
                    question?.defaultValue
            })
        )
    }

    return []
}

const toResponseQuestions = (
    fields: SurveyField[]
) =>
    fields.map((field, index) => ({
        id:
            field.id ||
            `q_${index}`,
        question:
            field.label ||
            `Question ${index + 1}`,
        questionText:
            field.label ||
            `Question ${index + 1}`,
        label:
            field.label ||
            `Question ${index + 1}`,
        type:
            field.type ||
            'text',
        name:
            field.name,
        placeholder:
            field.placeholder,
        required:
            !!field.required,
        options:
            Array.isArray(field.options)
                ? field.options.filter(Boolean)
                : [],
        description:
            field.description,
        defaultValue:
            field.defaultValue
    }))

const SurveysDetailsPage = () => {
    const navigate = useNavigate()
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const { user } = useFullIdentity()

    const {
        programId: rawProgramId,
        activeProgramId,
        isAllPrograms
    } = useActiveProgramId()

    const [
        surveyParticipantPage,
        setSurveyParticipantPage
    ] = useState(1)

    const [sentSurveys, setSentSurveys] = useState<
        SentSurveyRow[]
    >([])

    const [surveyTemplates, setSurveyTemplates] =
        useState<TemplateRow[]>([])

    const [selectedSurveyId, setSelectedSurveyId] =
        useState<string | null>(null)

    const [viewSurvey, setViewSurvey] =
        useState<SentSurveyRow | null>(null)

    const [
        selectedParticipant,
        setSelectedParticipant
    ] = useState<any>(null)

    const [sendModalOpen, setSendModalOpen] =
        useState(false)

    const [sendSurveyStep, setSendSurveyStep] =
        useState<SendSurveyStep>('template')

    const [sendParticipantPage, setSendParticipantPage] =
        useState(1)

    const [sendTemplatePage, setSendTemplatePage] =
        useState(1)

    const [sendSurveySubmitting, setSendSurveySubmitting] =
        useState(false)

    const [surveyProgramMeta, setSurveyProgramMeta] =
        useState<any>(null)

    const [participantsList, setParticipantsList] =
        useState<any[]>([])

    const [
        selectedParticipantIds,
        setSelectedParticipantIds
    ] = useState<string[]>([])

    const [
        participantTableData,
        setParticipantTableData
    ] = useState<ParticipantSelectionRow[]>([])

    const [branchesMap, setBranchesMap] =
        useState<Record<string, string>>({})

    const [acceptedApplications, setAcceptedApplications] =
        useState<any[]>([])

    const [
        participantFilters,
        setParticipantFilters
    ] = useState({
        search: '',
        branchId: '',
        gapGroup: ''
    })

    const [mainView, setMainView] =
        useState<ViewKey>('sent')

    const [sentSearch, setSentSearch] =
        useState('')

    const [sentStatus, setSentStatus] =
        useState<
            SentStatusFilter | undefined
        >(undefined)

    const [
        templateSearch,
        setTemplateSearch
    ] = useState('')

    const [
        templateStatus,
        setTemplateStatus
    ] = useState<
        TemplateStatusFilter | undefined
    >(undefined)



    const publishedSurveyTemplates = useMemo(
        () =>
            surveyTemplates.filter(
                template => template.status === 'published'
            ),
        [surveyTemplates]
    )

    const selectedSurveyTemplate = useMemo(
        () =>
            surveyTemplates.find(
                template => template.id === selectedSurveyId
            ) || null,
        [surveyTemplates, selectedSurveyId]
    )

    const selectedSurveyProgramId =
        activeProgramId ||
        selectedSurveyTemplate?.programId ||
        null

    const paginatedSendTemplates = useMemo(() => {
        const start =
            (sendTemplatePage - 1) *
            SEND_SURVEY_TEMPLATE_PAGE_SIZE

        return publishedSurveyTemplates.slice(
            start,
            start + SEND_SURVEY_TEMPLATE_PAGE_SIZE
        )
    }, [publishedSurveyTemplates, sendTemplatePage])

    const paginatedSendParticipants = useMemo(() => {
        const start =
            (sendParticipantPage - 1) *
            SEND_SURVEY_PARTICIPANT_PAGE_SIZE

        return participantTableData.slice(
            start,
            start + SEND_SURVEY_PARTICIPANT_PAGE_SIZE
        )
    }, [participantTableData, sendParticipantPage])

    const surveyBranchOptions = useMemo(() => {
        if (!selectedSurveyProgramId) return []

        const branchIds = Array.from(
            new Set(
                acceptedApplications
                    .filter(
                        application =>
                            String(application.programId || '') ===
                            String(selectedSurveyProgramId)
                    )
                    .map(application =>
                        String(application.branchId || '').trim()
                    )
                    .filter(Boolean)
            )
        )

        return branchIds.map(branchId => ({
            value: branchId,
            label: branchesMap[branchId] || 'Unnamed Branch'
        }))
    }, [
        acceptedApplications,
        branchesMap,
        selectedSurveyProgramId
    ])

    const surveyResponseParticipants =
        viewSurvey?.participants || []

    const completedSurveyResponseCount =
        surveyResponseParticipants.filter(
            participant =>
                participant.completed === true
        ).length

    const surveyResponseCompletionRate =
        surveyResponseParticipants.length > 0
            ? Math.round(
                (
                    completedSurveyResponseCount /
                    surveyResponseParticipants.length
                ) * 100
            )
            : 0

    const paginatedSurveyResponseParticipants =
        surveyResponseParticipants.slice(
            (
                surveyParticipantPage - 1
            ) * SURVEY_RESPONSE_PAGE_SIZE,
            surveyParticipantPage *
            SURVEY_RESPONSE_PAGE_SIZE
        )

    useEffect(() => {
        setSurveyParticipantPage(1)
        setSelectedParticipant(null)
    }, [viewSurvey?.id])

    useEffect(() => {
        let active = true

        const loadSurveyProgram = async () => {
            if (!selectedSurveyProgramId) {
                if (active) {
                    setSurveyProgramMeta(null)
                    setParticipantFilters(previous => ({
                        ...previous,
                        branchId: ''
                    }))
                }
                return
            }

            try {
                const snapshot = await getDoc(
                    doc(db, 'programs', selectedSurveyProgramId)
                )

                if (!active) return

                const data = snapshot.exists()
                    ? {
                        id: snapshot.id,
                        ...snapshot.data()
                    }
                    : null

                setSurveyProgramMeta(data)

                if (!data?.isMultiBranch) {
                    setParticipantFilters(previous => ({
                        ...previous,
                        branchId: ''
                    }))
                }
            } catch (error) {
                console.error(
                    'Failed to load survey program details',
                    error
                )

                if (active) {
                    setSurveyProgramMeta(null)
                    setParticipantFilters(previous => ({
                        ...previous,
                        branchId: ''
                    }))
                }
            }
        }

        loadSurveyProgram()

        return () => {
            active = false
        }
    }, [selectedSurveyProgramId])

    // ─────────────────────────────────────────────────────────────
    // Participants
    // ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const fetchParticipants = async () => {
            try {
                const snap = await getDocs(
                    collection(
                        db,
                        'participants'
                    )
                )

                const rows = snap.docs.map(document => ({
                    id: document.id,
                    ...document.data()
                }))

                setParticipantsList(rows)
            } catch (error) {
                console.error(
                    'Failed to load participants',
                    error
                )
                setParticipantsList([])
            }
        }

        if (user?.departmentId) {
            fetchParticipants()
        }
    }, [user?.departmentId])

    // ─────────────────────────────────────────────────────────────
    // Accepted applications + branches
    // ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const fetchSupportingData =
            async () => {
                try {
                    const appQuery = query(
                        collection(
                            db,
                            'applications'
                        ),
                        where(
                            'applicationStatus',
                            'in',
                            [
                                'accepted',
                                'Accepted'
                            ]
                        )
                    )

                    const appSnap =
                        await getDocs(appQuery)

                    const applications =
                        appSnap.docs.map(document => ({
                            id: document.id,
                            ...document.data()
                        }))

                    setAcceptedApplications(applications)

                    const branchSnap =
                        await getDocs(
                            collection(
                                db,
                                'branches'
                            )
                        )

                    const nextBranchesMap: Record<
                        string,
                        string
                    > = {}

                    branchSnap.docs.forEach(
                        document => {
                            nextBranchesMap[
                                document.id
                            ] =
                                document.data()
                                    .name ||
                                'Unnamed Branch'
                        }
                    )

                    setBranchesMap(
                        nextBranchesMap
                    )
                } catch (error) {
                    console.error(
                        'Failed to load survey supporting data',
                        error
                    )

                    setAcceptedApplications([])
                    setBranchesMap({})
                }
            }

        fetchSupportingData()
    }, [])

    useEffect(() => {
        const normalizedSearch =
            participantFilters.search
                .trim()
                .toLowerCase()

        if (!selectedSurveyProgramId) {
            setParticipantTableData([])
            return
        }

        const applicationByParticipant = new Map<
            string,
            any
        >()

        acceptedApplications
            .filter(
                application =>
                    String(application.programId || '') ===
                    String(selectedSurveyProgramId)
            )
            .forEach(application => {
                const participantId = String(
                    application.participantId || ''
                ).trim()

                if (participantId) {
                    applicationByParticipant.set(
                        participantId,
                        application
                    )
                }
            })

        const data = participantsList
            .map(participant => {
                const application =
                    applicationByParticipant.get(
                        String(participant.id)
                    )

                if (!application) return null

                const participantName = String(
                    participant.participantName ||
                    participant.fullName ||
                    participant.name ||
                    application.participantName ||
                    application.fullName ||
                    ''
                ).trim() || 'Unnamed Participant'

                const companyName = String(
                    participant.companyName ||
                    participant.beneficiaryName ||
                    participant.businessName ||
                    application.companyName ||
                    application.beneficiaryName ||
                    application.businessName ||
                    'Unnamed Company'
                ).trim()

                const email = String(
                    participant.email ||
                    participant.participantEmail ||
                    application.email ||
                    application.participantEmail ||
                    ''
                ).trim()

                const group = String(
                    application.gapGroup ||
                    participant.gapGroup ||
                    participant.group ||
                    'N/A'
                ).trim()

                const branchId = String(
                    application.branchId ||
                    participant.branchId ||
                    ''
                ).trim()

                return {
                    key: String(participant.id),
                    participantName,
                    companyName,
                    email,
                    group,
                    branchId,
                    branch:
                        branchesMap[branchId] ||
                        'Unknown'
                } as ParticipantSelectionRow
            })
            .filter(
                (row): row is ParticipantSelectionRow =>
                    Boolean(row)
            )
            .filter(row => {
                if (!normalizedSearch) return true

                return [
                    row.participantName,
                    row.companyName,
                    row.email
                ].some(value =>
                    value
                        .toLowerCase()
                        .includes(normalizedSearch)
                )
            })
            .filter(row =>
                participantFilters.gapGroup
                    ? row.group ===
                    participantFilters.gapGroup
                    : true
            )
            .filter(row =>
                surveyProgramMeta?.isMultiBranch &&
                    participantFilters.branchId
                    ? row.branchId ===
                    participantFilters.branchId
                    : true
            )
            .sort((a, b) =>
                a.companyName.localeCompare(
                    b.companyName
                )
            )

        setParticipantTableData(data)
        setSendParticipantPage(1)
    }, [
        participantsList,
        acceptedApplications,
        branchesMap,
        participantFilters,
        selectedSurveyProgramId,
        surveyProgramMeta?.isMultiBranch
    ])


    // ─────────────────────────────────────────────────────────────
    // Templates
    // formTemplates
    // ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const snap = await getDocs(
                    collection(
                        db,
                        'formTemplates'
                    )
                )

                const rawTemplates = snap.docs.map(document => ({
                    id: document.id,
                    ...(document.data() as any)
                }))

                const diagnostics = rawTemplates.map((template: any) => {
                    const status = String(template.status || '').toLowerCase()

                    const validStatus =
                        status === 'draft' ||
                        status === 'published' ||
                        status === 'active'

                    const matchesDepartment =
                        !template.department ||
                        String(template.department) ===
                        String(user?.departmentId || '')

                    const matchesProgram =
                        !activeProgramId ||
                        String(template.programId || '') === activeProgramId

                    return {
                        id: template.id,
                        title: template.title,
                        status: template.status,
                        department: template.department,
                        expectedDepartment: user?.departmentId,
                        programId: template.programId,
                        activeProgramId,
                        fields: Array.isArray(template.fields)
                            ? template.fields.length
                            : 0,
                        questions: Array.isArray(template.questions)
                            ? template.questions.length
                            : 0,
                        validStatus,
                        matchesDepartment,
                        matchesProgram,
                        visible:
                            validStatus &&
                            matchesDepartment &&
                            matchesProgram
                    }
                })

                console.table(diagnostics)

                const qmsTraining = diagnostics.filter((row: any) =>
                    String(row.title || '')
                        .toLowerCase()
                        .includes('qms training')
                )

                if (qmsTraining.length) {
                    console.log('QMS TRAINING diagnostic', qmsTraining)
                } else {
                    console.warn(
                        'QMS TRAINING was not returned by formTemplates at all.'
                    )
                }

                const rows = rawTemplates
                    .filter((template: any) => {
                        const status =
                            String(template.status || '').toLowerCase()

                        const validStatus =
                            status === 'draft' ||
                            status === 'published' ||
                            status === 'active'

                        const matchesDepartment =
                            !template.department ||
                            String(template.department) ===
                            String(user?.departmentId || '')

                        const matchesProgram =
                            !activeProgramId ||
                            String(template.programId || '') ===
                            activeProgramId

                        return (
                            validStatus &&
                            matchesDepartment &&
                            matchesProgram
                        )
                    })
                    .map(
                        (template: any): TemplateRow => {
                            const normalizedStatus =
                                String(
                                    template.status ||
                                    ''
                                ).toLowerCase()

                            return {
                                id: template.id,
                                title:
                                    String(
                                        template.title ||
                                        ''
                                    ).trim() ||
                                    'Untitled Template',
                                description:
                                    template.description ||
                                    '',
                                status:
                                    normalizedStatus ===
                                        'draft'
                                        ? 'draft'
                                        : 'published',
                                category:
                                    template.category,
                                department:
                                    template.department,
                                programId:
                                    template.programId,
                                createdAt:
                                    template.createdAt,
                                updatedAt:
                                    template.updatedAt,
                                createdBy:
                                    template.createdBy,
                                fields:
                                    normalizeTemplateFields(
                                        template
                                    )
                            }
                        }
                    )

                setSurveyTemplates(rows)
            } catch (error) {
                console.error(
                    'Failed to load survey templates',
                    error
                )
                setSurveyTemplates([])
            }
        }

        if (user?.departmentId) {
            fetchTemplates()
        }
    }, [
        user?.departmentId,
        user?.departmentName,
        rawProgramId,
        activeProgramId,
        isAllPrograms
    ])

    // ─────────────────────────────────────────────────────────────
    // Sent surveys + responses
    //
    // sentForms/{sentFormId}
    // sentForms/{sentFormId}/responses/{participantId}
    // ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!user?.departmentId) {
            setSentSurveys([])
            return
        }

        const constraints = [
            where(
                'department',
                '==',
                user.departmentId
            )
        ]

        if (activeProgramId) {
            constraints.push(
                where(
                    'programId',
                    '==',
                    activeProgramId
                )
            )
        }

        const sentFormsQuery = query(
            collection(db, 'sentForms'),
            ...constraints
        )

        const unsubscribe = onSnapshot(
            sentFormsQuery,
            async snapshot => {
                try {
                    const rows =
                        await Promise.all(
                            snapshot.docs.map(
                                async document => {
                                    const sentForm =
                                    {
                                        id: document.id,
                                        ...(document.data() as any)
                                    }

                                    const responseSnap =
                                        await getDocs(
                                            collection(
                                                db,
                                                'sentForms',
                                                document.id,
                                                'responses'
                                            )
                                        )

                                    const participants =
                                        responseSnap.docs.map(
                                            response => {
                                                const responseData =
                                                    response.data() as any

                                                const participantId =
                                                    String(
                                                        responseData.participantId ||
                                                        response.id
                                                    )

                                                const participantRecord =
                                                    participantsList.find(
                                                        participant =>
                                                            String(participant.id) ===
                                                            participantId
                                                    )

                                                const applicationRecord =
                                                    acceptedApplications.find(
                                                        application =>
                                                            String(
                                                                application.participantId ||
                                                                ''
                                                            ) ===
                                                            participantId &&
                                                            String(
                                                                application.programId ||
                                                                ''
                                                            ) ===
                                                            String(
                                                                sentForm.programId ||
                                                                ''
                                                            )
                                                    )

                                                return {
                                                    id: response.id,
                                                    ...responseData,
                                                    participantId,
                                                    participantName:
                                                        responseData.participantName ||
                                                        participantRecord?.participantName ||
                                                        participantRecord?.fullName ||
                                                        participantRecord?.name ||
                                                        responseData.name ||
                                                        'Participant',
                                                    companyName:
                                                        responseData.companyName ||
                                                        participantRecord?.companyName ||
                                                        participantRecord?.beneficiaryName ||
                                                        participantRecord?.businessName ||
                                                        applicationRecord?.companyName ||
                                                        applicationRecord?.beneficiaryName ||
                                                        applicationRecord?.businessName ||
                                                        'Unnamed Company',
                                                    email:
                                                        responseData.email ||
                                                        participantRecord?.email ||
                                                        participantRecord?.participantEmail ||
                                                        applicationRecord?.email ||
                                                        '',
                                                    group:
                                                        responseData.group ||
                                                        applicationRecord?.gapGroup ||
                                                        participantRecord?.gapGroup ||
                                                        participantRecord?.group ||
                                                        'N/A'
                                                }
                                            }
                                        )

                                    const completed =
                                        participants.filter(
                                            (
                                                participant: any
                                            ) =>
                                                participant.completed ===
                                                true
                                        ).length

                                    return {
                                        id: document.id,
                                        title:
                                            sentForm.title ||
                                            'Untitled Survey',
                                        templateId:
                                            sentForm.templateId,
                                        department:
                                            sentForm.department,
                                        programId:
                                            sentForm.programId,
                                        participants,
                                        completed,
                                        total:
                                            participants.length,
                                        sentAt:
                                            sentForm.sentAt
                                    } as SentSurveyRow
                                }
                            )
                        )

                    setSentSurveys(rows)
                } catch (error) {
                    console.error(
                        'Failed to load sent survey responses',
                        error
                    )
                    setSentSurveys([])
                }
            },
            error => {
                console.error(
                    'Failed to subscribe to sent surveys',
                    error
                )
                setSentSurveys([])
            }
        )

        return () => unsubscribe()
    }, [
        user?.departmentId,
        user?.departmentName,
        rawProgramId,
        activeProgramId,
        isAllPrograms,
        participantsList,
        acceptedApplications
    ])

    // ─────────────────────────────────────────────────────────────
    // Send survey
    // ─────────────────────────────────────────────────────────────
    const closeSendSurveyModal = () => {
        setSendModalOpen(false)
        setSendSurveyStep('template')
        setSelectedSurveyId(null)
        setSelectedParticipantIds([])
        setSendParticipantPage(1)
        setSendTemplatePage(1)
        setParticipantFilters({
            search: '',
            branchId: '',
            gapGroup: ''
        })
    }

    const openSendSurveyModal = (
        templateId?: string
    ) => {
        setSelectedSurveyId(templateId || null)
        setSurveyProgramMeta(null)
        setSelectedParticipantIds([])
        setSendParticipantPage(1)
        setSendTemplatePage(1)
        setParticipantFilters({
            search: '',
            branchId: '',
            gapGroup: ''
        })
        setSendSurveyStep(
            templateId
                ? 'participants'
                : 'template'
        )
        setSendModalOpen(true)
    }

    const selectSendSurveyTemplate = (
        templateId: string
    ) => {
        setSelectedSurveyId(templateId)
        setSurveyProgramMeta(null)
        setSelectedParticipantIds([])
        setSendParticipantPage(1)
        setParticipantFilters({
            search: '',
            branchId: '',
            gapGroup: ''
        })
        setSendSurveyStep('participants')
    }

    const toggleSurveyParticipant = (
        participantId: string
    ) => {
        setSelectedParticipantIds(previous =>
            previous.includes(participantId)
                ? previous.filter(
                    id => id !== participantId
                )
                : [...previous, participantId]
        )
    }

    const handleSendSurvey = async () => {
        const selectedTemplate =
            surveyTemplates.find(
                template =>
                    template.id ===
                    selectedSurveyId
            )

        if (!selectedTemplate) {
            return message.error(
                'Please select a survey'
            )
        }

        if (
            selectedParticipantIds.length === 0
        ) {
            return message.error(
                'Select at least one SME'
            )
        }

        const surveyProgramId =
            activeProgramId ||
            selectedTemplate.programId ||
            null

        if (!surveyProgramId) {
            return message.error(
                'This survey does not have a program assigned.'
            )
        }

        setSendSurveySubmitting(true)

        try {
            const surveyDocRef =
                await addDoc(
                    collection(
                        db,
                        'sentForms'
                    ),
                    {
                        title:
                            selectedTemplate.title,
                        description:
                            selectedTemplate.description ||
                            '',
                        category:
                            selectedTemplate.category ||
                            null,
                        templateId:
                            selectedTemplate.id,
                        department:
                            user?.departmentId ??
                            selectedTemplate.department ??
                            null,
                        programId:
                            surveyProgramId,
                        sentAt:
                            Timestamp.now()
                    }
                )

            const snapshotFields =
                selectedTemplate.fields.map(
                    field => ({
                        ...field,
                        options:
                            Array.isArray(
                                field.options
                            )
                                ? field.options.filter(
                                    Boolean
                                )
                                : undefined
                    })
                )

            const responseQuestions =
                toResponseQuestions(
                    snapshotFields
                )

            await Promise.all(
                selectedParticipantIds.map(
                    participantId => {
                        const participant =
                            participantTableData.find(
                                row =>
                                    row.key ===
                                    participantId
                            )

                        if (!participant) {
                            return Promise.resolve()
                        }

                        return setDoc(
                            doc(
                                db,
                                'sentForms',
                                surveyDocRef.id,
                                'responses',
                                participant.key
                            ),
                            {
                                participantId:
                                    participant.key,
                                participantName:
                                    participant.participantName,
                                companyName:
                                    participant.companyName,
                                email:
                                    participant.email,
                                group:
                                    participant.group,
                                branchId:
                                    participant.branchId ||
                                    null,
                                branchName:
                                    participant.branch ||
                                    null,

                                // Legacy display fallback.
                                name:
                                    participant.participantName,

                                completed:
                                    false,
                                fields:
                                    snapshotFields,
                                questions:
                                    responseQuestions,
                                answers: {}
                            },
                            {
                                merge: true
                            }
                        )
                    }
                )
            )

            message.success(
                'Survey sent successfully'
            )

            closeSendSurveyModal()
        } catch (error) {
            console.error(error)
            message.error(
                'Failed to send survey'
            )
        } finally {
            setSendSurveySubmitting(false)
        }
    }


    // ─────────────────────────────────────────────────────────────
    // Metrics
    // ─────────────────────────────────────────────────────────────
    const sentMetrics = useMemo(() => {
        const totalSent =
            sentSurveys.length

        const totalInvited =
            sentSurveys.reduce(
                (sum, survey) =>
                    sum +
                    (survey.total || 0),
                0
            )

        const totalDone =
            sentSurveys.reduce(
                (sum, survey) =>
                    sum +
                    (survey.completed || 0),
                0
            )

        const completionRate =
            totalInvited > 0
                ? Math.round(
                    (totalDone /
                        totalInvited) *
                    100
                )
                : 0

        return {
            totalSent,
            totalDone,
            totalInvited,
            completionRate
        }
    }, [sentSurveys])

    const templateMetrics = useMemo(() => {
        const publishedTemplates =
            surveyTemplates.filter(
                template =>
                    template.status ===
                    'published'
            ).length

        const draftTemplates =
            surveyTemplates.filter(
                template =>
                    template.status ===
                    'draft'
            ).length

        const totalQuestions =
            surveyTemplates.reduce(
                (sum, template) =>
                    sum +
                    template.fields.filter(
                        field =>
                            field.type !==
                            'heading'
                    ).length,
                0
            )

        const lastUpdated =
            surveyTemplates
                .map(template =>
                    toDate(
                        template.updatedAt
                    )
                )
                .filter(
                    (
                        value
                    ): value is Date =>
                        !!value
                )
                .sort(
                    (a, b) =>
                        b.getTime() -
                        a.getTime()
                )[0] || null

        return {
            publishedTemplates,
            draftTemplates,
            totalQuestions,
            lastUpdated
        }
    }, [surveyTemplates])

    // ─────────────────────────────────────────────────────────────
    // Table filters
    // ─────────────────────────────────────────────────────────────
    const filteredSentSurveys =
        useMemo(() => {
            const search =
                sentSearch
                    .trim()
                    .toLowerCase()

            return sentSurveys.filter(
                survey => {
                    const matchesSearch =
                        !search ||
                        survey.title
                            .toLowerCase()
                            .includes(search)

                    const completed =
                        survey.total > 0 &&
                        survey.completed >=
                        survey.total

                    const matchesStatus =
                        !sentStatus ||
                        (sentStatus ===
                            'completed'
                            ? completed
                            : !completed)

                    return (
                        matchesSearch &&
                        matchesStatus
                    )
                }
            )
        }, [
            sentSurveys,
            sentSearch,
            sentStatus
        ])

    const filteredTemplates =
        useMemo(() => {
            const search =
                templateSearch
                    .trim()
                    .toLowerCase()

            return surveyTemplates.filter(
                template => {
                    const matchesSearch =
                        !search ||
                        template.title
                            .toLowerCase()
                            .includes(search)

                    const matchesStatus =
                        !templateStatus ||
                        template.status ===
                        templateStatus

                    return (
                        matchesSearch &&
                        matchesStatus
                    )
                }
            )
        }, [
            surveyTemplates,
            templateSearch,
            templateStatus
        ])

    // ─────────────────────────────────────────────────────────────
    // Dynamic metrics
    // ─────────────────────────────────────────────────────────────
    const metricItems = useMemo(() => {
        if (mainView === 'sent') {
            return [
                {
                    key: 'sent',
                    title: 'Surveys Sent',
                    value:
                        sentMetrics.totalSent,
                    subtitle:
                        `${sentMetrics.totalInvited} participant${sentMetrics.totalInvited ===
                            1
                            ? ''
                            : 's'
                        } invited`,
                    icon: (
                        <SendOutlined
                            style={{
                                color:
                                    token.colorPrimary
                            }}
                        />
                    ),
                    iconBg:
                        token.colorPrimaryBg
                },
                {
                    key: 'responses',
                    title: 'Responses',
                    value:
                        sentMetrics.totalDone,
                    subtitle:
                        'Completed responses',
                    icon: (
                        <BarChartOutlined
                            style={{
                                color:
                                    token.colorSuccess
                            }}
                        />
                    ),
                    iconBg:
                        token.colorSuccessBg
                },
                {
                    key: 'completion',
                    title: 'Completion Rate',
                    value:
                        `${sentMetrics.completionRate}%`,
                    subtitle:
                        'Across invited participants',
                    icon: (
                        <FileSearchOutlined
                            style={{
                                color:
                                    token.colorWarning
                            }}
                        />
                    ),
                    iconBg:
                        token.colorWarningBg
                }
            ]
        }

        return [
            {
                key: 'published',
                title: 'Published Templates',
                value:
                    templateMetrics.publishedTemplates,
                subtitle:
                    `${templateMetrics.draftTemplates} draft${templateMetrics.draftTemplates ===
                        1
                        ? ''
                        : 's'
                    }`,
                icon: (
                    <TableOutlined
                        style={{
                            color:
                                token.colorPrimary
                        }}
                    />
                ),
                iconBg:
                    token.colorPrimaryBg
            },
            {
                key: 'questions',
                title: 'Total Questions',
                value:
                    templateMetrics.totalQuestions,
                subtitle:
                    'Answerable fields',
                icon: (
                    <BarChartOutlined
                        style={{
                            color:
                                token.colorSuccess
                        }}
                    />
                ),
                iconBg:
                    token.colorSuccessBg
            },
            {
                key: 'updated',
                title: 'Last Updated',
                value:
                    templateMetrics.lastUpdated
                        ? templateMetrics.lastUpdated.toLocaleDateString()
                        : '—',
                subtitle:
                    'Latest visible template',
                icon: (
                    <CalendarOutlined
                        style={{
                            color:
                                token.colorInfo
                        }}
                    />
                ),
                iconBg:
                    token.colorInfoBg
            }
        ]
    }, [
        mainView,
        sentMetrics,
        templateMetrics,
        token
    ])

    // ─────────────────────────────────────────────────────────────
    // Dynamic filter bar
    // ─────────────────────────────────────────────────────────────
    const filterBar = (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                minWidth: 0,
                flexWrap: 'nowrap',
                overflowX: 'auto'
            }}
        >
            {mainView === 'sent' ? (
                <>
                    <Input
                        allowClear
                        prefix={
                            <SearchOutlined />
                        }
                        placeholder='Search by Survey Title'
                        value={sentSearch}
                        onChange={event =>
                            setSentSearch(
                                event.target.value
                            )
                        }
                        style={{
                            width: 300,
                            flex: '0 0 300px'
                        }}
                    />

                    <Select<SentStatusFilter>
                        allowClear
                        placeholder='Filter by Status'
                        value={sentStatus}
                        onChange={value =>
                            setSentStatus(
                                value
                            )
                        }
                        options={[
                            {
                                value: 'completed',
                                label: 'Completed'
                            },
                            {
                                value: 'pending',
                                label: 'Pending'
                            }
                        ]}
                        style={{
                            width: 180,
                            flex: '0 0 180px'
                        }}
                    />
                </>
            ) : (
                <>
                    <Input
                        allowClear
                        prefix={
                            <SearchOutlined />
                        }
                        placeholder='Search by Template Title'
                        value={
                            templateSearch
                        }
                        onChange={event =>
                            setTemplateSearch(
                                event.target.value
                            )
                        }
                        style={{
                            width: 300,
                            flex: '0 0 300px'
                        }}
                    />

                    <Select<TemplateStatusFilter>
                        allowClear
                        placeholder='Filter by Status'
                        value={
                            templateStatus
                        }
                        onChange={value =>
                            setTemplateStatus(
                                value
                            )
                        }
                        options={[
                            {
                                value:
                                    'published',
                                label:
                                    'Published'
                            },
                            {
                                value:
                                    'draft',
                                label: 'Draft'
                            }
                        ]}
                        style={{
                            width: 180,
                            flex: '0 0 180px'
                        }}
                    />
                </>
            )}

            <div
                style={{
                    flex: '1 1 auto',
                    minWidth: 16
                }}
            />

            <Space
                size={8}
                wrap={false}
                style={{
                    flex: '0 0 auto',
                    marginLeft: 'auto'
                }}
            >
                <Segmented<ViewKey>
                    value={mainView}
                    onChange={value =>
                        setMainView(
                            value as ViewKey
                        )
                    }
                    options={[
                        {
                            label: 'Sent',
                            value: 'sent',
                            icon: (
                                <AppstoreOutlined />
                            )
                        },
                        {
                            label: 'Templates',
                            value: 'templates',
                            icon: (
                                <TableOutlined />
                            )
                        }
                    ]}
                />

                {mainView ===
                    'templates' ? (
                    <Button
                        type='primary'
                        shape='round'
                        icon={
                            <PlusOutlined />
                        }
                        onClick={() =>
                            navigate(
                                '/operations/surveys/builder'
                            )
                        }
                    >
                        Create New Survey
                    </Button>
                ) : (
                    <Button
                        type='primary'
                        shape='round'
                        icon={
                            <SendOutlined />
                        }
                        onClick={() =>
                            openSendSurveyModal()
                        }
                    >
                        Send New Survey
                    </Button>
                )}
            </Space>
        </div>
    )

    return (
        <div
            style={{
                padding: 24,
            }}
        >
            <Helmet>
                <title>
                    Departmental Surveys
                </title>
            </Helmet>

            {/* Metrics */}
            <Row
                gutter={[16, 16]}
                style={{
                    marginBottom: 16
                }}
            >
                {metricItems.map(metric => (
                    <Col
                        key={metric.key}
                        xs={24}
                        md={8}
                    >
                        <MotionCard.Metric
                            icon={metric.icon}
                            iconBg={metric.iconBg}
                            title={metric.title}
                            value={metric.value}
                            subtitle={metric.subtitle}
                            wrapperStyle={{
                                minHeight: 78,
                                padding: '12px 4px'
                            }}
                        />
                    </Col>
                ))}
            </Row>

            {/* One shared MotionCard for both tables */}
            <MotionCard
                filterBar={filterBar}
                filterBarProps={{
                    background:
                        token.colorFillAlter,
                    borderColor:
                        token.colorBorderSecondary,
                    borderRadius: 14,
                    boxShadow:
                        'inset 0 1px 4px rgba(0,0,0,0.04)',
                    padding: 12,
                    marginBottom: 14
                }}
            >
                {mainView === 'sent' ? (
                    <Table<SentSurveyRow>
                        rowKey='id'
                        dataSource={
                            filteredSentSurveys
                        }
                        pagination={{
                            position: [
                                'bottomCenter'
                            ],
                            showSizeChanger:
                                false
                        }}
                        columns={[
                            {
                                title: 'Title',
                                dataIndex:
                                    'title'
                            },
                            {
                                title:
                                    'Participants',
                                width: 140,
                                align: 'center',
                                render: (
                                    _,
                                    row
                                ) =>
                                    row.total ||
                                    0
                            },
                            {
                                title:
                                    'Completed',
                                width: 130,
                                align: 'center',
                                render: (
                                    _,
                                    row
                                ) =>
                                    row.completed ||
                                    0
                            },
                            {
                                title:
                                    'Status',
                                width: 120,
                                render: (
                                    _,
                                    row
                                ) => {
                                    const complete =
                                        row.total >
                                        0 &&
                                        row.completed >=
                                        row.total

                                    return complete ? (
                                        <Tag color='green'>
                                            Completed
                                        </Tag>
                                    ) : (
                                        <Tag color='orange'>
                                            Pending
                                        </Tag>
                                    )
                                }
                            },
                            {
                                title:
                                    'Action',
                                width: 110,
                                render: (
                                    _,
                                    row
                                ) => (
                                    <Button
                                        shape='round'
                                        icon={
                                            <EyeOutlined />
                                        }
                                        onClick={() =>
                                            setViewSurvey(
                                                row
                                            )
                                        }
                                    >
                                        View
                                    </Button>
                                )
                            }
                        ]}
                    />
                ) : (
                    <Table<TemplateRow>
                        rowKey='id'
                        dataSource={
                            filteredTemplates
                        }
                        pagination={{
                            position: [
                                'bottomCenter'
                            ],
                            showSizeChanger:
                                false
                        }}
                        columns={[
                            {
                                title: 'Title',
                                dataIndex:
                                    'title'
                            },
                            {
                                title:
                                    'Questions',
                                width: 130,
                                align: 'center',
                                render: (
                                    _,
                                    row
                                ) =>
                                    row.fields.filter(
                                        field =>
                                            field.type !==
                                            'heading'
                                    ).length
                            },
                            {
                                title:
                                    'Status',
                                width: 120,
                                dataIndex:
                                    'status',
                                render: status =>
                                    status ===
                                        'published' ? (
                                        <Tag color='green'>
                                            Published
                                        </Tag>
                                    ) : (
                                        <Tag color='orange'>
                                            Draft
                                        </Tag>
                                    )
                            },
                            {
                                title:
                                    'Updated',
                                width: 130,
                                render: (
                                    _,
                                    row
                                ) => {
                                    const date =
                                        toDate(
                                            row.updatedAt
                                        )

                                    return date
                                        ? date.toLocaleDateString()
                                        : '—'
                                }
                            },
                            {
                                title:
                                    'Actions',
                                width: 220,
                                render: (
                                    _,
                                    row
                                ) => (
                                    <Space size={8}>
                                        <Button
                                            shape='round'
                                            icon={
                                                <EditOutlined />
                                            }
                                            onClick={() =>
                                                navigate(
                                                    `/operations/surveys/builder/${encodeURIComponent(
                                                        row.id
                                                    )}`
                                                )
                                            }
                                        >
                                            Edit
                                        </Button>

                                        <Button
                                            type='primary'
                                            shape='round'
                                            icon={
                                                <SendOutlined />
                                            }
                                            disabled={
                                                row.status !==
                                                'published'
                                            }
                                            onClick={() =>
                                                openSendSurveyModal(
                                                    row.id
                                                )
                                            }
                                        >
                                            Send
                                        </Button>
                                    </Space>
                                )
                            }
                        ]}
                    />
                )}
            </MotionCard>

            {/* Survey responses */}
            <Modal
                open={!!viewSurvey}
                onCancel={() => {
                    setViewSurvey(null)
                    setSelectedParticipant(null)
                    setSurveyParticipantPage(1)
                }}
                footer={null}
                width={820}
                centered
                destroyOnClose
                styles={{
                    body: {
                        paddingTop: 10,
                        overflow: 'hidden'
                    },
                    header: {
                        marginBottom: 0
                    }
                }}
                title={
                    <div
                        style={{
                            paddingRight: 30
                        }}
                    >
                        <Space
                            align='center'
                            size={10}
                        >
                            <div
                                style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 12,
                                    display: 'grid',
                                    placeItems: 'center',
                                    background: token.colorPrimaryBg,
                                    color: token.colorPrimary,
                                    fontSize: 17,
                                    flex: '0 0 auto'
                                }}
                            >
                                <FileTextOutlined />
                            </div>

                            <div
                                style={{
                                    minWidth: 0
                                }}
                            >
                                <Title
                                    level={5}
                                    style={{
                                        margin: 0,
                                        lineHeight: 1.25
                                    }}
                                    ellipsis
                                >
                                    {viewSurvey?.title ||
                                        (selectedParticipant
                                            ? 'Survey Response'
                                            : 'Survey Insights')}
                                </Title>

                                <Text
                                    type='secondary'
                                    style={{
                                        display: 'block',
                                        marginTop: 2,
                                        fontSize: 12
                                    }}
                                >
                                    {selectedParticipant
                                        ? `Viewing ${selectedParticipant.participantName ||
                                        selectedParticipant.name ||
                                        selectedParticipant.fullName ||
                                        selectedParticipant.email ||
                                        'participant'
                                        }'s response`
                                        : 'Review participant completion and open individual responses'}
                                </Text>
                            </div>
                        </Space>
                    </div>
                }
            >
                <AnimatePresence
                    mode='wait'
                    initial={false}
                >
                    {!selectedParticipant ? (
                        <motion.div
                            key='participant-list'
                            initial={{
                                opacity: 0,
                                x: -24
                            }}
                            animate={{
                                opacity: 1,
                                x: 0
                            }}
                            exit={{
                                opacity: 0,
                                x: -30
                            }}
                            transition={{
                                duration: 0.24,
                                ease: 'easeOut'
                            }}
                        >
                            <div
                                style={{
                                    marginBottom: 14,
                                    padding: '13px 15px',
                                    borderRadius: 16,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    background: token.colorFillAlter
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 18,
                                        flexWrap: 'wrap'
                                    }}
                                >
                                    <Space
                                        size={26}
                                        wrap
                                    >
                                        <div>
                                            <Text
                                                type='secondary'
                                                style={{
                                                    display: 'block',
                                                    fontSize: 11
                                                }}
                                            >
                                                Participants
                                            </Text>

                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 20
                                                }}
                                            >
                                                {surveyResponseParticipants.length}
                                            </Text>
                                        </div>

                                        <div>
                                            <Text
                                                type='secondary'
                                                style={{
                                                    display: 'block',
                                                    fontSize: 11
                                                }}
                                            >
                                                Completed
                                            </Text>

                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 20,
                                                    color: token.colorSuccess
                                                }}
                                            >
                                                {completedSurveyResponseCount}
                                            </Text>
                                        </div>

                                        <div>
                                            <Text
                                                type='secondary'
                                                style={{
                                                    display: 'block',
                                                    fontSize: 11
                                                }}
                                            >
                                                Pending
                                            </Text>

                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 20,
                                                    color: token.colorWarning
                                                }}
                                            >
                                                {Math.max(
                                                    0,
                                                    surveyResponseParticipants.length -
                                                    completedSurveyResponseCount
                                                )}
                                            </Text>
                                        </div>
                                    </Space>

                                    <div
                                        style={{
                                            width: 210,
                                            maxWidth: '100%'
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 8,
                                                marginBottom: 5
                                            }}
                                        >
                                            <Text
                                                type='secondary'
                                                style={{
                                                    fontSize: 11
                                                }}
                                            >
                                                Completion
                                            </Text>

                                            <Text
                                                strong
                                                style={{
                                                    fontSize: 12
                                                }}
                                            >
                                                {surveyResponseCompletionRate}%
                                            </Text>
                                        </div>

                                        <Progress
                                            percent={surveyResponseCompletionRate}
                                            showInfo={false}
                                            size='small'
                                            strokeColor={token.colorSuccess}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 10
                                }}
                            >
                                {paginatedSurveyResponseParticipants.map(
                                    (participant: any) => {
                                        const completed =
                                            Boolean(participant.completed)

                                        const participantName =
                                            participant.participantName ||
                                            participant.name ||
                                            participant.fullName ||
                                            participant.email ||
                                            'Participant'

                                        const initials =
                                            participantName
                                                .split(' ')
                                                .filter(Boolean)
                                                .slice(0, 2)
                                                .map((part: string) =>
                                                    part
                                                        .charAt(0)
                                                        .toUpperCase()
                                                )
                                                .join('') || 'P'

                                        const answers =
                                            participant.answers &&
                                                typeof participant.answers === 'object'
                                                ? participant.answers
                                                : {}

                                        const answerCount =
                                            Array.isArray(answers)
                                                ? answers.filter(
                                                    answer =>
                                                        answer !== undefined &&
                                                        answer !== null &&
                                                        answer !== ''
                                                ).length
                                                : Object.keys(answers).filter(key => {
                                                    const answer = answers[key]

                                                    return (
                                                        answer !== undefined &&
                                                        answer !== null &&
                                                        answer !== ''
                                                    )
                                                }).length

                                        return (
                                            <motion.div
                                                key={
                                                    participant.id ||
                                                    participant.participantId ||
                                                    participant.email ||
                                                    participantName
                                                }
                                                layout
                                                whileHover={{
                                                    y: -2
                                                }}
                                                transition={{
                                                    duration: 0.18
                                                }}
                                                style={{
                                                    width: '100%'
                                                }}
                                            >
                                                <div
                                                    className='survey-response-participant-card'
                                                    style={{
                                                        width: '100%',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 14,
                                                        padding: '13px 14px',
                                                        borderRadius: 16,
                                                        border: `1px solid ${completed
                                                            ? token.colorSuccessBorder
                                                            : token.colorBorderSecondary
                                                            }`,
                                                        background:
                                                            token.colorBgContainer,
                                                        boxShadow:
                                                            '0 6px 18px rgba(15,23,42,.045)',
                                                        transition:
                                                            'border-color .2s ease, box-shadow .2s ease, transform .2s ease'
                                                    }}
                                                >
                                                    <Avatar
                                                        size={46}
                                                        style={{
                                                            flex: '0 0 auto',
                                                            background: completed
                                                                ? token.colorSuccessBg
                                                                : token.colorWarningBg,
                                                            color: completed
                                                                ? token.colorSuccess
                                                                : token.colorWarning,
                                                            fontWeight: 700
                                                        }}
                                                    >
                                                        {initials}
                                                    </Avatar>

                                                    <div
                                                        style={{
                                                            minWidth: 0,
                                                            flex: 1
                                                        }}
                                                    >
                                                        <Space
                                                            size={7}
                                                            wrap
                                                            style={{
                                                                marginBottom: 3
                                                            }}
                                                        >
                                                            <Text
                                                                strong
                                                                style={{
                                                                    fontSize: 14
                                                                }}
                                                            >
                                                                {participantName}
                                                            </Text>

                                                            <Tag
                                                                color={
                                                                    completed
                                                                        ? 'success'
                                                                        : 'warning'
                                                                }
                                                                icon={
                                                                    completed ? (
                                                                        <CheckCircleFilled />
                                                                    ) : (
                                                                        <ClockCircleOutlined />
                                                                    )
                                                                }
                                                                style={{
                                                                    margin: 0,
                                                                    borderRadius: 999
                                                                }}
                                                            >
                                                                {completed
                                                                    ? 'Completed'
                                                                    : 'Pending'}
                                                            </Tag>

                                                            {completed && answerCount > 0 ? (
                                                                <Tag
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999
                                                                    }}
                                                                >
                                                                    {answerCount}{' '}
                                                                    answer
                                                                    {answerCount === 1
                                                                        ? ''
                                                                        : 's'}
                                                                </Tag>
                                                            ) : null}
                                                        </Space>

                                                        <Text
                                                            ellipsis
                                                            style={{
                                                                display: 'block',
                                                                fontSize: 13
                                                            }}
                                                        >
                                                            {participant.companyName ||
                                                                'Unnamed Company'}
                                                        </Text>

                                                        <Space
                                                            size={6}
                                                            wrap
                                                            style={{
                                                                marginTop: 2
                                                            }}
                                                        >
                                                            <Text
                                                                type='secondary'
                                                                ellipsis
                                                                style={{
                                                                    fontSize: 12
                                                                }}
                                                            >
                                                                {participant.email ||
                                                                    'No email recorded'}
                                                            </Text>

                                                            <Tag
                                                                color='blue'
                                                                style={{
                                                                    margin: 0,
                                                                    borderRadius: 999
                                                                }}
                                                            >
                                                                Group {participant.group || 'N/A'}
                                                            </Tag>
                                                        </Space>
                                                    </div>

                                                    <Button
                                                        type={
                                                            completed
                                                                ? 'primary'
                                                                : 'default'
                                                        }
                                                        shape='round'
                                                        disabled={!completed}
                                                        icon={
                                                            completed ? (
                                                                <EyeOutlined />
                                                            ) : (
                                                                <ClockCircleOutlined />
                                                            )
                                                        }
                                                        onClick={() =>
                                                            setSelectedParticipant(
                                                                participant
                                                            )
                                                        }
                                                        style={{
                                                            flex: '0 0 auto',
                                                            minWidth: 132
                                                        }}
                                                    >
                                                        {completed
                                                            ? 'View Response'
                                                            : 'Awaiting'}
                                                    </Button>
                                                </div>
                                            </motion.div>
                                        )
                                    }
                                )}
                            </div>

                            {surveyResponseParticipants.length >
                                SURVEY_RESPONSE_PAGE_SIZE ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'center',
                                        marginTop: 18
                                    }}
                                >
                                    <Pagination
                                        current={surveyParticipantPage}
                                        pageSize={SURVEY_RESPONSE_PAGE_SIZE}
                                        total={surveyResponseParticipants.length}
                                        showSizeChanger={false}
                                        onChange={page =>
                                            setSurveyParticipantPage(page)
                                        }
                                    />
                                </div>
                            ) : null}
                        </motion.div>
                    ) : (
                        <motion.div
                            key='survey-response'
                            initial={{
                                opacity: 0,
                                x: 38,
                                scale: 0.99
                            }}
                            animate={{
                                opacity: 1,
                                x: 0,
                                scale: 1
                            }}
                            exit={{
                                opacity: 0,
                                x: 34,
                                scale: 0.99
                            }}
                            transition={{
                                duration: 0.28,
                                ease: 'easeOut'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    marginBottom: 14
                                }}
                            >
                                <Button
                                    shape='circle'
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() =>
                                        setSelectedParticipant(null)
                                    }
                                />

                                <Avatar
                                    size={38}
                                    style={{
                                        background: token.colorSuccessBg,
                                        color: token.colorSuccess,
                                        fontWeight: 700,
                                        flex: '0 0 auto'
                                    }}
                                >
                                    {String(
                                        selectedParticipant.participantName ||
                                        selectedParticipant.name ||
                                        selectedParticipant.fullName ||
                                        selectedParticipant.email ||
                                        'P'
                                    )
                                        .split(' ')
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((part: string) =>
                                            part.charAt(0).toUpperCase()
                                        )
                                        .join('')}
                                </Avatar>

                                <div
                                    style={{
                                        minWidth: 0,
                                        flex: 1
                                    }}
                                >
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            fontSize: 10,
                                            textTransform: 'uppercase',
                                            letterSpacing: '.07em',
                                            fontWeight: 600
                                        }}
                                    >
                                        Participant Response
                                    </Text>

                                    <Title
                                        level={5}
                                        ellipsis
                                        style={{
                                            margin: 0,
                                            marginTop: 1
                                        }}
                                    >
                                        {selectedParticipant.participantName ||
                                            selectedParticipant.name ||
                                            selectedParticipant.fullName ||
                                            selectedParticipant.email ||
                                            'Participant'}
                                    </Title>
                                </div>

                                <Tag
                                    color='success'
                                    icon={<CheckCircleFilled />}
                                    style={{
                                        margin: 0,
                                        borderRadius: 999
                                    }}
                                >
                                    Completed
                                </Tag>
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        'repeat(2, minmax(0, 1fr))',
                                    gap: 10,
                                    marginBottom: 14
                                }}
                                className='survey-response-summary'
                            >
                                <div
                                    style={{
                                        padding: '11px 12px',
                                        borderRadius: 14,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorFillAlter
                                    }}
                                >
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            fontSize: 11
                                        }}
                                    >
                                        Status
                                    </Text>

                                    <Text
                                        strong
                                        style={{
                                            display: 'block',
                                            marginTop: 2,
                                            color: token.colorSuccess
                                        }}
                                    >
                                        Completed
                                    </Text>
                                </div>

                                <div
                                    style={{
                                        padding: '11px 12px',
                                        borderRadius: 14,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorFillAlter
                                    }}
                                >
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            fontSize: 11
                                        }}
                                    >
                                        Answers
                                    </Text>

                                    <Text
                                        strong
                                        style={{
                                            display: 'block',
                                            marginTop: 2
                                        }}
                                    >
                                        {selectedParticipant.answers &&
                                            typeof selectedParticipant.answers ===
                                            'object'
                                            ? Array.isArray(
                                                selectedParticipant.answers
                                            )
                                                ? selectedParticipant.answers.length
                                                : Object.keys(
                                                    selectedParticipant.answers
                                                ).length
                                            : 0}
                                    </Text>
                                </div>
                            </div>

                            <div
                                style={{
                                    borderRadius: 18,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    background: token.colorBgContainer,
                                    padding: 16,
                                    boxShadow:
                                        '0 8px 24px rgba(15,23,42,.04)'
                                }}
                            >
                                <SurveyResponseViewer
                                    questions={
                                        selectedParticipant.questions ||
                                        selectedParticipant.fields ||
                                        []
                                    }
                                    answers={
                                        selectedParticipant.answers ||
                                        {}
                                    }
                                    title={viewSurvey?.title}
                                    showTOC
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <style>{`
                    @media (max-width: 700px) {
                        .survey-response-summary {
                            grid-template-columns: 1fr !important;
                        }

                        .survey-response-participant-card {
                            align-items: flex-start !important;
                            flex-wrap: wrap;
                        }

                        .survey-response-participant-card .ant-btn {
                            width: 100%;
                        }
                    }
                `}</style>
            </Modal>

            {/* Send survey modal */}
            <Modal
                open={sendModalOpen}
                onCancel={closeSendSurveyModal}
                width={860}
                centered
                destroyOnClose
                title={
                    <div
                        style={{
                            paddingRight: 30
                        }}
                    >
                        <Space
                            align='center'
                            size={10}
                        >
                            <div
                                style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 12,
                                    display: 'grid',
                                    placeItems: 'center',
                                    background:
                                        token.colorPrimaryBg,
                                    color:
                                        token.colorPrimary,
                                    fontSize: 17,
                                    flex: '0 0 auto'
                                }}
                            >
                                <SendOutlined />
                            </div>

                            <div
                                style={{
                                    minWidth: 0
                                }}
                            >
                                <Title
                                    level={5}
                                    style={{
                                        margin: 0,
                                        lineHeight: 1.25
                                    }}
                                >
                                    {sendSurveyStep ===
                                        'template'
                                        ? 'Choose Survey Template'
                                        : selectedSurveyTemplate?.title ||
                                        'Select SMEs'}
                                </Title>

                                <Text
                                    type='secondary'
                                    style={{
                                        display: 'block',
                                        marginTop: 2,
                                        fontSize: 12
                                    }}
                                >
                                    {sendSurveyStep ===
                                        'template'
                                        ? 'Select a published survey to continue'
                                        : `${selectedParticipantIds.length} SME${selectedParticipantIds.length === 1
                                            ? ''
                                            : 's'
                                        } selected`}
                                </Text>
                            </div>
                        </Space>
                    </div>
                }
                footer={
                    sendSurveyStep === 'template' ? (
                        <div
                            style={{
                                display: 'flex',
                                width: '100%',
                                gap: 10
                            }}
                        >
                            <Button
                                block
                                shape='round'
                                onClick={
                                    closeSendSurveyModal
                                }
                            >
                                Cancel
                            </Button>

                            <Button
                                block
                                type='primary'
                                shape='round'
                                icon={<PlusOutlined />}
                                onClick={() => {
                                    closeSendSurveyModal()
                                    navigate(
                                        '/operations/surveys/builder'
                                    )
                                }}
                            >
                                Create New Survey
                            </Button>
                        </div>
                    ) : (
                        <div
                            style={{
                                display: 'flex',
                                width: '100%',
                                gap: 10
                            }}
                        >
                            <Button
                                block
                                shape='round'
                                icon={<ArrowLeftOutlined />}
                                disabled={
                                    sendSurveySubmitting
                                }
                                onClick={() =>
                                    setSendSurveyStep(
                                        'template'
                                    )
                                }
                            >
                                Back
                            </Button>

                            <Button
                                block
                                type='primary'
                                shape='round'
                                icon={<SendOutlined />}
                                loading={
                                    sendSurveySubmitting
                                }
                                disabled={
                                    selectedParticipantIds.length ===
                                    0
                                }
                                onClick={
                                    handleSendSurvey
                                }
                            >
                                Send Survey
                            </Button>
                        </div>
                    )
                }
                styles={{
                    body: {
                        paddingTop: 12,
                        overflow: 'hidden'
                    },
                    footer: {
                        marginTop: 18
                    }
                }}
            >
                <AnimatePresence
                    mode='wait'
                    initial={false}
                >
                    {sendSurveyStep === 'template' ? (
                        <motion.div
                            key='send-template-step'
                            initial={{
                                opacity: 0,
                                x: -28
                            }}
                            animate={{
                                opacity: 1,
                                x: 0
                            }}
                            exit={{
                                opacity: 0,
                                x: -30
                            }}
                            transition={{
                                duration: 0.24,
                                ease: 'easeOut'
                            }}
                            style={{
                                width: '100%'
                            }}
                        >
                            {publishedSurveyTemplates.length ? (
                                <>
                                    <div
                                        className='send-survey-template-grid'
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns:
                                                'repeat(2, minmax(0, 1fr))',
                                            gap: 12,
                                            width: '100%'
                                        }}
                                    >
                                        {paginatedSendTemplates.map(
                                            (template, index) => {
                                                const currentPageCount =
                                                    paginatedSendTemplates.length

                                                const isLastItem =
                                                    index ===
                                                    currentPageCount - 1

                                                const shouldSpanFullWidth =
                                                    currentPageCount === 1 ||
                                                    (
                                                        currentPageCount % 2 !==
                                                        0 &&
                                                        isLastItem
                                                    )

                                                const questionCount =
                                                    template.fields.filter(
                                                        field =>
                                                            field.type !==
                                                            'heading'
                                                    ).length

                                                return (
                                                    <motion.button
                                                        key={template.id}
                                                        type='button'
                                                        whileHover={{
                                                            y: -2
                                                        }}
                                                        whileTap={{
                                                            scale: 0.995
                                                        }}
                                                        onClick={() =>
                                                            selectSendSurveyTemplate(
                                                                template.id
                                                            )
                                                        }
                                                        style={{
                                                            appearance:
                                                                'none',
                                                            width: '100%',
                                                            gridColumn:
                                                                shouldSpanFullWidth
                                                                    ? '1 / -1'
                                                                    : undefined,
                                                            minHeight: 150,
                                                            padding: 16,
                                                            textAlign:
                                                                'left',
                                                            borderRadius: 18,
                                                            border: `1px solid ${selectedSurveyId ===
                                                                    template.id
                                                                    ? token.colorPrimary
                                                                    : token.colorBorderSecondary
                                                                }`,
                                                            background:
                                                                selectedSurveyId ===
                                                                    template.id
                                                                    ? token.colorPrimaryBg
                                                                    : token.colorBgContainer,
                                                            boxShadow:
                                                                '0 8px 24px rgba(15,23,42,.045)',
                                                            cursor:
                                                                'pointer',
                                                            color:
                                                                'inherit'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display:
                                                                    'flex',
                                                                alignItems:
                                                                    'flex-start',
                                                                gap: 12
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: 42,
                                                                    height: 42,
                                                                    borderRadius: 13,
                                                                    display:
                                                                        'grid',
                                                                    placeItems:
                                                                        'center',
                                                                    background:
                                                                        token.colorPrimaryBg,
                                                                    color:
                                                                        token.colorPrimary,
                                                                    flex:
                                                                        '0 0 auto',
                                                                    fontSize: 17
                                                                }}
                                                            >
                                                                <FileTextOutlined />
                                                            </div>

                                                            <div
                                                                style={{
                                                                    minWidth: 0,
                                                                    flex: 1
                                                                }}
                                                            >
                                                                <Text
                                                                    strong
                                                                    style={{
                                                                        display:
                                                                            'block',
                                                                        fontSize: 14
                                                                    }}
                                                                >
                                                                    {
                                                                        template.title
                                                                    }
                                                                </Text>

                                                                <Text
                                                                    type='secondary'
                                                                    ellipsis={{
                                                                        tooltip:
                                                                            template.description ||
                                                                            undefined
                                                                    }}
                                                                    style={{
                                                                        display:
                                                                            'block',
                                                                        marginTop: 4,
                                                                        fontSize: 12
                                                                    }}
                                                                >
                                                                    {template.description ||
                                                                        'Published survey template'}
                                                                </Text>
                                                            </div>
                                                        </div>

                                                        <Space
                                                            size={6}
                                                            wrap
                                                            style={{
                                                                marginTop: 16
                                                            }}
                                                        >
                                                            <Tag
                                                                color='green'
                                                                style={{
                                                                    margin: 0,
                                                                    borderRadius: 999
                                                                }}
                                                            >
                                                                Published
                                                            </Tag>

                                                            <Tag
                                                                style={{
                                                                    margin: 0,
                                                                    borderRadius: 999
                                                                }}
                                                            >
                                                                {
                                                                    questionCount
                                                                }{' '}
                                                                question
                                                                {questionCount === 1
                                                                    ? ''
                                                                    : 's'}
                                                            </Tag>

                                                            {template.category ? (
                                                                <Tag
                                                                    color='blue'
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999
                                                                    }}
                                                                >
                                                                    {
                                                                        template.category
                                                                    }
                                                                </Tag>
                                                            ) : null}
                                                        </Space>
                                                    </motion.button>
                                                )
                                            }
                                        )}
                                    </div>

                                    {publishedSurveyTemplates.length >
                                        SEND_SURVEY_TEMPLATE_PAGE_SIZE ? (
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent:
                                                    'center',
                                                marginTop: 18
                                            }}
                                        >
                                            <Pagination
                                                current={
                                                    sendTemplatePage
                                                }
                                                pageSize={
                                                    SEND_SURVEY_TEMPLATE_PAGE_SIZE
                                                }
                                                total={
                                                    publishedSurveyTemplates.length
                                                }
                                                showSizeChanger={
                                                    false
                                                }
                                                onChange={page =>
                                                    setSendTemplatePage(
                                                        page
                                                    )
                                                }
                                            />
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <Empty
                                    image={
                                        Empty.PRESENTED_IMAGE_SIMPLE
                                    }
                                    description='No published survey templates are available.'
                                />
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            key='send-participant-step'
                            initial={{
                                opacity: 0,
                                x: 34
                            }}
                            animate={{
                                opacity: 1,
                                x: 0
                            }}
                            exit={{
                                opacity: 0,
                                x: 32
                            }}
                            transition={{
                                duration: 0.26,
                                ease: 'easeOut'
                            }}
                        >
                            <div
                                style={{
                                    padding: '11px 13px',
                                    marginBottom: 12,
                                    borderRadius: 14,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    background:
                                        token.colorFillAlter,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent:
                                        'space-between',
                                    gap: 12,
                                    flexWrap: 'wrap'
                                }}
                            >
                                <div
                                    style={{
                                        minWidth: 0
                                    }}
                                >
                                    <Text
                                        type='secondary'
                                        style={{
                                            display: 'block',
                                            fontSize: 11
                                        }}
                                    >
                                        Survey
                                    </Text>

                                    <Text strong>
                                        {selectedSurveyTemplate?.title ||
                                            'Selected Survey'}
                                    </Text>
                                </div>

                                <Space size={6} wrap>
                                    {surveyProgramMeta?.name ? (
                                        <Tag
                                            color='blue'
                                            style={{
                                                margin: 0,
                                                borderRadius: 999
                                            }}
                                        >
                                            {surveyProgramMeta.name}
                                        </Tag>
                                    ) : null}

                                    <Tag
                                        color='processing'
                                        style={{
                                            margin: 0,
                                            borderRadius: 999
                                        }}
                                    >
                                        {selectedParticipantIds.length}{' '}
                                        selected
                                    </Tag>
                                </Space>
                            </div>

                            <div
                                className='send-survey-filter-grid'
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        surveyProgramMeta?.isMultiBranch
                                            ? 'repeat(3, minmax(0, 1fr))'
                                            : 'repeat(2, minmax(0, 1fr))',
                                    gap: 10,
                                    width: '100%',
                                    marginBottom: 14
                                }}
                            >
                                <Input
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder='Search name, company or email'
                                    value={
                                        participantFilters.search
                                    }
                                    onChange={event =>
                                        setParticipantFilters(
                                            previous => ({
                                                ...previous,
                                                search:
                                                    event.target.value
                                            })
                                        )
                                    }
                                    style={{
                                        width: '100%'
                                    }}
                                />

                                <Select
                                    allowClear
                                    placeholder='Filter by Group'
                                    value={
                                        participantFilters.gapGroup ||
                                        undefined
                                    }
                                    onChange={value =>
                                        setParticipantFilters(
                                            previous => ({
                                                ...previous,
                                                gapGroup:
                                                    value || ''
                                            })
                                        )
                                    }
                                    options={[
                                        {
                                            value: 'A',
                                            label: 'Group A'
                                        },
                                        {
                                            value: 'B',
                                            label: 'Group B'
                                        },
                                        {
                                            value: 'C',
                                            label: 'Group C'
                                        }
                                    ]}
                                    style={{
                                        width: '100%'
                                    }}
                                />

                                {surveyProgramMeta?.isMultiBranch ? (
                                    <Select
                                        allowClear
                                        placeholder='Filter by Branch'
                                        value={
                                            participantFilters.branchId ||
                                            undefined
                                        }
                                        onChange={value =>
                                            setParticipantFilters(
                                                previous => ({
                                                    ...previous,
                                                    branchId:
                                                        value || ''
                                                })
                                            )
                                        }
                                        options={
                                            surveyBranchOptions
                                        }
                                        style={{
                                            width: '100%'
                                        }}
                                    />
                                ) : null}
                            </div>

                            {paginatedSendParticipants.length ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10
                                    }}
                                >
                                    {paginatedSendParticipants.map(
                                        participant => {
                                            const selected =
                                                selectedParticipantIds.includes(
                                                    participant.key
                                                )

                                            const initials =
                                                participant.participantName
                                                    .split(' ')
                                                    .filter(Boolean)
                                                    .slice(0, 2)
                                                    .map(part =>
                                                        part
                                                            .charAt(0)
                                                            .toUpperCase()
                                                    )
                                                    .join('') || 'SME'

                                            return (
                                                <motion.div
                                                    key={participant.key}
                                                    layout
                                                    whileHover={{
                                                        y: -2
                                                    }}
                                                    transition={{
                                                        duration: 0.18
                                                    }}
                                                >
                                                    <div
                                                        className='send-survey-participant-card'
                                                        role='button'
                                                        tabIndex={0}
                                                        onClick={() =>
                                                            toggleSurveyParticipant(
                                                                participant.key
                                                            )
                                                        }
                                                        onKeyDown={event => {
                                                            if (
                                                                event.key ===
                                                                'Enter' ||
                                                                event.key ===
                                                                ' '
                                                            ) {
                                                                event.preventDefault()
                                                                toggleSurveyParticipant(
                                                                    participant.key
                                                                )
                                                            }
                                                        }}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems:
                                                                'center',
                                                            width: '100%',
                                                            gap: 14,
                                                            padding:
                                                                '13px 14px',
                                                            borderRadius: 16,
                                                            border: `1px solid ${selected
                                                                ? token.colorPrimary
                                                                : token.colorBorderSecondary
                                                                }`,
                                                            background:
                                                                selected
                                                                    ? token.colorPrimaryBg
                                                                    : token.colorBgContainer,
                                                            boxShadow:
                                                                '0 6px 18px rgba(15,23,42,.045)',
                                                            cursor: 'pointer',
                                                            transition:
                                                                'border-color .2s ease, background .2s ease, box-shadow .2s ease'
                                                        }}
                                                    >
                                                        <Avatar
                                                            size={46}
                                                            style={{
                                                                flex:
                                                                    '0 0 auto',
                                                                background:
                                                                    selected
                                                                        ? token.colorPrimaryBgHover
                                                                        : token.colorFillSecondary,
                                                                color:
                                                                    selected
                                                                        ? token.colorPrimary
                                                                        : token.colorTextSecondary,
                                                                fontWeight: 700
                                                            }}
                                                        >
                                                            {initials}
                                                        </Avatar>

                                                        <div
                                                            style={{
                                                                minWidth: 0,
                                                                flex: 1
                                                            }}
                                                        >
                                                            <Space
                                                                size={6}
                                                                wrap
                                                                style={{
                                                                    marginBottom: 3
                                                                }}
                                                            >
                                                                <Text strong>
                                                                    {participant.participantName}
                                                                </Text>

                                                                <Tag
                                                                    color='blue'
                                                                    style={{
                                                                        margin: 0,
                                                                        borderRadius: 999
                                                                    }}
                                                                >
                                                                    Group {participant.group}
                                                                </Tag>

                                                                {surveyProgramMeta?.isMultiBranch &&
                                                                    participant.branch &&
                                                                    participant.branch !==
                                                                    'Unknown' ? (
                                                                    <Tag
                                                                        style={{
                                                                            margin: 0,
                                                                            borderRadius: 999
                                                                        }}
                                                                    >
                                                                        {participant.branch}
                                                                    </Tag>
                                                                ) : null}
                                                            </Space>

                                                            <Text
                                                                style={{
                                                                    display: 'block',
                                                                    fontSize: 13
                                                                }}
                                                                ellipsis
                                                            >
                                                                {participant.companyName}
                                                            </Text>

                                                            <Text
                                                                type='secondary'
                                                                style={{
                                                                    display: 'block',
                                                                    marginTop: 2,
                                                                    fontSize: 12
                                                                }}
                                                                ellipsis
                                                            >
                                                                {participant.email ||
                                                                    'No email recorded'}
                                                            </Text>
                                                        </div>

                                                        <Button
                                                            type={
                                                                selected
                                                                    ? 'primary'
                                                                    : 'default'
                                                            }
                                                            shape='round'
                                                            icon={
                                                                selected ? (
                                                                    <CheckCircleFilled />
                                                                ) : undefined
                                                            }
                                                            onClick={event => {
                                                                event.stopPropagation()
                                                                toggleSurveyParticipant(
                                                                    participant.key
                                                                )
                                                            }}
                                                            style={{
                                                                minWidth: 105,
                                                                flex:
                                                                    '0 0 auto'
                                                            }}
                                                        >
                                                            {selected
                                                                ? 'Selected'
                                                                : 'Select'}
                                                        </Button>
                                                    </div>
                                                </motion.div>
                                            )
                                        }
                                    )}
                                </div>
                            ) : (
                                <Empty
                                    image={
                                        Empty.PRESENTED_IMAGE_SIMPLE
                                    }
                                    description='No SMEs match the current filters.'
                                />
                            )}

                            {participantTableData.length >
                                SEND_SURVEY_PARTICIPANT_PAGE_SIZE ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'center',
                                        marginTop: 18
                                    }}
                                >
                                    <Pagination
                                        current={
                                            sendParticipantPage
                                        }
                                        pageSize={
                                            SEND_SURVEY_PARTICIPANT_PAGE_SIZE
                                        }
                                        total={
                                            participantTableData.length
                                        }
                                        showSizeChanger={false}
                                        onChange={page =>
                                            setSendParticipantPage(
                                                page
                                            )
                                        }
                                    />
                                </div>
                            ) : null}
                        </motion.div>
                    )}
                </AnimatePresence>

                <style>{`
                    @media (max-width: 700px) {
                        .send-survey-template-grid,
                        .send-survey-filter-grid {
                            grid-template-columns: 1fr !important;
                        }

                        .send-survey-participant-card {
                            align-items: flex-start !important;
                            flex-wrap: wrap;
                        }

                        .send-survey-participant-card .ant-btn {
                            width: 100%;
                        }
                    }
                `}</style>
            </Modal>

        </div>
    )
}

export default SurveysDetailsPage
