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
    Pagination,
    Popconfirm,
    Empty
} from 'antd'
import {
    collection,
    getDocs,
    query,
    where,
    updateDoc,
    doc,
    addDoc,
    getDoc,
    limit,
    orderBy,
    QueryConstraint
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import {
    FileDoneOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    HistoryOutlined,
    ClockCircleOutlined,
    SafetyCertificateOutlined,
    QuestionCircleOutlined,
    InfoCircleOutlined,
    DeleteOutlined
} from '@ant-design/icons'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { ConsolidatedMOVReviewModal } from '@/components/movs/ConsolidatedMOVReviewModal'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { filterMovRecords } from '@/utils/reportVisibility'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { Helmet } from 'react-helmet'
import { roundBtn } from '@/components/shared/StyledButton'
import { workflowQueryService } from '@/services/workflowQueryService'
import { getPreIncAgreementUrl, hasPreIncAgreementEvidence, isOnboardingMov } from '@/services/movService'

const { Text } = Typography
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
    facilitatorSignatureUrl?: string
    facilitatorDigitalSignature?: string

    signatureURL?: string
    digitalSignature?: string

    beneficiaryId?: string
    smmeId?: string
    participantId?: string
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
    preIncubationAgreementMeta?: any
    preIncubationAgreement?: boolean
    resources?: any[]
}

type QueryDoc = {
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

    targetType?: 'pack' | 'poe'
    movRowId?: string | null
    participantId?: string | null
    interventionId?: string | null
    poeUrl?: string | null
    departmentName?: string | null
}

import { extractPoeUrls } from '@/services/poeService'

const toJsDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const sortMovRows = <T extends Record<string, any>>(rows: T[]) => [...rows].sort((a, b) => {
    const dateDiff = (toJsDate(b.smmeAcceptedAt || b.smmeSignedAt || b.periodEnd)?.getTime() || 0) -
        (toJsDate(a.smmeAcceptedAt || a.smmeSignedAt || a.periodEnd)?.getTime() || 0)
    if (dateDiff) return dateDiff
    return String(a.smmeCompanyName || a.smmeName || '').localeCompare(String(b.smmeCompanyName || b.smmeName || ''), undefined, { sensitivity: 'base' })
})

const sortPackRows = <T extends Record<string, any>>(rows: T[]) => [...rows].sort((a, b) => {
    const monthDiff = String(b.month || '').localeCompare(String(a.month || ''))
    if (monthDiff) return monthDiff
    return String(a.departmentName || '').localeCompare(String(b.departmentName || ''), undefined, { sensitivity: 'base' })
})

const isOpenStatus = (s?: any) => String(s || '').toLowerCase() === 'open'
const isResolvedStatus = (s?: any) => String(s || '').toLowerCase() === 'resolved'

const collectPoeUrlsFromRecord = (record?: any): string[] => {
    return Array.isArray(record?.resources)
        ? record.resources.map((resource: any) => resource?.link || resource?.url || resource?.href).filter(Boolean)
        : []
}

const uniq = (arr: string[]) =>
    Array.from(
        new Set(
            arr
                .map(value => String(value || '').trim())
                .filter(value => value.startsWith('http'))
        )
    )

const getLatestPoeUrlsForMovRow = async (
    row: MovDoc,
    ctx: { programId: string }
): Promise<string[]> => {
    const urls: string[] = []

    const participantId =
        (row as any).participantId ||
        row.beneficiaryId ||
        row.smmeId ||
        null

    const assignedInterventionId =
        row.assignedInterventionId ||
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

    if (!urls.length && assignedInterventionId) {
        const assignedSnap = await getDoc(
            doc(db, 'assignedInterventions', assignedInterventionId)
        )
        if (assignedSnap.exists()) {
            mergeUrls({ id: assignedSnap.id, ...assignedSnap.data() })
        }
    }

    return uniq(urls)
}

/**
 * Hydrates missing signatures/names and resolves the latest canonical POE list.
 */
