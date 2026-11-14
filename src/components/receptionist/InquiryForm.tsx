import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
    Form,
    Input,
    Select,
    DatePicker,
    Button,
    Card,
    Row,
    Col,
    Space,
    message,
    Switch,
    Checkbox,
    Typography,
    Steps,
    theme
} from 'antd'
import {
    SaveOutlined,
    ClearOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
    UserOutlined,
    IdcardOutlined,
    MessageOutlined,
    FlagOutlined,
    BellOutlined,
    RightOutlined,
    TeamOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    MinusOutlined,
    FireOutlined,
    InfoCircleOutlined,
    StarOutlined,
    PhoneOutlined,
    MailOutlined,
    EnvironmentOutlined,
    VideoCameraOutlined,
    RocketOutlined,
    BankOutlined,
    ApartmentOutlined,
    ContactsOutlined,
    SearchOutlined,
    CheckCircleOutlined,
    CalendarOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
    InquiryFormData,
    InquiryType,
    InquiryPriority,
    BusinessStage,
    BudgetRange,
    Timeline,
    FollowUpMethod,
    INQUIRY_VALIDATION
} from '@/types/inquiry'
import { inquiryService } from '@/services/inquiryService'
import { useAuth } from '@/hooks/useAuth'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    getDoc,
    doc
} from 'firebase/firestore'
import { db } from '@/firebase'
import {
    MANUAL_CHANNELS,
    channelLabel,
    resolveInquiryChannel
} from '@/utils/inquirySource'
import {
    CONTACT_TYPE_HINT,
    CONTACT_TYPE_LABEL,
    INQUIRY_CONTACT_TYPES,
    INQUIRY_TYPES_FOR,
    asksBusinessDetails,
    needsDepartment,
    needsOrganisation,
    sourceTypeFor,
    asksScreening,
    classificationFor,
    visitPurposesFor,
    VISIT_PURPOSE_LABEL,
    VISIT_PURPOSE_HINT,
    type InquiryContactType,
    type VisitPurpose
} from '@/lib/inquiryContactTypes'
import { contactService } from '@/services/contactService'
import { buildContactDirectory, contactEmail, contactPhone, type DirectoryContact } from '@/lib/contactDirectory'

const { TextArea } = Input
const { Text } = Typography
const { Option } = Select

type SourceType = 'Incubatee' | 'Non-Incubatee'

interface InquiryFormProps {
    initialData?: Partial<InquiryFormData>
    inquiryId?: string
    onSuccess?: () => void
    embedded?: boolean
    stepped?: boolean
    /** Edit mode: open on cards for each section, edit one section at a time. */
    sectioned?: boolean
    /** Show the Contact / Inquiry / Follow-up indicator above a stepped form. */
    showSteps?: boolean
    /** A modal's footer element: the form's buttons render there instead of in a sticky bar. */
    footerContainer?: HTMLElement | null
    forcedProgramId?: string
    forcedProgramName?: string
}

interface Program {
    id: string
    name: string
    isActive?: boolean
}

const ACCEPTED_VALUES = ['accepted', 'approved', 'Accepted', 'Approved', true]

type SectionKey = 'who' | 'contact' | 'inquiry' | 'management' | 'followup'

const STEP_TITLES = ['Contact', 'Inquiry', 'Follow-up']

const SECTION_STEP: Record<SectionKey, number> = { who: 0, contact: 0, inquiry: 1, management: 1, followup: 2 }

const SECTION_FIELDS: Record<SectionKey, string[]> = {
    who: ['sourceTypeInternal', 'source', 'smeParticipantId'],
    // Who it is from and the contact details depend on each other, so editing shares one section.
    contact: ['sourceTypeInternal', 'source', 'smeParticipantId', 'firstName', 'lastName', 'email', 'phone'],
    inquiry: ['inquiryType', 'departmentId', 'description'],
    management: ['priority'],
    followup: ['nextFollowUpDate', 'followUpMethod', 'followUpNotes']
}

const SECTION_CARDS: { key: SectionKey; title: string; hint: string; icon: React.ReactNode }[] = [
    { key: 'contact', title: 'Contact', hint: 'Who it is from, how they reached us and their details', icon: <IdcardOutlined /> },
    { key: 'inquiry', title: 'Inquiry', hint: 'What they are asking for', icon: <MessageOutlined /> },
    { key: 'management', title: 'Priority', hint: 'How urgent it is', icon: <FlagOutlined /> },
    { key: 'followup', title: 'Follow-up', hint: 'Next touchpoint', icon: <BellOutlined /> }
]

type CardOption = { value: string; label: string; icon: React.ReactNode; color?: string }

const CONTACT_TYPE_ICON: Record<InquiryContactType, React.ReactNode> = {
    Incubatee: <TeamOutlined />,
    'Potential Incubatee': <RocketOutlined />,
    Funder: <BankOutlined />,
    Stakeholder: <ApartmentOutlined />,
    Visitor: <UserOutlined />
}

// Who the inquiry is from; each type shapes the rest of the form (lib/inquiryContactTypes).
const CONTACT_TYPE_CARDS: CardOption[] = INQUIRY_CONTACT_TYPES.map(type => ({
    value: type,
    label: CONTACT_TYPE_LABEL[type],
    icon: CONTACT_TYPE_ICON[type]
}))

const isContactTypeValue = (value: unknown): value is InquiryContactType =>
    typeof value === 'string' && (INQUIRY_CONTACT_TYPES as readonly string[]).includes(value)

const PRIORITY_CARDS: CardOption[] = [
    { value: 'Low', label: 'Low', icon: <ArrowDownOutlined />, color: '#8c8c8c' },
    { value: 'Medium', label: 'Medium', icon: <MinusOutlined />, color: '#1677ff' },
    { value: 'High', label: 'High', icon: <ArrowUpOutlined />, color: '#fa8c16' },
    { value: 'Urgent', label: 'Urgent', icon: <FireOutlined />, color: '#ff4d4f' }
]


const FOLLOW_UP_METHOD_CARDS: CardOption[] = [
    { value: 'Phone', label: 'Phone', icon: <PhoneOutlined /> },
    { value: 'Email', label: 'Email', icon: <MailOutlined /> },
    { value: 'In-person', label: 'In-person', icon: <EnvironmentOutlined /> },
    { value: 'Video Call', label: 'Video call', icon: <VideoCameraOutlined /> }
]

