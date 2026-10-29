import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
    Table,
    Tag,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import './success-story.css'
import { listEvents, type EventRecord } from '@/services/eventService'
import { departmentNameOf, loadDepartmentRoles } from '@/services/departmentRoles'
import { getStoryInvitees } from './storyEvent'
import type { ColumnsType } from 'antd/es/table'
import {
    BankOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
    ClearOutlined,
    CloseOutlined,
    ExclamationCircleOutlined,
    LockOutlined,
    SyncOutlined,
    EyeOutlined,
    FilePdfOutlined,
    PictureOutlined,
    PlusOutlined,
    ProfileOutlined,
    TeamOutlined,
    RobotOutlined,
    SearchOutlined,
    TrophyOutlined,
    UploadOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import { getAuth } from 'firebase/auth'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    addDoc,
    arrayUnion,
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
import EventNatureCards, { natureFromFormat, type EventNature } from './EventNatureCards'
import ChallengeCheckInModal, { type CheckInValues } from './ChallengeCheckInModal'
import ChallengeFormModal from './ChallengeFormModal'
import StoryReaderModal from './StoryReaderModal'
import './story-reader.css'
import { previewEventStory } from './previewStory'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
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
    attendeeCountBasis?: 'invited'
    eventId?: string | null
    eventTitle?: string
    eventBenefits?: string
    eventNature?: EventNature | null
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
    checkIns?: ChallengeCheckIn[]
    lastCheckInAt?: any
    status?: string
    departmentName?: string
    createdAt?: any
}

type ChallengeCheckIn = {
    answeredAt?: any
    answeredByName?: string | null
    outcome: 'mitigated' | 'in_progress' | 'not_mitigated'
    resolutionNote?: string | null
    reasonCategory?: string | null
    reason?: string | null
    supportNeeded?: string | null
    previousDueDate?: any
    newDueDate?: any
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
const newChallengeValues = () => ({
    challengeType: 'General',
    mitigationSteps: [],
    communicationAttempts: [{ channel: undefined, attemptedAt: dayjs(), items: [], notes: '' }],
    status: 'Open'
})
const communicationChannelOptions = ['Phone call', 'Email', 'WhatsApp', 'SMS', 'In person', 'Other']

const formatDateTime = (value: any) => {
    const date = value?.toDate?.() ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : value
    return date && dayjs(date).isValid() ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
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
    const departmentNames = Array.from(new Set(completedRows.map(row => firstText(row.departmentName)).filter(Boolean)))
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
    const elevatedRole = ['projectadmin', 'project_admin', 'system_admin', 'superadmin', 'director', 'projectmanager'].includes(role)
    const canSeeAll = elevatedRole || (role === 'operations' && isMainDepartment)
    const belongsToDepartment = (row: any) => {
        if (canSeeAll) return true
        const userIds = [user?.id, user?.uid].map(clean).filter(Boolean)
        if (userIds.length && (userIds.includes(clean(row?.createdById)) || userIds.includes(clean(row?.createdBy)))) return true
        return !!departmentId && clean(row?.departmentId) === departmentId
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

const StoryImagePreview: React.FC<{ files: any[] }> = ({ files }) => {
    const [images, setImages] = useState<{ name: string; url: string }[]>([])
    useEffect(() => {
        const previews = files.filter(file => file.originFileObj).map(file => ({ name: file.name, url: URL.createObjectURL(file.originFileObj) }))
        setImages(previews)
        return () => previews.forEach(image => URL.revokeObjectURL(image.url))
    }, [files])
    return images.length ? <Image.PreviewGroup><div className='story-image-row'>{images.map(image => <Image key={image.url} src={image.url} alt={image.name} width={96} height={80} style={{ objectFit: 'cover', borderRadius: 8 }} />)}</div></Image.PreviewGroup> : <Paragraph type='secondary'>No images added.</Paragraph>
}

const StoryTypeQuestion: React.FC = () => {
    const question = 'What kind of success story would you like to tell?'
    const [visibleCharacters, setVisibleCharacters] = useState(0)

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setVisibleCharacters(question.length)
            return
        }
        const timer = window.setInterval(() => {
            setVisibleCharacters(count => {
                if (count + 1 >= question.length) window.clearInterval(timer)
                return Math.min(count + 1, question.length)
            })
        }, 30)
        return () => window.clearInterval(timer)
    }, [])

    return <Typography.Title level={3} aria-label={question} style={{ minHeight: 64, marginTop: 8 }}>
        <span aria-hidden='true'>{question.slice(0, visibleCharacters)}</span>
    </Typography.Title>
}

