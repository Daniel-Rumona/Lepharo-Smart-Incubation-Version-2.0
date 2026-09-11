import React, { useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    DatePicker,
    Empty,
    Row,
    Select,
    Space,
    Spin,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CloudDownloadOutlined,
    DatabaseOutlined,
    FileExcelOutlined,
    SafetyCertificateOutlined
} from '@ant-design/icons'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

const { Text, Paragraph } = Typography
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
    { key: 'smes', label: 'SMEs and Applications', collection: 'applications', sheet: 'SMEs', group: 'SMEs', description: 'Applicant, business, programme and application information.' },
    { key: 'participants', label: 'Participants', collection: 'participants', sheet: 'Participants', group: 'SMEs', description: 'Onboarded participant and beneficiary records.' },
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
    description: item.description,
    departmentName: first(item.departmentName, item.areaOfSupport, item.area),
    category: first(item.category, item.type),
    assignmentMode: first(item.assignmentMode, item.interventionMode, item.deliveryScheduleType),
    frequency: first(item.frequency, item.recurrencePreset, item.recurrence),
    hasSubInterventions: item.hasSubInterventions || (Array.isArray(item.subInterventions) && item.subInterventions.length > 0),
    subInterventions: joinLabels(item.subInterventions || []),
    status: item.status
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

const DataExportPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const [selected, setSelected] = useState<string[]>(['smes'])
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [loading, setLoading] = useState(false)
    const [loaded, setLoaded] = useState<Record<string, Record<string, any>[]>>({})
    const [permissionsLoaded, setPermissionsLoaded] = useState(false)
    const [allowedDatasetKeys, setAllowedDatasetKeys] = useState<string[]>([])

    const role = String(user?.role || '').toLowerCase().replace(/\s+/g, '')
    const allowed = ['admin', 'director', 'operations', 'projectadmin', 'projectmanager'].includes(role)
    const departmentId = String(user?.departmentId || '')
    const isUnrestricted = role === 'admin' || role === 'director'
    const visibleDatasets = isUnrestricted ? DATASETS : DATASETS.filter(item => allowedDatasetKeys.includes(item.key))
    const selectedDatasets = visibleDatasets.filter(item => selected.includes(item.key))

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
                const snapshot = await getDoc(doc(db, 'dataExportSettings', departmentId))
                const keys = snapshot.exists() && Array.isArray(snapshot.data().allowedDatasets)
                    ? snapshot.data().allowedDatasets.filter((key: any) => DATASETS.some(item => item.key === key))
                    : []
                setAllowedDatasetKeys(keys)
                setSelected(current => current.filter(key => keys.includes(key)))
            } catch (error) {
                console.error('Failed to load data export permissions', error)
                setAllowedDatasetKeys([])
                setSelected([])
            } finally {
                setPermissionsLoaded(true)
            }
        }
        loadPermissions()
    }, [user?.id, identityLoading, isUnrestricted, departmentId])

    const load = async () => {
        if (!selectedDatasets.length) return message.info('Select at least one dataset.')
        setLoading(true)
        try {
            const unavailable: string[] = []
            const results = await Promise.all(selectedDatasets.map(async dataset => {
                try {
                    const snapshot = await getDocs(collection(db, dataset.collection))
                    let rows: Record<string, any>[]
                    if (dataset.key === 'smes') {
                        let participantsById = new Map<string, any>()
                        try {
                            const participantsSnap = await getDocs(collection(db, 'participants'))
                            participantsById = new Map(
                                participantsSnap.docs.map(participantDoc => [
                                    participantDoc.id,
                                    { id: participantDoc.id, ...(participantDoc.data() as any) }
                                ])
                            )
                        } catch (participantError) {
                            console.warn('SME export could not enrich from participants', participantError)
                        }
                        rows = snapshot.docs.map(item => {
                            const app = item.data() as any
                            const participantId = String(app.participantId || '')
                            return exportRecord(dataset.key, {
                                ...app,
                                _participant: participantId ? participantsById.get(participantId) : null
                            })
                        })
                    } else {
                        rows = snapshot.docs.map(item => exportRecord(dataset.key, item.data()))
                    }
                    if (dateRange) {
                        const start = dateRange[0].startOf('day').toDate()
                        const end = dateRange[1].endOf('day').toDate()
                        rows = rows.filter(row => { const date = recordDate(row); return !date || (date >= start && date <= end) })
                    }
                    return [dataset.key, rows] as const
                } catch (error) {
                    console.warn(`Export access unavailable for ${dataset.collection}`, error)
                    unavailable.push(dataset.label)
                    return [dataset.key, []] as const
                }
            }))
            const next = Object.fromEntries(results)
            setLoaded(next)
            if (unavailable.length) message.warning(`No access to: ${unavailable.join(', ')}. Other selected data was loaded.`)
            else message.success(`Loaded ${Object.values(next).reduce((sum, rows) => sum + rows.length, 0).toLocaleString()} records.`)
            return next
        } catch (error) {
            console.error('Data export load failed', error)
            message.error('Some data could not be loaded. Check your access permissions.')
            return null
        } finally {
            setLoading(false)
        }
    }

    const exportExcel = async () => {
        const data = await load()
        if (!data) return
        if (!Object.values(data).some(rows => rows.length)) return message.info('There are no records to export.')
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
                const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
                const usedHeaders = new Map<string, number>()
                const columns = keys.map(key => {
                    const base = headerFor(key)
                    const count = usedHeaders.get(base) || 0
                    usedHeaders.set(base, count + 1)
                    return { key, header: count ? `${base} (${count + 1})` : base }
                })
                const table = [columns.map(column => column.header), ...rows.map(row => columns.map(column => row[column.key] ?? ''))]
                const sheet = XLSX.utils.aoa_to_sheet(table, { cellDates: true, dateNF: 'dd mmm yyyy hh:mm' })
                sheet['!cols'] = columns.map(column => ({
                    wch: Math.min(45, Math.max(14, column.header.length + 2, ...rows.slice(0, 200).map(row => String(row[column.key] ?? '').length + 2)))
                }))
                sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, rows.length), c: Math.max(0, columns.length - 1) }) }
                sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' } as any
                XLSX.utils.book_append_sheet(workbook, sheet, dataset.sheet.slice(0, 31))
            })
            const summary = XLSX.utils.json_to_sheet(selectedDatasets.map(item => ({
                Dataset: item.label,
                'Records Exported': data[item.key]?.length || 0,
                'Source Collection': item.collection
            })))
            summary['!cols'] = [{ wch: 32 }, { wch: 20 }, { wch: 28 }]
            XLSX.utils.book_append_sheet(workbook, summary, 'Export Summary')
            XLSX.writeFile(workbook, `Smart_Incubation_Data_Export_${dayjs().format('YYYY-MM-DD_HHmm')}.xlsx`, { compression: true })
            message.success('Excel workbook exported successfully.')
        } catch (error) {
            console.error('Excel export failed', error)
            message.error('The Excel workbook could not be created.')
        } finally {
            setLoading(false)
        }
    }

    const previewDataset = selectedDatasets[0]
    const previewRows = previewDataset ? loaded[previewDataset.key] || [] : []
    const previewKeys = Array.from(new Set(previewRows.slice(0, 20).flatMap(row => Object.keys(row)))).slice(0, 8)
    const previewColumns: ColumnsType<Record<string, any>> = previewKeys.map(key => ({ title: headerFor(key), dataIndex: key, key, ellipsis: true, width: 170, render: value => value instanceof Date ? dayjs(value).format('DD MMM YYYY HH:mm') : String(value ?? '') }))
    const groups = useMemo(() => Array.from(new Set(DATASETS.map(item => item.group))), [])

    if (identityLoading) return (
        <div
            style={{
                display: 'grid',
                placeItems: 'center',
                minHeight: '100vh'
            }}>
            <LoadingOverlay tip='Loading user identity...' />
        </div>
    )
    if (!allowed) return <Alert type='error' showIcon message='Data export access is restricted.' description='Only authorised management and operations users can export system data.' />
    if (!permissionsLoaded) return <div style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}><Spin size='large' /></div>

    return (
        <div style={{ padding: 24, minHeight: '100vh', background: '#f5f8fb' }}>
            <Helmet>
                <title>Data Export Centre | Smart Incubation</title>
            </Helmet>

            <DashboardHeaderCard title='Data Export Centre' titleIcon={<FileExcelOutlined />} subtitle='Create clean, structured Excel workbooks from live system data.' extraRight={<Tag icon={<SafetyCertificateOutlined />} color='green'>Authorised access</Tag>} />

            <Row gutter={[18, 18]}>
                {!isUnrestricted && visibleDatasets.length === 0 && <Col span={24}><Alert type='warning' showIcon message='No export datasets have been assigned to your department.' description='Ask the System Admin to configure Data Export access for your department.' /></Col>}
                <Col xs={24} xl={8}>
                    <MotionCard title={<Space><DatabaseOutlined />Choose data</Space>} bordered={false} style={{ borderRadius: 14 }}>
                        <Paragraph type='secondary'>Select one or more datasets. Each dataset becomes a separate, labelled worksheet.</Paragraph>
                        <Select mode='multiple' size='large' value={selected} onChange={value => { setSelected(value); setLoaded({}) }} style={{ width: '100%' }} placeholder='Select datasets' optionFilterProp='label' options={groups.map(group => ({ label: group, options: visibleDatasets.filter(item => item.group === group).map(item => ({ value: item.key, label: item.label })) })).filter(group => group.options.length)} />
                        <Space direction='vertical' style={{ width: '100%', marginTop: 18 }} size='middle'>
                            <div><Text strong>Optional date range</Text><RangePicker style={{ width: '100%', marginTop: 6 }} value={dateRange} onChange={dates => { setDateRange(dates as [Dayjs, Dayjs] | null); setLoaded({}) }} /></div>
                            <Button block onClick={load} disabled={!selected.length}>Load preview</Button>
                            <Button block type='primary' size='large' icon={<CloudDownloadOutlined />} loading={loading} disabled={!selected.length} onClick={exportExcel}>Export Excel workbook</Button>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} xl={16}>
                    <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
                        <Col xs={12}><MotionCard><MotionCard.Metric icon={<DatabaseOutlined />} iconBg='rgba(23,107,135,.12)' title='Datasets selected' value={selected.length} subtitle='Available in this workbook' /></MotionCard></Col>
                        <Col xs={12}><MotionCard><MotionCard.Metric icon={<FileExcelOutlined />} iconBg='rgba(82,196,26,.12)' title='Records loaded' value={Object.values(loaded).reduce((sum, rows) => sum + rows.length, 0).toLocaleString()} subtitle='Ready for export' /></MotionCard></Col>
                    </Row>
                    <MotionCard title={previewDataset ? `${previewDataset.label} preview` : 'Data preview'} bordered={false} style={{ borderRadius: 14 }} extra={previewRows.length ? <Tag color='blue'>{previewRows.length.toLocaleString()} records</Tag> : null}>
                        <Spin spinning={loading}>
                            {!previewRows.length ? <Empty description='Load a preview to inspect the formatted data.' /> : <Table rowKey={row => String(row.id || JSON.stringify(row))} size='small' columns={previewColumns} dataSource={previewRows.slice(0, 10)} pagination={false} scroll={{ x: 'max-content' }} />}
                        </Spin>
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}

export default DataExportPage
