import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Row,
    Col,
    Card,
    Table,
    Typography,
    Segmented,
    Space,
    Tag,
    Descriptions,
    Empty,
    Skeleton,
    Alert,
    DatePicker,
    message,
    Input,
    Select,
    Button,
    Grid,
    Pagination,
    Modal,
    Form,
    InputNumber,
    Popconfirm,
    theme
} from 'antd'
import {
    TeamOutlined,
    DollarCircleOutlined,
    UserOutlined,
    FileProtectOutlined,
    DownloadOutlined,
    FileTextOutlined,
    PlusOutlined,
    UsergroupAddOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    UnorderedListOutlined,
    WarningOutlined,
    EyeInvisibleOutlined,
    ThunderboltOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    orderBy,
    documentId,
    addDoc,
    writeBatch,
    serverTimestamp
} from 'firebase/firestore'
import { faker } from '@faker-js/faker/locale/en_ZA'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import { auth, db, functions } from '@/firebase'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { hasSmeGapSubmission } from '@/utils/agreementStatus'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import dayjs, { Dayjs } from 'dayjs'
import * as XLSX from 'xlsx'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import GapAnalysisViewModal from '@/routes/gap/view/GapModal'
import { type MoaVars, renderMoaPages, saveMoaDocx } from '@/components/modals/Contracts/moa.pages'
import '@/styles/contract-paper.css'

import { getSMEInterventionSummary } from '@/services/diagnosticPlanService'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const FINANCE_API_BASE_URL = 'https://quantnow-sa1e.onrender.com'

const CREATE_USER_URL =
    'https://us-central1-lph-smart-inc.cloudfunctions.net/createPlatformUser'

const SA_PROVINCES = [
    'Gauteng',
    'Western Cape',
    'KwaZulu-Natal',
    'Eastern Cape',
    'Free State',
    'Limpopo',
    'Mpumalanga',
    'North West',
    'Northern Cape'
]

const SA_SECTORS = [
    'Agriculture',
    'Manufacturing',
    'Retail',
    'Construction',
    'ICT',
    'Tourism',
    'Professional Services',
    'Transport & Logistics'
]

const { Title, Text } = Typography
const { Search } = Input
const { RangePicker } = DatePicker
const { useBreakpoint } = Grid

const MOA_KEYWORD_HEADING = /^(ARBITRATION|GENERAL|RELATIONSHIP|WAIVER|AMENDMENTS?|INDULGENCES|CESSION AND DELEGATION|SEVERABILITY|NON-SOLICITATION|FORCE MAJEURE|GOOD FAITH|DUPLICATE ORIGINALS|COOPERATION|LIMITATION OF LIABILITY)\b/i

const moaRomSignature = (meta: any) =>
    meta?.romSignatureURL || meta?.romSignatureUrl || ''

const moaParticipantSignature = (meta: any) => {
    const explicit =
        meta?.participantSignatureURL || meta?.participantSignatureUrl ||
        meta?.smmeSignatureURL || meta?.smmeSignatureUrl
    if (explicit) return explicit
    const generic =
        meta?.signatureURL || meta?.signatureUrl || meta?.userSignatureURL ||
        meta?.userSignatureUrl || meta?.signer?.signatureURL || meta?.signer?.signatureUrl
    return generic && generic !== moaRomSignature(meta) ? generic : ''
}

