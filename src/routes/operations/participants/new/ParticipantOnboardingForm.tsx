import React, { useEffect, useMemo, useState } from 'react'
import {
    Form,
    Input,
    Select,
    InputNumber,
    Divider,
    Row,
    Col,
    Button,
    DatePicker,
    Typography,
    message,
    Grid,
    Space,
    Steps,
    Card,
    Upload,
    Collapse,
    Checkbox,
    Tag,
    Progress,
    Badge
} from 'antd'
import {
    LeftOutlined,
    RightOutlined,
    FileOutlined,
    PicCenterOutlined,
    UploadOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { auth, db, storage } from '@/firebase'
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp,
    getDoc,
    FieldValue,
    Timestamp
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardHeaderCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

dayjs.extend(customParseFormat)

const { Title } = Typography
const { useBreakpoint } = Grid
const { Panel } = Collapse

// ===== Types =====

type Group = 'A' | 'B' | 'C' | 'Graduated'

type GroupHistoryEntry = {
    from: Group | null
    to: Group
    date: string // ISO
    by: string
    reason: string
    docs: string[]
    requirementsMet: string[]
}
const initialGroupEntry = (to: Group): GroupHistoryEntry => ({
    from: null,
    to,
    date: dayjs().toISOString(),
    by: resolveActor(),
    reason: 'Initial onboarding placement',
    docs: [],
    requirementsMet: []
})

type BranchLite = { id: string; name: string }

type InterventionRow = {
    id: string
    title: string
    area: string
    internal?: boolean
    compulsory?: boolean
}

type DocField = {
    key: string
    title: string
    requiresExpiry: boolean
    expiryMonths?: number | null
    file: File | null
    issueDate: Dayjs | null
    expiryDate: Dayjs | null
    group: 'application' | 'gap' | 'preinc'
}

type UploadedDoc = {
    key: string
    type: string
    url: string | null
    fileName: string | null
    issueDate: string | null
    expiryDate: string | null
    status: 'valid' | 'missing'
    group: 'application' | 'gap' | 'preinc'
}

// ===== Helpers =====

const resolveActor = () => 'Consultant'

const initialAEntry = (): GroupHistoryEntry => ({
    from: null,
    to: 'A',
    date: dayjs().toISOString(),
    by: resolveActor(),
    reason: 'Initial onboarding placement',
    docs: [],
    requirementsMet: []
})

const MAX_FILE_MB = 10
const ACCEPTED_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg'
]
const fmtBytes = (bytes: number) =>
    bytes < 1024
        ? `${bytes} B`
        : bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const norm = (s?: string) => (s || '').toString().trim().toLowerCase()

const slug = (s: string) =>
    (s || '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 60)

const isDateLike = (v: any) =>
    dayjs.isDayjs(v) || v instanceof Date || v instanceof Timestamp

// Firestore sentinels (serverTimestamp, arrayUnion, increment, ...) have to
// reach the SDK untouched. Rebuilding one as a plain object strips its
// prototype, and Firestore then stores the literal map it was built from --
// `{ _methodName: 'serverTimestamp' }` -- instead of applying the sentinel.
const isFirestoreSentinel = (v: any) => v instanceof FieldValue

const trimStringsDeep = (obj: any): any => {
    if (obj === null || obj === undefined) return obj
    if (isDateLike(obj) || isFirestoreSentinel(obj)) return obj
    if (Array.isArray(obj)) return obj.map(trimStringsDeep)
    if (typeof obj === 'object')
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, trimStringsDeep(v)])
        )
    if (typeof obj === 'string') {
        const t = obj.trim()
        return t === '' ? undefined : t
    }
    return obj
}

const pruneUndefinedDeep = (obj: any): any => {
    if (obj === null || obj === undefined) return obj
    if (isDateLike(obj) || isFirestoreSentinel(obj)) return obj
    if (Array.isArray(obj))
        return obj.map(pruneUndefinedDeep).filter(v => v !== undefined)
    if (typeof obj === 'object')
        return Object.fromEntries(
            Object.entries(obj)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, pruneUndefinedDeep(v)])
        )
    return obj
}

const toFirestoreTimestamp = (v: any): Timestamp | undefined => {
    if (!v) return undefined
    if (v instanceof Timestamp) return v
    if (dayjs.isDayjs(v)) return Timestamp.fromDate(v.toDate())
    if (v instanceof Date) return Timestamp.fromDate(v)
    if (typeof v?.toDate === 'function') return Timestamp.fromDate(v.toDate())
    const d = dayjs(v)
    return d.isValid() ? Timestamp.fromDate(d.toDate()) : undefined
}

// SA ID checksum + date validation
export const isValidSouthAfricanID = (raw: string): boolean => {
    const id = (raw || '').replace(/\D/g, '')
    if (!/^\d{13}$/.test(id)) return false

    const yyMMdd = id.slice(0, 6)
    const today = dayjs().startOf('day')

    const dob2000 = dayjs(`20${yyMMdd}`, 'YYYYMMDD', true)
    const dob1900 = dayjs(`19${yyMMdd}`, 'YYYYMMDD', true)

    let dob: dayjs.Dayjs | null = null
    if (dob2000.isValid() && !dob2000.isAfter(today)) {
        dob = dob2000
    } else if (dob1900.isValid() && !dob1900.isAfter(today)) {
        dob = dob1900
    } else {
        return false
    }

    const age = today.diff(dob, 'year')
    if (age < 0 || age > 120) return false

    const digits = id.split('').map(n => parseInt(n, 10))

    const oddSum =
        digits[0] + digits[2] + digits[4] + digits[6] + digits[8] + digits[10]

    const evenConcat = `${digits[1]}${digits[3]}${digits[5]}${digits[7]}${digits[9]}${digits[11]}`
    const evenTimesTwo = String(Number(evenConcat) * 2)
    const evenSum = evenTimesTwo
        .split('')
        .reduce((s, d) => s + parseInt(d, 10), 0)

    const total = oddSum + evenSum
    const checkDigit = (10 - (total % 10)) % 10

    return checkDigit === digits[12]
}

// SA CIPC/CK/IT registration number formats (most common)
const isValidZARegistration = (raw: string): boolean => {
    if (!raw) return false
    const v = raw.toUpperCase().replace(/\s+/g, '')
    const patterns = [
        /^K\d{4}\/\d{6}\/\d{2}$/,
        /^\d{4}\/\d{6}\/\d{2}$/,
        /^CK\d{4}\/\d{6}\/\d{2}$/,
        /^IT\d{4}\/\d{6}$/
    ]
    return patterns.some(re => re.test(v))
}

