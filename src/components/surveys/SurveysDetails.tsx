// src/components/surveys/SurveysDetails.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    App,
    Button,
    Divider,
    Form,
    Input,
    Modal,
    Row,
    Col,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    theme
} from 'antd'
import {
    AppstoreOutlined,
    BarChartOutlined,
    CalendarOutlined,
    EditOutlined,
    EyeOutlined,
    FileSearchOutlined,
    PlusOutlined,
    SearchOutlined,
    SendOutlined,
    TableOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import {
    Timestamp,
    addDoc,
    collection,
    doc,
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

    const debugPrefix = '[SurveysDetails]'

    useEffect(() => {
        console.groupCollapsed(`${debugPrefix} Scope`)
        console.log('User', {
            id: user?.id,
            email: user?.email,
            departmentId: user?.departmentId,
            departmentName: user?.departmentName
        })
        console.log('Program scope', {
            rawProgramId,
            activeProgramId,
            isAllPrograms,
            windowActiveProgramId:
                typeof window !== 'undefined'
                    ? (window as any).__ACTIVE_PROGRAM_ID__
                    : undefined
        })
        console.groupEnd()
    }, [
        user?.id,
        user?.email,
        user?.departmentId,
        user?.departmentName,
        rawProgramId,
        activeProgramId,
        isAllPrograms
    ])

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

    const [participantsList, setParticipantsList] =
        useState<any[]>([])

    const [
        selectedParticipantIds,
        setSelectedParticipantIds
    ] = useState<string[]>([])

    const [
        participantTableData,
        setParticipantTableData
    ] = useState<any[]>([])

    const [branchesMap, setBranchesMap] =
        useState<Record<string, string>>({})

    const [
        applicationsMap,
        setApplicationsMap
    ] = useState<Record<string, any>>({})

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

    const [form] = Form.useForm()

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

                console.groupCollapsed(
                    `${debugPrefix} Participants: ${rows.length} loaded`
                )
                console.table(
                    rows.slice(0, 20).map((participant: any) => ({
                        id: participant.id,
                        name:
                            participant.beneficiaryName ||
                            participant.name ||
                            participant.fullName ||
                            '',
                        email: participant.email || ''
                    }))
                )
                console.groupEnd()

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
                        appSnap.docs
                            .map(document => ({
                                id: document.id,
                                ...document.data()
                            }))
                            .filter(
                                (application: any) =>
                                    activeProgramId
                                        ? String(
                                            application.programId ||
                                            ''
                                        ) ===
                                        activeProgramId
                                        : true
                            )

                    const nextApplicationsMap: Record<
                        string,
                        any
                    > = {}

                    applications.forEach(
                        (application: any) => {
                            if (
                                application.participantId
                            ) {
                                nextApplicationsMap[
                                    String(
                                        application.participantId
                                    )
                                ] =
                                    application
                            }
                        }
                    )

                    console.groupCollapsed(
                        `${debugPrefix} Accepted applications`
                    )
                    console.log('Active program filter', {
                        rawProgramId,
                        activeProgramId,
                        isAllPrograms
                    })
                    console.log(
                        'Accepted applications after program filtering:',
                        applications.length
                    )
                    console.table(
                        applications.slice(0, 30).map((application: any) => ({
                            id: application.id,
                            participantId: application.participantId,
                            email: application.email,
                            programId: application.programId,
                            branchId: application.branchId,
                            applicationStatus: application.applicationStatus
                        }))
                    )
                    console.groupEnd()

                    setApplicationsMap(nextApplicationsMap)

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

                    setApplicationsMap({})
                    setBranchesMap({})
                }
            }

        fetchSupportingData()
    }, [activeProgramId])

    useEffect(() => {
        const normalizedSearch =
            participantFilters.search
                .trim()
                .toLowerCase()

        const data = participantsList
            .filter(participant =>
                Boolean(
                    applicationsMap[
                    participant.id
                    ]
                )
            )
            .filter(participant => {
                if (!normalizedSearch) {
                    return true
                }

                return String(
                    participant.beneficiaryName ||
                    participant.name ||
                    participant.fullName ||
                    ''
                )
                    .toLowerCase()
                    .includes(normalizedSearch)
            })
            .filter(participant =>
                participantFilters.branchId
                    ? String(
                        applicationsMap[
                            participant.id
                        ]?.branchId || ''
                    ) ===
                    participantFilters.branchId
                    : true
            )
            .filter(participant =>
                participantFilters.gapGroup
                    ? String(
                        applicationsMap[
                            participant.id
                        ]?.gapGroup || ''
                    ) ===
                    participantFilters.gapGroup
                    : true
            )
            .map(participant => {
                const application =
                    applicationsMap[
                    participant.id
                    ]

                return {
                    key: participant.id,
                    name:
                        participant.beneficiaryName ||
                        participant.name ||
                        participant.fullName ||
                        'Unnamed',
                    branch:
                        branchesMap[
                        application?.branchId
                        ] ||
                        'Unknown',
                    group:
                        application?.gapGroup ||
                        'N/A'
                }
            })

        setParticipantTableData(data)
    }, [
        participantsList,
        applicationsMap,
        branchesMap,
        participantFilters
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

                console.groupCollapsed(
                    `${debugPrefix} Templates: ${rawTemplates.length} raw formTemplates`
                )
                console.log('Current scope', {
                    userDepartmentId: user?.departmentId,
                    userDepartmentName: user?.departmentName,
                    rawProgramId,
                    activeProgramId,
                    isAllPrograms
                })

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

                console.groupEnd()

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

                console.groupCollapsed(
                    `${debugPrefix} Templates: ${rows.length} visible`
                )
                console.table(
                    rows.map(template => ({
                        id: template.id,
                        title: template.title,
                        status: template.status,
                        department: template.department,
                        programId: template.programId,
                        fields: template.fields.length
                    }))
                )
                console.groupEnd()

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

        console.groupCollapsed(`${debugPrefix} Sent survey query`)
        console.log('Query scope', {
            department: user.departmentId,
            rawProgramId,
            activeProgramId,
            isAllPrograms,
            programConstraintApplied: !!activeProgramId
        })
        console.groupEnd()

        const sentFormsQuery = query(
            collection(db, 'sentForms'),
            ...constraints
        )

        const unsubscribe = onSnapshot(
            sentFormsQuery,
            async snapshot => {
                try {
                    console.groupCollapsed(
                        `${debugPrefix} Sent surveys: ${snapshot.size} sentForms matched`
                    )
                    console.table(
                        snapshot.docs.map(document => {
                            const data = document.data() as any
                            return {
                                id: document.id,
                                title: data.title,
                                templateId: data.templateId,
                                department: data.department,
                                programId: data.programId,
                                sentAt: data.sentAt
                            }
                        })
                    )
                    console.groupEnd()

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
                                            response => ({
                                                id: response.id,
                                                ...response.data()
                                            })
                                        )

                                    console.log(
                                        `${debugPrefix} Responses for "${sentForm.title || document.id}"`,
                                        {
                                            sentFormId: document.id,
                                            responseCount: participants.length,
                                            responses: participants.map(
                                                (participant: any) => ({
                                                    id: participant.id,
                                                    participantId:
                                                        participant.participantId,
                                                    name: participant.name,
                                                    completed:
                                                        participant.completed,
                                                    answerShape:
                                                        Array.isArray(
                                                            participant.answers
                                                        )
                                                            ? 'array'
                                                            : typeof participant.answers,
                                                    questionCount:
                                                        Array.isArray(
                                                            participant.questions
                                                        )
                                                            ? participant.questions.length
                                                            : 0,
                                                    fieldCount:
                                                        Array.isArray(
                                                            participant.fields
                                                        )
                                                            ? participant.fields.length
                                                            : 0
                                                })
                                            )
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
        isAllPrograms
    ])

    // ─────────────────────────────────────────────────────────────
    // Send survey
    // ─────────────────────────────────────────────────────────────
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
                'Select at least one participant'
            )
        }

        /*
         * If All Programs is selected, the template itself
         * supplies the program scope. If a specific universal
         * program is selected, that is the authoritative scope.
         */
        const surveyProgramId =
            activeProgramId ||
            selectedTemplate.programId ||
            null

        if (!surveyProgramId) {
            return message.error(
                'This survey does not have a program assigned.'
            )
        }

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
                        const participant: any =
                            participantsList.find(
                                row =>
                                    row.id ===
                                    participantId
                            )

                        if (!participant) {
                            return Promise.resolve()
                        }

                        const participantName =
                            participant.beneficiaryName ??
                            participant.name ??
                            participant.fullName ??
                            'Unnamed'

                        return setDoc(
                            doc(
                                db,
                                'sentForms',
                                surveyDocRef.id,
                                'responses',
                                participant.id
                            ),
                            {
                                participantId:
                                    participant.id,
                                name:
                                    participantName,
                                completed:
                                    false,

                                /*
                                 * Rich builder snapshot.
                                 */
                                fields:
                                    snapshotFields,

                                /*
                                 * Backward-compatible response shape
                                 * for existing response components.
                                 * Unlike the previous conversion, this
                                 * preserves required, placeholder,
                                 * description, name and defaultValue.
                                 */
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

            setSendModalOpen(false)
            setSelectedSurveyId(null)
            setSelectedParticipantIds([])
            form.resetFields()
        } catch (error) {
            console.error(error)
            message.error(
                'Failed to send survey'
            )
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
                            setSendModalOpen(
                                true
                            )
                        }
                    >
                        Send New Survey
                    </Button>
                )}
            </Space>
        </div>
    )

    useEffect(() => {
        console.log(`${debugPrefix} Render state`, {
            mainView,
            sentSurveys: sentSurveys.length,
            filteredSentSurveys: filteredSentSurveys.length,
            surveyTemplates: surveyTemplates.length,
            filteredTemplates: filteredTemplates.length,
            participants: participantsList.length,
            participantTableData: participantTableData.length
        })
    }, [
        mainView,
        sentSurveys.length,
        filteredSentSurveys.length,
        surveyTemplates.length,
        filteredTemplates.length,
        participantsList.length,
        participantTableData.length
    ])

    return (
        <div
            style={{
                padding: 24,
                minHeight: 0
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
                                            onClick={() => {
                                                setSelectedSurveyId(
                                                    row.id
                                                )
                                                setSendModalOpen(
                                                    true
                                                )
                                            }}
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
                    setSelectedParticipant(
                        null
                    )
                }}
                title={
                    selectedParticipant
                        ? viewSurvey?.title ||
                        'Survey Response'
                        : 'Survey Insights'
                }
                footer={null}
                width={800}
                centered
            >
                {!selectedParticipant ? (
                    <Table
                        rowKey='id'
                        dataSource={
                            viewSurvey?.participants ||
                            []
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
                                title:
                                    'Name',
                                dataIndex:
                                    'name'
                            },
                            {
                                title:
                                    'Status',
                                render: (
                                    _,
                                    participant: any
                                ) =>
                                    participant.completed ? (
                                        <Tag color='green'>
                                            Completed
                                        </Tag>
                                    ) : (
                                        <Tag color='orange'>
                                            Pending
                                        </Tag>
                                    )
                            },
                            {
                                title:
                                    'Action',
                                width: 110,
                                render: (
                                    _,
                                    participant: any
                                ) => (
                                    <Button
                                        shape='round'
                                        icon={
                                            <EyeOutlined />
                                        }
                                        onClick={() =>
                                            setSelectedParticipant(
                                                participant
                                            )
                                        }
                                        disabled={
                                            !participant.completed
                                        }
                                    >
                                        View
                                    </Button>
                                )
                            }
                        ]}
                    />
                ) : (
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
                        title={
                            viewSurvey?.title
                        }
                        showTOC
                    />
                )}
            </Modal>

            {/* Send survey modal */}
            <Modal
                open={sendModalOpen}
                onCancel={() => {
                    setSendModalOpen(
                        false
                    )
                    setSelectedSurveyId(
                        null
                    )
                    setSelectedParticipantIds(
                        []
                    )
                    form.resetFields()
                }}
                title='Send Survey'
                okText='Send'
                onOk={
                    handleSendSurvey
                }
                width={800}
                centered
            >
                <Form
                    layout='vertical'
                    form={form}
                >
                    <Form.Item
                        label='Survey Template'
                        required
                    >
                        <Select
                            placeholder='Choose a published template'
                            value={
                                selectedSurveyId ||
                                undefined
                            }
                            onChange={value =>
                                setSelectedSurveyId(
                                    value
                                )
                            }
                            options={surveyTemplates
                                .filter(
                                    template =>
                                        template.status ===
                                        'published'
                                )
                                .map(
                                    template => ({
                                        value:
                                            template.id,
                                        label:
                                            template.title
                                    })
                                )}
                        />
                    </Form.Item>
                </Form>

                <Button
                    type='link'
                    icon={
                        <PlusOutlined />
                    }
                    onClick={() => {
                        navigate(
                            '/operations/surveys/builder'
                        )
                        setSendModalOpen(
                            false
                        )
                    }}
                    style={{
                        paddingInline: 0
                    }}
                >
                    Create New Survey
                </Button>

                <Divider>
                    Select Participants
                </Divider>

                <div
                    style={{
                        display: 'flex',
                        alignItems:
                            'center',
                        gap: 8,
                        flexWrap: 'nowrap',
                        overflowX: 'auto',
                        marginBottom: 12
                    }}
                >
                    <Input
                        allowClear
                        prefix={
                            <SearchOutlined />
                        }
                        placeholder='Search by SMME Name'
                        value={
                            participantFilters.search
                        }
                        onChange={event =>
                            setParticipantFilters(
                                previous => ({
                                    ...previous,
                                    search:
                                        event
                                            .target
                                            .value
                                })
                            )
                        }
                        style={{
                            width: 260,
                            flex: '0 0 260px'
                        }}
                    />

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
                                        value ||
                                        ''
                                })
                            )
                        }
                        options={Object.entries(
                            branchesMap
                        ).map(
                            ([
                                id,
                                name
                            ]) => ({
                                value: id,
                                label: name
                            })
                        )}
                        style={{
                            width: 200,
                            flex: '0 0 200px'
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
                                        value ||
                                        ''
                                })
                            )
                        }
                        options={[
                            {
                                value: 'A',
                                label:
                                    'Group A'
                            },
                            {
                                value: 'B',
                                label:
                                    'Group B'
                            },
                            {
                                value: 'C',
                                label:
                                    'Group C'
                            }
                        ]}
                        style={{
                            width: 180,
                            flex: '0 0 180px'
                        }}
                    />
                </div>

                <Table
                    rowSelection={{
                        selectedRowKeys:
                            selectedParticipantIds,
                        onChange: keys =>
                            setSelectedParticipantIds(
                                keys as string[]
                            )
                    }}
                    rowKey='key'
                    columns={[
                        {
                            title: 'Name',
                            dataIndex: 'name'
                        },
                        {
                            title: 'Branch',
                            dataIndex:
                                'branch'
                        },
                        {
                            title: 'Group',
                            dataIndex:
                                'group'
                        }
                    ]}
                    dataSource={
                        participantTableData
                    }
                    pagination={{
                        position: [
                            'bottomCenter'
                        ],
                        showSizeChanger: false
                    }}
                />
            </Modal>
        </div>
    )
}

export default SurveysDetailsPage
