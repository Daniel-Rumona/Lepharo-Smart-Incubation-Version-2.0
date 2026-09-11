import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Table,
    Modal,
    Button,
    Typography,
    message,
    Space,
    Card,
    Row,
    Col,
    Select,
    Alert,
    Timeline,
    Form,
    Input,
    Spin,
    Tooltip,
    Tag,
    Empty,
    Pagination
} from 'antd'
import {
    collection,
    getDocs,
    query,
    where,
    updateDoc,
    doc,
    getDoc,
    limit,
    QueryConstraint
} from 'firebase/firestore'
import dayjs from 'dayjs'
import {
    FileDoneOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    HistoryOutlined,
    ClockCircleOutlined,
    SafetyCertificateOutlined,
    QuestionCircleOutlined,
    InfoCircleOutlined
} from '@ant-design/icons'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { Helmet } from 'react-helmet'
import { roundBtn } from '@/components/shared/StyledButton'
import {
    hasMovPoeSync
} from '@/services/poeService'
import { MovDocumentView, MovSigner } from '@/components/movs/MovDocumentView'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import { filterMovRecords } from '@/utils/reportVisibility'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { workflowQueryService } from '@/services/workflowQueryService'

const { Title, Text } = Typography
const { Option } = Select
const POE_PAGE_SIZE = 4

const stepLabels: Record<string, string> = {
    hod_submission: 'HOD Approval',
    validation: 'M&E Validation',
    final_confirmation: 'Center Coordinator Confirmation'
}

type MovDoc = {
    id: string
    facilitatorId?: string
    facilitatorName?: string
    facilitatorEmail?: string
    consultantId?: string
    consultantName?: string
    consultantEmail?: string
    assigneeId?: string
    assigneeName?: string
    assigneeEmail?: string
    facilitatorSignatureUrl?: string
    facilitatorDigitalSignature?: string
    signatureURL?: string
    digitalSignature?: string
    beneficiaryId?: string
    smmeId?: string
    smmeCompanyName?: string
    smmeName?: string
    smmeSignatureUrl?: string
    smmeDigitalSignature?: string
    interventionId?: string
    interventionTitle?: string
    assignedInterventionId?: string
    subInterventionId?: string | null
    subInterventionTitle?: string | null
    interventionDate?: any
    departmentName?: string
    poeUrls?: string[]
    participantId?: string
    applicationId?: string
    programId?: string
    preIncubationAgreement?: boolean
    preIncubationAgreementMeta?: any
}

type InhouseQueryDoc = {
    id: string
    consolidatedMovId: string
    queryType?: string
    queryMessage?: string
    status?: 'open' | 'resolved' | string
    createdAt?: any
    updatedAt?: any
    resolutionNotes?: string
    uploadedFileUrl?: string | null
    raisedByUser?: string | null
    raisedByDept?: string | null
    raisedByRole?: string | null
    raisedByName?: string | null
    raisedByEmail?: string | null
    receivedByUser?: string | null
    receivedByName?: string | null
    receivedByEmail?: string | null
    receivedByRole?: string | null
    receivedAt?: any
    repliedByUser?: string | null
    repliedByName?: string | null
    repliedByEmail?: string | null
    repliedByRole?: string | null
    repliedAt?: any
    resolvedAt?: any
    targetType?: 'pack' | 'poe'
    movRowId?: string | null
    participantId?: string | null
    interventionId?: string | null
    poeUrl?: string | null
    departmentName?: string | null
}

type PoeValidation = {
    status: 'validated'
    validatedAt: any
    validatorUserId?: string | null
    validatorEmail?: string | null
    validatorName?: string | null
    validatorRole?: string | null
    poeUrl?: string | null
    poeUrls?: string[]
}

const toJsDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const formatDateTime = (v: any) => {
    const d = toJsDate(v)
    return d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—'
}

const formatTurnaround = (start: any, end: any) => {
    const from = toJsDate(start)
    const to = toJsDate(end)
    if (!from || !to) return '—'

    const totalMinutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000))
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60

    if (days) return `${days}d ${hours}h`
    if (hours) return `${hours}h ${minutes}m`
    return `${minutes}m`
}

const isPlaceholder = (v: any) => {
    const s = String(v ?? '').trim().toLowerCase()
    return !s || s === '-' || s === '—' || s === 'n/a' || s === 'na' || s === 'null' || s === 'undefined'
}

const normalizeImageUrl = (v: any): string => {
    if (isPlaceholder(v)) return ''
    const s = String(v).trim()
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:image/')) return s
    return ''
}

const signatureIssueTooltip = (params: { label: string }) => params.label

const isMEDept = (dept?: any) => {
    const s = String(dept || '').trim().toLowerCase()
    return s.startsWith('m&e') || s.startsWith('m & e')
}

const isOpenStatus = (s?: any) => String(s || '').toLowerCase() === 'open'
const isResolvedStatus = (s?: any) => String(s || '').toLowerCase() === 'resolved'
const modalFooterButtonStyle: React.CSSProperties = { ...roundBtn, flex: 1, marginInlineStart: 0 }

const sortMovRows = <T extends Record<string, any>>(rows: T[]) => [...rows].sort((a, b) => {
    const toMillis = (value: any) => typeof value?.toDate === 'function' ? value.toDate().getTime() : typeof value?.seconds === 'number' ? value.seconds * 1000 : new Date(value || 0).getTime()
    const date = (row: any) => row.smmeAcceptedAt || row.smmeSignedAt || row.periodEnd || row.completedAt || row.updatedAt
    const dateDiff = toMillis(date(b)) - toMillis(date(a))
    if (dateDiff) return dateDiff
    return String(a.smmeCompanyName || a.smmeName || '').localeCompare(String(b.smmeCompanyName || b.smmeName || ''), undefined, { sensitivity: 'base' })
})

const sortPackRows = <T extends Record<string, any>>(rows: T[]) => [...rows].sort((a, b) => {
    const monthDiff = String(b.month || '').localeCompare(String(a.month || ''))
    if (monthDiff) return monthDiff
    return String(a.departmentName || '').localeCompare(String(b.departmentName || ''), undefined, { sensitivity: 'base' })
})

const hydrateMovPeople = async (
    base: MovDoc,
    ctx: { programId?: string | null; isAllPrograms?: boolean }
): Promise<MovDoc> => {
    const out: MovDoc = { ...base }

    if (!out.facilitatorName) {
        if (out.facilitatorId) {
            const cDoc = await getDoc(doc(db, 'consultants', out.facilitatorId))
            if (cDoc.exists()) {
                const c = cDoc.data() as any
                out.facilitatorName = out.facilitatorName || c.name || c.displayName
            }
        }
    }

    const pId = out.beneficiaryId || out.smmeId

    if (pId && (!out.smmeCompanyName || !out.smmeName)) {
        const pDoc = await getDoc(doc(db, 'participants', pId))
        if (pDoc.exists()) {
            const p = pDoc.data() as any
            out.smmeCompanyName = out.smmeCompanyName || p.companyName || p.businessName || ''
            out.smmeName = out.smmeName || p.name || p.ownerName || ''
        }
    }


    if (!out.subInterventionTitle) {
        try {
            let assignment: any = null
            if (out.assignedInterventionId) {
                const assignmentSnap = await getDoc(
                    doc(db, 'assignedInterventions', out.assignedInterventionId)
                )
                if (assignmentSnap.exists()) assignment = assignmentSnap.data()
            } else if (out.interventionId && pId) {
                const constraints: QueryConstraint[] = [
                    where('interventionId', '==', out.interventionId),
                    where('participantId', '==', pId)
                ]
                if (!ctx.isAllPrograms && ctx.programId) {
                    constraints.push(where('programId', '==', ctx.programId))
                }
                constraints.push(limit(1))

                const assignmentSnap = await getDocs(
                    query(collection(db, 'assignedInterventions'), ...constraints)
                )
                if (!assignmentSnap.empty) assignment = assignmentSnap.docs[0].data()
            }

            out.subInterventionId = out.subInterventionId || assignment?.subInterventionId || null
            out.subInterventionTitle =
                out.subInterventionTitle ||
                assignment?.subInterventionTitle ||
                assignment?.subInterventionName ||
                null
        } catch (e) {
            console.error('Failed to hydrate sub-intervention for MOV', base.id, e)
        }
    }

    try {
        const latestUrls = await getLatestPoeUrlsForMovRow(out, ctx)

        out.poeUrls = latestUrls
    } catch (e) {
        console.error('Failed to hydrate latest POEs for MOV', base.id, e)
    }

    return out
}

const uniq = (arr: string[]) =>
    Array.from(
        new Set(
            arr
                .map(v => String(v || '').trim())
                .filter(Boolean)
        )
    )

const normalizeText = (value: any) =>
    String(value ?? '').trim().toLowerCase()

const isPreIncMov = (mov?: any) => {
    if (!mov) return false

    const title = normalizeText(
        mov.interventionTitle ||
        mov.snapshot?.interventionTitle ||
        mov.subInterventionTitle
    )

    return (
        mov.preIncubationAgreement === true ||
        !!mov.preIncubationAgreementMeta ||
        title.includes('onboarding') ||
        title.includes('pre-incubation') ||
        title.includes('pre incubation')
    )
}

const preIncUrlFromMeta = (meta?: any) =>
    String(
        meta?.signedFileURL ||
        meta?.signedFileUrl ||
        meta?.downloadURL ||
        meta?.fileURL ||
        meta?.fileUrl ||
        meta?.pdfUrl ||
        meta?.pdfURL ||
        meta?.url ||
        ''
    ).trim()

const getLatestPoeUrlsForMovRow = async (
    row: MovDoc,
    ctx: {
        programId?: string | null
        isAllPrograms?: boolean
    }
): Promise<string[]> => {
    const urls: string[] = []

    const participantId =
        (row as any).participantId ||
        row.beneficiaryId ||
        row.smmeId ||
        null

    const assignedInterventionId =
        (row as any).assignedInterventionId ||
        (row as any).assignedId ||
        (row as any).interventionKey ||
        (row as any).__assignedInterventionId ||
        null

    const interventionId =
        row.interventionId ||
        (row as any).interventionKey ||
        null

    const candidateKeys = uniq([
        assignedInterventionId,
        (row as any).interventionKey,
        (row as any).groupAssignmentId,
        (row as any).groupKey,
        (row as any).groupId
    ])

    const mergeUrls = (data: any) => {
        const resources = Array.isArray(data?.resources) ? data.resources : []
        urls.push(...resources.map((resource: any) => resource?.link).filter(Boolean))
    }

    if (isPreIncMov(row)) {
        const preIncUrl = preIncUrlFromMeta((row as any).preIncubationAgreementMeta)
        if (preIncUrl) urls.push(preIncUrl)
    }

    // Canonical assignment evidence source.
    if (!urls.length && assignedInterventionId) {
        const assignedSnap = await getDoc(doc(db, 'assignedInterventions', assignedInterventionId))

        if (assignedSnap.exists()) {
            mergeUrls({
                id: assignedSnap.id,
                ...assignedSnap.data()
            })
        }
    }

    return uniq(urls)
}

const fetchOpsSignature = async (email?: string) => {
    if (!email) return null
    const snap = await getDocs(
        query(collection(db, 'users'), where('email', '==', email.toLowerCase()), limit(1))
    )
    if (snap.empty) return null
    const d = snap.docs[0].data() as any
    return {
        name: d.name || d.displayName || '',
        signatureURL: d.signatureURL || d.signatureUrl || '',
        digitalSignature: d.digitalSignature || ''
    }
}

const cardShellStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 12,
    border: '1px solid #d6e4ff'
}

