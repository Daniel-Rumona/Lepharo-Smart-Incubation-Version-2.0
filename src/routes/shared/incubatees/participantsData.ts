import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { getDownloadURL, getStorage, ref as storageRef } from 'firebase/storage'
import Highcharts from 'highcharts'
import * as XLSX from 'xlsx'
import { type MoaVars } from '@/components/modals/Contracts/moa.pages'
import { functionsBaseUrl } from '@/firebaseConfig'

export const FINANCE_API_BASE_URL = 'https://quantnow-sa1e.onrender.com'

export const CREATE_USER_URL =
    `${functionsBaseUrl}/createPlatformUser`

export const SA_PROVINCES = [
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

export const SA_SECTORS = [
    'Agriculture',
    'Manufacturing',
    'Retail',
    'Construction',
    'ICT',
    'Tourism',
    'Professional Services',
    'Transport & Logistics'
]

export type Application = {
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

export type ProgramDoc = {
    id: string
    isMultiBranch?: boolean
    assignedBranch?: {
        id?: string
        name?: string
    }
    branchId?: string
}

export type Participant = {
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

export type MonthlyPerfRow = {
    month: string
    revenue?: number
    headPermanent?: number
    headTemporary?: number
    traffic?: number
    networking?: number
}

// Photos are written to users/{uid}. Not every role may read that doc, so a
// failed lookup just means "no photo" and the UI falls back to initials.
export const resolveSmePhoto = async (participant: any, app: any): Promise<string | undefined> => {
    const direct = participant?.photoURL || app?.photoURL
    if (direct) return String(direct)
    const uid = participant?.uid || app?.uid
    if (!uid) return undefined
    try {
        const snap = await getDoc(doc(db, 'users', String(uid)))
        const data = snap.data() as any
        return data?.photoURL || undefined
    } catch {
        return undefined
    }
}

// Shared data-label style for this page's charts. The `filter` skips points whose
// value is 0 (null gaps never get a label), and the pill follows the colour mode
// so labels stay legible on a dark card.
export const chartDataLabels = (isDark: boolean): Highcharts.DataLabelsOptions => ({
    enabled: true,
    allowOverlap: true,
    crop: false,
    defer: false,
    overflow: 'allow',
    filter: { property: 'y', operator: '>', value: 0 },
    backgroundColor: isDark ? 'rgba(31, 36, 45, 0.92)' : 'rgba(255,255,255,.88)',
    borderColor: isDark ? 'rgba(255, 255, 255, 0.18)' : undefined,
    borderWidth: isDark ? 1 : 0,
    borderRadius: 3,
    padding: 3,
    style: {
        color: isDark ? 'rgba(255, 255, 255, 0.92)' : '#111827',
        fontSize: '11px',
        fontWeight: '600',
        textOutline: 'none'
    }
})

export const smeInitials = (name?: string) =>
    String(name || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase())
        .join('')

export type OwnershipSummary = {
    blackOwnedPercent?: number
    femaleOwnedPercent?: number
    youthOwnedPercent?: number
}

export type SmeRow = {
    appId: string
    participantId?: string | null
    programId?: string
    smmeNo?: string
    registrationNumber?: string
    idNumber?: string
    companyName: string
    photoUrl?: string
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

export type SmePerformanceDetail = {
    mergedRevenue: (number | null)[]
    mergedPerm: (number | null)[]
    mergedTemp: (number | null)[]
    mergedTraffic: (number | null)[]
    mergedNetworking: (number | null)[]
}

export type Intervention = {
    id: string
    status?: string
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
    assigneeName?: string
    facilitatorName?: string
    assignedToName?: string
    movStatus?: string
}

export type ComplianceDoc = {
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

export type MoaViewerState = {
    vars: MoaVars
    meta: any
}

export type MonthlyFinancePoint = {
    month: string
    monthLabel?: string
    revenue: number
}

export type JobContract = {
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

export type ComplianceStats = {
    total: number
    valid: number
    expired: number
    pending: number
    invalid: number
    queried: number
}

export const canonicalComplianceId = (value: string) => {
    const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (/\bmoa\b/.test(normalized) || normalized.includes('memorandum of agreement')) return 'moa'
    if (normalized.includes('gap analysis')) return 'gap-analysis'
    if (normalized.includes('pre incubation')) return 'pre-incubation-contract'
    if (normalized.includes('popia') || normalized.includes('protection of personal information')) return 'popia'
    return normalized || 'document'
}

export const standardComplianceName = (id: string, title?: string) => {
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

export const directDocumentUrl = (value: any) =>
    value?.signedFileURL || value?.signedFileUrl || value?.downloadURL ||
    value?.fileURL || value?.fileUrl || value?.pdfUrl || value?.pdfURL ||
    value?._original?.pdfUrl || value?._original?.url || value?.url || value?.file?.url

export const documentStoragePath = (value: any) =>
    value?.pdfPath || value?.storagePath || value?.filePath || value?.path ||
    value?.file?.path || value?.file?.storagePath

export const resolveDocumentUrl = async (document: ComplianceDoc) => {
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

export type DeptGap = {
    key: string
    label: string
    needed: number
    completed: number
    inProgress: number
    missing: number
}

export type CompletedInterventionExportRow = {
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

export const monthNames = [
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

export const monthFromLabel = (label?: string) => (label || '').trim().split(' ')[0]

export const buildUploadedByMonth = (rows: MonthlyPerfRow[]) => {
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

export const normalizeRevenueMap = (m?: Record<string, any>) => {
    const result: (number | null)[] = Array(12).fill(null)
    if (!m) return result
    monthNames.forEach((name, i) => {
        const v = Number(m[name])
        result[i] = Number.isFinite(v) ? v : null
    })
    return result
}

export const normalizeHeadcountMap = (m?: Record<string, { permanent?: any; temporary?: any }>) => {
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

export const normalize = (value: any) =>
    String(value ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

export const isStrictlyCompleted = (item: any) => {
    return String(item?.status || '').toLowerCase().trim() === 'completed'
}

export const getAssignedCompletedAt = (item: any) => {
    return (
        item?.completedAt ||
        item?.userConfirmedAt ||
        item?.assigneeCompletedAt ||
        item?.updatedAt ||
        null
    )
}

export const getDeliveryMethodLabel = (mov: any) => {
    const parts: string[] = []

    if (mov?.methodInPerson) parts.push('In Person')
    if (mov?.methodOnline) parts.push('Online')
    if (mov?.methodTelephonic) parts.push('Telephonic')

    const other = String(mov?.methodOther || '').trim()
    if (other) parts.push(other)

    return parts.length ? parts.join(', ') : '—'
}

export const titlesMatch = (a?: string, b?: string) => {
    const x = normalize(a)
    const y = normalize(b)
    if (!x || !y) return false
    return x === y
}

export const departmentsMatch = (planned: any, assigned: any) => {
    const plannedDeptId = normalize(planned?.departmentId)
    const assignedDeptId = normalize(assigned?.departmentId)
    return !!plannedDeptId && plannedDeptId === assignedDeptId
}

export const mergePrefUploaded = (uploaded: (number | null)[], participant: (number | null)[]) =>
    monthNames.map((_, i) => (uploaded[i] != null ? uploaded[i] : participant[i] ?? null))

export const monthKeyFromValue = (value: any): string | null => {
    if (!value) return null
    const direct = String(value).trim().match(/^(\d{4})-(\d{1,2})/)
    if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}`
    const date = toDateSafe(value)
    if (!date) return null
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export const jobContractMonth = (contract: JobContract) =>
    monthKeyFromValue(contract.uploadMonthDate) ||
    monthKeyFromValue(contract.uploadMonth) ||
    monthKeyFromValue(contract.createdAt) ||
    monthKeyFromValue(contract.updatedAt)

export const countActiveJobsForMonth = (contracts: JobContract[], monthKey: string) => {
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

export const carryForwardMonthlyValues = (values: (number | null)[]) => {
    let latest: number | null = null

    return values.map(value => {
        if (value != null) latest = value
        return latest
    })
}

export const isPlainObject = (v: any) => Object.prototype.toString.call(v) === '[object Object]'

export const extractNearestHubFromProfile = (app: any): string => {
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

export const toDateSafe = (value: any): Date | null => {
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

export const formatDateTime = (value: any) => {
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

export const getOnboardedAt = (app: any) => {
    return app?.signedAgreements?.['pre-incubation-contract']?.acceptedAt || null
}

export const getDisplayLocation = (row: Pick<SmeRow, 'town' | 'province' | 'location'>) => {
    const joined = [row.town, row.province].filter(Boolean).join(', ')
    return joined || row.location || '—'
}

export const buildSafeFileName = (name: string) =>
    String(name || 'export')
        .replace(/[\\/:*?"<>|]+/g, '')
        .trim()
        .replace(/\s+/g, '_')

export const chunkArray = <T,>(arr: T[], size: number) => {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size))
    }
    return chunks
}

export const buildDetailsSheetRows = (rows: SmeRow[]) =>
    rows.map(row => ({
        'SMME Number': row.smmeNo || '—',
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

export const applySheetWidths = (worksheet: XLSX.WorkSheet, widths: number[]) => {
    worksheet['!cols'] = widths.map(wch => ({ wch }))
}

export const addSheet = (workbook: XLSX.WorkBook, name: string, rows: any[], widths: number[]) => {
    const sheetRows = rows.length ? rows : [{ Info: 'No data available' }]
    const worksheet = XLSX.utils.json_to_sheet(sheetRows)
    applySheetWidths(worksheet, widths)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
}


export const COMPLIANCE_BUCKETS = {
    valid: { label: 'Valid', color: '#52c41a' },
    expired: { label: 'Expired', color: '#ff4d4f' },
    attention: { label: 'Needs attention', color: '#fa8c16' },
    pending: { label: 'Pending', color: '#faad14' }
} as const

export type ComplianceBucket = keyof typeof COMPLIANCE_BUCKETS

export const complianceBucket = (doc: ComplianceDoc): ComplianceBucket =>
    doc.status === 'valid' ? 'valid'
        : doc.status === 'expired' ? 'expired'
            : doc.status === 'queried' || doc.status === 'invalid' ? 'attention'
                : 'pending'

export const isBlankValue = (value: unknown) =>
    value == null || String(value).trim() === '' || String(value).trim() === '—'

export const ALL_DEPTS = '__all__'

export const INTERVENTION_BUCKETS = {
    completed: { label: 'Completed', color: '#52c41a', tag: 'green' },
    inProgress: { label: 'In progress', color: '#1677ff', tag: 'blue' },
    missing: { label: 'Not started', color: '#faad14', tag: 'orange' }
} as const

export type InterventionBucket = keyof typeof INTERVENTION_BUCKETS

export const interventionBucket = (status?: string): InterventionBucket => {
    const s = String(status || '').toLowerCase().trim()
    if (s === 'completed') return 'completed'
    if (s === 'in-progress' || s === 'ongoing') return 'inProgress'
    return 'missing'
}

export const sentenceCase = (value: string) => {
    const spaced = value.replace(/[-_]+/g, ' ').trim()
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}


export const normalizeBeeLevel = (value: unknown): number | '5+' | undefined => {
    const text = String(value ?? '').trim()
    if (!text || text === '—') return undefined
    if (/5\s*\+|5 and above/i.test(text)) return '5+'
    const digit = text.match(/\d/)
    if (!digit) return undefined
    const level = Number(digit[0])
    return level >= 5 ? '5+' : level >= 1 ? level : undefined
}

export const cleanText = (value: unknown) => String(value ?? '').trim()

export const editInitialValues = (row: SmeRow) => ({
    registrationNumber: row.registrationNumber ?? '',
    idNumber: row.idNumber ?? '',
    sector: row.sector ?? '',
    gender: row.gender || undefined,
    phone: isBlankValue(row.phone) ? '' : row.phone,
    businessAddress: row.businessAddress ?? '',
    town: row.town ?? '',
    province: row.province || undefined,
    beeLevel: normalizeBeeLevel(row.beeLevel),
    blackOwnedPercent: row.ownership.blackOwnedPercent,
    femaleOwnedPercent: row.ownership.femaleOwnedPercent,
    youthOwnedPercent: row.ownership.youthOwnedPercent
})
