import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    DatePicker,
    Col,
    Dropdown,
    Empty,
    Form,
    Grid,
    Input,
    Modal,
    Row,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    message,
    Upload
} from 'antd'
import type { MenuProps, UploadFile } from 'antd'
import {
    CheckCircleOutlined,
    ClearOutlined,
    DownOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    FileTextOutlined,
    MessageOutlined,
    ReloadOutlined,
    UploadOutlined,
    BarChartOutlined,
    ClockCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { extractPoeUrls } from '@/services/poeService'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    arrayUnion,
    where,
    documentId,
    limit as qlimit
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { storage } from '@/firebase'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { workflowQueryService } from '@/services/workflowQueryService'
import { isSmeConfirmedMov, resolveMovKpiNames } from '@/services/movService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import ResolveQueryModal from '@/components/modals/ResolveQueryModal'
import EvidenceManagerPanel from '@/components/evidence/EvidenceManagerPanel'
import { filterMovRecords } from '@/utils/reportVisibility'

const { Text } = Typography
const { useBreakpoint } = Grid
const { RangePicker } = DatePicker

type MovDoc = any

type QueryDoc = {
    id: string
    movId?: string
    movRowId?: string | null
    consolidatedMovId?: string | null
    consultantId?: string
    participantId?: string | null
    interventionId?: string | null
    queryType?: string
    queryMessage?: string
    raisedByDept?: string
    raisedByUser?: string
    status?: 'open' | 'resolved' | string
    createdAt?: any
    updatedAt?: any
    resolvedAt?: any
    resolutionNotes?: string
    uploadedFileUrl?: string | null
    attachmentUrls?: string[]
    targetType?: string
    target?: {
        id?: string | null
        parentId?: string | null
        parentType?: string | null
    } | null
}

type PoeResource = { type?: string; label?: string; link: string }
type QueryFilter = 'all' | 'queried' | 'open'

const roundBtn: React.CSSProperties = { borderRadius: 999 }
const modalFooterButtonStyle: React.CSSProperties = { ...roundBtn, flex: 1, marginInlineStart: 0 }
const sunkenPanelStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 12,
    background: '#f8fafc',
    border: '1px solid #eef2f7'
}

// ----------------- small utils -----------------
const tsToDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    const d = new Date(v)
    return isNaN(+d) ? null : d
}

const fmtDate = (v: any) => {
    const d = tsToDate(v)
    return d ? dayjs(d).format('D MMM YYYY') : '—'
}

const fmtDateTime = (v: any) => {
    const d = tsToDate(v)
    return d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '—'
}

const clip = (s?: string) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—')

const statusColor = (s?: string) => {
    const v = String(s || '').toLowerCase()
    if (v === 'approved') return 'green'
    if (v === 'queried') return 'orange'
    if (v === 'submitted') return 'blue'
    if (v === 'pending') return 'default'
    return 'blue'
}

const statusLabel = (status?: string) => {
    const value = String(status || 'pending').trim().toLowerCase()
    if (value === 'awaiting_smme') return 'Awaiting SME Confirmation'
    if (value === 'awaiting_hod') return 'Awaiting HOD Approval'
    if (value === 'approved') return 'HOD Approved'
    if (value === 'queried') return 'Queried'
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase())
}