const MonitoringMOVApprovals: React.FC = () => {
    const { user } = useFullIdentity()
    const { programId, activeProgramId, isAllPrograms } = useActiveProgramId()

    const [listLoading, setListLoading] = useState(false)
    const [openingPackId, setOpeningPackId] = useState<string | null>(null)
    const [openingMovId, setOpeningMovId] = useState<string | null>(null)
    const [showAllTimeline, setShowAllTimeline] = useState(false)

    const [movs, setMovs] = useState<any[]>([])
    const [filtered, setFiltered] = useState<any[]>([])

    const [singleMovOpen, setSingleMovOpen] = useState(false)
    const [selectedSingleMov, setSelectedSingleMov] = useState<MovDoc | null>(null)
    const [singleMovSigning, setSingleMovSigning] = useState(false)

    const [selectedDept, setSelectedDept] = useState<string>('all')
    const [selectedMonth, setSelectedMonth] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'validated' | 'queries'>('all')
    const hasAppliedDefaultMonthRef = useRef(false)

    const [selected, setSelected] = useState<any | null>(null)
    const [modalVisible, setModalVisible] = useState(false)

    const [confirmOnBehalfOpen, setConfirmOnBehalfOpen] = useState(false)
    const [confirmingOnBehalf, setConfirmingOnBehalf] = useState(false)
    const [confirmOnBehalfForm] = Form.useForm()

    const [timelineModalVisible, setTimelineModalVisible] = useState(false)

    const [queryModalOpen, setQueryModalOpen] = useState(false)
    const [querySubmitting, setQuerySubmitting] = useState(false)
    const [queryForm] = Form.useForm()

    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [queriesLoading, setQueriesLoading] = useState(false)
    const [packQueries, setPackQueries] = useState<InhouseQueryDoc[]>([])
    // Query modal stays M&E-scoped; the timeline is a whole-pack audit trail.
    const [timelineQueries, setTimelineQueries] = useState<InhouseQueryDoc[]>([])

    const [resolveModalOpen, setResolveModalOpen] = useState(false)
    const [resolving, setResolving] = useState(false)
    const [resolveForm] = Form.useForm()
    const [selectedQuery, setSelectedQuery] = useState<InhouseQueryDoc | null>(null)

    const [selectedPoeRow, setSelectedPoeRow] = useState<MovDoc | null>(null)

    const [preIncViewer, setPreIncViewer] = useState<{
        participantId: string
        applicationId: string
        signedMeta: any
    } | null>(null)
    const [preIncViewerLoadingId, setPreIncViewerLoadingId] = useState<string | null>(null)

    const [poeViewerOpen, setPoeViewerOpen] = useState(false)
    const [poeViewerRow, setPoeViewerRow] = useState<MovDoc | null>(null)
    const [poeViewerUrls, setPoeViewerUrls] = useState<string[]>([])
    const [poeViewerLoading, setPoeViewerLoading] = useState(false)
    const [poeViewerPage, setPoeViewerPage] = useState(1)

    const myUid = user?.uid || user?.id || null
    const myEmail = (user?.email || '').toLowerCase()
    const myRole = String(user?.role || '').toLowerCase()

    const openPreIncPoe = async (row: MovDoc) => {
        const rowId = String(row?.id || '')
        setPreIncViewerLoadingId(rowId)

        try {
            let source: any = { ...row }

            if (rowId) {
                try {
                    const movSnap = await getDoc(doc(db, 'movDocuments', rowId))
                    if (movSnap.exists()) {
                        source = {
                            ...source,
                            ...(movSnap.data() as any),
                            id: movSnap.id
                        }
                    }
                } catch (error) {
                    console.warn('Could not refresh Pre-Inc MOV before opening POE', {
                        movId: rowId,
                        error
                    })
                }
            }

            const participantId = String(
                source.participantId ||
                source.beneficiaryId ||
                source.smmeId ||
                ''
            ).trim()

            if (!participantId) {
                message.error('This Pre-Inc MOV is missing its SMME reference.')
                return
            }

            let applicationId = String(source.applicationId || '').trim()
            let signedMeta = source.preIncubationAgreementMeta || null

            if (!applicationId || !signedMeta) {
                const applicationConstraints: QueryConstraint[] = [
                    where('participantId', '==', participantId)
                ]

                const sourceProgramId = String(
                    source.programId ||
                    activeProgramId ||
                    ''
                ).trim()

                if (sourceProgramId) {
                    applicationConstraints.push(where('programId', '==', sourceProgramId))
                }

                applicationConstraints.push(limit(1))

                const applicationSnap = await getDocs(
                    query(collection(db, 'applications'), ...applicationConstraints)
                )

                if (!applicationSnap.empty) {
                    const applicationDoc = applicationSnap.docs[0]
                    const application = applicationDoc.data() as any

                    applicationId = applicationId || applicationDoc.id
                    signedMeta =
                        signedMeta ||
                        application?.signedAgreements?.['pre-incubation-contract'] ||
                        null

                    if (!signedMeta) {
                        try {
                            const complianceSnap = await getDocs(
                                collection(
                                    db,
                                    'applications',
                                    applicationDoc.id,
                                    'complianceDocuments'
                                )
                            )

                            const preIncDocument = complianceSnap.docs
                                .map(item => ({ id: item.id, ...(item.data() as any) }))
                                .find(item => {
                                    const descriptor = normalizeText(
                                        item.slug ||
                                        item.docType ||
                                        item.type ||
                                        item.title ||
                                        item.id
                                    )
                                    return descriptor.includes('pre') &&
                                        descriptor.includes('incubation')
                                })

                            if (preIncDocument) signedMeta = preIncDocument
                        } catch (error) {
                            console.warn('Could not load manual Pre-Inc agreement metadata', {
                                applicationId: applicationDoc.id,
                                error
                            })
                        }
                    }
                }
            }

            if (!applicationId) {
                message.error('The application linked to this Pre-Inc MOV could not be resolved.')
                return
            }

            setPreIncViewer({
                participantId,
                applicationId,
                signedMeta: signedMeta || source.preIncubationAgreementMeta || {}
            })
        } catch (error) {
            console.error('Failed to open Pre-Inc POE', error)
            message.error('The Pre-Incubation Agreement could not be opened.')
        } finally {
            setPreIncViewerLoadingId(null)
        }
    }

    const openPoeViewer = async (row: MovDoc) => {
        setPoeViewerRow(row)
        setPoeViewerPage(1)
        setPoeViewerOpen(true)
        setPoeViewerLoading(true)

        try {
            const urls = await getLatestPoeUrlsForMovRow(row, {
                programId: activeProgramId,
                isAllPrograms
            })
            setPoeViewerUrls(urls)
        } catch (error) {
            console.error('Failed to load POEs:', error)
            setPoeViewerUrls(Array.isArray(row.poeUrls) ? uniq(row.poeUrls) : [])
            message.error('Failed to load the latest POEs.')
        } finally {
            setPoeViewerLoading(false)
        }
    }

    const closePoeViewer = () => {
        setPoeViewerOpen(false)
        setPoeViewerRow(null)
        setPoeViewerUrls([])
        setPoeViewerPage(1)
    }

    const pagedPoeViewerUrls = useMemo(() => {
        const start = (poeViewerPage - 1) * POE_PAGE_SIZE
        return poeViewerUrls.slice(start, start + POE_PAGE_SIZE)
    }, [poeViewerPage, poeViewerUrls])

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(poeViewerUrls.length / POE_PAGE_SIZE))
        if (poeViewerPage > maxPage) setPoeViewerPage(maxPage)
    }, [poeViewerPage, poeViewerUrls.length])

    const getApproval = (record: any, step: 'hod_submission' | 'validation' | 'final_confirmation') =>
        (record?.approvals || []).find((a: any) => a.step === step) || null

    const getSingleMovValidation = (mov?: any) => {
        if (!mov) return null

        return (
            mov.monitoringValidation ||
            (mov.approvals || []).find((a: any) => a.step === 'validation') ||
            null
        )
    }

    const stepExists = (record: any, step: string) =>
        Array.isArray(record?.approvals) && record.approvals.some((a: any) => a.step === step)

    const isValidationByMe = (record: any) => {
        const approvals = Array.isArray(record?.approvals) ? record.approvals : []
        const v = approvals.find((a: any) => a.step === 'validation')
        if (!v) return false
        if (myUid && v.userId && String(v.userId) === String(myUid)) return true
        if (myEmail && v.email && String(v.email).toLowerCase() === myEmail) return true
        return false
    }

    const fetchMEQueriesForPackIds = async (packIds: string[]) => {
        const map = new Map<string, InhouseQueryDoc[]>()
        const ids = (packIds || []).filter(Boolean)

        const chunkIds = <T,>(arr: T[], size: number) => {
            const out: T[][] = []
            for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
            return out
        }

        const chunks = chunkIds(ids, 10)

        for (const group of chunks) {
            const docs = (await Promise.all(
                group.map(consolidatedMovId => workflowQueryService.list({ consolidatedMovId }))
            )).flat() as InhouseQueryDoc[]

            const meOnly = docs.filter(d => isMEDept(d.raisedByDept))
            for (const qd of meOnly) {
                const k = qd.consolidatedMovId
                if (!map.has(k)) map.set(k, [])
                map.get(k)!.push(qd)
            }
        }

        for (const [k, arr] of map.entries()) {
            arr.sort((a, b) => {
                const da = toJsDate(a.createdAt)?.getTime() || 0
                const dbb = toJsDate(b.createdAt)?.getTime() || 0
                return dbb - da
            })
            map.set(k, arr)
        }

        return map
    }

    const fetchMOVs = async () => {
        if (!isAllPrograms && !activeProgramId) {
            setMovs([])
            setFiltered([])
            return
        }

        setListLoading(true)
        try {
            const constraints: QueryConstraint[] = []

            if (!isAllPrograms && activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const qRef = query(collection(db, 'consolidatedMOVs'), ...constraints)
            const snap = await getDocs(qRef)

            const packs = filterMovRecords(snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(p => stepExists(p, 'hod_submission')), user?.email)

            const packIds = packs.map(p => p.id).filter(Boolean)
            const queryMap = packIds.length
                ? await fetchMEQueriesForPackIds(packIds)
                : new Map<string, InhouseQueryDoc[]>()

            const enriched = packs.map(p => {
                const qs = queryMap.get(p.id) || []
                const openCount = qs.filter(q => isOpenStatus(q.status)).length
                const totalCount = qs.length

                const poeValidations = (p as any)?.poeValidations || {}
                const poeValidatedCount = Object.values(poeValidations).filter(
                    (x: any) => String(x?.status) === 'validated'
                ).length

                return {
                    ...p,
                    __meQueriesTotal: totalCount,
                    __meQueriesOpen: openCount,
                    __poeValidatedCount: poeValidatedCount
                }
            })

            setMovs(enriched)
        } catch (err) {
            console.error(err)
            message.error('Failed to fetch MOVs')
        } finally {
            setListLoading(false)
        }
    }

    useEffect(() => {
        fetchMOVs()
    }, [activeProgramId, isAllPrograms])

    // Scoped by department + month only - this is what the metrics and the
    // progress bar count against, so they track the current filter context
    // (and default to "this month") rather than an all-time, unfiltered total.
    const monthDeptFiltered = useMemo(() => {
        let rows = [...movs]

        if (selectedDept !== 'all') {
            rows = rows.filter(m => m.interventions?.some((i: any) => i.departmentName === selectedDept))
        }

        if (selectedMonth !== 'all') {
            rows = rows.filter(m => m.month === selectedMonth)
        }

        return rows
    }, [movs, selectedDept, selectedMonth])

    useEffect(() => {
        let rows = [...monthDeptFiltered]

        if (statusFilter === 'pending') {
            rows = rows.filter(m => !stepExists(m, 'validation'))
        } else if (statusFilter === 'validated') {
            rows = rows.filter(m => stepExists(m, 'validation'))
        } else if (statusFilter === 'queries') {
            rows = rows.filter(m => Number(m?.__meQueriesOpen || 0) > 0)
        }

        setFiltered(rows)
    }, [monthDeptFiltered, statusFilter, myUid, myEmail])

    const uniqueDepartments = useMemo(() => {
        return Array.from(
            new Set(
                movs.flatMap(m => m.interventions?.map((i: any) => i.departmentName)).filter(Boolean)
            )
        ).sort()
    }, [movs])

    const allSubmissionsCount = monthDeptFiltered.length

    const pendingValidations = useMemo(
        () => monthDeptFiltered.filter(m => !stepExists(m, 'validation')).length,
        [monthDeptFiltered]
    )

    const validatedCount = useMemo(
        () => monthDeptFiltered.filter(m => stepExists(m, 'validation')).length,
        [monthDeptFiltered]
    )

    const openQueriesCount = useMemo(
        () => monthDeptFiltered.reduce((sum, m) => sum + Number(m?.__meQueriesOpen || 0), 0),
        [monthDeptFiltered]
    )

    const toggleStatusFilter = (value: 'pending' | 'validated' | 'queries') => {
        setStatusFilter(previous => (previous === value ? 'all' : value))
    }

    const fetchMEQueriesForPack = async (consolidatedMovId: string) => {
        setQueriesLoading(true)
        try {
            const all = await workflowQueryService.list({ consolidatedMovId }) as InhouseQueryDoc[]
            const meOnly = all.filter(q => isMEDept(q.raisedByDept))
            setPackQueries(meOnly)
            return meOnly
        } catch (err) {
            console.error(err)
            setPackQueries([])
            message.error('Failed to load M&E queries for this pack')
            return []
        } finally {
            setQueriesLoading(false)
        }
    }

    const fetchTimelineQueriesForPack = async (consolidatedMovId: string) => {
        try {
            const all = await workflowQueryService.list({ consolidatedMovId }) as InhouseQueryDoc[]
            setTimelineQueries(all)
        } catch (err) {
            console.error('Failed to load timeline queries:', err)
            setTimelineQueries([])
        }
    }

    const handleOpenSingleMov = async (mov: MovDoc) => {
        const movId = String(mov.id || '')
        if (openingMovId) return

        setOpeningMovId(movId)
        try {
            const hydrated = await hydrateMovPeople(mov, {
                programId: activeProgramId,
                isAllPrograms
            })

            setSelectedSingleMov(hydrated)
            setSingleMovOpen(true)
        } catch (e) {
            console.error(e)
            setSelectedSingleMov(mov)
            setSingleMovOpen(true)
        } finally {
            setOpeningMovId(null)
        }
    }

    const handleSignSingleMovAsME = async () => {
        if (!selectedSingleMov?.id) return

        try {
            if (myRole !== 'operations') {
                message.error('Only Operations (M&E) can sign a single MOV here.')
                return
            }

            const opsSig = await fetchOpsSignature(myEmail)
            if (!opsSig?.signatureURL) {
                message.error('Your Operations signature was not found. Please save it in users.')
                return
            }

            setSingleMovSigning(true)

            const approvalEntry = {
                step: 'validation',
                name: user?.name || user?.displayName || 'Unknown',
                role: user?.role || '',
                userId: myUid,
                email: myEmail,
                date: new Date()
            }

            const monitoringValidation = {
                status: 'validated',
                validatedAt: new Date(),
                validatorUserId: myUid || null,
                validatorEmail: myEmail || null,
                validatorName: user?.name || user?.displayName || null,
                validatorRole: user?.role || null,
                signatureUrl: opsSig.signatureURL || null,
                digitalSignature: opsSig.digitalSignature || null
            }

            const latestPoeUrls = await getLatestPoeUrlsForMovRow(selectedSingleMov, {
                programId: activeProgramId,
                isAllPrograms
            })
            const primaryUrl = latestPoeUrls[0] || null

            const poeValidationPayload = {
                status: 'validated',
                validatedAt: new Date(),
                validatorUserId: myUid || null,
                validatorEmail: myEmail || null,
                validatorName: user?.name || user?.displayName || null,
                validatorRole: user?.role || null,
                poeUrl: primaryUrl,
                poeUrls: latestPoeUrls
            }

            await updateDoc(doc(db, 'movDocuments', selectedSingleMov.id), {
                finalCheckerName: user?.name || user?.displayName || null,
                finalCheckerSignature: opsSig.signatureURL || null,
                finalCheckerDate: new Date(),
                officeUseDate: new Date(),
                monitoringApproved: true,
                monitoringApprovedAt: new Date(),
                monitoringName: user?.name || user?.displayName || null,
                monitoringUserId: myUid || null,
                monitoringEmail: myEmail || null,
                monitoringRole: user?.role || null,
                monitoringSignatureUrl: opsSig.signatureURL || null,
                monitoringDigitalSignature: opsSig.digitalSignature || null,
                monitoringValidation,
                approvals: [
                    ...((selectedSingleMov as any).approvals || []).filter(
                        (a: any) => String(a?.step || '').toLowerCase() !== 'validation'
                    ),
                    approvalEntry
                ]
            })

            if (selected?.id && Array.isArray(selected?.interventions)) {
                const updatedInterventions = selected.interventions.map((row: any) =>
                    row.id === selectedSingleMov.id
                        ? {
                            ...row,
                            finalCheckerName: user?.name || user?.displayName || null,
                            finalCheckerSignature: opsSig.signatureURL || null,
                            finalCheckerDate: new Date(),
                            officeUseDate: new Date(),
                            monitoringApproved: true,
                            monitoringApprovedAt: new Date(),
                            monitoringName: user?.name || user?.displayName || null,
                            monitoringUserId: myUid || null,
                            monitoringEmail: myEmail || null,
                            monitoringRole: user?.role || null,
                            monitoringSignatureUrl: opsSig.signatureURL || null,
                            monitoringDigitalSignature: opsSig.digitalSignature || null,
                            monitoringValidation,
                            approvals: [
                                ...((row.approvals || []).filter(
                                    (a: any) => String(a?.step || '').toLowerCase() !== 'validation'
                                )),
                                approvalEntry
                            ]
                        }
                        : row
                )

                await updateDoc(doc(db, 'consolidatedMOVs', selected.id), {
                    interventions: updatedInterventions,
                    [`poeValidations.${selectedSingleMov.id}`]: poeValidationPayload
                })

                setSelected((prev: any) =>
                    prev
                        ? {
                            ...prev,
                            interventions: updatedInterventions,
                            poeValidations: {
                                ...(prev?.poeValidations || {}),
                                [selectedSingleMov.id]: poeValidationPayload
                            }
                        }
                        : prev
                )
            }

            setSelectedSingleMov((prev: any) =>
                prev
                    ? {
                        ...prev,
                        finalCheckerName: user?.name || user?.displayName || null,
                        finalCheckerSignature: opsSig.signatureURL || null,
                        finalCheckerDate: new Date(),
                        officeUseDate: new Date(),
                        monitoringApproved: true,
                        monitoringApprovedAt: new Date(),
                        monitoringName: user?.name || user?.displayName || null,
                        monitoringUserId: myUid || null,
                        monitoringEmail: myEmail || null,
                        monitoringRole: user?.role || null,
                        monitoringSignatureUrl: opsSig.signatureURL || null,
                        monitoringDigitalSignature: opsSig.digitalSignature || null,
                        monitoringValidation,
                        approvals: [
                            ...((prev.approvals || []).filter(
                                (a: any) => String(a?.step || '').toLowerCase() !== 'validation'
                            )),
                            approvalEntry
                        ]
                    }
                    : prev
            )

            message.success('Single MOV signed by M&E.')
            await fetchMOVs()
        } catch (e) {
            console.error(e)
            message.error('Failed to sign single MOV.')
        } finally {
            setSingleMovSigning(false)
        }
    }

    const handleReview = async (pack: any) => {
        const packId = String(pack?.id || '')
        if (openingPackId) return

        setOpeningPackId(packId)
        try {
            let hydrated: MovDoc[] = []

            if (Array.isArray(pack.movIds) && pack.movIds.length) {
                const rows: MovDoc[] = []
                await Promise.all(
                    pack.movIds.map(async (id: string) => {
                        const dref = await getDoc(doc(db, 'movDocuments', id))
                        if (dref.exists()) {
                            const raw = {
                                id: dref.id,
                                interventionId: (dref.data() as any).interventionId || dref.id,
                                ...(dref.data() as any)
                            } as MovDoc
                            rows.push(
                                await hydrateMovPeople(raw, {
                                    programId: activeProgramId,
                                    isAllPrograms
                                })
                            )
                        }
                    })
                )
                hydrated = rows
            } else if (Array.isArray(pack.interventions) && pack.interventions.length) {
                hydrated = await Promise.all(
                    pack.interventions.map((i: any) =>
                        hydrateMovPeople(
                            {
                                id: i.id || i.docId || '',
                                interventionId: i.interventionId || i.id || i.docId || '',
                                ...(i as any)
                            },
                            {
                                programId: activeProgramId,
                                isAllPrograms
                            }
                        )
                    )
                )
            }

            const merged = { ...pack, interventions: hydrated }
            setSelected(merged)
            setModalVisible(true)

            await fetchMEQueriesForPack(pack.id)
        } catch (e) {
            console.error(e)
            setSelected(pack)
            setModalVisible(true)
            await fetchMEQueriesForPack(pack.id)
        } finally {
            setOpeningPackId(null)
        }
    }

    const getPoeValidation = (pack: any, movRowId?: string) => {
        if (!pack || !movRowId) return null
        const v = (pack?.poeValidations || {})[movRowId] as PoeValidation | undefined
        return v || null
    }

    const hasOpenPoeQuery = (movRowId?: string) => {
        if (!movRowId) return false
        return (packQueries || []).some(
            q => q.targetType === 'poe' && q.movRowId === movRowId && isOpenStatus(q.status)
        )
    }

    const getRequiredPoeRowIds = (pack: any): string[] => {
        const rows: MovDoc[] = Array.isArray(pack?.interventions) ? pack.interventions : []
        const required: string[] = []

        for (const r of rows) {
            const hasLocal =
                isPreIncMov(r) ||
                (Array.isArray(r.poeUrls) && r.poeUrls.length > 0)
            if (hasLocal) required.push(r.id)
        }

        return Array.from(new Set(required.filter(Boolean)))
    }

    const getPoeProgress = (pack: any) => {
        const rows: MovDoc[] = Array.isArray(pack?.interventions) ? pack.interventions : []
        const validations = pack?.poeValidations || {}

        const requiredIds = rows
            .filter(r => isPreIncMov(r) || hasMovPoeSync(r))
            .map(r => r.id)
            .filter(Boolean)

        const validatedCount = requiredIds.filter(id => {
            const packValidated = String(validations?.[id]?.status || '') === 'validated'
            const row = rows.find(r => r.id === id) as any
            const rowValidated =
                String(row?.monitoringValidation?.status || '') === 'validated' ||
                Array.isArray(row?.approvals) &&
                row.approvals.some((a: any) => String(a?.step || '').toLowerCase() === 'validation')

            return packValidated || rowValidated
        }).length

        return { required: requiredIds.length, validated: validatedCount }
    }

    const handleValidateSinglePOE = async (row: MovDoc) => {
        if (!selected?.id || !row?.id) return

        try {
            if (myRole !== 'operations') {
                message.error('Only Operations (M&E) can validate POEs on this page.')
                return
            }

            const latestUrls = await getLatestPoeUrlsForMovRow(row, {
                programId: activeProgramId,
                isAllPrograms
            })

            const primaryUrl = latestUrls[0] || null
            const preIncEvidence = isPreIncMov(row)

            if (!primaryUrl && !preIncEvidence) {
                message.error('This row has no POE to validate.')
                return
            }

            const latestQueries = await fetchMEQueriesForPack(selected.id)
            const hasOpenForRow = latestQueries.some(
                q => q.targetType === 'poe' && q.movRowId === row.id && isOpenStatus(q.status)
            )
            if (hasOpenForRow) {
                message.error('POE validation is blocked while there is an open M&E query on this POE.')
                return
            }

            const existing = getPoeValidation(selected, row.id)
            if (existing?.status === 'validated') {
                message.info('This POE is already validated.')
                return
            }

            const opsSig = await fetchOpsSignature(myEmail)
            if (!opsSig?.signatureURL) {
                message.error('Your Operations signature was not found. Please save it in users.')
                return
            }

            const payload: PoeValidation = {
                status: 'validated',
                validatedAt: new Date(),
                validatorUserId: myUid || null,
                validatorEmail: myEmail || null,
                validatorName: user?.name || user?.displayName || null,
                validatorRole: user?.role || null,
                poeUrl: primaryUrl,
                poeUrls: latestUrls
            }

            await updateDoc(doc(db, 'consolidatedMOVs', selected.id), {
                [`poeValidations.${row.id}`]: payload
            })

            message.success('POE validated.')

            const updated = {
                ...selected,
                poeValidations: {
                    ...(selected?.poeValidations || {}),
                    [row.id]: payload
                }
            }
            setSelected(updated)

            await fetchMOVs()
        } catch (e) {
            console.error(e)
            message.error('Failed to validate POE.')
        }
    }

    const handleValidate = async () => {
        if (!selected) return

        try {
            if (myRole !== 'operations') {
                message.error('This page is restricted to Operations (M&E).')
                return
            }

            if (stepExists(selected, 'validation')) {
                message.info('This pack has already been validated by M&E.')
                return
            }

            if (!stepExists(selected, 'final_confirmation')) {
                message.error('Confirm this pack on behalf of the Center Coordinator before validating it.')
                return
            }

            const latestQueries = await fetchMEQueriesForPack(selected.id)
            const hasOpenMEQuery = latestQueries.some(q => isOpenStatus(q.status))
            if (hasOpenMEQuery) {
                message.error('Validation is blocked while there is an open M&E query on this pack.')
                return
            }

            const poeProgress = getPoeProgress(selected)
            if (poeProgress.required > 0 && poeProgress.validated < poeProgress.required) {
                message.error(`Validate all POEs first (${poeProgress.validated}/${poeProgress.required}).`)
                return
            }

            const opsSig = await fetchOpsSignature(myEmail)
            if (!opsSig?.signatureURL) {
                message.error('Your Operations signature was not found. Please save it in users.')
                return
            }

            const approvals = Array.isArray(selected.approvals) ? selected.approvals : []

            const updates: any = {
                finalCheckerName: opsSig.name || user?.name || null,
                finalCheckerSignature: opsSig.signatureURL || null,
                finalCheckerDate: new Date(),
                officeUseDate: new Date(),
                approvals: [
                    ...approvals,
                    {
                        step: 'validation',
                        name: user?.name || user?.displayName || 'Unknown',
                        role: user?.role || '',
                        userId: myUid,
                        email: myEmail,
                        date: new Date()
                    }
                ],
                monitoringName: opsSig.name || user?.name || null,
                monitoringSignatureUrl: opsSig.signatureURL || null,
                monitoringDigitalSignature: opsSig.digitalSignature || null,
                status: 'invoice_redeemable',
                invoiceRedeemable: true,
                invoiceRedeemableAt: new Date()
            }

            await updateDoc(doc(db, 'consolidatedMOVs', selected.id), updates)

            message.success('Pack validated. Invoice is now redeemable.')
            setModalVisible(false)
            setSelected(null)
            await fetchMOVs()
        } catch (err) {
            console.error(err)
            message.error('Failed to validate pack.')
        }
    }

    const handleConfirmOnBehalf = async () => {
        if (!selected) return

        try {
            if (myRole !== 'operations') {
                message.error('This action is restricted to Operations (M&E).')
                return
            }

            if (stepExists(selected, 'final_confirmation')) {
                message.info('This pack has already been confirmed.')
                setConfirmOnBehalfOpen(false)
                return
            }

            const { reason } = await confirmOnBehalfForm.validateFields()
            const trimmedReason = String(reason || '').trim()
            const approvals = Array.isArray(selected.approvals) ? selected.approvals : []
            const confirmedAt = new Date()
            const actorName = user?.name || user?.displayName || 'Unknown'

            setConfirmingOnBehalf(true)

            const approval = {
                step: 'final_confirmation',
                name: actorName,
                role: user?.role || '',
                userId: myUid,
                email: myEmail,
                date: confirmedAt,
                onBehalfOfCC: true,
                confirmationMode: 'me_on_behalf_of_cc',
                reason: trimmedReason
            }

            await updateDoc(doc(db, 'consolidatedMOVs', selected.id), {
                approvals: [...approvals, approval],
                status: 'confirmed',
                ccConfirmationOnBehalf: {
                    confirmedByUserId: myUid,
                    confirmedByName: actorName,
                    confirmedByEmail: myEmail,
                    confirmedByRole: user?.role || '',
                    confirmedAt,
                    reason: trimmedReason
                }
            })

            setSelected({
                ...selected,
                approvals: [...approvals, approval],
                status: 'confirmed'
            })
            setConfirmOnBehalfOpen(false)
            confirmOnBehalfForm.resetFields()
            message.success('Pack confirmed on behalf of the Center Coordinator. You may now validate it.')
            await fetchMOVs()
        } catch (err: any) {
            if (err?.errorFields) return
            console.error(err)
            message.error('Failed to confirm the pack on behalf of the Center Coordinator.')
        } finally {
            setConfirmingOnBehalf(false)
        }
    }

    const handleSubmitQuery = async () => {
        if (!selected) {
            message.error('No MOV selected')
            return
        }

        try {
            const vals = await queryForm.validateFields()
            const autoUrl = selectedPoeRow
                ? (await getLatestPoeUrlsForMovRow(selectedPoeRow, {
                    programId: activeProgramId,
                    isAllPrograms
                }))[0] || null
                : null

            setQuerySubmitting(true)
            const recipient = getQueryRecipient(selectedPoeRow)

            await workflowQueryService.create({
                programId: String(activeProgramId || ''),
                type: 'me-query',
                message: vals.reason,
                raisedById: myUid,
                raisedBy: {
                    name: user?.name || user?.displayName || null,
                    email: myEmail || null,
                    role: user?.role || null,
                    departmentName: user?.departmentName || 'M&E'
                },
                resolverId: recipient.id,
                resolver: {
                    name: recipient.name,
                    email: recipient.email,
                    role: recipient.role,
                    departmentName: selectedPoeRow?.departmentName || selected?.department || null
                },
                target: selectedPoeRow
                    ? {
                        type: 'poe',
                        id: String(selectedPoeRow.id),
                        parentType: 'mov-pack',
                        parentId: selected.id
                    }
                    : { type: 'mov-pack', id: selected.id },
                context: {
                    consolidatedMovId: selected.id,
                    movRowId: selectedPoeRow?.id || null,
                    participantId: (selectedPoeRow?.beneficiaryId || selectedPoeRow?.smmeId) || null,
                    interventionId: selectedPoeRow?.interventionId || null,
                    evidenceUrl: autoUrl || null,
                    departmentName: selectedPoeRow?.departmentName || selected?.department || null
                }
            })

            message.success('M&E query created.')

            setQueryModalOpen(false)
            setSelectedPoeRow(null)
            queryForm.resetFields()

            await fetchMEQueriesForPack(selected.id)
            await fetchMOVs()
        } catch (e) {
            if (!('errorFields' in (e as any))) {
                console.error(e)
                message.error('Failed to submit query')
            }
        } finally {
            setQuerySubmitting(false)
        }
    }

    const handleResolveQuery = async () => {
        if (!selectedQuery?.id) return

        try {
            const vals = await resolveForm.validateFields()
            setResolving(true)

            await workflowQueryService.resolve(selectedQuery.id, {
                notes: vals.resolutionNotes || '',
                actorId: myUid,
                actor: {
                    name: user?.name || user?.displayName || null,
                    email: myEmail || null,
                    role: user?.role || null,
                    departmentName: user?.departmentName || 'M&E'
                }
            })

            message.success('Query marked as resolved.')

            setResolveModalOpen(false)
            setSelectedQuery(null)
            resolveForm.resetFields()

            if (selected?.id) {
                await fetchMEQueriesForPack(selected.id)
            }
            await fetchMOVs()
        } catch (e) {
            console.error(e)
            message.error('Failed to resolve query')
        } finally {
            setResolving(false)
        }
    }

    const groupByDept = (interventions: any[] = []) =>
        interventions.reduce((acc: Record<string, any[]>, mov: any) => {
            const dept = mov?.departmentName || 'Department'
            if (!acc[dept]) acc[dept] = []
            acc[dept].push(mov)
            return acc
        }, {})

    const statusTag = (record: any) => {
        const v = getApproval(record, 'validation')
        const hod = getApproval(record, 'hod_submission')
        const cc = getApproval(record, 'final_confirmation')
        const invoiceRedeemable = !!record?.invoiceRedeemable

        const statusMap: Record<
            string,
            { color: string; icon: React.ReactNode; label: string }
        > = {
            redeemable: {
                color: 'green',
                icon: <CheckCircleOutlined />,
                label: `Invoice Redeemable${v?.name ? ` • ${v.name}` : ''}`
            },
            validation: {
                color: 'blue',
                icon: <SafetyCertificateOutlined />,
                label: `M&E FINAL APPROVAL${v?.name ? ` • ${v.name}` : ''}`
            },
            cc: {
                color: 'geekblue',
                icon: <FileDoneOutlined />,
                label: `CC Approved${cc?.name ? ` • ${cc.name}` : ''}`
            },
            hod: {
                color: 'gold',
                icon: <ClockCircleOutlined />,
                label: `HOD Approved${hod?.name ? ` • ${hod.name}` : ''}`
            },
            pending: {
                color: 'orange',
                icon: <ClockCircleOutlined />,
                label: 'Pending'
            }
        }

        const key =
            invoiceRedeemable ? 'redeemable' :
                v ? 'validation' :
                    cc ? 'cc' :
                        hod ? 'hod' :
                            'pending'

        const meta = statusMap[key]

        return (
            <Tag
                color={meta.color}
                icon={meta.icon}
                style={{
                    margin: 0,
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                }}
            >
                {meta.label}
            </Tag>
        )
    }

    const queryTag = (record: any) => {
        const open = Number(record?.__meQueriesOpen || 0)
        const total = Number(record?.__meQueriesTotal || 0)

        if (!total) return <span style={{ color: '#999' }}>—</span>

        if (open > 0) {
            return (
                <Tag color="volcano" icon={<QuestionCircleOutlined />} style={{ margin: 0, fontWeight: 500 }}>
                    OPEN • {open}
                </Tag>
            )
        }

        return (
            <Tag color="green" style={{ margin: 0, fontWeight: 500 }}>
                RESOLVED • {total}
            </Tag>
        )
    }

    const poePackTag = (record: any) => {
        const poeValidations = record?.poeValidations || {}
        const validated = Object.values(poeValidations).filter(
            (x: any) => String(x?.status) === 'validated'
        ).length

        const required = (() => {
            const rows: MovDoc[] = Array.isArray(record?.interventions) ? record.interventions : []
            let count = 0
            for (const r of rows) {
                if (isPreIncMov(r) || hasMovPoeSync(r)) count += 1
            }
            return count
        })()

        if (!required) return <span style={{ color: '#999' }}>—</span>

        const done = validated >= required
        return (
            <Tag color={done ? 'green' : 'orange'} style={{ margin: 0, fontWeight: 500 }}>
                {validated}/{required}
            </Tag>
        )
    }

    const openPoeQuery = async (row: MovDoc) => {
        setSelectedPoeRow(row)
        setQueryModalOpen(true)

        const url =
            (await getLatestPoeUrlsForMovRow(row, {
                programId: activeProgramId,
                isAllPrograms
            }))[0] || ''

        queryForm.setFieldsValue({
            reason: '',
            poeTarget: row?.interventionTitle || '',
            poeUrl: url || ''
        })
    }

    const getQueryRecipient = (row?: MovDoc | null) => {
        const hodSubmission = (Array.isArray((selected as any)?.approvals) ? (selected as any).approvals : [])
            .find((item: any) => item?.step === 'hod_submission') || {}
        if (!row) {
            return {
                id: null,
                name: hodSubmission.name || null,
                email: hodSubmission.email || null,
                role: hodSubmission.role || 'operations'
            }
        }
        const target = row

        return {
            id:
                (target as any).facilitatorId ||
                (target as any).consultantId ||
                (target as any).assigneeId ||
                null,
            name:
                (target as any).facilitatorName ||
                (target as any).consultantName ||
                (target as any).assigneeName ||
                null,
            email:
                (target as any).facilitatorEmail ||
                (target as any).consultantEmail ||
                (target as any).assigneeEmail ||
                null,
            role:
                (target as any).assigneeRole ||
                (target as any).facilitatorRole ||
                'consultant'
        }
    }

    const getQueryTargetRow = (q: InhouseQueryDoc) => {
        const rows = Array.isArray(selected?.interventions) ? selected.interventions : []
        return rows.find((row: any) =>
            String(row?.id || row?.docId || '') === String(q.movRowId || '') ||
            String(row?.interventionId || '') === String(q.interventionId || '') ||
            String(row?.beneficiaryId || row?.smmeId || '') === String(q.participantId || '')
        ) || null
    }

    const getPackFallbackRecipient = () => {
        const cc = getApproval(selected, 'final_confirmation')
        const hod = getApproval(selected, 'hod_submission')

        return {
            name: cc?.name || cc?.email || hod?.name || hod?.email || null,
            email: cc?.email || hod?.email || null
        }
    }

    const getQueryRecipientLabel = (q: InhouseQueryDoc) => {
        const rowRecipient = getQueryRecipient(getQueryTargetRow(q))
        const packRecipient = getPackFallbackRecipient()

        return (
            q.receivedByName ||
            q.receivedByEmail ||
            (q as any).consultantName ||
            (q as any).consultantEmail ||
            (q as any).assigneeName ||
            (q as any).assigneeEmail ||
            rowRecipient.name ||
            rowRecipient.email ||
            packRecipient.name ||
            packRecipient.email ||
            'Unknown'
        )
    }

    const getQueryReplyLabel = (q: InhouseQueryDoc) => {
        return (
            q.repliedByName ||
            q.repliedByEmail ||
            (q as any).resolvedByName ||
            (q as any).resolvedByEmail ||
            (isResolvedStatus(q.status) ? getQueryRecipientLabel(q) : '') ||
            '—'
        )
    }

    const getQueryReplyAt = (q: InhouseQueryDoc) =>
        q.repliedAt || q.resolvedAt || (isResolvedStatus(q.status) ? q.updatedAt : null)

    const columns = [
        {
            title: 'Month',
            dataIndex: 'month',
            render: (m: string) =>
                dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                    ? dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).format('MMM YYYY')
                    : m
        },
        { title: 'Department', dataIndex: 'department' },
        { title: 'Status', render: (record: any) => statusTag(record) },
        { title: 'POE Validations', render: (_: any, record: any) => poePackTag(record) },
        { title: 'M&E Queries', render: (_: any, record: any) => queryTag(record) },
        {
            title: 'Actions',
            render: (_: any, record: any) => {
                const hasAnyQueries = Number(record?.__meQueriesTotal || 0) > 0

                return (
                    <Space>
                        <Tooltip title="Review">
                            <Button
                                icon={<FileSearchOutlined />}
                                loading={openingPackId === String(record?.id || '')}
                                disabled={openingPackId !== null}
                                onClick={() => handleReview(record)}
                            />
                        </Tooltip>

                        <Tooltip title="View Timeline">
                            <Button
                                icon={<HistoryOutlined />}
                                onClick={async () => {
                                    setSelected(record)
                                    await fetchTimelineQueriesForPack(record.id)
                                    setTimelineModalVisible(true)
                                }}
                            />
                        </Tooltip>

                        <Tooltip title="View M&E Queries">
                            <Button
                                icon={<QuestionCircleOutlined />}
                                disabled={!hasAnyQueries}
                                onClick={async () => {
                                    setSelected(record)
                                    await fetchMEQueriesForPack(record.id)
                                    setQueriesModalOpen(true)
                                }}
                            />
                        </Tooltip>
                    </Space>
                )
            }
        }
    ]

    // "YYYY-MM" strings sort correctly as plain strings - descending puts the
    // most recent month first, going back through prior months/years.
    const monthOptions = useMemo(
        () => [...new Set(movs.map(m => m.month).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
        [movs]
    )

    // Default to the current month, but only once real data has loaded, and
    // only if that month actually has submissions - otherwise (e.g. nothing
    // submitted yet this month) fall back to the most recent month that does,
    // rather than silently showing an all-zero, empty-looking page.
    useEffect(() => {
        if (hasAppliedDefaultMonthRef.current || !monthOptions.length) return
        hasAppliedDefaultMonthRef.current = true
        const currentMonth = dayjs().format('YYYY-MM')
        setSelectedMonth(
            monthOptions.includes(currentMonth)
                ? currentMonth
                : [...monthOptions].sort().pop() as string
        )
    }, [monthOptions])

    const selectedHasValidation = selected ? stepExists(selected, 'validation') : false
    const selectedHasCCConfirmation = selected ? stepExists(selected, 'final_confirmation') : false
    const selectedCCConfirmation = selected ? getApproval(selected, 'final_confirmation') : null
    const openMEQueriesOnSelected = useMemo(
        () => (packQueries || []).filter(q => isOpenStatus(q.status)).length,
        [packQueries]
    )

    const poeProgressOnSelected = useMemo(
        () => (selected ? getPoeProgress(selected) : { required: 0, validated: 0 }),
        [selected, packQueries]
    )

    const poeBlocking =
        !selectedHasValidation &&
        poeProgressOnSelected.required > 0 &&
        poeProgressOnSelected.validated < poeProgressOnSelected.required

    const validateDisabled =
        !selected ||
        selectedHasValidation ||
        myRole !== 'operations' ||
        !selectedHasCCConfirmation ||
        openMEQueriesOnSelected > 0 ||
        poeBlocking

    const validateDisabledReason = (() => {
        if (!selected) return 'Select a pack first'
        if (myRole !== 'operations') return 'Only Operations (M&E) can validate on this page'
        if (selectedHasValidation) return 'This pack has already been validated'
        if (!selectedHasCCConfirmation) return 'Confirm on behalf of the Center Coordinator first'
        if (openMEQueriesOnSelected > 0) return 'Resolve open M&E queries before validating'
        if (poeBlocking) {
            return `Validate all POEs first (${poeProgressOnSelected.validated}/${poeProgressOnSelected.required})`
        }
        return ''
    })()

    const timelineItems = useMemo(() => {
        const items: Array<{ at: Date; label: string; detail?: string; color?: string }> = []

        const approvals = Array.isArray(selected?.approvals) ? selected.approvals : []
        for (const a of approvals) {
            const step = String(a?.step || '')
            const when = toJsDate(a?.date) || toJsDate(a?.createdAt) || null
            if (!when) continue

            items.push({
                at: when,
                label: stepLabels[step] || step,
                detail: a?.onBehalfOfCC
                    ? `${a?.name || 'Unknown'} (M&E on behalf of CC) | Reason: ${a?.reason || 'Not provided'}`
                    : a?.name || 'Unknown',
                color: 'green'
            })
        }

        // Preserve CC confirmation actions from older packs that stored the
        // metadata outside the approvals array.
        if (!approvals.some((a: any) => a?.step === 'final_confirmation')) {
            const ccMeta = (selected as any)?.ccConfirmationOnBehalf ||
                (selected as any)?.centerCoordinatorConfirmation ||
                (selected as any)?.ccConfirmation || null
            const ccWhen = ccMeta && (
                toJsDate(ccMeta.confirmedAt) ||
                toJsDate(ccMeta.date) ||
                toJsDate(ccMeta.createdAt)
            )
            if (ccWhen) {
                items.push({
                    at: ccWhen,
                    label: 'Center Coordinator Confirmation',
                    detail: `${ccMeta.confirmedByName || ccMeta.name || 'Center Coordinator'}${ccMeta.onBehalfOfCC ? ' (M&E on behalf of CC)' : ''}${ccMeta.reason ? ` | Reason: ${ccMeta.reason}` : ''}`,
                    color: 'green'
                })
            }
        }

        for (const q of timelineQueries || []) {
            const created = toJsDate(q.createdAt)
            if (created) {
                const recipient = getQueryRecipientLabel(q)
                const byCc = !isMEDept(q.raisedByDept)
                items.push({
                    at: created,
                    label: byCc
                        ? (q.targetType === 'poe' ? 'CC POE Query Raised' : 'CC Pack Query Raised')
                        : (q.targetType === 'poe' ? 'M&E POE Query Raised' : 'M&E Pack Query Raised'),
                    detail: `Raised by: ${q.raisedByName || q.raisedByEmail || 'Unknown'} | Received by: ${recipient} | ${String(q.queryMessage || '').trim()}`,
                    color: 'red'
                })
            }

            if (isResolvedStatus(q.status)) {
                const resolvedAt = toJsDate(getQueryReplyAt(q))
                if (resolvedAt) {
                    const notes = String(q.resolutionNotes || '').trim()
                    const byCc = !isMEDept(q.raisedByDept)
                    items.push({
                        at: resolvedAt,
                        label: byCc
                            ? (q.targetType === 'poe' ? 'CC POE Query Resolved' : 'CC Pack Query Resolved')
                            : (q.targetType === 'poe' ? 'M&E POE Query Resolved' : 'M&E Pack Query Resolved'),
                        detail: `Replied by: ${getQueryReplyLabel(q)} | ${notes ? `Notes: ${notes}` : 'No response notes captured'}`,
                        color: 'green'
                    })
                }
            }
        }

        items.sort((a, b) => a.at.getTime() - b.at.getTime())
        return items
    }, [selected, timelineQueries])

    const visibleTimelineItems = useMemo(() => {
        if (showAllTimeline) return timelineItems
        return timelineItems.slice(-8)
    }, [timelineItems, showAllTimeline])

    const showEmptyProgramState = !isAllPrograms && !activeProgramId

    const validationApproval = getApproval(selected, 'validation')
    const hasValidation = !!validationApproval
    const meName = hasValidation ? (selected?.monitoringName || validationApproval?.name || '—') : '—'
    const meSigUrl = hasValidation ? (selected?.monitoringSignatureUrl || '') : ''

    const poeActionIconBtn: React.CSSProperties = {
        ...roundBtn,
        width: 36,
        height: 36,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
    }

    const sigImgStyle: React.CSSProperties = {
        maxHeight: 38,
        maxWidth: 150,
        objectFit: 'contain',
        border: '1px solid #eee',
        borderRadius: 6,
        padding: 2
    }

    // A 1px borderColor override alone reads too close to the card's own hover
    // border, so a hovered-but-unselected card can look "selected" too. Selection
    // needs its own unmistakable treatment: a thicker border plus a tinted fill.
    const activeMetricStyle = (rgb: string): React.CSSProperties => ({
        border: `2px solid rgb(${rgb})`,
        background: `rgba(${rgb},0.08)`
    })

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>MOV Verifications | Smart Incubation</title>
            </Helmet>

            {showEmptyProgramState ? (
                <MotionCard>
                    <Empty description="Select an active program or use All Programs to view MOV verifications" />
                </MotionCard>
            ) : (
                <>
                    <MetricsGrid metrics={[
                        {
                            key: 'all',
                            title: 'All Submissions',
                            value: allSubmissionsCount,
                            icon: <FileSearchOutlined />,
                            iconBg: '#f0f5ff',
                            loading: listLoading,
                            onClick: () => setStatusFilter('all'),
                            wrapperStyle: statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                        },
                        {
                            key: 'pending',
                            title: 'Pending Validation',
                            value: pendingValidations,
                            icon: <FileDoneOutlined />,
                            iconBg: '#e6f4ff',
                            loading: listLoading,
                            onClick: () => toggleStatusFilter('pending'),
                            wrapperStyle: statusFilter === 'pending'
                                ? activeMetricStyle('250,173,20')
                                : statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                        },
                        {
                            key: 'validated',
                            title: 'Validated',
                            value: validatedCount,
                            icon: <CheckCircleOutlined />,
                            iconBg: '#f6ffed',
                            loading: listLoading,
                            onClick: () => toggleStatusFilter('validated'),
                            wrapperStyle: statusFilter === 'validated'
                                ? activeMetricStyle('82,196,26')
                                : statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                        },
                        {
                            key: 'queries',
                            title: 'Open M&E Queries',
                            value: openQueriesCount,
                            icon: <ExclamationCircleOutlined />,
                            iconBg: '#fff7e6',
                            loading: listLoading,
                            onClick: () => toggleStatusFilter('queries'),
                            wrapperStyle: statusFilter === 'queries'
                                ? activeMetricStyle('250,140,22')
                                : statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                        }
                    ]} />

                    <Row gutter={[16, 16]} style={{ marginBottom: 16, marginTop: 16 }} align="stretch">
                        <Col xs={24} lg={14}>
                            <MotionCard loading={listLoading} size="small" style={{ height: '100%' }}>
                                <div aria-label="MOV validation proportion" style={{ display: 'flex', width: '100%', height: 8, borderRadius: 999, overflow: 'hidden', background: '#eef2f7' }}>
                                    {[
                                        { key: 'validated', value: validatedCount, color: '#52c41a', label: 'Validated' },
                                        { key: 'pending', value: pendingValidations, color: '#faad14', label: 'Pending Validation' }
                                    ].filter(item => item.value > 0).map(item => (
                                        <div
                                            key={item.key}
                                            role="button"
                                            tabIndex={0}
                                            aria-label={`Filter by ${item.label}`}
                                            onClick={() => toggleStatusFilter(item.key as 'validated' | 'pending')}
                                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.click() }}
                                            style={{
                                                width: `${allSubmissionsCount ? (item.value / allSubmissionsCount) * 100 : 0}%`,
                                                background: item.color,
                                                cursor: 'pointer',
                                                opacity: statusFilter !== 'all' && statusFilter !== item.key ? 0.35 : 1,
                                                transition: 'opacity .2s ease'
                                            }}
                                        />
                                    ))}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 20, marginTop: 8 }}>
                                    {[
                                        { key: 'validated', value: validatedCount, color: '#52c41a', label: 'Validated' },
                                        { key: 'pending', value: pendingValidations, color: '#faad14', label: 'Pending Validation' }
                                    ].filter(item => item.value > 0).map(item => (
                                        <Text
                                            key={item.key}
                                            type="secondary"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => toggleStatusFilter(item.key as 'validated' | 'pending')}
                                            style={{
                                                fontSize: 12,
                                                whiteSpace: 'nowrap',
                                                cursor: 'pointer',
                                                opacity: statusFilter !== 'all' && statusFilter !== item.key ? 0.35 : 1
                                            }}
                                        >
                                            <span style={{ color: item.color, marginRight: 5 }}>●</span>{item.label} ({item.value})
                                        </Text>
                                    ))}
                                </div>
                            </MotionCard>
                        </Col>

                        <Col xs={24} lg={10}>
                            <MotionCard loading={listLoading} size="small" style={{ height: '100%' }}>
                                <Row gutter={[12, 12]} align="middle">
                                    <Col xs={24} md={12}>
                                        <Select
                                            value={selectedDept}
                                            onChange={setSelectedDept}
                                            style={{ width: '100%' }}
                                        >
                                            <Option value="all">All Departments</Option>
                                            {uniqueDepartments.map(dep => (
                                                <Option key={dep} value={dep}>
                                                    {dep}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Col>

                                    <Col xs={24} md={12}>
                                        <Select
                                            value={selectedMonth}
                                            onChange={v => setSelectedMonth(v || 'all')}
                                            style={{ width: '100%' }}
                                        >
                                            <Option value="all">All Months</Option>
                                            {monthOptions.map(m => {
                                                const formatted = dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                                                    ? dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).format('MMM YYYY')
                                                    : m
                                                return (
                                                    <Option key={m} value={m}>
                                                        {formatted}
                                                    </Option>
                                                )
                                            })}
                                        </Select>
                                    </Col>
                                </Row>
                            </MotionCard>
                        </Col>
                    </Row>

                    <MotionCard loading={listLoading} skeletonRows={8} title={`MOV Packs (${filtered.length})`} style={cardShellStyle}>
                        <Table
                            rowKey="id"
                            dataSource={sortPackRows(filtered)}
                            columns={columns as any}
                            pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                            scroll={{ x: 900 }}
                        />
                    </MotionCard>
                </>
            )}

            <Modal
                open={singleMovOpen}
                zIndex={1100}
                maskClosable={false}
                onCancel={() => {
                    setSingleMovOpen(false)
                    setSelectedSingleMov(null)
                }}
                width={1400}
                title="Review Single MOV"
                styles={{ footer: { display: 'flex', gap: 8 } }}
                footer={[
                    <Button
                        key="close"
                        danger
                        style={modalFooterButtonStyle}
                        onClick={() => {
                            setSingleMovOpen(false)
                            setSelectedSingleMov(null)
                        }}
                    >
                        Close
                    </Button>,
                    <Button
                        key="sign"
                        type="primary"
                        icon={<SafetyCertificateOutlined />}
                        style={modalFooterButtonStyle}
                        loading={singleMovSigning}
                        disabled={!!getSingleMovValidation(selectedSingleMov) || myRole !== 'operations'}
                        onClick={handleSignSingleMovAsME}
                    >
                        Sign as M&E
                    </Button>
                ]}
            >
                {!selectedSingleMov ? (
                    <Spin />
                ) : (
                    <div style={{ maxHeight: 'none', overflowY: 'visible', padding: 18, background: '#dfe3e8', border: '1px solid #cfd5dc', borderRadius: 8 }}>
                        <div style={{ maxWidth: 1120, minWidth: 860, margin: '0 auto', background: '#fff', boxShadow: '0 8px 28px rgba(15,23,42,.16)', border: '1px solid #e5e7eb' }}>
                            <div style={{ padding: '12px 16px 0' }}><PreIncPoeButton mov={selectedSingleMov} /></div>
                            <MovDocumentView
                                mov={selectedSingleMov}
                                signers={[
                                    {
                                        label: 'Facilitator',
                                        name: selectedSingleMov.facilitatorName,
                                        signatureUrl: selectedSingleMov.facilitatorSignatureUrl,
                                        department: selectedSingleMov.departmentName || (selected as any)?.department,
                                        date:
                                            (selectedSingleMov as any).facilitatorSignedAt ||
                                            (selectedSingleMov as any).assigneeCompletedAt ||
                                            (selectedSingleMov as any).completedAt ||
                                            selectedSingleMov.interventionDate
                                    } as MovSigner,
                                    {
                                        label: 'Client (SMME)',
                                        name: selectedSingleMov.smmeName || selectedSingleMov.smmeCompanyName,
                                        signatureUrl: selectedSingleMov.smmeSignatureUrl,
                                        department: selectedSingleMov.departmentName,
                                        date:
                                            (selectedSingleMov as any).smmeSignedAt ||
                                            (selectedSingleMov as any).smmeAcceptedAt
                                    } as MovSigner,
                                    {
                                        label: 'M&E (Operations)',
                                        name: (selectedSingleMov as any).monitoringName || getSingleMovValidation(selectedSingleMov)?.validatorName,
                                        signatureUrl: (selectedSingleMov as any).monitoringSignatureUrl,
                                        digitalSignature: (selectedSingleMov as any).monitoringDigitalSignature,
                                        department: 'Monitoring and Evaluation',
                                        date: getSingleMovValidation(selectedSingleMov)?.validatedAt,
                                        pending: !getSingleMovValidation(selectedSingleMov)
                                    } as MovSigner
                                ]}
                            />
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                open={modalVisible}
                zIndex={1000}
                title="Review Consolidated MOV"
                onCancel={() => {
                    setModalVisible(false)
                    setSelected(null)
                    setPackQueries([])
                }}
                width={1350}
                footer={[
                    <Button
                        key="close"
                        danger
                        style={roundBtn}
                        onClick={() => {
                            setModalVisible(false)
                            setSelected(null)
                            setPackQueries([])
                        }}
                    >
                        Close
                    </Button>,
                    <Button
                        icon={<InfoCircleOutlined />}
                        style={roundBtn}
                        variant="filled"
                        color="orange"
                        key="query"
                        danger
                        onClick={() => setQueryModalOpen(true)}
                        disabled={!selected}
                    >
                        Raise M&E Query
                    </Button>,
                    <Tooltip
                        key="confirmOnBehalfTip"
                        title={selectedHasCCConfirmation ? 'This pack has already been confirmed' : ''}
                    >
                        <Button
                            icon={<SafetyCertificateOutlined />}
                            style={roundBtn}
                            onClick={() => setConfirmOnBehalfOpen(true)}
                            disabled={!selected || selectedHasCCConfirmation || myRole !== 'operations'}
                        >
                            Confirm on Behalf of CC
                        </Button>
                    </Tooltip>,
                    <Tooltip key="validateTip" title={validateDisabled ? validateDisabledReason : ''}>
                        <Button
                            icon={<CheckCircleOutlined />}
                            style={roundBtn}
                            key="ok"
                            type="primary"
                            onClick={handleValidate}
                            disabled={validateDisabled}
                        >
                            Validate Pack (Invoice Redeemable)
                        </Button>
                    </Tooltip>
                ]}
            >
                <Alert
                    type="warning"
                    message="The pack must have CC confirmation before M&E validation. If the CC cannot confirm it, M&E may confirm on their behalf with a required reason."
                    showIcon
                    style={{ marginBottom: 16 }}
                />

                <Row
                    align="middle"
                    justify="center"
                    style={{
                        marginBottom: 20,
                        border: '1px solid #d9d9d9',
                        borderRadius: 12,
                        padding: '12px 16px',
                        textAlign: 'center',
                        background: '#fafafa'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                        <img src="/assets/images/lepharo.png" alt="Company Logo" style={{ height: 60 }} />
                        <div>
                            <Title level={4} style={{ margin: 0 }}>
                                {selected?.department}
                            </Title>
                            <Text strong>
                                {selected?.month ? dayjs(selected?.month).format('MMMM YYYY') : '—'}
                            </Text>
                        </div>
                    </div>
                </Row>

                <Card size="small" style={{ marginBottom: 20, border: '1px solid #d6e4ff' }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Row>
                            <Col span={24}>
                                <Space size="large" wrap>
                                    <div>
                                        <Text type="secondary">HOD Approval:</Text>{' '}
                                        <Text strong>{getApproval(selected, 'hod_submission')?.name || 'Pending'}</Text>
                                    </div>
                                    <div>
                                        <Text type="secondary">M&E Validation:</Text>{' '}
                                        <Text strong>{getApproval(selected, 'validation')?.name || 'Pending'}</Text>
                                    </div>
                                    <div>
                                        <Text type="secondary">Center Coordinator Confirmation:</Text>{' '}
                                        <Text strong>{getApproval(selected, 'final_confirmation')?.name || 'Pending'}</Text>
                                    </div>
                                    <div>
                                        <Text type="secondary">POE Validations:</Text>{' '}
                                        <Text strong>
                                            {poeProgressOnSelected.validated}/{poeProgressOnSelected.required || 0}
                                        </Text>
                                    </div>
                                </Space>
                            </Col>
                        </Row>

                        {openMEQueriesOnSelected > 0 ? (
                            <Alert
                                type="error"
                                showIcon
                                message={`There ${openMEQueriesOnSelected === 1 ? 'is' : 'are'} ${openMEQueriesOnSelected} open M&E ${openMEQueriesOnSelected === 1 ? 'query' : 'queries'} on this pack. Resolve them before validating.`}
                                action={
                                    <Button size="small" onClick={() => setQueriesModalOpen(true)}>
                                        View Queries
                                    </Button>
                                }
                            />
                        ) : null}

                        {selectedCCConfirmation?.onBehalfOfCC ? (
                            <Alert
                                type="info"
                                showIcon
                                message={`Confirmed on behalf of the Center Coordinator by ${selectedCCConfirmation.name || 'M&E'}`}
                                description={`Reason: ${selectedCCConfirmation.reason || 'Not provided'}`}
                            />
                        ) : null}

                        {!selectedHasValidation && poeBlocking ? (
                            <Alert
                                type="error"
                                showIcon
                                message={`Validate all POEs first (${poeProgressOnSelected.validated}/${poeProgressOnSelected.required}).`}
                            />
                        ) : null}

                        {selectedHasValidation ? (
                            <Alert
                                type="info"
                                showIcon
                                message={
                                    poeProgressOnSelected.required > 0 &&
                                        poeProgressOnSelected.validated < poeProgressOnSelected.required
                                        ? `This pack was already validated by M&E before POE row validation was fully captured on this screen. Current POE validation tracker shows ${poeProgressOnSelected.validated}/${poeProgressOnSelected.required} and should be treated as historical/backfill information for this pack.`
                                        : 'This pack has already been validated by M&E. Validation is a single department-level action.'
                                }
                            />
                        ) : null}

                        {selected?.invoiceRedeemable ? (
                            <Alert
                                type="success"
                                showIcon
                                message={`Invoice Redeemable${selected?.invoiceRedeemableAt ? ` • ${dayjs(toJsDate(selected.invoiceRedeemableAt) || selected.invoiceRedeemableAt).format('YYYY-MM-DD HH:mm')}` : ''}`}
                            />
                        ) : null}
                    </Space>
                </Card>

                {Object.entries(groupByDept(selected?.interventions)).map(([deptName, deptMovs]: [string, any[]], idx) => (
                    <div key={idx} style={{ marginBottom: 32 }}>
                        <Table
                            bordered
                            size="small"
                            pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                            scroll={{ x: 1100 }}
                            dataSource={deptMovs}
                            rowKey={(mov: any) => mov.id || `${mov.smmeCompanyName}-${mov.interventionTitle}-${mov.interventionDate}`}
                            columns={[
                                { title: 'Beneficiary', dataIndex: 'smmeCompanyName', width: 180 },
                                { title: 'Intervention', dataIndex: 'interventionTitle', width: 220 },
                                { title: 'Facilitator', dataIndex: 'facilitatorName', width: 160 },
                                {
                                    title: 'Date Completed',
                                    dataIndex: 'interventionDate',
                                    width: 120,
                                    render: (val: any, row: any) => {
                                        const source = val || row?.periodStart || row?.assignmentCreatedAt || row?.createdAt
                                        const date = typeof source?.toDate === 'function' ? source.toDate() : source
                                        return dayjs(date).isValid() ? dayjs(date).format('YYYY-MM-DD') : '—'
                                    }
                                },
                                {
                                    title: 'Facilitator Signature',
                                    dataIndex: 'facilitatorSignatureUrl',
                                    width: 170,
                                    render: (_: any, mov: MovDoc) => {
                                        const safe = normalizeImageUrl(mov.facilitatorSignatureUrl)
                                        const tip = signatureIssueTooltip({
                                            label: 'Facilitator signature not found'
                                        })

                                        if (safe) return <img src={safe} alt="Facilitator Signature" style={sigImgStyle} />

                                        return (
                                            <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tip}</pre>}>
                                                <span style={{ color: '#999', cursor: 'help' }}>—</span>
                                            </Tooltip>
                                        )
                                    }
                                },
                                {
                                    title: 'SMME Signature',
                                    dataIndex: 'smmeSignatureUrl',
                                    width: 170,
                                    render: (_: any, mov: MovDoc) => {
                                        const safe = normalizeImageUrl(mov.smmeSignatureUrl)
                                        const tip = signatureIssueTooltip({
                                            label: 'SMME signature not found'
                                        })

                                        if (safe) return <img src={safe} alt="SMME Signature" style={sigImgStyle} />

                                        return (
                                            <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{tip}</pre>}>
                                                <span style={{ color: '#999', cursor: 'help' }}>—</span>
                                            </Tooltip>
                                        )
                                    }
                                },
                                {
                                    title: 'POE Status',
                                    width: 120,
                                    render: (_: any, mov: MovDoc) => {
                                        const hasLocalPoe =
                                            isPreIncMov(mov) ||
                                            (Array.isArray(mov.poeUrls) && mov.poeUrls.length > 0)
                                        const packValidation = getPoeValidation(selected, mov.id)
                                        const rowValidation = getSingleMovValidation(mov)
                                        const openRowQuery = hasOpenPoeQuery(mov.id)

                                        if (!hasLocalPoe) {
                                            return <Tag color="default" style={{ margin: 0, fontWeight: 500 }}>CHECK</Tag>
                                        }

                                        if (openRowQuery) {
                                            return <Tag color="volcano" style={{ margin: 0, fontWeight: 500 }}>QUERY</Tag>
                                        }

                                        if (packValidation?.status === 'validated' || rowValidation?.status === 'validated') {
                                            return <Tag color="green" style={{ margin: 0, fontWeight: 500 }}>VALID</Tag>
                                        }

                                        return <Tag color="orange" style={{ margin: 0, fontWeight: 500 }}>PENDING</Tag>
                                    }
                                },
                                {
                                    title: 'Actions',
                                    width: 160,
                                    render: (_: any, mov: MovDoc) => {
                                        const v = getPoeValidation(selected, mov.id)
                                        const validated = v?.status === 'validated'
                                        const blockedByQuery = hasOpenPoeQuery(mov.id)

                                        return (
                                            <Space size={8}>
                                                <Tooltip title="Open MOV">
                                                    <Button
                                                        style={poeActionIconBtn}
                                                        color="blue"
                                                        variant="filled"
                                                        icon={<FileDoneOutlined />}
                                                        loading={openingMovId === String(mov.id || '')}
                                                        disabled={openingMovId !== null}
                                                        onClick={() => handleOpenSingleMov(mov)}
                                                    />
                                                </Tooltip>

                                                <Tooltip
                                                    title={
                                                        isPreIncMov(mov)
                                                            ? 'View Pre-Inc Agreement'
                                                            : Array.isArray(mov.poeUrls) && mov.poeUrls.length > 1
                                                                ? `View POEs (${mov.poeUrls.length})`
                                                                : 'View POE'
                                                    }
                                                >
                                                    <Button
                                                        style={poeActionIconBtn}
                                                        color="cyan"
                                                        variant="filled"
                                                        icon={<FileSearchOutlined />}
                                                        loading={preIncViewerLoadingId === String(mov.id || '')}
                                                        onClick={() => {
                                                            if (isPreIncMov(mov)) {
                                                                void openPreIncPoe(mov)
                                                                return
                                                            }

                                                            void openPoeViewer(mov)
                                                        }}
                                                    />
                                                </Tooltip>

                                                <Tooltip
                                                    title={
                                                        myRole !== 'operations'
                                                            ? 'Only M&E can validate'
                                                            : getSingleMovValidation(mov)
                                                                ? 'Already signed by M&E'
                                                                : 'Sign single MOV as M&E'
                                                    }
                                                >
                                                    <Button
                                                        style={poeActionIconBtn}
                                                        color="green"
                                                        variant="filled"
                                                        icon={<SafetyCertificateOutlined />}
                                                        loading={openingMovId === String(mov.id || '')}
                                                        disabled={
                                                            openingMovId !== null ||
                                                            !!getSingleMovValidation(mov) ||
                                                            myRole !== 'operations'
                                                        }
                                                        onClick={() => handleOpenSingleMov(mov)}
                                                    />
                                                </Tooltip>

                                                <Tooltip title="Query POE">
                                                    <Button
                                                        style={poeActionIconBtn}
                                                        color="orange"
                                                        variant="filled"
                                                        icon={<InfoCircleOutlined />}
                                                        onClick={() => openPoeQuery(mov)}
                                                    />
                                                </Tooltip>
                                            </Space>
                                        )
                                    }
                                }
                            ]}
                        />
                    </div>
                ))}

                <Card size="small" style={{ marginBottom: 20, border: '1px solid #d6e4ff' }}>
                    <Row gutter={[16, 16]} align="top">
                        <Col xs={24} md={12}>
                            <Text strong>M&E (Operations):</Text>{' '}
                            <Text>{hasValidation ? meName : 'Pending validation'}</Text>

                            <div style={{ marginTop: 8 }}>
                                <Text type="secondary">Signature:</Text>{' '}
                                {meSigUrl ? (
                                    <img
                                        src={meSigUrl}
                                        alt="M&E Signature"
                                        style={{
                                            maxHeight: 48,
                                            maxWidth: 180,
                                            objectFit: 'contain',
                                            border: '1px solid #eee',
                                            borderRadius: 4,
                                            padding: 2,
                                            verticalAlign: 'middle',
                                            marginLeft: 8
                                        }}
                                    />
                                ) : (
                                    <Text style={{ marginLeft: 8 }}>
                                        {hasValidation ? 'Signature missing' : 'Awaiting validation'}
                                    </Text>
                                )}
                            </div>
                        </Col>

                        <Col xs={24} md={12} style={{ textAlign: 'right' }}>
                            <Text strong>HOD:</Text> <Text>{getApproval(selected, 'hod_submission')?.name || '—'}</Text>
                            <div style={{ marginTop: 8 }}>
                                <Text type="secondary">Signature:</Text>{' '}
                                {selected?.hodSignatureUrl ? (
                                    <img
                                        src={selected.hodSignatureUrl}
                                        alt="HOD Signature"
                                        style={{
                                            maxHeight: 48,
                                            maxWidth: 180,
                                            objectFit: 'contain',
                                            border: '1px solid #eee',
                                            borderRadius: 4,
                                            padding: 2,
                                            verticalAlign: 'middle',
                                            marginLeft: 8
                                        }}
                                    />
                                ) : (
                                    <Text style={{ marginLeft: 8 }}>—</Text>
                                )}
                            </div>
                        </Col>
                    </Row>
                </Card>
            </Modal>

            <PreIncubationContractModal
                open={!!preIncViewer}
                participantId={preIncViewer?.participantId || ''}
                applicationId={preIncViewer?.applicationId || ''}
                onClose={() => setPreIncViewer(null)}
                onSigned={async () => undefined}
                readOnly
                signedMeta={preIncViewer?.signedMeta}
                viewerRole="operations"
            />

            <Modal
                open={poeViewerOpen}
                title={`Proof of Execution${poeViewerUrls.length ? ` (${poeViewerUrls.length})` : ''}`}
                onCancel={closePoeViewer}
                footer={[
                    <Button key="close" onClick={closePoeViewer}>
                        Close
                    </Button>
                ]}
                width={760}
                destroyOnClose
            >
                {poeViewerLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                        <Spin />
                    </div>
                ) : !poeViewerUrls.length ? (
                    <Empty description="No POEs found for this MOV." />
                ) : (
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        {poeViewerRow ? (
                            <Card size="small" style={{ background: '#fafafa' }}>
                                <Space direction="vertical" size={2}>
                                    <Text strong>
                                        {poeViewerRow.smmeCompanyName || poeViewerRow.smmeName || 'Beneficiary'}
                                    </Text>
                                    <Text type="secondary">
                                        {poeViewerRow.interventionTitle || 'Intervention'}
                                    </Text>
                                </Space>
                            </Card>
                        ) : null}

                        {pagedPoeViewerUrls.map((url, index) => {
                            const absoluteIndex =
                                (poeViewerPage - 1) * POE_PAGE_SIZE + index

                            return (
                                <Card
                                    key={url}
                                    size="small"
                                    style={{
                                        borderRadius: 10,
                                        border: '1px solid #f0f0f0'
                                    }}
                                >
                                    <Row align="middle" justify="space-between" gutter={[12, 8]}>
                                        <Col flex="auto">
                                            <Text strong>{`POE ${absoluteIndex + 1}`}</Text>
                                        </Col>
                                        <Col>
                                            <Button
                                                color="cyan"
                                                variant="filled"
                                                icon={<FileSearchOutlined />}
                                                onClick={() => window.open(url, '_blank')}
                                            >
                                                View POE
                                            </Button>
                                        </Col>
                                    </Row>
                                </Card>
                            )
                        })}

                        {poeViewerUrls.length > POE_PAGE_SIZE ? (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    marginTop: 8
                                }}
                            >
                                <Pagination
                                    current={poeViewerPage}
                                    pageSize={POE_PAGE_SIZE}
                                    total={poeViewerUrls.length}
                                    showSizeChanger={false}
                                    onChange={setPoeViewerPage}
                                />
                            </div>
                        ) : null}
                    </Space>
                )}
            </Modal>

            <Modal
                open={confirmOnBehalfOpen}
                title="Confirm on Behalf of Center Coordinator"
                okText="Confirm on Behalf"
                okButtonProps={{ loading: confirmingOnBehalf }}
                onOk={handleConfirmOnBehalf}
                onCancel={() => {
                    setConfirmOnBehalfOpen(false)
                    confirmOnBehalfForm.resetFields()
                }}
                destroyOnClose
            >
                <Alert
                    type="warning"
                    showIcon
                    message="This action will be recorded as an M&E confirmation performed on behalf of the Center Coordinator."
                    style={{ marginBottom: 16 }}
                />
                <Form form={confirmOnBehalfForm} layout="vertical" preserve={false}>
                    <Form.Item
                        name="reason"
                        label="Reason for confirming on behalf of the CC"
                        rules={[
                            { required: true, whitespace: true, message: 'Please provide a reason.' },
                            { min: 10, message: 'Please provide a meaningful reason of at least 10 characters.' }
                        ]}
                    >
                        <Input.TextArea
                            rows={4}
                            maxLength={500}
                            showCount
                            placeholder="Explain why the Center Coordinator cannot confirm this MOV pack."
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                open={queryModalOpen}
                title="Raise M&E Query (POE)"
                onCancel={() => {
                    setQueryModalOpen(false)
                    setSelectedPoeRow(null)
                    queryForm.resetFields()
                }}
                destroyOnClose
                footer={[
                    <Button
                        key="close"
                        danger
                        style={roundBtn}
                        onClick={() => {
                            setQueryModalOpen(false)
                            setSelectedPoeRow(null)
                            queryForm.resetFields()
                        }}
                    >
                        Close
                    </Button>,
                    <Tooltip key="submitTip" title={!selected ? 'Select a pack first' : ''}>
                        <Button
                            key="submit"
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            style={roundBtn}
                            loading={querySubmitting}
                            disabled={!selected}
                            onClick={handleSubmitQuery}
                        >
                            Submit Query
                        </Button>
                    </Tooltip>
                ]}
            >
                {!selected ? (
                    <Spin />
                ) : (
                    <>
                        <Alert
                            type="info"
                            showIcon
                            message="This query is tied to a single intervention row (POE-level)."
                            style={{ marginBottom: 12 }}
                        />

                        <Form form={queryForm} layout="vertical" preserve={false}>
                            <Form.Item label="Department">
                                <Input
                                    value={
                                        selectedPoeRow?.departmentName ||
                                        selected?.department ||
                                        selected?.interventions?.[0]?.departmentName ||
                                        ''
                                    }
                                    disabled
                                />
                            </Form.Item>

                            <Form.Item label="Beneficiary">
                                <Input value={selectedPoeRow?.smmeCompanyName || selectedPoeRow?.smmeName || ''} disabled />
                            </Form.Item>

                            <Form.Item label="Intervention">
                                <Input value={selectedPoeRow?.interventionTitle || ''} disabled />
                            </Form.Item>

                            <Form.Item
                                name="reason"
                                label="Describe the issue"
                                rules={[{ required: true, message: 'Please provide details' }]}
                            >
                                <Input.TextArea rows={4} placeholder="What is wrong with this specific POE?" />
                            </Form.Item>
                        </Form>
                    </>
                )}
            </Modal>

            <Modal
                open={queriesModalOpen}
                title="M&E Queries"
                onCancel={() => setQueriesModalOpen(false)}
                footer={[
                    <Button key="close" onClick={() => setQueriesModalOpen(false)}>
                        Close
                    </Button>
                ]}
                width={1260}
            >
                {queriesLoading ? (
                    <Spin />
                ) : packQueries.length ? (
                    <Table
                        rowKey="id"
                        dataSource={packQueries}
                        pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                        columns={[
                            {
                                title: 'Status',
                                render: (q: InhouseQueryDoc) => (
                                    <Tag color={isOpenStatus(q.status) ? 'volcano' : 'green'}>
                                        {String(q.status || 'unknown').toUpperCase()}
                                    </Tag>
                                )
                            },
                            { title: 'Raised By', render: (q: InhouseQueryDoc) => q.raisedByName || q.raisedByEmail || '—' },
                            {
                                title: 'Received By',
                                render: (q: InhouseQueryDoc) => getQueryRecipientLabel(q)
                            },
                            { title: 'Message', dataIndex: 'queryMessage', render: (v: any) => v || '—' },
                            {
                                title: 'Response Notes',
                                render: (q: InhouseQueryDoc) =>
                                    isResolvedStatus(q.status)
                                        ? String(q.resolutionNotes || '').trim() || 'No notes captured'
                                        : '—'
                            },
                            {
                                title: 'Created',
                                dataIndex: 'createdAt',
                                render: (v: any) => formatDateTime(v)
                            },
                            {
                                title: 'Replied By',
                                render: (q: InhouseQueryDoc) => getQueryReplyLabel(q)
                            },
                            {
                                title: 'Replied',
                                render: (q: InhouseQueryDoc) => formatDateTime(getQueryReplyAt(q))
                            },
                            {
                                title: 'Turnaround',
                                render: (q: InhouseQueryDoc) =>
                                    formatTurnaround(
                                        q.createdAt,
                                        getQueryReplyAt(q)
                                    )
                            },
                            {
                                title: 'Actions',
                                render: (q: InhouseQueryDoc) => (
                                    <Space>
                                        <Button
                                            size="small"
                                            disabled={!isOpenStatus(q.status)}
                                            onClick={() => {
                                                setSelectedQuery(q)
                                                setResolveModalOpen(true)
                                            }}
                                        >
                                            Mark Resolved
                                        </Button>
                                    </Space>
                                )
                            }
                        ]}
                    />
                ) : (
                    <Alert type="info" showIcon message="No M&E queries found for this pack." />
                )}
            </Modal>

            <Modal
                open={resolveModalOpen}
                title="Resolve Query"
                onCancel={() => {
                    setResolveModalOpen(false)
                    setSelectedQuery(null)
                    resolveForm.resetFields()
                }}
                onOk={handleResolveQuery}
                okButtonProps={{ loading: resolving }}
                destroyOnClose
            >
                {!selectedQuery ? (
                    <Spin />
                ) : (
                    <>
                        <Alert
                            type="info"
                            showIcon
                            message={
                                <div>
                                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Query</div>
                                    <div>{selectedQuery.queryMessage || '—'}</div>
                                </div>
                            }
                            style={{ marginBottom: 12 }}
                        />
                        <Form form={resolveForm} layout="vertical" preserve={false}>
                            <Form.Item name="resolutionNotes" label="Resolution notes (optional)">
                                <Input.TextArea rows={4} placeholder="What was checked or corrected to resolve this query?" />
                            </Form.Item>
                        </Form>
                    </>
                )}
            </Modal>

            <Modal
                open={timelineModalVisible}
                onCancel={() => {
                    setTimelineModalVisible(false)
                    setShowAllTimeline(false)
                }}
                footer={[
                    <Button
                        key="toggle"
                        variant="filled"
                        color="green"
                        shape="round"
                        style={{ border: '1px solid green' }}
                        onClick={() => setShowAllTimeline(prev => !prev)}
                        disabled={timelineItems.length <= 8}
                    >
                        {showAllTimeline ? 'Show Recent Only' : `Show All (${timelineItems.length})`}
                    </Button>,
                    <Button
                        key="close"
                        variant="filled"
                        color="red"
                        shape="round"
                        style={{ border: '1px solid red' }}
                        onClick={() => {
                            setTimelineModalVisible(false)
                            setShowAllTimeline(false)
                        }}
                    >
                        Close
                    </Button>
                ]}
                title={`Timeline (${timelineItems.length})`}
                width={820}
            >
                <div
                    style={{
                        maxHeight: 520,
                        overflowY: 'auto',
                        padding: 10
                    }}
                >
                    {timelineItems.length ? (
                        <Timeline
                            items={visibleTimelineItems.map((t, idx) => ({
                                color: t.color || 'gray',
                                children: (
                                    <div key={idx} style={{ paddingBottom: 8 }}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'baseline',
                                                justifyContent: 'space-between',
                                                gap: 12,
                                                flexWrap: 'wrap'
                                            }}
                                        >
                                            <div style={{ fontWeight: 600 }}>{t.label}</div>
                                            <div style={{ fontSize: 12, color: '#666' }}>
                                                {dayjs(t.at).format('YYYY-MM-DD HH:mm')}
                                            </div>
                                        </div>

                                        {t.detail ? (
                                            <div
                                                style={{
                                                    color: '#444',
                                                    marginTop: 4,
                                                    lineHeight: 1.45,
                                                    wordBreak: 'break-word'
                                                }}
                                            >
                                                {t.detail}
                                            </div>
                                        ) : null}
                                    </div>
                                )
                            }))}
                        />
                    ) : (
                        <Empty description="No timeline events found." />
                    )}
                </div>
            </Modal>
        </div>
    )
}

export default MonitoringMOVApprovals
