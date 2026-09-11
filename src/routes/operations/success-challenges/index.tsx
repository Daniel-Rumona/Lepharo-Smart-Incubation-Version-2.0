import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Divider,
    Empty,
    Form,
    Image,
    Input,
    List,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Space,
    Steps,
    Table,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    AppstoreOutlined,
    BarsOutlined,
    CheckCircleOutlined,
    ClearOutlined,
    FilePdfOutlined,
    PictureOutlined,
    PlusOutlined,
    RobotOutlined,
    SearchOutlined,
    TrophyOutlined,
    UploadOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { getAuth } from 'firebase/auth'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Paragraph } = Typography
const { TextArea } = Input

type SmeOption = {
    appId: string
    participantId: string
    companyName: string
    email?: string
    programId?: string
    application?: any
}

type InterventionOption = {
    id: string
    interventionId?: string
    interventionTitle: string
    departmentId?: string
    departmentName?: string
    assigneeId?: string
    assigneeName?: string
    status?: string
    assignmentIds?: string[]
    monthTags?: string[]
    occurrenceCount?: number
    completedAt?: any
}

type Attachment = {
    name: string
    url: string
    path: string
    type: string
    size: number
}

type SuccessStory = {
    id: string
    title?: string
    smeName: string
    interventionTitle?: string
    summary: string
    storyKind?: 'SMME' | 'Event'
    source?: 'SME' | 'Department'
    departmentName?: string
    programId?: string
    coverImageUrl?: string
    background?: string
    lepharoJourney?: string
    achievement?: string
    lepharoRole?: string
    eventBackground?: string
    attendees?: string
    attendeeCount?: number
    eventBenefits?: string
    smeComment?: string
    attachments?: Attachment[]
    createdAt?: any
}

type Challenge = {
    id: string
    title: string
    details: string
    challengeType?: ChallengeType
    smeIds?: string[]
    smeNames?: string[]
    communicationItems?: string[]
    communicationAttempts?: CommunicationAttempt[]
    mitigationSteps?: string[]
    dueDate?: any
    status?: string
    departmentName?: string
    createdAt?: any
}

type ChallengeStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed'
type ChallengeType = 'General' | 'Unresponsive SMEs'
type CommunicationAttempt = {
    channel: string
    attemptedAt?: any
    items?: string[]
    notes: string
}
type PageSegment = 'stories' | 'challenges'

const acceptedStatuses = new Set(['accepted', 'approved', 'onboarded', 'active'])
const challengeStatuses: ChallengeStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed']
const challengeTypes: ChallengeType[] = ['General', 'Unresponsive SMEs']
const communicationItemOptions = [
    'Unconfirmed completion of interventions',
    'Unconfirmed developmental plan',
    'Not accepting interventions',
    'Intervention scheduling',
    'Outstanding documents or information',
    'Other'
]
const communicationChannelOptions = ['Phone call', 'Email', 'WhatsApp', 'SMS', 'In person', 'Other']

const formatDateTime = (value: any) => {
    const date = value?.toDate?.() ? value.toDate() : value
    return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
}

const getCompanyName = (row: any) =>
    String(
        row.companyName ||
        row.registeredName ||
        row.businessName ||
        row.beneficiaryName ||
        row.name ||
        'Unknown SME'
    )

const clean = (value: any) => String(value || '').trim()
const norm = (value: any) => clean(value).toLowerCase().replace(/\s+/g, ' ')
const sameText = (a: any, b: any) => !!clean(a) && !!clean(b) && norm(a) === norm(b)
const isClosedStatus = (value: any) => ['closed', 'resolved'].includes(norm(value))
const isCompletedIntervention = (row: any) => {
    const participantStatus = norm(row?.participantCompletionStatus || row?.beneficiaryCompletionStatus)
    return participantStatus === 'confirmed'
}

const firstText = (...values: any[]) => values.map(clean).find(Boolean) || ''

const getOnboardedDate = (app: any) =>
    dateLikeToDayjs(
        app?.signedAgreements?.['pre-incubation-contract']?.acceptedAt ||
        app?.onboardedAt ||
        app?.acceptedAt ||
        app?.updatedAt ||
        app?.createdAt
    )

const buildStoryPrefill = (sme: SmeOption, participant: any, completedRows: any[]) => {
    const app = sme.application || {}
    const company = sme.companyName
    const sector = firstText(participant?.sector, app?.sector, app?.businessSector, app?.industry)
    const description = firstText(
        participant?.businessDescription,
        participant?.companyDescription,
        participant?.businessOverview,
        participant?.natureOfBusiness,
        app?.businessDescription,
        app?.companyDescription,
        app?.businessOverview,
        app?.natureOfBusiness,
        app?.productsServices,
        app?.description
    )
    const founded = firstText(
        participant?.yearEstablished,
        participant?.yearFounded,
        participant?.foundedYear,
        app?.yearEstablished,
        app?.yearFounded,
        app?.foundedYear,
        app?.registrationDate,
        app?.incorporationDate
    )
    const town = firstText(participant?.town, participant?.city, app?.town, app?.city)
    const province = firstText(participant?.province, app?.province, app?.region)
    const location = [town, province].filter(Boolean).join(', ')

    const backgroundParts = [
        `${company} is${sector ? ` an SMME operating in the ${sector} sector` : ' an SMME'}.`,
        description ? description.replace(/\s+/g, ' ').trim().replace(/([^.!?])$/, '$1.') : '',
        founded ? `The business was established or registered in ${dayjs(founded).isValid() ? dayjs(founded).format('YYYY') : founded}.` : '',
        location ? `It operates from ${location}.` : ''
    ].filter(Boolean)

    const onboardedAt = getOnboardedDate(app)
    const completedTitles = Array.from(new Set(completedRows.map(row => firstText(row.interventionTitle, row.title, row.name)).filter(Boolean)))
    const departmentNames = Array.from(new Set(completedRows.map(row => firstText(row.departmentName, row.department, row.areaOfSupport)).filter(Boolean)))
    const journeyParts = [
        onboardedAt
            ? `${company} joined the Lepharo incubation programme in ${onboardedAt.format('MMMM YYYY')}.`
            : `${company} is participating in the Lepharo incubation programme.`,
        completedTitles.length
            ? `The SMME has completed ${completedTitles.join(', ')}${departmentNames.length ? ` with support from ${departmentNames.join(', ')}` : ''}.`
            : '',
        completedRows.length > 1 ? `A total of ${completedRows.length} completed intervention assignment${completedRows.length === 1 ? '' : 's'} is recorded for the SMME.` : ''
    ].filter(Boolean)

    return { background: backgroundParts.join(' '), lepharoJourney: journeyParts.join(' ') }
}

const requestAiDraft = async (title: string, content: unknown, instruction: string) => {
    const currentUser = getAuth().currentUser
    if (!currentUser) throw new Error('Please sign in again to use AI drafting.')
    const baseUrl = String(import.meta.env.VITE_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-incubation.hf.space').replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/report-writing`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await currentUser.getIdToken()}`
        },
        body: JSON.stringify({
            action: 'improve',
            title,
            sectionTitle: 'Success story',
            contentType: 'narrative',
            content,
            instruction
        })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || 'AI drafting is temporarily unavailable.')
    return clean(data.suggestion)
}

const resolveStoryDepartmentScope = async (user: any) => {
    const departmentId = clean(user?.departmentId)
    let departmentData: any = {}
    if (departmentId) {
        const departmentDoc = await getDoc(doc(db, 'departments', departmentId))
        departmentData = departmentDoc.exists() ? departmentDoc.data() : {}
    }
    const departmentName = firstText(
        departmentData?.name,
        departmentData?.title,
        departmentData?.departmentName,
        user?.departmentName,
        user?.department
    )
    const role = norm(user?.role)
    const isMainDepartment = departmentData?.isMain === true || departmentData?.is_main === true || departmentData?.isPrimary === true || departmentData?.primary === true
    const elevatedRole = ['projectadmin', 'project_admin', 'admin', 'superadmin', 'director', 'projectmanager'].includes(role)
    const canSeeAll = elevatedRole || (role === 'operations' && isMainDepartment)
    const belongsToDepartment = (row: any) => {
        if (canSeeAll) return true
        if (departmentId && clean(row?.departmentId)) return clean(row.departmentId) === departmentId
        return !!departmentName && sameText(row?.departmentName || row?.department || row?.areaOfSupport, departmentName)
    }
    return { departmentId, departmentName, isMainDepartment, canSeeAll, belongsToDepartment }
}

