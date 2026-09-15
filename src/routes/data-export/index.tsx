import React, { useState } from 'react'
import {
    Alert,
    Button,
    Col,
    DatePicker,
    Empty,
    Row,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    message,
    theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ApartmentOutlined,
    AppstoreOutlined,
    AuditOutlined,
    BankOutlined,
    BookOutlined,
    BranchesOutlined,
    CalendarOutlined,
    CheckOutlined,
    CheckSquareOutlined,
    ClockCircleOutlined,
    CloudDownloadOutlined,
    DatabaseOutlined,
    DollarOutlined,
    FileExcelOutlined,
    IdcardOutlined,
    MessageOutlined,
    ProjectOutlined,
    ScheduleOutlined,
    SyncOutlined,
    TeamOutlined,
    ToolOutlined,
    UserOutlined
} from '@ant-design/icons'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text } = Typography
const { RangePicker } = DatePicker

export type Dataset = {
    key: string
    label: string
    collection: string
    sheet: string
    group: string
    description: string
}

export const DATASETS: Dataset[] = [
    {
        key: 'smes',
        label: 'SMEs and Applications',
        collection: 'applications',
        sheet: 'SMEs',
        group: 'SMEs',
        description: 'Applicant, business, programme and application information.'
    },
    {
        key: 'participants',
        label: 'Participants',
        collection: 'participants',
        sheet: 'Participants',
        group: 'SMEs',
        description: 'Onboarded participant and beneficiary records.'
    },
    { key: 'interventions', label: 'Interventions', collection: 'interventions', sheet: 'Interventions', group: 'SMEs', description: 'Intervention catalogue and delivery information.' },
    { key: 'assignedInterventions', label: 'Assigned Interventions', collection: 'assignedInterventions', sheet: 'Assigned Interventions', group: 'SMEs', description: 'SME intervention assignments and progress.' },
    { key: 'movs', label: 'Means of Verification', collection: 'movDocuments', sheet: 'MOVs', group: 'SMEs', description: 'Submitted evidence and verification records.' },
    { key: 'users', label: 'System Users', collection: 'users', sheet: 'Users', group: 'People', description: 'User profiles, roles and assignments.' },
    { key: 'timesheets', label: 'Timesheets', collection: 'timesheets', sheet: 'Timesheets', group: 'People', description: 'Clock-ins, clock-outs, hours and locations.' },
    { key: 'leave', label: 'Leave Requests', collection: 'leaveRequests', sheet: 'Leave Requests', group: 'People', description: 'Employee leave requests and decisions.' },
    { key: 'tasks', label: 'Tasks', collection: 'tasks', sheet: 'Tasks', group: 'People', description: 'Assigned tasks, owners, due dates and status.' },
    { key: 'appointments', label: 'Appointments', collection: 'appointments', sheet: 'Appointments', group: 'Engagement', description: 'Scheduled appointments and attendance.' },
    { key: 'inquiries', label: 'Inquiries', collection: 'inquiries', sheet: 'Inquiries', group: 'Engagement', description: 'Incoming inquiries, ownership and outcomes.' },
    { key: 'followUps', label: 'Follow-ups', collection: 'followUps', sheet: 'Follow Ups', group: 'Engagement', description: 'Inquiry follow-up activities.' },
    { key: 'programs', label: 'Programmes', collection: 'programs', sheet: 'Programmes', group: 'Organisation', description: 'Programme setup and status.' },
    { key: 'departments', label: 'Departments', collection: 'departments', sheet: 'Departments', group: 'Organisation', description: 'Department structure and contact information.' },
    { key: 'branches', label: 'Branches', collection: 'branches', sheet: 'Branches', group: 'Organisation', description: 'Branch and centre information.' },
    { key: 'resources', label: 'Resources', collection: 'resources', sheet: 'Resources', group: 'Operations', description: 'Available resources and capacity.' },
    { key: 'allocations', label: 'Resource Allocations', collection: 'resourceAllocations', sheet: 'Resource Allocations', group: 'Operations', description: 'Resource bookings and allocations.' },
    { key: 'expenses', label: 'Expenses', collection: 'expenses', sheet: 'Expenses', group: 'Finance', description: 'Programme and operational expense records.' },
    { key: 'library', label: 'Library Materials', collection: 'libraryMaterials', sheet: 'Library Materials', group: 'Operations', description: 'Reading materials shared with SMEs.' }
]

const DATASET_ICONS: Record<string, React.ReactNode> = {
    smes: <TeamOutlined />,
    participants: <IdcardOutlined />,
    interventions: <AppstoreOutlined />,
    assignedInterventions: <BranchesOutlined />,
    movs: <AuditOutlined />,
    users: <UserOutlined />,
    timesheets: <ClockCircleOutlined />,
    leave: <CalendarOutlined />,
    tasks: <CheckSquareOutlined />,
    appointments: <CalendarOutlined />,
    inquiries: <MessageOutlined />,
    followUps: <SyncOutlined />,
    programs: <ProjectOutlined />,
    departments: <ApartmentOutlined />,
    branches: <BankOutlined />,
    resources: <ToolOutlined />,
    allocations: <ScheduleOutlined />,
    expenses: <DollarOutlined />,
    library: <BookOutlined />
}