/** A short list of choices as one row of cards. Works as a Form.Item control. */
const CardSelect: React.FC<{
    value?: string
    onChange?: (value: string) => void
    options: CardOption[]
}> = ({ value, onChange, options }) => {
    const { token } = theme.useToken()

    return (
        <div
            role='radiogroup'
            style={{
                display: 'grid',
                // Up to four in one row; more (the contact types) wrap onto a second row on narrow screens.
                gridTemplateColumns:
                    options.length > 4 ? 'repeat(auto-fit, minmax(108px, 1fr))' : `repeat(${options.length}, minmax(0, 1fr))`,
                gap: 10
            }}
        >
            {options.map(option => {
                const active = value === option.value
                const accent = option.color || token.colorPrimary

                return (
                    <button
                        key={option.value}
                        type='button'
                        role='radio'
                        aria-checked={active}
                        onClick={() => onChange?.(option.value)}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            minWidth: 0,
                            padding: '12px 6px',
                            borderRadius: 12,
                            cursor: 'pointer',
                            font: 'inherit',
                            color: active ? accent : token.colorText,
                            border: `1px solid ${active ? accent : token.colorBorderSecondary}`,
                            background: active
                                ? `color-mix(in srgb, ${accent} 12%, transparent)`
                                : token.colorBgContainer,
                            boxShadow: active ? `0 0 0 1px ${accent}` : 'none',
                            transition: 'border-color .15s, background .15s, box-shadow .15s'
                        }}
                    >
                        <span style={{ fontSize: 20, lineHeight: 1 }}>{option.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, textAlign: 'center' }}>
                            {option.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

type SmeOption = {
    value: string
    label: string
    company: string
    email: string
    owner: string
}

type FormSectionProps = {
    icon: React.ReactNode
    title: string
    hint?: string
    extra?: React.ReactNode
    children?: React.ReactNode
}

const FormSection: React.FC<FormSectionProps> = ({ icon, title, hint, extra, children }) => {
    const { token } = theme.useToken()

    return (
        <section style={{ marginBottom: 12 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 20,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <span
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                        color: token.colorPrimary,
                        background: token.colorPrimaryBg,
                        fontSize: 16
                    }}
                >
                    {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 15, display: 'block', lineHeight: 1.25 }}>
                        {title}
                    </Text>
                    {hint ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {hint}
                        </Text>
                    ) : null}
                </div>
                {extra}
            </div>
            {children}
        </section>
    )
}

const InquiryForm: React.FC<InquiryFormProps> = ({
    initialData,
    inquiryId,
    onSuccess,
    embedded = false,
    stepped = false,
    sectioned = false,
    showSteps = false,
    forcedProgramId: forcedProgramIdProp,
    forcedProgramName,
    footerContainer
}) => {
    const [form] = Form.useForm()
    // The programme comes from the top bar; there is no separate selector.
    const { activeProgramId } = useActiveProgramId()
    const forcedProgramId = forcedProgramIdProp || activeProgramId || undefined
    const [loading, setLoading] = useState(false)
    const [requiresFollowUp, setRequiresFollowUp] = useState(false)
    const [sourceType, setSourceType] = useState<SourceType>('Non-Incubatee')
    // The finer contact type; sourceType (SME or not) follows from it.
    const [contactType, setContactTypeState] = useState<InquiryContactType>('Visitor')
    const [saveToContacts, setSaveToContacts] = useState(true)
    const setContactType = (type: InquiryContactType) => {
        setContactTypeState(type)
        setSourceType(sourceTypeFor(type))
    }
    const [programs, setPrograms] = useState<Program[]>([])
    const [smeOptions, setSmeOptions] = useState<SmeOption[]>([])
    const [smeLoading, setSmeLoading] = useState(false)
    const [representative, setRepresentative] = useState(false)
    const watchedProgramId = Form.useWatch('programId', form)
    const selectedSmeId = Form.useWatch('smeParticipantId', form)
    const smeProgramId = forcedProgramId || watchedProgramId
    const [contactLocked, setContactLocked] = useState(false)
    const [departmentOptions, setDepartmentOptions] = useState<{ id: string; name: string }[]>([])
    const { token } = theme.useToken()
    const [currentStep, setCurrentStep] = useState(0)
    const [activeSection, setActiveSection] = useState<SectionKey | null>(null)
    const navigate = useNavigate()
    const { user } = useAuth()

    // Inquiries an SME sent from their portal keep the source they arrived with;
    // it is not a channel staff can pick.
    const portalOrigin = resolveInquiryChannel((initialData as any)?.source) === 'System'

    useEffect(() => {
        if (forcedProgramId) {
            form.setFieldsValue({ programId: forcedProgramId })
        }
    }, [forcedProgramId, form])

    useEffect(() => {
        const values = initialData as any
        // A contact type card value, or the older SME / non-SME pair.
        const initialType = values?.contactType || values?.sourceTypeInternal || values?.sourceType
        if (isContactTypeValue(initialType)) {
            setContactType(initialType)
        } else if (initialType === 'Non-Incubatee') {
            setContactType(values?.classification === 'Potential' ? 'Potential Incubatee' : 'Visitor')
            form.setFieldsValue({ sourceTypeInternal: values?.classification === 'Potential' ? 'Potential Incubatee' : 'Visitor' })
        }
        setRepresentative(Boolean(values?.representative))
        setRequiresFollowUp(
            Boolean(values?.nextFollowUpDate || values?.followUpMethod || values?.followUpNotes)
        )
    }, [initialData])

    // Static options (unchanged lists)
    // The inquiry types that fit who it is from.
    const inquiryTypes = INQUIRY_TYPES_FOR[contactType] as InquiryType[]
    const budgetRanges: BudgetRange[] = [
        'Under R10k',
        'R10k - R50k',
        'R50k - R100k',
        'R100k - R500k',
        'R500k - R1M',
        'Over R1M',
        'To be discussed'
    ]
    const timelines: Timeline[] = [
        'Immediate',
        'Within 1 month',
        '1-3 months',
        '3-6 months',
        '6-12 months',
        'Over 1 year',
        'Flexible'
    ]

    // Load programs from the canonical programs collection only.
    useEffect(() => {
        const loadPrograms = async () => {
            try {
                const snap = await getDocs(collection(db, 'programs'))
                const arr = snap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        name: data.name || data.title || 'Program',
                        isActive: data.isActive
                    } as Program
                })
                setPrograms(arr)
            } catch (e) {
                console.error('Failed to load programs', e)
                setPrograms([])
            }
        }

        loadPrograms()
    }, [])

    // Load departments enabled for interventions.
    useEffect(() => {
        const loadDepartments = async () => {
            try {
                const qRef = query(
                    collection(db, 'departments'),
                    where('interventionsDepartment', '==', true)
                )
                const snap = await getDocs(qRef)
                const depts = snap.docs
                    .map(d => ({ id: d.id, name: String((d.data() as any)?.name || '') }))
                    .filter(d => d.name)

                // Editing an inquiry whose department is not an intervention department: keep it selectable.
                const initial = initialData as any
                if (initial?.departmentId && !depts.some(d => d.id === initial.departmentId)) {
                    depts.push({ id: initial.departmentId, name: initial.department || 'Current department' })
                }
                setDepartmentOptions(depts)
            } catch (e) {
                console.error('Failed to load departments', e)
                setDepartmentOptions([])
            }
        }

        loadDepartments()
    }, [])

    const normalizeEmail = (e: string) => (e || '').trim().toLowerCase()

    const splitName = (
        full?: string
    ): { firstName: string; lastName: string } => {
        const safe = (full || '').trim()
        if (!safe) return { firstName: '', lastName: '' }
        const parts = safe.split(/\s+/)
        if (parts.length === 1) return { firstName: parts[0], lastName: '' }
        const firstName = parts[0]
        const lastName = parts.slice(1).join(' ')
        return { firstName, lastName }
    }

    // ---- Existing contacts: find someone and fill their details in ----
    // The same people the Contacts page lists: saved contacts and everyone from the
    // branch's inquiries. Only loaded for a new inquiry.
    const [directory, setDirectory] = useState<DirectoryContact[]>([])
    const [directoryLoaded, setDirectoryLoaded] = useState(false)
    const [filledFromId, setFilledFromId] = useState<string | null>(null)
    const [dismissedMatchId, setDismissedMatchId] = useState<string | null>(null)
    const watchedEmail = Form.useWatch('email', form)
    const watchedPhone = Form.useWatch('phone', form)

    useEffect(() => {
        if (inquiryId || !user?.assignedBranch) return
        let cancelled = false
        Promise.all([
            inquiryService.getInquiriesByBranch(user.assignedBranch),
            contactService.list(user.assignedBranch)
        ])
            .then(([rows, saved]) => {
                if (!cancelled) setDirectory(buildContactDirectory(rows, saved))
            })
            .catch(error => console.error('Could not load contacts for autofill', error))
            .finally(() => {
                if (!cancelled) setDirectoryLoaded(true)
            })
        return () => {
            cancelled = true
        }
    }, [inquiryId, user?.assignedBranch])

    const fillFromContact = (contact: DirectoryContact) => {
        const { firstName, lastName } = splitName(contact.name)
        form.setFieldsValue({
            firstName,
            lastName,
            email: contact.email || '',
            phone: contact.phone || '',
            company: contact.company || '',
            position: contact.latest?.contactInfo?.position || form.getFieldValue('position') || ''
        })
        // Bring their type along, except to an SME, which is picked from the SME list instead.
        const category = contact.category
        if (category !== 'Unclassified' && category !== 'Incubatee' && category !== contactType) {
            setContactType(category as InquiryContactType)
            form.setFieldsValue({ sourceTypeInternal: category })
        }
        setFilledFromId(contact.id)
        form.validateFields(['firstName', 'lastName', 'email', 'phone', 'company']).catch(() => undefined)
        message.success(`Filled in from ${contact.name}.`)
    }

    // Typed an email or phone that someone in the contacts already has: offer their details.
    const typedMatch = useMemo(() => {
        const email = contactEmail(watchedEmail || '')
        const phone = contactPhone(watchedPhone || '')
        if (inquiryId || (!email && phone.length < 7)) return null
        const match = directory.find(contact =>
            email ? contactEmail(contact.email) === email : phone && contactPhone(contact.phone) === phone
        )
        return match && match.id !== filledFromId && match.id !== dismissedMatchId ? match : null
    }, [watchedEmail, watchedPhone, directory, filledFromId, dismissedMatchId, inquiryId])

    // ---- Walk-ins: why they came, and the session an SME is here for ----
    const watchedSource = Form.useWatch('source', form)
    const watchedPurpose = Form.useWatch('visitPurpose', form) as VisitPurpose | undefined
    const isWalkIn = !portalOrigin && (watchedSource || (initialData as any)?.source || 'Walk-in') === 'Walk-in'
    // Checking in for a booked session is a visit, not a question: one step, saved as done.
    const isSessionVisit = !inquiryId && isWalkIn && watchedPurpose === 'session' && contactType === 'Incubatee'
    const [sessionOptions, setSessionOptions] = useState<
        { value: string; label: string; sessionId: string; title: string; location: string; departmentId: string }[]
    >([])
    const [sessionsLoading, setSessionsLoading] = useState(false)

    // The SME's sessions from today to a week ahead, today's first.
    useEffect(() => {
        if (!isSessionVisit || !selectedSmeId) {
            setSessionOptions([])
            return
        }
        let cancelled = false
        setSessionsLoading(true)
        const today = dayjs().startOf('day')
        getDocs(query(collection(db, 'appointments'), where('smeId', '==', selectedSmeId)))
            .then(async snap => {
                const rows = await Promise.all(
                    snap.docs.map(async d => {
                        const appointment = d.data() as any
                        if (!appointment.appointmentSessionId || ['cancelled', 'postponed'].includes(appointment.status)) return null
                        const session = await getDoc(doc(db, 'appointmentSessions', appointment.appointmentSessionId)).catch(() => null)
                        const data = session?.exists() ? (session.data() as any) : null
                        const startAt = data?.startAt?.toDate?.() as Date | undefined
                        if (!startAt || dayjs(startAt).isBefore(today) || !dayjs(startAt).isBefore(today.add(7, 'day'))) return null
                        const title = String(data.title || appointment.interventionTitle || 'Session')
                        const when = dayjs(startAt).isSame(today, 'day') ? `Today ${dayjs(startAt).format('HH:mm')}` : dayjs(startAt).format('ddd D MMM, HH:mm')
                        return {
                            value: d.id,
                            startAt: startAt.getTime(),
                            label: [when, title, data.location].filter(Boolean).join(' · '),
                            sessionId: appointment.appointmentSessionId,
                            title,
                            location: String(data.location || ''),
                            departmentId: String(appointment.departmentId || data.departmentId || '')
                        }
                    })
                )
                if (cancelled) return
                setSessionOptions(
                    rows
                        .filter(Boolean)
                        .sort((a: any, b: any) => a.startAt - b.startAt)
                        .map(({ startAt, ...row }: any) => row)
                )
            })
            .catch(error => {
                console.error('Could not load the SME sessions', error)
                if (!cancelled) setSessionOptions([])
            })
            .finally(() => {
                if (!cancelled) setSessionsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [isSessionVisit, selectedSmeId])

    // Validate only what a check-in asks for; the inquiry fields (type, department,
    // description, priority) do not apply, so submit directly rather than form.submit().
    const saveSessionVisit = async () => {
        try {
            await form.validateFields(['sourceTypeInternal', 'source', 'visitPurpose', 'smeParticipantId', 'appointmentId', 'firstName', 'lastName', 'email', 'phone'])
        } catch {
            return // Ant Design shows the messages.
        }
        await handleSubmit(form.getFieldsValue(true))
    }

    // Only contacts of the chosen type: picking Funder lists funders. Visitor also lists
    // contacts whose type was never recorded, since a visitor is anyone else.
    const contactsOfType = useMemo(
        () =>
            directory.filter(contact =>
                contact.category === contactType || (contactType === 'Visitor' && contact.category === 'Unclassified')
            ),
        [directory, contactType]
    )
    const typePlural = CONTACT_TYPE_LABEL[contactType].toLowerCase() + 's'

    const contactOptions = useMemo(
        () =>
            contactsOfType.map(contact => ({
                value: contact.id,
                // Searchable text: name, company, email and phone.
                search: [contact.name, contact.company, contact.email, contact.phone].filter(Boolean).join(' ').toLowerCase(),
                label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <strong>{contact.name}</strong>
                            <span style={{ color: token.colorTextSecondary }}>
                                {[contact.company, contact.email || contact.phone].filter(Boolean).map(part => ` · ${part}`).join('')}
                            </span>
                        </span>
                        <span style={{ flex: 'none', fontSize: 12, color: token.colorTextSecondary }}>
                            {contact.category === 'Unclassified' ? '' : CONTACT_TYPE_LABEL[contact.category as InquiryContactType] || contact.category}
                        </span>
                    </div>
                )
            })),
        [contactsOfType, token.colorTextSecondary]
    )

    // Accepted SMEs of the selected programme, so a walk-in can be linked to the
    // company even when the person at the desk is not the owner on file.
    useEffect(() => {
        if (sourceType !== 'Incubatee' || !smeProgramId) {
            setSmeOptions([])
            return
        }

        let cancelled = false
        setSmeLoading(true)

        getDocs(query(collection(db, 'applications'), where('programId', '==', smeProgramId)))
            .then(snap => {
                if (cancelled) return
                const seen = new Set<string>()
                const rows: SmeOption[] = []

                snap.docs.forEach(d => {
                    const app = d.data() as any
                    const status = app?.status ?? app?.applicationStatus ?? app?.decision
                    const participantId = String(app?.participantId || '').trim()
                    if (!ACCEPTED_VALUES.includes(status) || !participantId || seen.has(participantId)) return
                    seen.add(participantId)

                    const company = String(app?.beneficiaryName || app?.companyName || '').trim()
                    const owner = String(app?.participantName || app?.applicantName || app?.directorName || '').trim()
                    const email = String(app?.email || '').trim()
                    rows.push({
                        value: participantId,
                        company,
                        owner,
                        email,
                        label: [company || 'Unnamed company', owner, email].filter(Boolean).join(' · ')
                    })
                })

                rows.sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }))
                setSmeOptions(rows)
            })
            .catch(err => {
                console.error('Failed to load SMEs', err)
                if (!cancelled) setSmeOptions([])
            })
            .finally(() => {
                if (!cancelled) setSmeLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [sourceType, smeProgramId])

    // Fill the form from the chosen SME. A representative keeps their own contact
    // details; only the company is taken from the SME.
    const applySme = useCallback(
        async (participantId: string, asRepresentative: boolean) => {
            const option = smeOptions.find(item => item.value === participantId)
            form.setFieldsValue({ company: option?.company || '' })

            if (asRepresentative) {
                setContactLocked(false)
                return
            }

            try {
                const pSnap = await getDoc(doc(db, 'participants', participantId))
                const participant = pSnap.exists() ? (pSnap.data() as any) : null
                const [firstName, ...lastNameParts] = String(
                    participant?.participantName || option?.owner || ''
                )
                    .trim()
                    .split(/\s+/)

                form.setFieldsValue({
                    firstName: firstName || '',
                    lastName: lastNameParts.join(' '),
                    email: option?.email || participant?.email || '',
                    phone: participant?.phone || '',
                    company: participant?.beneficiaryName || option?.company || '',
                    position: 'CEO',
                    industry: participant?.sector || ''
                })
                setContactLocked(true)
            } catch (err) {
                console.error('Error loading SME details', err)
                message.error('Could not load the SME details. Enter the contact manually.')
                setContactLocked(false)
            }
        },
        [form, smeOptions]
    )

    // Reset locks when toggling source type
    useEffect(() => {
        if (sourceType === 'Non-Incubatee') {
            setContactLocked(false)
            form.setFieldsValue({ programId: forcedProgramId || undefined })
        }
    }, [sourceType, form, forcedProgramId])

    /**
     * Keep the person in the branch's contacts, filed under this contact type.
     * Someone already saved (same email, or same phone when there is no email)
     * is updated and linked to this inquiry rather than added twice. A failure
     * here never loses the inquiry, which is already saved.
     */
    const saveContactFor = async (
        newInquiryId: string,
        info: InquiryFormData['contactInfo'],
        branchId: string,
        uid: string
    ): Promise<'added' | 'updated' | null> => {
        try {
            const email = contactEmail(info.email || '')
            const phone = contactPhone(info.phone || '')
            const existing = (await contactService.list(branchId)).find(contact =>
                email ? contactEmail(contact.email) === email : !contact.email && phone && contactPhone(contact.phone) === phone
            )
            await contactService.save(
                {
                    name: `${info.firstName || ''} ${info.lastName || ''}`.trim(),
                    email: info.email || '',
                    phone: info.phone || '',
                    company: info.company || '',
                    category: contactType,
                    linkedInquiryIds: [...new Set([...(existing?.linkedInquiryIds || []), newInquiryId])]
                },
                branchId,
                uid,
                existing?.id
            )
            return existing ? 'updated' : 'added'
        } catch (error) {
            console.error('Saving the contact failed', error)
            message.warning('The inquiry is saved, but the contact could not be saved. Add it from Contacts.')
            return null
        }
    }

    const handleSubmit = async (values: any) => {
        if (!user?.assignedBranch) {
            message.error('No branch assigned. Please contact your administrator.')
            return
        }
        try {
            setLoading(true)
            // If Non-Incubatee, ensure no stray programId is set
            const programId =
                sourceType === 'Incubatee'
                    ? forcedProgramId || values.programId
                    : null

            const linkedSmeId = sourceType === 'Incubatee' ? values.smeParticipantId || null : null

            const session = isSessionVisit ? sessionOptions.find(option => option.value === values.appointmentId) : undefined
            // When editing, only a reason the inquiry already had or one just chosen: older
            // walk-ins never recorded one, and the form's default must not invent it.
            const purposeKnown = !inquiryId || Boolean((initialData as any)?.visitPurpose) || form.isFieldTouched('visitPurpose')
            const visitPurpose: VisitPurpose | undefined = isWalkIn && purposeKnown ? values.visitPurpose || 'inquiry' : undefined

            const inquiryData: InquiryFormData = {
                contactInfo: {
                    firstName: values.firstName,
                    lastName: values.lastName,
                    email: values.email || '',
                    phone: values.phone || '',
                    company: values.company || '',
                    position: values.position || (sourceType === 'Incubatee' ? 'CEO' : '')
                },
                inquiryDetails: session
                    ? {
                          inquiryType: 'Other',
                          departmentId: session.departmentId,
                          department: departmentOptions.find(d => d.id === session.departmentId)?.name || '',
                          description: `Checked in for ${session.title}${session.location ? ` (${session.location})` : ''}.`
                      }
                    : {
                    inquiryType: values.inquiryType,
                    businessStage: values.businessStage || '',
                    industry: values.industry || '',
                    departmentId: values.departmentId || '',
                    // A department the list does not offer keeps the name it was saved with.
                    department:
                        departmentOptions.find(d => d.id === values.departmentId)?.name ||
                        (!values.departmentId ? values.department || '' : ''),
                    // An SME's portal choices are not on this form; keep them when editing.
                    ...(Array.isArray(values.servicesOfInterest) && { servicesOfInterest: values.servicesOfInterest }),
                    description: values.description,
                    budget: values.budget || '',
                    timeline: values.timeline || ''
                },
                priority: session ? 'Low' : values.priority,
                ...(visitPurpose && { visitPurpose }),
                ...(session && {
                    appointmentId: session.value,
                    appointmentSessionId: session.sessionId,
                    visit: { purpose: 'session', checkedInAt: new Date(), status: 'attended', location: session.location, sessionTitle: session.title }
                }),
                source: portalOrigin
                    ? (initialData as any).source
                    : values.source || 'Walk-in',
                classification: classificationFor(contactType),
                participantId: linkedSmeId,
                isRepresentative: Boolean(linkedSmeId) && representative,
                tags: values.tags || [],
                ...(requiresFollowUp &&
                    (values.nextFollowUpDate ||
                        values.followUpMethod ||
                        values.followUpNotes) && {
                    followUp: {
                        ...(values.nextFollowUpDate && {
                            nextFollowUpDate: values.nextFollowUpDate.toDate()
                        }),
                        ...(values.followUpMethod && {
                            followUpMethod: values.followUpMethod
                        }),
                        assignedTo: values.assignedTo || user.uid,
                        assignedToName: user.name || user.email || '',
                        assignedToEmail: user.email || '',
                        ...(values.followUpNotes && { notes: values.followUpNotes })
                    }
                })
            }

            const selectedProgram = programs.find(p => p.id === programId)

            // Enrich with program only if incubatee
            const enriched: any = {
                ...inquiryData,
                ...(sourceType === 'Incubatee' && {
                    programId: programId,
                    programName: forcedProgramName || selectedProgram?.name || null
                }),
                sourceType,
                contactType
            }

            if (inquiryId) {
                await inquiryService.updateInquiry(inquiryId, enriched)
                message.success('Inquiry updated successfully!')
            } else {
                const newInquiryId = await inquiryService.createInquiry(
                    enriched,
                    user.assignedBranch,
                    user.uid
                )
                // A session check-in is complete as soon as it is recorded.
                if (session) {
                    await inquiryService
                        .updateInquiryStatus(newInquiryId, 'Resolved', user.uid, `Checked in for ${session.title} at reception`, user.name || user.email || '')
                        .catch(error => console.error('Could not mark the visit done', error))
                }
                const done = session ? `Checked in for ${session.title}` : 'Inquiry saved'
                if (saveToContacts) {
                    const saved = await saveContactFor(newInquiryId, inquiryData.contactInfo, user.assignedBranch, user.uid)
                    message.success(saved === 'added' ? `${done}, and the contact added to your contacts.` : saved === 'updated' ? `${done}, and their contact updated.` : `${done}.`)
                } else {
                    message.success(`${done}.`)
                }
            }

            onSuccess?.()
            if (!embedded) navigate('/inquiries')
        } catch (error) {
            console.error('Error saving inquiry:', error)
            message.error('Failed to save inquiry. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    const handleClear = () => {
        form.resetFields()
        setRequiresFollowUp(false)
        setContactLocked(false)
        setRepresentative(false)
        setContactType('Visitor')
        setSaveToContacts(true)
        setFilledFromId(null)
        setDismissedMatchId(null)
        // resetFields puts the card back to its last starting value, so set it explicitly.
        form.setFieldsValue({ sourceTypeInternal: 'Visitor', visitPurpose: 'inquiry' })
        setCurrentStep(0)
        if (forcedProgramId) {
            form.setFieldsValue({ programId: forcedProgramId })
        }
    }

    const handleNextStep = async () => {
        const fields =
            currentStep === 0
                ? ['sourceTypeInternal', 'source', 'visitPurpose', 'smeParticipantId', 'firstName', 'lastName', 'email', 'phone']
                : ['inquiryType', 'departmentId', 'description', 'priority']

        try {
            await form.validateFields(fields)
            setCurrentStep(step => Math.min(step + 1, 2))
        } catch {
            // Ant Design displays the relevant field validation messages.
        }
    }

    const sectionStyle = (key: SectionKey): React.CSSProperties => ({
        display: sectioned
            ? activeSection === (key === 'who' ? 'contact' : key) ? 'block' : 'none'
            : !stepped || currentStep === SECTION_STEP[key] ? 'block' : 'none'
    })

    const sectionSummary = (key: SectionKey): string => {
        const values = form.getFieldsValue(true) as any
        switch (key) {
            case 'who':
            case 'contact':
                return [
                    CONTACT_TYPE_LABEL[contactType],
                    channelLabel(resolveInquiryChannel(values.source)),
                    `${values.firstName || ''} ${values.lastName || ''}`.trim(),
                    values.company
                ].filter(Boolean).join(' · ')
            case 'inquiry':
                return [values.inquiryType, departmentOptions.find(d => d.id === values.departmentId)?.name].filter(Boolean).join(' · ') || 'Not set'
            case 'management':
                return values.priority ? `${values.priority} priority` : 'Not set'
            case 'followup':
                return requiresFollowUp && values.nextFollowUpDate
                    ? [dayjs(values.nextFollowUpDate).format('DD MMM YYYY'), values.followUpMethod]
                        .filter(Boolean).join(' · ')
                    : 'No follow-up scheduled'
        }
    }

    // Only the open section is validated; the others stay mounted (hidden) so their values are saved as they are.
    const handleSectionUpdate = async () => {
        if (!activeSection) return
        const fields = activeSection === 'followup' && !requiresFollowUp ? [] : SECTION_FIELDS[activeSection]

        try {
            await form.validateFields(fields)
        } catch {
            return
        }
        await handleSubmit(form.getFieldsValue(true))
    }

    /**
     * The form's buttons. Given a footer (a modal's), they go there as a normal
     * footer: where you are on the left, the buttons on the right. Otherwise they
     * stay in a bar stuck to the bottom of the form.
     */
    const actionBar = (actions: React.ReactNode, where?: string) =>
        footerContainer
            ? createPortal(
                  <div className='inq-form-footer'>
                      <span className='inq-form-footer-where'>{where}</span>
                      {actions}
                  </div>,
                  footerContainer
              )
            : (
                  <div
                      className='inq-form-footer is-sticky'
                      style={{
                          position: 'sticky',
                          bottom: 0,
                          zIndex: 2,
                          margin: '4px -36px 0',
                          padding: '14px 36px 18px',
                          background: token.colorBgElevated,
                          borderTop: `1px solid ${token.colorBorderSecondary}`
                      }}
                  >
                      <span className='inq-form-footer-where'>{where}</span>
                      {actions}
                  </div>
              )

    // Guard: user without branch
    if (user && !user.assignedBranch) {
    return (
            <div style={{ padding: 24, textAlign: 'center' }}>
                <Card style={{ maxWidth: 500, margin: '0 auto' }}>
                    <div style={{ padding: '40px 20px' }}>
                        <h2>🏢 Branch Assignment Required</h2>
                        <p style={{ fontSize: 16, color: '#666', marginBottom: 24 }}>
                            You need to be assigned to a branch to create inquiries.
                        </p>
                        <p style={{ fontSize: 14, color: '#888' }}>
                            Please contact your <strong>Director</strong> to assign you to a
                            branch through the User Management system.
                        </p>
                        <p style={{ fontSize: 12, color: '#aaa', marginTop: 20 }}>
                            Directors can assign branches via:{' '}
                            <em>User Management → Edit User → Select Branch</em>
                        </p>
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div
            style={{
                padding: embedded ? 0 : 24,
                maxWidth: 1200,
                margin: '0 auto'
            }}
        >
            <Card
                bordered={!embedded}
                style={embedded ? { background: 'transparent', boxShadow: 'none' } : undefined}
                styles={{ body: { padding: embedded ? 0 : 24 } }}
                title={embedded ? undefined : inquiryId ? 'Edit Inquiry' : 'New Inquiry'}
                extra={
                    embedded || stepped || sectioned ? null : <Space>
                        <Button
                            icon={<ClearOutlined />}
                            onClick={handleClear}
                            disabled={loading}
                        >
                            Clear
                        </Button>
                        <Button
                            type='primary'
                            icon={<SaveOutlined />}
                            loading={loading}
                            onClick={() => form.submit()}
                        >
                            {inquiryId ? 'Update' : 'Save'} Inquiry
                        </Button>
                    </Space>
                }
            >
                {stepped && showSteps && (
                    <Steps
                        current={currentStep}
                        size='small'
                        style={{ marginBottom: 24 }}
                        items={[
                            { title: 'Contact' },
                            { title: 'Inquiry' },
                            { title: 'Follow-up' }
                        ]}
                    />
                )}
                <Form
                    form={form}
                    layout='vertical'
                    onFinish={handleSubmit}
                    initialValues={initialData}
                    size={embedded ? 'middle' : 'large'}
                    requiredMark='optional'
                >
                    {sectioned && !activeSection && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                gap: 12,
                                marginBottom: 12
                            }}
                        >
                            {SECTION_CARDS.map(card => (
                                <div
                                    key={card.key}
                                    role='button'
                                    tabIndex={0}
                                    onClick={() => setActiveSection(card.key)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') setActiveSection(card.key)
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 14,
                                        padding: '16px 18px',
                                        borderRadius: 14,
                                        cursor: 'pointer',
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 12,
                                            display: 'grid',
                                            placeItems: 'center',
                                            flex: '0 0 auto',
                                            fontSize: 18,
                                            color: token.colorPrimary,
                                            background: token.colorPrimaryBg
                                        }}
                                    >
                                        {card.icon}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Text strong style={{ display: 'block' }}>
                                            {card.title}
                                        </Text>
                                        <Text
                                            type='secondary'
                                            ellipsis
                                            style={{ display: 'block', fontSize: 12 }}
                                        >
                                            {sectionSummary(card.key)}
                                        </Text>
                                    </div>
                                    <RightOutlined style={{ opacity: 0.45, fontSize: 12 }} />
                                </div>
                            ))}
                        </div>
                    )}

                    <div>
                        {/* Program & Source */}
                        <div style={sectionStyle('who')}>
                        <FormSection
                            icon={<IdcardOutlined />}
                            title='Who is this from?'
                            hint='Contact type and how they reached us'
                        >
                            {/* Source row reacts to sourceType:
                - Non-Incubatee: Source spans full width
                - Incubatee: Source + Email share the row, aligned */}
                            <Row gutter={[16, 0]}>
                                <Col xs={24}>
                                    <Form.Item
                                        label='Who is it from?'
                                        name='sourceTypeInternal'
                                        initialValue={contactType}
                                        extra={CONTACT_TYPE_HINT[contactType]}
                                        rules={[
                                            { required: true, message: 'Please choose who the inquiry is from' }
                                        ]}
                                    >
                                        <CardSelect
                                            options={CONTACT_TYPE_CARDS}
                                            onChange={(v: string) => {
                                                if (!isContactTypeValue(v)) return
                                                setContactType(v)
                                                if (v !== 'Incubatee') {
                                                    setContactLocked(false)
                                                    form.setFieldsValue({
                                                        programId: forcedProgramId || undefined,
                                                        smeParticipantId: undefined
                                                    })
                                                }
                                                if (v !== 'Incubatee' && form.getFieldValue('visitPurpose') === 'session') {
                                                    form.setFieldsValue({ visitPurpose: 'inquiry', appointmentId: undefined })
                                                }
                                                // Keep the inquiry type only if it fits the new contact type.
                                                if (!INQUIRY_TYPES_FOR[v].includes(form.getFieldValue('inquiryType'))) {
                                                    form.setFieldsValue({ inquiryType: undefined })
                                                }
                                            }}
                                        />
                                    </Form.Item>
                                </Col>

                                <Col xs={24}>
                                    <Form.Item
                                        label='How did they reach us?'
                                        name='source'
                                        initialValue={portalOrigin ? 'System' : 'Walk-in'}
                                        rules={[{ required: true, message: 'Please select how they reached us' }]}
                                    >
                                        <Select disabled={portalOrigin}>
                                            {portalOrigin ? (
                                                <Option value='System'>{channelLabel('System')}</Option>
                                            ) : (
                                                MANUAL_CHANNELS.map(option => (
                                                    <Option key={option.value} value={option.value}>
                                                        {channelLabel(option.value)}
                                                    </Option>
                                                ))
                                            )}
                                        </Select>
                                    </Form.Item>
                                </Col>

                                {sourceType === 'Incubatee' && (
                                    <>
                                        <Col xs={24}>
                                            <Form.Item
                                                label='Which SME is this about?'
                                                name='smeParticipantId'
                                                extra='Search by company, owner or email. If the person at the desk is not the owner, tick the box below.'
                                                rules={[
                                                    {
                                                        required: !inquiryId,
                                                        message: 'Please choose the SME'
                                                    }
                                                ]}
                                            >
                                                <Select
                                                    showSearch
                                                    allowClear
                                                    loading={smeLoading}
                                                    placeholder={
                                                        smeProgramId
                                                            ? 'Search company, owner or email'
                                                            : 'Choose a program in the top bar first'
                                                    }
                                                    disabled={!smeProgramId}
                                                    options={smeOptions}
                                                    optionFilterProp='label'
                                                    notFoundContent={
                                                        smeLoading ? 'Loading SMEs...' : 'No accepted SME found'
                                                    }
                                                    onChange={(value?: string) => {
                                                        if (value) applySme(value, representative)
                                                        else {
                                                            setContactLocked(false)
                                                            form.setFieldsValue({ company: '' })
                                                        }
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24}>
                                            <Form.Item>
                                                <Checkbox
                                                    checked={representative}
                                                    onChange={event => {
                                                        const checked = event.target.checked
                                                        setRepresentative(checked)
                                                        if (checked) {
                                                            setContactLocked(false)
                                                            form.setFieldsValue({
                                                                firstName: '',
                                                                lastName: '',
                                                                email: '',
                                                                phone: '',
                                                                position: ''
                                                            })
                                                        } else if (selectedSmeId) {
                                                            applySme(selectedSmeId, false)
                                                        }
                                                    }}
                                                >
                                                    Someone is attending on the SME&apos;s behalf (a representative)
                                                </Checkbox>
                                            </Form.Item>
                                        </Col>
                                    </>
                                )}

                                {/* A walk-in: why they are here. A session is checked in, not logged as a question. */}
                                {isWalkIn && (
                                    <Col xs={24}>
                                        <Form.Item
                                            label='Why are they here?'
                                            name='visitPurpose'
                                            initialValue='inquiry'
                                            extra={watchedPurpose ? VISIT_PURPOSE_HINT[watchedPurpose] : undefined}
                                            rules={[{ required: true, message: 'Choose why they are here' }]}
                                        >
                                            <CardSelect
                                                options={visitPurposesFor(contactType)
                                                    .filter(purpose => purpose !== 'session' || !inquiryId || watchedPurpose === 'session')
                                                    .map(purpose => ({
                                                        value: purpose,
                                                        label: VISIT_PURPOSE_LABEL[purpose],
                                                        icon: purpose === 'session' ? <CalendarOutlined /> : purpose === 'inquiry' ? <MessageOutlined /> : purpose === 'meeting' ? <TeamOutlined /> : purpose === 'documents' ? <IdcardOutlined /> : <StarOutlined />
                                                    }))}
                                            />
                                        </Form.Item>
                                    </Col>
                                )}

                                {isSessionVisit && (
                                    <Col xs={24}>
                                        <Form.Item
                                            label='Which session?'
                                            name='appointmentId'
                                            extra={
                                                selectedSmeId
                                                    ? 'Their sessions from today to a week ahead. Saving checks them in.'
                                                    : 'Choose the SME above first.'
                                            }
                                            rules={[{ required: true, message: 'Choose the session they are here for' }]}
                                        >
                                            <Select
                                                placeholder={selectedSmeId ? 'Choose the session' : 'Choose the SME first'}
                                                disabled={!selectedSmeId}
                                                loading={sessionsLoading}
                                                options={sessionOptions.map(({ value, label }) => ({ value, label }))}
                                                notFoundContent={
                                                    sessionsLoading
                                                        ? 'Loading sessions…'
                                                        : 'No session booked for this SME this week. Log it as a new inquiry instead.'
                                                }
                                            />
                                        </Form.Item>
                                    </Col>
                                )}
                            </Row>

                            {sourceType === 'Incubatee' && forcedProgramId && (
                                <Form.Item name='programId' hidden>
                                    <Input />
                                </Form.Item>
                            )}
                        </FormSection>
                        </div>

                        {/* Contact Information */}
                        <div style={sectionStyle('contact')}>
                        <FormSection
                            icon={<UserOutlined />}
                            title='Contact details'
                            hint='Email or phone is required'
                        >
                            {/* New inquiries: pick someone already in the contacts to fill this in. */}
                            {!inquiryId && contactType !== 'Incubatee' && (
                                <Form.Item
                                    label='Already a contact?'
                                    extra={
                                        contactsOfType.length
                                            ? `${contactsOfType.length} ${contactsOfType.length === 1 ? CONTACT_TYPE_LABEL[contactType].toLowerCase() : typePlural} in your contacts. Search by name, organisation, email or phone.`
                                            : undefined
                                    }
                                >
                                    <Select
                                        showSearch
                                        allowClear
                                        value={null}
                                        suffixIcon={<SearchOutlined />}
                                        aria-label='Find an existing contact'
                                        placeholder={
                                            !directoryLoaded
                                                ? 'Loading contacts…'
                                                : contactsOfType.length
                                                    ? `Find an existing ${CONTACT_TYPE_LABEL[contactType].toLowerCase()}`
                                                    : `No ${typePlural} in your contacts yet`
                                        }
                                        disabled={!contactsOfType.length}
                                        options={contactOptions}
                                        filterOption={(input, option) => Boolean((option as any)?.search?.includes(input.trim().toLowerCase()))}
                                        notFoundContent={`No ${CONTACT_TYPE_LABEL[contactType].toLowerCase()} by that name — fill in their details below`}
                                        onSelect={(id: string | null) => {
                                            const contact = directory.find(item => item.id === id)
                                            if (contact) fillFromContact(contact)
                                        }}
                                    />
                                </Form.Item>
                            )}
                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='First Name'
                                        name='firstName'
                                        rules={[
                                            { required: true, message: 'First name is required' },
                                            {
                                                max: 50,
                                                message: 'First name must be less than 50 characters'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter first name'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Last Name'
                                        name='lastName'
                                        rules={[
                                            { required: true, message: 'Last name is required' },
                                            {
                                                max: 50,
                                                message: 'Last name must be less than 50 characters'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter last name'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Email'
                                        name='email'
                                        rules={[
                                            ({ getFieldValue }) => ({
                                                validator(_, value) {
                                                    // Email or phone is enough (checked below): a visitor at the desk may only give a number.
                                                    if (value && !/^\S+@\S+\.\S+$/.test(value)) {
                                                        return Promise.reject(
                                                            new Error('Please enter a valid email address')
                                                        )
                                                    }
                                                    return Promise.resolve()
                                                }
                                            })
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter email address'
                                            disabled={contactLocked && sourceType === 'Incubatee'}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Phone'
                                        name='phone'
                                        rules={[
                                            {
                                                pattern: /^[\d\s\+\-\(\)]+$/,
                                                message: 'Please enter a valid phone number'
                                            }
                                        ]}
                                    >
                                        <Input
                                            placeholder='Enter phone number'
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            {typedMatch && (
                                <div
                                    role='status'
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        margin: '-8px 0 16px',
                                        padding: '8px 12px',
                                        borderRadius: 10,
                                        background: token.colorPrimaryBg,
                                        border: `1px solid ${token.colorPrimaryBorder}`
                                    }}
                                >
                                    <ContactsOutlined style={{ color: token.colorPrimary }} />
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                                        <strong>{typedMatch.name}</strong>
                                        {typedMatch.company ? ` (${typedMatch.company})` : ''} is already in your contacts.
                                    </span>
                                    <Button size='small' type='primary' onClick={() => fillFromContact(typedMatch)}>
                                        Use their details
                                    </Button>
                                    <Button size='small' type='text' onClick={() => setDismissedMatchId(typedMatch.id)}>
                                        Not them
                                    </Button>
                                </div>
                            )}

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label={asksBusinessDetails(contactType) ? 'Business name' : 'Organisation'}
                                        name='company'
                                        rules={
                                            needsOrganisation(contactType)
                                                ? [{ required: true, whitespace: true, message: `Which organisation is the ${CONTACT_TYPE_LABEL[contactType].toLowerCase()} from?` }]
                                                : []
                                        }
                                    >
                                        <Input
                                            placeholder={
                                                contactType === 'Funder'
                                                    ? 'e.g. the fund, bank or sponsor'
                                                    : contactType === 'Stakeholder'
                                                        ? 'e.g. the department, municipality or partner'
                                                        : asksBusinessDetails(contactType)
                                                            ? 'Business name'
                                                            : 'Organisation (optional)'
                                            }
                                            disabled={contactLocked || (sourceType === 'Incubatee' && Boolean(selectedSmeId))}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label={representative ? 'Position at the SME' : needsOrganisation(contactType) ? 'Role' : 'Position'}
                                        name='position'
                                        initialValue={sourceType === 'Incubatee' ? 'CEO' : undefined}
                                    >
                                        <Input
                                            placeholder={needsOrganisation(contactType) ? 'e.g. Programme manager (optional)' : 'Enter job position (optional)'}
                                            disabled={contactLocked}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            {/* Require either email or phone overall */}
                            <Form.Item
                                dependencies={['email', 'phone']}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            const email = getFieldValue('email')
                                            const phone = getFieldValue('phone')
                                            if (!email && !phone) {
                                                return Promise.reject(
                                                    new Error('Either email or phone number is required')
                                                )
                                            }
                                            return Promise.resolve()
                                        }
                                    })
                                ]}
                            >
                                <div />
                            </Form.Item>

                            {/* New inquiries only: keep the person in the branch's contacts under this type. */}
                            {!inquiryId && (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        padding: '10px 14px',
                                        borderRadius: 12,
                                        background: token.colorFillQuaternary,
                                        border: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <ContactsOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600 }}>Save to contacts</div>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Filed as {CONTACT_TYPE_LABEL[contactType].toLowerCase()}. Someone already in your contacts is updated, not added twice.
                                        </Text>
                                    </div>
                                    <Switch checked={saveToContacts} onChange={setSaveToContacts} aria-label='Save to contacts' />
                                </div>
                            )}
                        </FormSection>
                        </div>
                    </div>

                    <div>
                        {/* Inquiry Details */}
                        <div style={sectionStyle('inquiry')}>
                        <FormSection
                            icon={<MessageOutlined />}
                            title='Inquiry'
                            hint='What they are asking for'
                        >
                            {/* Quick screening of a business that wants to join; an SME's are on its profile. */}
                            <Row gutter={[16, 0]} style={{ display: asksScreening(contactType) ? undefined : 'none' }}>
                                <Col xs={24} sm={12}>
                                    <Form.Item label='Industry' name='industry'>
                                        <Input placeholder='Enter industry (optional)' />
                                    </Form.Item>
                                </Col>

                                <Col xs={24} sm={12}>
                                    <Form.Item label='Business Stage' name='businessStage'>
                                        <Select placeholder='Select business stage (optional)'>
                                            {(
                                                [
                                                    'Idea Stage',
                                                    'Startup',
                                                    'Early Stage',
                                                    'Growth Stage',
                                                    'Established',
                                                    'Not Applicable'
                                                ] as BusinessStage[]
                                            ).map(stage => (
                                                <Option key={stage} value={stage}>
                                                    {stage}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={[16, 0]}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Inquiry Type'
                                        name='inquiryType'
                                        rules={[
                                            { required: true, message: 'Please select an inquiry type' }
                                        ]}
                                    >
                                        <Select placeholder='Select inquiry type'>
                                            {inquiryTypes.map(type => (
                                                <Option key={type} value={type}>
                                                    {type}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        label='Department'
                                        name='departmentId'
                                        rules={needsDepartment(contactType) ? [{ required: true, message: 'Please select a department' }] : []}
                                    >
                                        <Select
                                            allowClear={!needsDepartment(contactType)}
                                            placeholder={needsDepartment(contactType) ? 'Select intervention department' : 'Only if a department should handle it'}
                                            showSearch
                                            optionFilterProp='children'
                                        >
                                            {departmentOptions.map(department => (
                                                <Option key={department.id} value={department.id}>
                                                    {department.name}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                label='Description'
                                name='description'
                                rules={[
                                    { required: true, message: 'Description is required' },
                                    {
                                        max: INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH,
                                        message: `Description must be less than ${INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH} characters`
                                    }
                                ]}
                            >
                                <TextArea
                                    rows={4}
                                    placeholder='Enter detailed description of the inquiry'
                                    showCount
                                    maxLength={INQUIRY_VALIDATION.MAX_DESCRIPTION_LENGTH}
                                />
                            </Form.Item>
                        </FormSection>
                        </div>

                        {/* Inquiry Management */}
                        <div style={sectionStyle('management')}>
                        <FormSection
                            icon={<FlagOutlined />}
                            title='Priority'
                        >
                            <Row gutter={[16, 0]}>
                                <Col xs={24}>
                                    <Form.Item
                                        label='Priority'
                                        name='priority'
                                        rules={[
                                            { required: true, message: 'Please select a priority' }
                                        ]}
                                    >
                                        <CardSelect options={PRIORITY_CARDS} />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </FormSection>
                        </div>
                    </div>

                    <div>
                        {/* Follow-up */}
                        <div style={sectionStyle('followup')}>
                        <FormSection
                            icon={<BellOutlined />}
                            title='Follow-up'
                            hint={requiresFollowUp ? 'Schedule the next touchpoint' : 'Optional'}
                            extra={
                                <Switch
                                    checked={requiresFollowUp}
                                    onChange={setRequiresFollowUp}
                                    checkedChildren='On'
                                    unCheckedChildren='Off'
                                />
                            }
                        >
                            {requiresFollowUp && (
                                <Row gutter={[16, 0]}>
                                    <Col xs={24}>
                                        <Form.Item
                                            label='When'
                                            name='nextFollowUpDate'
                                            rules={
                                                requiresFollowUp
                                                    ? [
                                                        {
                                                            required: true,
                                                            message: 'Please select a follow-up date'
                                                        }
                                                    ]
                                                    : []
                                            }
                                        >
                                            <DatePicker
                                                style={{ width: '100%' }}
                                                placeholder='Pick a day and time'
                                                showTime={{ format: 'HH:mm', minuteStep: 15 }}
                                                format='ddd D MMM YYYY, HH:mm'
                                                // Today onwards, weekdays only, as on the follow-ups page.
                                                disabledDate={(current: any) =>
                                                    current && (current.isBefore(dayjs().startOf('day')) || current.day() === 0 || current.day() === 6)
                                                }
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24}>
                                        <Form.Item
                                            label='Follow-up Method'
                                            name='followUpMethod'
                                            rules={
                                                requiresFollowUp
                                                    ? [
                                                        {
                                                            required: true,
                                                            message: 'Please select a follow-up method'
                                                        }
                                                    ]
                                                    : []
                                            }
                                        >
                                            <CardSelect options={FOLLOW_UP_METHOD_CARDS} />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24}>
                                        <Form.Item
                                            label='Follow-up Notes'
                                            name='followUpNotes'
                                            rules={[
                                                {
                                                    max: INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH,
                                                    message: `Notes must be less than ${INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH} characters`
                                                }
                                            ]}
                                        >
                                            <TextArea
                                                rows={3}
                                                placeholder='Enter follow-up notes (optional)'
                                                showCount
                                                maxLength={INQUIRY_VALIDATION.MAX_FOLLOW_UP_NOTES_LENGTH}
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            )}
                        </FormSection>
                        </div>
                    </div>

                    {sectioned && activeSection &&
                        actionBar(
                            <div className='inq-form-footer-actions'>
                                <Button icon={<ArrowLeftOutlined />} onClick={() => setActiveSection(null)} disabled={loading}>
                                    Back
                                </Button>
                                <Button type='primary' icon={<SaveOutlined />} loading={loading} onClick={handleSectionUpdate}>
                                    Update
                                </Button>
                            </div>,
                            SECTION_CARDS.find(card => card.key === activeSection)?.title
                        )}
                    {stepped &&
                        actionBar(
                            <div className='inq-form-footer-actions'>
                                <Button type='text' icon={<ClearOutlined />} onClick={handleClear} disabled={loading}>
                                    Clear
                                </Button>
                                {currentStep > 0 && (
                                    <Button
                                        icon={<ArrowLeftOutlined />}
                                        onClick={() => setCurrentStep(step => Math.max(step - 1, 0))}
                                        disabled={loading}
                                    >
                                        Previous
                                    </Button>
                                )}
                                {isSessionVisit ? (
                                    <Button type='primary' icon={<CheckCircleOutlined />} loading={loading} onClick={saveSessionVisit}>
                                        Check in
                                    </Button>
                                ) : currentStep < 2 ? (
                                    <Button type='primary' icon={<ArrowRightOutlined />} iconPosition='end' onClick={handleNextStep}>
                                        Next
                                    </Button>
                                ) : (
                                    <Button type='primary' icon={<SaveOutlined />} loading={loading} onClick={() => form.submit()}>
                                        {inquiryId ? 'Update' : 'Save'} inquiry
                                    </Button>
                                )}
                            </div>,
                            isSessionVisit ? 'Session check-in' : `Step ${currentStep + 1} of 3 · ${STEP_TITLES[currentStep]}`
                        )}
                </Form>
            </Card>
        </div>
    )
}

export default InquiryForm