const dateLikeToDayjs = (value: any) => {
    if (!value) return null
    const raw = typeof value?.toDate === 'function'
        ? value.toDate()
        : value?.seconds
            ? new Date(value.seconds * 1000)
            : value
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed : null
}

const getInterventionMonthTag = (row: any) => {
    const dateValue =
        dateLikeToDayjs(row?.cycleMonth) ||
        dateLikeToDayjs(row?.monthKey) ||
        dateLikeToDayjs(row?.periodKey) ||
        dateLikeToDayjs(row?.cycleDate) ||
        dateLikeToDayjs(row?.interventionDate) ||
        dateLikeToDayjs(row?.scheduledDate) ||
        dateLikeToDayjs(row?.dueDate) ||
        dateLikeToDayjs(row?.createdAt)

    if (dateValue) return dateValue.format('MMM YYYY')

    const raw = clean(row?.cycleKey || row?.cycleMonth || row?.monthKey || row?.periodKey)
    return raw && raw.length <= 20 ? raw : ''
}

const uploadFiles = async (files: any[], folder: string): Promise<Attachment[]> => {
    const list = files
        .map(item => item?.originFileObj || item)
        .filter(Boolean) as File[]

    const uploaded = await Promise.all(
        list.map(async file => {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_')
            const path = `${folder}/${Date.now()}_${safeName}`
            const storageRef = ref(storage, path)
            await uploadBytes(storageRef, file)
            const url = await getDownloadURL(storageRef)
            return {
                name: file.name,
                url,
                path,
                type: file.type || 'application/octet-stream',
                size: file.size || 0
            }
        })
    )

    return uploaded
}