const hydrateMovPeople = async (
    base: MovDoc,
    ctx: { programId: string }
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

    const pId = out.participantId || out.beneficiaryId || out.smmeId
    const onboardingMov = isOnboardingMov(out)
    let participantData: any = null
    if (pId && (!out.smmeCompanyName || !out.smmeName || onboardingMov)) {
        const pDoc = await getDoc(doc(db, 'participants', pId))
        if (pDoc.exists()) {
            participantData = pDoc.data() as any
            out.smmeCompanyName = out.smmeCompanyName || participantData.companyName || participantData.businessName || ''
            out.smmeName = out.smmeName || participantData.name || participantData.ownerName || ''
        }
    }

    // ROM onboarding MOVs prove completion via the participant's signed
    // Pre-Incubation Agreement rather than an uploaded POE file - that
    // agreement lives on the participant/application record, not on this MOV
    // document, so it has to be resolved here for PreIncPoeButton to find it.
    if (onboardingMov && !out.preIncubationAgreementMeta) {
        try {
            let applicationData: any = null
            if (pId) {
                const appSnap = await getDocs(
                    query(collection(db, 'applications'), where('participantId', '==', pId), limit(1))
                )
                if (!appSnap.empty) applicationData = appSnap.docs[0].data()
            }
            const meta =
                applicationData?.signedAgreements?.['pre-incubation-contract'] ||
                participantData?.signedAgreements?.['pre-incubation-contract'] ||
                null
            if (meta) out.preIncubationAgreementMeta = meta
        } catch (e) {
            console.error('Failed to hydrate Pre-Incubation Agreement for MOV', base.id, e)
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
                const assignmentSnap = await getDocs(
                    query(
                        collection(db, 'assignedInterventions'),
                        where('interventionId', '==', out.interventionId),
                        where('participantId', '==', pId),
                        where('programId', '==', ctx.programId),
                        limit(1)
                    )
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
        const urls = await getLatestPoeUrlsForMovRow(out, ctx)
        // getLatestPoeUrlsForMovRow only looks at the linked assignedInterventions
        // doc's resources - it finds nothing at all for a MOV with no
        // assignedInterventionId, and evidence uploaded straight onto the MOV
        // itself (out.resources) was never checked here either. Worse, this
        // used to unconditionally overwrite out.poeUrls with that empty
        // result even when the MOV document already had a perfectly good
        // poeUrls array stored on it, erasing it on every hydrate. Fall back
        // through resources, then the MOV's own already-stored poeUrls.
        const ownResourceUrls = collectPoeUrlsFromRecord(out)
        const storedUrls = Array.isArray(base.poeUrls) ? uniq(base.poeUrls) : []
        out.poeUrls = urls.length ? urls : (ownResourceUrls.length ? ownResourceUrls : storedUrls)
    } catch (e) {
        console.error('Failed to hydrate POEs for MOV', base.id, e)
    }

    if (hasPreIncAgreementEvidence(out)) {
        const preIncUrl = getPreIncAgreementUrl(out)
        if (preIncUrl && !(out.poeUrls || []).includes(preIncUrl)) {
            out.poeUrls = [...(out.poeUrls || []), preIncUrl]
        }
    }

    return out
}

const modalFooterStyle: React.CSSProperties = {
    display: 'flex',
    width: '100%',
    gap: 8,

}

const modalFooterButtonStyle: React.CSSProperties = {
    ...roundBtn,
    flex: 1,
    marginInlineStart: 0
}

const CoordinatorMOVApprovals: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [loading, setLoading] = useState(false)
    const [showAllTimeline, setShowAllTimeline] = useState(false)


    const [packs, setPacks] = useState<any[]>([])
    const [filtered, setFiltered] = useState<any[]>([])
    const [viewMode, setViewMode] = useState<'packs' | 'movs'>('packs')

    const [movDocs, setMovDocs] = useState<any[]>([])
    const [filteredMovs, setFilteredMovs] = useState<any[]>([])

    const [selectedDept, setSelectedDept] = useState<string>('all')
    // Defaults to the current month so the metrics/table open scoped to
    // "right now" instead of an undifferentiated all-time view.
    const [selectedMonth, setSelectedMonth] = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed'>('all')
    const hasAppliedDefaultMonthRef = useRef(false)

    const [selected, setSelected] = useState<any | null>(null)
    const [modalVisible, setModalVisible] = useState(false)
    const [movViewerOpen, setMovViewerOpen] = useState(false)
    const [movToView, setMovToView] = useState<any | null>(null)

    const [timelineModalVisible, setTimelineModalVisible] = useState(false)

    const [queryModalOpen, setQueryModalOpen] = useState(false)
    const [querySubmitting, setQuerySubmitting] = useState(false)
    const [queryForm] = Form.useForm()

    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [queriesLoading, setQueriesLoading] = useState(false)
    const [packQueries, setPackQueries] = useState<QueryDoc[]>([])

    const [resolveModalOpen, setResolveModalOpen] = useState(false)
    const [resolving, setResolving] = useState(false)
    const [resolveForm] = Form.useForm()
    const [selectedQuery, setSelectedQuery] = useState<QueryDoc | null>(null)

    const [selectedPoeRow, setSelectedPoeRow] = useState<MovDoc | null>(null)

    const [poeViewerOpen, setPoeViewerOpen] = useState(false)
    const [poeViewerRow, setPoeViewerRow] = useState<MovDoc | null>(null)
    const [poeViewerUrls, setPoeViewerUrls] = useState<string[]>([])
    const [poeViewerLoading, setPoeViewerLoading] = useState(false)
    const [poeViewerPage, setPoeViewerPage] = useState(1)
    const [deletingPoeUrl, setDeletingPoeUrl] = useState<string | null>(null)

    const myUid = user?.uid || user?.id || null
    const myEmail = (user?.email || '').toLowerCase()
    const myRole = String(user?.role || '').toLowerCase()

    const isCoordinator = myRole.includes('coordinator') || myRole.includes('center') || myRole.includes('rom') || myRole.includes('admin')
    const isCC = isCoordinator // alias for readability

    const openPoeViewer = async (row: MovDoc) => {
        if (!activeProgramId) return

        setPoeViewerRow(row)
        setPoeViewerPage(1)
        setPoeViewerOpen(true)
        setPoeViewerLoading(true)

        try {
            const urls = await getLatestPoeUrlsForMovRow(row, {
                programId: activeProgramId
            })
            // getLatestPoeUrlsForMovRow only looks at the linked
            // assignedInterventions doc, so it comes back empty for a MOV
            // with no assignedInterventionId even when the MOV's own
            // resources/poeUrls already have the real evidence (the POE
            // button next to this row uses that same fallback to decide
            // whether to show at all, so the viewer must match it).
            const fallbackUrls = collectPoeUrlsFromRecord(row)
            const storedUrls = Array.isArray(row.poeUrls) ? uniq(row.poeUrls) : []
            setPoeViewerUrls(urls.length ? urls : (fallbackUrls.length ? fallbackUrls : storedUrls))
        } catch (error) {
            console.error('Failed to load POEs:', error)
            setPoeViewerUrls(
                Array.isArray(row.poeUrls)
                    ? uniq(row.poeUrls)
                    : collectPoeUrlsFromRecord(row)
            )
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

    const buildEvidencePatch = (data: any, removedUrl: string, nextUrls: string[]) => {
        const resources = Array.isArray(data?.resources)
            ? data.resources.filter(
                (resource: any) =>
                    String(resource?.link || resource?.url || '').trim() !== removedUrl
            )
            : nextUrls.map((link, index) => ({
                type: 'poe',
                label: `POE ${index + 1}`,
                link
            }))

        return {
            resources,
            updatedAt: new Date()
        }
    }

    const removePoeFromRow = async (row: MovDoc, removedUrl: string) => {
        if (!isCC || deletingPoeUrl || !activeProgramId) return

        const currentUrls = uniq(
            poeViewerUrls.length
                ? poeViewerUrls
                : await getLatestPoeUrlsForMovRow(row, {
                    programId: activeProgramId
                })
        )
        const nextUrls = currentUrls.filter(url => url !== removedUrl)

        if (nextUrls.length === currentUrls.length) return

        try {
            setDeletingPoeUrl(removedUrl)

            const assignedInterventionId =
                row.assignedInterventionId ||
                (row as any).assignedId ||
                (row as any).interventionKey ||
                null

            const writes: Promise<any>[] = []

            if (assignedInterventionId) {
                const assignedRef = doc(db, 'assignedInterventions', assignedInterventionId)
                const assignedSnap = await getDoc(assignedRef)
                if (assignedSnap.exists()) {
                    writes.push(
                        updateDoc(
                            assignedRef,
                            buildEvidencePatch(assignedSnap.data(), removedUrl, nextUrls)
                        )
                    )
                }
            }

            if (row.id) {
                const movRef = doc(db, 'movDocuments', row.id)
                const movSnap = await getDoc(movRef)
                if (movSnap.exists()) {
                    writes.push(
                        updateDoc(
                            movRef,
                            buildEvidencePatch(movSnap.data(), removedUrl, nextUrls)
                        )
                    )
                }
            }

            if (selected?.id && Array.isArray(selected?.interventions)) {
                const nextInterventions = selected.interventions.map((item: any) => {
                    if (String(item?.id || item?.docId || '') !== String(row.id)) return item
                    return {
                        ...item,
                        ...buildEvidencePatch(item, removedUrl, nextUrls)
                    }
                })

                writes.push(
                    updateDoc(doc(db, 'consolidatedMOVs', selected.id), {
                        interventions: nextInterventions
                    })
                )

                setSelected((previous: any) =>
                    previous
                        ? { ...previous, interventions: nextInterventions }
                        : previous
                )
            }

            await Promise.all(writes)

            const patchLocalRow = (item: any) =>
                String(item?.id || '') === String(row.id)
                    ? { ...item, ...buildEvidencePatch(item, removedUrl, nextUrls) }
                    : item

            setMovDocs(previous => previous.map(patchLocalRow))
            setFilteredMovs(previous => previous.map(patchLocalRow))
            setPoeViewerUrls(nextUrls)
            setPoeViewerRow(previous =>
                previous
                    ? { ...previous, ...buildEvidencePatch(previous, removedUrl, nextUrls) }
                    : previous
            )

            message.success('POE removed.')
        } catch (error) {
            console.error(error)
            message.error('Failed to remove POE.')
        } finally {
            setDeletingPoeUrl(null)
        }
    }

    const getApproval = (record: any, step: 'hod_submission' | 'validation' | 'final_confirmation') =>
        (record?.approvals || []).find((a: any) => a.step === step) || null

    const stepExists = (record: any, step: string) =>
        Array.isArray(record?.approvals) && record.approvals.some((a: any) => a.step === step)

    const isCCConfirmationByMe = (record: any) => {
        const approvals = Array.isArray(record?.approvals) ? record.approvals : []
        const v = approvals.find((a: any) => a.step === 'final_confirmation')
        if (!v) return false
        if (myUid && v.userId && String(v.userId) === String(myUid)) return true
        if (myEmail && v.email && String(v.email).toLowerCase() === myEmail) return true
        return false
    }

    const chunk = <T,>(arr: T[], size: number) => {
        const out: T[][] = []
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
        return out
    }

    /**
     * Fetch all queries for a list of pack IDs (CC page shows ALL queries, not just M&E).
     * We only use these to render query badges/indicators.
     */
    const fetchQueriesForPackIds = async (packIds: string[]) => {
        const map = new Map<string, QueryDoc[]>()
        const ids = (packIds || []).filter(Boolean)
        const groups = chunk(ids, 10)

        for (const group of groups) {
            const queryGroups = await Promise.all(
                group.map(consolidatedMovId => workflowQueryService.list({ consolidatedMovId }))
            )

            const docs = queryGroups.flat()
                .map(item => item as QueryDoc)
                .filter(q => {
                    const byUid =
                        myUid &&
                        q.raisedByUser &&
                        String(q.raisedByUser) === String(myUid)

                    const byEmail =
                        myEmail &&
                        q.raisedByEmail &&
                        String(q.raisedByEmail).toLowerCase() === myEmail

                    return !!(byUid || byEmail)
                })

            for (const qd of docs) {
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

    /**
     * Fetch packs that have BOTH:
     * - hod_submission
     * - validation
     *
     * This is the CC lane: only "ready for coordinator confirmation".
     */
    const fetchPacks = async () => {
        if (!activeProgramId) {
            setPacks([])
            setFiltered([])
            return
        }

        setLoading(true)
        try {
            const qRef = query(
                collection(db, 'consolidatedMOVs'),
                where('programId', '==', activeProgramId)
            )
            const snap = await getDocs(qRef)

            const raw = filterMovRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })), user?.email)
            const ready = raw.filter(p => stepExists(p, 'hod_submission'))

            const packIds = ready.map(p => p.id).filter(Boolean)
            const queryMap = packIds.length ? await fetchQueriesForPackIds(packIds) : new Map<string, QueryDoc[]>()

            const enriched = ready.map(p => {
                const qs = queryMap.get(p.id) || []
                const openCount = qs.filter(q => isOpenStatus(q.status)).length
                const totalCount = qs.length
                return { ...p, __queriesTotal: totalCount, __queriesOpen: openCount }
            })

            setPacks(enriched)
            setFiltered(enriched)
        } catch (err) {
            console.error(err)
            message.error('Failed to fetch consolidated packs')
        } finally {
            setLoading(false)
        }
    }

    const fetchMovDocuments = async () => {
        if (!activeProgramId) {
            setMovDocs([])
            setFilteredMovs([])
            return
        }

        setLoading(true)
        try {
            const qRef = query(
                collection(db, 'movDocuments'),
                where('programId', '==', activeProgramId)
            )
            const snap = await getDocs(qRef)

            const rows = await Promise.all(
                snap.docs.map(async d => {
                    const raw = { id: d.id, ...(d.data() as any) }
                    return await hydrateMovPeople(raw, { programId: activeProgramId })
                })
            )
            const visibleRows = filterMovRecords(rows, user?.email)

            setMovDocs(visibleRows)
            setFilteredMovs(visibleRows)
        } catch (err) {
            console.error(err)
            message.error('Failed to fetch MOV documents')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPacks()
        fetchMovDocuments()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProgramId])

    // Scoped by department + month only - this is what the metrics and the
    // progress bar count against, so they track the current filter context
    // (and default to "this month") rather than an all-time, unfiltered total.
    const deptMonthFiltered = useMemo(() => {
        let rows = packs

        if (selectedDept !== 'all') {
            rows = rows.filter(p => p.interventions?.some((i: any) => i.departmentName === selectedDept))
        }

        if (selectedMonth !== 'all') {
            rows = rows.filter(p => p.month === selectedMonth)
        }

        return rows
    }, [packs, selectedDept, selectedMonth])

    useEffect(() => {
        let rows = deptMonthFiltered

        if (statusFilter === 'pending') {
            rows = rows.filter(m => !stepExists(m, 'final_confirmation'))
        } else if (statusFilter === 'confirmed') {
            rows = rows.filter(m => stepExists(m, 'final_confirmation'))
        }

        setFiltered(rows)
    }, [deptMonthFiltered, statusFilter])

    useEffect(() => {
        // simple mirroring of statusFilter for movDocs: show only those without final_confirmation when 'pending'
        let rows = movDocs
        if (statusFilter === 'pending') rows = rows.filter(m => !stepExists(m, 'final_confirmation'))
        else if (statusFilter === 'confirmed') rows = rows.filter(m => stepExists(m, 'final_confirmation'))
        setFilteredMovs(rows)
    }, [movDocs, statusFilter])

    const uniqueDepartments = useMemo(() => {
        return Array.from(
            new Set(packs.flatMap(m => m.interventions?.map((i: any) => i.departmentName)).filter(Boolean))
        )
    }, [packs])

    const allSubmissionsCount = deptMonthFiltered.length

    const pendingConfirmations = useMemo(
        () => deptMonthFiltered.filter(p => !stepExists(p, 'final_confirmation')).length,
        [deptMonthFiltered]
    )

    const confirmedCount = useMemo(
        () => deptMonthFiltered.filter(p => stepExists(p, 'final_confirmation')).length,
        [deptMonthFiltered]
    )

    const toggleStatusFilter = (value: 'pending' | 'confirmed') => {
        setStatusFilter(previous => (previous === value ? 'all' : value))
    }

    // "YYYY-MM" strings sort correctly as plain strings - descending puts the
    // most recent month first, going back through prior months/years.
    const monthOptions = useMemo(
        () => [...new Set(packs.map(p => p.month).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
        [packs]
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

    /**
     * Fetch ALL queries for a pack (CC needs to see everything: HOD/M&E/CC queries).
     */
    const fetchQueriesForPack = async (consolidatedMovId: string) => {
        setQueriesLoading(true)
        try {
            const mine = (await workflowQueryService.list({ consolidatedMovId }))
                .map(item => item as QueryDoc)
                .filter(q => {
                    const byUid =
                        myUid &&
                        q.raisedByUser &&
                        String(q.raisedByUser) === String(myUid)

                    const byEmail =
                        myEmail &&
                        q.raisedByEmail &&
                        String(q.raisedByEmail).toLowerCase() === myEmail

                    return !!(byUid || byEmail)
                })

            setPackQueries(mine)
            return mine
        } catch (err) {
            console.error(err)
            setPackQueries([])
            message.error('Failed to load your queries for this pack')
            return []
        } finally {
            setQueriesLoading(false)
        }
    }

    /**
     * Open pack review.
     * Hydrates row-level docs and loads pack queries.
     */
    const handleReview = async (pack: any) => {
        if (!activeProgramId) return
        setLoading(true)
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
                            rows.push(await hydrateMovPeople(raw, { programId: activeProgramId }))
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
                            { programId: activeProgramId }
                        )
                    )
                )
            }

            const merged = { ...pack, interventions: hydrated }
            setSelected(merged)
            setModalVisible(true)
            await fetchQueriesForPack(pack.id)
        } catch (e) {
            console.error(e)
            setSelected(pack)
            setModalVisible(true)
            await fetchQueriesForPack(pack.id)
        } finally {
            setLoading(false)
        }
    }

    /**
     * Center Coordinator confirms the pack (final_confirmation).
     *
     * NOTE: We are NOT blocking confirmation based on open queries here,
     * Query records are handled through the role-neutral workflow query service.
     * If you want to block confirmation when open queries exist, tell me.
     */
    const handleConfirm = async () => {
        if (!selected) return

        try {
            if (!isCC) {
                message.error('This page is restricted to Center Coordinators.')
                return
            }

            if (stepExists(selected, 'final_confirmation')) {
                message.info('This pack has already been confirmed by the Center Coordinator.')
                return
            }

            const approvals = Array.isArray(selected.approvals) ? selected.approvals : []

            const updates: any = {
                approvals: [
                    ...approvals,
                    {
                        step: 'final_confirmation',
                        name: user?.name || user?.displayName || 'Unknown',
                        role: user?.role || '',
                        userId: myUid,
                        email: myEmail,
                        date: new Date()
                    }
                ],
                status: 'confirmed'
            }

            await updateDoc(doc(db, 'consolidatedMOVs', selected.id), updates)

            message.success('Pack confirmed by Center Coordinator.')
            setModalVisible(false)
            setSelected(null)
            setPackQueries([])
            await fetchPacks()
        } catch (err) {
            console.error(err)
            message.error('Failed to confirm pack.')
        }
    }

    /**
     * Raise a query (pack-level or POE-level) through workflowQueryService.
     * Keeps the same "raisedBy..." fields like before.
     *
     * CC should be able to raise queries too.
     */
    const handleSubmitQuery = async () => {
        if (!selected) {
            message.error('No pack selected')
            return
        }

        try {
            const vals = await queryForm.validateFields()
            const autoUrls =
                selectedPoeRow
                    ? await getLatestPoeUrlsForMovRow(selectedPoeRow, {
                        programId: String(activeProgramId || '')
                    })
                    : []

            setQuerySubmitting(true)

            const hodSubmission = (Array.isArray((selected as any)?.approvals) ? (selected as any).approvals : [])
                .find((item: any) => item?.step === 'hod_submission') || {}
            const resolverRecord: any = selectedPoeRow || {}

            await workflowQueryService.create({
                programId: String(activeProgramId || ''),
                type: selectedPoeRow ? 'cc-poe-query' : 'cc-pack-query',
                message: vals.reason,
                raisedById: myUid,
                raisedBy: {
                    name: user?.name || user?.displayName || null,
                    email: myEmail || null,
                    role: user?.role || null,
                    departmentName: user?.departmentName || null
                },
                resolverId:
                    resolverRecord.facilitatorId ||
                    resolverRecord.consultantId ||
                    resolverRecord.assigneeId ||
                    null,
                resolver: {
                    name:
                        resolverRecord.facilitatorName ||
                        resolverRecord.consultantName ||
                        resolverRecord.assigneeName ||
                        hodSubmission.name ||
                        null,
                    email:
                        resolverRecord.facilitatorEmail ||
                        resolverRecord.consultantEmail ||
                        resolverRecord.assigneeEmail ||
                        null,
                    role: resolverRecord.assigneeRole || resolverRecord.facilitatorRole || hodSubmission.role || null,
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
                    evidenceUrl: autoUrls[0] || null,
                    departmentName: selectedPoeRow?.departmentName || selected?.department || null
                }
            })

            message.success('Query created.')
            setQueryModalOpen(false)
            setSelectedPoeRow(null)
            queryForm.resetFields()

            await fetchQueriesForPack(selected.id)
            await fetchPacks()
        } catch (e) {
            if (!('errorFields' in (e as any))) {
                console.error(e)
                message.error('Failed to submit query')
            }
        } finally {
            setQuerySubmitting(false)
        }
    }

    /**
     * Resolve query (only if I raised it)
     * This matches your previous rule: "only resolve my own queries".
     */
    const handleResolveQuery = async () => {
        if (!selectedQuery?.id) return

        const isMine = myUid && selectedQuery?.raisedByUser && String(selectedQuery.raisedByUser) === String(myUid)
        if (!isMine) {
            message.warning('You can only resolve queries you raised.')
            return
        }

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
                    departmentName: user?.departmentName || null
                }
            })

            message.success('Query marked as resolved.')

            setResolveModalOpen(false)
            setSelectedQuery(null)
            resolveForm.resetFields()

            if (selected?.id) await fetchQueriesForPack(selected.id)
            await fetchPacks()
        } catch (e) {
            console.error(e)
            message.error('Failed to resolve query')
        } finally {
            setResolving(false)
        }
    }

    const statusTag = (record: any) => {
        const hod = getApproval(record, 'hod_submission')
        const v = getApproval(record, 'validation')
        const cc = getApproval(record, 'final_confirmation')

        const statusMap: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
            cc: {
                color: 'green',
                icon: <CheckCircleOutlined />,
                label: `CC Approved${cc?.name ? ` • ${cc.name}` : ''}`
            },
            validated: {
                color: 'blue',
                icon: <SafetyCertificateOutlined />,
                label: `Validated${v?.name ? ` • ${v.name}` : ''}`
            },
            pending: {
                color: 'orange',
                icon: <ClockCircleOutlined />,
                label: 'Pending CC Confirmation'
            }
        }

        const key = cc ? 'cc' : 'pending'
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
        const open = Number(record?.__queriesOpen || 0)
        const total = Number(record?.__queriesTotal || 0)

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

    const openPoeQuery = async (row: MovDoc) => {
        setSelectedPoeRow(row)
        setQueryModalOpen(true)

        const urls =
            activeProgramId
                ? await getLatestPoeUrlsForMovRow(row, {
                    programId: activeProgramId
                })
                : []

        queryForm.setFieldsValue({
            reason: '',
            poeTarget: row?.interventionTitle || '',
            poeUrl: urls[0] || ''
        })
    }

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
        {
            title: 'Queries',
            render: (_: any, record: any) => queryTag(record)
        },
        {
            title: 'Actions',
            render: (_: any, record: any) => {
                const hasAnyQueries = Number(record?.__queriesTotal || 0) > 0

                return (
                    <Space>
                        <Tooltip title="Review">
                            <Button icon={<FileSearchOutlined />} onClick={() => handleReview(record)} />
                        </Tooltip>

                        <Tooltip title="View Timeline">
                            <Button
                                icon={<HistoryOutlined />}
                                onClick={async () => {
                                    setSelected(record)
                                    await fetchQueriesForPack(record.id)
                                    setTimelineModalVisible(true)
                                }}
                            />
                        </Tooltip>

                        <Tooltip title="View Queries">
                            <Button
                                icon={<QuestionCircleOutlined />}
                                disabled={!hasAnyQueries}
                                onClick={async () => {
                                    setSelected(record)
                                    await fetchQueriesForPack(record.id)
                                    setQueriesModalOpen(true)
                                }}
                            />
                        </Tooltip>
                    </Space>
                )
            }
        }
    ]

    const selectedHasCC = selected ? stepExists(selected, 'final_confirmation') : false
    const openQueriesOnSelected = useMemo(() => (packQueries || []).filter(q => isOpenStatus(q.status)).length, [packQueries])

    const confirmDisabled =
        !selected ||
        selectedHasCC ||
        !isCC

    const confirmDisabledReason = (() => {
        if (!selected) return 'Select a pack first'
        if (!isCC) return 'Only Center Coordinators can confirm on this page'
        if (selectedHasCC) return 'This pack has already been confirmed'
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
                detail: a?.name || 'Unknown',
                color: 'green'
            })
        }

        for (const q of packQueries || []) {
            const created = toJsDate(q.createdAt)
            if (created) {
                items.push({
                    at: created,
                    label: 'Query Raised',
                    detail: `${q.raisedByName || 'User'} • ${String(q.queryMessage || '').trim()}`,
                    color: 'red'
                })
            }

            if (isResolvedStatus(q.status)) {
                const resolvedAt = toJsDate(q.updatedAt)
                if (resolvedAt) {
                    items.push({
                        at: resolvedAt,
                        label: 'Query Resolved',
                        detail: q.resolutionNotes ? `Notes: ${q.resolutionNotes}` : 'Resolved',
                        color: 'green'
                    })
                }
            }
        }

        items.sort((a, b) => a.at.getTime() - b.at.getTime())
        return items
    }, [selected, packQueries])

    const visibleTimelineItems = useMemo(() => {
        if (showAllTimeline) return timelineItems
        return timelineItems.slice(-8)
    }, [timelineItems, showAllTimeline])

    const vApproval = getApproval(selected, 'validation')
    const hodApproval = getApproval(selected, 'hod_submission')
    const ccApproval = getApproval(selected, 'final_confirmation')

    const validationName = vApproval?.name || selected?.monitoringName || '—'
    const validationSigUrl = selected?.monitoringSignatureUrl || ''

    const hodName = hodApproval?.name || selected?.hodName || '—'
    const hodSigUrl = selected?.hodSignatureUrl || ''

    const ccName =
        ccApproval?.name ||
        user?.name ||
        user?.displayName ||
        '—'

    const ccSigUrl =
        selected?.ccSignatureUrl ||
        user?.signatureURL ||
        user?.signatureUrl ||
        user?.digitalSignature ||
        ''

    const rowActionPillStyle: React.CSSProperties = {
        ...roundBtn,
        height: 30,
        paddingInline: 12,
        marginInlineStart: 0
    }

    const getCoordinatorPoeCount = (mov: MovDoc) => {
        const direct = Array.isArray(mov.poeUrls) ? uniq(mov.poeUrls).length : 0
        const resources = collectPoeUrlsFromRecord(mov).length
        if (direct || resources) return Math.max(direct, resources)
        return hasPreIncAgreementEvidence(mov) ? 1 : 0
    }

    const hasCoordinatorOpenRowQuery = (mov: MovDoc) =>
        (packQueries || []).some(
            q =>
                q.targetType === 'poe' &&
                String(q.movRowId || '') === String(mov.id || '') &&
                isOpenStatus(q.status)
        )

    const getCoordinatorReviewState = (mov: MovDoc) => {
        const hasEvidence = getCoordinatorPoeCount(mov) > 0

        if (hasCoordinatorOpenRowQuery(mov)) {
            return { label: 'Query Open', color: 'volcano', tone: 'error' as const }
        }

        if (!hasEvidence) {
            return { label: 'Evidence Missing', color: 'orange', tone: 'warning' as const }
        }

        if (selectedHasCC) {
            return { label: 'Confirmed', color: 'green', tone: 'success' as const }
        }

        return { label: 'Ready for Confirmation', color: 'blue', tone: 'processing' as const }
    }


    // A 1px borderColor override alone reads too close to the card's own hover
    // border, so a hovered-but-unselected card can look "selected" too. Selection
    // needs its own unmistakable treatment: a thicker border plus a tinted fill.
    const activeMetricStyle = (rgb: string): React.CSSProperties => ({
        border: `2px solid rgb(${rgb})`,
        background: `rgba(${rgb},0.08)`
    })

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>Coordinator MOV Approvals | Smart Incubation</title>
            </Helmet>

            <MetricsGrid metrics={[
                {
                    key: 'all',
                    title: 'All Submissions',
                    value: allSubmissionsCount,
                    icon: <FileSearchOutlined />,
                    iconBg: '#f0f5ff',
                    loading,
                    onClick: () => setStatusFilter('all'),
                    wrapperStyle: statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                },
                {
                    key: 'pending',
                    title: 'Pending Confirmation',
                    value: pendingConfirmations,
                    icon: <FileDoneOutlined />,
                    iconBg: '#e6f4ff',
                    loading,
                    onClick: () => toggleStatusFilter('pending'),
                    wrapperStyle: statusFilter === 'pending'
                        ? activeMetricStyle('250,173,20')
                        : statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                },
                {
                    key: 'confirmed',
                    title: 'Confirmed',
                    value: confirmedCount,
                    icon: <CheckCircleOutlined />,
                    iconBg: '#f6ffed',
                    loading,
                    onClick: () => toggleStatusFilter('confirmed'),
                    wrapperStyle: statusFilter === 'confirmed'
                        ? activeMetricStyle('82,196,26')
                        : statusFilter !== 'all' ? { opacity: 0.6 } : undefined
                }
            ]} />

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <Row gutter={[16, 16]} style={{ marginTop: 10 }} align="stretch">
                    <Col xs={24} lg={14}>
                        <MotionCard loading={loading} size="small" style={{ height: '100%' }}>
                            <div aria-label="Pack confirmation proportion" style={{ display: 'flex', width: '100%', height: 8, borderRadius: 999, overflow: 'hidden', background: '#eef2f7' }}>
                                {[
                                    { key: 'confirmed', value: confirmedCount, color: '#52c41a', label: 'Confirmed' },
                                    { key: 'pending', value: pendingConfirmations, color: '#faad14', label: 'Pending Confirmation' }
                                ].filter(item => item.value > 0).map(item => (
                                    <div
                                        key={item.key}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Filter by ${item.label}`}
                                        onClick={() => toggleStatusFilter(item.key as 'confirmed' | 'pending')}
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
                                    { key: 'confirmed', value: confirmedCount, color: '#52c41a', label: 'Confirmed' },
                                    { key: 'pending', value: pendingConfirmations, color: '#faad14', label: 'Pending Confirmation' }
                                ].filter(item => item.value > 0).map(item => (
                                    <Text
                                        key={item.key}
                                        type="secondary"
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => toggleStatusFilter(item.key as 'confirmed' | 'pending')}
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
                        <MotionCard loading={loading} size="small" style={{ height: '100%' }}>
                            <Row gutter={[12, 12]} align="middle">
                                <Col xs={24} md={12}>
                                    <Select value={selectedDept} onChange={setSelectedDept} style={{ width: '100%' }}>
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

                <MotionCard
                    loading={loading}
                    skeletonRows={8}
                    style={{ marginTop: 16 }}
                >
                    {viewMode === 'packs' ? (
                        <Table
                            rowKey="id"
                            dataSource={sortPackRows(filtered)}
                            columns={columns as any}
                            pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                        />
                    ) : (
                        <Table
                            rowKey="id"
                            dataSource={sortMovRows(filteredMovs)}
                            columns={[
                                {
                                    title: 'Month',
                                    render: (r: any) => {
                                        const m = r.month || dayjs(r.interventionDate || r.periodStart).format('YYYY-MM')
                                        return dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                                            ? dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).format('MMM YYYY')
                                            : m
                                    }
                                },
                                { title: 'Department', dataIndex: 'departmentName' },
                                { title: 'Status', render: (record: any) => statusTag(record) },
                                {
                                    title: 'POE',
                                    render: (_: any, mov: MovDoc) => {
                                        const count = Array.isArray(mov.poeUrls)
                                            ? uniq(mov.poeUrls).length
                                            : collectPoeUrlsFromRecord(mov).length

                                        // ROM onboarding MOVs prove completion via a signed
                                        // Pre-Incubation Agreement rather than an uploaded POE
                                        // file, so count is legitimately 0 for them - show
                                        // that evidence here instead of just "None".
                                        if (!count && hasPreIncAgreementEvidence(mov)) {
                                            return <PreIncPoeButton mov={mov} compact />
                                        }

                                        return count ? (
                                            <Button
                                                size="small"
                                                style={roundBtn}
                                                color="blue"
                                                variant="filled"
                                                onClick={() => openPoeViewer(mov)}
                                            >
                                                {count > 1 ? `View POEs (${count})` : 'View POE'}
                                            </Button>
                                        ) : (
                                            <span style={{ color: '#999' }}>None</span>
                                        )
                                    }
                                },
                                {
                                    title: 'Actions', render: (_: any, record: any) => (
                                        <Space>
                                            <Tooltip title="Review">
                                                <Button icon={<FileSearchOutlined />} onClick={() => handleReview({ ...record, interventions: [record] })} />
                                            </Tooltip>
                                        </Space>
                                    )
                                }
                            ] as any}
                            pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                        />
                    )}
                </MotionCard>
            </motion.div>

            {/* Review modal */}
            <ConsolidatedMOVReviewModal
                open={modalVisible}
                pack={selected}
                onClose={() => {
                    setModalVisible(false)
                    setSelected(null)
                    setPackQueries([])
                }}
                warningMessage={
                    !selectedHasCC
                        ? 'By confirming, you confirm the submitted information is truthful and complete.'
                        : undefined
                }
                monthFormatter={(month) =>
                    dayjs(month, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                        ? dayjs(month, ['YYYY-MM', 'YYYY-MM-DD']).format('MMM YYYY')
                        : String(month || '—')
                }
                summaryItems={[
                    { label: 'HOD Approval', value: hodName },
                    {
                        label: 'Center Coordinator Confirmation',
                        value: selectedHasCC ? ccName : 'Pending confirmation'
                    },
                    { label: 'M&E Validation', value: validationName }
                ]}
                summaryAlerts={
                    openQueriesOnSelected > 0 ? (
                        <Alert
                            type="warning"
                            showIcon
                            message={`There ${openQueriesOnSelected === 1 ? 'is' : 'are'} ${openQueriesOnSelected} open ${openQueriesOnSelected === 1 ? 'query' : 'queries'} raised by you on this pack.`}
                            action={
                                <Button size="small" onClick={() => setQueriesModalOpen(true)}>
                                    View My Queries
                                </Button>
                            }
                        />
                    ) : null
                }
                columns={[
                    {
                        title: 'SME / Intervention',
                        key: 'details',
                        render: (_: any, mov: MovDoc) => (
                            <div style={{ minWidth: 0 }}>
                                <Text strong style={{ display: 'block' }}>
                                    {mov.smmeCompanyName || mov.smmeName || 'SME'}
                                </Text>
                                <Text type="secondary" style={{ display: 'block', marginTop: 2 }}>
                                    {mov.interventionTitle || 'Intervention'}
                                </Text>
                            </div>
                        )
                    },
                    {
                        title: 'Facilitator / Completed',
                        key: 'delivery',
                        width: 210,
                        render: (_: any, mov: MovDoc) => {
                            const source =
                                mov.interventionDate ||
                                (mov as any)?.periodStart ||
                                (mov as any)?.assignmentCreatedAt ||
                                (mov as any)?.createdAt
                            const date = typeof source?.toDate === 'function' ? source.toDate() : source

                            return (
                                <div>
                                    <Text strong style={{ display: 'block' }}>
                                        {mov.facilitatorName || '—'}
                                    </Text>
                                    <Text type="secondary" style={{ display: 'block', marginTop: 2 }}>
                                        {dayjs(date).isValid() ? dayjs(date).format('DD MMM YYYY') : '—'}
                                    </Text>
                                </div>
                            )
                        }
                    },
                    {
                        title: 'Status',
                        key: 'status',
                        width: 175,
                        render: (_: any, mov: MovDoc) => {
                            const state = getCoordinatorReviewState(mov)
                            return (
                                <Tag
                                    color={state.color}
                                    style={{ margin: 0, borderRadius: 999, fontWeight: 600 }}
                                >
                                    {state.label}
                                </Tag>
                            )
                        }
                    },
                    {
                        title: 'Actions',
                        key: 'actions',
                        width: 290,
                        render: (_: any, mov: MovDoc) => {
                            const poeCount = getCoordinatorPoeCount(mov)

                            return (
                                <Space size={6} wrap>
                                    <Button
                                        size="small"
                                        style={rowActionPillStyle}
                                        color="blue"
                                        variant="filled"
                                        onClick={() => {
                                            setMovToView(mov)
                                            setMovViewerOpen(true)
                                        }}
                                    >
                                        Open
                                    </Button>

                                    <Button
                                        size="small"
                                        style={rowActionPillStyle}
                                        color="cyan"
                                        variant="filled"
                                        disabled={!poeCount}
                                        onClick={() => openPoeViewer(mov)}
                                    >
                                        POEs ({poeCount})
                                    </Button>

                                    <Button
                                        size="small"
                                        style={rowActionPillStyle}
                                        color="orange"
                                        variant="filled"
                                        onClick={() => openPoeQuery(mov)}
                                    >
                                        Query
                                    </Button>
                                </Space>
                            )
                        }
                    }
                ]}
                getRowTone={(mov: MovDoc) => getCoordinatorReviewState(mov).tone}
                signatureItems={[
                    {
                        label: 'HOD',
                        name: hodName,
                        signatureUrl: hodSigUrl
                    },
                    {
                        label: 'Center Coordinator',
                        name: selectedHasCC ? ccName : 'Pending confirmation',
                        signatureUrl: ccSigUrl,
                        emptySignatureText: selectedHasCC ? 'Signature missing' : 'Pending confirmation',
                        align: 'right'
                    },
                    {
                        label: 'M&E Validation',
                        name: validationName,
                        signatureUrl: validationSigUrl,
                        align: 'center'
                    }
                ]}
                footer={[
                    <Button
                        key="close"
                        danger
                        style={modalFooterButtonStyle}
                        onClick={() => {
                            setModalVisible(false)
                            setSelected(null)
                            setPackQueries([])
                        }}
                    >
                        Close
                    </Button>,
                    <Button
                        key="query"
                        icon={<InfoCircleOutlined />}
                        style={modalFooterButtonStyle}
                        variant="filled"
                        color="orange"
                        danger
                        onClick={() => setQueryModalOpen(true)}
                        disabled={!selected}
                    >
                        Raise Query
                    </Button>,
                    ...(
                        !confirmDisabled
                            ? [
                                <Button
                                    key="confirm"
                                    icon={<CheckCircleOutlined />}
                                    style={modalFooterButtonStyle}
                                    type="primary"
                                    onClick={handleConfirm}
                                >
                                    Confirm Pack
                                </Button>
                            ]
                            : []
                    )
                ]}

            />

            <Modal
                open={poeViewerOpen}
                title={`Proof of Execution${poeViewerUrls.length ? ` (${poeViewerUrls.length})` : ''}`}
                onCancel={closePoeViewer}
                styles={{ footer: modalFooterStyle }}
                footer={[
                    <Button
                        key="close"
                        onClick={closePoeViewer}
                        style={modalFooterButtonStyle}
                    >
                        Close
                    </Button>
                ]}
                width={780}
                destroyOnClose
                centered
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
                                            <Space wrap>
                                                <Button
                                                    color="blue"
                                                    variant="filled"
                                                    icon={<FileSearchOutlined />}
                                                    onClick={() => window.open(url, '_blank')}
                                                >
                                                    View
                                                </Button>

                                                <Popconfirm
                                                    title={`Remove POE ${absoluteIndex + 1}?`}
                                                    description="This removes the POE reference from the intervention and consolidated MOV."
                                                    okText="Remove"
                                                    cancelText="Cancel"
                                                    okButtonProps={{ danger: true }}
                                                    onConfirm={() =>
                                                        poeViewerRow
                                                            ? removePoeFromRow(poeViewerRow, url)
                                                            : undefined
                                                    }
                                                >
                                                    <Button
                                                        danger
                                                        icon={<DeleteOutlined />}
                                                        loading={deletingPoeUrl === url}
                                                        disabled={
                                                            !!deletingPoeUrl &&
                                                            deletingPoeUrl !== url
                                                        }
                                                    >
                                                        Remove
                                                    </Button>
                                                </Popconfirm>
                                            </Space>
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

            {/* MOV viewer modal */}
            <Modal
                open={movViewerOpen}
                title="MOV Document"
                onCancel={() => {
                    setMovViewerOpen(false)
                    setMovToView(null)
                }}
                styles={{ footer: modalFooterStyle }}
                footer={[
                    <Button key="close" onClick={() => { setMovViewerOpen(false); setMovToView(null); }} style={modalFooterButtonStyle}>
                        Close
                    </Button>
                ]}
                width={1100}
                destroyOnClose
                centered
            >
                {!movToView ? <Spin /> : (
                    <div style={{ padding: 18, background: '#dfe3e8', border: '1px solid #cfd5dc', borderRadius: 8 }}>
                        <div style={{ maxWidth: 1120, minWidth: 860, margin: '0 auto', background: '#fff', boxShadow: '0 8px 28px rgba(15,23,42,.16)', border: '1px solid #e5e7eb' }}>
                            <Space style={{ marginBottom: 12 }}>
                                <PreIncPoeButton mov={movToView} />
                            </Space>
                            <MovDocumentView mov={movToView} />
                        </div>
                    </div>
                )}
            </Modal>

            {/* Raise query modal */}
            <Modal
                open={queryModalOpen}
                title="Raise Query"
                onCancel={() => {
                    setQueryModalOpen(false)
                    setSelectedPoeRow(null)
                    queryForm.resetFields()
                }}
                destroyOnClose
                styles={{ footer: modalFooterStyle }}
                footer={[
                    <Button
                        key="close"
                        danger
                        style={modalFooterButtonStyle}
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
                            style={modalFooterButtonStyle}
                            loading={querySubmitting}
                            disabled={!selected}
                            onClick={handleSubmitQuery}
                        >
                            Submit Query
                        </Button>
                    </Tooltip>
                ]}
                centered
            >
                {!selected ? (
                    <Spin />
                ) : (
                    <>
                        <Alert
                            type="info"
                            showIcon
                            message={
                                selectedPoeRow
                                    ? 'This query is tied to a single intervention row (POE-level).'
                                    : 'This query is tied to the consolidated pack (pack-level).'
                            }
                            style={{ marginBottom: 12 }}
                        />

                        <Form form={queryForm} layout="vertical" preserve={false}>
                            {selectedPoeRow ? (
                                <>
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
                                </>
                            ) : (
                                <>
                                    <Form.Item label="Pack">
                                        <Input
                                            value={`${selected?.department || ''} • ${selected?.month ? dayjs(selected?.month).format('MMMM YYYY') : ''
                                                }`}
                                            disabled
                                        />
                                    </Form.Item>
                                </>
                            )}

                            <Form.Item
                                name="reason"
                                label="Describe the issue"
                                rules={[{ required: true, message: 'Please provide details' }]}
                            >
                                <Input.TextArea rows={4} placeholder={selectedPoeRow ? 'What is wrong with this POE?' : 'What is wrong with this pack?'} />
                            </Form.Item>
                        </Form>
                    </>
                )}
            </Modal>

            {/* Queries list modal */}
            <Modal
                open={queriesModalOpen}
                title="My Queries"
                onCancel={() => setQueriesModalOpen(false)}
                styles={{ footer: modalFooterStyle }}
                footer={[
                    <Button key="close" onClick={() => setQueriesModalOpen(false)} style={modalFooterButtonStyle}>
                        Close
                    </Button>
                ]}
                width={1100}
                centered
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
                                render: (q: QueryDoc) => (
                                    <Tag color={isOpenStatus(q.status) ? 'volcano' : 'green'}>
                                        {String(q.status || 'unknown').toUpperCase()}
                                    </Tag>
                                )
                            },
                            {
                                title: 'Target',
                                render: (q: QueryDoc) =>
                                    q.targetType === 'poe'
                                        ? `POE • ${q.departmentName || ''}${q.movRowId ? ` • ${q.movRowId}` : ''}`
                                        : 'Pack'
                            },
                            {
                                title: 'Raised By',
                                render: (q: QueryDoc) => q.raisedByName || '—'
                            },
                            {
                                title: 'Message',
                                dataIndex: 'queryMessage',
                                render: (v: any) => v || '—'
                            },
                            {
                                title: 'Created',
                                dataIndex: 'createdAt',
                                render: (v: any) => {
                                    const d = toJsDate(v)
                                    return d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—'
                                }
                            },
                            {
                                title: 'Updated',
                                dataIndex: 'updatedAt',
                                render: (v: any) => {
                                    const d = toJsDate(v)
                                    return d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—'
                                }
                            },
                            {
                                title: 'Actions',
                                render: (q: QueryDoc) => {
                                    const isMine =
                                        myUid &&
                                        q.raisedByUser &&
                                        String(q.raisedByUser) === String(myUid)

                                    return (
                                        <Space wrap>
                                            <Button
                                                size="small"
                                                style={roundBtn}
                                                disabled={!isOpenStatus(q.status) || !isMine}
                                                onClick={() => {
                                                    setSelectedQuery(q)
                                                    setResolveModalOpen(true)
                                                }}
                                            >
                                                Mark Resolved
                                            </Button>

                                            {q.uploadedFileUrl ? (
                                                <Button
                                                    size="small"
                                                    style={roundBtn}
                                                    icon={<FileSearchOutlined />}
                                                    onClick={() => window.open(String(q.uploadedFileUrl), '_blank')}
                                                >
                                                    Evidence
                                                </Button>
                                            ) : null}
                                        </Space>
                                    )
                                }
                            }
                        ]}
                    />
                ) : (
                    <Alert type="info" showIcon message="No queries found for this pack." />
                )}
            </Modal>

            {/* Resolve modal */}
            <Modal
                open={resolveModalOpen}
                title="Resolve Query"
                onCancel={() => {
                    setResolveModalOpen(false)
                    setSelectedQuery(null)
                    resolveForm.resetFields()
                }}
                onOk={handleResolveQuery}
                styles={{ footer: modalFooterStyle }}
                okButtonProps={{ loading: resolving, style: modalFooterButtonStyle }}
                cancelButtonProps={{ style: modalFooterButtonStyle }}
                destroyOnClose
                centered
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
                                    <div style={{ marginTop: 6, color: '#666' }}>
                                        Raised by: {selectedQuery.raisedByName || selectedQuery.raisedByEmail || '—'}
                                    </div>
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

            {/* Timeline modal */}
            <Modal
                open={timelineModalVisible}
                onCancel={() => {
                    setTimelineModalVisible(false)
                    setShowAllTimeline(false)
                }}
                styles={{ footer: modalFooterStyle }}
                footer={[
                    <Button
                        key="toggle"
                        style={modalFooterButtonStyle}
                        onClick={() => setShowAllTimeline(prev => !prev)}
                        disabled={timelineItems.length <= 8}
                    >
                        {showAllTimeline ? 'Show Recent Only' : `Show All (${timelineItems.length})`}
                    </Button>,
                    <Button
                        key="close"
                        type="primary"
                        style={modalFooterButtonStyle}
                        onClick={() => {
                            setTimelineModalVisible(false)
                            setShowAllTimeline(false)
                        }}
                    >
                        Close
                    </Button>
                ]}
                title={`Timeline (Approvals + My Queries)`}
                width={820}
                centered
            >
                <div
                    style={{
                        maxHeight: 520,
                        overflowY: 'auto',
                        paddingRight: 8
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
                        <div style={{ color: '#666' }}>No timeline events found.</div>
                    )}
                </div>
            </Modal>
        </div>
    )
}

export default CoordinatorMOVApprovals