const DATASET_PREVIEW_LABELS: Record<string, string> = {
    smes: 'SMEs',
    participants: 'Participants',
    interventions: 'Interventions',
    assignedInterventions: 'Assigned',
    movs: 'MOVs',
    users: 'Users',
    timesheets: 'Timesheets',
    leave: 'Leave',
    tasks: 'Tasks',
    appointments: 'Appointments',
    inquiries: 'Inquiries',
    followUps: 'Follow-ups',
    programs: 'Programmes',
    departments: 'Departments',
    branches: 'Branches',
    resources: 'Resources',
    allocations: 'Allocations',
    expenses: 'Expenses',
    library: 'Library'
}

const isWideDatasetCard = (dataset: Dataset) =>
    dataset.label.length > 18

const SPECIAL_HEADERS: Record<string, string> = {
    firstName: 'Name', firstname: 'Name',
    lastName: 'Surname', lastname: 'Surname', companyName: 'Business Name', businessName: 'Business Name',
    phoneNumber: 'Phone Number', cellphone: 'Cellphone Number', email: 'Email Address',
    createdAt: 'Created At', updatedAt: 'Updated At', dateOfBirth: 'Date of Birth', idNumber: 'Identity Number',
    checkIn: 'Check-in Time', checkOut: 'Check-out Time', hoursWorked: 'Hours Worked', assignedBranch: 'Assigned Branch',
    departmentName: 'Department Name', programName: 'Programme Name', applicationStatus: 'Application Status',
    fileUrl: 'File URL', fileName: 'File Name', uploadedByName: 'Uploaded By', smmeNo: 'SME Number',
    subInterventions: 'Sub-interventions', assignmentMode: 'Assignment Mode', groupStage: 'Group Stage',
    interventionTitle: 'Intervention Title', interventionType: 'Intervention Type',
    interventionMethod: 'Intervention Method', frequencyOfIntervention: 'Frequency Of Intervention',
    interventionDate: 'Intervention Date', facilitatorName: 'Facilitator Name', finalCheckerName: 'Final Checker Name'
}

const HIDDEN_FIELDS = new Set([
    'id', '_id', 'uid', 'userId', 'participantId', 'applicationId', 'appId',
    'departmentId', 'programId', 'branchId', 'resourceId', 'interventionId',
    'interventionKey', 'assignedInterventionId', 'assigneeId',
    'facilitatorId', 'finalCheckerId', 'subId', 'subInterventionId', 'kpiId',
    'kpiIds', 'kpiIDs', 'kpis', 'groupKey', 'cycleKey', 'searchTokens',
    'createdByUid', 'createdByEmail', 'createdByName', 'updatedByUid', 'updatedByEmail',
    'backfillSource', 'backfilledByUid', 'backfilledByEmail',
    'password', 'passwordHash', 'refreshToken', 'accessToken', 'idNumber'
])
const INTERNAL_KEY = /(migrat|backfill|generated|repair|technical|token|password|audit|hash|snapshot|debug|internal|legacy|uid|^ids$|ids$|Id$)/i
const DATE_KEY = /(date|time|created|updated|submitted|approved|start|end|checkin|checkout|timestamp|at)$/i

const titleCase = (value: string) => value
    .replace(/\[(\d+)\]/g, ' $1')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .replace(/\bId\b/g, 'ID')
    .replace(/\bSme\b/g, 'SME')
    .replace(/\bUrl\b/g, 'URL')

const headerFor = (key: string) => {
    const leaf = key.split('.').pop() || key
    return SPECIAL_HEADERS[key] || SPECIAL_HEADERS[leaf] || titleCase(key)
}

const isTimestamp = (value: any) => value && typeof value === 'object' && typeof value.toDate === 'function'

const labelFromObject = (item: any) => first(
    item?.title,
    item?.name,
    item?.label,
    item?.description,
    item?.fileName,
    item?.url,
    item?.downloadUrl
)

const joinLabels = (items: any[] = []) => items
    .map(item => typeof item === 'object' ? labelFromObject(item) : item)
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(String)
    .join('; ')

const displayValue = (value: any, key = ''): any => {
    if (value == null) return ''
    if (isTimestamp(value)) return value.toDate()
    if (value instanceof Date) return value
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (typeof value === 'number') return value
    if (typeof value === 'string' && DATE_KEY.test(key)) {
        const parsed = dayjs(value)
        if (parsed.isValid() && /\d{4}/.test(value)) return parsed.toDate()
    }
    if (Array.isArray(value)) return joinLabels(value)
    if (typeof value === 'object') return labelFromObject(value) || ''
    return String(value)
}

const isHiddenField = (key: string, path: string) =>
    HIDDEN_FIELDS.has(key) ||
    HIDDEN_FIELDS.has(path) ||
    /(^|\.)(id|uid)$/i.test(path) ||
    /(^|\.)(.*Id|.*Ids|.*UID|.*Uid|.*Token)$/i.test(path) ||
    INTERNAL_KEY.test(key) ||
    INTERNAL_KEY.test(path)

const flatten = (input: any, prefix = '', output: Record<string, any> = {}) => {
    Object.entries(input || {}).forEach(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key
        if (isHiddenField(key, path)) return
        if (value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value) && !(value instanceof Date)) {
            flatten(value, path, output)
        } else {
            output[path] = displayValue(value, path)
        }
    })
    return output
}

const first = (...values: any[]) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '') || ''