const renderStyledMoaPage = (page: string, pageIndex: number) => (
    <div className={pageIndex === 0 ? 'moa-preview-cover' : 'moa-preview-copy'}>
        {page.split(/\r?\n/).map((line, lineIndex) => {
            const text = line.trim()
            if (!text) return <div key={lineIndex} className='moa-preview-spacer' />

            if (pageIndex === 0) {
                const emphasized =
                    lineIndex === 0 ||
                    text === 'AND' ||
                    text.startsWith('LEPHARO INCUBATION PROGRAMME') ||
                    /^[A-Z0-9 &().-]{5,}$/.test(text)
                return <p key={lineIndex} className={lineIndex === 0 ? 'moa-preview-cover-title' : undefined}>
                    {emphasized ? <strong>{text}</strong> : text}
                </p>
            }

            const mainClause = /^(\d+)\.?\s+(.*)$/.exec(text)
            if (mainClause) {
                return <p key={lineIndex} className='moa-preview-heading moa-preview-heading--1'>
                    {text}
                </p>
            }

            if (/^\d+(?:\.\d+)+\s+/.test(text)) {
                return <p key={lineIndex} className='moa-preview-paragraph moa-preview-subclause'>{text}</p>
            }

            if (MOA_KEYWORD_HEADING.test(text) || text === 'NOW, THEREFORE THE PARTIES AGREE AS FOLLOWS:') {
                return <p key={lineIndex} className='moa-preview-heading moa-preview-heading--2'>{text}</p>
            }

            const definition = /^(\s*(?:\d+(?:\.\d+){1,4}\s+)?)((?:“|\")[A-Z][A-Z\s/-]+(?:”|\"))(.*)$/.exec(line)
            if (definition) {
                return <p key={lineIndex} className='moa-preview-paragraph'>
                    {definition[1]}<strong>{definition[2]}</strong>{definition[3]}
                </p>
            }

            return <p key={lineIndex} className='moa-preview-paragraph'>{line}</p>
        })}
    </div>
)

type Application = {
    id: string
    participantId?: string
    beneficiaryName?: string
    companyName?: string
    businessName?: string
    smmeNo?: string
    idNumber?: string
    sector?: string
    town?: string
    province?: string
    location?: string
    gender?: string
    email?: string
    programId?: string
    applicationStatus?: string
    businessAddress?: string
    beeLevel?: string
    branchId?: string
    branchName?: string
    profile?: any
    hub?: string
    acceptedAt?: any
    updatedAt?: any
    gapGroup?: string
    signedAgreements?: Record<string, any>
}

type ProgramDoc = {
    id: string
    isMultiBranch?: boolean
    assignedBranch?: {
        id?: string
        name?: string
    }
    branchId?: string
}

type Participant = {
    id: string
    email?: string
    phone?: string
    gender?: string
    sector?: string
    town?: string
    province?: string
    location?: string
    idNumber?: string
    nationalId?: string
    registrationNumber?: string
    blackOwnedPercent?: number
    femaleOwnedPercent?: number
    youthOwnedPercent?: number
    businessAddress?: string
    beeLevel?: string
    branchId?: string
    branchName?: string
    revenueHistory?: {
        monthly?: Record<string, number>
    }
    headcountHistory?: {
        monthly?: Record<string, { permanent?: number; temporary?: number }>
    }
}

type MonthlyPerfRow = {
    month: string
    revenue?: number
    headPermanent?: number
    headTemporary?: number
    traffic?: number
    networking?: number
}

type OwnershipSummary = {
    blackOwnedPercent?: number
    femaleOwnedPercent?: number
    youthOwnedPercent?: number
}

type SmeRow = {
    appId: string
    participantId?: string | null
    programId?: string
    smmeNo?: string
    registrationNumber?: string
    idNumber?: string
    companyName: string
    sector?: string
    gender?: string
    town?: string
    province?: string
    location?: string
    email?: string
    phone?: string
    businessAddress?: string
    beeLevel?: string
    branchId?: string
    branchName?: string
    hub?: string
    group?: string
    recruitedAt?: any
    onboardedAt?: any
    manuallyCreated?: boolean
    gapCompleted: boolean
    ownership: OwnershipSummary
    metrics: {
        totalRevenue: number
        currentEmployees: number
    }
}

type SmePerformanceDetail = {
    mergedRevenue: (number | null)[]
    mergedPerm: (number | null)[]
    mergedTemp: (number | null)[]
    mergedTraffic: (number | null)[]
    mergedNetworking: (number | null)[]
}

type Intervention = {
    id: string
    status?: string
    areaOfSupport?: string
    departmentId?: string
    departmentName?: string
    interventionTitle?: string
    dueDate?: any
    assignedAt?: any
    createdAt?: any
    updatedAt?: any
    completedAt?: any
    userConfirmedAt?: any
    assigneeCompletedAt?: any
}

type ComplianceDoc = {
    id: string
    status: string
    kind: 'upload' | 'agreement'
    title: string
    url?: string
    expiryDate?: any
    signed?: boolean
    acceptedAt?: any
    storagePath?: string
    meta?: any
}

type MoaViewerState = {
    vars: MoaVars
    meta: any
}

type MonthlyFinancePoint = {
    month: string
    monthLabel?: string
    revenue: number
}

type JobContract = {
    id: string
    applicationId?: string
    employeeName?: string
    position?: string
    contractType?: 'permanent' | 'temporal'
    contractEndDate?: any
    uploadMonth?: string
    uploadMonthDate?: any
    createdAt?: any
    updatedAt?: any
}

type ComplianceStats = {
    total: number
    valid: number
    expired: number
    pending: number
    invalid: number
    queried: number
}

const canonicalComplianceId = (value: string) => {
    const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (/\bmoa\b/.test(normalized) || normalized.includes('memorandum of agreement')) return 'moa'
    if (normalized.includes('gap analysis')) return 'gap-analysis'
    if (normalized.includes('pre incubation')) return 'pre-incubation-contract'
    if (normalized.includes('popia') || normalized.includes('protection of personal information')) return 'popia'
    return normalized || 'document'
}

const standardComplianceName = (id: string, title?: string) => {
    const key = canonicalComplianceId(`${id} ${title || ''}`)
    if (key === 'moa') return 'Memorandum of Agreement (MOA)'
    if (key === 'gap-analysis') return 'GAP Analysis'
    if (key === 'pre-incubation-contract') return 'Pre-Incubation Agreement'
    if (key === 'popia') return 'POPIA Agreement'
    const normalized = String(title || id).toLowerCase()
    if (normalized.includes('b bbee') || normalized.includes('bbbee') || normalized.includes('b-bbee')) {
        return 'B-BBEE Certificate/Affidavit'
    }
    if (normalized.includes('cipc')) return 'CIPC Registration Documents'
    if (normalized.includes('certified id') || normalized.includes('id copy')) return 'Certified ID Copy'
    if (normalized.includes('proof of address')) return 'Proof of Address'
    return String(title || id)
        .replace(/\(signed\)/gi, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase())
        .trim()
}

const directDocumentUrl = (value: any) =>
    value?.signedFileURL || value?.signedFileUrl || value?.downloadURL ||
    value?.fileURL || value?.fileUrl || value?.pdfUrl || value?.pdfURL ||
    value?._original?.pdfUrl || value?._original?.url || value?.url || value?.file?.url

const documentStoragePath = (value: any) =>
    value?.pdfPath || value?.storagePath || value?.filePath || value?.path ||
    value?.file?.path || value?.file?.storagePath

const resolveDocumentUrl = async (document: ComplianceDoc) => {
    const value = document.url || document.storagePath
    if (!value) return null
    if (!String(value).startsWith('gs://') && document.url) return document.url
    try {
        return await getDownloadURL(storageRef(getStorage(), value))
    } catch (error) {
        console.warn('Unable to resolve compliance document path', value, error)
        return null
    }
}

type DeptGap = {
    key: string
    label: string
    needed: number
    completed: number
    inProgress: number
    missing: number
}

type CompletedInterventionExportRow = {
    Company: string
    Beneficiary: string
    Department: string
    Intervention: string
    Description: string
    Status: string
    ParticipantId: string
    ProgramId: string
    Gender: string
    Sector: string
    Age: string | number
    Youth: string
    CompletedAt: string
    DeliveryMethod: string
}

const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
]

const monthFromLabel = (label?: string) => (label || '').trim().split(' ')[0]

const buildUploadedByMonth = (rows: MonthlyPerfRow[]) => {
    const revenue = Array(12).fill(null) as (number | null)[]
    const perm = Array(12).fill(null) as (number | null)[]
    const temp = Array(12).fill(null) as (number | null)[]
    const traffic = Array(12).fill(null) as (number | null)[]
    const networking = Array(12).fill(null) as (number | null)[]

    rows.forEach(r => {
        const mName = monthFromLabel(r.month)
        const i = monthNames.findIndex(m => m === mName)
        if (i >= 0) {
            revenue[i] = r.revenue != null ? Number(r.revenue) : null
            perm[i] = r.headPermanent != null ? Number(r.headPermanent) : null
            temp[i] = r.headTemporary != null ? Number(r.headTemporary) : null
            traffic[i] = r.traffic != null ? Number(r.traffic) : null
            networking[i] = r.networking != null ? Number(r.networking) : null
        }
    })

    return { revenue, perm, temp, traffic, networking }
}

const normalizeRevenueMap = (m?: Record<string, any>) => {
    const result: (number | null)[] = Array(12).fill(null)
    if (!m) return result
    monthNames.forEach((name, i) => {
        const v = Number(m[name])
        result[i] = Number.isFinite(v) ? v : null
    })
    return result
}

const normalizeHeadcountMap = (m?: Record<string, { permanent?: any; temporary?: any }>) => {
    const perm: (number | null)[] = Array(12).fill(null)
    const temp: (number | null)[] = Array(12).fill(null)
    if (!m) return { perm, temp }
    monthNames.forEach((name, i) => {
        const row = m[name] || {}
        const p = Number(row.permanent)
        const t = Number(row.temporary)
        perm[i] = Number.isFinite(p) ? p : null
        temp[i] = Number.isFinite(t) ? t : null
    })
    return { perm, temp }
}

const normalize = (value: any) =>
    String(value ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

const isStrictlyCompleted = (item: any) => {
    return String(item?.status || '').toLowerCase().trim() === 'completed'
}

const getAssignedCompletedAt = (item: any) => {
    return (
        item?.completedAt ||
        item?.userConfirmedAt ||
        item?.assigneeCompletedAt ||
        item?.updatedAt ||
        null
    )
}

const getDeliveryMethodLabel = (mov: any) => {
    const parts: string[] = []

    if (mov?.methodInPerson) parts.push('In Person')
    if (mov?.methodOnline) parts.push('Online')
    if (mov?.methodTelephonic) parts.push('Telephonic')

    const other = String(mov?.methodOther || '').trim()
    if (other) parts.push(other)

    return parts.length ? parts.join(', ') : '—'
}

const titlesMatch = (a?: string, b?: string) => {
    const x = normalize(a)
    const y = normalize(b)
    if (!x || !y) return false
    return x === y
}

const departmentsMatch = (planned: any, assigned: any) => {
    const plannedDeptId = normalize(planned?.departmentId)
    const assignedDeptId = normalize(assigned?.departmentId)
    const plannedDeptName = normalize(planned?.departmentName)
    const assignedDeptName =
        normalize(assigned?.departmentName) || normalize(assigned?.areaOfSupport)

    if (plannedDeptId && assignedDeptId && plannedDeptId === assignedDeptId) return true
    if (plannedDeptName && assignedDeptName && plannedDeptName === assignedDeptName) return true
    return false
}

const mergePrefUploaded = (uploaded: (number | null)[], participant: (number | null)[]) =>
    monthNames.map((_, i) => (uploaded[i] != null ? uploaded[i] : participant[i] ?? null))

const monthKeyFromValue = (value: any): string | null => {
    if (!value) return null
    const direct = String(value).trim().match(/^(\d{4})-(\d{1,2})/)
    if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}`
    const date = toDateSafe(value)
    if (!date) return null
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const jobContractMonth = (contract: JobContract) =>
    monthKeyFromValue(contract.uploadMonthDate) ||
    monthKeyFromValue(contract.uploadMonth) ||
    monthKeyFromValue(contract.createdAt) ||
    monthKeyFromValue(contract.updatedAt)

const countActiveJobsForMonth = (contracts: JobContract[], monthKey: string) => {
    const active = new Map<string, JobContract>()

    contracts.forEach(contract => {
        const startKey = jobContractMonth(contract)
        if (!startKey || startKey > monthKey) return

        const end = toDateSafe(contract.contractEndDate)
        if (end && end < new Date(`${monthKey}-01T00:00:00`)) return

        const employeeKey = `${contract.applicationId || ''}::${String(contract.employeeName || '').trim().toLowerCase()}::${String(contract.position || '').trim().toLowerCase()}`
        const current = active.get(employeeKey)
        if (!current || String(jobContractMonth(current)) <= startKey) active.set(employeeKey, contract)
    })

    return active.size
}

const carryForwardMonthlyValues = (values: (number | null)[]) => {
    let latest: number | null = null

    return values.map(value => {
        if (value != null) latest = value
        return latest
    })
}

const isPlainObject = (v: any) => Object.prototype.toString.call(v) === '[object Object]'

const extractNearestHubFromProfile = (app: any): string => {
    const profile = app?.profile

    if (profile && isPlainObject(profile) && Object.prototype.hasOwnProperty.call(profile, 'nearest-hub')) {
        return String((profile as any)['nearest-hub'] ?? '').trim()
    }

    if (Array.isArray(profile)) {
        const hit = profile.find((x: any) => {
            const id = String(x?.id || x?.key || x?.questionId || x?.question || '')
                .toLowerCase()
                .trim()
            return id === 'nearest-hub'
        })
        if (hit) return String(hit.answer ?? hit.value ?? hit.response ?? '').trim()
    }

    return ''
}

const toDateSafe = (value: any): Date | null => {
    if (!value) return null

    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

    if (typeof value?.toDate === 'function') {
        const d = value.toDate()
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    }

    if (typeof value?.seconds === 'number') {
        return new Date(value.seconds * 1000)
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
    }

    return null
}

const formatDateTime = (value: any) => {
    const d = toDateSafe(value)
    if (!d) return '—'
    return new Intl.DateTimeFormat('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d)
}

const getOnboardedAt = (app: any) => {
    return app?.signedAgreements?.['pre-incubation-contract']?.acceptedAt || null
}

const getDisplayLocation = (row: Pick<SmeRow, 'town' | 'province' | 'location'>) => {
    const joined = [row.town, row.province].filter(Boolean).join(', ')
    return joined || row.location || '—'
}

const buildSafeFileName = (name: string) =>
    String(name || 'export')
        .replace(/[\\/:*?"<>|]+/g, '')
        .trim()
        .replace(/\s+/g, '_')

const chunkArray = <T,>(arr: T[], size: number) => {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size))
    }
    return chunks
}

const buildDetailsSheetRows = (rows: SmeRow[]) =>
    rows.map(row => ({
        Company: row.companyName || '—',
        Group: row.group || '—',
        'Recruited At': formatDateTime(row.recruitedAt),
        'Onboarded At': formatDateTime(row.onboardedAt),
        Sector: row.sector || '—',
        Gender: row.gender || '—',
        Hub: row.hub || '—',
        Location: getDisplayLocation(row),
        Email: row.email || '—',
        Phone: row.phone || '—',
        'Business Address': row.businessAddress || '—',
        'B-BBEE Level': row.beeLevel || '—',
        Branch: row.branchName || '—',
        'Black Owned %': row.ownership.blackOwnedPercent ?? '—',
        'Female Ownership %': row.ownership.femaleOwnedPercent ?? '—',
        'Youth Ownership %': row.ownership.youthOwnedPercent ?? '—',
        'Total Revenue': row.metrics.totalRevenue ?? 0,
        'Current Employees': row.metrics.currentEmployees ?? 0
    }))

const applySheetWidths = (worksheet: XLSX.WorkSheet, widths: number[]) => {
    worksheet['!cols'] = widths.map(wch => ({ wch }))
}

const addSheet = (workbook: XLSX.WorkBook, name: string, rows: any[], widths: number[]) => {
    const sheetRows = rows.length ? rows : [{ Info: 'No data available' }]
    const worksheet = XLSX.utils.json_to_sheet(sheetRows)
    applySheetWidths(worksheet, widths)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
}

const SMEOverview: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const navigate = useNavigate()
    const isQuantilytixViewer = isQuantilytixDomain(user?.email)
    const { token } = theme.useToken()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'sme-overview',
            pageTitle: 'SME Overview',
            guides: [
                {
                    id: 'sme-overview-quick-tour',
                    title: 'Quick tour',
                    description:
                        'Understand the SME summary, filters, SME list and selected SME workspace.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('sme-overview-metrics'),
                            popover: {
                                title: 'Portfolio summary',
                                description:
                                    'These metrics respond to the active filters and summarise SMEs in view, reported revenue, current employees and active interventions.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-overview-filters'),
                            popover: {
                                title: 'Filters and reporting period',
                                description:
                                    'Search and filter the SME portfolio, and choose the monthly reporting range used by performance and intervention trends.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-overview-list'),
                            popover: {
                                title: 'SME list',
                                description:
                                    'Select an SME here to load its details into the workspace on the right.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-detail-workspace'),
                            popover: {
                                title: 'Selected SME workspace',
                                description:
                                    'The selected SME remains in context while you move between Demographics, Performance, Interventions and Compliance.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-detail-tabs'),
                            popover: {
                                title: 'SME sections',
                                description:
                                    'Use these sections to review profile information, business performance, assigned interventions and compliance.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('sme-export-all'),
                            popover: {
                                title: 'Export SMEs',
                                description:
                                    'Export the currently filtered SMEs to Excel, including SME details and completed interventions.',
                                side: 'bottom',
                                align: 'end'
                            }
                        }
                    ]
                },
                {
                    id: 'sme-review-profile',
                    title: 'Review an SME',
                    description:
                        'Select an SME and review its profile and onboarding information.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: '[data-guide="sme-list-card"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'Select an SME',
                                description:
                                    'Choose an SME from the list to make it the active record.',
                                side: 'right',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('sme-demographics-tab'),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            popover: {
                                title: 'Demographics',
                                description:
                                    'Open the profile section for the selected SME.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('sme-demographics-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'SME profile',
                                description:
                                    'Review registration, sector, onboarding dates, contact information, branch and ownership information.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="sme-export-one"]',
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Export this SME',
                                description:
                                    'Download an Excel workbook for one SME when you only need that business and its completed interventions.',
                                side: 'left',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'sme-performance-guide',
                    title: 'Review performance',
                    description:
                        'Review revenue and employment performance for the selected SME.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: guideTarget('sme-performance-tab'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Performance',
                                description:
                                    'Open Performance to review reported revenue and employment activity.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('sme-performance-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Performance summary',
                                description:
                                    'Review cumulative reported revenue, latest headcount and the month-on-month business trend for the selected reporting period.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-performance-chart'),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Revenue and employment trend',
                                description:
                                    'Compare monthly revenue with reported employees and verified active jobs. The source tags show where each series comes from.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'sme-interventions-guide',
                    title: 'Review interventions',
                    description:
                        'Review intervention progress and department coverage for the selected SME.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: guideTarget('sme-interventions-tab'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Interventions',
                                description:
                                    'Open Interventions to see allocated work and delivery progress.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('sme-interventions-content'),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Intervention summary',
                                description:
                                    'See needed, completed, in-progress and not-started intervention counts for this SME.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-intervention-trends'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Intervention trends',
                                description:
                                    'Review assigned versus completed activity over time and the current assignment position by department.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('sme-interventions-table'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Assigned interventions',
                                description:
                                    'Filter by department and review titles, assignment dates, completion dates and current status.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'sme-compliance-guide',
                    title: 'Review compliance',
                    description:
                        'Review compliance status, signed agreements and supporting documents for the selected SME.',
                    kind: 'task',
                    order: 5,
                    steps: [
                        {
                            element: guideTarget('sme-compliance-tab'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Compliance',
                                description:
                                    'Open Compliance to review documents and signed agreements for the selected SME.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('sme-compliance-content'),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Compliance status',
                                description:
                                    'Review valid, expired and attention-required compliance records. An empty state is shown when nothing has been captured yet.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="sme-manage-compliance"]',
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Manage Compliance',
                                description:
                                    'Users with onboarding access can continue to the compliance workspace to manage the SME’s requirements.',
                                side: 'left',
                                align: 'center'
                            }
                        },
                        {
                            element: guideTarget('sme-compliance-documents'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Documents and agreements',
                                description:
                                    'Open available uploads or generated agreement viewers and review signing or expiry information for each record.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'sme-add-guide',
                    title: 'Add an SME',
                    description:
                        'Start a new SME record for the currently selected programme.',
                    kind: 'task',
                    order: 6,
                    steps: [
                        {
                            element: guideTarget('sme-add-action'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Add SME',
                                description:
                                    'When onboarding access is available and a specific programme is selected, use this action to start a new SME record.',
                                side: 'bottom',
                                align: 'end'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const screens = useBreakpoint()
    const isCompact = !screens.xl
    const isMobileLike = !screens.lg

    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState<SmeRow[]>([])
    const [activeInterventionsBySme, setActiveInterventionsBySme] = useState<Map<string, number>>(new Map())
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
    const [segment, setSegment] = useState<'demographics' | 'performance' | 'interventions' | 'compliance'>('demographics')

    const [perfDetail, setPerfDetail] = useState<SmePerformanceDetail | null>(null)
    const [financeRevenue, setFinanceRevenue] = useState<MonthlyFinancePoint[]>([])
    const [jobContracts, setJobContracts] = useState<JobContract[]>([])
    const [performanceTrendLoading, setPerformanceTrendLoading] = useState(false)
    const [reportingRange, setReportingRange] = useState<[Dayjs, Dayjs]>(() => [
        dayjs().subtract(11, 'month').startOf('month'),
        dayjs().endOf('month')
    ])
    const [interventions, setInterventions] = useState<Intervention[]>([])
    const [interventionsLoading, setInterventionsLoading] = useState(false)
    const [complianceStats, setComplianceStats] = useState<ComplianceStats | null>(null)
    const [complianceDocuments, setComplianceDocuments] = useState<ComplianceDoc[]>([])
    const [complianceLoading, setComplianceLoading] = useState(false)
    const [selectedApplicationData, setSelectedApplicationData] = useState<any>(null)
    const [selectedParticipantData, setSelectedParticipantData] = useState<any>(null)
    const [preIncViewer, setPreIncViewer] = useState<{ meta?: any } | null>(null)
    const [gapViewerOpen, setGapViewerOpen] = useState(false)
    const [gapViewerId, setGapViewerId] = useState<string | null>(null)
    const [agreementViewerLoading, setAgreementViewerLoading] = useState(false)
    const [moaViewer, setMoaViewer] = useState<MoaViewerState | null>(null)
    const [moaDownloading, setMoaDownloading] = useState(false)

    const [diagnosticConfirmed, setDiagnosticConfirmed] = useState<boolean | null>(null)
    const [selectedDeptKey, setSelectedDeptKey] = useState<string | null>(null)

    const [searchText, setSearchText] = useState('')
    const [genderFilter, setGenderFilter] = useState<string | undefined>()
    const [hubFilter, setHubFilter] = useState<string | undefined>()
    const [groupFilter, setGroupFilter] = useState<string | undefined>()
    const [listPage, setListPage] = useState(1)
    const [showHubFilter, setShowHubFilter] = useState(false)
    const [hasOnboardingAccess, setHasOnboardingAccess] = useState(false)

    const [dummySmeModalVisible, setDummySmeModalVisible] = useState(false)
    const [creatingDummySme, setCreatingDummySme] = useState(false)
    const [dummySmeQuantity, setDummySmeQuantity] = useState(1)
    const [deletingDummySmeId, setDeletingDummySmeId] = useState<string | null>(null)
    const [dummySmeForm] = Form.useForm()

    const selectedRow = useMemo(() => rows.find(r => r.appId === selectedAppId) || null, [rows, selectedAppId])

    useEffect(() => {
        let cancelled = false

        const resolveOnboardingPermission = async () => {
            const departmentId = String(user?.departmentId || user?.department?.id || '').trim()
            const departmentName = normalize(user?.departmentName || user?.department?.name)

            try {
                let departmentData: any = null

                if (departmentId) {
                    const departmentSnap = await getDoc(doc(db, 'departments', departmentId))
                    if (departmentSnap.exists()) departmentData = departmentSnap.data()
                }

                if (!departmentData && departmentName) {
                    const departmentsSnap = await getDocs(collection(db, 'departments'))
                    const match = departmentsSnap.docs.find(department => {
                        const data = department.data() as any
                        return normalize(data.name || data.departmentName) === departmentName
                    })
                    departmentData = match?.data() || null
                }

                if (!cancelled) setHasOnboardingAccess(departmentData?.isOnboarding === true)
            } catch (error) {
                console.error('Unable to resolve onboarding department permission.', error)
                if (!cancelled) setHasOnboardingAccess(false)
            }
        }

        resolveOnboardingPermission()
        return () => { cancelled = true }
    }, [user?.departmentId, user?.departmentName, user?.department?.id, user?.department?.name])

    useEffect(() => {
        const run = async () => {
            const uBranch = String((user as any)?.assignedBranch || '').trim()

            if (!activeProgramId) {
                setShowHubFilter(false)
                return
            }

            try {
                const snap = await getDoc(doc(db, 'programs', activeProgramId))
                if (!snap.exists()) {
                    setShowHubFilter(false)
                    return
                }

                const prog = snap.data() as any
                const isMulti = !!prog.isMultiBranch
                const programAssignedBranchId = String(prog?.assignedBranch?.id || '').trim()
                const programAssignedToMyBranch =
                    !!uBranch && !!programAssignedBranchId && uBranch === programAssignedBranchId

                const shouldShow = isMulti && programAssignedToMyBranch

                setShowHubFilter(shouldShow)

                if (!shouldShow) {
                    setHubFilter(undefined)
                }
            } catch (err) {
                console.error(err)
                setShowHubFilter(false)
            }
        }

        run()
    }, [activeProgramId, user?.uid])

    const loadSMEs = useCallback(async () => {
        if (!activeProgramId && !isAllPrograms) return
        setLoading(true)

        try {
            const [appsResult, assignedResult] = await Promise.allSettled([
                getDocs(collection(db, 'applications')),
                getDocs(query(
                    collection(db, 'assignedInterventions'),
                    ...(activeProgramId ? [where('programId', '==', activeProgramId)] : [])
                ))
            ])

            if (appsResult.status === 'rejected') throw appsResult.reason
            const appsSnap = appsResult.value

            const activeBySme = new Map<string, number>()
            if (assignedResult.status === 'fulfilled') {
                assignedResult.value.forEach(snapshot => {
                    const intervention = snapshot.data() as any
                    const status = String(intervention.assignmentStatus || '').toLowerCase().trim()
                    if (['completed', 'cancelled', 'canceled'].includes(status)) return
                    const key = String(intervention.participantId || intervention.applicationId || '').trim()
                    if (key) activeBySme.set(key, (activeBySme.get(key) || 0) + 1)
                })
            } else {
                console.warn('Unable to load active SME interventions.', assignedResult.reason)
            }
            setActiveInterventionsBySme(activeBySme)

            const applications = appsSnap.docs
                .map(d => {
                    const data = d.data() as any
                    const normalizedProgramId = String(
                        data.programId || data.programID || data.program?.id || data.program || ''
                    ).trim()

                    return {
                        id: d.id,
                        ...data,
                        programId: normalizedProgramId || undefined
                    } as Application
                })
                .filter(app => {
                    const statuses = [
                        app.applicationStatus,
                        (app as any).status,
                        (app as any).decision?.status
                    ].map(normalize)

                    return statuses.includes('accepted') || !!app.acceptedAt
                })
                .filter(app => !activeProgramId || app.programId === activeProgramId)
                .filter(app => (isQuantilytixDomain(app.email) ? isQuantilytixViewer : true))

            const programIds = Array.from(
                new Set(
                    applications
                        .map(app => String(app.programId || '').trim())
                        .filter(Boolean)
                )
            )

            const programMap = new Map<string, ProgramDoc>()
            const branchMap = new Map<string, string>()

            for (const idsChunk of chunkArray(programIds, 10)) {
                const programSnap = await getDocs(
                    query(collection(db, 'programs'), where(documentId(), 'in', idsChunk))
                )

                programSnap.forEach(d => {
                    programMap.set(d.id, {
                        id: d.id,
                        ...(d.data() as any)
                    })
                })
            }

            const branchesSnap = await getDocs(
                query(collection(db, 'branches'))
            )

            branchesSnap.forEach(d => {
                const data = d.data() as any
                const name = String(data.name || data.branchName || data.title || '').trim()
                if (name) branchMap.set(d.id, name)
            })

            const smeRows: SmeRow[] = await Promise.all(
                applications.map(async app => {
                    const participantId = app.participantId || null
                    let participant: Participant | null = null
                    let perfHistory: MonthlyPerfRow[] = []

                    if (participantId) {
                        const pDoc = await getDoc(doc(db, 'participants', participantId))
                        if (pDoc.exists()) {
                            participant = { id: pDoc.id, ...(pDoc.data() as any) }
                        }

                        const histSnap = await getDocs(
                            query(collection(db, `monthlyPerformance/${participantId}/history`), orderBy('createdAt', 'desc'))
                        )
                        perfHistory = histSnap.docs.map(h => h.data() as any)
                    }

                    const uploaded = buildUploadedByMonth(perfHistory)
                    const pRevArr = normalizeRevenueMap(participant?.revenueHistory?.monthly)
                    const pHC = normalizeHeadcountMap(participant?.headcountHistory?.monthly)

                    const mergedRev = mergePrefUploaded(uploaded.revenue, pRevArr)
                    const mergedPerm = mergePrefUploaded(uploaded.perm, pHC.perm)
                    const mergedTemp = mergePrefUploaded(uploaded.temp, pHC.temp)

                    const totalRevenue = mergedRev.reduce((acc, v) => acc + (v || 0), 0)

                    let currentEmployees = 0
                    for (let i = mergedPerm.length - 1; i >= 0; i--) {
                        if (mergedPerm[i] != null || mergedTemp[i] != null) {
                            currentEmployees = (mergedPerm[i] || 0) + (mergedTemp[i] || 0)
                            break
                        }
                    }

                    const ownership: OwnershipSummary = {
                        blackOwnedPercent: participant?.blackOwnedPercent ?? (app as any).blackOwnedPercent ?? undefined,
                        femaleOwnedPercent: participant?.femaleOwnedPercent ?? (app as any).femaleOwnedPercent ?? undefined,
                        youthOwnedPercent: participant?.youthOwnedPercent ?? (app as any).youthOwnedPercent ?? undefined
                    }

                    const companyName =
                        app.companyName ||
                        (app as any).registeredName ||
                        app.businessName ||
                        app.beneficiaryName ||
                        'Unknown SME'

                    const businessAddress =
                        participant?.businessAddress ||
                        app.businessAddress ||
                        (app as any).tradingAddress ||
                        (app as any).physicalAddress ||
                        (app as any).addressLine1

                    const beeLevel =
                        participant?.beeLevel ||
                        app.beeLevel ||
                        (app as any).beeLevel ||
                        (app as any).bbbEeLevel

                    const derivedHub = String(app.hub || '').trim() || extractNearestHubFromProfile(app) || ''
                    const program = app.programId ? programMap.get(app.programId) : undefined
                    const programIsMultiBranch = !!program?.isMultiBranch
                    const resolvedBranchName = programIsMultiBranch
                        ? derivedHub || '—'
                        : String(program?.assignedBranch?.name || '').trim() || '—'
                    const resolvedBranchId = programIsMultiBranch
                        ? String(app.branchId || participant?.branchId || '').trim()
                        : String(program?.assignedBranch?.id || program?.branchId || app.branchId || participant?.branchId || '').trim()
                    const branchNameFromBranch = resolvedBranchId ? branchMap.get(resolvedBranchId) : ''
                    const displayBranchName =
                        branchNameFromBranch ||
                        String(app.branchName || participant?.branchName || '').trim() ||
                        resolvedBranchName

                    return {
                        appId: app.id,
                        participantId,
                        programId: app.programId,
                        smmeNo: String(app.smmeNo || '').trim() || undefined,
                        registrationNumber: String(participant?.registrationNumber || '').trim() || undefined,
                        idNumber: String(participant?.idNumber || participant?.nationalId || app.idNumber || '').trim() || undefined,
                        companyName,
                        sector: participant?.sector || (app as any).sector,
                        gender: participant?.gender || (app as any).gender,
                        town: participant?.town || (app as any).town || (app as any).city,
                        province: participant?.province || (app as any).province || (app as any).region,
                        location:
                            participant?.location ||
                            app.location ||
                            (app as any).location ||
                            (app as any).addressLine1,
                        email: app.email || participant?.email,
                        phone: participant?.phone || (app as any).phone || '—',
                        businessAddress,
                        beeLevel,
                        branchId: resolvedBranchId || undefined,
                        branchName: displayBranchName,
                        hub: derivedHub || undefined,
                        group: String(app.gapGroup || '').trim() || undefined,
                        recruitedAt: app.acceptedAt || app.updatedAt || null,
                        onboardedAt: getOnboardedAt(app),
                        manuallyCreated: (app as any).manuallyCreated === true,
                        gapCompleted: hasSmeGapSubmission({
                            application: app,
                            participant,
                            agreement: (app as any).signedAgreements?.['gap-analysis']
                        }),
                        ownership,
                        metrics: {
                            totalRevenue,
                            currentEmployees
                        }
                    }
                })
            )

            setRows(smeRows)
            if (smeRows.length) {
                setSelectedAppId(current => current && smeRows.some(row => row.appId === current)
                    ? current
                    : smeRows[0].appId)
            } else {
                setSelectedAppId(null)
            }
        } catch (err) {
            console.error(err)
            message.error('Failed to load SME overview.')
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, isAllPrograms, isQuantilytixViewer])

    useEffect(() => {
        loadSMEs()
    }, [loadSMEs])

    const generateRandomSaSme = useCallback(() => {
        const firstName = faker.person.firstName()
        const lastName = faker.person.lastName()
        const contactPerson = `${firstName} ${lastName}`
        const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '')
        const email = `${slug}+dummy${Date.now().toString(36)}${faker.number.int({ min: 100, max: 999 })}@quantilytix.co.za`
        const businessName = `${faker.company.name()} ${faker.helpers.arrayElement(['(Pty) Ltd', 'CC', 'Enterprises', 'Trading'])}`
        const phone = `0${faker.number.int({ min: 60, max: 84 })}${faker.string.numeric(7)}`
        const province = faker.helpers.arrayElement(SA_PROVINCES)
        const town = faker.location.city()
        const sector = faker.helpers.arrayElement(SA_SECTORS)
        const gender = faker.helpers.arrayElement(['Male', 'Female'])

        return { contactPerson, email, businessName, phone, province, town, sector, gender }
    }, [])

    const resolveActiveProgramMeta = useCallback(async () => {
        if (!activeProgramId) throw new Error('Select a specific program before adding a dummy SME.')

        const programSnap = await getDoc(doc(db, 'programs', activeProgramId))
        if (!programSnap.exists()) throw new Error('Selected program could not be found.')

        const programData = programSnap.data() as any

        return {
            programId: activeProgramId,
            programName: programData.name || programData.programName || null,
            branchId: programData.assignedBranch?.id || programData.branchId || null,
            branchName: programData.assignedBranch?.name || programData.branchName || null
        }
    }, [activeProgramId])

    const createDummySmeRecord = useCallback(
        async (
            details: {
                contactPerson: string
                email: string
                businessName: string
                phone?: string
                province?: string
                town?: string
                sector?: string
                gender?: string
            },
            programMeta: Awaited<ReturnType<typeof resolveActiveProgramMeta>>
        ) => {
            // Give the dummy SME a real login so it can be used to walk the diagnostic
            // plan/roadmap confirmation flow from the incubatee side, same as a real applicant.
            let authUid: string | null = null
            try {
                const idToken = await auth.currentUser?.getIdToken()
                if (idToken) {
                    const resp = await fetch(CREATE_USER_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            email: details.email,
                            role: 'incubatee',
                            name: details.contactPerson,
                            phone: details.phone || null,
                            mustRegister: true,
                            allowExisting: true,
                            sendEmail: true,
                            sendResetLink: true
                        })
                    })

                    const data = await resp.json().catch(() => null)
                    authUid = data?.uid || data?.user?.uid || null

                    if (!resp.ok || !authUid) {
                        console.warn('createPlatformUser did not return a uid for dummy SME:', data)
                    }
                }
            } catch (err) {
                console.warn('createPlatformUser failed for dummy SME (continuing without login):', err)
            }

            const participantRef = await addDoc(collection(db, 'participants'), {
                participantName: details.contactPerson,
                email: details.email,
                beneficiaryName: details.contactPerson,
                gender: details.gender || null,
                phone: details.phone || null,
                sector: details.sector || null,
                province: details.province || null,
                town: details.town || null,
                city: details.town || null,
                businessAddress: [details.town, details.province].filter(Boolean).join(', ') || null,
                programId: programMeta.programId,
                programName: programMeta.programName,
                branchId: programMeta.branchId,
                branchName: programMeta.branchName,
                uid: authUid,
                setup: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })

            await addDoc(collection(db, 'applications'), {
                participantId: participantRef.id,
                programId: programMeta.programId,
                programName: programMeta.programName,
                branchId: programMeta.branchId,
                branchName: programMeta.branchName,
                applicationStatus: 'accepted',
                beneficiaryName: details.contactPerson,
                companyName: details.businessName,
                businessName: details.businessName,
                gender: details.gender || null,
                province: details.province || null,
                town: details.town || null,
                email: details.email,
                uid: authUid,
                acceptedAt: serverTimestamp(),
                submittedAt: new Date().toISOString(),
                manuallyCreated: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })

            return { authUid }
        },
        []
    )

    const handleGenerateRandomFill = () => {
        dummySmeForm.setFieldsValue(generateRandomSaSme())
    }

    const handleCreateDummySme = async () => {
        if (!activeProgramId || isAllPrograms) {
            message.error('Select a specific program before adding a dummy SME.')
            return
        }

        setCreatingDummySme(true)

        try {
            const programMeta = await resolveActiveProgramMeta()

            if (dummySmeQuantity > 1) {
                let loginFailures = 0
                for (let i = 0; i < dummySmeQuantity; i++) {
                    const result = await createDummySmeRecord(generateRandomSaSme(), programMeta)
                    if (!result.authUid) loginFailures += 1
                }
                message.success(`Created ${dummySmeQuantity} random dummy SMEs.`)
                if (loginFailures) {
                    message.warning(`${loginFailures} of them could not get a login account — check manually.`)
                }
            } else {
                const values = await dummySmeForm.validateFields()
                const result = await createDummySmeRecord(values, programMeta)
                message.success('Dummy SME created successfully.')
                if (!result.authUid) {
                    message.warning('The SME record was created, but its login account could not be set up — check manually.')
                }
            }

            dummySmeForm.resetFields()
            setDummySmeModalVisible(false)
            setDummySmeQuantity(1)
            await loadSMEs()
        } catch (error: any) {
            if (error?.errorFields) return
            console.error(error)
            message.error(error?.message || 'Failed to create dummy SME.')
        } finally {
            setCreatingDummySme(false)
        }
    }

    const handleDeleteDummySme = async (row: SmeRow) => {
        setDeletingDummySmeId(row.appId)

        try {
            let authUid: string | null = null
            if (row.participantId) {
                const participantSnap = await getDoc(doc(db, 'participants', row.participantId))
                authUid = participantSnap.exists() ? (participantSnap.data() as any)?.uid || null : null
            }

            if (authUid && row.email) {
                try {
                    const deleteUserCascade = httpsCallable(functions, 'deleteUserCascade')
                    await deleteUserCascade({ email: row.email, uid: authUid, confirm: true })
                } catch (err) {
                    console.warn('deleteUserCascade failed for dummy SME (continuing with doc cleanup):', err)
                }
            }

            const batch = writeBatch(db)
            batch.delete(doc(db, 'applications', row.appId))
            if (row.participantId) batch.delete(doc(db, 'participants', row.participantId))

            if (row.participantId) {
                const interventionsSnap = await getDocs(
                    query(collection(db, 'assignedInterventions'), where('participantId', '==', row.participantId))
                )
                interventionsSnap.forEach(interventionDoc => batch.delete(interventionDoc.ref))

                const dpSnap = await getDocs(
                    query(collection(db, 'diagnosticPlans'), where('participantId', '==', row.participantId))
                )
                dpSnap.forEach(dpDoc => batch.delete(dpDoc.ref))
            }

            await batch.commit()
            message.success('Dummy SME deleted.')
            await loadSMEs()
        } catch (error) {
            console.error(error)
            message.error('Failed to delete dummy SME.')
        } finally {
            setDeletingDummySmeId(null)
        }
    }

    const genderOptions = useMemo(() => {
        const set = new Set<string>()
        rows.forEach(r => {
            if (r.gender) set.add(r.gender)
        })
        return Array.from(set).map(g => ({ label: g, value: g }))
    }, [rows])

    const hubOptions = useMemo(() => {
        const set = new Set<string>()
        rows.forEach(r => {
            const hub = String(r.hub || '').trim()
            if (hub) set.add(hub)
        })
        return Array.from(set)
            .sort((a, b) => a.localeCompare(b))
            .map(value => ({ value, label: value }))
    }, [rows])

    const groupOptions = useMemo(() => {
        const set = new Set<string>()
        rows.forEach(r => {
            const group = String(r.group || '').trim()
            if (group) set.add(group)
        })
        return Array.from(set)
            .sort((a, b) => a.localeCompare(b))
            .map(value => ({ value, label: value }))
    }, [rows])

    const filteredRows = useMemo(() => {
        return rows.filter(r => {
            if (searchText && !r.companyName.toLowerCase().includes(searchText.toLowerCase())) return false
            if (genderFilter && (r.gender || '').toLowerCase() !== genderFilter.toLowerCase()) return false
            if (groupFilter && (r.group || '').toLowerCase() !== groupFilter.toLowerCase()) return false

            if (showHubFilter && hubFilter) {
                const rowHub = String(r.hub || '').trim()
                if (!rowHub || rowHub !== hubFilter) return false
            }

            return true
        })
    }, [rows, searchText, genderFilter, groupFilter, showHubFilter, hubFilter])

    const overviewMetrics = useMemo(() => filteredRows.reduce(
        (totals, row) => ({
            smes: totals.smes + 1,
            revenue: totals.revenue + (row.metrics.totalRevenue || 0),
            employees: totals.employees + (row.metrics.currentEmployees || 0),
            activeInterventions: totals.activeInterventions + (
                activeInterventionsBySme.get(String(row.participantId || row.appId)) || 0
            )
        }),
        { smes: 0, revenue: 0, employees: 0, activeInterventions: 0 }
    ), [activeInterventionsBySme, filteredRows])

    const smeListPageSize = 5
    const pagedSmes = useMemo(() => {
        const start = (listPage - 1) * smeListPageSize
        return filteredRows.slice(start, start + smeListPageSize)
    }, [filteredRows, listPage])

    useEffect(() => {
        const lastPage = Math.max(1, Math.ceil(filteredRows.length / smeListPageSize))
        if (listPage > lastPage) setListPage(lastPage)
    }, [filteredRows.length, listPage])

    useEffect(() => {
        setListPage(1)
    }, [searchText, genderFilter, groupFilter, hubFilter])

    useEffect(() => {
        if (!filteredRows.length) return
        if (!selectedAppId || !filteredRows.some(r => r.appId === selectedAppId)) {
            setSelectedAppId(filteredRows[0].appId)
        }
    }, [filteredRows, selectedAppId])

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.participantId) {
                setPerfDetail(null)
                return
            }
            try {
                const pDoc = await getDoc(doc(db, 'participants', selectedRow.participantId))
                if (!pDoc.exists()) {
                    setPerfDetail(null)
                    return
                }
                const participant = pDoc.data() as Participant

                const histSnap = await getDocs(
                    query(collection(db, `monthlyPerformance/${selectedRow.participantId}/history`), orderBy('createdAt', 'desc'))
                )
                const perfHistory = histSnap.docs.map(h => h.data() as any)

                const uploaded = buildUploadedByMonth(perfHistory)
                const pRevArr = normalizeRevenueMap(participant.revenueHistory?.monthly)
                const pHC = normalizeHeadcountMap(participant.headcountHistory?.monthly)

                setPerfDetail({
                    mergedRevenue: mergePrefUploaded(uploaded.revenue, pRevArr),
                    mergedPerm: mergePrefUploaded(uploaded.perm, pHC.perm),
                    mergedTemp: mergePrefUploaded(uploaded.temp, pHC.temp),
                    mergedTraffic: uploaded.traffic,
                    mergedNetworking: uploaded.networking
                })
            } catch (err) {
                console.error(err)
            }
        }
        run()
    }, [selectedRow?.participantId])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            if (!selectedRow) {
                setFinanceRevenue([])
                setJobContracts([])
                return
            }

            setPerformanceTrendLoading(true)
            const financeMonths = Math.max(1, dayjs().endOf('month').diff(reportingRange[0], 'month') + 1)
            const revenueRequest = selectedRow.email
                ? fetch(`${FINANCE_API_BASE_URL}/api/stats/public/revenue-monthly?${new URLSearchParams({
                    email: selectedRow.email,
                    months: String(financeMonths)
                })}`).then(async response => {
                    if (!response.ok) throw new Error(`Finance API returned ${response.status}`)
                    const payload = await response.json()
                    const rows = Array.isArray(payload?.months) ? payload.months : Array.isArray(payload) ? payload : []
                    return rows.map((row: any) => ({
                        month: String(row.month || ''),
                        monthLabel: row.monthLabel || row.month_label || row.month || '',
                        revenue: Number(row.revenue || 0)
                    })) as MonthlyFinancePoint[]
                })
                : Promise.resolve([] as MonthlyFinancePoint[])

            const jobsRequest = getDocs(
                query(collection(db, 'hseJobContracts'), where('applicationId', '==', selectedRow.appId))
            ).then(snapshot => snapshot.docs.map(item => ({ id: item.id, ...(item.data() as any) })) as JobContract[])

            const [revenueResult, jobsResult] = await Promise.allSettled([revenueRequest, jobsRequest])
            if (cancelled) return

            setFinanceRevenue(revenueResult.status === 'fulfilled' ? revenueResult.value : [])
            setJobContracts(jobsResult.status === 'fulfilled' ? jobsResult.value : [])

            setPerformanceTrendLoading(false)
        }

        run()
        return () => { cancelled = true }
    }, [reportingRange, selectedRow?.appId, selectedRow?.email])

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.participantId) {
                setInterventions([])
                setDiagnosticConfirmed(null)
                setInterventionsLoading(false)
                return
            }
            setInterventionsLoading(true)
            try {
                const [dpSnap, snap] = await Promise.all([
                    getDoc(doc(db, 'diagnosticPlans', selectedRow.participantId)).catch(error => {
                        console.warn('Diagnostic plan status was unavailable; assignments will still be shown.', error)
                        return null
                    }),
                    getDocs(query(
                        collection(db, 'assignedInterventions'),
                        where('participantId', '==', selectedRow.participantId)
                    ))
                ])

                setDiagnosticConfirmed(!!dpSnap?.exists() && dpSnap.data()?.finalConfirmation === true)
                const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Intervention[]
                setInterventions(list)
            } catch (err) {
                console.error(err)
                message.error('Failed to load interventions.')
            } finally {
                setInterventionsLoading(false)
            }
        }
        run()
    }, [selectedRow?.participantId])

    useEffect(() => {
        const run = async () => {
            if (!selectedRow?.appId) {
                setComplianceStats(null)
                setComplianceDocuments([])
                setSelectedApplicationData(null)
                setSelectedParticipantData(null)
                return
            }
            setComplianceLoading(true)
            setSelectedApplicationData(null)
            setSelectedParticipantData(null)
            try {
                const [appSnap, participantSnap, upSnap, agSnap] = await Promise.all([
                    getDoc(doc(db, 'applications', selectedRow.appId)),
                    getDoc(doc(db, 'participants', selectedRow.participantId || '__missing__')),
                    getDocs(collection(db, 'applications', selectedRow.appId, 'complianceDocuments')),
                    getDocs(collection(db, 'applications', selectedRow.appId, 'agreements'))
                ])

                const byKey = new Map<string, ComplianceDoc>()
                const addDocument = (document: ComplianceDoc) => {
                    const key = canonicalComplianceId(document.title || document.id)
                    const existing = byKey.get(key)
                    if (!existing) {
                        byKey.set(key, document)
                        return
                    }
                    byKey.set(key, {
                        ...existing,
                        ...document,
                        kind: existing.kind === 'agreement' || document.kind === 'agreement'
                            ? 'agreement'
                            : 'upload',
                        status: existing.status === 'valid' || document.status === 'valid'
                            ? 'valid'
                            : document.status || existing.status,
                        url: document.url || existing.url,
                        storagePath: document.storagePath || existing.storagePath,
                        title: document.title || existing.title,
                        signed: document.signed || existing.signed,
                        acceptedAt: document.acceptedAt || existing.acceptedAt,
                        meta: document.meta || existing.meta
                    })
                }

                upSnap.forEach(s => {
                    const v = s.data() as any
                    addDocument({
                        id: s.id,
                        status: String(v.status || 'pending').toLowerCase(),
                        kind: 'upload',
                        title: v.title || v.documentName || v.name || v.type || s.id,
                        url: directDocumentUrl(v),
                        storagePath: documentStoragePath(v),
                        expiryDate: v.expiryDate,
                        meta: v
                    })
                })

                agSnap.forEach(s => {
                    const v = s.data() as any
                    const signed = v.signed === true || v.smmeSigned === true ||
                        v.participantSigned === true || !!v.participantSignatureURL || !!v.acceptedAt
                    addDocument({
                        id: s.id,
                        status: signed ? 'valid' : 'pending',
                        kind: 'agreement',
                        title: v.title || v.type || s.id,
                        url: directDocumentUrl(v),
                        storagePath: documentStoragePath(v),
                        signed,
                        acceptedAt: v.acceptedAt || v.signedAt,
                        meta: v
                    })
                })

                const application = appSnap.exists() ? appSnap.data() as any : {}
                const participant = participantSnap.exists() ? participantSnap.data() as any : {}
                setSelectedApplicationData(application)
                setSelectedParticipantData(participant)
                    ;[
                        ...(Array.isArray(application.complianceDocuments) ? application.complianceDocuments : []),
                        ...(Array.isArray(participant.complianceDocuments) ? participant.complianceDocuments : [])
                    ]
                        .forEach((v: any, index: number) => addDocument({
                            id: v.key || v.id || v.type || `upload-${index}`,
                            status: String(v.status || 'pending').toLowerCase(),
                            kind: 'upload',
                            title: v.title || v.documentName || v.name || v.type || `Document ${index + 1}`,
                            url: directDocumentUrl(v),
                            storagePath: documentStoragePath(v),
                            expiryDate: v.expiryDate,
                            meta: v
                        }))
                const signedAgreements = {
                    ...(participant.signedAgreements || {}),
                    ...(application.signedAgreements || {})
                }
                Object.entries(signedAgreements).forEach(([id, raw]: [string, any]) => {
                    const signed = raw === true || raw?.signed === true ||
                        raw?.participantSigned === true || !!raw?.participantSignatureURL ||
                        !!raw?.userSignatureURL || !!raw?.signer || !!raw?.acceptedAt
                    addDocument({
                        id,
                        status: signed ? 'valid' : 'pending',
                        kind: 'agreement',
                        title: raw?.title || raw?.type || id,
                        url: directDocumentUrl(raw),
                        storagePath: documentStoragePath(raw),
                        signed,
                        acceptedAt: raw?.acceptedAt || raw?.signedAt,
                        meta: raw
                    })
                })
                    ;[
                        ...(Array.isArray(application.unsignedAgreements) ? application.unsignedAgreements : []),
                        ...(Array.isArray(participant.unsignedAgreements) ? participant.unsignedAgreements : [])
                    ].forEach((raw: any, index: number) => addDocument({
                        id: raw.key || raw.id || raw.type || `agreement-${index}`,
                        status: 'pending',
                        kind: 'agreement',
                        title: raw.title || raw.type || raw.key || `Agreement ${index + 1}`,
                        url: directDocumentUrl(raw),
                        storagePath: documentStoragePath(raw),
                        signed: false,
                        meta: raw
                    }))

                const docs = Array.from(byKey.values()).sort((a, b) =>
                    a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)
                ).map(document => ({
                    ...document,
                    status: document.signed ? 'valid' : document.status,
                    title: standardComplianceName(document.id, document.title)
                }))
                setComplianceDocuments(docs)

                let valid = 0
                let expired = 0
                let pending = 0
                let invalid = 0
                let queried = 0

                docs.forEach(d => {
                    const s = d.status
                    if (s === 'valid') valid++
                    else if (s === 'expired') expired++
                    else if (s === 'pending') pending++
                    else if (s === 'invalid') invalid++
                    else if (s === 'queried') queried++
                })

                setComplianceStats({
                    total: docs.length,
                    valid,
                    expired,
                    pending,
                    invalid,
                    queried
                })
            } catch (err) {
                console.error(err)
                setComplianceDocuments([])
                message.error('Failed to load compliance data.')
            } finally {
                setComplianceLoading(false)
            }
        }
        run()
    }, [selectedRow?.appId])

    const getCompletedInterventionsForSme = useCallback(
        async (row: SmeRow): Promise<CompletedInterventionExportRow[]> => {
            if (!row.participantId) return []

            const [summary, assignedSnap] = await Promise.all([
                getSMEInterventionSummary({
                    participantId: row.participantId,
                    programId: row.programId
                }),
                getDocs(
                    query(
                        collection(db, 'assignedInterventions'),
                        where('participantId', '==', row.participantId)
                    )
                )
            ])

            const plannedInterventions = summary.departments.flatMap(dept => dept.interventions)

            const assignedRows = assignedSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            }))

            const completedAssigned = assignedRows.filter(isStrictlyCompleted)

            return plannedInterventions.flatMap(planned => {
                const match = completedAssigned.find(assigned => {
                    return (
                        titlesMatch(
                            planned.interventionTitle,
                            assigned.interventionTitle || assigned.title || assigned.name
                        ) &&
                        departmentsMatch(planned, assigned)
                    )
                })

                if (!match) return []

                return [
                    {
                        Beneficiary: planned.beneficiaryName || row.companyName || '—',
                        Department: planned.departmentName || match.departmentName || match.areaOfSupport || '—',
                        Intervention: planned.interventionTitle || match.interventionTitle || '—',
                        CompletedAt: formatDateTime(getAssignedCompletedAt(match)),
                        DeliveryMethod:
                            match.deliveryMethod ||
                            (Array.isArray(match.deliveryMethods) ? match.deliveryMethods.join(', ') : '') ||
                            match.method ||
                            '—'
                    }
                ]
            })
        },
        []
    )

    const handleExportSingle = useCallback(
        async (row: SmeRow) => {
            try {
                const workbook = XLSX.utils.book_new()

                addSheet(
                    workbook,
                    'SME Details',
                    buildDetailsSheetRows([row]),
                    [28, 14, 22, 22, 20, 14, 18, 28, 28, 18, 32, 16, 24, 16, 18, 18, 16, 18, 16, 18]
                )

                const completedRows = await getCompletedInterventionsForSme(row)

                addSheet(
                    workbook,
                    'Completed Interventions',
                    completedRows,
                    [28, 28, 24, 34, 40, 18, 22, 24, 20]
                )

                XLSX.writeFile(workbook, `${buildSafeFileName(`${row.companyName || 'SME'}_details`)}.xlsx`)
            } catch (err) {
                console.error(err)
                message.error('Failed to export SME workbook.')
            }
        },
        [getCompletedInterventionsForSme]
    )

    const handleExportAll = useCallback(async () => {
        try {
            if (!filteredRows.length) {
                message.warning('No SMEs available to export.')
                return
            }

            const workbook = XLSX.utils.book_new()

            addSheet(
                workbook,
                'SME Details',
                buildDetailsSheetRows(filteredRows),
                [18, 28, 14, 22, 22, 20, 14, 18, 28, 28, 18, 32, 16, 24, 16, 18, 18, 16])

            const completedNested = await Promise.all(
                filteredRows.map(row => getCompletedInterventionsForSme(row))
            )

            const allCompletedRows = completedNested.flat()

            addSheet(
                workbook,
                'Completed Interventions',
                allCompletedRows,
                [28, 28, 24, 34, 40, 18, 22, 24, 20]
            )

            XLSX.writeFile(workbook, `${buildSafeFileName('SME_overview_export')}.xlsx`)
        } catch (err) {
            console.error(err)
            message.error('Failed to export SME overview workbook.')
        }
    }, [filteredRows, getCompletedInterventionsForSme])

    const columns = useMemo(() => {
        const base: any[] = [
            {
                title: 'Company',
                dataIndex: 'companyName',
                key: 'companyName',
                render: (text: string, record: SmeRow) => (
                    <Space size={6} wrap>
                        <Text strong ellipsis={{ tooltip: text }} style={{ maxWidth: 220 }}>
                            {text}
                        </Text>
                        {!record.gapCompleted && (
                            <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                                Awaiting GAP
                            </Tag>
                        )}
                    </Space>
                )
            }
        ]

        // if (!isMobileLike) {
        //     base.push({
        //         title: 'Group',
        //         dataIndex: 'group',
        //         key: 'group',
        //         render: (value: string | undefined) =>
        //             value ? <Tag color='purple'>{value}</Tag> : <span style={{ color: '#999' }}>—</span>
        //     })

        //     base.push({
        //         title: 'Sector',
        //         dataIndex: 'sector',
        //         key: 'sector',
        //         ellipsis: true
        //     })

        //     base.push({
        //         title: 'Location',
        //         key: 'location',
        //         render: (_: any, r: SmeRow) => <span>{getDisplayLocation(r)}</span>
        //     })

        //     base.push({
        //         title: 'Gender',
        //         dataIndex: 'gender',
        //         key: 'gender',
        //         render: (g: string | undefined) =>
        //             g ? <Tag>{g}</Tag> : <span style={{ color: '#999' }}>—</span>
        //     })
        // }

        // if (!isMobileLike && showHubFilter) {
        //     base.push({
        //         title: 'Hub',
        //         dataIndex: 'hub',
        //         key: 'hub',
        //         render: (h: string | undefined) =>
        //             h ? <Tag color='blue'>{h}</Tag> : <span style={{ color: '#999' }}>—</span>
        //     })
        // }

        base.push({
            title: 'Branch',
            dataIndex: 'branchName',
            key: 'branchName',
            width: 180,
            ellipsis: true,
            render: (value: string | undefined) => value || <span style={{ color: '#999' }}>â€”</span>
        })

        base.push({
            title: 'Action',
            key: 'action',
            width: 120,
            render: (_: any, record: SmeRow) => (
                <Button
                    size='small'
                    icon={<DownloadOutlined />}
                    onClick={e => {
                        e.stopPropagation()
                        handleExportSingle(record)
                    }}
                >
                    Export
                </Button>
            )
        })

        return base
    }, [isMobileLike, showHubFilter, handleExportSingle])

    const interventionsSummary = useMemo(() => {
        let total = interventions.length
        let completed = 0
        let inProgress = 0
        let missing = 0

        interventions.forEach(i => {
            const s = String(i.status || '').toLowerCase()
            if (s === 'completed') completed++
            else if (s === 'in-progress' || s === 'ongoing') inProgress++
            else missing++
        })

        return { total, completed, inProgress, missing }
    }, [interventions])

    const deptGaps: DeptGap[] = useMemo(() => {
        const map = new Map<string, DeptGap>()

        interventions.forEach(i => {
            const key = i.departmentId || i.areaOfSupport || 'other'
            const label = i.departmentName || i.areaOfSupport || 'Other'

            if (!map.has(key)) {
                map.set(key, { key, label, needed: 0, completed: 0, inProgress: 0, missing: 0 })
            }

            const entry = map.get(key)!
            entry.needed += 1

            const s = String(i.status || '').toLowerCase()
            if (s === 'completed') entry.completed += 1
            else if (s === 'in-progress' || s === 'ongoing') entry.inProgress += 1
            else entry.missing += 1
        })

        return Array.from(map.values())
    }, [interventions])

    useEffect(() => {
        if (!deptGaps.length) {
            setSelectedDeptKey(null)
            return
        }
        if (selectedDeptKey && !deptGaps.some(d => d.key === selectedDeptKey)) {
            setSelectedDeptKey(null)
        }
    }, [deptGaps, selectedDeptKey])

    const performanceTrend = useMemo(() => {
        const startMonth = reportingRange[0].startOf('month')
        const monthCount = Math.max(1, reportingRange[1].endOf('month').diff(startMonth, 'month') + 1)
        const months = Array.from({ length: monthCount }, (_, index) => {
            const month = startMonth.add(index, 'month')
            const date = month.toDate()
            return {
                key: month.format('YYYY-MM'),
                monthIndex: date.getMonth(),
                label: new Intl.DateTimeFormat('en-ZA', { month: 'short', year: '2-digit' }).format(date)
            }
        })

        const financeByMonth = new Map<string, number>()
        financeRevenue.forEach(row => {
            const rawMonth = `${row.month || ''} ${row.monthLabel || ''}`.trim()
            const parsedKey = monthKeyFromValue(row.month) || monthKeyFromValue(row.monthLabel)
            const monthName = rawMonth.toLowerCase().split(/\s+/)[0]
            const monthIndex = monthNames.findIndex(name => name.toLowerCase() === monthName)
            const inferredKey = monthIndex >= 0 ? months.find(month => month.monthIndex === monthIndex)?.key : null
            const key = /\b\d{4}\b/.test(rawMonth) ? parsedKey : inferredKey || parsedKey
            if (key) financeByMonth.set(key, Number(row.revenue || 0))
        })

        const fallbackKeyByMonthIndex = new Map<number, string>()
        months.forEach(month => fallbackKeyByMonthIndex.set(month.monthIndex, month.key))
        const hasFinanceFeed = financeByMonth.size > 0
        const revenue = months.map(month => hasFinanceFeed
            ? financeByMonth.get(month.key) ?? null
            : fallbackKeyByMonthIndex.get(month.monthIndex) === month.key
                ? perfDetail?.mergedRevenue[month.monthIndex] ?? null
                : null)
        const hasVerifiedJobs = jobContracts.length > 0
        const carriedPermanent = carryForwardMonthlyValues(perfDetail?.mergedPerm || Array(12).fill(null))
        const carriedTemporary = carryForwardMonthlyValues(perfDetail?.mergedTemp || Array(12).fill(null))
        const reportedEmployees = months.map(month => {
            if (fallbackKeyByMonthIndex.get(month.monthIndex) !== month.key) return null
            const permanent = carriedPermanent[month.monthIndex]
            const temporary = carriedTemporary[month.monthIndex]
            return permanent == null && temporary == null ? null : (permanent || 0) + (temporary || 0)
        })
        const verifiedJobs = months.map(month => hasVerifiedJobs
            ? countActiveJobsForMonth(jobContracts, month.key)
            : null)
        const hasReportedEmployees = reportedEmployees.some(value => value != null)
        const hasData = revenue.some(value => value != null) || hasReportedEmployees || hasVerifiedJobs

        const employmentSeries: Highcharts.SeriesOptionsType[] = [
            ...(hasReportedEmployees ? [{
                type: 'column' as const,
                name: 'Reported employees',
                data: reportedEmployees,
                color: '#16a34a',
                yAxis: 1
            }] : []),
            ...(hasVerifiedJobs ? [{
                type: 'column' as const,
                name: 'Verified active jobs',
                data: verifiedJobs,
                color: '#7c3aed',
                yAxis: 1
            }] : [])
        ]

        const options: Highcharts.Options = {
            chart: { height: 360, backgroundColor: 'transparent', spacing: [32, 8, 8, 8] },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { align: 'center', verticalAlign: 'bottom' },
            xAxis: { categories: months.map(month => month.label), crosshair: true },
            yAxis: [
                { title: { text: 'Revenue (ZAR)' }, labels: { format: 'R {value:,.0f}' }, min: 0 },
                { title: { text: 'Employment' }, labels: { format: '{value:.0f}' }, opposite: true, allowDecimals: false, min: 0 }
            ],
            tooltip: {
                shared: true,
                formatter: function () {
                    const points = this.points || []
                    const lines = points.map(point => point.series.name === 'Revenue'
                        ? `<span style="color:${point.color}">●</span> Revenue: <b>${new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(point.y || 0))}</b>`
                        : `<span style="color:${point.color}">●</span> ${point.series.name}: <b>${point.y || 0}</b>`)
                    return `<b>${this.x}</b><br/>${lines.join('<br/>')}`
                }
            },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        allowOverlap: true,
                        crop: false,
                        defer: false,
                        overflow: 'allow',
                        backgroundColor: 'rgba(255,255,255,.88)',
                        borderRadius: 3,
                        padding: 3,
                        formatter: function () {
                            const value = Number(this.y || 0)
                            return this.series.name === 'Revenue'
                                ? `R ${Highcharts.numberFormat(value, 0)}`
                                : Highcharts.numberFormat(value, 0)
                        },
                        style: { color: '#111827', fontSize: '11px', fontWeight: '600', textOutline: 'none' }
                    }
                },
                column: { borderRadius: 4, maxPointWidth: 42 },
                spline: { marker: { enabled: true, radius: 4 }, lineWidth: 3 }
            },
            series: [
                {
                    type: 'spline',
                    name: 'Revenue',
                    data: revenue,
                    color: '#1677ff',
                    yAxis: 0
                },
                ...employmentSeries
            ]
        }

        return {
            options,
            hasData,
            revenueSource: hasFinanceFeed ? 'Finance workspace' : 'Monthly performance reports',
            employmentSource: hasVerifiedJobs && hasReportedEmployees
                ? 'Carried-forward headcount + HSE contracts'
                : hasVerifiedJobs ? 'HSE job contracts' : 'Carried-forward reported headcount'
        }
    }, [financeRevenue, jobContracts, perfDetail, reportingRange])

    const interventionChartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'column', height: 340, backgroundColor: 'transparent' },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: { categories: deptGaps.map(department => department.label), crosshair: true },
        yAxis: { min: 0, allowDecimals: false, title: { text: 'Assigned interventions' } },
        tooltip: { shared: true },
        plotOptions: {
            column: {
                stacking: 'normal',
                borderRadius: 3,
                dataLabels: {
                    enabled: true,
                    allowOverlap: true,
                    format: '{y:,.0f}',
                    crop: false,
                    defer: false,
                    overflow: 'allow',
                    backgroundColor: 'rgba(255,255,255,.88)',
                    borderRadius: 3,
                    padding: 3,
                    style: { fontWeight: '600', textOutline: '2px contrast' }
                }
            }
        },
        series: [
            { type: 'column', name: 'Completed', data: deptGaps.map(department => department.completed), color: '#52c41a' },
            { type: 'column', name: 'In progress', data: deptGaps.map(department => department.inProgress), color: '#1677ff' },
            { type: 'column', name: 'Not started', data: deptGaps.map(department => department.missing), color: '#faad14' }
        ]
    }), [deptGaps])

    const interventionMonthlyTrend = useMemo(() => {
        const startMonth = reportingRange[0].startOf('month')
        const monthCount = Math.max(1, reportingRange[1].endOf('month').diff(startMonth, 'month') + 1)
        const months = Array.from({ length: monthCount }, (_, index) => {
            const month = startMonth.add(index, 'month')
            return {
                key: month.format('YYYY-MM'),
                label: month.format('MMM YY'),
                assigned: 0,
                completed: 0
            }
        })
        const byMonth = new Map(months.map(month => [month.key, month]))

        interventions.forEach(intervention => {
            const assignedKey = monthKeyFromValue(
                intervention.assignedAt || intervention.createdAt || intervention.updatedAt
            )
            if (assignedKey && byMonth.has(assignedKey)) byMonth.get(assignedKey)!.assigned += 1

            if (isStrictlyCompleted(intervention)) {
                const completedKey = monthKeyFromValue(getAssignedCompletedAt(intervention))
                if (completedKey && byMonth.has(completedKey)) byMonth.get(completedKey)!.completed += 1
            }
        })

        const hasData = months.some(month => month.assigned > 0 || month.completed > 0)
        const options: Highcharts.Options = {
            chart: { height: 340, backgroundColor: 'transparent', spacingTop: 32 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: months.map(month => month.label), crosshair: true },
            yAxis: { min: 0, allowDecimals: false, title: { text: 'Interventions' } },
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    dataLabels: {
                        enabled: true,
                        allowOverlap: true,
                        crop: false,
                        defer: false,
                        overflow: 'allow',
                        backgroundColor: 'rgba(255,255,255,.88)',
                        borderRadius: 3,
                        padding: 3,
                        formatter: function () {
                            return Highcharts.numberFormat(Number(this.y || 0), 0)
                        },
                        style: { color: '#111827', fontSize: '11px', fontWeight: '600', textOutline: 'none' }
                    }
                },
                column: {
                    borderRadius: 4,
                    maxPointWidth: 42
                },
                spline: {
                    lineWidth: 3,
                    marker: { enabled: true, radius: 4 }
                }
            },
            series: [
                { type: 'column', name: 'Assigned', data: months.map(month => month.assigned), color: '#1677ff' },
                { type: 'spline', name: 'Completed', data: months.map(month => month.completed), color: '#52c41a' }
            ]
        }

        return { hasData, options }
    }, [interventions, reportingRange])

    const renderDemographics = () => {
        if (!selectedRow) return <Empty description='Select an SME' />

        const percentage = (value?: number) => value != null ? `${value}%` : '—'

        const isDummyRow = isQuantilytixDomain(selectedRow.email)

        return (
            <MotionCard
                title='Demographics'
                extra={
                    <Space>
                        <Tag icon={<UserOutlined />}>SME Profile</Tag>
                        {isDummyRow && <Tag color='purple'>Internal / Dummy</Tag>}
                        {isQuantilytixViewer && isDummyRow && (
                            <Popconfirm
                                title='Delete this dummy SME?'
                                description='This permanently removes the participant, application, and any linked interventions.'
                                okText='Delete'
                                okButtonProps={{ danger: true }}
                                onConfirm={() => handleDeleteDummySme(selectedRow)}
                            >
                                <Button
                                    danger
                                    size='small'
                                    icon={<DeleteOutlined />}
                                    loading={deletingDummySmeId === selectedRow.appId}
                                >
                                    Delete Dummy SME
                                </Button>
                            </Popconfirm>
                        )}
                    </Space>
                }
            >
                <Descriptions bordered column={{ xs: 1, sm: 1, md: 2 }} size='small' labelStyle={{ fontWeight: 600 }}>
                    <Descriptions.Item label='Company'>{selectedRow.companyName}</Descriptions.Item>
                    <Descriptions.Item label='SME Number'>{selectedRow.smmeNo || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Registration Number'>{selectedRow.registrationNumber || '—'}</Descriptions.Item>
                    <Descriptions.Item label='ID Number'>{selectedRow.idNumber || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Sector'>{selectedRow.sector || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Group'>{selectedRow.group || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Recruited'>{formatDateTime(selectedRow.recruitedAt)}</Descriptions.Item>
                    <Descriptions.Item label='Onboarded'>{formatDateTime(selectedRow.onboardedAt)}</Descriptions.Item>
                    <Descriptions.Item label='Gender'>{selectedRow.gender || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Hub'>{selectedRow.hub || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Location'>{getDisplayLocation(selectedRow)}</Descriptions.Item>
                    <Descriptions.Item label='Email'>{selectedRow.email || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Business Address'>{selectedRow.businessAddress || '—'}</Descriptions.Item>
                    <Descriptions.Item label='B-BBEE Level'>{selectedRow.beeLevel || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Branch'>{selectedRow.branchName || '—'}</Descriptions.Item>
                    <Descriptions.Item label='Black Ownership'>{percentage(selectedRow.ownership.blackOwnedPercent)}</Descriptions.Item>
                    <Descriptions.Item label='Women Ownership'>{percentage(selectedRow.ownership.femaleOwnedPercent)}</Descriptions.Item>
                    <Descriptions.Item label='Youth Ownership'>{percentage(selectedRow.ownership.youthOwnedPercent)}</Descriptions.Item>
                </Descriptions>
            </MotionCard>
        )
    }

    const renderPerformance = () => {
        if (!selectedRow) return <Empty description='Select an SME to view performance' />

        return (
            <Space direction='vertical' style={{ width: '100%' }} size='large'>
                <Row gutter={16}>
                    <Col xs={24} sm={12}>
                        <MotionCard.Metric
                            title='Total revenue'
                            value={new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(selectedRow.metrics.totalRevenue)}
                            subtitle='Across all reported months'
                            icon={<DollarCircleOutlined style={{ color: '#16a34a' }} />}
                            iconBg='rgba(22,163,74,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12}>
                        <MotionCard.Metric
                            title='Current employees'
                            value={selectedRow.metrics.currentEmployees}
                            subtitle='Latest reported headcount'
                            icon={<TeamOutlined style={{ color: '#7c3aed' }} />}
                            iconBg='rgba(124,58,237,.12)'
                        />
                    </Col>
                </Row>
                <div data-guide='sme-performance-chart'>
                    <MotionCard
                        title='Revenue and employment month-on-month'
                        extra={<Space wrap>
                            <Tag color='blue'>Revenue: {performanceTrend.revenueSource}</Tag>
                            <Tag color='green'>Employment: {performanceTrend.employmentSource}</Tag>
                        </Space>}
                    >
                        {performanceTrendLoading
                            ? <Skeleton active paragraph={{ rows: 8 }} />
                            : performanceTrend.hasData
                                ? <HighchartsReact highcharts={Highcharts} options={performanceTrend.options} />
                                : <Empty description='No monthly revenue or employment data has been captured for this period.' />}
                    </MotionCard>
                </div>
            </Space>
        )
    }

    const renderInterventions = () => {
        if (!selectedRow) return <Empty description='Select an SME to view interventions' />

        if (interventionsLoading) return <Skeleton active paragraph={{ rows: 8 }} />

        if (!interventions.length) return <Empty description='No interventions allocated yet for this SME.' />

        const selectedDeptLabel = deptGaps.find(d => d.key === selectedDeptKey)?.label || 'All departments'

        const deptInterventions = interventions.filter(i => {
            const key = i.departmentId || i.areaOfSupport || 'other'
            return !selectedDeptKey || key === selectedDeptKey
        })

        return (
            <Space direction='vertical' style={{ width: '100%' }} size='middle'>
                <Row gutter={16}>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Needed'
                            value={interventionsSummary.total}
                            subtitle='Allocated interventions'
                            icon={<UnorderedListOutlined style={{ color: '#1677ff' }} />}
                            iconBg='rgba(22,119,255,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Completed'
                            value={interventionsSummary.completed}
                            subtitle='Work completed'
                            icon={<CheckCircleOutlined style={{ color: '#16a34a' }} />}
                            iconBg='rgba(22,163,74,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='In progress'
                            value={interventionsSummary.inProgress}
                            subtitle='Currently underway'
                            icon={<ClockCircleOutlined style={{ color: '#7c3aed' }} />}
                            iconBg='rgba(124,58,237,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Not started'
                            value={interventionsSummary.missing}
                            subtitle='Still outstanding'
                            icon={<ExclamationCircleOutlined style={{ color: '#d97706' }} />}
                            iconBg='rgba(217,119,6,.12)'
                        />
                    </Col>
                </Row>

                <Row
                    data-guide='sme-intervention-trends'
                    gutter={[16, 16]}
                    align='stretch'
                >
                    <Col xs={24} lg={12}>
                        <MotionCard title='Intervention performance month-on-month' style={{ height: '100%' }}>
                            {interventionMonthlyTrend.hasData
                                ? <HighchartsReact highcharts={Highcharts} options={interventionMonthlyTrend.options} />
                                : <Empty description='No dated intervention activity was recorded for this period.' />}
                        </MotionCard>
                    </Col>
                    <Col xs={24} lg={12}>
                        <MotionCard
                            title='Current assignments by department'
                            style={{ height: '100%' }}
                            extra={diagnosticConfirmed === false ? <Tag color='gold'>DP not finalised</Tag> : <Tag color='green'>DP finalised</Tag>}
                        >
                            <HighchartsReact highcharts={Highcharts} options={interventionChartOptions} />
                        </MotionCard>
                    </Col>
                </Row>

                <Card
                    data-guide='sme-interventions-table'
                    size='small'
                    bordered={false}
                    title={`Interventions – ${selectedDeptLabel}`}
                    extra={<Select
                        allowClear
                        placeholder='All departments'
                        style={{ minWidth: 190 }}
                        value={selectedDeptKey || undefined}
                        onChange={value => setSelectedDeptKey(value || null)}
                        options={deptGaps.map(department => ({ value: department.key, label: department.label }))}
                    />}
                >
                    <Table
                        size='small'
                        rowKey='id'
                        pagination={{ pageSize: 5 }}
                        dataSource={deptInterventions}
                        columns={[
                            {
                                title: 'Title',
                                dataIndex: 'interventionTitle',
                                key: 'interventionTitle',
                                width: 280,
                                ellipsis: true,
                                render: (title: string) => (
                                    <Text ellipsis={{ tooltip: title }} style={{ maxWidth: 260 }}>
                                        {title || 'â€”'}
                                    </Text>
                                )
                            },
                            {
                                title: 'Department',
                                key: 'department',
                                render: (_: any, r: Intervention) => r.departmentName || r.areaOfSupport || '—'
                            },
                            {
                                title: 'Assigned',
                                key: 'assignedAt',
                                render: (_: any, r: Intervention) => formatDateTime(r.assignedAt || r.createdAt || r.updatedAt)
                            },
                            {
                                title: 'Completed',
                                key: 'completedAt',
                                render: (_: any, r: Intervention) => isStrictlyCompleted(r)
                                    ? formatDateTime(getAssignedCompletedAt(r))
                                    : '—'
                            },
                            {
                                title: 'Status',
                                dataIndex: 'status',
                                key: 'status',
                                render: (s: string) => {
                                    const val = String(s || '').toLowerCase()
                                    let color: any = 'default'
                                    if (val === 'completed') color = 'green'
                                    else if (val === 'in-progress' || val === 'ongoing') color = 'blue'
                                    else color = 'orange'
                                    return <Tag color={color}>{s || 'missing'}</Tag>
                                }
                            }
                        ]}
                        scroll={{ x: 900 }}
                    />
                </Card>
            </Space>
        )
    }

    const openGeneratedAgreement = async (record: ComplianceDoc) => {
        if (!selectedRow || selectedApplicationData?.manuallyCreated === true || !record.signed) return false

        const agreementId = canonicalComplianceId(`${record.id} ${record.title}`)
        if (!['pre-incubation-contract', 'moa', 'gap-analysis'].includes(agreementId)) return false

        if (agreementId === 'pre-incubation-contract') {
            setPreIncViewer({
                meta: selectedApplicationData?.signedAgreements?.['pre-incubation-contract'] || record.meta || record
            })
            return true
        }

        setAgreementViewerLoading(true)
        try {
            if (agreementId === 'gap-analysis') {
                const embedded = selectedApplicationData?.signedAgreements?.['gap-analysis'] || record.meta || {}
                const embeddedGapId = String(
                    embedded?.gapId || embedded?.gapAnalysisId || selectedApplicationData?.gapAnalysisId || ''
                ).trim()

                if (embeddedGapId) {
                    setGapViewerId(embeddedGapId)
                } else if (selectedRow.participantId) {
                    const gapSnap = await getDocs(query(
                        collection(db, 'gapAnalysis'),
                        where('participantId', '==', selectedRow.participantId)
                    ))
                    setGapViewerId(gapSnap.empty ? null : gapSnap.docs[0].id)
                } else {
                    setGapViewerId(null)
                }
                setGapViewerOpen(true)
                return true
            }

            const programId = String(selectedApplicationData?.programId || selectedRow.programId || '').trim()
            const programSnap = programId ? await getDoc(doc(db, 'programs', programId)) : null
            const program = programSnap?.exists() ? programSnap.data() as any : {}
            const start = toDateSafe(program?.startDate)
            const end = toDateSafe(program?.endDate)

            const vars: MoaVars = {
                beneficiaryName:
                    selectedApplicationData?.beneficiaryName ||
                    selectedApplicationData?.companyName ||
                    selectedRow.companyName ||
                    '________',
                registrationNumber:
                    selectedParticipantData?.registrationNumber ||
                    selectedApplicationData?.registrationNumber ||
                    selectedRow.registrationNumber ||
                    '________',
                participantName:
                    selectedParticipantData?.participantName ||
                    selectedParticipantData?.fullName ||
                    selectedApplicationData?.participantName ||
                    selectedApplicationData?.applicantName ||
                    selectedApplicationData?.contactPerson ||
                    '________',
                idNumber:
                    selectedParticipantData?.idNumber ||
                    selectedParticipantData?.nationalId ||
                    selectedApplicationData?.idNumber ||
                    '________',
                businessAddress:
                    selectedParticipantData?.businessAddress ||
                    selectedApplicationData?.businessAddress ||
                    selectedApplicationData?.registeredAddress ||
                    selectedRow.businessAddress ||
                    '________',
                contactNumber:
                    selectedParticipantData?.contactNumber ||
                    selectedParticipantData?.phone ||
                    selectedApplicationData?.contactNumber ||
                    selectedApplicationData?.phone ||
                    selectedRow.phone ||
                    '________',
                email:
                    selectedParticipantData?.email ||
                    selectedApplicationData?.email ||
                    selectedRow.email ||
                    '________',
                effectiveDate: start ? dayjs(start).format('DD MMMM YYYY') : '________',
                graduationDate: end ? dayjs(end).format('DD MMMM YYYY') : '________'
            }

            setMoaViewer({
                vars,
                meta: selectedApplicationData?.signedAgreements?.moa || record.meta || record
            })
            return true
        } catch (error) {
            console.error('Failed to open generated agreement.', error)
            message.error('The agreement viewer could not be opened.')
            return true
        } finally {
            setAgreementViewerLoading(false)
        }
    }

    const downloadViewedMoa = async () => {
        if (!moaViewer) return
        setMoaDownloading(true)
        try {
            const meta = moaViewer.meta || {}
            const acceptedAt = toDateSafe(meta.acceptedAt || meta.signedAt)
            const romSignedAt = toDateSafe(meta.romSignedAt || meta.operationsSignedAt)
            await saveMoaDocx(
                moaViewer.vars,
                `MOA_${moaViewer.vars.beneficiaryName.replace(/[^a-z0-9]+/gi, '_')}.docx`,
                {
                    centerTitle: 'INCUBATION MEMORANDUM OF AGREEMENT',
                    formNo: 'LEP QMS 074.1 F',
                    revisionNo: '0',
                    effectiveDate: moaViewer.vars.effectiveDate
                },
                {
                    incubatee: {
                        name: meta.signerName || moaViewer.vars.participantName,
                        positionOrTitle: meta.signerTitle || 'Director',
                        place: meta.place || 'Rustenburg',
                        day: acceptedAt ? dayjs(acceptedAt).format('DD') : '',
                        month: acceptedAt ? dayjs(acceptedAt).format('MMMM') : '',
                        year: acceptedAt ? dayjs(acceptedAt).format('YYYY') : '',
                        signatureUrl:
                            moaParticipantSignature(meta)
                    },
                    incubator: {
                        name: meta.romSignerName || meta.romName || '',
                        positionOrTitle: meta.romSignerTitle || meta.romPosition || 'Centre Coordinator',
                        place: meta.romPlace || 'Rustenburg',
                        day: romSignedAt ? dayjs(romSignedAt).format('DD') : '',
                        month: romSignedAt ? dayjs(romSignedAt).format('MMMM') : '',
                        year: romSignedAt ? dayjs(romSignedAt).format('YYYY') : '',
                        signatureUrl: moaRomSignature(meta)
                    }
                }
            )
            message.success('MOA downloaded successfully.')
        } catch (error) {
            console.error('Failed to download MOA.', error)
            message.error('The MOA could not be downloaded.')
        } finally {
            setMoaDownloading(false)
        }
    }

    const renderCompliance = () => {
        if (!selectedRow) return <Empty description='Select an SME to view compliance' />
        if (complianceLoading) return <Skeleton active paragraph={{ rows: 8 }} />

        if (!complianceStats || complianceStats.total === 0) {
            return <Space direction='vertical' style={{ width: '100%' }}>
                <Alert type='warning' showIcon message='No compliance documents found for this SME yet.' />
                {hasOnboardingAccess && <Button
                    data-guide='sme-manage-compliance'
                    type='primary'
                    size='middle'
                    shape='round'
                    onClick={() => navigate('/compliance')}
                >Manage Compliance</Button>}
            </Space>
        }

        const s = complianceStats

        return (
            <Space direction='vertical' style={{ width: '100%' }} size='large'>
                <Row gutter={16}>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Documents'
                            value={s.total}
                            subtitle='Compliance records'
                            icon={<FileProtectOutlined style={{ color: '#1677ff' }} />}
                            iconBg='rgba(22,119,255,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Valid'
                            value={s.valid}
                            subtitle='Current or signed'
                            icon={<CheckCircleOutlined style={{ color: '#16a34a' }} />}
                            iconBg='rgba(22,163,74,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Expired'
                            value={s.expired}
                            subtitle='Requires renewal'
                            icon={<ClockCircleOutlined style={{ color: '#dc2626' }} />}
                            iconBg='rgba(220,38,38,.12)'
                        />
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                        <MotionCard.Metric
                            title='Needs attention'
                            value={s.invalid + s.queried}
                            subtitle='Queried or invalid'
                            icon={<WarningOutlined style={{ color: '#d97706' }} />}
                            iconBg='rgba(217,119,6,.12)'
                        />
                    </Col>
                </Row>
                <div data-guide='sme-compliance-documents'>
                    <MotionCard
                        title='Compliance documents and agreements'
                        extra={<Space>
                            <Tag>{complianceDocuments.length} records</Tag>
                            {hasOnboardingAccess && <Button
                                data-guide='sme-manage-compliance'
                                size='middle'
                                shape='round'
                                type='primary'
                                onClick={() => navigate('/compliance')}
                            >Manage Compliance</Button>}
                        </Space>}
                    >
                        <Descriptions bordered column={1} size='small'>
                            {complianceDocuments.map(record => {
                                const hasFile = Boolean(record.url || record.storagePath)
                                const agreementId = canonicalComplianceId(`${record.id} ${record.title}`)
                                const hasGeneratedViewer =
                                    selectedApplicationData?.manuallyCreated !== true &&
                                    record.signed === true &&
                                    ['pre-incubation-contract', 'moa', 'gap-analysis'].includes(agreementId)
                                const status = record.signed
                                    ? 'Signed'
                                    : record.status.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
                                const date = record.acceptedAt
                                    ? `Signed ${formatDateTime(record.acceptedAt)}`
                                    : record.expiryDate
                                        ? `Expires ${formatDateTime(record.expiryDate)}`
                                        : 'No date recorded'

                                return <Descriptions.Item
                                    key={canonicalComplianceId(record.title || record.id)}
                                    label={<Space><FileTextOutlined /><Text strong>{record.title}</Text></Space>}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                        <Space wrap>
                                            <Tag color={record.kind === 'agreement' ? 'blue' : 'default'}>
                                                {record.kind === 'agreement' ? 'Agreement' : 'Compliance Document'}
                                            </Tag>
                                            <Tag color={
                                                record.status === 'valid' ? 'green' :
                                                    record.status === 'expired' ? 'red' :
                                                        record.status === 'queried' || record.status === 'invalid' ? 'orange' : 'gold'
                                            }>{status}</Tag>
                                            <Text type='secondary'>{date}</Text>
                                        </Space>
                                        {hasFile || hasGeneratedViewer ? <Button
                                            size='middle'
                                            shape='round'
                                            loading={agreementViewerLoading && hasGeneratedViewer}
                                            onClick={async () => {
                                                if (hasGeneratedViewer && await openGeneratedAgreement(record)) return
                                                const url = await resolveDocumentUrl(record)
                                                if (!url) {
                                                    message.warning('The document file could not be opened.')
                                                    return
                                                }
                                                window.open(url, '_blank', 'noopener,noreferrer')
                                            }}
                                        >View</Button> : <Text type='secondary'>No file uploaded</Text>}
                                    </div>
                                </Descriptions.Item>
                            })}
                        </Descriptions>
                    </MotionCard>
                </div>
            </Space>
        )
    }

    return (
        <div
            style={{
                padding: screens.xs ? 12 : screens.sm ? 16 : 20,
                minHeight: '100vh'
            }}
        >
            <Helmet>
                <title>SME Overview | Smart Incubation</title>
            </Helmet>

            <Row
                data-guide='sme-overview-metrics'
                gutter={[16, 16]}
                style={{ marginBottom: 16 }}
            >
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        title='SMEs in view'
                        value={overviewMetrics.smes}
                        subtitle='Matches the active filters'
                        icon={<TeamOutlined style={{ color: '#1677ff' }} />}
                        iconBg='rgba(22,119,255,.12)'
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        title='Total revenue'
                        value={new Intl.NumberFormat('en-ZA', {
                            style: 'currency', currency: 'ZAR', maximumFractionDigits: 0
                        }).format(overviewMetrics.revenue)}
                        subtitle='Cumulative reported revenue'
                        icon={<DollarCircleOutlined style={{ color: '#16a34a' }} />}
                        iconBg='rgba(22,163,74,.12)'
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        title='Current employees'
                        value={overviewMetrics.employees}
                        subtitle='Latest reported headcount'
                        icon={<UserOutlined style={{ color: '#7c3aed' }} />}
                        iconBg='rgba(124,58,237,.12)'
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        title='Active interventions'
                        value={overviewMetrics.activeInterventions}
                        subtitle='Across SMEs in view'
                        icon={<UsergroupAddOutlined style={{ color: '#db2777' }} />}
                        iconBg='rgba(219,39,119,.12)'
                    />
                </Col>
            </Row>

            <MotionCard
                style={{ width: '100%', marginBottom: 15 }}
                filterBar={
                    <Row
                        data-guide='sme-overview-filters'
                        gutter={[10, 10]}
                        align='middle'
                        style={{ width: '100%' }}
                    >
                        {/* Filters */}
                        <Col xs={24} xl={17}>
                            <Row gutter={[8, 8]} align='middle'>
                                <Col
                                    xs={24}
                                    sm={12}
                                    lg={showHubFilter && hubOptions.length > 0 ? 6 : 7}
                                >
                                    <Search
                                        allowClear
                                        placeholder='Search company'
                                        onChange={e => setSearchText(e.target.value)}
                                        style={{ width: '100%' }}
                                    />
                                </Col>

                                <Col
                                    xs={12}
                                    sm={6}
                                    lg={showHubFilter && hubOptions.length > 0 ? 3 : 4}
                                >
                                    <Select
                                        allowClear
                                        placeholder='Gender'
                                        style={{ width: '100%' }}
                                        value={genderFilter}
                                        onChange={setGenderFilter}
                                        options={genderOptions}
                                    />
                                </Col>

                                <Col
                                    xs={12}
                                    sm={6}
                                    lg={showHubFilter && hubOptions.length > 0 ? 3 : 4}
                                >
                                    <Select
                                        allowClear
                                        placeholder='Group'
                                        style={{ width: '100%' }}
                                        value={groupFilter}
                                        onChange={setGroupFilter}
                                        options={groupOptions}
                                    />
                                </Col>

                                {showHubFilter && hubOptions.length > 0 && (
                                    <Col xs={12} sm={6} lg={3}>
                                        <Select
                                            allowClear
                                            placeholder='Hub'
                                            style={{ width: '100%' }}
                                            value={hubFilter}
                                            onChange={setHubFilter}
                                            options={hubOptions}
                                        />
                                    </Col>
                                )}

                                <Col xs={24} sm={12} lg={9}>
                                    <RangePicker
                                        picker='month'
                                        allowClear={false}
                                        value={reportingRange}
                                        placeholder={['From', 'To']}
                                        disabledDate={current =>
                                            current && current.isAfter(dayjs().endOf('month'))
                                        }
                                        onChange={dates => {
                                            if (dates?.[0] && dates?.[1]) {
                                                setReportingRange([
                                                    dates[0].startOf('month'),
                                                    dates[1].endOf('month')
                                                ])
                                            }
                                        }}
                                        style={{ width: '100%' }}
                                    />
                                </Col>
                            </Row>
                        </Col>

                        {/* Actions */}
                        <Col xs={24} xl={7}>
                            <Space
                                size={6}
                                wrap={false}
                                style={{
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    width: '100%',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {hasOnboardingAccess && (
                                    <Button
                                        data-guide='sme-add-action'
                                        type='primary'
                                        shape='round'
                                        icon={<PlusOutlined />}
                                        disabled={!activeProgramId || isAllPrograms}
                                        onClick={() =>
                                            navigate(
                                                `/operations/participants/new/${activeProgramId}`
                                            )
                                        }
                                    >
                                        Add SME
                                    </Button>
                                )}

                                {isQuantilytixViewer && (
                                    <Button
                                        shape='round'
                                        icon={<EyeInvisibleOutlined />}
                                        disabled={!activeProgramId || isAllPrograms}
                                        onClick={() => setDummySmeModalVisible(true)}
                                    >
                                        Dummy
                                    </Button>
                                )}

                                <Button
                                    data-guide='sme-export-all'
                                    shape='round'
                                    icon={<DownloadOutlined />}
                                    onClick={handleExportAll}
                                >
                                    Export SMEs
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                }
            />

            {loading ? (
                <div style={{ paddingTop: 80, textAlign: 'center' }}>
                    <LoadingOverlay tip='Getting SMEs data' />
                </div>
            ) : !filteredRows.length ? (
                <Empty description='No accepted SMEs found for this program with current filters.' />
            ) : (
                <Row gutter={[16, 16]}>
                    <Col xs={24} xl={7}>
                        <div data-guide='sme-overview-list'>
                            <MotionCard
                                title='SME List'
                                variant='borderless'
                            >
                                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                    {pagedSmes.map(record => {
                                        const selected = record.appId === selectedAppId
                                        return <Card
                                            data-guide='sme-list-card'
                                            key={record.appId}
                                            size='small'
                                            hoverable
                                            onClick={() => {
                                                if (record.appId === selectedAppId) return
                                                if (segment === 'performance') setPerformanceTrendLoading(true)
                                                if (segment === 'interventions') setInterventionsLoading(true)
                                                if (segment === 'compliance') setComplianceLoading(true)
                                                setSelectedDeptKey(null)
                                                setSelectedAppId(record.appId)
                                            }}
                                            style={{
                                                cursor: 'pointer',
                                                border: selected ? `1px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                                                background: selected
                                                    ? `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 100%)`
                                                    : token.colorBgContainer,
                                                boxShadow: selected
                                                    ? `0 8px 22px ${token.colorPrimaryBorder}`
                                                    : token.boxShadowTertiary
                                            }}
                                        >
                                            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    justifyContent: 'space-between',
                                                    gap: 12
                                                }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <Text strong style={{ display: 'block', fontSize: 15 }}>
                                                            {record.companyName}
                                                        </Text>
                                                        <Text type='secondary' ellipsis style={{ display: 'block' }}>
                                                            {record.registrationNumber || record.smmeNo || 'No registration number'}
                                                        </Text>
                                                    </div>
                                                    <Button
                                                        data-guide='sme-export-one'
                                                        shape='circle'
                                                        title='Export SME'
                                                        icon={<DownloadOutlined />}
                                                        style={{ border: `1px solid ${token.colorPrimary}`, color: token.colorPrimary }}
                                                        onClick={event => {
                                                            event.stopPropagation()
                                                            handleExportSingle(record)
                                                        }}
                                                    />
                                                </div>
                                                <Space wrap size={[6, 6]}>
                                                    {record.group && <Tag color='purple'>Group {record.group}</Tag>}
                                                    {record.sector && <Tag color='blue'>{record.sector}</Tag>}
                                                    <Tag>{record.branchName || 'No branch'}</Tag>
                                                </Space>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    gap: 12,
                                                    color: token.colorTextSecondary,
                                                    fontSize: 12
                                                }}>
                                                    <span>{record.province || record.town || 'No location'}</span>
                                                    <span>{record.metrics.currentEmployees || 0} employees</span>
                                                </div>
                                            </Space>
                                        </Card>
                                    })}
                                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%', maxWidth: '100%', overflow: 'hidden', paddingTop: 8 }}>
                                        <Pagination
                                            size='small'
                                            current={listPage}
                                            pageSize={smeListPageSize}
                                            total={filteredRows.length}
                                            showSizeChanger={false}
                                            hideOnSinglePage
                                            responsive
                                            showLessItems
                                            onChange={setListPage}
                                        />
                                    </div>
                                </Space>
                            </MotionCard>
                        </div>
                    </Col>

                    <Col xs={24} xl={17}>
                        <div data-guide='sme-detail-workspace' style={{ height: '100%' }}>
                            <Card variant='borderless' style={{ height: '100%', }}>
                                <Space direction='vertical' style={{ width: '100%' }} size='large'>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 16,
                                        flexWrap: 'wrap',
                                        width: '100%'
                                    }}>
                                        <div style={{ minWidth: 220, flex: '1 1 240px' }}>
                                            <Title level={4} style={{ marginBottom: 4 }}>
                                                {selectedRow?.companyName || 'Select an SME'}
                                            </Title>
                                            {selectedRow && (
                                                <Text type='secondary'>
                                                    {selectedRow.smmeNo || 'No SMME Number'} • {selectedRow.sector || 'No sector'} •{' '}
                                                    {selectedRow.province || selectedRow.town || 'No province'}
                                                </Text>
                                            )}
                                        </div>

                                        <div
                                            data-guide='sme-detail-tabs'
                                            style={{
                                                overflowX: 'auto',
                                                flex: isMobileLike ? '1 1 100%' : '0 1 auto'
                                            }}
                                        >
                                            <Segmented
                                                block={isMobileLike}
                                                value={segment}
                                                onChange={val =>
                                                    setSegment(val as 'demographics' | 'performance' | 'interventions' | 'compliance')
                                                }
                                                options={[
                                                    {
                                                        label: <span data-guide='sme-demographics-tab'>Demographics</span>,
                                                        value: 'demographics'
                                                    },
                                                    {
                                                        label: <span data-guide='sme-performance-tab'>Performance</span>,
                                                        value: 'performance'
                                                    },
                                                    {
                                                        label: <span data-guide='sme-interventions-tab'>Interventions</span>,
                                                        value: 'interventions'
                                                    },
                                                    {
                                                        label: <span data-guide='sme-compliance-tab'>Compliance</span>,
                                                        value: 'compliance'
                                                    }
                                                ]}
                                            />
                                        </div>
                                    </div>

                                    {segment === 'demographics' && (
                                        <div data-guide='sme-demographics-content'>
                                            {renderDemographics()}
                                        </div>
                                    )}
                                    {segment === 'performance' && (
                                        <div data-guide='sme-performance-content'>
                                            {renderPerformance()}
                                        </div>
                                    )}
                                    {segment === 'interventions' && (
                                        <div data-guide='sme-interventions-content'>
                                            {renderInterventions()}
                                        </div>
                                    )}
                                    {segment === 'compliance' && (
                                        <div data-guide='sme-compliance-content'>
                                            {renderCompliance()}
                                        </div>
                                    )}
                                </Space>
                            </Card>
                        </div>
                    </Col>
                </Row>
            )
            }

            <PreIncubationContractModal
                open={!!preIncViewer}
                participantId={selectedRow?.participantId || ''}
                applicationId={selectedRow?.appId}
                onClose={() => setPreIncViewer(null)}
                onSigned={async () => undefined}
                readOnly
                signedMeta={preIncViewer?.meta}
                viewerRole='operations'
            />

            <GapAnalysisViewModal
                open={gapViewerOpen}
                onClose={() => {
                    setGapViewerOpen(false)
                    setGapViewerId(null)
                }}
                gapId={gapViewerId}
                isROM={false}
                allowedSections={'ALL' as any}
                romName={''}
                romEmail={''}
            />

            <Modal
                title='Memorandum of Agreement (MOA)'
                open={!!moaViewer}
                onCancel={() => setMoaViewer(null)}
                width='min(960px, 96vw)'
                styles={{ body: { padding: 0, maxHeight: '76vh', overflowY: 'auto' } }}
                footer={<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
                    <Button block onClick={() => setMoaViewer(null)}>Close</Button>
                    <Button
                        block
                        type='primary'
                        icon={<DownloadOutlined />}
                        loading={moaDownloading}
                        onClick={downloadViewedMoa}
                    >
                        Download MOA
                    </Button>
                </div>}
                destroyOnClose
            >
                {moaViewer && (
                    <div className='contract-document-stage'>
                        {renderMoaPages(moaViewer.vars).map((page, index, pages) => (
                            <article key={index} className='contract-paper contract-paper--page'>
                                <header className='contract-paper__header'>
                                    <div><img src='/assets/images/lepharo.png' alt='Lepharo' /></div>
                                    <div className='contract-paper__header-title'>
                                        INCUBATION MEMORANDUM OF AGREEMENT
                                    </div>
                                    <div className='contract-paper__header-meta'>
                                        <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                        <span><strong>Revision No:</strong> 0</span>
                                        <span><strong>Effective date:</strong> {moaViewer.vars.effectiveDate}</span>
                                    </div>
                                </header>
                                {renderStyledMoaPage(page, index)}
                                <footer className='contract-paper__page-footer'>
                                    <span><span className='contract-paper__reference-label'>Ref No:</span> LEP QMS 074.1 F</span>
                                    <span>-{index + 1}-</span>
                                </footer>
                            </article>
                        ))}
                        <article className='contract-paper contract-paper--page'>
                            <header className='contract-paper__header'>
                                <div><img src='/assets/images/lepharo.png' alt='Lepharo' /></div>
                                <div className='contract-paper__header-title'>INCUBATION MEMORANDUM OF AGREEMENT</div>
                                <div className='contract-paper__header-meta'>
                                    <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                    <span><strong>Revision No:</strong> 0</span>
                                    <span><strong>Effective date:</strong> {moaViewer.vars.effectiveDate}</span>
                                </div>
                            </header>
                            <div className='moa-preview-signatures'>
                                <h2 className='moa-preview-signatures__title'>29 &nbsp;&nbsp;&nbsp; SIGNATURES</h2>
                                <section className='moa-preview-signatures__block'>
                                    <h3>The Incubatee or SMME</h3>
                                    <div className='moa-preview-signatures__row'>
                                        <span>SIGNED on</span>
                                        <span className='moa-preview-signatures__field'>
                                            {moaViewer.meta?.acceptedAt ? formatDateTime(moaViewer.meta.acceptedAt) : 'Date not recorded'}
                                        </span>
                                    </div>
                                    <div className='moa-preview-signatures__row'>
                                        <span>Name &amp; Surname:</span>
                                        <strong className='moa-preview-signatures__field'>
                                            {moaViewer.meta?.signerName || moaViewer.vars.participantName}
                                        </strong>
                                    </div>
                                    <p className='moa-preview-signatures__statement'>[For and on behalf of the INCUBATEE, duly authorized]</p>
                                    {moaParticipantSignature(moaViewer.meta) ? (
                                        <img className='contract-paper__signature-image moa-preview-signatures__signature' src={moaParticipantSignature(moaViewer.meta)} alt='Incubatee signature' />
                                    ) : <div className='contract-paper__signature-line moa-preview-signatures__signature' />}
                                    <p>Signature</p>
                                </section>
                                <section className='moa-preview-signatures__block'>
                                    <h3>The Incubator</h3>
                                    <div className='moa-preview-signatures__row'>
                                        <span>Name &amp; Surname:</span>
                                        <strong className='moa-preview-signatures__field'>
                                            {moaViewer.meta?.romSignerName || 'Lepharo representative'}
                                        </strong>
                                        <span>Position:</span>
                                        <span className='moa-preview-signatures__field'>
                                            {moaViewer.meta?.romSignerTitle || 'Centre Coordinator'}
                                        </span>
                                    </div>
                                    <p className='moa-preview-signatures__statement'>[For and on behalf of the INCUBATOR, duly authorized]</p>
                                    {moaRomSignature(moaViewer.meta) ? (
                                        <img className='contract-paper__signature-image moa-preview-signatures__signature' src={moaRomSignature(moaViewer.meta)} alt='Incubator signature' />
                                    ) : <div className='contract-paper__signature-line moa-preview-signatures__signature' />}
                                    <p>Signature</p>
                                </section>
                            </div>
                            <footer className='contract-paper__page-footer'>
                                <span><span className='contract-paper__reference-label'>Ref No:</span> LEP QMS 074.1 F</span>
                                <span>-{renderMoaPages(moaViewer.vars).length + 1}-</span>
                            </footer>
                        </article>
                    </div>
                )}
            </Modal>

            <Modal
                title='Add Dummy SME (Internal Only)'
                open={dummySmeModalVisible}
                onCancel={() => {
                    setDummySmeModalVisible(false)
                    dummySmeForm.resetFields()
                    setDummySmeQuantity(1)
                }}
                onOk={handleCreateDummySme}
                okText={dummySmeQuantity > 1 ? `Create ${dummySmeQuantity} Random SMEs` : 'Create Dummy SME'}
                okButtonProps={{ icon: <PlusOutlined />, loading: creatingDummySme }}
                centered
                destroyOnClose
                styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
            >
                <Text type='secondary' style={{ display: 'block', marginBottom: 16 }}>
                    Dummy SMEs are only visible to @quantilytix.co.za users and are added directly under
                    the currently selected program, skipping the full application form. Each one also gets
                    a real login (a welcome/password email is sent to its address) so you can sign in as
                    that SME to confirm its Diagnostic Plan and add evidence, just like a real applicant.
                </Text>

                <Form.Item label='Quantity' style={{ marginBottom: 12 }}>
                    <Space align='center'>
                        <InputNumber
                            min={1}
                            max={20}
                            value={dummySmeQuantity}
                            onChange={value => setDummySmeQuantity(Number(value) || 1)}
                            style={{ width: 100 }}
                        />
                        <Text type='secondary'>
                            More than 1 generates fully random SMEs and skips the fields below.
                        </Text>
                    </Space>
                </Form.Item>

                {dummySmeQuantity === 1 && (
                    <Form form={dummySmeForm} layout='vertical'>
                        <Space style={{ marginBottom: 12 }}>
                            <Button icon={<ThunderboltOutlined />} onClick={handleGenerateRandomFill}>
                                Generate random SA details
                            </Button>
                        </Space>

                        <Form.Item
                            name='businessName'
                            label='Business Name'
                            rules={[{ required: true, message: 'Enter a business name' }]}
                        >
                            <Input placeholder='e.g. Thabo Trading (Pty) Ltd' />
                        </Form.Item>

                        <Form.Item
                            name='contactPerson'
                            label='Contact Person'
                            rules={[{ required: true, message: 'Enter a contact person' }]}
                        >
                            <Input placeholder='Full name' />
                        </Form.Item>

                        <Form.Item
                            name='email'
                            label='Contact Email'
                            rules={[
                                { required: true, message: 'Enter an email address' },
                                { type: 'email', message: 'Enter a valid email address' },
                                {
                                    validator: (_: unknown, value: string) =>
                                        isQuantilytixDomain(value)
                                            ? Promise.resolve()
                                            : Promise.reject(
                                                new Error('Dummy SMEs must use a @quantilytix.co.za email address')
                                            )
                                }
                            ]}
                        >
                            <Input placeholder='name@quantilytix.co.za' />
                        </Form.Item>

                        <Row gutter={12}>
                            <Col span={12}>
                                <Form.Item name='phone' label='Phone'>
                                    <Input placeholder='e.g. 0821234567' />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name='gender' label='Gender'>
                                    <Select
                                        allowClear
                                        options={[
                                            { label: 'Male', value: 'Male' },
                                            { label: 'Female', value: 'Female' }
                                        ]}
                                    />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Row gutter={12}>
                            <Col span={12}>
                                <Form.Item name='province' label='Province'>
                                    <Select
                                        allowClear
                                        showSearch
                                        options={SA_PROVINCES.map(p => ({ label: p, value: p }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name='town' label='Town/City'>
                                    <Input placeholder='e.g. Polokwane' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Form.Item name='sector' label='Sector'>
                            <Select allowClear showSearch options={SA_SECTORS.map(s => ({ label: s, value: s }))} />
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </div >
    )
}

export default SMEOverview