const sectors = [
    'Agriculture',
    'Engineering',
    'Green Economic',
    'Supply Chain Industries',

    'Mining',
    'Mining Supply',
    'Manufacturing',
    'Electricity, Gas and Water',
    'Construction',
    'Wholesale and Retail Trade',
    'Transport, Storage and Communication',
    'Finance, Real Estate and Business Services',
    'Community, Social and Personal Services',
    'Tourism and Hospitality',
    'Information Technology',
    'Education',
    'Health and Social Work',
    'Arts and Culture',
    'Automotive',
    'Chemical',
    'Textile',
    'Forestry and Logging',
    'Fishing',
    'Other'
]

const provinces = [
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'Northern Cape',
    'North West',
    'Western Cape'
]

// ===== Compliance subdocs writer (same pattern as ParticipantRegistrationStepForm) =====
const upsertComplianceSubdocs = async (
    appRef: import('firebase/firestore').DocumentReference,
    uploadedDocs: UploadedDoc[],
    ctx: {
        programId?: string | null
        programName?: string | null
        | null
        uploadedByEmail?: string | null
    }
) => {
    const { programId, programName, uploadedByEmail } = ctx

    await Promise.all(
        uploadedDocs.map(async d => {
            const subId = norm(d.key || d.type) || `doc_${Date.now()}`
            const ref = doc(appRef, 'complianceDocuments', subId)
            const status = d.url ? 'pending' : 'missing'

            await setDoc(
                ref,
                {
                    type: d.type,
                    documentName: d.type,
                    presetId: norm(d.key || d.type),
                    status,
                    url: d.url || null,
                    issueDate: d.issueDate || null,
                    expiryDate: d.expiryDate || null,
                    uploadedAt: serverTimestamp(),
                    uploadedBy: uploadedByEmail || null,
                    programId: programId || null,
                    programName: programName || null,
                    kind: 'upload',
                    slug: norm(d.key || d.type),
                    createdBy: uploadedByEmail || null,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            )
        })
    )
}

// ===== Component =====

const ParticipantOnboardingForm: React.FC = () => {
    const { user } = useFullIdentity()
    const [form] = Form.useForm()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [searchParams] = useSearchParams()
    const { id: programId } = useParams<{ id: string }>()

    // programName  now driven primarily from the program document
    const [programName, setProgramName] = useState<string | null>(
        searchParams.get('program') || null
    )

    // Program-assigned branch fallback + branches list for override
    const [programAssignedBranchId, setProgramAssignedBranchId] = useState<
        string | null
    >(null)
    const [programAssignedBranchName, setProgramAssignedBranchName] = useState<
        string | null
    >(null)
    const [branches, setBranches] = useState<BranchLite[]>([])

    const [current, setCurrent] = useState(0)
    const [sectorOptions, setSectorOptions] = useState<string[]>(sectors)

    const [documentFields, setDocumentFields] = useState<DocField[]>([])
    const [draftDocs, setDraftDocs] = useState<any[] | null>(null)
    const [requiredKeys, setRequiredKeys] = useState<string[]>([])
    const [allProgramRequirements, setAllProgramRequirements] = useState<any[]>(
        []
    )
    const [interventionGroups, setInterventionGroups] = useState<any[]>([])
    const [interventionSelections, setInterventionSelections] = useState<
        Record<string, string[]>
    >({})
    const [openPanels, setOpenPanels] = useState<string[]>([])
    const [uploading, setUploading] = useState(false)
    const [complianceScore, setComplianceScore] = useState(0)

    // ==== Revenue / headcount helper fields ====
    const last3Months = useMemo(
        () =>
            Array.from({ length: 3 }, (_, i) => {
                const d = dayjs().subtract(i + 1, 'month')

                return {
                    key: d.format('YYYY-MM'),
                    label: d.format('MMMM YYYY')
                }
            }).reverse(),
        []
    )

    const isMoaDoc = (title?: string) => {
        const t = norm(title)
        return t.includes('moa') || t.includes('memorandum of agreement')
    }

    const currentYear = dayjs().year()
    const last2Years = useMemo(
        () => [currentYear - 1, currentYear - 2],
        [currentYear]
    )

    const FOOTER_H = 56

    //   Load branches
    useEffect(() => {
        const run = async () => {
            try {

                // Try common patterns:
                // 1) /branches
                // 2) or /programs/{id}/branches subcollection (uncomment if you use it)

                const list: BranchLite[] = []

                // Option 1: flat collection
                const flatSnap = await getDocs(
                    query(
                        collection(db, 'branches'),

                    )
                )
                flatSnap.docs.forEach(d => {
                    const data = d.data() as any
                    list.push({
                        id: d.id,
                        name: data.name || data.branchName || d.id
                    })
                })

                // Deduplicate by id
                const seen = new Set<string>()
                const unique = list.filter(b =>
                    seen.has(b.id) ? false : (seen.add(b.id), true)
                )
                setBranches(unique)
            } catch (e) {
                console.error(e)
                // don't block the form if branches fail to load
                setBranches([])
            }
        }
        run()
    }, [db, programId])

    // ====== Load program requirements for documents (application + gap + pre-inc) ======
    useEffect(() => {
        const loadRequiredDocs = async () => {
            if (!programId) {
                setDocumentFields([])
                setRequiredKeys([])
                return
            }

            const s = await getDoc(doc(db, 'programs', programId))
            if (!s.exists()) {
                setDocumentFields([])
                setRequiredKeys([])
                return
            }

            const program = s.data() as any

            // derive programName from program document
            const resolvedProgramName =
                program.programName || program.name || program.title || null

            setProgramName(resolvedProgramName)


            // read assigned branch in a tolerant way
            // supports { assignedBranch: { id, name } } OR flat { assignedBranchId, assignedBranchName }
            const ab =
                program.assignedBranch ||
                (program.assignedBranches?.[0] ?? null) || // if it's an array, take first
                null

            const abId: string | null = ab?.id || program.assignedBranchId || null
            const abName: string | null =
                ab?.name || program.assignedBranchName || null

            setProgramAssignedBranchId(abId)
            setProgramAssignedBranchName(abName)

            const allRequirements = program.programRequirements || []
            setAllProgramRequirements(allRequirements)

            const draftMap = new Map(
                (draftDocs || []).map((d: any) => [
                    d.key || String(d.title || '').toLowerCase(),
                    d.expiryDate
                ])
            )

            const makeStableKey = (r: any) => {
                const title = r.title || 'document'
                return r.key || r.preset || r.id || `title:${slug(title)}`
            }

            const mapped: DocField[] = allRequirements.map((r: any) => {
                const stableKey = makeStableKey(r)
                const saved = draftMap.get(stableKey) || draftMap.get(norm(r.title))

                let group: 'application' | 'gap' | 'preinc' = 'application'
                if (r.requiredAtGap) group = 'gap'
                if (r.requiredAtPreIncubation) group = 'preinc'

                return {
                    key: stableKey,
                    title: r.title || r.preset || r.key || 'Document',
                    requiresExpiry: !!r.hasExpiry,
                    expiryMonths: r.expiryMonths ?? null,
                    file: null,
                    issueDate: null,
                    expiryDate: saved ? dayjs(saved) : null,
                    group
                }
            })

            setDocumentFields(mapped)

            // REQUIRED docs for compliance = all application docs EXCEPT MOA
            const applicationRequiredKeys = mapped
                .filter(d => d.group === 'application' && !isMoaDoc(d.title))
                .map(d => d.key)

            setRequiredKeys(applicationRequiredKeys)
        }

        loadRequiredDocs().catch(err => {
            console.error(err)
            message.error('Failed to load program requirements')
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [programId, draftDocs])

    // ====== Load interventions per company & group by area ======
    useEffect(() => {
        const fetchInterventions = async () => {
            const loadForCompany = async () => {
                const snap = await getDocs(
                    query(
                        collection(db, 'interventions')
                    )
                )
                return snap.docs.map(d => {
                    const data = d.data() as any
                    return {
                        id: d.id,
                        title: data.interventionTitle,
                        area: data.areaOfSupport || 'General',
                        internal: !!data.internal,
                        compulsory: !!data.compulsory
                    } as InterventionRow
                })
            }

            let rows: InterventionRow[] = []

            rows = await loadForCompany()

            const selectable = rows.filter(
                r => r.internal !== true && r.compulsory !== true
            )

            const areaMap: Record<string, { id: string; title: string }[]> = {}
            selectable.forEach(iv => {
                if (!iv.title) return
                if (!areaMap[iv.area]) areaMap[iv.area] = []
                areaMap[iv.area].push({ id: iv.id, title: iv.title })
            })

            const grouped = Object.entries(areaMap).map(([area, interventions]) => ({
                area,
                interventions
            }))

            setInterventionGroups(grouped)
            setOpenPanels(grouped.map(g => g.area))
        }

        fetchInterventions().catch(err => {
            console.error(err)
            message.error('Failed to load interventions')
        })
    }, [])

    // ===== Compliance score =====
    useEffect(() => {
        const uploadedLikeDocs = documentFields.map(doc => ({
            ...doc,
            status: doc.file ? 'valid' : 'missing',
            expiryDate: doc.expiryDate?.format?.('YYYY-MM-DD') || null
        }))

        setComplianceScore(calculateCompliance(uploadedLikeDocs))
    }, [documentFields, requiredKeys])

    const calculateCompliance = (docs: any[] = []) => {
        const applicationRequiredDocs = docs.filter(doc =>
            requiredKeys.includes(doc.key)
        )
        const totalRequired = applicationRequiredDocs.length
        const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        const validDocs = applicationRequiredDocs.filter(doc => {
            if (doc.status !== 'valid') return false
            if (doc.expiryDate && new Date(doc.expiryDate) <= oneWeekFromNow)
                return false
            return true
        })

        return totalRequired === 0
            ? 0
            : Math.round((validDocs.length / totalRequired) * 100)
    }

    // ===== Document upload helpers =====

    const handleFileUpload = (file: File, key: string) => {
        const tooBig = file.size > MAX_FILE_MB * 1024 * 1024
        const badType = !ACCEPTED_MIME.includes(file.type)

        if (tooBig) {
            message.error(
                `"${file.name}" is ${fmtBytes(file.size)} (max ${MAX_FILE_MB} MB).`
            )
            return Upload.LIST_IGNORE
        }
        if (badType) {
            message.error('Unsupported file type. Please upload PDF, PNG, or JPG.')
            return Upload.LIST_IGNORE
        }

        setDocumentFields(docs =>
            docs.map(d => (d.key === key ? { ...d, file } : d))
        )
        return false
    }

    const clearFile = (key: string) => {
        setDocumentFields(docs =>
            docs.map(d => (d.key === key ? { ...d, file: null } : d))
        )
    }

    const handleIssueDateChange = (date: Dayjs | null, key: string) => {
        setDocumentFields(docs =>
            docs.map(d => (d.key === key ? { ...d, issueDate: date } : d))
        )
    }

    const handleExpiryDateChange = (date: Dayjs | null, key: string) => {
        setDocumentFields(docs =>
            docs.map(d => (d.key === key ? { ...d, expiryDate: date } : d))
        )
    }

    const disabledDateForDoc = (doc: DocField) => (current: Dayjs) => {
        if (!current) return false
        const today = dayjs().startOf('day')
        if (current.isBefore(today)) return true
        if (doc.expiryMonths) {
            const max = dayjs().add(doc.expiryMonths, 'month').endOf('day')
            if (current.isAfter(max)) return true
        }
        return false
    }

    const uploadFileAndGetURL = async (
        file: File,
        folder = 'participant_documents'
    ) => {
        const fileName = `${Date.now()}_${file.name}`
        const fileRef = ref(storage, `${folder}/${fileName}`)
        await uploadBytes(fileRef, file)
        const url = await getDownloadURL(fileRef)
        return { url, name: fileName }
    }

    const uploadAllDocuments = async (): Promise<UploadedDoc[]> => {
        const uploadedDocs: UploadedDoc[] = []

        for (const docField of documentFields) {
            if (!docField.file) {
                uploadedDocs.push({
                    key: docField.key,
                    type: docField.title,
                    url: null,
                    fileName: null,
                    issueDate: null,
                    expiryDate: null,
                    status: 'missing',
                    group: docField.group
                })
                continue
            }

            try {
                const { url, name } = await uploadFileAndGetURL(docField.file)
                uploadedDocs.push({
                    key: docField.key,
                    type: docField.title,
                    url,
                    fileName: name,
                    issueDate: docField.issueDate
                        ? docField.issueDate.format('YYYY-MM-DD')
                        : null,
                    expiryDate: docField.requiresExpiry
                        ? docField.expiryDate?.format('YYYY-MM-DD') || null
                        : null,
                    status: 'valid',
                    group: docField.group
                })
            } catch (e) {
                console.error(e)
                message.error(`Failed to upload ${docField.title}`)
            }
        }

        return uploadedDocs
    }

    // ===== Simple score color helper for review =====
    const scoreColor = (score: number) => {
        if (score >= 80)
            return { color: 'success', tag: 'green', text: 'Excellent' }
        if (score >= 60) return { color: 'processing', tag: 'blue', text: 'Good' }
        if (score >= 40) return { color: 'warning', tag: 'gold', text: 'Fair' }
        return { color: 'exception', tag: 'red', text: 'Poor' }
    }

    // ===== Subcomponents =====

    type DocumentsListProps = {
        items: DocField[]
        title: string
    }

    const DocumentsList: React.FC<DocumentsListProps> = ({ items, title }) => {
        if (!items.length) return null

        return (
            <Space direction='vertical' style={{ width: '100%' }}>
                <Title level={5}>{title}</Title>
                <Row gutter={[12, 12]}>
                    {items.map(doc => {
                        const hasFile = !!doc.file
                        const statusColor = hasFile ? 'green' : 'red'
                        const statusText = hasFile ? 'Ready' : 'Missing'
                        const expiryHint = doc.expiryMonths
                            ? ` ≤ ${doc.expiryMonths} month${doc.expiryMonths > 1 ? 's' : ''
                            } from today`
                            : ''

                        return (
                            <Col xs={24} md={12} key={doc.key}>
                                <Card size='small' bodyStyle={{ padding: 12 }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            marginBottom: 8
                                        }}
                                    >
                                        <span style={{ fontWeight: 600 }}>{doc.title}</span>
                                        <Tag color={statusColor}>{statusText}</Tag>
                                    </div>

                                    <Upload
                                        accept={ACCEPTED_MIME.join(',')}
                                        beforeUpload={f => (
                                            handleFileUpload(f as File, doc.key), false
                                        )}
                                        fileList={
                                            doc.file
                                                ? [
                                                    {
                                                        uid: doc.key,
                                                        name: doc.file.name,
                                                        status: 'done'
                                                    } as any
                                                ]
                                                : []
                                        }
                                        onRemove={() => clearFile(doc.key)}
                                        maxCount={1}
                                        showUploadList={{ showRemoveIcon: true }}
                                    >
                                        <Button icon={<UploadOutlined />}>
                                            {hasFile ? 'Replace file' : 'Upload'}
                                        </Button>
                                    </Upload>

                                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                                        {hasFile ? (
                                            <>
                                                <span style={{ marginRight: 8 }}>
                                                    <strong>File:</strong> {doc.file?.name}
                                                </span>
                                                <span>
                                                    <strong>Size:</strong> {fmtBytes(doc.file!.size)}
                                                </span>
                                            </>
                                        ) : (
                                            <span>
                                                Accepted: PDF, PNG, JPG · Max {MAX_FILE_MB} MB
                                            </span>
                                        )}
                                    </div>

                                    <Row gutter={8} style={{ marginTop: 10 }}>
                                        <Col span={12}>
                                            <DatePicker
                                                placeholder='Issue Date'
                                                style={{ width: '100%' }}
                                                value={doc.issueDate}
                                                disabled={!hasFile}
                                                onChange={d => handleIssueDateChange(d, doc.key)}
                                            />
                                            <div
                                                style={{
                                                    fontSize: 12,
                                                    marginTop: 4,
                                                    color: 'rgba(0,0,0,.45)'
                                                }}
                                            >
                                                Required when a file is attached
                                            </div>
                                        </Col>

                                        <Col span={12}>
                                            {doc.requiresExpiry && (
                                                <>
                                                    <DatePicker
                                                        placeholder={`Expiry Date${expiryHint}`}
                                                        style={{ width: '100%' }}
                                                        value={doc.expiryDate}
                                                        disabled={!hasFile}
                                                        disabledDate={disabledDateForDoc(doc)}
                                                        onChange={d => handleExpiryDateChange(d, doc.key)}
                                                    />
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            marginTop: 4,
                                                            color: 'rgba(0,0,0,.45)'
                                                        }}
                                                    >
                                                        Must be in the future
                                                        {doc.expiryMonths
                                                            ? `, within ${doc.expiryMonths} month${doc.expiryMonths > 1 ? 's' : ''
                                                            }`
                                                            : ''}
                                                    </div>
                                                </>
                                            )}
                                        </Col>
                                    </Row>
                                </Card>
                            </Col>
                        )
                    })}
                </Row>
            </Space>
        )
    }

    const ReviewStep: React.FC = () => {
        const values = form.getFieldsValue(true)
        const s = scoreColor(complianceScore)

        return (
            <Card
                title='Review Participant & Compliance'
                style={{ borderRadius: 14 }}
                bodyStyle={{ paddingTop: 12 }}
            >
                <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                        <Card size='small' style={{ borderRadius: 12 }}>
                            <Space direction='vertical' style={{ width: '100%' }}>
                                <div
                                    style={{ display: 'flex', justifyContent: 'space-between' }}
                                >
                                    <strong>Compliance Score</strong>
                                    <Badge status={s.color as any} text={s.text} />
                                </div>
                                <Progress
                                    percent={complianceScore}
                                    status={s.color as any}
                                    strokeWidth={10}
                                    showInfo
                                />
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} md={16}>
                        <Card size='small' style={{ borderRadius: 12 }}>
                            <Row gutter={[8, 8]}>
                                <Col span={12}>
                                    <strong>Owner:</strong> {values.participantName || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Email:</strong> {values.email || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Company:</strong> {values.beneficiaryName || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Sector:</strong> {values.sector || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Province:</strong> {values.province || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>City:</strong> {values.city || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Registration #:</strong>{' '}
                                    {values.registrationNumber || '-'}
                                </Col>
                                <Col span={12}>
                                    <strong>Years of Trading:</strong>{' '}
                                    {values.yearsOfTrading ?? '-'}
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>
                <Card size='small' style={{ borderRadius: 12, marginTop: 12 }}>
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='gapGroup'
                                label='Initial GAP Group'
                                rules={[
                                    { required: true, message: 'Select the initial group' }
                                ]}
                                initialValue='A'
                            >
                                <Select placeholder='Choose group'>
                                    <Select.Option value='A'>Group A</Select.Option>
                                    <Select.Option value='B'>Group B</Select.Option>
                                    <Select.Option value='C'>Group C</Select.Option>
                                    <Select.Option value='Graduated'>Graduated</Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='branchId'
                                label='Assign to Branch (optional)'
                                tooltip={
                                    programAssignedBranchId
                                        ? `Leave empty to use program’s assigned branch (${programAssignedBranchName})`
                                        : 'Optional—choose a branch if applicable'
                                }
                            >
                                <Select
                                    allowClear
                                    placeholder={
                                        programAssignedBranchId
                                            ? `Default: ${programAssignedBranchName || programAssignedBranchId
                                            }`
                                            : 'Select a branch'
                                    }
                                    showSearch
                                    optionFilterProp='children'
                                >
                                    {branches.map(b => (
                                        <Select.Option key={b.id} value={b.id}>
                                            {b.name}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>
                </Card>
            </Card>
        )
    }

    // ===== Footer nav =====

    const FooterActions: React.FC<{
        hasPrev: boolean
        hasNext: boolean
        onPrev: () => void
        onNext: () => void
        onSubmit?: () => void
        submitting?: boolean
    }> = ({ hasPrev, hasNext, onPrev, onNext, onSubmit, submitting }) => {
        return (
            <div
                style={{
                    position: 'fixed',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: FOOTER_H + 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 100,
                    pointerEvents: 'none' // let inner bar handle clicks
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: 1200,
                        margin: '0 auto',
                        padding: '8px 16px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        background: '#fff',
                        borderRadius: 999,
                        boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
                        border: '1px solid rgba(0,0,0,0.06)',
                        pointerEvents: 'auto'
                    }}
                >
                    <div>
                        {hasPrev && (
                            <Button
                                onClick={onPrev}
                                size='middle'
                                disabled={submitting}
                                icon={<LeftOutlined />}
                            >
                                Back
                            </Button>
                        )}
                    </div>
                    <div>
                        {hasNext ? (
                            <Button
                                type='primary'
                                onClick={onNext}
                                size='middle'
                                icon={<RightOutlined />}
                                disabled={submitting}
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                type='primary'
                                onClick={onSubmit}
                                loading={submitting}
                                size='middle'
                                icon={<RightOutlined />}
                                disabled={submitting}
                            >
                                Save &amp; Create Participant
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    // ===== Steps content =====

    const steps = [
        {
            title: 'SME Setup',
            content: (
                <>
                    <Divider orientation={isMobile ? 'center' : 'left'}>
                        Personal Details
                    </Divider>
                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='participantName'
                                label='Owner Name'
                                rules={[{ required: true }]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='gender'
                                label='Gender'
                                rules={[{ required: true }]}
                            >
                                <Select placeholder='Select gender' allowClear>
                                    <Select.Option value='Male'>Male</Select.Option>
                                    <Select.Option value='Female'>Female</Select.Option>
                                    <Select.Option value='Other'>Other</Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='idNumber'
                                label='ID Number'
                                rules={[
                                    { required: true, message: 'ID number is required' },
                                    {
                                        validator: (_, value) =>
                                            !value || isValidSouthAfricanID(value)
                                                ? Promise.resolve()
                                                : Promise.reject(
                                                    new Error('Enter a valid South African ID')
                                                )
                                    }
                                ]}
                                getValueFromEvent={e =>
                                    e.target.value.replace(/\D/g, '').slice(0, 13)
                                }
                            >
                                <Input
                                    inputMode='numeric'
                                    maxLength={13}
                                    placeholder='e.g. 9001015009087'
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='email'
                                label='Email'
                                rules={[
                                    { type: 'email', message: 'Enter a valid email' },
                                    { required: true, message: 'Email is required' }
                                ]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='phone'
                                label='Phone'
                                rules={[
                                    { required: true, message: 'Phone number is required' }
                                ]}
                            >
                                <Input inputMode='tel' placeholder='e.g. 082 123 4567' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Divider orientation={isMobile ? 'center' : 'left'}>
                        Company Info
                    </Divider>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='beneficiaryName'
                                label='Company Name'
                                rules={[{ required: true }]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='sector'
                                label='Sector'
                                rules={[{ required: true, message: 'Sector is required' }]}
                            >
                                <Select
                                    mode='tags'
                                    showSearch
                                    allowClear
                                    placeholder='Select or type a sector'
                                    // Display a single tag even though we're in 'tags' mode
                                    value={
                                        form.getFieldValue('sector')
                                            ? [form.getFieldValue('sector')]
                                            : []
                                    }
                                    options={sectorOptions.map(s => ({ label: s, value: s }))}
                                    onChange={vals => {
                                        const latest =
                                            Array.isArray(vals) && vals.length
                                                ? String(vals[vals.length - 1]).trim()
                                                : ''

                                        // keep the field as a single string
                                        form.setFieldsValue({ sector: latest || undefined })

                                        // if it's a new sector, append it to the dropdown options
                                        if (
                                            latest &&
                                            !sectorOptions.some(
                                                s => s.toLowerCase() === latest.toLowerCase()
                                            )
                                        ) {
                                            setSectorOptions(prev => [...prev, latest])
                                        }
                                    }}
                                    // Better search across labels
                                    optionFilterProp='label'
                                    // Don’t split on commas automatically
                                    tokenSeparators={[]}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24}>
                            <Form.Item
                                name='natureOfBusiness'
                                label='Nature of Business (What the business offers)'
                            >
                                <Input.TextArea autoSize={{ minRows: 3 }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24} sm={12}>
                            <Form.Item name='beeLevel' label='B-BBEE Level'>
                                <Select placeholder='Select level' allowClear>
                                    {[1, 2, 3, 4].map(level => (
                                        <Select.Option key={level} value={level}>
                                            Level {level}
                                        </Select.Option>
                                    ))}
                                    <Select.Option key='5plus' value='5+'>
                                        Level 5 and above
                                    </Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={4}>
                            <Form.Item name='youthOwnedPercent' label='Youth-Owned %'>
                                <InputNumber
                                    addonAfter='%'
                                    min={0}
                                    max={100}
                                    style={{ width: '100%' }}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={4}>
                            <Form.Item name='femaleOwnedPercent' label='Female-Owned %'>
                                <InputNumber
                                    addonAfter='%'
                                    min={0}
                                    max={100}
                                    style={{ width: '100%' }}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} sm={4}>
                            <Form.Item name='blackOwnedPercent' label='Black-Owned %'>
                                <InputNumber
                                    addonAfter='%'
                                    min={0}
                                    max={100}
                                    style={{ width: '100%' }}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='dateOfRegistration'
                                label='Date of Registration'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Registration date is required'
                                    },
                                    {
                                        validator: (_, value) =>
                                            !value || value.isAfter(dayjs(), 'day')
                                                ? Promise.reject(
                                                    new Error(
                                                        'Registration date cannot be in the future'
                                                    )
                                                )
                                                : Promise.resolve()
                                    }
                                ]}
                            >
                                <DatePicker
                                    style={{ width: '100%' }}
                                    inputReadOnly={isMobile}
                                    disabledDate={current =>
                                        current && current > dayjs().endOf('day')
                                    }
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='yearsOfTrading'
                                label='Years of Trading'
                                rules={[
                                    { required: true, message: 'Years of trading is required' },
                                    {
                                        validator: (_, v) =>
                                            v === null || v === undefined || v === ''
                                                ? Promise.reject(
                                                    new Error('Years of trading is required')
                                                )
                                                : v < 0
                                                    ? Promise.reject(new Error('Must be 0 or greater'))
                                                    : Promise.resolve()
                                    }
                                ]}
                            >
                                <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='registrationNumber'
                                label='Registration Number'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Registration number is required'
                                    },
                                    {
                                        validator: (_, value) =>
                                            !value || isValidZARegistration(value)
                                                ? Promise.resolve()
                                                : Promise.reject(
                                                    new Error('Use a valid SA registration')
                                                )
                                    }
                                ]}
                                getValueFromEvent={e => e.target.value.toUpperCase()}
                            >
                                <Input placeholder='e.g. 2015/123456/07' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Divider orientation={isMobile ? 'center' : 'left'}>Location</Divider>

                    <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]}>
                        <Col xs={24}>
                            <Form.Item
                                name='businessAddress'
                                label='Business Address'
                                rules={[
                                    { required: true, message: 'Business address is required' }
                                ]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='city'
                                label='City'
                                rules={[{ required: true, message: 'City is required' }]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='postalCode' label='Postal Code'>
                                <Input inputMode='numeric' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item
                                name='province'
                                label='Province'
                                rules={[{ required: true, message: 'Province is required' }]}
                            >
                                <Select showSearch placeholder='Select province' allowClear>
                                    {provinces.map(p => (
                                        <Select.Option key={p} value={p}>
                                            {p}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='hub' label='Host Community'>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                            <Form.Item name='location' label='Location Type'>
                                <Select placeholder='Select type' allowClear>
                                    <Select.Option value='Urban'>Urban</Select.Option>
                                    <Select.Option value='Rural'>Rural</Select.Option>
                                    <Select.Option value='Township'>Township</Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Divider
                        orientation={isMobile ? 'center' : 'left'}
                        style={{ marginTop: 12 }}
                    >
                        📈 Headcount &amp; Revenue
                    </Divider>

                    <Title level={5} style={{ marginTop: 0 }}>
                        Monthly Data
                    </Title>
                    {last3Months.map(month => (
                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]} key={month.key}>
                            <Col xs={24} md={8}>
                                <Form.Item
                                    name={`revenue_${month.key}`}
                                    label={`Revenue (${month.label})`}
                                >
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        inputMode='decimal'
                                        formatter={v =>
                                            `R ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                                        }
                                        parser={v => Number((v || '').replace(/R\s?|(,*)/g, ''))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                                <Form.Item
                                    name={`permHeadcount_${month.key}`}
                                    label='Permanent Staff'
                                >
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                                <Form.Item
                                    name={`tempHeadcount_${month.key}`}
                                    label='Temporary Staff'
                                >
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    ))}

                    <Title level={5} style={{ marginTop: 8 }}>
                        Annual Data
                    </Title>
                    {last2Years.map(year => (
                        <Row gutter={[isMobile ? 8 : 16, isMobile ? 8 : 16]} key={year}>
                            <Col xs={24} md={8}>
                                <Form.Item name={`revenue_${year}`} label={`Revenue (${year})`}>
                                    <InputNumber
                                        style={{ width: '100%' }}
                                        inputMode='decimal'
                                        formatter={v =>
                                            `R ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                                        }
                                        parser={v => Number((v || '').replace(/R\s?|(,*)/g, ''))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                                <Form.Item
                                    name={`permHeadcount_${year}`}
                                    label='Permanent Staff'
                                >
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={8}>
                                <Form.Item
                                    name={`tempHeadcount_${year}`}
                                    label='Temporary Staff'
                                >
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    ))}
                </>
            )
        },
        {
            title: 'Documents Hub',
            content: (
                <Space direction='vertical' style={{ width: '100%' }}>
                    <Card
                        style={{
                            background: 'linear-gradient(90deg,#eef4ff, #f9fbff)',
                            marginBottom: 10
                        }}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <FileOutlined />
                                <Title level={4} style={{ margin: 0 }}>
                                    Compliance &amp; Program Documents
                                </Title>
                            </div>

                            {programName && (
                                <div
                                    style={{
                                        fontSize: 12,
                                        opacity: 0.8,
                                        marginTop: 4
                                    }}
                                >
                                    Required for program: <strong>{programName}</strong>
                                </div>
                            )}

                            <div
                                style={{
                                    fontSize: 12,
                                    opacity: 0.85,
                                    marginTop: 2
                                }}
                            >
                                Please upload:
                                <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                                    <li>
                                        <strong>Application documents</strong> – compulsory for
                                        onboarding and compliance.
                                    </li>
                                    <li>
                                        <strong>Gap Analysis supporting documents</strong> – to back
                                        up your GAP responses.
                                    </li>
                                    <li>
                                        <strong>Pre-Incubation documents</strong> – upload now if
                                        available to speed up pre-inc checks.
                                    </li>
                                </ul>
                            </div>

                            <div
                                style={{
                                    fontSize: 12,
                                    opacity: 0.8,
                                    marginTop: 4,
                                    display: 'flex',
                                    gap: 12,
                                    flexWrap: 'wrap'
                                }}
                            >
                                <span>
                                    Application:{' '}
                                    <strong>
                                        {
                                            documentFields.filter(d => d.group === 'application')
                                                .length
                                        }
                                    </strong>{' '}
                                    docs
                                </span>
                                <span>
                                    GAP:{' '}
                                    <strong>
                                        {documentFields.filter(d => d.group === 'gap').length}
                                    </strong>{' '}
                                    docs
                                </span>
                                <span>
                                    Pre-Inc:{' '}
                                    <strong>
                                        {documentFields.filter(d => d.group === 'preinc').length}
                                    </strong>{' '}
                                    docs
                                </span>
                            </div>
                        </div>
                    </Card>

                    <DocumentsList
                        title='Application Compliance Documents'
                        items={documentFields.filter(d => d.group === 'application')}
                    />
                    <DocumentsList
                        title='Gap Analysis Supporting Documents'
                        items={documentFields.filter(d => d.group === 'gap')}
                    />
                    <DocumentsList
                        title='Pre-Incubation Documents'
                        items={documentFields.filter(d => d.group === 'preinc')}
                    />
                </Space>
            )
        },
        {
            title: 'Interventions',
            content: (
                <>
                    <Card
                        style={{
                            background: 'linear-gradient(90deg,#eef4ff, #f9fbff)',
                            marginBottom: 10
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PicCenterOutlined />
                            <Title level={4} style={{ margin: 0 }}>
                                Select Required Interventions
                            </Title>
                        </div>
                    </Card>
                    <Collapse
                        activeKey={openPanels}
                        onChange={keys =>
                            setOpenPanels(
                                Array.isArray(keys) ? (keys as string[]) : [keys as string]
                            )
                        }
                        collapsible='icon'
                        destroyInactivePanel={false}
                    >
                        {interventionGroups.map(group => (
                            <Panel header={group.area} key={group.area}>
                                <div onClick={e => e.stopPropagation()}>
                                    <Checkbox.Group
                                        value={interventionSelections[group.area] || []}
                                        onChange={val => {
                                            const currentSelection = val as string[]
                                            setInterventionSelections(prev => ({
                                                ...prev,
                                                [group.area]: currentSelection
                                            }))
                                        }}
                                    >
                                        <Space direction='vertical'>
                                            {group.interventions.map((i: any) => (
                                                <Checkbox key={i.id} value={i.id}>
                                                    {i.title}
                                                </Checkbox>
                                            ))}
                                        </Space>
                                    </Checkbox.Group>
                                </div>
                            </Panel>
                        ))}
                    </Collapse>
                </>
            )
        },
        {
            title: 'Review & Save',
            content: <ReviewStep />
        }
    ]

    // ===== Navigation handlers =====

    const next = async () => {
        if (current === 0) {
            try {
                await form.validateFields()
            } catch {
                return
            }
        }

        if (current === 1) {
            for (const d of documentFields.filter(d => d.group === 'application')) {
                // MOA is OPTIONAL – skip validation
                if (isMoaDoc(d.title)) continue

                if (!d.file) {
                    message.error(`Please upload the required document: ${d.title}`)
                    return
                }
                if (d.requiresExpiry && !d.expiryDate) {
                    message.error(`Please set an expiry date for ${d.title}.`)
                    return
                }
                if (!d.issueDate) {
                    message.error(`Please provide an issue date for ${d.title}.`)
                    return
                }
                const today = dayjs().startOf('day')
                if (d.expiryDate && d.expiryDate.isBefore(today)) {
                    message.error(`${d.title}: expiry date cannot be in the past.`)
                    return
                }
            }
        }

        setCurrent(c => c + 1)
    }

    const prev = () => {
        setCurrent(c => Math.max(c - 1, 0))
    }

    // ===== Final submit: create participants + applications (accepted) =====
    const handleSubmit = async () => {
        try {
            setUploading(true)
            await form.validateFields()

            // ===== 1) Collect + normalize form values
            const rawValues = form.getFieldsValue(true)
            const values = trimStringsDeep(rawValues)

            // Gap group (from last step card) + optional branch selection
            const selectedGapGroup = (values.gapGroup || 'A') as Group
            const chosenBranchId: string | null = values.branchId || null

            // Resolve final branch (fallback to program assigned branch)
            const resolvedBranchId: string | null =
                chosenBranchId || programAssignedBranchId || null
            const resolvedBranchName: string | null =
                branches.find(b => b.id === resolvedBranchId)?.name ??
                programAssignedBranchName ??
                null

            // Coerce date fields to Firestore Timestamp
            const regTs = toFirestoreTimestamp(values.dateOfRegistration)
            if (regTs) values.dateOfRegistration = regTs
            else delete values.dateOfRegistration

            // ===== 2) Split monthly/annual revenue & headcount from dynamic keys
            const monthly: Record<string, any> = {}
            const annual: Record<string, any> = {}
            Object.entries(values).forEach(([key, value]) => {
                if (key.startsWith('revenue_')) {
                    const suffix = key.replace('revenue_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            revenue: value ?? 0
                        }
                    } else {
                        annual[suffix] = { ...(annual[suffix] || {}), revenue: value ?? 0 }
                    }
                }
                if (key.startsWith('permHeadcount_')) {
                    const suffix = key.replace('permHeadcount_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            permanent: value ?? 0
                        }
                    } else {
                        annual[suffix] = {
                            ...(annual[suffix] || {}),
                            permanent: value ?? 0
                        }
                    }
                }
                if (key.startsWith('tempHeadcount_')) {
                    const suffix = key.replace('tempHeadcount_', '')
                    if (/^\d{4}-\d{2}$/.test(suffix)) {
                        monthly[suffix] = {
                            ...(monthly[suffix] || {}),
                            temporary: value ?? 0
                        }
                    } else {
                        annual[suffix] = {
                            ...(annual[suffix] || {}),
                            temporary: value ?? 0
                        }
                    }
                }
            })

            const {
                participantName,
                email,
                beneficiaryName,
                gender,
                idNumber,
                phone,
                sector,
                natureOfBusiness,
                beeLevel,
                youthOwnedPercent,
                femaleOwnedPercent,
                blackOwnedPercent,
                dateOfRegistration,
                yearsOfTrading,
                registrationNumber,
                businessAddress,
                city,
                postalCode,
                province,
                hub,
                location
            } = values

            // ===== 3) Upload files and compute compliance
            const uploadedDocs = await uploadAllDocuments()
            const complianceScoreCalc = calculateCompliance(uploadedDocs)
            const completedKeys = uploadedDocs
                .filter(d => !!d.url && d.status === 'valid')
                .map(d => d.key)

            const complianceSummary = {
                required: allProgramRequirements.map((r: any) => r.key),
                completed: completedKeys
            }

            // ===== 4) Resolve selected interventions
            const selectedRequired = Object.values(interventionSelections)
                .flat()
                .map((id: string) => {
                    const group = interventionGroups.find((g: any) =>
                        g.interventions.some((i: any) => i.id === id)
                    )
                    const match = group?.interventions.find((i: any) => i.id === id)
                    return match
                        ? { id: match.id, title: match.title, area: group?.area }
                        : null
                })
                .filter(Boolean) as Array<{ id: string; title: string; area?: string }>

            // ===== 5) Create participant
            const participantBase = {
                participantName,
                email,
                beneficiaryName,
                gender,
                idNumber,
                phone,
                sector,
                natureOfBusiness,
                beeLevel,
                youthOwnedPercent,
                femaleOwnedPercent,
                blackOwnedPercent,
                dateOfRegistration,
                yearsOfTrading,
                registrationNumber,
                businessAddress,
                city,
                postalCode,
                province,
                hub,
                location,
                programId: programId || null,
                programName: programName || null,
                branchId: resolvedBranchId || null,
                branchName: resolvedBranchName || null,
                headcountHistory: {
                    monthly: Object.fromEntries(
                        Object.entries(monthly).map(([k, v]: any) => [
                            k,
                            {
                                permanent: v.permanent ?? 0,
                                temporary: v.temporary ?? 0,
                                total: (v.permanent ?? 0) + (v.temporary ?? 0)
                            }
                        ])
                    ),
                    annual: Object.fromEntries(
                        Object.entries(annual).map(([k, v]: any) => [
                            k,
                            {
                                permanent: v.permanent ?? 0,
                                temporary: v.temporary ?? 0,
                                total: (v.permanent ?? 0) + (v.temporary ?? 0)
                            }
                        ])
                    )
                },
                revenueHistory: {
                    monthly: Object.fromEntries(
                        Object.entries(monthly).map(([k, v]: any) => [k, v.revenue ?? 0])
                    ),
                    annual: Object.fromEntries(
                        Object.entries(annual).map(([k, v]: any) => [k, v.revenue ?? 0])
                    )
                },
                interventions: {
                    required: selectedRequired,
                    assigned: [],
                    completed: [],
                    participationRate: 0
                },
                complianceScore: complianceScoreCalc,
                complianceDocuments: uploadedDocs,
                complianceSummary,
                setup: true,
                createdAt: serverTimestamp(),
                createdAtISO: new Date().toISOString(),
                createdMonth: dayjs().format('YYYY-MM'),
                createdYear: dayjs().format('YYYY'),
                updatedAt: serverTimestamp()
            }

            const participantDataToSave = pruneUndefinedDeep(participantBase)
            const participantRef = await addDoc(
                collection(db, 'participants'),
                participantDataToSave
            )

            // ===== 6) Create accepted application (with gap group + history + branch)
            const appRef = await addDoc(
                collection(db, 'applications'),
                pruneUndefinedDeep({
                    createdAt: serverTimestamp(),
                    createdAtISO: new Date().toISOString(),
                    createdMonth: dayjs().format('YYYY-MM'),
                    createdYear: dayjs().format('YYYY'),
                    updatedAt: serverTimestamp(),
                    participantId: participantRef.id,
                    programName,
                    programId,
                    branchId: resolvedBranchId,
                    branchName: resolvedBranchName,
                    applicationStatus: 'accepted',
                    submittedAt: new Date().toISOString(),
                    beneficiaryName,
                    gender,
                    ageGroup: null,
                    stage: null,
                    province,
                    hub,
                    email,
                    motivation: null,
                    challenges: null,
                    complianceScore: complianceScoreCalc,
                    complianceDocuments: uploadedDocs,
                    complianceSummary,
                    interventions: {
                        required: selectedRequired,
                        assigned: [],
                        completed: [],
                        participationRate: 0
                    },
                    profile: null,
                    gapGroup: selectedGapGroup,
                    groupHistory: [initialGroupEntry(selectedGapGroup)],
                    manuallyCreated: true
                })
            )

            // ===== 7) Write compliance subdocs under /applications/{appId}/complianceDocuments
            await upsertComplianceSubdocs(appRef, uploadedDocs, {
                programId,
                programName,
                uploadedByEmail: email
            })

            // ===== 8) Call your Cloud Function: createPlatformUser (role=incubatee)
            try {
                const idToken = await auth.currentUser?.getIdToken()
                if (!idToken) throw new Error('Missing ID token')

                const functionURL =
                    'https://us-central1-lph-smart-inc.cloudfunctions.net/createPlatformUser'

                await fetch(functionURL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        // Required by the function:
                        email,
                        role: 'incubatee',
                        name: participantName || '',
                        phone: phone || null,
                        mustRegister: true,
                        allowExisting: true, // do not fail if the email already exists
                        sendEmail: true
                    })
                })
            } catch (e) {
                // Don’t block onboarding if the invite fails
                console.warn('createPlatformUser failed (non-blocking):', e)
            }

            message.success('Participant, application, and incubatee user created.')
            navigate('/participants')
        } catch (err: any) {
            console.error(err)
            message.error('Failed to save participant.')
        } finally {
            setUploading(false)
        }
    }

    const ContentWithResponsiveSteps: React.FC = () => {
        const screens = Grid.useBreakpoint()
        const isMobile = !!screens.xs && !screens.sm

        return (
            <div
                style={{
                    width: '100%',
                    padding: '0 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0
                }}
            >
                {/* Hide labels on steps – just indicators */}
                {!isMobile && (
                    <Steps
                        current={current}
                        style={{ margin: 8 }}
                        items={steps.map(() => ({
                            title: '' // no label text
                        }))}
                    />
                )}

                <Form
                    key={current}
                    layout='vertical'
                    form={form}
                    style={{ flex: 1, minHeight: 0 }}
                >
                    <div
                        style={{
                            height: '100%',
                            minHeight: 0,
                            overflow: 'auto',
                            paddingRight: 6,
                            paddingBottom: FOOTER_H + 12
                        }}
                    >
                        {steps[current].content}
                    </div>
                </Form>
            </div>
        )
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                padding: 24,
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            <Helmet>
                <title>New Participant | Smart Incubation Platform</title>
            </Helmet>

            {uploading ? (
                <LoadingOverlay tip='Saving Participant Details' />
            ) : (
                <>
                    <DashboardHeaderCard
                        title='Add New Participant'
                        subtitle={
                            programName && (
                                <div style={{ opacity: 0.7 }}>Program: {programName}</div>
                            )
                        }
                        extraRight={
                            <Button
                                type='default'
                                onClick={() => navigate(-1)}
                                style={{ marginBottom: 16 }}
                            >
                                ← Back to Participants
                            </Button>
                        }
                    />

                    <div
                        style={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            justifyContent: 'center',
                            pointerEvents: uploading ? 'none' : 'auto',
                            filter: uploading ? 'blur(1px)' : 'none'
                        }}
                    >
                        <ContentWithResponsiveSteps />
                    </div>

                    <FooterActions
                        hasPrev={current > 0}
                        hasNext={current < steps.length - 1}
                        onPrev={prev}
                        onNext={next}
                        onSubmit={handleSubmit}
                        submitting={uploading}
                    />
                </>
            )}
        </div>
    )
}

export default ParticipantOnboardingForm