const splitName = (fullName: any) => {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return { firstName: '', lastName: '' }
    if (parts.length === 1) return { firstName: parts[0], lastName: '' }
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

const cleanRecord = (record: Record<string, any>) => Object.fromEntries(
    Object.entries(record)
        .filter(([key]) => !isHiddenField(key, key))
        .map(([key, value]) => [key, displayValue(value, key)])
)

const smeExportRecord = (app: any) => {
    const participant = app._participant || {}
    const owner = splitName(first(app.participantName, app.ownerName, app.contactPersonName, app.name, participant.participantName, participant.ownerName, participant.name))
    return cleanRecord({
        firstName: first(app.firstName, app.applicantFirstName, app.ownerFirstName, app.contactPerson?.firstName, participant.firstName, participant.ownerFirstName, owner.firstName),
        lastName: first(app.lastName, app.surname, app.applicantSurname, app.ownerSurname, app.contactPerson?.surname, participant.lastName, participant.surname, participant.ownerSurname, owner.lastName),
        businessName: first(app.businessName, app.companyName, app.registeredName, app.beneficiaryName, participant.businessName, participant.companyName, participant.beneficiaryName),
        registrationNumber: first(app.registrationNumber, app.companyRegistrationNumber, app.cipcNumber, participant.registrationNumber, participant.companyRegistrationNumber, participant.cipcNumber, participant.smmeNo, participant.smmENo),
        email: first(app.applicantEmail, app.contactEmail, app.participantEmail, app.email, app.profile?.email, participant.email, participant.contactEmail, app._contact?.email),
        phoneNumber: first(app.phone, app.mobile, app.cellphone, app.contactNumber, app.phoneNumber, app.contactDetails, app.profile?.phone, app.profile?.contactNumber, participant.phoneNumber, participant.phone, participant.mobile, participant.cellphone, participant.contactNumber, participant.contactDetails, app._contact?.phone),
        sector: first(app.sector, app.industry, app.businessSector, app.sectorName, app.profile?.sector, participant.sector, participant.businessSector, participant.industry, participant.sectorName),
        applicationStatus: first(app.applicationStatus, app.status),
        programName: first(app.programName, app.program?.name),
        province: first(app.province, app.region, app.profile?.province, participant.province, participant.region, app._location?.province),
        town: first(app.town, app.city, app.profile?.town, app.profile?.city, participant.town, participant.city, participant.location, app._location?.city),
        businessAddress: first(app.businessAddress, app.tradingAddress, app.physicalAddress, app.profile?.businessAddress, participant.businessAddress, participant.tradingAddress, participant.physicalAddress, app._location?.streetAddress),
        submittedAt: displayValue(first(app.submittedAt, app.createdAt), 'submittedAt'),
        acceptedAt: displayValue(app.acceptedAt, 'acceptedAt')
    })
}

const participantExportRecord = (participant: any) => {
    const owner = splitName(first(participant.participantName, participant.ownerName, participant.name, participant.representativeName))
    return cleanRecord({
        firstName: first(participant.firstName, participant.ownerFirstName, owner.firstName),
        lastName: first(participant.lastName, participant.surname, participant.ownerSurname, owner.lastName),
        businessName: first(participant.businessName, participant.companyName, participant.beneficiaryName),
        registrationNumber: first(participant.registrationNumber, participant.companyRegistrationNumber, participant.cipcNumber, participant.smmeNo, participant.smmENo),
        email: first(participant.email, participant.contactEmail, participant.applicantEmail),
        phoneNumber: first(participant.phoneNumber, participant.phone, participant.mobile, participant.cellphone, participant.contactNumber, participant.contactDetails),
        sector: first(participant.sector, participant.businessSector, participant.industry, participant.sectorName),
        stage: first(participant.stage, participant.groupStage, participant.gapGroup),
        gender: participant.gender,
        province: first(participant.province, participant.region),
        town: first(participant.town, participant.city, participant.location),
        programName: first(participant.programName, participant.program?.name),
        status: first(participant.status, participant.applicationStatus),
        joinedAt: displayValue(first(participant.joinedAt, participant.acceptedAt, participant.createdAt), 'joinedAt')
    })
}

const interventionExportRecord = (item: any) => cleanRecord({
    title: first(item.title, item.interventionTitle, item.name),
    departmentName: first(item.departmentName, item.areaOfSupport, item.area),
    assignmentMode: first(item.assignmentMode, item.interventionMode, item.deliveryScheduleType),
    frequency: first(item.frequency, item.recurrencePreset, item.recurrence),
    hasSubInterventions: item.hasSubInterventions || (Array.isArray(item.subInterventions) && item.subInterventions.length > 0),
    subInterventions: joinLabels(item.subInterventions || []),
})

const assignedInterventionExportRecord = (item: any) => cleanRecord({
    beneficiaryName: first(item.beneficiaryName, item.participantName, item.businessName),
    smmeNo: first(item.smmeNo, item.smmENo),
    interventionTitle: first(item.interventionTitle, item.title, item.name),
    subInterventionTitle: item.subInterventionTitle,
    departmentName: first(item.departmentName, item.areaOfSupport, item.area),
    assigneeName: first(item.assigneeName, item.facilitatorName),
    assigneeRole: item.assigneeRole,
    status: item.assignmentStatus,
    assigneeAcceptanceStatus: item.assigneeAcceptanceStatus,
    participantAcceptanceStatus: item.participantAcceptanceStatus,
    dueDate: displayValue(item.dueDate, 'dueDate'),
    assignedAt: displayValue(first(item.assignedAt, item.createdAt), 'assignedAt'),
    completedAt: displayValue(first(item.completedAt, item.updatedAt), 'completedAt'),
    assignmentMode: item.assignmentMode,
    frequency: first(item.frequency, item.recurrencePreset, item.recurrence)
})

const movExportRecord = (item: any) => cleanRecord({
    beneficiaryName: first(item.beneficiaryName, item.smmeName, item.smmeCompanyName),
    smmeNo: first(item.smmeNo, item.smmENo),
    sector: first(item.smmeSector, item.sector),
    groupStage: item.groupStage,
    programName: item.programName,
    departmentName: first(item.departmentName, item.areaOfSupport),
    interventionTitle: item.interventionTitle,
    interventionType: item.interventionType,
    interventionMethod: first(item.interventionMethod, item.deliveryMethod),
    frequencyOfIntervention: item.frequencyOfIntervention,
    interventionDate: displayValue(item.interventionDate, 'interventionDate'),
    facilitatorName: item.facilitatorName,
    finalCheckerName: item.finalCheckerName,
    dateChecked: displayValue(item.dateChecked, 'dateChecked'),
    completedAt: displayValue(item.completedAt, 'completedAt'),
    status: item.status,
    notes: item.notes,
    attachments: joinLabels(item.attachments || [])
})

const exportRecord = (datasetKey: string, raw: any) => {
    if (datasetKey === 'smes') return smeExportRecord(raw)
    if (datasetKey === 'participants') return participantExportRecord(raw)
    if (datasetKey === 'interventions') return interventionExportRecord(raw)
    if (datasetKey === 'assignedInterventions') return assignedInterventionExportRecord(raw)
    if (datasetKey === 'movs') return movExportRecord(raw)
    return flatten(raw)
}

const recordDate = (row: Record<string, any>) => {
    const candidates = ['createdAt', 'date', 'submittedAt', 'joinedAt', 'assignedAt', 'completedAt', 'interventionDate', 'dateChecked', 'updatedAt', 'startDate', 'checkIn']
    for (const key of candidates) {
        const value = row[key]
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value
        if (value) { const parsed = dayjs(value); if (parsed.isValid()) return parsed.toDate() }
    }
    return null
}

const TableSkeleton: React.FC<{ borderColor: string }> = ({ borderColor }) => (
    <div
        style={{
            width: '100%',
            overflow: 'hidden',
            border: `1px solid ${borderColor}`,
            borderRadius: 10
        }}
    >
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, minmax(130px, 1fr))',
                gap: 16,
                padding: '11px 14px',
                borderBottom: `1px solid ${borderColor}`
            }}
        >
            {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton.Input
                    key={index}
                    active
                    size="small"
                    block
                    style={{ height: 16 }}
                />
            ))}
        </div>

        {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div
                key={rowIndex}
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, minmax(130px, 1fr))',
                    gap: 16,
                    padding: '12px 14px',
                    borderBottom:
                        rowIndex === 5 ? undefined : `1px solid ${borderColor}`
                }}
            >
                {Array.from({ length: 5 }).map((_, columnIndex) => (
                    <Skeleton.Input
                        key={columnIndex}
                        active
                        size="small"
                        block
                        style={{
                            height: 16,
                            width:
                                columnIndex === 0
                                    ? '82%'
                                    : columnIndex === 4
                                        ? '68%'
                                        : '100%'
                        }}
                    />
                ))}
            </div>
        ))}
    </div>
)