const SuccessChallengesPage: React.FC = () => {
    const { token } = theme.useToken()
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [successForm] = Form.useForm()
    const storyKind = Form.useWatch('storyKind', successForm) as 'SMME' | 'Event' | undefined
    const storyFormValues = Form.useWatch([], { form: successForm, preserve: true }) || {}

    const [smes, setSmes] = useState<SmeOption[]>([])
    const [challengeSmes, setChallengeSmes] = useState<SmeOption[]>([])
    const [selectedParticipantId, setSelectedParticipantId] = useState<string>()
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [storySourceContext, setStorySourceContext] = useState<{ participant: any; completedRows: any[] } | null>(null)
    const [storyEvents, setStoryEvents] = useState<EventRecord[]>([])
    const [eventsLoading, setEventsLoading] = useState(true)
    const [eventsError, setEventsError] = useState(false)
    const selectedEvent = storyEvents.find(event => event.id === storyFormValues.eventId)
    const eventInvitees = useMemo(() => getStoryInvitees(selectedEvent), [selectedEvent])
    const [stories, setStories] = useState<SuccessStory[]>([])
    const [challenges, setChallenges] = useState<Challenge[]>([])
    const [loading, setLoading] = useState(false)
    const [savingStory, setSavingStory] = useState(false)
    const [draftingStory, setDraftingStory] = useState(false)
    const [savingChallenge, setSavingChallenge] = useState(false)
    const [storyModalOpen, setStoryModalOpen] = useState(false)
    const [storyStep, setStoryStep] = useState(-1)
    const [selectedStory, setSelectedStory] = useState<SuccessStory | null>(null)
    const [challengeModalOpen, setChallengeModalOpen] = useState(false)
    const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null)
    const [challengeInitial, setChallengeInitial] = useState<Record<string, any>>(newChallengeValues)
    const [viewChallenge, setViewChallenge] = useState<Challenge | null>(null)
    const [checkInChallenge, setCheckInChallenge] = useState<Challenge | null>(null)
    const [savingCheckIn, setSavingCheckIn] = useState(false)
    const [searchParams, setSearchParams] = useSearchParams()
    const deepLinkHandled = useRef(false)
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
                        .concat(import.meta.env.DEV ? [previewEventStory] : [])
                        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
                )

                const challengeSnap = await getDocs(collection(db, 'operationalChallenges'))
                const challengeRows = challengeSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) })) as Challenge[]
                setChallenges(
                    challengeRows
                        .filter((row: any) => {
                            if (!isAllPrograms && activeProgramId && clean(row.programId) && clean(row.programId) !== clean(activeProgramId)) return false
                            return scope.canSeeAll || (!!deptId && clean(row.departmentId) === deptId)
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
        let cancelled = false
        const run = async () => {
            if (!user || !selectedParticipantId) {
                setInterventions([])
                setStorySourceContext(null)
                return
            }

            try {
                const scope = await resolveStoryDepartmentScope(user)
                const [snap, { departments }] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'assignedInterventions'),
                            where('participantId', '==', selectedParticipantId)
                        )
                    ),
                    loadDepartmentRoles()
                ])
                const allCompletedRows = snap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .map(row => ({ ...row, departmentName: departmentNameOf(row.departmentId, departments, '') }))
                    .filter(row => isAllPrograms || !activeProgramId || !clean(row.programId) || clean(row.programId) === clean(activeProgramId))
                    .filter(isCompletedIntervention)
                const scopedCompletedRows = allCompletedRows.filter(scope.belongsToDepartment)
                const rows = scopedCompletedRows
                    .map(row => ({
                        ...row,
                        interventionTitle: String(row.interventionTitle || row.title || row.name || 'Untitled intervention'),
                        departmentName: row.departmentName
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

                if (cancelled) return
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
                if (cancelled) return
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
        return () => { cancelled = true }
    }, [activeProgramId, isAllPrograms, selectedParticipantId, smes, successForm, user])

    useEffect(() => {
        let cancelled = false
        setEventsLoading(true)
        setEventsError(false)
        setStoryEvents([])
        const load = async () => {
            try {
                if (!user) return
                const scope = await resolveStoryDepartmentScope(user)
                const events = await listEvents({ departmentId: scope.canSeeAll ? undefined : scope.departmentId || undefined })
                if (!cancelled) setStoryEvents(events.filter(scope.belongsToDepartment)
                    .filter(event => !event.deletedAt && !['cancelled', 'canceled', 'deleted'].includes(norm(event.status)))
                    .filter(event => isAllPrograms || !activeProgramId || !clean(event.programId) || event.programId === activeProgramId)
                    .sort((a, b) => clean(b.date).localeCompare(clean(a.date))))
            } catch (error) {
                console.error(error)
                if (!cancelled) setEventsError(true)
            } finally {
                if (!cancelled) setEventsLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [user, activeProgramId, isAllPrograms])

    const openStoryModal = () => {
        successForm.resetFields()
        setSelectedParticipantId(undefined)
        setInterventions([])
        setStorySourceContext(null)
        setStoryStep(-1)
        setStoryModalOpen(true)
    }

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
                    department: firstText(row.departmentName),
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
        if (storyStep !== 3 || savingStory) return
        const isEvent = values.storyKind === 'Event'
        if (!user || (!isEvent && !selectedSme)) return
        const event = isEvent && values.eventId ? storyEvents.find(item => item.id === values.eventId) : undefined
        if (isEvent && !event && !clean(values.eventTitle)) {
            message.error('Enter the event name before publishing.')
            setStoryStep(0)
            return
        }
        const invitees = getStoryInvitees(event)
        const eventFields = isEvent ? {
            eventId: event?.id || null,
            eventTitle: event?.title || clean(values.eventTitle),
            eventDate: event?.date || (values.eventDate ? dayjs(values.eventDate).format('YYYY-MM-DD') : null),
            invitedParticipants: invitees,
            attendees: invitees.map(person => person.label).join(', '),
            attendeeCount: invitees.length,
            attendeeCountBasis: 'invited' as const
        } : {}
        const departmentId = event?.departmentId || clean(user?.departmentId) || null
        const departmentName = firstText(event?.departmentName, event?.department, !crossDepartmentStoryView ? storyDepartmentLabel : '')
        setSavingStory(true)
        try {
            const intervention = interventions.find(item => item.id === values.interventionId)
            const docRef = await addDoc(collection(db, 'successStories'), {
                programId: event?.programId || selectedSme?.programId || activeProgramId || null,
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
                departmentId: isEvent ? departmentId : intervention?.departmentId || null,
                departmentName: isEvent ? departmentName : intervention?.departmentName || null,
                assigneeId: intervention?.assigneeId || null,
                assigneeName: intervention?.assigneeName || null,
                background: values.background || '',
                lepharoJourney: values.lepharoJourney || '',
                achievement: values.achievement || '',
                lepharoRole: values.lepharoRole || '',
                eventBackground: values.eventBackground || '',
                eventNature: isEvent ? values.eventNature || null : null,
                attendees: values.attendees || '',
                attendeeCount: values.attendeeCount ? Number(values.attendeeCount) : null,
                eventBenefits: values.eventBenefits || '',
                summary: values.storyKind === 'Event' ? values.eventBenefits : values.achievement,
                smeComment: values.smeComment || '',
                ...eventFields,
                attachments: [],
                createdById: user.id || user.uid || null,
                createdByName: user.name || user.email || null,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            })

            const attachments = await uploadFiles(values.images || [], `success-stories/${docRef.id}/images`)
            const coverImageUrl = attachments[0]?.url || ''
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
                departmentName: isEvent ? departmentName : intervention?.departmentName || '',
                programId: event?.programId || selectedSme?.programId || activeProgramId || undefined,
                coverImageUrl,
                background: values.background || '',
                lepharoJourney: values.lepharoJourney || '',
                achievement: values.achievement || '',
                lepharoRole: values.lepharoRole || '',
                eventBackground: values.eventBackground || '',
                eventNature: isEvent ? values.eventNature || null : null,
                attendees: values.attendees || '',
                attendeeCount: values.attendeeCount ? Number(values.attendeeCount) : undefined,
                eventBenefits: values.eventBenefits || '',
                summary: values.storyKind === 'Event' ? values.eventBenefits : values.achievement,
                smeComment: values.smeComment || '',
                ...eventFields,
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
        setChallengeInitial(record ? {
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
                : [],
            dueDate: record.dueDate?.toDate?.() ? dayjs(record.dueDate.toDate()) : null,
            status: record.status || 'Open'
        } : newChallengeValues())
        setChallengeModalOpen(true)
    }

    const handleCheckInSubmit = async (values: CheckInValues) => {
        if (!user || !checkInChallenge) return
        setSavingCheckIn(true)
        try {
            const mitigated = values.outcome === 'mitigated'
            const nextDue = !mitigated && values.newDueDate ? Timestamp.fromDate(values.newDueDate.toDate()) : checkInChallenge.dueDate || null
            const entry: ChallengeCheckIn = {
                answeredAt: Timestamp.now(),
                answeredByName: user.name || user.email || null,
                outcome: values.outcome,
                resolutionNote: mitigated ? clean(values.resolutionNote) || null : null,
                reasonCategory: mitigated ? null : values.reasonCategory || null,
                reason: mitigated ? null : clean(values.reason) || null,
                supportNeeded: mitigated ? null : clean(values.supportNeeded) || null,
                previousDueDate: checkInChallenge.dueDate || null,
                newDueDate: mitigated ? null : nextDue
            }
            const update = {
                status: mitigated ? 'Resolved' : 'In Progress',
                dueDate: nextDue,
                lastCheckInAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                updatedById: user.id || user.uid || null,
                updatedByName: user.name || user.email || null
            }
            await updateDoc(doc(db, 'operationalChallenges', checkInChallenge.id), { ...update, checkIns: arrayUnion(entry) })
            setChallenges(prev => prev.map(item => item.id === checkInChallenge.id ? { ...item, ...update, checkIns: [...(item.checkIns || []), entry] } : item))
            message.success(mitigated ? 'Marked as mitigated.' : 'Check-in saved and target date updated.')
            setCheckInChallenge(null)
        } catch (error) {
            console.error(error)
            message.error('Failed to save the check-in.')
        } finally {
            setSavingCheckIn(false)
        }
    }

    // Reminder emails link here: ?challenge=<id>&checkin=1 opens that challenge's check-in.
    useEffect(() => {
        const challengeId = searchParams.get('challenge')
        if (!challengeId || loading || deepLinkHandled.current) return
        deepLinkHandled.current = true
        setSegment('challenges')
        const target = challenges.find(item => item.id === challengeId)
        if (!target) message.info('That challenge is not available in your current view.')
        else if (searchParams.get('checkin')) setCheckInChallenge(target)
        else setViewChallenge(target)
        setSearchParams({}, { replace: true })
    }, [challenges, loading, searchParams, setSearchParams])

    const closeStoryModal = () => {
        setStoryModalOpen(false)
        setStoryStep(-1)
        successForm.resetFields()
        setSelectedParticipantId(undefined)
        setInterventions([])
        setStorySourceContext(null)
    }

    const closeChallengeModal = () => {
        setChallengeModalOpen(false)
        setEditingChallenge(null)
    }

    const getChallengeSections = (record: Challenge): Array<[string, string]> => {
        const attempts = (record.communicationAttempts || []).map((attempt, index) => [
            `${index + 1}. ${attempt.channel}`,
            attempt.attemptedAt ? dateLikeToDayjs(attempt.attemptedAt)?.format('YYYY-MM-DD HH:mm') : '',
            attempt.items?.length ? attempt.items.join(', ') : '',
            attempt.notes
        ].filter(Boolean).join(' - ')).join('\n')
        const mitigation = (record.mitigationSteps || []).map((step, index) => `${index + 1}. ${step}`).join('\n')
        const due = record.dueDate?.toDate?.() ? dayjs(record.dueDate.toDate()).format('YYYY-MM-DD') : ''
        const outcomeLabel = { mitigated: 'Mitigated', in_progress: 'Partly mitigated', not_mitigated: 'Not mitigated' }
        const checkIns = (record.checkIns || []).map(entry => [
            formatDateTime(entry.answeredAt),
            outcomeLabel[entry.outcome] || entry.outcome,
            entry.reasonCategory,
            entry.reason || entry.resolutionNote,
            entry.supportNeeded ? `Support needed: ${entry.supportNeeded}` : '',
            entry.newDueDate?.toDate?.() ? `New target ${dayjs(entry.newDueDate.toDate()).format('YYYY-MM-DD')}` : ''
        ].filter(Boolean).join(' - ')).join('\n')
        return ([
            ['What happened', clean(record.details)],
            ['SMEs involved', record.smeNames?.join(', ') || ''],
            ['Awaiting response on', record.communicationItems?.join(', ') || ''],
            ['Communication attempts', attempts],
            ['Proposed mitigation', mitigation],
            ['Check-ins', checkIns],
            ['Status and timeline', [record.status || 'Open', due ? `Due ${due}` : ''].filter(Boolean).join(' - ')]
        ] as Array<[string, string]>).filter(([, value]) => !!clean(value))
    }

    const getStorySections = (record: SuccessStory) => {
        return record.storyKind === 'Event'
            ? [
                ['Event background', record.eventBackground || record.background],
                [record.attendeeCountBasis === 'invited' ? 'Invited participants' : 'Attendees', record.attendees],
                [record.attendeeCountBasis === 'invited' ? 'Number invited' : 'Attendance', record.attendeeCount != null ? `${record.attendeeCount} ${record.attendeeCountBasis === 'invited' ? 'invitees' : 'attendees'}` : ''],
                ['Benefits and long-term outcomes', record.eventBenefits || record.summary]
            ]
            : [
                ['SMME background', record.background],
                [crossDepartmentStoryView ? 'Journey with Lepharo' : `How ${storyDepartmentLabel} supported the SMME`, record.lepharoJourney],
                ['Achievement', record.achievement || record.summary],
                ["Lepharo's contribution", record.lepharoRole],
                ['SMME comment / testimonial', record.smeComment]
            ]
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
        {
            title: 'Due Date',
            dataIndex: 'dueDate',
            render: (value: any, record) => {
                if (!value?.toDate?.()) return '-'
                const due = dayjs(value.toDate())
                const open = !isClosedStatus(record.status)
                return (
                    <Space direction='vertical' size={2}>
                        <span>{due.format('YYYY-MM-DD')}</span>
                        {open && due.isBefore(dayjs(), 'day') && <Tag color='red'>Overdue</Tag>}
                        {open && due.isSame(dayjs(), 'day') && <Tag color='orange'>Due today</Tag>}
                    </Space>
                )
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (value: ChallengeStatus) => <Tag color={isClosedStatus(value) ? 'green' : value === 'In Progress' ? 'blue' : 'gold'}>{value || 'Open'}</Tag>
        },
        {
            title: 'Action',
            render: (_, record) => (
                <Space size={6}>
                    <Button size='small' icon={<EyeOutlined />} onClick={() => setViewChallenge(record)}>View</Button>
                    {!isClosedStatus(record.status) && <Button size='small' icon={<CheckCircleOutlined />} onClick={() => setCheckInChallenge(record)}>Check in</Button>}
                    <Button size='small' onClick={() => openChallengeModal(record)}>Update</Button>
                </Space>
            )
        }
    ]

    const statusCount = (status: ChallengeStatus) => challenges.filter(item => clean(item.status || 'Open') === status).length
    const totalChallenges = challenges.length

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
    ]

    const largestStatusCount = Math.max(1, ...challengeStatusData.map(item => item.y))

    const storyCover = (record: SuccessStory) =>
        record.coverImageUrl || record.attachments?.find(file => file.type?.startsWith('image/'))?.url || ''
    const requiredStoryFields = storyKind === 'Event'
        ? ['storyKind', storyFormValues.eventId ? 'eventId' : 'eventTitle', 'eventNature', 'title', 'eventBackground', 'eventBenefits']
        : ['storyKind', 'title', 'participantId', 'interventionId', 'background', 'lepharoJourney', 'achievement', 'lepharoRole']
    const completedStoryFields = requiredStoryFields.filter(field => {
        const value = storyFormValues[field]
        return Array.isArray(value) ? value.length > 0 : !!clean(value)
    }).length
    const storyCompletionPercent = Math.round((completedStoryFields / requiredStoryFields.length) * 100)

    const storyStepFields = () => {
        if (storyStep === 0) return storyKind === 'Event'
            ? ['storyKind', ...(storyFormValues.eventId ? [] : ['eventTitle']), 'eventNature', 'title']
            : ['storyKind', 'title', 'participantId', 'interventionId']
        if (storyStep === 1) return storyKind === 'Event'
            ? ['eventBackground', 'eventBenefits']
            : ['background', 'lepharoJourney', 'achievement', 'lepharoRole']
        return ['images']
    }

    const goToNextStoryStep = async () => {
        try {
            await successForm.validateFields(storyStepFields())
            setStoryStep(current => Math.min(3, current + 1))
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
                size='small'
                className='story-card-slim'
                style={{ height: '100%', overflow: 'hidden', borderRadius: 16 }}
                cover={cover ? (
                    <img src={cover} alt={`${record.title || record.smeName} cover`} style={{ height: 130, width: '100%', objectFit: 'cover' }} />
                ) : (
                    <div style={{ height: 130, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #e6f4ff, #f6ffed)' }}>
                        <PictureOutlined style={{ fontSize: 32, color: '#1677ff' }} />
                    </div>
                )}
                actions={[<Button type='link' key='read' onClick={() => setSelectedStory(record)}>Read full story</Button>]}
            >
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <Space size={4} wrap>
                        <Tag color={record.storyKind === 'Event' ? 'purple' : 'blue'}>{record.storyKind || 'SMME'}</Tag>
                        <Tag color={record.source === 'SME' ? 'cyan' : 'gold'}>{record.source || 'Department'} submitted</Tag>
                        {record.eventNature && <Tag color='geekblue'>{record.eventNature}</Tag>}
                    </Space>
                    <Typography.Title level={5} ellipsis={{ rows: 2 }} style={{ margin: 0 }}>{record.title || record.smeName || 'Success story'}</Typography.Title>
                    <Typography.Text type='secondary' style={{ fontSize: 12 }}>{record.smeName || 'Lepharo event'}</Typography.Text>
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>{excerpt || 'Open this story to read the full case study.'}</Paragraph>
                    <Space size={4} wrap>
                        {record.departmentName && <Tag>{record.departmentName}</Tag>}
                        <Typography.Text type='secondary' style={{ fontSize: 12 }}>{formatDateTime(record.createdAt)}</Typography.Text>
                    </Space>
                </Space>
            </Card>
        )
    }

    return (
        <div className='success-challenges-page' style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Success Stories & Challenges</title>
            </Helmet>

            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]} style={{ marginBottom: 0 }}>
                    {(segment === 'stories' ? [
                        { icon: <TrophyOutlined />, tone: 'accent' as const, title: 'Published Stories', value: stories.length, active: storyKindFilter === 'all' && storySourceFilter === 'all', onClick: () => { setStoryKindFilter('all'); setStorySourceFilter('all') } },
                        { icon: <BankOutlined />, tone: 'info' as const, title: 'SMME Stories', value: stories.filter(item => (item.storyKind || 'SMME') === 'SMME').length, active: storyKindFilter === 'SMME', onClick: () => setStoryKindFilter(storyKindFilter === 'SMME' ? 'all' : 'SMME') },
                        { icon: <CalendarOutlined />, tone: 'info' as const, title: 'Event Stories', value: stories.filter(item => item.storyKind === 'Event').length, active: storyKindFilter === 'Event', onClick: () => setStoryKindFilter(storyKindFilter === 'Event' ? 'all' : 'Event') }
                    ] : [
                        { icon: <ProfileOutlined />, tone: 'accent' as const, title: 'Total Challenges', value: challenges.length, active: statusFilter === 'all', onClick: () => setStatusFilter('all') },
                        { icon: <ExclamationCircleOutlined />, tone: 'warning' as const, title: 'Open', value: statusCount('Open'), active: statusFilter === 'Open', onClick: () => setStatusFilter(statusFilter === 'Open' ? 'all' : 'Open') },
                        { icon: <SyncOutlined />, tone: 'info' as const, title: 'In Progress', value: statusCount('In Progress'), active: statusFilter === 'In Progress', onClick: () => setStatusFilter(statusFilter === 'In Progress' ? 'all' : 'In Progress') },
                        { icon: <CheckCircleOutlined />, tone: 'success' as const, title: 'Resolved', value: statusCount('Resolved'), active: statusFilter === 'Resolved', onClick: () => setStatusFilter(statusFilter === 'Resolved' ? 'all' : 'Resolved') },
                        { icon: <LockOutlined />, tone: 'neutral' as const, title: 'Closed', value: statusCount('Closed'), active: statusFilter === 'Closed', onClick: () => setStatusFilter(statusFilter === 'Closed' ? 'all' : 'Closed') }
                    ]).map(metric => (
                        <Col xs={24} sm={12} xl={segment === 'stories' ? 8 : undefined} className={segment === 'stories' ? undefined : 'metric-col-5'} key={metric.title}>
                            <MetricTile icon={metric.icon} tone={metric.tone} title={metric.title} value={metric.value} onClick={metric.onClick} wrapperStyle={metric.active ? { border: '1px solid var(--app-accent, #1677ff)', boxShadow: '0 4px 14px rgba(22,119,255,0.15)' } : undefined} />
                        </Col>
                    ))}
                </Row>

                <DashboardFilterBar>
                    <Segmented<PageSegment>
                        block
                        value={segment}
                        onChange={value => setSegment(value as PageSegment)}
                        options={[
                            { label: 'Success Stories', value: 'stories', icon: <TrophyOutlined /> },
                            { label: 'Challenges', value: 'challenges', icon: <WarningOutlined /> }
                        ]}
                    />
                </DashboardFilterBar>

                <div>
                    {segment === 'stories' ? (
                        <MotionCard
                            filterBar={
                                <div className='success-page-filters story-library-filters'>
                                    <Input aria-label='Search success stories' allowClear prefix={<SearchOutlined />} placeholder='Search stories...' value={storySearchText} onChange={event => setStorySearchText(event.target.value)} />
                                    <Select aria-label='Story source' value={storySourceFilter} onChange={setStorySourceFilter} options={[{ value: 'all', label: 'All sources' }, { value: 'SME', label: 'SME submitted' }, { value: 'Department', label: 'Department submitted' }]} />
                                    <Button block icon={<ClearOutlined />} onClick={resetStoryFilters}>Reset</Button>
                                    <Button block type='primary' icon={<PlusOutlined />} disabled={loading} onClick={openStoryModal}>Add Story or Event</Button>
                                </div>
                            }
                            filterBarProps={{ className: 'success-page-filter-container' }}
                        >
                            {filteredStories.length ? (
                                <Row gutter={[16, 16]}>{filteredStories.map(record => <Col xs={24} md={12} xl={8} key={record.id}>{renderStoryCard(record)}</Col>)}</Row>
                            ) : (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No success stories match these filters'>
                                    <Button type='primary' icon={<PlusOutlined />} disabled={loading} onClick={() => { resetStoryFilters(); openStoryModal() }}>Create the first story or event</Button>
                                </Empty>
                            )}
                        </MotionCard>
                    ) : (
                        <Row gutter={[16, 16]}>
                            {totalChallenges > 0 && (
                                <Col xs={24} xl={8}>
                                    <MotionCard>
                                        <Space direction='vertical' size={20} style={{ width: '100%' }}>
                                            <Typography.Text type='secondary'>{totalChallenges} challenges in total</Typography.Text>
                                            {challengeStatusData.map(item => <div key={item.name} aria-label={`${item.name}: ${item.y} challenges`}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><Typography.Text>{item.name}</Typography.Text><Typography.Text strong>{item.y}</Typography.Text></div>
                                                <div aria-hidden='true' style={{ height: 10, borderRadius: 5, background: token.colorFillSecondary, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${item.y / largestStatusCount * 100}%`, borderRadius: 5, background: item.color }} />
                                                </div>
                                            </div>)}
                                        </Space>
                                    </MotionCard>
                                </Col>
                            )}
                            <Col xs={24} xl={totalChallenges > 0 ? 16 : 24}>
                                <MotionCard
                                    filterBarProps={{ className: 'success-page-filter-container' }}
                                    filterBar={
                                        <div className='success-page-filters challenge-library-filters'>
                                            <Input aria-label='Search challenges' allowClear prefix={<SearchOutlined />} placeholder='Search challenges...' value={challengeSearchText} onChange={event => setChallengeSearchText(event.target.value)} />
                                            <Select aria-label='Nature of challenge' value={challengeTypeFilter} onChange={setChallengeTypeFilter} options={[{ value: 'all', label: 'All natures of challenge' }, ...challengeTypes.map(type => ({ value: type, label: type }))]} />
                                            <Button block icon={<ClearOutlined />} onClick={resetChallengeFilters}>Reset</Button>
                                            <Button block type='primary' icon={<PlusOutlined />} onClick={() => openChallengeModal()}>Add Challenge</Button>
                                        </div>
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

            <StoryReaderModal
                story={selectedStory}
                sections={selectedStory ? getStorySections(selectedStory).filter(([, value]) => clean(value)).map(([label, value]) => [String(label), String(value)] as [string, string]) : []}
                cover={selectedStory ? storyCover(selectedStory) : ''}
                subtitle={selectedStory ? [selectedStory.storyKind === 'Event' ? selectedStory.eventTitle : selectedStory.smeName, selectedStory.createdAt ? `Captured ${formatDateTime(selectedStory.createdAt)}` : ''].filter(Boolean).join(' · ') : ''}
                onClose={() => setSelectedStory(null)}
            />

            {eventsError && <Alert type='error' showIcon message='Recorded events could not be loaded. You can still add an event story by entering the event details manually.' />}
            <Modal title='Create Success Story' className='story-create-modal' open={storyModalOpen} onCancel={closeStoryModal} footer={null} width={900} destroyOnClose>
                {storyStep >= 0 && <div style={{ background: '#f5f7fb', borderRadius: 12, padding: '10px 14px', marginBottom: 18 }}>
                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}><Typography.Text strong>Story completeness</Typography.Text><Typography.Text>{completedStoryFields} of {requiredStoryFields.length} required sections</Typography.Text></Space>
                        <Progress percent={storyCompletionPercent} size='small' status={storyCompletionPercent === 100 ? 'success' : 'active'} />
                    </Space>
                </div>}
                <Form form={successForm} layout='vertical' onFinish={() => handleStorySubmit(successForm.getFieldsValue(true))} initialValues={{ storyKind: 'SMME' }}>
                    <Form.Item name='storyKind' hidden><Input /></Form.Item>
                    {storyStep === -1 && <div style={{ padding: '16px 0 8px' }}>
                        <StoryTypeQuestion />
                        <Paragraph type='secondary'>Choose a business journey or an event worth sharing.</Paragraph>
                        <Row gutter={[16, 16]}>
                            {([
                                { kind: 'SMME', title: 'An SMME success', description: 'Celebrate a business achievement and the support behind it.', icon: <BankOutlined /> },
                                { kind: 'Event', title: 'An event success', description: 'Share who came together, what happened and the outcomes.', icon: <CalendarOutlined /> }
                            ] as const).map(option => <Col xs={24} sm={12} key={option.kind}>
                                <Button block onClick={() => {
                                    if (storyKind !== option.kind) {
                                        successForm.resetFields()
                                        setSelectedParticipantId(undefined)
                                        setInterventions([])
                                        setStorySourceContext(null)
                                    }
                                    successForm.setFieldValue('storyKind', option.kind)
                                    setStoryStep(0)
                                }} className='story-type-card'>
                                    <span className='story-type-card-icon'>{option.icon}</span>
                                    <span className='story-type-card-copy'>
                                        <Typography.Text strong>{option.title}</Typography.Text>
                                        <Typography.Text type='secondary'>{option.description}</Typography.Text>
                                    </span>
                                    <ArrowRightOutlined className='story-type-card-arrow' />
                                </Button>
                            </Col>)}
                        </Row>
                    </div>}
                    {storyStep === 0 && <>
                        <Typography.Title level={4}>Tell us about {storyKind === 'Event' ? 'the event' : 'the business and its success'}.</Typography.Title>
                        {storyKind === 'Event' && <Form.Item label='Link a recorded event (optional)' name='eventId'>
                            <Select allowClear showSearch optionFilterProp='label' placeholder={storyEvents.length ? 'Select a recorded event' : 'No recorded events - enter the event details below'} options={storyEvents.map(event => ({ value: event.id, label: `${event.title}${event.date ? ` · ${event.date}` : ''}` }))} onChange={id => {
                                const event = storyEvents.find(item => item.id === id)
                                successForm.setFieldsValue({ title: event?.title || '', eventBackground: event?.description || '', eventNature: natureFromFormat(event?.format) || successForm.getFieldValue('eventNature') })
                            }} />
                        </Form.Item>}
                        {storyKind === 'Event' && !storyFormValues.eventId && <Row gutter={12}>
                            <Col xs={24} sm={16}><Form.Item label='Event name' name='eventTitle' rules={[{ required: true, whitespace: true, message: 'Enter the event name' }]}><Input placeholder='E.g. AI Skills Online Training' /></Form.Item></Col>
                            <Col xs={24} sm={8}><Form.Item label='Event date' name='eventDate'><DatePicker style={{ width: '100%' }} format='YYYY-MM-DD' disabledDate={current => !!current && current.isAfter(dayjs(), 'day')} /></Form.Item></Col>
                        </Row>}
                        {storyKind === 'Event' && <Form.Item label='Nature of the event' name='eventNature' rules={[{ required: true, message: 'Select how the event was held' }]}><EventNatureCards /></Form.Item>}
                        <Form.Item label='Story title' name='title' rules={[{ required: true, whitespace: true, message: 'Add a clear story title' }]}><Input placeholder={storyKind === 'Event' ? 'E.g. Supplier Readiness Day connects SMMEs to buyers' : 'E.g. Safe Lifestyle grows turnover after incubation support'} /></Form.Item>
                        {storyKind !== 'Event' && <Form.Item label='SME' name='participantId' rules={[{ required: true, message: 'Select an SME' }]}><Select showSearch placeholder='Select an SME with completed interventions' optionFilterProp='label' loading={loading} onChange={value => { setSelectedParticipantId(value); successForm.setFieldValue('interventionId', undefined) }} options={smes.map(item => ({ label: item.companyName, value: item.participantId }))} notFoundContent='No SMEs with SME-confirmed interventions were found for this department.' /></Form.Item>}
                        {storyKind !== 'Event' && <Form.Item label='SME-confirmed intervention' name='interventionId' rules={[{ required: true, message: 'Select a confirmed intervention' }]}><Select showSearch placeholder='Select confirmed intervention' optionFilterProp='search' optionLabelProp='selectedLabel' disabled={!selectedParticipantId} options={interventions.map(item => ({ selectedLabel: item.interventionTitle, search: `${item.interventionTitle} ${item.departmentName || ''} ${(item.monthTags || []).join(' ')}`, label: <Space direction='vertical' size={2}><span>{item.interventionTitle}{item.departmentName ? ` - ${item.departmentName}` : ''}</span><Space size={4} wrap>{(item.occurrenceCount || 0) > 1 && <Tag color='blue'>{item.occurrenceCount} sessions</Tag>}{(item.monthTags || []).slice(0, 4).map(month => <Tag key={month}>{month}</Tag>)}</Space></Space>, value: item.id }))} /></Form.Item>}
                    </>}
                    {storyStep === 1 && (storyKind !== 'Event' ? <>
                        {selectedSme && <Alert showIcon type='success' style={{ marginBottom: 16 }} message='Prefilled from SME records' description={<Space direction='vertical' size={8}><span>Review the sourced draft and edit anything that needs context.</span><Button size='small' icon={<RobotOutlined />} loading={draftingStory} onClick={handleAiStoryDraft}>Prepare improved draft with AI</Button></Space>} />}
                        <Form.Item label={<span>Background on the SMME <Tag color='blue'>From SME records</Tag></span>} name='background' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='What the business does, when it started, sector, founder and relevant context.' /></Form.Item>
                        <Form.Item label={<span>{crossDepartmentStoryView ? 'Journey with Lepharo' : `How ${storyDepartmentLabel} supported the SMME`} <Tag color='blue'>From SME-confirmed interventions</Tag></span>} name='lepharoJourney' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder={crossDepartmentStoryView ? 'When the SMME joined, completed interventions and current position.' : `Describe the SME-confirmed interventions serviced by ${storyDepartmentLabel} and how they supported progress.`} /></Form.Item>
                        <Form.Item label='Detailed achievement' name='achievement' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='Describe the award, contract, funding, turnover growth, jobs or other measurable result.' /></Form.Item>
                        <Form.Item label="How did this support help make the achievement possible?" extra="Connect the support to the result rather than listing interventions again. If the achievement was independent of the support, say so." name='lepharoRole' rules={[{ required: true, whitespace: true }]}><TextArea rows={3} placeholder='E.g. The legal advice helped the business meet the contract requirements and secure its first supply agreement.' /></Form.Item>
                    </> : <>
                        <Form.Item label='Event background' name='eventBackground' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='When and why it was hosted or attended, intended beneficiaries and immediate outcomes.' /></Form.Item>
                        <Card size='small' title='Invited participants' extra={<Tag color='blue'>{eventInvitees.length} invited</Tag>} style={{ marginBottom: 24 }}>
                            <Paragraph type='secondary'>From the selected event’s invitation list. This count does not confirm attendance.</Paragraph>
                            <div style={{ maxHeight: 180, overflowY: 'auto' }}><Space wrap>{eventInvitees.map(person => <Tag key={person.key}>{person.label}</Tag>)}</Space></div>
                            {!eventInvitees.length && <Typography.Text type='secondary'>No invitees recorded for this event.</Typography.Text>}
                        </Card>
                        <Form.Item label='Benefits and long-term outcomes' name='eventBenefits' rules={[{ required: true, whitespace: true }]}><TextArea rows={4} placeholder='Benefits, follow-on opportunities and expected long-term outcomes.' /></Form.Item>
                    </>)}
                    {storyStep === 2 && <>
                        <Typography.Title level={4}>Add images to your story</Typography.Title>
                        <Form.Item label='Images (optional)' name='images' valuePropName='fileList' getValueFromEvent={e => e?.fileList || []}>
                            <Upload.Dragger className='story-images-upload' beforeUpload={file => {
                                if (file.type.startsWith('image/')) return false
                                message.error('Please choose an image file.')
                                return Upload.LIST_IGNORE
                            }} multiple accept='image/*' listType='picture-card'>
                                <Space><UploadOutlined style={{ fontSize: 20 }} /><span>Drop images here or click to browse</span></Space>
                            </Upload.Dragger>
                        </Form.Item>
                        {storyKind !== 'Event' && <Form.Item label="SME's comment or testimonial (optional)" name='smeComment'><TextArea rows={3} placeholder='Capture the SME comment or testimonial.' /></Form.Item>}
                    </>}
                    {storyStep === 3 && <div className='story-review'>
                        <Typography.Title level={4}>Ready to share your story?</Typography.Title>
                        <Paragraph type='secondary'>Review the details below. Use Back to make changes before publishing.</Paragraph>
                        <Card style={{ borderRadius: 12 }}>
                            <Space wrap><Tag color={storyKind === 'Event' ? 'purple' : 'blue'}>{storyKind} success story</Tag><Typography.Text type='secondary'>{storyKind === 'Event' ? selectedEvent?.title || storyFormValues.eventTitle : selectedSme?.companyName}</Typography.Text></Space>
                            <Typography.Title level={3}>{storyFormValues.title}</Typography.Title>
                            {storyKind === 'Event' ? <>
                                <Paragraph type='secondary'>{[selectedEvent?.date || (storyFormValues.eventDate ? dayjs(storyFormValues.eventDate).format('YYYY-MM-DD') : ''), selectedEvent?.location].filter(Boolean).join(' · ')}</Paragraph>
                                {storyFormValues.eventNature && <Tag color='geekblue'>{storyFormValues.eventNature}</Tag>}
                                <Tag>{eventInvitees.length} invited participants</Tag>
                            </> : <Tag style={{ whiteSpace: 'normal' }}>{interventions.find(item => item.id === storyFormValues.interventionId)?.interventionTitle}</Tag>}
                            <Divider />
                            {(storyKind === 'Event' ? [
                                ['Event background', storyFormValues.eventBackground],
                                ['Invited participants', eventInvitees.map(person => person.label).join(', ') || 'No invitees recorded'],
                                ['Benefits and long-term outcomes', storyFormValues.eventBenefits]
                            ] : [
                                ['SMME background', storyFormValues.background],
                                [crossDepartmentStoryView ? 'Journey with Lepharo' : `Support from ${storyDepartmentLabel}`, storyFormValues.lepharoJourney],
                                ['Achievement', storyFormValues.achievement],
                                ['How the support helped', storyFormValues.lepharoRole],
                                ['SME comment', storyFormValues.smeComment]
                            ]).filter(([, content]) => !!content).map(([label, content]) => <section key={label} style={{ marginBottom: 20 }}>
                                <Typography.Text strong>{label}</Typography.Text><Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{content}</Paragraph>
                            </section>)}
                            <Divider />
                            <Typography.Text strong>Images</Typography.Text>
                            <StoryImagePreview files={storyFormValues.images || []} />
                        </Card>
                    </div>}
                    <Row gutter={12} style={{ marginTop: 20 }}>
                        <Col span={storyStep === -1 ? 24 : 8}><Button block icon={storyStep === -1 ? <CloseOutlined /> : <ArrowLeftOutlined />} onClick={storyStep === -1 ? closeStoryModal : () => setStoryStep(current => current - 1)}>{storyStep === -1 ? 'Cancel' : 'Back'}</Button></Col>
                        {storyStep >= 0 && <Col span={16}>{storyStep < 3 ? <Button block type='primary' icon={storyStep === 2 ? <EyeOutlined /> : <ArrowRightOutlined />} iconPosition='end' onClick={goToNextStoryStep}>{storyStep === 2 ? 'Review story' : 'Continue'}</Button> : <Button block type='primary' loading={savingStory} icon={<PlusOutlined />} onClick={() => successForm.submit()}>Publish Success Story</Button>}</Col>}
                    </Row>
                </Form>
            </Modal>

            <ChallengeFormModal
                open={challengeModalOpen}
                editing={!!editingChallenge}
                saving={savingChallenge}
                initialValues={challengeInitial}
                smes={challengeSmes}
                statuses={challengeStatuses}
                channels={communicationChannelOptions}
                items={communicationItemOptions}
                onCancel={closeChallengeModal}
                onSubmit={handleChallengeSubmit}
            />

            <ChallengeCheckInModal
                open={!!checkInChallenge}
                saving={savingCheckIn}
                challenge={checkInChallenge}
                onCancel={() => setCheckInChallenge(null)}
                onSubmit={handleCheckInSubmit}
            />

            <StoryReaderModal
                story={viewChallenge ? { title: viewChallenge.title, attachments: [] } : null}
                modalTitle='Challenge'
                sections={viewChallenge ? getChallengeSections(viewChallenge) : []}
                cover=''
                subtitle={viewChallenge ? [viewChallenge.departmentName, viewChallenge.createdAt ? `Logged ${formatDateTime(viewChallenge.createdAt)}` : ''].filter(Boolean).join(' · ') : ''}
                tags={viewChallenge ? <>
                    <Tag color={viewChallenge.challengeType === 'Unresponsive SMEs' ? 'volcano' : 'gold'}>{viewChallenge.challengeType || 'General'}</Tag>
                    <Tag color={isClosedStatus(viewChallenge.status) ? 'green' : viewChallenge.status === 'In Progress' ? 'blue' : 'gold'}>{viewChallenge.status || 'Open'}</Tag>
                </> : undefined}
                outcomeLabels={['Proposed mitigation']}
                celebrate={!!viewChallenge && isClosedStatus(viewChallenge.status)}
                finaleHeading={viewChallenge && isClosedStatus(viewChallenge.status) ? 'Challenge resolved' : 'That is the full picture'}
                onClose={() => setViewChallenge(null)}
            />
        </div>
    )
}

export default SuccessChallengesPage
