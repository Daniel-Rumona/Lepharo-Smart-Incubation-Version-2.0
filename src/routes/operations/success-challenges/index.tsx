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
    Table,
    Tag,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import './success-story.css'
import { listEvents, type EventRecord } from '@/services/eventService'
import { getStoryInvitees } from './storyEvent'
import type { ColumnsType } from 'antd/es/table'
import {
    AppstoreOutlined,
    BarsOutlined,
    BankOutlined,
    CalendarOutlined,
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
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'

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
    eventId?: string
    eventTitle?: string
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
    const [challengeForm] = Form.useForm()
    const challengeType = Form.useWatch('challengeType', challengeForm) as ChallengeType | undefined
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
        let cancelled = false
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
        setStoryStep(storyEvents.length ? -1 : 0)
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
        if (storyStep !== 3 || savingStory) return
        const isEvent = values.storyKind === 'Event'
        if (!user || (!isEvent && !selectedSme)) return
        const event = isEvent ? storyEvents.find(item => item.id === values.eventId) : undefined
        if (isEvent && !event) {
            message.error('Select an available event before publishing.')
            setStoryStep(0)
            return
        }
        const invitees = getStoryInvitees(event)
        const eventFields = isEvent ? {
            eventId: event!.id,
            eventTitle: event!.title,
            eventDate: event!.date || null,
            invitedParticipants: invitees,
            attendees: invitees.map(person => person.label).join(', '),
            attendeeCount: invitees.length,
            attendeeCountBasis: 'invited' as const
        } : {}
        const departmentId = event?.departmentId || null
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
        setStoryStep(-1)
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
        return (
            <div className='story-reader-sections'>
                {sections.filter(([, value]) => clean(value)).map(([label, value]) => {
                    const isOutcome = label === 'Achievement' || label === 'Benefits and long-term outcomes'
                    return <Card key={label} size='small' className={isOutcome ? 'story-reader-section story-reader-outcome' : 'story-reader-section'} style={isOutcome ? { background: token.colorPrimaryBg, borderColor: token.colorPrimaryBorder } : undefined}>
                        <Typography.Title level={5} style={{ margin: '0 0 10px' }}>{label}</Typography.Title>
                        <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{value}</Paragraph>
                    </Card>
                })}
                {!!record.attachments?.length && <section className='story-reader-gallery'>
                    <Typography.Title level={5} style={{ margin: '0 0 12px' }}>Images and supporting files</Typography.Title>
                    <Image.PreviewGroup>
                        <div className='story-image-row'>
                            {record.attachments.map(file => file.type?.startsWith('image/') ? (
                                <Image key={file.url} src={file.url} alt={file.name} width={120} height={90} style={{ objectFit: 'cover', borderRadius: 8 }} />
                            ) : (
                                <Button key={file.url} href={file.url} target='_blank' icon={<FilePdfOutlined />}>{file.name}</Button>
                            ))}
                        </div>
                    </Image.PreviewGroup>
                </section>}
            </div>
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
        ? ['storyKind', 'eventId', 'title', 'eventBackground', 'eventBenefits']
        : ['storyKind', 'title', 'participantId', 'interventionId', 'background', 'lepharoJourney', 'achievement', 'lepharoRole']
    const completedStoryFields = requiredStoryFields.filter(field => {
        const value = storyFormValues[field]
        return Array.isArray(value) ? value.length > 0 : !!clean(value)
    }).length
    const storyCompletionPercent = Math.round((completedStoryFields / requiredStoryFields.length) * 100)

    const storyStepFields = () => {
        if (storyStep === 0) return storyKind === 'Event'
            ? ['storyKind', 'eventId', 'title']
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
                            <MotionCard.Metric icon={metric.icon} iconBg={metric.bg} title={metric.title} value={metric.value} />
                        </Col>
                    ))}
                </Row>

                <DashboardFilterBar>
                    <Segmented<PageSegment>
                        block
                        value={segment}
                        onChange={value => setSegment(value as PageSegment)}
                        options={[
                            { label: 'Success Stories', value: 'stories' },
                            { label: 'Challenges', value: 'challenges' }
                        ]}
                    />
                </DashboardFilterBar>

                <div>
                    {segment === 'stories' ? (
                        <MotionCard
                            filterBar={
                                <div className='success-page-filters story-library-filters'>
                                    <Input aria-label='Search success stories' allowClear prefix={<SearchOutlined />} placeholder='Search stories...' value={storySearchText} onChange={event => setStorySearchText(event.target.value)} />
                                    <Select aria-label='Story type' value={storyKindFilter} onChange={setStoryKindFilter} options={[{ value: 'all', label: 'All story types' }, { value: 'SMME', label: 'SMME stories' }, { value: 'Event', label: 'Event stories' }]} />
                                    <Select aria-label='Story source' value={storySourceFilter} onChange={setStorySourceFilter} options={[{ value: 'all', label: 'All sources' }, { value: 'SME', label: 'SME submitted' }, { value: 'Department', label: 'Department submitted' }]} />
                                    <Segmented block value={storyView} onChange={value => setStoryView(value as 'cards' | 'table')} options={[{ value: 'cards', icon: <AppstoreOutlined />, label: 'Cards' }, { value: 'table', icon: <BarsOutlined />, label: 'Table' }]} />
                                    <Button block icon={<ClearOutlined />} onClick={resetStoryFilters}>Reset</Button>
                                    <Button block type='primary' icon={<PlusOutlined />} loading={eventsLoading} disabled={loading || eventsError} onClick={openStoryModal}>Add Story</Button>
                                </div>
                            }
                            filterBarProps={{ className: 'success-page-filter-container' }}
                            title='Success Story Library'>
                            {filteredStories.length ? storyView === 'cards' ? (
                                <Row gutter={[16, 16]}>{filteredStories.map(record => <Col xs={24} md={12} xl={8} key={record.id}>{renderStoryCard(record)}</Col>)}</Row>
                            ) : (
                                <Table rowKey='id' columns={storyColumns} dataSource={filteredStories} loading={loading} scroll={{ x: 920 }} expandable={{ expandedRowRender: storyDetails }} pagination={{ pageSize: 8 }} />
                            ) : (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No success stories match these filters'>
                                    <Button type='primary' icon={<PlusOutlined />} loading={eventsLoading} disabled={loading || eventsError} onClick={() => { resetStoryFilters(); openStoryModal() }}>Create the first story</Button>
                                </Empty>
                            )}
                        </MotionCard>
                    ) : (
                        <Row gutter={[16, 16]}>
                            {totalChallenges > 0 && (
                                <Col xs={24} xl={8}>
                                    <MotionCard title='Challenge Status'>
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
                                    title='Logged Challenges'
                                    filterBarProps={{ className: 'success-page-filter-container' }}
                                    filterBar={
                                        <div className='success-page-filters challenge-library-filters'>
                                            <Input aria-label='Search challenges' allowClear prefix={<SearchOutlined />} placeholder='Search challenges...' value={challengeSearchText} onChange={event => setChallengeSearchText(event.target.value)} />
                                            <Select aria-label='Challenge status' value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All statuses' }, ...challengeStatuses.map(status => ({ value: status, label: status }))]} />
                                            <Select aria-label='Challenge type' value={challengeTypeFilter} onChange={setChallengeTypeFilter} options={[{ value: 'all', label: 'All challenge types' }, ...challengeTypes.map(type => ({ value: type, label: type }))]} />
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

            <Modal title='Success story' className='story-reader-modal' open={!!selectedStory} onCancel={() => setSelectedStory(null)} footer={<Button onClick={() => setSelectedStory(null)}>Close</Button>} width={920}>
                {selectedStory && <article className='story-reader'>
                    <header>
                        <Typography.Title level={2} style={{ margin: '4px 0 8px', overflowWrap: 'anywhere' }}>{selectedStory.title || selectedStory.smeName}</Typography.Title>
                        <Typography.Text type='secondary'>{[selectedStory.storyKind === 'Event' ? selectedStory.eventTitle : selectedStory.smeName, selectedStory.createdAt ? `Captured ${formatDateTime(selectedStory.createdAt)}` : ''].filter(Boolean).join(' · ')}</Typography.Text>
                    </header>
                    {storyCover(selectedStory) && <div className='story-reader-cover' style={{ background: token.colorFillAlter }}>
                        <Image src={storyCover(selectedStory)} alt={`${selectedStory.title || selectedStory.smeName} cover`} width='100%' style={{ display: 'block', maxHeight: 360, objectFit: 'contain' }} />
                    </div>}
                    <div className='story-reader-meta'>
                        <Tag color={selectedStory.storyKind === 'Event' ? 'purple' : 'blue'}>{selectedStory.storyKind || 'SMME'}</Tag>
                        <Tag color={selectedStory.source === 'SME' ? 'cyan' : 'gold'}>{selectedStory.source || 'Department'} submitted</Tag>
                        {selectedStory.departmentName && <Tag>{selectedStory.departmentName}</Tag>}
                        {selectedStory.interventionTitle && <Tag>{selectedStory.interventionTitle}</Tag>}
                    </div>
                    {storyDetails(selectedStory)}
                </article>}
            </Modal>

            {eventsError && <Alert type='error' showIcon message='Events could not be loaded. Refresh the page to try again before creating a story.' />}
            <Modal title='Create Success Story' open={storyModalOpen} onCancel={closeStoryModal} footer={null} width={900} destroyOnClose>
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
                            ] as const).filter(option => option.kind !== 'Event' || storyEvents.length > 0).map(option => <Col xs={24} sm={12} key={option.kind}>
                                <Button block onClick={() => {
                                    if (storyKind !== option.kind) {
                                        successForm.resetFields()
                                        setSelectedParticipantId(undefined)
                                        setInterventions([])
                                        setStorySourceContext(null)
                                    }
                                    successForm.setFieldValue('storyKind', option.kind)
                                    setStoryStep(0)
                                }} style={{ height: 'auto', minHeight: 160, padding: 24, textAlign: 'left', whiteSpace: 'normal', borderRadius: 12 }}>
                                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                        <span style={{ fontSize: 28, color: '#1677ff' }}>{option.icon}</span>
                                        <Typography.Text strong>{option.title}</Typography.Text>
                                        <Typography.Text type='secondary'>{option.description}</Typography.Text>
                                    </Space>
                                </Button>
                            </Col>)}
                        </Row>
                    </div>}
                    {storyStep === 0 && <>
                        <Typography.Title level={4}>Tell us about {storyKind === 'Event' ? 'the event' : 'the business and its success'}.</Typography.Title>
                        {storyKind === 'Event' && <Form.Item label='Which event is this story about?' name='eventId' rules={[{ required: true, message: 'Select a recorded event' }]}>
                            <Select showSearch optionFilterProp='label' placeholder='Select an event' options={storyEvents.map(event => ({ value: event.id, label: `${event.title}${event.date ? ` · ${event.date}` : ''}` }))} onChange={id => {
                                const event = storyEvents.find(item => item.id === id)
                                successForm.setFieldsValue({ title: event?.title || '', eventBackground: event?.description || '' })
                            }} />
                        </Form.Item>}
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
                            <Space wrap><Tag color={storyKind === 'Event' ? 'purple' : 'blue'}>{storyKind} success story</Tag><Typography.Text type='secondary'>{storyKind === 'Event' ? selectedEvent?.title : selectedSme?.companyName}</Typography.Text></Space>
                            <Typography.Title level={3}>{storyFormValues.title}</Typography.Title>
                            {storyKind === 'Event' ? <>
                                <Paragraph type='secondary'>{[selectedEvent?.date, selectedEvent?.location].filter(Boolean).join(' · ')}</Paragraph>
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
                        <Col span={storyStep === -1 ? 24 : 8}><Button block onClick={(storyStep === -1 || (storyStep === 0 && !storyEvents.length)) ? closeStoryModal : () => setStoryStep(current => current - 1)}>{storyStep === -1 || (storyStep === 0 && !storyEvents.length) ? 'Cancel' : 'Back'}</Button></Col>
                        {storyStep >= 0 && <Col span={16}>{storyStep < 3 ? <Button block type='primary' onClick={goToNextStoryStep}>{storyStep === 2 ? 'Review story' : 'Continue'}</Button> : <Button block type='primary' loading={savingStory} icon={<PlusOutlined />} onClick={() => successForm.submit()}>Publish Success Story</Button>}</Col>}
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