const uniqOptions = (items: { label: string; value: string }[]) => {
    const seen = new Set<string>()
    return items
        .filter(item => item.label && item.value)
        .filter(item => {
            const key = item.value.toLowerCase()
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
        .sort((a, b) => a.label.localeCompare(b.label))
}

const getMovInterventionValue = (mov: MovDoc) =>
    String(mov?.interventionId || mov?.interventionTitle || '').trim()

const getMovInterventionLabel = (mov: MovDoc) =>
    String(mov?.interventionTitle || mov?.snapshot?.interventionTitle || mov?.interventionId || 'Untitled intervention').trim()

const getMovSmeValue = (mov: MovDoc) =>
    String(mov?.beneficiaryId || mov?.participantId || mov?.smmeId || mov?.smmeCompanyName || mov?.smmeName || '').trim()

const getMovSmeLabel = (mov: MovDoc) =>
    String(
        mov?.smmeCompanyName ||
        mov?.smmeName ||
        mov?.beneficiaryName ||
        mov?.snapshot?.beneficiaryName ||
        mov?.participantName ||
        mov?.beneficiaryId ||
        'Unnamed SME'
    ).trim()

const getMovDate = (mov: MovDoc) =>
    tsToDate(mov?.interventionDate) ||
    tsToDate(mov?.periodStart) ||
    tsToDate(mov?.createdAt) ||
    tsToDate(mov?.updatedAt)

const isDateWithinRange = (date: Date | null, range: [Dayjs | null, Dayjs | null] | null) => {
    if (!range || (!range[0] && !range[1])) return true
    if (!date) return false

    const current = dayjs(date)
    const start = range[0]?.startOf('day')
    const end = range[1]?.endOf('day')

    if (start && current.isBefore(start)) return false
    if (end && current.isAfter(end)) return false
    return true
}

async function getFirst<T = any>(qy: any): Promise<(T & { id: string }) | null> {
    const snap = await getDocs(qy)
    if (snap.empty) return null
    const d = snap.docs[0]
    return { id: d.id, ...(d.data() as any) }
}

function hasDeliveryPayload(obj: any): boolean {
    if (!obj) return false
    const dm = obj.deliveryMethod ?? obj.method
    const dms = obj.deliveryMethods
    if (typeof dm === 'string' && dm.trim()) return true
    if (Array.isArray(dm) && dm.length) return true
    if (Array.isArray(dms) && dms.length) return true
    return false
}

function parseDeliveryFlags(ai: any, existing: any) {
    const srcObj = hasDeliveryPayload(ai) ? ai : existing
    const raw = (srcObj?.deliveryMethod ?? srcObj?.method ?? '').toString().toLowerCase()

    const src = raw.replace(/_/g, ' ')
    const arr = Array.isArray(srcObj?.deliveryMethods)
        ? srcObj.deliveryMethods.map((x: any) => String(x).toLowerCase())
        : []
    const mArr = Array.isArray(srcObj?.method)
        ? srcObj.method.map((x: any) => String(x).toLowerCase())
        : []

    const has = (s: string) => src.includes(s) || arr.includes(s) || mArr.includes(s)

    let methodInPerson = existing?.methodInPerson ?? (src === 'in-person' || src === 'in person')
    let methodOnline = existing?.methodOnline ?? src === 'online'
    let methodTelephonic = existing?.methodTelephonic ?? src === 'telephonic'

    if (!methodInPerson)
        methodInPerson = has('in_person') || has('in person') || has('physical') || has('onsite')
    if (!methodOnline) methodOnline = has('online') || has('virtual') || has('remote')
    if (!methodTelephonic)
        methodTelephonic = has('telephonic') || has('telephone') || has('phone') || has('call')

    let methodOther = existing?.methodOther ?? ''
    if (!methodInPerson && !methodOnline && !methodTelephonic) {
        methodOther = src || (arr[0] ?? mArr[0] ?? '')
    }

    return { methodInPerson, methodOnline, methodTelephonic, methodOther }
}

type FrequencyUI = 'as-needed' | 'once' | 'weekly' | 'biweekly' | 'monthly'

const parseFrequency = (raw: any): FrequencyUI | undefined => {
    const s = String(raw ?? '').toLowerCase().trim()
    if (!s) return undefined
    if (s.includes('needed') || s.includes('ad-hoc') || s.includes('ad hoc')) return 'as-needed'
    if (s.includes('week') && (s.includes('two') || s.includes('bi'))) return 'biweekly'
    if (s.includes('week')) return 'weekly'
    if (s.includes('month')) return 'monthly'
    if (s.includes('once') || s.includes('one-off') || s.includes('one off')) return 'once'
    return undefined
}

const isExplicitlyNonRecurring = (obj: any): boolean => {
    if (!obj) return false
    const v =
        obj.isRecurring ??
        obj.recurring ??
        obj.isRecurrent ??
        obj.recurrenceEnabled ??
        obj.enableRecurrence ??
        obj.isRepeatable
    return typeof v === 'boolean' ? v === false : false
}

async function resolveFrequencyByInterventionId(interventionId?: string): Promise<FrequencyUI | undefined> {
    if (!interventionId) return undefined
    let interDoc: any = null

    try {
        const alt = await getDoc(doc(db, 'interventions', String(interventionId)))
            if (alt.exists()) interDoc = { id: alt.id, ...(alt.data() as any) }
    } catch { }
    if (!interDoc) return undefined

    if (isExplicitlyNonRecurring(interDoc)) return 'once'
    const raw =
        interDoc.frequency ??
        interDoc.recurrence ??
        interDoc.recurrenceFrequency ??
        interDoc.interval ??
        interDoc.scheduleFrequency ??
        interDoc.repeat ??
        ''

    return parseFrequency(raw)
}

async function resolveKpiNamesByInterventionId(interventionId?: string): Promise<string> {
    return resolveMovKpiNames(db, interventionId)
}

function collectPoeUrlsFromRecord(record?: any, qiEntry?: any): string[] {
    return Array.isArray(record?.resources)
        ? Array.from(new Set(record.resources.map((resource: any) => resource?.link || resource?.url || resource?.href).filter(Boolean)))
        : []
}

// Query resolution (file upload + POE sync + workflowQueryService.resolve)
// now lives in the shared <ResolveQueryModal> / poeSyncService.

const CoordinatorMOVs: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const screens = useBreakpoint()
    const navigate = useNavigate()

    const [openingMovId, setOpeningMovId] = useState<string | null>(null)


    const [movs, setMovs] = useState<MovDoc[]>([])
    const [loadingMovs, setLoadingMovs] = useState(false)
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

    const [queries, setQueries] = useState<QueryDoc[]>([])
    const [loadingQueries, setLoadingQueries] = useState(false)

    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [queriesForMov, setQueriesForMov] = useState<QueryDoc[]>([])
    const [queriesForMovLoading, setQueriesForMovLoading] = useState(false)
    const [queriesForMovId, setQueriesForMovId] = useState<string | null>(null)

    const [reviewOpen, setReviewOpen] = useState(false)
    const [selectedMov, setSelectedMov] = useState<MovDoc | null>(null)

    const [resolvingQuery, setResolvingQuery] = useState<QueryDoc | null>(null)

    const [selectedMovResources, setSelectedMovResources] = useState<PoeResource[]>([])
    const [evidenceMov, setEvidenceMov] = useState<MovDoc | null>(null)
    const [evidenceLoading, setEvidenceLoading] = useState(false)
    const [evidenceUploading, setEvidenceUploading] = useState(false)

    const [interventionFilter, setInterventionFilter] = useState<string>('all')
    const [smeFilter, setSmeFilter] = useState<string>('all')
    const [queryFilter, setQueryFilter] = useState<QueryFilter>('all')
    const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'awaiting' | 'queried'>('all')
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)



    // Queries may be linked directly to a MOV, or only to the intervention and
    // beneficiary covered by that MOV. Support both shapes because the allocated
    // interventions page creates/reads intervention-scoped queries.
    const getQueryMovId = (qd: any): string => {
        if (qd?.movId) return String(qd.movId)
        if (qd?.movRowId) return String(qd.movRowId)
        if (qd?.targetType === 'mov' && qd?.target?.id) return String(qd.target.id)
        if (qd?.target?.parentType === 'mov' && qd?.target?.parentId) return String(qd.target.parentId)
        return ''
    }

    const getMovParticipantId = (mov: MovDoc): string =>
        String(mov?.beneficiaryId || mov?.participantId || mov?.smmeId || '').trim()

    const queryBelongsToMov = (qd: QueryDoc, mov: MovDoc): boolean => {
        const directMovId = getQueryMovId(qd)
        const movId = String(mov?.id || '').trim()

        if (directMovId && directMovId === movId) return true

        const queryInterventionId = String(qd?.interventionId || '').trim()
        const movInterventionId = String(mov?.interventionId || '').trim()

        if (!queryInterventionId || !movInterventionId || queryInterventionId !== movInterventionId) {
            return false
        }

        const queryParticipantId = String(qd?.participantId || '').trim()
        const movParticipantId = getMovParticipantId(mov)

        return !queryParticipantId || !movParticipantId || queryParticipantId === movParticipantId
    }

    // ------- Queries index like MOVsApprovalForm -------
    const buildQueriesIndex = useMemo(() => {
        const index: Record<
            string,
            { open: number; total: number; evidence: boolean; lastEvidenceUrl?: string; lastUpdated?: Date }
        > = {}

        queries.forEach(qd => {
            const matchedMovIds = movs
                .filter(mov => queryBelongsToMov(qd, mov))
                .map(mov => String(mov.id))

            matchedMovIds.forEach(movId => {
                if (!movId) return

                const entry = index[movId] || { open: 0, total: 0, evidence: false }
                entry.total += 1

                if (String(qd.status || 'open').toLowerCase() !== 'resolved') {
                    entry.open += 1
                }

                if (qd.uploadedFileUrl) {
                    entry.evidence = true
                    entry.lastEvidenceUrl = qd.uploadedFileUrl
                }

                const when = (
                    qd.updatedAt?.toDate?.() ||
                    qd.resolvedAt?.toDate?.() ||
                    qd.createdAt?.toDate?.() ||
                    null
                ) as Date | null

                if (when && (!entry.lastUpdated || entry.lastUpdated < when)) {
                    entry.lastUpdated = when
                }

                index[movId] = entry
            })
        })

        return index
    }, [queries, movs])

    // ------- MOV enrichment to match MOVsApprovalForm look -------
    const enrichMovFromRefs = async (mov: MovDoc) => {
        const beneficiaryId = (mov as any).participantId || (mov as any).beneficiaryId || (mov as any).smmeId || ''

        // 0) participant
        let participant: any = null
        if (beneficiaryId) {
            try {
                const pSnap = await getDoc(doc(db, 'participants', beneficiaryId))
                if (pSnap.exists()) participant = { id: pSnap.id, ...(pSnap.data() as any) }
            } catch { }
        }

        // 1) application
        let app: any = null
        if (beneficiaryId) {
            const appQ = query(collection(db, 'applications'), where('participantId', '==', beneficiaryId), qlimit(1))
            app = await getFirst(appQ)
        }

        // 2) office/area name
        let officeAreaName = mov.officeAreaName || ''
        if (app?.branchId) {
            try {
                const b = await getDoc(doc(db, 'branches', String(app.branchId)))
                if (b.exists()) {
                    const bd: any = b.data()
                    officeAreaName = bd.name || bd.branchName || officeAreaName
                }
            } catch { }
        }

        // 3) group
        const gapGroup = app?.group || app?.gapGroup || (mov as any).gapGroup || ''

        // 4) assignedIntervention
        let ai: any = null
        if ((mov as any).assignedInterventionId) {
            const aiSnap = await getDoc(doc(db, 'assignedInterventions', (mov as any).assignedInterventionId))
            if (aiSnap.exists()) ai = { id: aiSnap.id, ...aiSnap.data() }
        }
        if (!ai && (mov as any).interventionId && beneficiaryId) {
            const parts: any[] = [
                collection(db, 'assignedInterventions'),
                where('interventionId', '==', (mov as any).interventionId),
                where('participantId', '==', beneficiaryId)
            ]
            if (activeProgramId) parts.push(where('programId', '==', activeProgramId))
            parts.push(qlimit(1))
            ai = await getFirst(query(...parts))
        }
        const subInterventionId =
            (mov as any).subInterventionId || ai?.subInterventionId || null
        const subInterventionTitle =
            (mov as any).subInterventionTitle ||
            ai?.subInterventionTitle ||
            ai?.subInterventionName ||
            null

        // 5) delivery + frequency + dates
        const { methodInPerson, methodOnline, methodTelephonic, methodOther } = parseDeliveryFlags(ai, mov)

        let frequency: FrequencyUI | undefined
        if (isExplicitlyNonRecurring(ai)) frequency = 'as-needed'
        if (!frequency) frequency = parseFrequency(ai?.frequency)
        if (!frequency) frequency = parseFrequency((mov as any).frequency)
        if (!frequency) frequency = await resolveFrequencyByInterventionId((mov as any).interventionId)
        if (!frequency) frequency = 'once'

        // The MOV snapshot is the source of truth for the dates shown in the
        // table and in the paper document. Only fall back to assignment
        // lifecycle dates when the older MOV has no captured date.
        const periodStart =
            (mov as any).periodStart ||
            (mov as any).interventionDate ||
            ai?.createdAt ||
            null
        const periodEnd =
            (mov as any).periodEnd ||
            (mov as any).smmeAcceptedAt ||
            (mov as any).smmeSignedAt ||
            ai?.participantConfirmedAt ||
            null

        // Held appointments are detail rows inside the MOV, not separate MOVs.
        // Group appointments are included only when this SME actually checked in.
        let appointmentInterventions: Array<{ title: string; date: any; signature?: string }> = []
        if ((mov as any).interventionId && beneficiaryId) {
            try {
                const constraints: any[] = [
                    where('interventionId', '==', (mov as any).interventionId)
                ]
                if (activeProgramId) constraints.push(where('programId', '==', activeProgramId))

                const appointmentSnap = await getDocs(
                    query(collection(db, 'appointments'), ...constraints)
                )
                const participantEmail = String(
                    participant?.email || app?.email || app?.participantEmail || ''
                ).trim().toLowerCase()
                const movDate = tsToDate((mov as any).interventionDate) ||
                    tsToDate((mov as any).completedAt) ||
                    tsToDate((mov as any).createdAt)
                const explicitPeriodStart = tsToDate((mov as any).periodStart)
                const explicitPeriodEnd = tsToDate((mov as any).periodEnd)
                const assignmentPeriodStart = tsToDate(periodStart)
                const assignmentPeriodEnd = tsToDate(periodEnd)
                const rangeStart = explicitPeriodStart?.getTime() || assignmentPeriodStart?.getTime() ||
                    (movDate ? dayjs(movDate).startOf('month').valueOf() : 0)
                const rangeEnd = explicitPeriodEnd?.getTime() || assignmentPeriodEnd?.getTime() ||
                    (movDate ? dayjs(movDate).endOf('month').valueOf() : Number.MAX_SAFE_INTEGER)

                const appointmentViews = await hydrateAppointmentViews(
                    appointmentSnap.docs.map(d => ({ id: d.id, data: d.data() as any }))
                )
                appointmentInterventions = appointmentViews
                    .filter(appt => {
                        const held = appt.sessionCoverage?.latest?.held === true ||
                            String(appt.status || '').toLowerCase() === 'completed'
                        if (!held) return false

                        const appointmentDate = tsToDate(appt.date) || tsToDate(appt.startTime) || tsToDate(appt.completedAt)
                        const time = appointmentDate?.getTime() || 0
                        if (rangeStart && time && time < dayjs(rangeStart).startOf('day').valueOf()) return false
                        if (rangeEnd !== Number.MAX_SAFE_INTEGER && time > dayjs(rangeEnd).endOf('day').valueOf()) return false

                        if (!appt.isGroupAppointment && !appt.groupKey) {
                            return String(appt.participantId || '') === String(beneficiaryId)
                        }

                        const recordedAttendance = Array.isArray(appt.sessionCoverage?.latest?.attendanceByParticipant)
                            ? appt.sessionCoverage.latest.attendanceByParticipant.find((entry: any) =>
                                String(entry?.participantId || '') === String(beneficiaryId)
                            )
                            : null
                        if (recordedAttendance) {
                            return recordedAttendance.outcome === 'attended'
                        }

                        const checkedInEmails = [
                            ...(appt.attendanceSummary?.checkedInEmails || []),
                            ...(appt.attendance?.summary?.checkedInEmails || [])
                        ].map((email: any) => String(email || '').trim().toLowerCase())
                        const checkIns = [
                            ...(appt.attendance?.checkIns || []),
                            ...(appt.attendeeCheckIns || [])
                        ]
                        return Boolean(
                            participantEmail && checkedInEmails.includes(participantEmail) ||
                            checkIns.some((entry: any) =>
                                participantEmail && String(entry?.email || '').trim().toLowerCase() === participantEmail
                            )
                        )
                    })
                    .map(appt => {
                        const latest = appt.sessionCoverage?.latest
                        const coveredPoints = Array.isArray(latest?.coveredPoints)
                            ? latest.coveredPoints.filter(Boolean).join('; ')
                            : ''
                        const sessionHeading = String(
                            latest?.title ||
                            appt.sessionTitle ||
                            appt.interventionTitle ||
                            (mov as any).interventionTitle ||
                            'Intervention'
                        ).trim()
                        const fullDetails = coveredPoints &&
                            coveredPoints.toLowerCase() !== sessionHeading.toLowerCase()
                            ? `${sessionHeading} — ${coveredPoints}`
                            : sessionHeading
                        return {
                            title: fullDetails,
                            date: appt.date || appt.startTime || appt.completedAt || (mov as any).interventionDate,
                            signature: ''
                        }
                    })
                    .filter((row, index, rows) =>
                        rows.findIndex(candidate =>
                            candidate.title.toLowerCase() === row.title.toLowerCase() &&
                            dayjs(candidate.date).format('YYYY-MM-DD') === dayjs(row.date).format('YYYY-MM-DD')
                        ) === index
                    )
                    .sort((a, b) => (tsToDate(a.date)?.getTime() || 0) - (tsToDate(b.date)?.getTime() || 0))
            } catch (error) {
                console.warn('Could not load held appointments for MOV detail rows', error)
            }
        }

        // 6) sector
        const smmeSector = (mov as any).smmeSector || participant?.sector || app?.sector || ''

        // 7) KPI serviced
        const kpiServiced = await resolveKpiNamesByInterventionId(
            ai?.databaseInterventionId ||
            (mov as any).databaseInterventionId ||
            (mov as any).interventionId
        )

        // 8) signatures
        const facSigUrl = (mov as any).facilitatorSignatureUrl || ''

        // SMME signatures are written to the MOV when the intervention is
        // confirmed. Keep this view on that canonical field only.
        const smmeSigUrl = (mov as any).smmeSignatureUrl || ''

        // 9) smmeNo — the application is the authoritative source (the incubatees
        // list reads it from here too). participants is no longer consulted
        // since it isn't reliably kept in sync. Field naming varies
        // ("smmeNo"/"smmENo"/"SMMENo") across older records.
        let smmeNo =
            (app as any)?.smmeNo || (app as any)?.smmENo || (app as any)?.SMMENo || ''
        if (!smmeNo) {
            smmeNo = (mov as any).smmeNo || ''
        }

        // 10) POE urls
        const resources = Array.isArray((ai as any)?.resources)
            ? (ai as any).resources
            : []
        const poeUrls = Array.from(new Set(resources
            .map((resource: any) => resource?.link || resource?.url || resource?.href)
            .filter(Boolean)))

        return {
            ...mov,
            subInterventionId,
            subInterventionTitle,
            officeAreaName,
            gapGroup,
            smmeSector,
            frequency,
            periodStart,
            periodEnd,
            appointmentInterventions,
            methodInPerson,
            methodOnline,
            methodTelephonic,
            methodOther,
            kpiServiced,
            facilitatorSignatureUrl: facSigUrl,
            facilitatorDigitalSignature: '',
            smmeSignatureUrl: smmeSigUrl,
            smmeDigitalSignature: '',
            smmeNo,
            resources,
            poeUrls
        } as MovDoc
    }

    // ------- data fetch -------
    const resolveCurrentFacilitatorIds = async () => {
        const ids = new Set<string>()

        const uid = String(user?.uid || '').trim()
        const email = String(user?.email || '').trim().toLowerCase()

        if (uid) ids.add(uid)

        if (email) {
            const identityCollections = ['coordinators', 'consultants', 'users']

            for (const collectionName of identityCollections) {
                try {
                    const identitySnap = await getDocs(
                        query(
                            collection(db, collectionName),
                            where('email', '==', email),
                            qlimit(1)
                        )
                    )

                    if (!identitySnap.empty) {
                        ids.add(identitySnap.docs[0].id)
                    }
                } catch (err) {
                    console.warn(
                        `Could not resolve ${collectionName} document id for MOV/query fetch`,
                        err
                    )
                }
            }
        }

        return Array.from(ids).filter(Boolean)
    }

    const fetchMyMovs = async (): Promise<MovDoc[]> => {
        if (!activeProgramId) return []

        setLoadingMovs(true)

        try {
            const found: Record<string, MovDoc> = {}
            const email = String(user?.email || '').trim().toLowerCase()
            const facilitatorIds = await resolveCurrentFacilitatorIds()

            for (const facilitatorId of facilitatorIds) {
                const qByFacilitatorId = query(
                    collection(db, 'movDocuments'),
                    where('programId', '==', activeProgramId),
                    where('facilitatorId', '==', facilitatorId)
                )

                const snap = await getDocs(qByFacilitatorId)

                snap.docs.forEach(d => {
                    found[d.id] = { id: d.id, ...(d.data() as any) }
                })
            }

            if (email) {
                const emailVariants = Array.from(
                    new Set([
                        email,
                        String(user?.email || '').trim()
                    ].filter(Boolean))
                )

                for (const emailValue of emailVariants) {
                    const qByEmail = query(
                        collection(db, 'movDocuments'),
                        where('programId', '==', activeProgramId),
                        where('facilitatorEmail', '==', emailValue)
                    )

                    const snap = await getDocs(qByEmail)

                    snap.docs.forEach(d => {
                        found[d.id] = { id: d.id, ...(d.data() as any) }
                    })
                }
            }

            if (user?.uid) {
                const qByCreatedBy = query(
                    collection(db, 'movDocuments'),
                    where('programId', '==', activeProgramId),
                    where('createdByUid', '==', user.uid)
                )

                const snap = await getDocs(qByCreatedBy)

                snap.docs.forEach(d => {
                    found[d.id] = { id: d.id, ...(d.data() as any) }
                })
            }

            const data = Object.values(found)

            data.sort((a, b) => {
                const aT =
                    tsToDate(a?.interventionDate) ||
                    tsToDate(a?.updatedAt) ||
                    tsToDate(a?.createdAt) ||
                    new Date(0)

                const bT =
                    tsToDate(b?.interventionDate) ||
                    tsToDate(b?.updatedAt) ||
                    tsToDate(b?.createdAt) ||
                    new Date(0)

                return bT.getTime() - aT.getTime()
            })

            console.log('MOV fetch debug', {
                activeProgramId,
                uid: user.uid,
                email,
                facilitatorIds,
                totalFound: data.length,
                byFacilitatorId: data.reduce((acc: Record<string, number>, mov: any) => {
                    const key = String(mov.facilitatorId || 'missing')
                    acc[key] = (acc[key] || 0) + 1
                    return acc
                }, {})
            })

            // The table is backed by MOV snapshots, but sub-intervention data
            // lives on the linked assignment. Hydrate that small summary here
            // so the list does not depend on opening the review modal.
            const assignmentIds = Array.from(new Set(
                data.map(mov => String(mov?.assignedInterventionId || '')).filter(Boolean)
            ))
            const assignmentsById: Record<string, any> = {}
            for (let offset = 0; offset < assignmentIds.length; offset += 10) {
                const chunk = assignmentIds.slice(offset, offset + 10)
                const assignmentSnap = await getDocs(
                    query(collection(db, 'assignedInterventions'), where(documentId(), 'in', chunk))
                )
                assignmentSnap.docs.forEach(item => {
                    assignmentsById[item.id] = item.data()
                })
            }
            // A facilitator can create the MOV before the SME has confirmed it,
            // but that is still a pending draft rather than a coordinator MOV.
            // Keep the coordinator list focused on SME-confirmed documents.
            const enrichedData = filterMovRecords(data, user?.email)
                .filter(isSmeConfirmedMov)
                .map(mov => {
                const assignment = assignmentsById[String(mov?.assignedInterventionId || '')]
                return assignment
                    ? {
                        ...mov,
                        subInterventionId: mov.subInterventionId || assignment.subInterventionId || null,
                        subInterventionTitle: mov.subInterventionTitle || assignment.subInterventionTitle || assignment.subInterventionName || null,
                        resources: Array.isArray(assignment.resources) ? assignment.resources : []
                    }
                    : mov
                })

            setMovs(enrichedData)
            return enrichedData
        } catch (e) {
            console.error(e)
            message.error('Failed to load your MOVs')
            return []
        } finally {
            setLoadingMovs(false)
            setHasLoadedOnce(true)
        }
    }

    const fetchMyQueries = async (movsList: MovDoc[] = movs) => {
        if (!user?.uid) return
        setLoadingQueries(true)
        try {
            // resolverId isn't always the raw auth uid (older queries may have been
            // assigned via the consultants/users profile doc id) — resolve every id
            // this account could be known by, same as fetchMyMovs does for facilitatorId.
            const resolverIds = await resolveCurrentFacilitatorIds()
            const byResolver = await workflowQueryService.list({
                resolverIds: resolverIds.length ? resolverIds : [user.uid]
            }) as QueryDoc[]

            // A query doesn't have to be raised "on the MOV" specifically to belong
            // here — a POE query (or any other query type) raised against the
            // intervention that a MOV covers is just as relevant. Pull those too,
            // same as coordinator/allocated's fetchQueriesForIntervention does,
            // then keep only the ones for a participant we actually have a MOV for.
            const interventionIds = Array.from(
                new Set(movsList.map(m => String(m?.interventionId || '')).filter(Boolean))
            )
            const participantIds = new Set(
                movsList
                    .map(m => String(m?.beneficiaryId || m?.participantId || m?.smmeId || ''))
                    .filter(Boolean)
            )

            const byInterventionResults = await Promise.all(
                interventionIds.map(interventionId =>
                    workflowQueryService.list({ interventionId }).catch(() => [])
                )
            )
            const byIntervention = (byInterventionResults.flat() as QueryDoc[]).filter(q => {
                const pid = String(q.participantId || '')
                return !pid || participantIds.has(pid)
            })

            const merged = new Map<string, QueryDoc>()
                ;[...byResolver, ...byIntervention].forEach(q => merged.set(q.id, q))
            const list = Array.from(merged.values())

            list.sort((a, b) => {
                const aT = tsToDate(a.updatedAt) || tsToDate(a.createdAt) || new Date(0)
                const bT = tsToDate(b.updatedAt) || tsToDate(b.createdAt) || new Date(0)
                return bT.getTime() - aT.getTime()
            })

            setQueries(list)
        } catch (e) {
            console.error(e)
            message.error('Failed to load queries')
        } finally {
            setLoadingQueries(false)
        }
    }

    useEffect(() => {
        if (!activeProgramId) return
            ; (async () => {
                const movsList = await fetchMyMovs()
                await fetchMyQueries(movsList)
            })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, user?.email, activeProgramId])

    const movById = useMemo(() => {
        const map = new Map<string, MovDoc>()
        movs.forEach(mov => {
            if (mov?.id) map.set(String(mov.id), mov)
        })
        return map
    }, [movs])

    const interventionOptions = useMemo(
        () =>
            uniqOptions(
                movs.map(mov => ({
                    label: getMovInterventionLabel(mov),
                    value: getMovInterventionValue(mov)
                }))
            ),
        [movs]
    )

    const smeOptions = useMemo(
        () =>
            uniqOptions(
                movs.map(mov => ({
                    label: getMovSmeLabel(mov),
                    value: getMovSmeValue(mov)
                }))
            ),
        [movs]
    )

    const filteredMovs = useMemo(() => {
        const rows = movs.filter(mov => {
            const interventionMatches =
                interventionFilter === 'all' || getMovInterventionValue(mov) === interventionFilter

            const smeMatches = smeFilter === 'all' || getMovSmeValue(mov) === smeFilter

            const queryInfo = buildQueriesIndex[String(mov?.id || '')]
            const hasAnyQuery = String(mov?.status || '').toLowerCase() === 'queried' || Number(queryInfo?.total || 0) > 0
            const hasOpenQuery = Number(queryInfo?.open || 0) > 0
            const queryMatches =
                queryFilter === 'all' ||
                (queryFilter === 'queried' && hasAnyQuery) ||
                (queryFilter === 'open' && hasOpenQuery)

            const dateMatches = isDateWithinRange(getMovDate(mov), dateRange)
            const statusMatches =
                statusFilter === 'all' ||
                (statusFilter === 'approved' && (mov as any)?.approvedByHod === true) ||
                (statusFilter === 'queried' && hasAnyQuery) ||
                (statusFilter === 'awaiting' && (mov as any)?.approvedByHod !== true && !hasAnyQuery)

            return interventionMatches && smeMatches && queryMatches && dateMatches && statusMatches
        })
        return [...rows].sort((a, b) => {
            const dateDiff = (getMovDate(b)?.getTime() || 0) - (getMovDate(a)?.getTime() || 0)
            if (dateDiff) return dateDiff
            return getMovSmeLabel(a).localeCompare(getMovSmeLabel(b), undefined, { sensitivity: 'base' })
        })
    }, [movs, interventionFilter, smeFilter, queryFilter, statusFilter, dateRange, buildQueriesIndex])

    const filteredQueries = useMemo(() => {
        return queries.filter(qd => {
            const linkedMovId = getQueryMovId(qd)
            const linkedMov = linkedMovId ? movById.get(linkedMovId) : null

            const interventionMatches =
                interventionFilter === 'all' ||
                String(qd.interventionId || '') === interventionFilter ||
                (!!linkedMov && getMovInterventionValue(linkedMov) === interventionFilter)

            const smeMatches =
                smeFilter === 'all' ||
                (!!linkedMov && getMovSmeValue(linkedMov) === smeFilter)

            const queryDate =
                (linkedMov && getMovDate(linkedMov)) ||
                tsToDate(qd.updatedAt) ||
                tsToDate(qd.createdAt) ||
                tsToDate(qd.resolvedAt)

            const dateMatches = isDateWithinRange(queryDate, dateRange)

            return interventionMatches && smeMatches && dateMatches
        })
    }, [queries, movById, interventionFilter, smeFilter, dateRange])

    const filtersActive =
        interventionFilter !== 'all' ||
        smeFilter !== 'all' ||
        queryFilter !== 'all' ||
        !!dateRange?.[0] ||
        !!dateRange?.[1] ||
        statusFilter !== 'all'

    const resetFilters = () => {
        setInterventionFilter('all')
        setSmeFilter('all')
        setQueryFilter('all')
        setStatusFilter('all')
        setDateRange(null)
    }

    const metrics = useMemo(() => {
        const total = filteredMovs.length
        const approved = filteredMovs.filter(m => (m as any)?.approvedByHod === true).length
        // Queried MOVs includes both open and resolved query history. The MOV status
        // is retained as a fallback for older records whose workflow query was not linked.
        const queried = filteredMovs.filter(m => {
            const qi = buildQueriesIndex[String(m?.id || '')]
            return String(m?.status || '').toLowerCase() === 'queried' || Number(qi?.total || 0) > 0
        }).length
        const awaiting = filteredMovs.filter(m => {
            if ((m as any)?.approvedByHod === true) return false
            if ((m as any)?.smmeAccepted === true) return true
            return ['pending', 'submitted', 'in-review', 'in_review', 'awaiting_smme', 'awaiting_hod'].includes(
                String(m?.status || 'pending').toLowerCase()
            )
        }).length
        return { total, approved, queried, awaiting }
    }, [filteredMovs, buildQueriesIndex])

    const statusChartOptions = useMemo<Highcharts.Options>(() => {
        const rawData = [
            { name: 'Approved', y: metrics.approved, color: '#52c41a' },
            { name: 'Awaiting Review', y: metrics.awaiting, color: '#faad14' },
            { name: 'Queried', y: metrics.queried, color: '#ff4d4f' }
        ]
        const filteredData = rawData.filter(item => item.y > 0)
        const chartData: Highcharts.PointOptionsObject[] = filteredData.length === 1
            ? [
                filteredData[0],
                {
                    name: '',
                    y: Math.max(filteredData[0].y * 0.000001, 0.000001),
                    color: 'rgba(0,0,0,0)',
                    borderColor: 'rgba(0,0,0,0)',
                    enableMouseTracking: false,
                    dataLabels: { enabled: false }
                }
            ]
            : filteredData

        return {
            chart: { type: 'pie', height: 300 },
            title: { text: '' },
            credits: { enabled: false },
            tooltip: {
                pointFormatter: function () {
                    if (!this.y) return false as any
                    return `<b>${this.y}</b> MOV(s) (${this.percentage?.toFixed(1)}%)`
                }
            },
            plotOptions: {
                pie: {
                    innerSize: '62%',
                    size: '62%',
                    center: ['50%', '50%'],
                    dataLabels: {
                        enabled: true,
                        format: '{point.name}: {point.y}',
                        distance: 22,
                        connectorWidth: 1,
                        softConnector: true,
                        crop: false,
                        overflow: 'allow',
                        style: {
                            color: '#000000',
                            fontSize: '12px',
                            fontWeight: '700',
                            textOutline: 'none'
                        }
                    }
                }
            },
            series: [{
                type: 'pie',
                name: 'MOVs',
                data: chartData.length
                    ? chartData
                    : [{
                        name: 'No Data',
                        y: 1,
                        color: '#d9d9d9',
                        dataLabels: { enabled: false },
                        enableMouseTracking: false
                    }]
            }]
        }
    }, [metrics])

    // ------- UI actions -------
    const openEvidenceManager = async (mov: MovDoc) => {
        setEvidenceMov(mov)
        setEvidenceLoading(true)
        try {
            const assignmentId = String(mov?.assignedInterventionId || '').trim()
            if (!assignmentId) {
                setSelectedMovResources([])
                return
            }
            const snap = await getDoc(doc(db, 'assignedInterventions', assignmentId))
            setSelectedMovResources(
                snap.exists() && Array.isArray(snap.data()?.resources)
                    ? snap.data().resources.filter((item: any) => item?.link)
                    : []
            )
        } finally {
            setEvidenceLoading(false)
        }
    }

    const uploadEvidenceForMov = async (file: File) => {
        if (!evidenceMov?.assignedInterventionId) return
        setEvidenceUploading(true)
        try {
            const assignmentId = String(evidenceMov.assignedInterventionId)
            const fileRef = ref(storage, `assignedInterventions/${assignmentId}/evidence/${Date.now()}_${file.name}`)
            await uploadBytes(fileRef, file)
            const resource: PoeResource = {
                type: file.type?.startsWith('image/') ? 'image' : 'document',
                label: file.name,
                link: await getDownloadURL(fileRef)
            }
            await updateDoc(doc(db, 'assignedInterventions', assignmentId), {
                resources: arrayUnion(resource),
                updatedAt: new Date()
            })
            setSelectedMovResources(previous => [...previous, resource])
            setMovs(previous => previous.map(item =>
                String(item.id) === String(evidenceMov.id)
                    ? { ...item, resources: [...(Array.isArray(item.resources) ? item.resources : []), resource] }
                    : item
            ))
            message.success('Evidence uploaded.')
        } catch (error) {
            console.error('Failed to upload MOV evidence', error)
            message.error('Failed to upload evidence.')
        } finally {
            setEvidenceUploading(false)
        }
    }

    const removeEvidenceForMov = async (resource: PoeResource) => {
        if (!evidenceMov?.assignedInterventionId) return
        const assignmentId = String(evidenceMov.assignedInterventionId)
        try {
            const snap = await getDoc(doc(db, 'assignedInterventions', assignmentId))
            const next = snap.exists() && Array.isArray(snap.data()?.resources)
                ? snap.data().resources.filter((item: any) => item?.link !== resource.link)
                : []
            await updateDoc(doc(db, 'assignedInterventions', assignmentId), { resources: next, updatedAt: new Date() })
            setSelectedMovResources(next)
            setMovs(previous => previous.map(item =>
                String(item.id) === String(evidenceMov.id) ? { ...item, resources: next } : item
            ))
            message.success('Evidence removed.')
        } catch (error) {
            console.error('Failed to remove MOV evidence', error)
            message.error('Failed to remove evidence.')
        }
    }

    const openMovReview = (mov: MovDoc) => {
        const id = String(mov?.id || '')
        if (!id || openingMovId) return

        setOpeningMovId(id)

            ; (async () => {
                try {
                    const enriched = await enrichMovFromRefs(mov)
                    const res = Array.isArray(enriched.resources) ? enriched.resources : []
                    setSelectedMov(enriched)
                    setSelectedMovResources(res)
                } catch (e) {
                    console.error(e)
                    setSelectedMov(mov)
                    setSelectedMovResources([])
                } finally {
                    setOpeningMovId(null)
                    setReviewOpen(true)
                }
            })()
    }



    const openQueriesForMov = async (mov: MovDoc) => {
        const movId = String(mov?.id || '')
        setQueriesForMovId(movId)
        setQueriesForMovLoading(true)
        setQueriesModalOpen(true)

        try {
            const interventionId = String(mov?.interventionId || '').trim()

            const [byMov, byIntervention] = await Promise.all([
                workflowQueryService.list({ movId }).catch(() => []),
                interventionId
                    ? workflowQueryService.list({ interventionId }).catch(() => [])
                    : Promise.resolve([])
            ])

            const merged = new Map<string, QueryDoc>()

                ;[
                    ...queries,
                    ...(byMov as QueryDoc[]),
                    ...(byIntervention as QueryDoc[])
                ]
                    .filter(qd => queryBelongsToMov(qd, mov))
                    .forEach(qd => merged.set(qd.id, qd))

            const list = Array.from(merged.values())

            list.sort((a, b) => {
                const aT = tsToDate(a.updatedAt) || tsToDate(a.createdAt) || new Date(0)
                const bT = tsToDate(b.updatedAt) || tsToDate(b.createdAt) || new Date(0)
                return bT.getTime() - aT.getTime()
            })

            setQueriesForMov(list)
        } catch (e) {
            console.error(e)
            message.error('Failed to load queries')
        } finally {
            setQueriesForMovLoading(false)
        }
    }

    const startResolve = (qd: QueryDoc) => {
        setResolvingQuery(qd)
    }

    const handleQueryResolved = async (queryId: string) => {
        const resolvedQuery =
            queriesForMov.find(item => item.id === queryId) ||
            queries.find(item => item.id === queryId) ||
            null

        setQueriesForMov(previous =>
            previous.map(item =>
                item.id === queryId ? { ...item, status: 'resolved', updatedAt: new Date() } : item
            )
        )
        setResolvingQuery(null)

        const linkedMov =
            (queriesForMovId
                ? movs.find(mov => String(mov?.id || '') === String(queriesForMovId))
                : null) ||
            (resolvedQuery ? movs.find(mov => queryBelongsToMov(resolvedQuery, mov)) : null) ||
            null
        const resolvedMovId = linkedMov ? String(linkedMov.id) : null

        const freshMovs = await fetchMyMovs()
        await fetchMyQueries(freshMovs)

        if (resolvedMovId && queriesModalOpen) {
            const freshMov = freshMovs.find(mov => String(mov?.id || '') === resolvedMovId)
            if (freshMov) await openQueriesForMov(freshMov)
        }
    }

    // ------- columns (match the MOVsApprovalForm feel) -------
    const movColumns = useMemo(() => {
        return [
            { title: 'Beneficiary', dataIndex: 'smmeCompanyName', render: (v: any, r: any) => v || r?.smmeName || '—' },
            {
                title: 'Intervention',
                key: 'intervention',
                render: (_: any, r: any) => (
                    <Space direction="vertical" size={0}>
                        <Text>{r?.interventionTitle || '—'}</Text>
                        {r?.subInterventionTitle || r?.subInterventionName ? (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {r.subInterventionTitle || r.subInterventionName}
                            </Text>
                        ) : null}
                    </Space>
                )
            },
            {
                title: 'Date',
                key: 'date',
                render: (_: any, r: any) => (
                    <Space direction="vertical" size={0}>
                        <Text style={{ fontSize: 12 }}>Start: {fmtDate(r?.periodStart || r?.interventionDate)}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            End: {isSmeConfirmedMov(r)
                                ? fmtDate(r?.smmeAcceptedAt || r?.smmeSignedAt || r?.periodEnd)
                                : 'Awaiting SME confirmation'}
                        </Text>
                    </Space>
                )
            },
            {
                title: 'Status',
                dataIndex: 'status',
                render: (val: any, rec: any) => {
                    const s = String(val || 'pending')
                    const qi = buildQueriesIndex[String(rec?.id || '')]
                    const dot = qi?.open ? ` • ${qi.open}` : ''
                    const label = rec?.approvedByHod === true
                        ? 'HOD Approved'
                        : rec?.smmeAccepted === true
                            ? 'Awaiting HOD Approval'
                            : statusLabel(s)
                    return (
                        <Tag color={label === 'Awaiting HOD Approval' ? 'gold' : statusColor(s)}>
                            {label}
                            {dot}
                        </Tag>
                    )
                }
            },
            {
                title: 'Evidence',
                key: 'evidence',
                render: (_: any, record: MovDoc) => {
                    const count = Array.isArray(record?.resources)
                        ? record.resources.filter((item: any) => item?.link).length
                        : 0
                    return (
                        <Button
                            size="small"
                            shape='round'
                            icon={<UploadOutlined />}
                            onClick={() => openEvidenceManager(record)}
                        >
                            {count ? `Manage (${count})` : 'Add evidence'}
                        </Button>
                    )
                }
            },
            {
                title: 'Action',
                render: (_: any, record: MovDoc) => {
                    const qi = buildQueriesIndex[String(record?.id || '')]
                    const hasAny = !!qi && qi.total > 0
                    const hasOpen = !!qi && qi.open > 0
                    const label = hasOpen ? `Queries (${qi.open})` : 'Queries'
                    const isOpeningThis = openingMovId === String(record?.id)

                    return (
                        <Space size={8} wrap>
                            <Button
                                size='small'
                                icon={<EyeOutlined />}
                                style={roundBtn}
                                loading={isOpeningThis}
                                disabled={!!openingMovId && !isOpeningThis}
                                onClick={() => openMovReview(record)}
                            >
                                {isOpeningThis ? 'Opening…' : 'Review'}
                            </Button>
                            {hasAny && (
                                <Button
                                    size='small'
                                    variant={hasOpen ? 'solid' : 'outlined'}
                                    color="orange"
                                    onClick={() => openQueriesForMov(record)}
                                    loading={queriesForMovLoading && queriesForMovId === String(record?.id)}
                                    style={roundBtn}
                                    icon={<MessageOutlined />}
                                >
                                    {label}
                                </Button>
                            )}
                        </Space>
                    )
                }
            }
        ]
    }, [buildQueriesIndex, openingMovId, queriesForMovId, queriesForMovLoading, queries])

    // ------- POE for selected MOV (same priority as MOVsApprovalForm) -------
    const selectedMovQueries = selectedMov ? buildQueriesIndex[String((selectedMov as any).id)] : undefined
    const hasSelectedMovQueries = !!selectedMovQueries && selectedMovQueries.total > 0

    // Merge every POE we know about from the MOV, assignment, and query evidence.
    // into one deduped, labelled list so the reviewer can pick when there's more than one.
    const selectedMovPoeList = useMemo(() => {
        const linkToLabel = new Map<string, string>()

        selectedMovResources.forEach(r => {
            if (r?.link) linkToLabel.set(r.link, r.label || r.type || '')
        })

        const fallbackUrls = selectedMov
            ? Array.isArray((selectedMov as any).poeUrls) && (selectedMov as any).poeUrls.length
                ? (selectedMov as any).poeUrls
                : collectPoeUrlsFromRecord(selectedMov, selectedMovQueries)
            : []

        fallbackUrls.forEach((url: string) => {
            if (url && !linkToLabel.has(url)) linkToLabel.set(url, '')
        })

        return Array.from(linkToLabel.entries()).map(([link, label], idx) => ({
            link,
            label: label || `POE ${idx + 1}`
        }))
    }, [selectedMovResources, selectedMov, selectedMovQueries])

    const canViewPoe = selectedMovPoeList.length > 0
    const poeMenuItems: MenuProps['items'] = selectedMovPoeList.map((poe, idx) => ({
        key: String(idx),
        label: poe.label,
        onClick: () => window.open(poe.link, '_blank')
    }))

    const initialLoading = loadingMovs && !hasLoadedOnce
    const reloading = loadingMovs && hasLoadedOnce
    const statusSegments = [
        { value: metrics.approved, color: '#52c41a', label: 'Approved' },
        { value: metrics.awaiting, color: '#faad14', label: 'Awaiting Review' },
        { value: metrics.queried, color: '#ff4d4f', label: 'Queried' }
    ].filter(item => item.value > 0)

    return (
        <div style={{ padding: screens.xs ? 12 : 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Coordinator MOVs | Smart Incubation</title>
            </Helmet>

            {initialLoading && <LoadingOverlay tip="Loading your MOVs..." />}

            <MetricsGrid metrics={[
                { key: 'my-movs', title: 'My MOVs', value: metrics.total, icon: <FileTextOutlined />, iconBg: '#e6f4ff' },
                { key: 'approved', title: 'Approved', value: metrics.approved, icon: <CheckCircleOutlined />, iconBg: '#f6ffed' },
                { key: 'awaiting', title: 'Awaiting Review', value: metrics.awaiting, icon: <ClockCircleOutlined />, iconBg: '#fffbe6' },
                { key: 'queried', title: 'Queried MOVs', value: metrics.queried, icon: <ExclamationCircleOutlined />, iconBg: '#fff2f0' }
            ]} />

            <MotionCard style={{ marginTop: 24 }}>
                <Skeleton loading={reloading} active paragraph={{ rows: 3 }}>
                    {metrics.total > 0 ? (
                        <>
                            <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: '#f0f0f0' }}>
                                {statusSegments.map(item => (
                                    <div
                                        key={item.label}
                                        title={`${item.label}: ${item.value}`}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Filter by ${item.label}`}
                                        onClick={() => {
                                            const next = item.label === 'Approved' ? 'approved' : item.label === 'Queried' ? 'queried' : 'awaiting'
                                            setStatusFilter(statusFilter === next ? 'all' : next)
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') event.currentTarget.click()
                                        }}
                                        style={{ width: `${(item.value / metrics.total) * 100}%`, background: item.color, minWidth: 4, cursor: 'pointer', opacity: statusFilter !== 'all' && statusFilter !== (item.label === 'Approved' ? 'approved' : item.label === 'Queried' ? 'queried' : 'awaiting') ? 0.35 : 1, transition: 'opacity .2s ease' }}
                                    />
                                ))}
                            </div>
                            <div style={{ display: 'flex', marginTop: 10 }}>
                                {statusSegments.map(item => (
                                    <Text key={item.label} type="secondary" role="button" tabIndex={0} onClick={() => {
                                        const next = item.label === 'Approved' ? 'approved' : item.label === 'Queried' ? 'queried' : 'awaiting'
                                        setStatusFilter(statusFilter === next ? 'all' : next)
                                    }} style={{ width: `${(item.value / metrics.total) * 100}%`, minWidth: 0, fontSize: 12, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', opacity: statusFilter !== 'all' && statusFilter !== (item.label === 'Approved' ? 'approved' : item.label === 'Queried' ? 'queried' : 'awaiting') ? 0.35 : 1 }}>
                                        <span style={{ color: item.color, marginRight: 6 }}>●</span>{item.label} ({item.value})
                                    </Text>
                                ))}
                            </div>
                        </>
                    ) : null}
                </Skeleton>
            </MotionCard>

            <MotionCard
                style={{ marginTop: 16 }}
                filterBar={
                    <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} md={12} xl={6}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>Intervention</Text>
                            <Select showSearch value={interventionFilter} onChange={setInterventionFilter} style={{ width: '100%' }} optionFilterProp="label" options={[{ label: 'All interventions', value: 'all' }, ...interventionOptions]} />
                        </Col>
                        <Col xs={24} md={12} xl={6}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>SME</Text>
                            <Select showSearch value={smeFilter} onChange={setSmeFilter} style={{ width: '100%' }} optionFilterProp="label" options={[{ label: 'All SMEs', value: 'all' }, ...smeOptions]} />
                        </Col>
                        <Col xs={24} md={12} xl={6}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>Query Status</Text>
                            <Select<QueryFilter> value={queryFilter} onChange={setQueryFilter} style={{ width: '100%' }} options={[{ label: 'All MOVs', value: 'all' }, { label: 'Queried MOVs', value: 'queried' }, { label: 'Open Queries', value: 'open' }]} />
                        </Col>
                        <Col xs={24} md={12} xl={6}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>Service Date Range</Text>
                            <Space.Compact style={{ width: '100%' }}>
                                <RangePicker value={dateRange as any} onChange={dates => setDateRange(dates as [Dayjs | null, Dayjs | null] | null)} style={{ width: '100%' }} allowClear />
                                <Button icon={<ClearOutlined />} disabled={!filtersActive} onClick={resetFilters} />
                            </Space.Compact>
                        </Col>
                    </Row>
                }
            >
                <Skeleton loading={reloading} active paragraph={{ rows: 8 }}>
                    <Table
                        dataSource={filteredMovs}
                        columns={movColumns as any}
                        rowKey="id"
                        loading={initialLoading}
                        pagination={{ pageSize: 6, showSizeChanger: false, position: ['bottomCenter'] }}
                        scroll={{ x: 900 }}
                        locale={{ emptyText: <Empty description={filtersActive ? 'No MOVs match the selected filters.' : 'No SME-confirmed MOVs found for your account in this program.'} /> }}
                    />
                </Skeleton>
            </MotionCard>

            {/* Review single MOV (MOVsApprovalForm design) */}
            <Modal
                open={reviewOpen}
                title="Review MOV Document"
                onCancel={() => setReviewOpen(false)}
                styles={{ footer: { display: 'flex', gap: 8 } }}
                footer={[
                    <Button key="close" danger style={modalFooterButtonStyle} onClick={() => setReviewOpen(false)}>
                        Close
                    </Button>,
                    canViewPoe ? (
                        selectedMovPoeList.length > 1 ? (
                            <Dropdown key="poe" menu={{ items: poeMenuItems }} trigger={['click']}>
                                <Button icon={<EyeOutlined />} style={modalFooterButtonStyle}>
                                    View POEs ({selectedMovPoeList.length}) <DownOutlined />
                                </Button>
                            </Dropdown>
                        ) : (
                            <Button
                                key="poe"
                                icon={<EyeOutlined />}
                                style={modalFooterButtonStyle}
                                onClick={() => window.open(selectedMovPoeList[0].link, '_blank')}
                            >
                                View POE
                            </Button>
                        )
                    ) : null,
                    hasSelectedMovQueries && selectedMov ? (
                        <Button key="queries" icon={<MessageOutlined />} style={modalFooterButtonStyle} onClick={() => openQueriesForMov(selectedMov)}>
                            Open queries
                        </Button>
                    ) : null
                ]}
                width={screens.xs ? '100%' : 1400}
            >
                {selectedMov && (
                    <div style={{ maxHeight: 'none', overflowY: 'visible', padding: screens.xs ? 8 : 18, background: '#dfe3e8', border: '1px solid #cfd5dc', borderRadius: 8 }}>
                        <div style={{ maxWidth: 1120, minWidth: screens.xs ? 0 : 860, margin: '0 auto', background: '#fff', boxShadow: '0 8px 28px rgba(15,23,42,.16)', border: '1px solid #e5e7eb' }}>
                            <MovDocumentView mov={selectedMov} />
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                open={!!evidenceMov}
                title="Manage POE / Evidence"
                onCancel={() => {
                    setEvidenceMov(null)
                    setSelectedMovResources([])
                }}
                footer={<Row gutter={[12, 12]} style={{ width: '100%' }}>
                    <Col span={12}><Button block shape="round" danger onClick={() => { setEvidenceMov(null); setSelectedMovResources([]) }}>Cancel</Button></Col>
                    <Col span={12}><Upload multiple showUploadList={false} beforeUpload={file => { void uploadEvidenceForMov(file as File); return false }} disabled={evidenceLoading || evidenceUploading || !evidenceMov?.assignedInterventionId}>
                        <Button block shape="round" type="primary" icon={<UploadOutlined />} loading={evidenceUploading}>Upload</Button>
                    </Upload></Col>
                </Row>}
                width={screens.xs ? '100%' : 700}
            >
                {evidenceMov ? <EvidenceManagerPanel
                    participantLabel={evidenceMov.smmeCompanyName || evidenceMov.smmeName}
                    interventionLabel={evidenceMov.interventionTitle}
                    resources={selectedMovResources}
                    loading={evidenceLoading}
                    uploading={evidenceUploading}
                    disabled={!evidenceMov.assignedInterventionId}
                    showUpload={false}
                    onUpload={uploadEvidenceForMov}
                    onRemove={removeEvidenceForMov}
                /> : null}
            </Modal>

            {/* Queries list for selected MOV */}
            <Modal
                open={queriesModalOpen}
                onCancel={() => {
                    setQueriesModalOpen(false)
                    setQueriesForMov([])
                    setQueriesForMovId(null)
                }}
                footer={null}
                title="Queries & Evidence"
                width={screens.xs ? '100%' : 950}
            >
                <Table
                    loading={queriesForMovLoading}
                    rowKey="id"
                    dataSource={queriesForMov}
                    pagination={false}
                    scroll={{ x: 900 }}
                    columns={[
                        { title: 'Message', dataIndex: 'queryMessage' },
                        {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (s: string) => (
                                <Tag color={String(s || 'open').toLowerCase() === 'resolved' ? 'green' : 'orange'}>
                                    {(s || 'open').toUpperCase()}
                                </Tag>
                            )
                        },
                        {
                            title: 'Evidence',
                            dataIndex: 'uploadedFileUrl',
                            render: (url?: string) =>
                                url ? (
                                    <Button size="small" style={roundBtn} onClick={() => window.open(url, '_blank')}>
                                        Open
                                    </Button>
                                ) : (
                                    <span style={{ color: '#999' }}>—</span>
                                )
                        },
                        {
                            title: 'Resolved Notes',
                            dataIndex: 'resolutionNotes',
                            render: (t?: string) => t || '—'
                        },
                        {
                            title: 'Updated',
                            dataIndex: 'updatedAt',
                            render: (val: any) => (val ? fmtDateTime(val) : '—')
                        },
                        {
                            title: 'Action',
                            render: (_: any, r: QueryDoc) => {
                                const resolved = String(r.status || 'open').toLowerCase() === 'resolved'
                                return (
                                    <Button
                                        type="primary"
                                        icon={<UploadOutlined />}
                                        style={roundBtn}
                                        disabled={resolved}
                                        onClick={() => startResolve(r)}
                                    >
                                        {resolved ? 'Resolved' : 'Resolve'}
                                    </Button>
                                )
                            }
                        }
                    ]}
                    locale={{ emptyText: <Empty description="No queries found." /> }}
                />
            </Modal>

            <ResolveQueryModal
                open={!!resolvingQuery}
                query={resolvingQuery}
                actor={{
                    id: user?.uid || '',
                    name: user?.name || user?.displayName || null,
                    email: user?.email || null,
                    role: user?.role || 'coordinator',
                    departmentName: user?.departmentName || null
                }}
                onClose={() => setResolvingQuery(null)}
                onResolved={handleQueryResolved}
            />
        </div>
    )
}

export default CoordinatorMOVs