const SuccessChallengesPage: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [successForm] = Form.useForm()
    const [challengeForm] = Form.useForm()
    const challengeType = Form.useWatch('challengeType', challengeForm) as ChallengeType | undefined
    const storyKind = Form.useWatch('storyKind', successForm) as 'SMME' | 'Event' | undefined
    const storyFormValues = Form.useWatch([], successForm) || {}

    const [smes, setSmes] = useState<SmeOption[]>([])
    const [challengeSmes, setChallengeSmes] = useState<SmeOption[]>([])
    const [selectedParticipantId, setSelectedParticipantId] = useState<string>()
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [storySourceContext, setStorySourceContext] = useState<{ participant: any; completedRows: any[] } | null>(null)
    const [stories, setStories] = useState<SuccessStory[]>([])
    const [challenges, setChallenges] = useState<Challenge[]>([])
    const [loading, setLoading] = useState(false)
    const [savingStory, setSavingStory] = useState(false)
    const [draftingStory, setDraftingStory] = useState(false)
    const [savingChallenge, setSavingChallenge] = useState(false)
    const [storyModalOpen, setStoryModalOpen] = useState(false)
    const [storyStep, setStoryStep] = useState(0)
    const [storyView, setStoryView] = useState<'cards' | 'table'>('cards')
    const [selectedStory, setSelectedStory] = useState<SuccessStory | null>(null)
    const [challengeModalOpen, setChallengeModalOpen] = useState(false)
    const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null)
    const [segment, setSegment] = useState<PageSegment>('stories')
    const [storySearchText, setStorySearchText] = useState('')
    const [challengeSearchText, setChallengeSearchText] = useState('')
    const [storyKindFilter, setStoryKindFilter] = useState<'all' | 'SMME' | 'Event'>('all')
    const [storySourceFilter, setStorySourceFilter] = useState<'all' | 'SME' | 'Department'>('all')
    const [crossDepartmentStoryView, setCrossDepartmentStoryView] = useState(false)
    const [storyDepartmentLabel, setStoryDepartmentLabel] = useState('My department')
    const [statusFilter, setStatusFilter] = useState<ChallengeStatus | 'all'>('all')
    const [challengeTypeFilter, setChallengeTypeFilter] = useState<ChallengeType | 'all'>('all')

    useEffect(() => {
        const run = async () => {
            if (!user) return
            setLoading(true)
            try {
                const scope = await resolveStoryDepartmentScope(user)
                setCrossDepartmentStoryView(scope.canSeeAll)
                setStoryDepartmentLabel(scope.departmentName || 'My department')
                const deptId = scope.departmentId
                const deptName = scope.departmentName
                const assignedConstraints: any[] = []
                if (!isAllPrograms && activeProgramId) {
                    assignedConstraints.push(where('programId', '==', activeProgramId))
                }

                const assignedSnap = await getDocs(query(collection(db, 'assignedInterventions'), ...assignedConstraints))
                const departmentAssignments = assignedSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(scope.belongsToDepartment)
                    .filter(isCompletedIntervention)

                const assignedParticipantIds = new Set(
                    departmentAssignments
                        .map(row => clean(row.participantId))
                        .filter(Boolean)
                )

                const appConstraints: any[] = []
                if (!isAllPrograms && activeProgramId) {
                    appConstraints.push(where('programId', '==', activeProgramId))
                }

                const appsSnap = await getDocs(query(collection(db, 'applications'), ...appConstraints))
                const acceptedSmeRows = appsSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(app => {
                        const status = String(app.applicationStatus || app.status || '').toLowerCase()
                        return !status || acceptedStatuses.has(status)
                    })
                    .map(app => ({
                        appId: app.id,
                        participantId: String(app.participantId || app.id),
                        companyName: getCompanyName(app),
                        email: app.email || app.applicantEmail,
                        programId: app.programId,
                        application: app
                    }))
                    .sort((a, b) => a.companyName.localeCompare(b.companyName))
                const acceptedSmes = Array.from(
                    new Map(acceptedSmeRows.map(app => [app.participantId, app])).values()
                )

                const rows = acceptedSmes.filter(app => assignedParticipantIds.has(app.participantId))

                setSmes(rows)
                setChallengeSmes(acceptedSmes)

                const storySnap = await getDocs(collection(db, 'successStories'))
                const storyRows = storySnap.docs
                    .map(d => ({ id: `department-${d.id}`, source: 'Department', ...(d.data() as any) })) as SuccessStory[]
                const smeStorySnap = await getDocs(collection(db, 'smeFeedback'))
                const smeStoryRows = smeStorySnap.docs
                    .map(d => ({ id: `sme-${d.id}`, ...(d.data() as any) }))
                    .filter((row: any) => row.type === 'success_story')
                    .map((row: any) => ({
                        ...row,
                        source: 'SME' as const,
                        storyKind: row.storyKind || 'SMME',
                        summary: row.summary || row.message || '',
                        attachments: row.attachments || []
                    })) as SuccessStory[]
                setStories(
                    [...storyRows, ...smeStoryRows]
                        .filter((row: any) => isAllPrograms || !activeProgramId || !clean(row.programId) || clean(row.programId) === clean(activeProgramId))
                        .filter(scope.belongsToDepartment)
                        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
                )

                const challengeSnap = await getDocs(collection(db, 'operationalChallenges'))
                const challengeRows = challengeSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) })) as Challenge[]
                setChallenges(
                    challengeRows
                        .filter((row: any) => {
                            if (!isAllPrograms && activeProgramId && clean(row.programId) && clean(row.programId) !== clean(activeProgramId)) return false
                            if (deptId && clean(row.departmentId)) return clean(row.departmentId) === deptId
                            return !deptName || sameText(row.departmentName, deptName)
                        })
                        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
                )
            } catch (error) {
                console.error(error)
                message.error('Failed to load success stories and challenges.')
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [activeProgramId, isAllPrograms, user])

    useEffect(() => {
        const run = async () => {
            if (!user || !selectedParticipantId) {
                setInterventions([])
                setStorySourceContext(null)
                return
            }

            try {
                const scope = await resolveStoryDepartmentScope(user)
                const snap = await getDocs(
                    query(
                        collection(db, 'assignedInterventions'),
                        where('participantId', '==', selectedParticipantId)
                    )
                )
                const allCompletedRows = snap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .filter(row => isAllPrograms || !activeProgramId || !clean(row.programId) || clean(row.programId) === clean(activeProgramId))
                    .filter(isCompletedIntervention)
                const scopedCompletedRows = allCompletedRows.filter(scope.belongsToDepartment)
                const rows = scopedCompletedRows
                    .map(row => ({
                        ...row,
                        interventionTitle: String(row.interventionTitle || row.title || row.name || 'Untitled intervention'),
                        departmentName: row.departmentName || row.department || row.areaOfSupport
                    }))
                    .sort((a, b) => a.interventionTitle.localeCompare(b.interventionTitle))

                const grouped = new Map<string, InterventionOption>()
                rows.forEach(row => {
                    const logicalId = clean(row.interventionId || row.interventionKey || row.interventionTitle || row.title || row.name || row.id)
                    const key = logicalId || row.id
                    const monthTag = getInterventionMonthTag(row)
                    const existing = grouped.get(key)

                    if (existing) {
                        existing.assignmentIds = [...(existing.assignmentIds || []), row.id]
                        existing.occurrenceCount = (existing.occurrenceCount || 1) + 1
                        if (monthTag && !existing.monthTags?.includes(monthTag)) {
                            existing.monthTags = [...(existing.monthTags || []), monthTag]
                        }
                        return
                    }

                    grouped.set(key, {
                        id: key,
                        interventionId: row.interventionId || row.interventionKey || null,
                        interventionTitle: row.interventionTitle,
                        departmentId: row.departmentId,
                        departmentName: row.departmentName,
                        assigneeId: row.assigneeId,
                        assigneeName: row.assigneeName,
                        status: row.assignmentStatus,
                        completedAt: row.completedAt || row.updatedAt || row.createdAt,
                        assignmentIds: [row.id],
                        monthTags: monthTag ? [monthTag] : [],
                        occurrenceCount: 1
                    })
                })

                setInterventions(Array.from(grouped.values()))

                const selected = smes.find(item => item.participantId === selectedParticipantId)
                const participantDoc = await getDoc(doc(db, 'participants', selectedParticipantId))
                let participant = participantDoc.exists() ? participantDoc.data() : {}
                if (!participantDoc.exists() && selected?.email) {
                    const participantByEmail = await getDocs(
                        query(collection(db, 'participants'), where('email', '==', selected.email))
                    )
                    participant = participantByEmail.docs[0]?.data() || {}
                }
                setStorySourceContext({ participant, completedRows: scopedCompletedRows })
                if (selected) {
                    const draft = buildStoryPrefill(selected, participant, scopedCompletedRows)
                    successForm.setFieldsValue(draft)
                }
            } catch (error) {
                console.error(error)
                message.error('Failed to load interventions for this SME.')
            }
        }
        run()
    }, [activeProgramId, isAllPrograms, selectedParticipantId, smes, successForm, user])

    const selectedSme = useMemo(
        () => smes.find(item => item.participantId === selectedParticipantId),
        [selectedParticipantId, smes]
    )

    const handleAiStoryDraft = async () => {
        if (!selectedSme || !storySourceContext) return
        const current = successForm.getFieldsValue(['background', 'lepharoJourney'])
        setDraftingStory(true)
        try {
            const verifiedContext = {
                companyName: selectedSme.companyName,
                currentBackgroundDraft: current.background,
                currentJourneyDraft: current.lepharoJourney,
                onboardedAt: getOnboardedDate(selectedSme.application)?.format('MMMM YYYY') || '',
                completedInterventions: storySourceContext.completedRows.map(row => ({
                    title: firstText(row.interventionTitle, row.title, row.name),
                    department: firstText(row.departmentName, row.department, row.areaOfSupport),
                    completedAt: formatDateTime(row.completedAt || row.updatedAt || row.createdAt)
                }))
            }
            const [background, lepharoJourney] = await Promise.all([
                requestAiDraft(
                    'SMME background',
                    verifiedContext,
                    'Draft one factual paragraph describing the SMME, what it does, how long it has operated and its location. Use only supplied facts. Omit unavailable facts and do not invent achievements.'
                ),
                requestAiDraft(
                    crossDepartmentStoryView ? 'Journey with Lepharo' : `${storyDepartmentLabel} support journey`,
                    verifiedContext,
                    crossDepartmentStoryView
                        ? 'Draft one factual paragraph covering onboarding and the supplied completed Lepharo interventions. Use only supplied facts. Do not invent dates, support or outcomes.'
                        : `Draft one factual paragraph explaining how ${storyDepartmentLabel} supported the SMME through only the supplied SME-confirmed interventions. Do not mention services from other departments and do not invent dates, support or outcomes.`
                )
            ])
            Modal.confirm({
                title: 'Review AI-prepared draft',
                width: 720,
                okText: 'Apply to story',
                cancelText: 'Keep current draft',
                content: (
                    <Space direction='vertical' size={14} style={{ width: '100%' }}>
                        <Alert showIcon type='warning' message='AI may make mistakes. Confirm every statement against the source records before saving.' />
                        <div><strong>SMME background</strong><Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{background}</Paragraph></div>
                        <div><strong>{crossDepartmentStoryView ? 'Journey with Lepharo' : `How ${storyDepartmentLabel} supported the SMME`}</strong><Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{lepharoJourney}</Paragraph></div>
                    </Space>
                ),
                onOk: () => successForm.setFieldsValue({ background, lepharoJourney })
            })
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Unable to prepare the AI draft.')
        } finally {
            setDraftingStory(false)
        }
    }

    const handleStorySubmit = async (values: any) => {
        const isEvent = values.storyKind === 'Event'
        if (!user || (!isEvent && !selectedSme)) return
        setSavingStory(true)
        try {
            const intervention = interventions.find(item => item.id === values.interventionId)
            const docRef = await addDoc(collection(db, 'successStories'), {
                programId: selectedSme?.programId || activeProgramId || null,
                applicationId: selectedSme?.appId || null,
                participantId: selectedSme?.participantId || null,
                smeName: selectedSme?.companyName || 'Lepharo event',
                smeEmail: selectedSme?.email || null,
                storyKind: values.storyKind || 'SMME',
                source: 'Department',
                title: values.title,
                interventionAssignmentId: null,
                interventionAssignmentIds: intervention?.assignmentIds || [],
                interventionId: intervention?.interventionId || null,
                interventionTitle: intervention?.interventionTitle || null,
                interventionOccurrenceCount: intervention?.occurrenceCount || 1,
                interventionMonthTags: intervention?.monthTags || [],
                departmentId: intervention?.departmentId || null,
                departmentName: intervention?.departmentName || null,
                assigneeId: intervention?.assigneeId || null,
                assigneeName: intervention?.assigneeName || null,
                background: values.background || '',
                lepharoJourney: values.lepharoJourney || '',
                achievement: values.achievement || '',
                lepharoRole: values.lepharoRole || '',
                eventBackground: values.eventBackground || '',
                attendees: values.attendees || '',
                attendeeCount: values.attendeeCount ? Number(values.attendeeCount) : null,
                eventBenefits: values.eventBenefits || '',
                summary: values.storyKind === 'Event' ? values.eventBenefits : values.achievement,
                smeComment: values.smeComment || '',
                attachments: [],
                createdById: user.id || user.uid || null,
                createdByName: user.name || user.email || null,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            })

            const coverAttachments = await uploadFiles(values.coverImage || [], `success-stories/${docRef.id}/cover`)
            const evidenceAttachments = await uploadFiles(values.documents || [], `success-stories/${docRef.id}/evidence`)
            const attachments = [...coverAttachments, ...evidenceAttachments]
            const coverImageUrl = coverAttachments[0]?.url || ''
            if (attachments.length) {
                await updateDoc(doc(db, 'successStories', docRef.id), {
                    attachments,
                    coverImageUrl,
                    updatedAt: Timestamp.now()
                })
            }
            if (attachments.length) {
                await addDoc(collection(db, 'successStoryAttachments'), {
                    storyId: docRef.id,
                    attachments,
                    createdAt: Timestamp.now()
                })
            }

            const record = {
                id: docRef.id,
                title: values.title,
                smeName: selectedSme?.companyName || 'Lepharo event',
                interventionTitle: intervention?.interventionTitle || '',
                storyKind: values.storyKind || 'SMME',
                source: 'Department' as const,
                departmentName: intervention?.departmentName || '',
                programId: selectedSme?.programId || activeProgramId || undefined,
                coverImageUrl,
                background: values.background || '',
                lepharoJourney: values.lepharoJourney || '',
                achievement: values.achievement || '',
                lepharoRole: values.lepharoRole || '',
                eventBackground: values.eventBackground || '',
                attendees: values.attendees || '',
                attendeeCount: values.attendeeCount ? Number(values.attendeeCount) : undefined,
                eventBenefits: values.eventBenefits || '',
                summary: values.storyKind === 'Event' ? values.eventBenefits : values.achievement,
                smeComment: values.smeComment || '',
                attachments,
                createdAt: Timestamp.now()
            }
            setStories(prev => [record, ...prev])
            successForm.resetFields()
            setSelectedParticipantId(undefined)
            setInterventions([])
            setStoryModalOpen(false)
            message.success('Success story captured.')
        } catch (error) {
            console.error(error)
            message.error('Failed to save success story.')
        } finally {
            setSavingStory(false)
        }
    }

    const handleChallengeSubmit = async (values: any) => {
        if (!user) return
        setSavingChallenge(true)
        try {
            const isUnresponsive = values.challengeType === 'Unresponsive SMEs'
            const mitigationSteps = (values.mitigationSteps || [])
                .map((step: any) => String(step?.text || '').trim())
                .filter(Boolean)
            const selectedSmes = isUnresponsive
                ? challengeSmes.filter(sme => (values.smeIds || []).includes(sme.participantId))
                : []
            const communicationAttempts = isUnresponsive
                ? (values.communicationAttempts || []).map((attempt: any) => ({
                    channel: clean(attempt.channel),
                    attemptedAt: attempt.attemptedAt ? Timestamp.fromDate(attempt.attemptedAt.toDate()) : null,
                    items: attempt.items || [],
                    notes: clean(attempt.notes)
                }))
                : []
            const communicationItems = Array.from(new Set(
                communicationAttempts.flatMap((attempt: CommunicationAttempt) => attempt.items || [])
            ))

            const payload = {
                programId: activeProgramId || null,
                departmentId: user.departmentId || null,
                departmentName: user.departmentName || (user as any)?.department || null,
                challengeType: (values.challengeType || 'General') as ChallengeType,
                title: isUnresponsive ? 'Unresponsive SMEs' : values.title,
                details: values.details,
                smeIds: selectedSmes.map(sme => sme.participantId),
                smeNames: selectedSmes.map(sme => sme.companyName),
                communicationItems,
                communicationAttempts,
                mitigationSteps,
                dueDate: values.dueDate ? Timestamp.fromDate(values.dueDate.toDate()) : null,
                status: values.status || 'Open',
                updatedAt: Timestamp.now()
            }

            if (editingChallenge) {
                await updateDoc(doc(db, 'operationalChallenges', editingChallenge.id), {
                    ...payload,
                    updatedById: user.id || user.uid || null,
                    updatedByName: user.name || user.email || null
                })
                setChallenges(prev => prev.map(item => item.id === editingChallenge.id ? { ...item, ...payload } : item))
                message.success('Challenge updated.')
            } else {
                const createPayload = {
                    ...payload,
                    createdById: user.id || user.uid || null,
                    createdByName: user.name || user.email || null,
                    createdAt: Timestamp.now()
                }
                const docRef = await addDoc(collection(db, 'operationalChallenges'), createPayload)
                setChallenges(prev => [{ id: docRef.id, ...createPayload }, ...prev])
                message.success('Challenge captured.')
            }

            challengeForm.resetFields()
            setChallengeModalOpen(false)
            setEditingChallenge(null)
        } catch (error) {
            console.error(error)
            message.error('Failed to save challenge.')
        } finally {
            setSavingChallenge(false)
        }
    }

    const openChallengeModal = (record?: Challenge) => {
        setEditingChallenge(record || null)
        setChallengeModalOpen(true)
        if (record) {
            challengeForm.setFieldsValue({
                challengeType: record.challengeType || 'General',
                title: record.title,
                details: record.details,
                smeIds: record.smeIds || [],
                communicationItems: record.communicationItems || [],
                communicationAttempts: record.communicationAttempts?.length
                    ? record.communicationAttempts.map(attempt => ({
                        ...attempt,
                        items: attempt.items?.length ? attempt.items : (record.communicationItems || []),
                        attemptedAt: dateLikeToDayjs(attempt.attemptedAt)
                    }))
                    : [{ channel: undefined, attemptedAt: dayjs(), items: [], notes: '' }],
                mitigationSteps: record.mitigationSteps?.length
                    ? record.mitigationSteps.map(text => ({ text }))
                    : [{ text: '' }],
                dueDate: record.dueDate?.toDate?.() ? dayjs(record.dueDate.toDate()) : null,
                status: record.status || 'Open'
            })
        } else {
            challengeForm.resetFields()
            challengeForm.setFieldsValue({
                challengeType: 'General',
                mitigationSteps: [{ text: '' }],
                communicationAttempts: [{ channel: undefined, attemptedAt: dayjs(), items: [], notes: '' }],
                status: 'Open'
            })
        }
    }

    const closeStoryModal = () => {
        setStoryModalOpen(false)
        setStoryStep(0)
        successForm.resetFields()
        setSelectedParticipantId(undefined)
        setInterventions([])
        setStorySourceContext(null)
    }

    const closeChallengeModal = () => {
        setChallengeModalOpen(false)
        setEditingChallenge(null)
        challengeForm.resetFields()
    }

    const storyColumns: ColumnsType<SuccessStory> = [
        {
            title: 'Story',
            render: (_, record) => (
                <Space direction='vertical' size={2}>
                    <strong>{record.title || record.smeName || 'Success story'}</strong>
                    <Space size={4} wrap>
                        <Tag color={record.storyKind === 'Event' ? 'purple' : 'blue'}>{record.storyKind || 'SMME'}</Tag>
                        <Tag color={record.source === 'SME' ? 'cyan' : 'gold'}>{record.source || 'Department'} submitted</Tag>
                    </Space>
                </Space>
            )
        },
        { title: 'SMME / Event', dataIndex: 'smeName' },
        { title: 'Intervention', dataIndex: 'interventionTitle', render: value => value || '-' },
        {
            title: 'Documents',
            render: (_, record) => {
                const count = record.attachments?.length || 0
                return count ? <Tag icon={<FilePdfOutlined />}>{count}</Tag> : <Tag>None</Tag>
            }
        },
        { title: 'Captured', dataIndex: 'createdAt', render: formatDateTime }
    ]

    const storyDetails = (record: SuccessStory) => {
        const sections = record.storyKind === 'Event'
            ? [
                ['Event background', record.eventBackground || record.background],
                ['Attendees', record.attendees],
                ['Attendance', record.attendeeCount ? `${record.attendeeCount} attendees` : ''],
                ['Benefits and long-term outcomes', record.eventBenefits || record.summary]
            ]
            : [
                ['SMME background', record.background],
                [crossDepartmentStoryView ? 'Journey with Lepharo' : `How ${storyDepartmentLabel} supported the SMME`, record.lepharoJourney],
                ['Achievement', record.achievement || record.summary],
                ["Lepharo's contribution", record.lepharoRole],
                ['SMME comment / testimonial', record.smeComment]
            ]
        return (
            <Space direction='vertical' size={14} style={{ width: '100%' }}>
                {sections.filter(([, value]) => clean(value)).map(([label, value]) => (
                    <div key={label}>
                        <strong>{label}</strong>
                        <Paragraph style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{value}</Paragraph>
                    </div>
                ))}
                {!!record.attachments?.length && (
                    <div>
                        <strong>Evidence and pictures</strong>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                            {record.attachments.map(file => file.type?.startsWith('image/') ? (
                                <Image key={file.url} src={file.url} alt={file.name} width={120} height={90} style={{ objectFit: 'cover', borderRadius: 8 }} />
                            ) : (
                                <Button key={file.url} href={file.url} target='_blank' icon={<FilePdfOutlined />}>{file.name}</Button>
                            ))}
                        </div>
                    </div>
                )}
            </Space>
        )
    }

    const challengeColumns: ColumnsType<Challenge> = [
        {
            title: 'Challenge',
            dataIndex: 'title',
            render: (value, record) => (
                <Space direction='vertical' size={2}>
                    <span>{value}</span>
                    {record.challengeType === 'Unresponsive SMEs' && <Tag color='volcano'>Unresponsive SMEs</Tag>}
                </Space>
            )
        },
        {
            title: 'SMEs',
            render: (_, record) => record.smeNames?.length ? record.smeNames.join(', ') : '-'
        },
        {
            title: 'Mitigation Steps',
            render: (_, record) => record.mitigationSteps?.length || 0
        },
        { title: 'Due Date', dataIndex: 'dueDate', render: (value: any) => value?.toDate?.() ? dayjs(value.toDate()).format('YYYY-MM-DD') : '-' },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (value: ChallengeStatus) => <Tag color={isClosedStatus(value) ? 'green' : value === 'In Progress' ? 'blue' : 'gold'}>{value || 'Open'}</Tag>
        },
        {
            title: 'Action',
            render: (_, record) => (
                <Button size='small' onClick={() => openChallengeModal(record)}>
                    Update
                </Button>
            )
        }
    ]

    const openChallenges = challenges.filter(item => !isClosedStatus(item.status)).length
    const closedChallenges = challenges.filter(item => isClosedStatus(item.status)).length
    const totalChallenges = challenges.length
    const openPercent = totalChallenges ? Math.round((openChallenges / totalChallenges) * 100) : 0

    const filteredStories = useMemo(() => {
        const q = norm(storySearchText)
        return stories.filter(row => {
            if (storyKindFilter !== 'all' && (row.storyKind || 'SMME') !== storyKindFilter) return false
            if (storySourceFilter !== 'all' && (row.source || 'Department') !== storySourceFilter) return false
            if (!q) return true
            return norm(row.smeName).includes(q) ||
                norm(row.interventionTitle).includes(q) ||
                norm(row.title).includes(q) ||
                norm(row.departmentName).includes(q) ||
                norm(row.summary).includes(q) ||
                norm(row.smeComment).includes(q)
        })
    }, [stories, storyKindFilter, storySearchText, storySourceFilter])

    const filteredChallenges = useMemo(() => {
        const q = norm(challengeSearchText)
        return challenges.filter(row => {
            if (statusFilter !== 'all' && clean(row.status || 'Open') !== statusFilter) return false
            if (challengeTypeFilter !== 'all' && (row.challengeType || 'General') !== challengeTypeFilter) return false
            if (!q) return true
            return (
                norm(row.title).includes(q) ||
                norm(row.details).includes(q) ||
                (row.smeNames || []).some(name => norm(name).includes(q)) ||
                (row.communicationItems || []).some(item => norm(item).includes(q)) ||
                (row.communicationAttempts || []).some(attempt => norm(`${attempt.channel} ${attempt.notes}`).includes(q)) ||
                (row.mitigationSteps || []).some(step => norm(step).includes(q))
            )
        })
    }, [challengeSearchText, challenges, challengeTypeFilter, statusFilter])

    const resetStoryFilters = () => {
        setStorySearchText('')
        setStoryKindFilter('all')
        setStorySourceFilter('all')
    }

    const resetChallengeFilters = () => {
        setChallengeSearchText('')
        setStatusFilter('all')
        setChallengeTypeFilter('all')
    }



    const challengeStatusData = [
        { name: 'Open', y: challenges.filter(item => clean(item.status || 'Open') === 'Open').length, color: '#fa8c16' },
        { name: 'In Progress', y: challenges.filter(item => clean(item.status) === 'In Progress').length, color: '#1677ff' },
        { name: 'Resolved', y: challenges.filter(item => clean(item.status) === 'Resolved').length, color: '#52c41a' },
        { name: 'Closed', y: challenges.filter(item => clean(item.status) === 'Closed').length, color: '#8c8c8c' }
    ].filter(item => item.y > 0)

    const challengeStatusOptions: Highcharts.Options = {
        chart: {
            type: 'pie',
            height: 320,
            backgroundColor: 'transparent'
        },
        title: {
            text: `${totalChallenges}`,
            align: 'center',
            verticalAlign: 'middle',
            y: 8,
            style: { fontSize: '28px', fontWeight: '700' }
        },
        subtitle: {
            text: 'Total',
            align: 'center',
            verticalAlign: 'middle',
            y: 32,
            style: { color: 'rgba(0,0,0,.45)' }
        },
        credits: { enabled: false },
        tooltip: {
            pointFormat: '<b>{point.y}</b> challenges'
        },
        plotOptions: {
            pie: {
                innerSize: '62%',
                size: '72%',
                allowPointSelect: false,
                cursor: 'default',
                dataLabels: {
                    enabled: true,
                    distance: 28,
                    connectorWidth: 1,
                    connectorColor: '#8c8c8c',
                    formatter: function (this: any) {
                        return `<span style="font-weight:600">${this.point.name}</span><br/><span>${this.point.y}</span>`
                    },
                    style: {
                        color: '#1f2937',
                        fontSize: '12px',
                        textOutline: 'none'
                    }
                },
                showInLegend: false
            }
        },
        series: [
            {
                type: 'pie',
                name: 'Challenges',
                data: challengeStatusData
            }
        ]
    }

    const storyCover = (record: SuccessStory) =>
        record.coverImageUrl || record.attachments?.find(file => file.type?.startsWith('image/'))?.url || ''
    const requiredStoryFields = storyKind === 'Event'
        ? ['storyKind', 'title', 'eventBackground', 'attendees', 'attendeeCount', 'eventBenefits', 'coverImage']
        : ['storyKind', 'title', 'participantId', 'interventionId', 'background', 'lepharoJourney', 'achievement', 'lepharoRole', 'coverImage']
    const completedStoryFields = requiredStoryFields.filter(field => {
        const value = storyFormValues[field]
        return Array.isArray(value) ? value.length > 0 : !!clean(value)
    }).length
    const storyCompletionPercent = Math.round((completedStoryFields / requiredStoryFields.length) * 100)

    const storyStepFields = () => {
        if (storyStep === 0) return storyKind === 'Event'
            ? ['storyKind', 'title']
            : ['storyKind', 'title', 'participantId', 'interventionId']
        if (storyStep === 1) return storyKind === 'Event'
            ? ['eventBackground', 'attendees', 'attendeeCount', 'eventBenefits']
            : ['background', 'lepharoJourney', 'achievement', 'lepharoRole']
        return ['coverImage']
    }

    const goToNextStoryStep = async () => {
        try {
            await successForm.validateFields(storyStepFields())
            setStoryStep(current => Math.min(2, current + 1))
        } catch {
            message.warning('Complete the required fields before continuing.')
        }
    }

    const renderStoryCard = (record: SuccessStory) => {
        const cover = storyCover(record)
        const excerpt = record.storyKind === 'Event'
            ? record.eventBenefits || record.summary
            : record.achievement || record.summary
        return (
            <Card
                hoverable
                style={{ height: '100%', overflow: 'hidden', borderRadius: 16 }}
                cover={cover ? (
                    <img src={cover} alt={`${record.title || record.smeName} cover`} style={{ height: 210, objectFit: 'cover' }} />
                ) : (
                    <div style={{ height: 210, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #e6f4ff, #f6ffed)' }}>
                        <PictureOutlined style={{ fontSize: 42, color: '#1677ff' }} />
                    </div>
                )}
                actions={[<Button type='link' key='read' onClick={() => setSelectedStory(record)}>Read full story</Button>]}
            >
                <Space direction='vertical' size={10} style={{ width: '100%' }}>
                    <Space size={4} wrap>
                        <Tag color={record.storyKind === 'Event' ? 'purple' : 'blue'}>{record.storyKind || 'SMME'}</Tag>
                        <Tag color={record.source === 'SME' ? 'cyan' : 'gold'}>{record.source || 'Department'} submitted</Tag>
                    </Space>
                    <Typography.Title level={4} style={{ margin: 0 }}>{record.title || record.smeName || 'Success story'}</Typography.Title>
                    <Typography.Text type='secondary'>{record.smeName || 'Lepharo event'}</Typography.Text>
                    <Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 0 }}>{excerpt || 'Open this story to read the full case study.'}</Paragraph>
                    <Space size={4} wrap>
                        {record.departmentName && <Tag>{record.departmentName}</Tag>}
                        <Typography.Text type='secondary' style={{ fontSize: 12 }}>{formatDateTime(record.createdAt)}</Typography.Text>
                    </Space>
                </Space>
            </Card>
        )
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Success Stories & Challenges</title>
            </Helmet>

            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]} style={{ marginBottom: 0 }}>
                    {(segment === 'stories' ? [
                        { icon: <TrophyOutlined style={{ color: '#1677ff' }} />, bg: 'rgba(22,119,255,0.12)', title: 'Published Stories', value: stories.length },
                        { icon: <CheckCircleOutlined style={{ color: '#13c2c2' }} />, bg: 'rgba(19,194,194,0.12)', title: 'SME Submitted', value: stories.filter(item => item.source === 'SME').length },
                        { icon: <PictureOutlined style={{ color: '#722ed1' }} />, bg: 'rgba(114,46,209,0.12)', title: 'Event Stories', value: stories.filter(item => item.storyKind === 'Event').length }
                    ] : [
                        { icon: <WarningOutlined style={{ color: '#fa8c16' }} />, bg: 'rgba(250,140,22,0.14)', title: 'Open Challenges', value: openChallenges },
                        { icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, bg: 'rgba(82,140,22,0.14)', title: 'Resolved Challenges', value: closedChallenges },
                        { icon: <TrophyOutlined style={{ color: '#1677ff' }} />, bg: 'rgba(22,119,255,0.12)', title: 'SMEs in Programme', value: challengeSmes.length }
                    ]).map(metric => (
                        <Col xs={24} md={8} key={metric.title}>
                            <MotionCard>
                                <MotionCard.Metric icon={metric.icon} iconBg={metric.bg} title={metric.title} value={metric.value} subtitle={metric.subtitle} />
                            </MotionCard>
                        </Col>
                    ))}
                </Row>
                <MotionCard>
                    <Segmented<PageSegment>
                        block
                        value={segment}
                        onChange={value => setSegment(value as PageSegment)}
                        options={[
                            { label: 'Success Stories', value: 'stories' },
                            { label: 'Challenges', value: 'challenges' }
                        ]}
                    />
                </MotionCard>

                <div>
                    {segment === 'stories' ? (
                        <MotionCard
                            filterBar={
                                <Row gutter={[10, 10]} align='middle'>
                                    <Col xs={24} md={12} lg={8}>
                                        <Input allowClear prefix={<SearchOutlined />} placeholder='Search title, SME, achievement, intervention or department...' value={storySearchText} onChange={event => setStorySearchText(event.target.value)} />
                                    </Col>
                                    <Col xs={12} md={6} lg={3}>
                                        <Select value={storyKindFilter} style={{ width: '100%' }} onChange={setStoryKindFilter} options={[{ value: 'all', label: 'All story types' }, { value: 'SMME', label: 'SMME stories' }, { value: 'Event', label: 'Event stories' }]} />
                                    </Col>
                                    <Col xs={12} md={6} lg={3}>
                                        <Select value={storySourceFilter} style={{ width: '100%' }} onChange={setStorySourceFilter} options={[{ value: 'all', label: 'All sources' }, { value: 'SME', label: 'SME submitted' }, { value: 'Department', label: 'Department submitted' }]} />
                                    </Col>
                                    <Col xs={12} md={8} lg={4}>
                                        <Segmented block value={storyView} onChange={value => setStoryView(value as 'cards' | 'table')} options={[{ value: 'cards', icon: <AppstoreOutlined />, label: 'Cards' }, { value: 'table', icon: <BarsOutlined />, label: 'Table' }]} />
                                    </Col>
                                    <Col xs={12} md={6} lg={2}><Button block icon={<ClearOutlined />} onClick={resetStoryFilters}>Reset</Button></Col>
                                    <Col xs={24} md={10} lg={4}>
                                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                                            <Button type='primary' icon={<PlusOutlined />} onClick={() => { setStoryStep(0); setStoryModalOpen(true) }}>Add Story</Button>
                                        </Space>
                                    </Col>
                                </Row>
                            }
                            title='Success Story Library'>
                            {filteredStories.length ? storyView === 'cards' ? (
                                <Row gutter={[16, 16]}>{filteredStories.map(record => <Col xs={24} md={12} xl={8} key={record.id}>{renderStoryCard(record)}</Col>)}</Row>
                            ) : (
                                <Table rowKey='id' columns={storyColumns} dataSource={filteredStories} loading={loading} scroll={{ x: 920 }} expandable={{ expandedRowRender: storyDetails }} pagination={{ pageSize: 8 }} />
                            ) : (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No success stories match these filters'>
                                    <Button type='primary' icon={<PlusOutlined />} onClick={() => { resetStoryFilters(); setStoryStep(0); setStoryModalOpen(true) }}>Create the first story</Button>
                                </Empty>
                            )}
                        </MotionCard>
                    ) : (
                        <Row gutter={[16, 16]}>
                            {totalChallenges > 0 && (
                                <Col xs={24} xl={8}>
                                    <MotionCard title='Challenge Status'>
                                        <HighchartsReact highcharts={Highcharts} options={challengeStatusOptions} />
                                    </MotionCard>
                                </Col>
                            )}
                            <Col xs={24} xl={totalChallenges > 0 ? 16 : 24}>
                                <MotionCard
                                    title='Logged Challenges'
                                    filterBar={
                                        <Row gutter={[10, 10]} align='middle'>
                                            <Col xs={24} md={12} xxl={8}>
                                                <Input
                                                    allowClear
                                                    prefix={<SearchOutlined />}
                                                    placeholder='Search challenges, SMEs, attempts...'
                                                    value={challengeSearchText}
                                                    onChange={event => setChallengeSearchText(event.target.value)}
                                                />
                                            </Col>
                                            <Col xs={24} md={6} xxl={4}>
                                                <Select
                                                    value={statusFilter}
                                                    style={{ width: '100%' }}
                                                    onChange={value => setStatusFilter(value)}
                                                    options={[
                                                        { value: 'all', label: 'All statuses' },
                                                        ...challengeStatuses.map(status => ({ value: status, label: status }))
                                                    ]}
                                                />
                                            </Col>
                                            <Col xs={24} md={6} xxl={4}>
                                                <Select
                                                    value={challengeTypeFilter}
                                                    style={{ width: '100%' }}
                                                    onChange={value => setChallengeTypeFilter(value)}
                                                    options={[
                                                        { value: 'all', label: 'All challenge types' },
                                                        ...challengeTypes.map(type => ({ value: type, label: type }))
                                                    ]}
                                                />
                                            </Col>
                                            <Col xs={24} xxl={4}>
                                                <Space style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
                                                    <Button icon={<ClearOutlined />} onClick={resetChallengeFilters}>Reset</Button>
                                                    <Button type='primary' icon={<PlusOutlined />} onClick={() => openChallengeModal()}>
                                                        Add Challenge
                                                    </Button>
                                                </Space>
                                            </Col>
                                        </Row>
                                    }
                                >
                                    <Table
                                        rowKey='id'
                                        columns={challengeColumns}
                                        dataSource={filteredChallenges}
                                        loading={loading}
                                        scroll={{ x: 900 }}
                                        expandable={{
                                            expandedRowRender: record => (
                                                <div>
                                                    <Paragraph>{record.details}</Paragraph>
                                                    {record.challengeType === 'Unresponsive SMEs' && (
                                                        <Space direction='vertical' style={{ width: '100%', marginBottom: 12 }}>
                                                            <div><strong>SMEs:</strong> {record.smeNames?.join(', ') || '-'}</div>
                                                            <div><strong>Unanswered items:</strong> {record.communicationItems?.join(', ') || '-'}</div>
                                                            <List
                                                                size='small'
                                                                header={<strong>Communication attempts</strong>}
                                                                dataSource={record.communicationAttempts || []}
                                                                renderItem={attempt => (
                                                                    <List.Item>
                                                                        <div>
                                                                            <strong>{attempt.channel}</strong>
                                                                            {attempt.attemptedAt ? ` · ${dateLikeToDayjs(attempt.attemptedAt)?.format('YYYY-MM-DD HH:mm') || '-'}` : ''}
                                                                            {attempt.items?.length ? ` · ${attempt.items.join(', ')}` : ''}
                                                                            <div>{attempt.notes}</div>
                                                                        </div>
                                                                    </List.Item>
                                                                )}
                                                            />
                                                        </Space>
                                                    )}
                                                    {record.mitigationSteps?.length ? (
                                                        <List size='small' dataSource={record.mitigationSteps} renderItem={item => <List.Item>{item}</List.Item>} />
                                                    ) : (
                                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No mitigation steps listed' />
                                                    )}
                                                </div>
                                            )
                                        }}
                                        pagination={{ pageSize: 8 }}
                                    />
                                </MotionCard>
                            </Col>
                        </Row>
                    )}
                </div>
            </Space>

            <Modal title={selectedStory?.title || selectedStory?.smeName || 'Success story'} open={!!selectedStory} onCancel={() => setSelectedStory(null)} footer={<Button onClick={() => setSelectedStory(null)}>Close</Button>} width={860}>
                {selectedStory && <>
                    {storyCover(selectedStory) && <Image src={storyCover(selectedStory)} alt={`${selectedStory.title || selectedStory.smeName} cover`} width='100%' height={320} style={{ objectFit: 'cover', borderRadius: 14, marginBottom: 18 }} />}
                    <Space wrap style={{ marginBottom: 16 }}><Tag color={selectedStory.storyKind === 'Event' ? 'purple' : 'blue'}>{selectedStory.storyKind || 'SMME'}</Tag><Tag color={selectedStory.source === 'SME' ? 'cyan' : 'gold'}>{selectedStory.source || 'Department'} submitted</Tag>{selectedStory.departmentName && <Tag>{selectedStory.departmentName}</Tag>}</Space>
                    {storyDetails(selectedStory)}
                </>}
            </Modal>

            <Modal title='Create Success Story' open={storyModalOpen} onCancel={closeStoryModal} footer={null} width={900} destroyOnClose>
                <Steps current={storyStep} responsive items={[{ title: 'Story subject' }, { title: 'Case study' }, { title: 'Evidence & review' }]} style={{ marginBottom: 18 }} />
                <div style={{ background: '#f5f7fb', borderRadius: 12, padding: '10px 14px', marginBottom: 18 }}>
                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}><Typography.Text strong>Story completeness</Typography.Text><Typography.Text>{completedStoryFields} of {requiredStoryFields.length} required sections</Typography.Text></Space>
                        <Progress percent={storyCompletionPercent} size='small' status={storyCompletionPercent === 100 ? 'success' : 'active'} />
                    </Space>
                </div>
                <Form form={successForm} layout='vertical' onFinish={handleStorySubmit} initialValues={{ storyKind: 'SMME' }}>
                    {storyStep === 0 && <>
                        <Alert showIcon type='info' style={{ marginBottom: 16 }} message='Start with the subject and completed intervention. The next step builds the case study.' />
                        <Form.Item label='Success story type' name='storyKind' rules={[{ required: true }]}><Segmented block options={['SMME', 'Event']} onChange={() => { successForm.setFieldsValue({ participantId: undefined, interventionId: undefined }); setSelectedParticipantId(undefined); setInterventions([]) }} /></Form.Item>
                        <Form.Item label='Story title' name='title' rules={[{ required: true, whitespace: true, message: 'Add a clear story title' }]}><Input placeholder={storyKind === 'Event' ? 'E.g. Supplier Readiness Day connects SMMEs to buyers' : 'E.g. Safe Lifestyle grows turnover after incubation support'} /></Form.Item>
                        {storyKind !== 'Event' && <Form.Item label='SME' name='participantId' rules={[{ required: true, message: 'Select an SME' }]}><Select showSearch placeholder='Select an SME with completed interventions' optionFilterProp='label' loading={loading} onChange={value => { setSelectedParticipantId(value); successForm.setFieldValue('interventionId', undefined) }} options={smes.map(item => ({ label: item.companyName, value: item.participantId }))} notFoundContent='No SMEs with SME-confirmed interventions were found for this department.' /></Form.Item>}
                        {storyKind !== 'Event' && <Form.Item label='SME-confirmed intervention' name='interventionId' rules={[{ required: true, message: 'Select a confirmed intervention' }]}><Select showSearch placeholder='Select confirmed intervention' optionFilterProp='search' disabled={!selectedParticipantId} options={interventions.map(item => ({ search: `${item.interventionTitle} ${item.departmentName || ''} ${(item.monthTags || []).join(' ')}`, label: <Space direction='vertical' size={2}><span>{item.interventionTitle}{item.departmentName ? ` - ${item.departmentName}` : ''}</span><Space size={4} wrap>{(item.occurrenceCount || 0) > 1 && <Tag color='blue'>{item.occurrenceCount} sessions</Tag>}{(item.monthTags || []).slice(0, 4).map(month => <Tag key={month}>{month}</Tag>)}</Space></Space>, value: item.id }))} /></Form.Item>}
                    </>}
                    {storyStep === 1 && (storyKind !== 'Event' ? <>
                        {selectedSme && <Alert showIcon type='success' style={{ marginBottom: 16 }} message='Prefilled from SME records' description={<Space direction='vertical' size={8}><span>Review the sourced draft and edit anything that needs context.</span><Button size='small' icon={<RobotOutlined />} loading={draftingStory} onClick={handleAiStoryDraft}>Prepare improved draft with AI</Button></Space>} />}
                        <Form.Item label={<span>Background on the SMME <Tag color='blue'>From SME records</Tag></span>} name='background' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='What the business does, when it started, sector, founder and relevant context.' /></Form.Item>
                        <Form.Item label={<span>{crossDepartmentStoryView ? 'Journey with Lepharo' : `How ${storyDepartmentLabel} supported the SMME`} <Tag color='blue'>From SME-confirmed interventions</Tag></span>} name='lepharoJourney' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder={crossDepartmentStoryView ? 'When the SMME joined, completed interventions and current position.' : `Describe the SME-confirmed interventions serviced by ${storyDepartmentLabel} and how they supported progress.`} /></Form.Item>
                        <Form.Item label='Detailed achievement' name='achievement' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='Describe the award, contract, funding, turnover growth, jobs or other measurable result.' /></Form.Item>
                        <Form.Item label="Lepharo's contribution" name='lepharoRole' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='Explain the support that contributed, or state clearly if it was not directly linked.' /></Form.Item>
                    </> : <>
                        <Form.Item label='Event background' name='eventBackground' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='When and why it was hosted or attended, intended beneficiaries and immediate outcomes.' /></Form.Item>
                        <Row gutter={12}><Col xs={24} md={16}><Form.Item label='Who attended' name='attendees' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='Stakeholder and beneficiary types.' /></Form.Item></Col><Col xs={24} md={8}><Form.Item label='Number of attendees' name='attendeeCount' rules={[{ required: true, message: 'Add attendance' }]}><Input type='number' min={1} /></Form.Item></Col></Row>
                        <Form.Item label='Benefits and long-term outcomes' name='eventBenefits' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='Benefits, follow-on opportunities and expected long-term outcomes.' /></Form.Item>
                    </>)}
                    {storyStep === 2 && <>
                        <Alert showIcon type='info' style={{ marginBottom: 16 }} message='Choose a strong cover photograph. It will lead the story in the library.' />
                        <Form.Item label='Primary cover image' name='coverImage' valuePropName='fileList' getValueFromEvent={e => e?.fileList || []} rules={[{ required: true, message: 'Add a primary cover image' }]}><Upload beforeUpload={() => false} maxCount={1} accept='image/*' listType='picture'><Button icon={<PictureOutlined />}>Choose cover image</Button></Upload></Form.Item>
                        <Form.Item label='Additional pictures and supporting evidence (optional)' name='documents' valuePropName='fileList' getValueFromEvent={e => e?.fileList || []}><Upload beforeUpload={() => false} multiple accept='image/*,.pdf'><Button icon={<UploadOutlined />}>Add pictures or PDFs</Button></Upload></Form.Item>
                        {storyKind !== 'Event' && <Form.Item label="SME's comment or testimonial (optional)" name='smeComment'><TextArea rows={3} placeholder='Capture the SME comment or testimonial.' /></Form.Item>}
                        <Card size='small' title='Final review'><Space direction='vertical' size={6}><Typography.Text strong>{storyFormValues.title || 'Untitled story'}</Typography.Text><Typography.Text type='secondary'>{storyKind === 'Event' ? 'Event success story' : `${selectedSme?.companyName || 'SMME'} · ${interventions.find(item => item.id === storyFormValues.interventionId)?.interventionTitle || 'Intervention'}`}</Typography.Text><Typography.Text>{storyKind === 'Event' ? storyFormValues.eventBenefits : storyFormValues.achievement}</Typography.Text></Space></Card>
                    </>}
                    <Row gutter={12} style={{ marginTop: 20 }}>
                        <Col span={8}><Button block onClick={storyStep === 0 ? closeStoryModal : () => setStoryStep(current => current - 1)}>{storyStep === 0 ? 'Cancel' : 'Back'}</Button></Col>
                        <Col span={16}>{storyStep < 2 ? <Button block type='primary' onClick={goToNextStoryStep}>Continue</Button> : <Button block type='primary' loading={savingStory} icon={<PlusOutlined />} onClick={() => successForm.submit()}>Publish Success Story</Button>}</Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={editingChallenge ? 'Update Challenge' : 'Add Challenge'}
                open={challengeModalOpen}
                onCancel={closeChallengeModal}
                footer={null}
                width={900}
                destroyOnClose
            >
                <Form
                    form={challengeForm}
                    layout='vertical'
                    onFinish={handleChallengeSubmit}
                    initialValues={{
                        challengeType: 'General',
                        mitigationSteps: [{ text: '' }],
                        communicationAttempts: [{ attemptedAt: dayjs(), items: [] }],
                        status: 'Open'
                    }}
                >
                    <Form.Item label='Challenge Type' name='challengeType' rules={[{ required: true }]}>
                        <Select options={challengeTypes.map(type => ({ value: type, label: type }))} />
                    </Form.Item>
                    {challengeType !== 'Unresponsive SMEs' && (
                        <Form.Item label='Challenge' name='title' rules={[{ required: true, message: 'Add a challenge title' }]}>
                            <Input placeholder='E.g. Low attendance for finance sessions' />
                        </Form.Item>
                    )}
                    {challengeType === 'Unresponsive SMEs' && (
                        <>
                            <Form.Item
                                label='Unresponsive SME(s)'
                                name='smeIds'
                                rules={[{ required: true, message: 'Select at least one SME' }]}
                            >
                                <Select
                                    mode='multiple'
                                    showSearch
                                    optionFilterProp='label'
                                    placeholder='Select one or more SMEs'
                                    options={challengeSmes.map(sme => ({ value: sme.participantId, label: sme.companyName }))}
                                />
                            </Form.Item>
                            <Divider orientation='left'>Communication Attempts</Divider>
                            <Form.List name='communicationAttempts'>
                                {(fields, { add, remove }) => (
                                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                        {fields.map((field, index) => (
                                            <div key={field.key} style={{ padding: 14, border: '1px solid #f0f0f0', borderRadius: 10 }}>
                                                <Row gutter={12}>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Contact method'
                                                            name={[field.name, 'channel']}
                                                            rules={[{ required: true, message: 'Select a contact method' }]}
                                                        >
                                                            <Select options={communicationChannelOptions.map(channel => ({ value: channel, label: channel }))} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Attempt date and time'
                                                            name={[field.name, 'attemptedAt']}
                                                            rules={[{ required: true, message: 'Select when contact was attempted' }]}
                                                        >
                                                            <DatePicker showTime style={{ width: '100%' }} />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={24} md={8}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Item(s) awaiting response'
                                                            name={[field.name, 'items']}
                                                            rules={[{ required: true, message: 'Select the item(s)' }]}
                                                        >
                                                            <Select
                                                                mode='multiple'
                                                                popupMatchSelectWidth={420}
                                                                options={communicationItemOptions.map(item => ({
                                                                    value: item,
                                                                    label: <span title={item}>{item}</span>
                                                                }))}
                                                            />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                                <Form.Item
                                                    {...field}
                                                    label='Attempt notes'
                                                    name={[field.name, 'notes']}
                                                    rules={[{ required: true, whitespace: true, message: 'Describe where/how contact was attempted and the outcome' }]}
                                                >
                                                    <TextArea rows={2} placeholder='E.g. Emailed the owner and followed up on WhatsApp; messages were delivered but no response was received.' />
                                                </Form.Item>
                                                {fields.length > 1 && (
                                                    <Button danger onClick={() => remove(field.name)}>Remove attempt {index + 1}</Button>
                                                )}
                                            </div>
                                        ))}
                                        <Button
                                            type='dashed'
                                            block
                                            icon={<PlusOutlined />}
                                            onClick={() => add({ attemptedAt: dayjs(), items: [] })}
                                        >
                                            Add Communication Attempt
                                        </Button>
                                    </Space>
                                )}
                            </Form.List>
                        </>
                    )}
                    <Form.Item label='Details' name='details' rules={[{ required: true, message: 'Describe the challenge' }]}>
                        <TextArea
                            rows={4}
                            placeholder={challengeType === 'Unresponsive SMEs'
                                ? 'Describe the lack of response and the impact on delivery.'
                                : 'What happened, who is affected, and what is the impact?'}
                        />
                    </Form.Item>
                    <Divider orientation='left'>Proposed Mitigation</Divider>
                    <Form.List name='mitigationSteps'>
                        {(fields, { add, remove }) => (
                            <Space direction='vertical' style={{ width: '100%' }}>
                                {fields.map(field => (
                                    <div key={field.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%' }}>
                                        <Form.Item {...field} name={[field.name, 'text']} style={{ flex: 1, marginBottom: 8 }}>
                                            <Input style={{ width: '100%' }} placeholder='Mitigation step' />
                                        </Form.Item>
                                        {fields.length > 1 && (
                                            <Button danger onClick={() => remove(field.name)}>Remove</Button>
                                        )}
                                    </div>
                                ))}
                                <Button onClick={() => add()} icon={<PlusOutlined />}>Add step</Button>
                            </Space>
                        )}
                    </Form.List>
                    <Row gutter={12} style={{ marginTop: 16 }}>
                        <Col xs={24} md={12}>
                            <Form.Item label='Due Date' name='dueDate'>
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item label='Status' name='status'>
                                <Select options={challengeStatuses.map(status => ({ value: status, label: status }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Button block onClick={closeChallengeModal}>
                                Cancel
                            </Button>
                        </Col>
                        <Col span={12}>
                            <Button block type='primary' htmlType='submit' loading={savingChallenge} icon={<WarningOutlined />}>
                                Save
                            </Button>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    )
}

export default SuccessChallengesPage