const DataExportPage: React.FC = () => {
    const { token } = theme.useToken()
    const { user, loading: identityLoading } = useFullIdentity()

    const [selected, setSelected] = useState<string[]>(['smes'])
    const [previewKey, setPreviewKey] = useState<string>('smes')
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [loading, setLoading] = useState(false)
    const [loaded, setLoaded] = useState<Record<string, Record<string, any>[]>>({})
    const [permissionsLoaded, setPermissionsLoaded] = useState(false)
    const [allowedDatasetKeys, setAllowedDatasetKeys] = useState<string[]>([])

    const role = String(user?.role || '').toLowerCase().replace(/\s+/g, '')
    const allowed = ['admin', 'director', 'operations', 'projectadmin', 'projectmanager'].includes(role)
    const departmentId = String(user?.departmentId || '')
    const isUnrestricted = role === 'admin' || role === 'director'

    const visibleDatasets = isUnrestricted
        ? DATASETS
        : DATASETS.filter(item => allowedDatasetKeys.includes(item.key))

    const selectedDatasets = visibleDatasets.filter(item =>
        selected.includes(item.key)
    )

    React.useEffect(() => {
        const loadPermissions = async () => {
            if (!user?.id || identityLoading) return

            if (isUnrestricted) {
                setAllowedDatasetKeys(DATASETS.map(item => item.key))
                setPermissionsLoaded(true)
                return
            }

            if (!departmentId) {
                setAllowedDatasetKeys([])
                setSelected([])
                setPermissionsLoaded(true)
                return
            }

            try {
                const snapshot = await getDoc(
                    doc(db, 'dataExportSettings', departmentId)
                )

                const keys =
                    snapshot.exists() &&
                        Array.isArray(snapshot.data().allowedDatasets)
                        ? snapshot
                            .data()
                            .allowedDatasets.filter((key: any) =>
                                DATASETS.some(item => item.key === key)
                            )
                        : []

                setAllowedDatasetKeys(keys)
                setSelected(current =>
                    current.filter(key => keys.includes(key))
                )
            } catch (error) {
                console.error('Failed to load data export permissions', error)
                setAllowedDatasetKeys([])
                setSelected([])
            } finally {
                setPermissionsLoaded(true)
            }
        }

        loadPermissions()
    }, [
        user?.id,
        identityLoading,
        isUnrestricted,
        departmentId
    ])

    React.useEffect(() => {
        if (!selected.length) {
            setPreviewKey('')
            return
        }

        if (!selected.includes(previewKey)) {
            setPreviewKey(selected[0])
        }
    }, [selected, previewKey])

    const toggleDataset = (dataset: Dataset) => {
        setSelected(current => {
            if (current.includes(dataset.key)) {
                return current.filter(key => key !== dataset.key)
            }

            return [...current, dataset.key]
        })

        setLoaded({})

        if (!selected.includes(dataset.key)) {
            setPreviewKey(dataset.key)
        }
    }

    const load = async () => {
        if (!selectedDatasets.length) {
            message.info('Select at least one dataset.')
            return null
        }

        setLoading(true)

        try {
            const unavailable: string[] = []

            const results = await Promise.all(
                selectedDatasets.map(async dataset => {
                    try {
                        const snapshot = await getDocs(
                            collection(db, dataset.collection)
                        )

                        let rows: Record<string, any>[]

                        if (dataset.key === 'smes') {
                            let participantsById = new Map<string, any>()

                            try {
                                const participantsSnap = await getDocs(
                                    collection(db, 'participants')
                                )

                                participantsById = new Map(
                                    participantsSnap.docs.map(participantDoc => [
                                        participantDoc.id,
                                        {
                                            id: participantDoc.id,
                                            ...(participantDoc.data() as any)
                                        }
                                    ])
                                )
                            } catch (participantError) {
                                console.warn(
                                    'SME export could not enrich from participants',
                                    participantError
                                )
                            }

                            rows = snapshot.docs.map(item => {
                                const app = item.data() as any
                                const participantId = String(
                                    app.participantId || ''
                                )

                                return exportRecord(dataset.key, {
                                    ...app,
                                    _participant: participantId
                                        ? participantsById.get(participantId)
                                        : null
                                })
                            })
                        } else {
                            rows = snapshot.docs.map(item =>
                                exportRecord(dataset.key, item.data())
                            )
                        }

                        if (dateRange) {
                            const start = dateRange[0]
                                .startOf('day')
                                .toDate()
                            const end = dateRange[1]
                                .endOf('day')
                                .toDate()

                            rows = rows.filter(row => {
                                const date = recordDate(row)
                                return !date || (date >= start && date <= end)
                            })
                        }

                        return [dataset.key, rows] as const
                    } catch (error) {
                        console.warn(
                            `Export access unavailable for ${dataset.collection}`,
                            error
                        )
                        unavailable.push(dataset.label)
                        return [dataset.key, []] as const
                    }
                })
            )

            const next = Object.fromEntries(results)
            setLoaded(next)

            if (unavailable.length) {
                message.warning(
                    `No access to: ${unavailable.join(
                        ', '
                    )}. Other selected data was loaded.`
                )
            } else {
                message.success(
                    `Loaded ${Object.values(next)
                        .reduce((sum, rows) => sum + rows.length, 0)
                        .toLocaleString()} records.`
                )
            }

            return next
        } catch (error) {
            console.error('Data export load failed', error)
            message.error(
                'Some data could not be loaded. Check your access permissions.'
            )
            return null
        } finally {
            setLoading(false)
        }
    }

    const exportExcel = async () => {
        const data = await load()

        if (!data) return

        if (!Object.values(data).some(rows => rows.length)) {
            message.info('There are no records to export.')
            return
        }

        setLoading(true)

        try {
            const XLSX = await import('xlsx')
            const workbook = XLSX.utils.book_new()

            workbook.Props = {
                Author: user?.name || 'Smart Incubation Platform',
                CreatedDate: new Date(),
                Subject: 'Structured system data export'
            }

            selectedDatasets.forEach(dataset => {
                const rows = data[dataset.key] || []
                if (!rows.length) return

                const keys = Array.from(
                    new Set(rows.flatMap(row => Object.keys(row)))
                )

                const usedHeaders = new Map<string, number>()

                const columns = keys.map(key => {
                    const base = headerFor(key)
                    const count = usedHeaders.get(base) || 0

                    usedHeaders.set(base, count + 1)

                    return {
                        key,
                        header: count
                            ? `${base} (${count + 1})`
                            : base
                    }
                })

                const table = [
                    columns.map(column => column.header),
                    ...rows.map(row =>
                        columns.map(column => row[column.key] ?? '')
                    )
                ]

                const sheet = XLSX.utils.aoa_to_sheet(table, {
                    cellDates: true,
                    dateNF: 'dd mmm yyyy hh:mm'
                })

                sheet['!cols'] = columns.map(column => ({
                    wch: Math.min(
                        45,
                        Math.max(
                            14,
                            column.header.length + 2,
                            ...rows
                                .slice(0, 200)
                                .map(
                                    row =>
                                        String(
                                            row[column.key] ?? ''
                                        ).length + 2
                                )
                        )
                    )
                }))

                sheet['!autofilter'] = {
                    ref: XLSX.utils.encode_range(
                        { r: 0, c: 0 },
                        {
                            r: Math.max(0, rows.length),
                            c: Math.max(0, columns.length - 1)
                        }
                    )
                }

                sheet['!freeze'] = {
                    xSplit: 0,
                    ySplit: 1,
                    topLeftCell: 'A2',
                    activePane: 'bottomLeft',
                    state: 'frozen'
                } as any

                XLSX.utils.book_append_sheet(
                    workbook,
                    sheet,
                    dataset.sheet.slice(0, 31)
                )
            })

            const summary = XLSX.utils.json_to_sheet(
                selectedDatasets.map(item => ({
                    Dataset: item.label,
                    'Records Exported': data[item.key]?.length || 0,
                    'Source Collection': item.collection
                }))
            )

            summary['!cols'] = [
                { wch: 32 },
                { wch: 20 },
                { wch: 28 }
            ]

            XLSX.utils.book_append_sheet(
                workbook,
                summary,
                'Export Summary'
            )

            XLSX.writeFile(
                workbook,
                `Smart_Incubation_Data_Export_${dayjs().format(
                    'YYYY-MM-DD_HHmm'
                )}.xlsx`,
                { compression: true }
            )

            message.success(
                'Excel workbook exported successfully.'
            )
        } catch (error) {
            console.error('Excel export failed', error)
            message.error(
                'The Excel workbook could not be created.'
            )
        } finally {
            setLoading(false)
        }
    }

    const previewDataset =
        selectedDatasets.find(item => item.key === previewKey) ||
        selectedDatasets[0]

    const previewRows = previewDataset
        ? loaded[previewDataset.key] || []
        : []

    const previewLoaded = previewDataset
        ? Object.prototype.hasOwnProperty.call(
            loaded,
            previewDataset.key
        )
        : false

    const previewKeys = Array.from(
        new Set(
            previewRows
                .slice(0, 20)
                .flatMap(row => Object.keys(row))
        )
    ).slice(0, 8)

    const previewColumns: ColumnsType<Record<string, any>> =
        previewKeys.map(key => ({
            title: headerFor(key),
            dataIndex: key,
            key,
            ellipsis: true,
            width: 170,
            render: value =>
                value instanceof Date
                    ? dayjs(value).format('DD MMM YYYY HH:mm')
                    : String(value ?? '')
        }))

    const totalLoaded = Object.values(loaded).reduce(
        (sum, rows) => sum + rows.length,
        0
    )

    const previewSourceRows =
        selectedDatasets.length > 6
            ? [
                selectedDatasets.slice(
                    0,
                    Math.ceil(selectedDatasets.length / 2)
                ),
                selectedDatasets.slice(
                    Math.ceil(selectedDatasets.length / 2)
                )
            ]
            : [selectedDatasets]

    const previewFilterBar = (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                flexWrap: 'wrap'
            }}
        >
            <div
                style={{
                    flex: '1 1 280px',
                    minWidth: 0
                }}
            >
                <RangePicker
                    style={{ width: '100%' }}
                    value={dateRange}
                    onChange={dates => {
                        setDateRange(
                            dates as [Dayjs, Dayjs] | null
                        )
                        setLoaded({})
                    }}
                    placeholder={['Start date', 'End date']}
                />
            </div>

            <Space
                size={8}
                style={{
                    marginLeft: 'auto'
                }}
            >
                <Button
                    shape='round'
                    onClick={load}
                    disabled={!selected.length || loading}
                >
                    Load preview
                </Button>

                <Button
                    shape='round'
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    loading={loading}
                    disabled={!selected.length}
                    onClick={exportExcel}
                >
                    Export Excel
                </Button>
            </Space>
        </div>
    )

    if (identityLoading || !permissionsLoaded) {
        return (
            <div
                style={{
                    padding: '20px 24px'
                }}
            >
                <Row gutter={[18, 18]}>
                    <Col xs={24} xl={8}>
                        <MotionCard bordered={false}>
                            <Skeleton active paragraph={{ rows: 12 }} />
                        </MotionCard>
                    </Col>

                    <Col xs={24} xl={16}>
                        <MotionCard bordered={false}>
                            <TableSkeleton
                                borderColor={token.colorBorderSecondary}
                            />
                        </MotionCard>
                    </Col>
                </Row>
            </div>
        )
    }

    if (!allowed) {
        return (
            <Alert
                type="error"
                showIcon
                message="Data export access is restricted."
                description="Only authorised management and operations users can export system data."
            />
        )
    }

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>
                    Data Export Centre | Smart Incubation
                </title>
            </Helmet>

            <Row gutter={[18, 18]}>
                {!isUnrestricted &&
                    visibleDatasets.length === 0 && (
                        <Col span={24}>
                            <Alert
                                type="warning"
                                showIcon
                                message="No export datasets have been assigned to your department."
                                description="Ask the System Admin to configure Data Export access for your department."
                            />
                        </Col>
                    )}

                <Col xs={24} xl={8}>
                    <MotionCard
                        bordered={false}
                        style={{
                            borderRadius: 14
                        }}
                    >
                        <Space
                            direction="vertical"
                            size={12}
                            style={{ width: '100%' }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    justifyContent: 'space-between',
                                    gap: 12
                                }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    <Text strong style={{ fontSize: 15 }}>
                                        Export sources
                                    </Text>
                                    <div
                                        style={{
                                            marginTop: 3,
                                            color: token.colorTextSecondary,
                                            fontSize: 12
                                        }}
                                    >
                                        Each selected source is exported to its own worksheet.
                                    </div>
                                </div>

                                <Tag
                                    color="blue"
                                    style={{
                                        marginInlineEnd: 0,
                                        flex: '0 0 auto'
                                    }}
                                >
                                    {selected.length} selected
                                </Tag>
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        'repeat(2, minmax(0, 1fr))',
                                    gap: 7,
                                    width: '100%'
                                }}
                            >
                                {visibleDatasets.map(dataset => {
                                    const isSelected = selected.includes(
                                        dataset.key
                                    )
                                    const isWide =
                                        isWideDatasetCard(dataset)

                                    return (
                                        <button
                                            key={dataset.key}
                                            type="button"
                                            onClick={() =>
                                                toggleDataset(dataset)
                                            }
                                            style={{
                                                position: 'relative',
                                                gridColumn: isWide
                                                    ? '1 / -1'
                                                    : undefined,
                                                width: '100%',
                                                minWidth: 0,
                                                minHeight: 54,
                                                border: isSelected
                                                    ? `1px solid ${token.colorPrimary}`
                                                    : `1px solid ${token.colorBorderSecondary}`,
                                                background: isSelected
                                                    ? token.colorPrimaryBg
                                                    : token.colorBgContainer,
                                                borderRadius: 11,
                                                padding: isSelected
                                                    ? '8px 30px 8px 9px'
                                                    : '8px 9px',
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    '32px minmax(0, 1fr)',
                                                alignItems: 'center',
                                                gap: 8,
                                                textAlign: 'left',
                                                cursor: 'pointer',
                                                boxShadow: isSelected
                                                    ? `0 4px 14px ${token.colorPrimaryBgHover}`
                                                    : 'none',
                                                transition: 'all .18s ease'
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: 9,
                                                    display: 'grid',
                                                    placeItems: 'center',
                                                    background: isSelected
                                                        ? token.colorPrimary
                                                        : token.colorFillSecondary,
                                                    color: isSelected
                                                        ? token.colorTextLightSolid
                                                        : token.colorTextSecondary,
                                                    fontSize: 15
                                                }}
                                            >
                                                {DATASET_ICONS[dataset.key] || (
                                                    <DatabaseOutlined />
                                                )}
                                            </div>

                                            <Text
                                                strong
                                                style={{
                                                    minWidth: 0,
                                                    fontSize: 12,
                                                    lineHeight: 1.3,
                                                    whiteSpace: 'normal',
                                                    overflowWrap: 'anywhere',
                                                    color: token.colorText
                                                }}
                                            >
                                                {dataset.label}
                                            </Text>

                                            {isSelected && (
                                                <span
                                                    style={{
                                                        position: 'absolute',
                                                        top: 6,
                                                        right: 7,
                                                        width: 17,
                                                        height: 17,
                                                        borderRadius: 999,
                                                        display: 'grid',
                                                        placeItems: 'center',
                                                        background:
                                                            token.colorPrimary,
                                                        color:
                                                            token.colorTextLightSolid,
                                                        fontSize: 9
                                                    }}
                                                >
                                                    <CheckOutlined />
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </Space>
                    </MotionCard>
                </Col>

                <Col xs={24} xl={16}>
                    <Row
                        gutter={[12, 12]}
                        style={{ marginBottom: 18 }}
                    >
                        <Col xs={12}>
                            <MotionCard.Metric
                                icon={<DatabaseOutlined />}
                                iconBg="rgba(23,107,135,.12)"
                                title="Sources selected"
                                value={selected.length}
                                subtitle="Exported as separate Excel sheets"
                            />
                        </Col>

                        <Col xs={12}>
                            <MotionCard.Metric
                                icon={<FileExcelOutlined />}
                                iconBg="rgba(82,196,26,.12)"
                                title="Records loaded"
                                value={totalLoaded.toLocaleString()}
                                subtitle="Ready for export"
                            />
                        </Col>
                    </Row>

                    <MotionCard
                        bordered={false}
                        style={{ borderRadius: 14 }}
                        filterBar={previewFilterBar}
                        filterBarProps={{
                            marginBottom: 14,
                            padding: 10,
                            background: token.colorFillQuaternary,
                            borderColor: token.colorBorderSecondary,
                            borderRadius: 10
                        }}
                    >
                        <Space
                            direction="vertical"
                            size={12}
                            style={{ width: '100%' }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems:
                                        selectedDatasets.length > 6
                                            ? 'flex-start'
                                            : 'center',
                                    gap: 10,
                                    width: '100%',
                                    minWidth: 0
                                }}
                            >

                                {selectedDatasets.length > 1 && (
                                    <div
                                        style={{
                                            flex: '1 1 auto',
                                            minWidth: 0,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            borderRadius: 10,
                                            padding: 3,
                                            background:
                                                token.colorFillQuaternary,
                                            display: 'grid',
                                            gap: 3,
                                            overflow: 'hidden'
                                        }}
                                    >
                                        {previewSourceRows.map(
                                            (rowDatasets, rowIndex) => (
                                                <div
                                                    key={`preview-source-row-${rowIndex}`}
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: `repeat(${rowDatasets.length}, minmax(0, 1fr))`,
                                                        gap: 3,
                                                        minWidth: 0
                                                    }}
                                                >
                                                    {rowDatasets.map(
                                                        dataset => {
                                                            const active =
                                                                dataset.key ===
                                                                previewDataset?.key

                                                            const hasLoaded =
                                                                Object.prototype.hasOwnProperty.call(
                                                                    loaded,
                                                                    dataset.key
                                                                )

                                                            const count = (
                                                                loaded[
                                                                dataset.key
                                                                ] || []
                                                            ).length

                                                            return (
                                                                <button
                                                                    key={
                                                                        dataset.key
                                                                    }
                                                                    type="button"
                                                                    title={
                                                                        dataset.label
                                                                    }
                                                                    onClick={() =>
                                                                        setPreviewKey(
                                                                            dataset.key
                                                                        )
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            '100%',
                                                                        minWidth: 0,
                                                                        height: 32,
                                                                        border:
                                                                            active
                                                                                ? `1px solid ${token.colorPrimaryBorder}`
                                                                                : '1px solid transparent',
                                                                        borderRadius: 7,
                                                                        background:
                                                                            active
                                                                                ? token.colorBgContainer
                                                                                : 'transparent',
                                                                        color:
                                                                            active
                                                                                ? token.colorPrimaryText
                                                                                : token.colorTextSecondary,
                                                                        boxShadow:
                                                                            active
                                                                                ? token.boxShadowTertiary
                                                                                : 'none',
                                                                        padding:
                                                                            '0 7px',
                                                                        display:
                                                                            'flex',
                                                                        alignItems:
                                                                            'center',
                                                                        justifyContent:
                                                                            'center',
                                                                        gap: 5,
                                                                        cursor:
                                                                            'pointer',
                                                                        transition:
                                                                            'background .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease'
                                                                    }}
                                                                >
                                                                    <span
                                                                        style={{
                                                                            display:
                                                                                'inline-flex',
                                                                            flex:
                                                                                '0 0 auto',
                                                                            fontSize: 14
                                                                        }}
                                                                    >
                                                                        {DATASET_ICONS[
                                                                            dataset
                                                                                .key
                                                                        ] || (
                                                                                <DatabaseOutlined />
                                                                            )}
                                                                    </span>

                                                                    <span
                                                                        style={{
                                                                            minWidth: 0,
                                                                            overflow:
                                                                                'hidden',
                                                                            textOverflow:
                                                                                'ellipsis',
                                                                            whiteSpace:
                                                                                'nowrap',
                                                                            fontSize: 12,
                                                                            fontWeight:
                                                                                active
                                                                                    ? 600
                                                                                    : 500
                                                                        }}
                                                                    >
                                                                        {DATASET_PREVIEW_LABELS[
                                                                            dataset
                                                                                .key
                                                                        ] ||
                                                                            dataset.label}
                                                                    </span>

                                                                    {hasLoaded && (
                                                                        <span
                                                                            style={{
                                                                                flex:
                                                                                    '0 0 auto',
                                                                                fontSize: 10,
                                                                                color:
                                                                                    active
                                                                                        ? token.colorPrimary
                                                                                        : token.colorTextQuaternary
                                                                            }}
                                                                        >
                                                                            {count.toLocaleString()}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            )
                                                        }
                                                    )}
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}

                                {selectedDatasets.length === 1 &&
                                    previewDataset && (
                                        <div
                                            style={{
                                                minWidth: 0,
                                                flex: '1 1 auto',
                                                textAlign: 'right'
                                            }}
                                        >
                                            <Text
                                                type="secondary"
                                                ellipsis={{
                                                    tooltip:
                                                        previewDataset.description
                                                }}
                                                style={{
                                                    fontSize: 12
                                                }}
                                            >
                                                {previewDataset.label}
                                            </Text>
                                        </div>
                                    )}
                            </div>

                            {previewLoaded && previewDataset && (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 8
                                    }}
                                >
                                    <Text
                                        type="secondary"
                                        style={{ fontSize: 12 }}
                                    >
                                        Previewing one source at a time. The workbook keeps selected sources on separate sheets.
                                    </Text>

                                    <Tag
                                        color="blue"
                                        style={{
                                            marginInlineEnd: 0,
                                            flex: '0 0 auto'
                                        }}
                                    >
                                        {previewRows.length.toLocaleString()} records
                                    </Tag>
                                </div>
                            )}

                            {loading ? (
                                <TableSkeleton
                                    borderColor={
                                        token.colorBorderSecondary
                                    }
                                />
                            ) : !previewDataset ? (
                                <Empty description="Select a source to begin." />
                            ) : !previewLoaded ? (
                                <Empty description="Load a preview to inspect the formatted data." />
                            ) : !previewRows.length ? (
                                <Empty
                                    description={`No records found for ${previewDataset.label}.`}
                                />
                            ) : (
                                <Table
                                    rowKey={row => JSON.stringify(row)}
                                    size="small"
                                    columns={previewColumns}
                                    dataSource={previewRows.slice(0, 10)}
                                    pagination={false}
                                    scroll={{ x: 'max-content' }}
                                />
                            )}
                        </Space>
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}

export default DataExportPage
