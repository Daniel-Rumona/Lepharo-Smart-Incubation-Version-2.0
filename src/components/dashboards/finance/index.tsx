import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
    Table,
    Row,
    Col,
    Tag,
    Modal,
    Button,
    Typography,
    Alert,
    Skeleton,
    Empty
} from 'antd'
import {
    DollarOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    RiseOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import Highcharts from 'highcharts'
import DrilldownModule from 'highcharts/modules/drilldown'
import HighchartsReact from 'highcharts-react-official'
import dayjs from 'dayjs'
import axios from 'axios'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '../metrics/Header'
import DepartmentInterventionsStatus from '../charts/InterventionsBreakdown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { fetchAppointments } from '@/services/appointmentService'
import {
    complianceDocumentKey,
    complianceRequirementKey
} from '@/services/complianceResolver'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'

if (typeof DrilldownModule === 'function') DrilldownModule(Highcharts)

const { Text } = Typography
const API_BASE_URL = 'https://quantnow-sa1e.onrender.com'
const QX_FINANCE_EMAIL = import.meta.env.VITE_QX_FINANCE_EMAIL || import.meta.env.VITE_FINANCE_EMAIL || ''
const QX_FINANCE_PASSWORD = import.meta.env.VITE_QX_FINANCE_PASSWORD || import.meta.env.VITE_FINANCE_PASSWORD || ''
const FINANCE_SESSION_KEY = 'qx_finance_session'

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()
const money = (value?: number | null) =>
    `R ${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`

type RequiredDoc = {
    id: string
    title: string
    type?: 'upload' | 'agreement'
    agreementId?: string
    hasExpiry?: boolean
    expiryMonths?: number | null
    presetId?: string
}

type ComplianceDoc = {
    id: string
    kind: 'upload' | 'agreement'
    slug: string
    documentName: string
    status: 'valid' | 'expired' | 'pending' | 'invalid' | 'queried' | string
    issueDate?: string
    expiryDate?: string
    url?: string
    programId?: string
    departmentId?: string
}

type Application = {
    id: string
    participantId?: string
    beneficiaryName?: string
    email?: string
    contactEmail?: string
    primaryEmail?: string
    businessEmail?: string
    programId?: string
    programName?: string
    departmentId?: string
    complianceDocuments?: ComplianceDoc[]
}

type AssignedIntervention = {
    id: string
    participantId?: string
    participantName?: string
    areaOfSupport?: string
    departmentId?: string
    interventionTitle?: string
    status?: string
    createdAt?: any
    dueDate?: any
    scheduledAt?: any
    appointmentDate?: any
    completedAt?: any
    programId?: string
}

type FinanceSummary = {
    clients: number
    totalRevenue: number
    growingSmes: number
    flatSmes: number
    decliningSmes: number
    monthlyRevenue: Array<{
        month: string
        label: string
        revenue: number
    }>
}

type FirestoreParticipant = {
    id: string
    beneficiaryName?: string
    participantName?: string
    companyName?: string
    businessName?: string
    email?: string
    programId?: string
    activeProgramId?: string
    programIds?: string[]
    programs?: Array<string | { id?: string; programId?: string }>
}

const keyForReq = (r: RequiredDoc) => complianceRequirementKey(r)

const keyForDoc = (d: ComplianceDoc) => complianceDocumentKey(d)

const statusColor = (s: string) =>
    s === 'valid'
        ? 'green'
        : s === 'expired'
            ? 'red'
            : s === 'pending'
                ? 'blue'
                : s === 'invalid' || s === 'queried'
                    ? 'volcano'
                    : 'default'

const toDay = (v?: string) => (v ? dayjs(v) : null)

const normaliseMonthlyFinance = (rows: any[]) => {
    if (!Array.isArray(rows)) return []
    return rows.map(row => ({
        month: String(row.month || row.monthLabel || row.month_label || ''),
        label: String(row.monthLabel || row.month_label || row.month || ''),
        revenue: Number(row.revenue || 0)
    }))
}

const getCompanyName = (company: any) =>
    String(company.name || company.company || company.companyName || 'Unknown')

const getCompanyEmail = (company: any) => String(company.email || '')

const getParticipantProgramIds = (participant: FirestoreParticipant) => {
    const source = participant as any
    const programValues = [
        source.programId,
        source.activeProgramId,
        source.programmeId,
        source.program?.id,
        source.program?.programId,
        ...(Array.isArray(source.programIds) ? source.programIds : []),
        ...(Array.isArray(source.programs)
            ? source.programs.map((program: any) =>
                typeof program === 'string' ? program : program?.id || program?.programId
            )
            : [])
    ]

    return new Set(programValues.map(value => String(value || '').trim()).filter(Boolean))
}

const isParticipantInProgram = (participant: FirestoreParticipant, activeProgramId?: string) => {
    if (!activeProgramId) return true
    return getParticipantProgramIds(participant).has(activeProgramId)
}

const isSameIdentity = (
    client: { name?: string; email?: string },
    participant: FirestoreParticipant
) => {
    const clientEmail = String(client.email || '').trim().toLowerCase()
    const participantEmail = String(participant.email || '').trim().toLowerCase()
    if (clientEmail && participantEmail && clientEmail === participantEmail) return true

    const clientName = String(client.name || '').trim().toLowerCase()
    const participantNames = [
        participant.beneficiaryName,
        participant.participantName,
        participant.companyName,
        participant.businessName
    ]
        .filter(Boolean)
        .map(name => String(name).trim().toLowerCase())

    return Boolean(clientName && participantNames.includes(clientName))
}

const getFinanceToken = async () => {
    if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(FINANCE_SESSION_KEY)
        if (raw) {
            try {
                const stored = JSON.parse(raw)
                if (stored?.token && (!stored.expiresAt || stored.expiresAt > Date.now())) {
                    return stored.token as string
                }
            } catch {
                window.localStorage.removeItem(FINANCE_SESSION_KEY)
            }
        }

        const legacyToken = window.sessionStorage.getItem('qx_token')
        if (legacyToken) return legacyToken
    }

    if (!QX_FINANCE_EMAIL || !QX_FINANCE_PASSWORD) {
        throw new Error('Finance credentials are not configured.')
    }

    const response = await axios.post(`${API_BASE_URL}/login`, {
        email: QX_FINANCE_EMAIL,
        password: QX_FINANCE_PASSWORD
    })

    const token = response.data?.token
    if (!token) throw new Error('Finance API did not return an access token.')

    if (typeof window !== 'undefined') {
        window.localStorage.setItem(
            FINANCE_SESSION_KEY,
            JSON.stringify({
                token,
                user: response.data?.user,
                email: response.data?.user?.email,
                savedAt: Date.now(),
                expiresAt: Date.now() + 8 * 60 * 60 * 1000
            })
        )
    }

    return token as string
}

const FinanceDashboard: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const programId = activeProgramId || null

    const [loading, setLoading] = useState(true)
    const [apps, setApps] = useState<Application[]>([])
    const [reqsForProgram, setReqsForProgram] = useState<RequiredDoc[]>([])
    const [assigned, setAssigned] = useState<AssignedIntervention[]>([])
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })
    const [financeSummary, setFinanceSummary] = useState<FinanceSummary>({
        clients: 0,
        totalRevenue: 0,
        growingSmes: 0,
        flatSmes: 0,
        decliningSmes: 0,
        monthlyRevenue: []
    })
    const [financeSummaryLoading, setFinanceSummaryLoading] = useState(false)

    const [modalVisible, setModalVisible] = useState(false)
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null)


    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)

    const [pageLoading, setPageLoading] = useState(false)
    const loadTokenRef = useRef(0)


    const deptName = (user?.departmentName || '').toLowerCase().trim()

    /* ---------------- program requirements (dept + active program) ---------------- */
    useEffect(() => {
        const run = async () => {
            if (!user?.departmentId || !programId) {
                setReqsForProgram([])
                return
            }

            const snap = await getDocs(
                query(
                    collection(db, 'programRequirements'),
                    where('departmentId', '==', user.departmentId),
                    where('programId', '==', programId)
                )
            )

            // Merge (in case multiple docs exist)
            const merged: RequiredDoc[] = []
            snap.docs.forEach(d => {
                const v = d.data() as any
                const reqs = (v.requiredDocuments || []) as RequiredDoc[]
                merged.push(...reqs)
            })

            const uniq = new Map<string, RequiredDoc>()
            merged.forEach(r => uniq.set(keyForReq(r), r))
            setReqsForProgram(Array.from(uniq.values()))
        }

        run()
    }, [user?.departmentId, programId])


    useEffect(() => {
        if (!user?.departmentId) {
            setAppointments([])
            return
        }

        const run = async () => {
            try {
                const rows = await fetchAppointments({
                    departmentId: user.departmentId,
                    programId
                })
                setAppointments(rows)
            } catch (error) {
                console.error('Error fetching appointments:', error)
                setAppointments([])
            }
        }

        run()
    }, [user?.departmentId, programId])

    /* ---------------- applications ---------------- */
    useEffect(() => {
        const run = async () => {
            if (!programId) {
                setApps([])
                return
            }

            setLoading(true)
            try {
                const appSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('programId', '==', programId),
                        where('applicationStatus', '==', 'accepted')
                    )
                )

                const EXCLUDED_DOMAIN = '@quantilytix.co.za'

                const eligibleDocs = appSnap.docs.filter(d => {
                    const data = d.data() as any
                    const email = String(data.email || data.contactEmail || data.primaryEmail || '').toLowerCase().trim()
                    return email && !email.endsWith(EXCLUDED_DOMAIN)
                })

                const rows: Application[] = await Promise.all(
                    eligibleDocs.map(async d => {
                        const base = { id: d.id, ...(d.data() as any) } as Application

                        const upSnap = await getDocs(collection(db, 'applications', d.id, 'complianceDocuments'))
                        const uploads: ComplianceDoc[] = upSnap.docs.map(s => {
                            const v = s.data() as any
                            const friendly =
                                v.title ||
                                v.documentName ||
                                v.type ||
                                'Document'

                            return {
                                id: s.id,
                                kind: 'upload',
                                slug: normalize(v.presetId || v.preset || v.type || friendly),
                                documentName: friendly,
                                status: (v.status || 'pending').toLowerCase(),
                                issueDate: v.issueDate || '',
                                expiryDate: v.expiryDate || '',
                                url: v.url || v.pdfUrl || '',
                                programId: base.programId,
                                departmentId: v.departmentId || base.departmentId
                            }
                        })

                        const agSnap = await getDocs(collection(db, 'applications', d.id, 'agreements'))
                        const agreements: ComplianceDoc[] = agSnap.docs.map(s => {
                            const v = s.data() as any
                            const slug = normalize(s.id)
                            const title = v.title || slug.replace(/-/g, ' ')
                            const acceptedIso = v.acceptedAt?.seconds
                                ? new Date(v.acceptedAt.seconds * 1000).toISOString().slice(0, 10)
                                : ''

                            return {
                                id: s.id,
                                kind: 'agreement',
                                slug,
                                documentName: title,
                                status: 'valid',
                                issueDate: acceptedIso,
                                expiryDate: '',
                                url: v.pdfUrl || v._original?.pdfUrl || '',
                                programId: base.programId,
                                departmentId: base.departmentId
                            }
                        })

                        return { ...base, complianceDocuments: [...uploads, ...agreements] }
                    })
                )

                setApps(rows)


                setApps(rows)
            } finally {
                setLoading(false)
            }
        }

        run()
    }, [programId])

    /* ---------------- assigned interventions (active program + dept) ---------------- */
    useEffect(() => {
        const run = async () => {
            if (!user?.departmentId || !programId) {
                setReqsForProgram([])
                setApps([])
                setAssigned([])
                return
            }

            // 🔒 token guard (prevents stale loads overwriting new program data)
            const myToken = ++loadTokenRef.current

            // show overlay + reset visible program data immediately
            setPageLoading(true)
            setLoading(true)
            setReqsForProgram([])
            setApps([])
            setAssigned([])
            setSelectedAppId(null)
            setModalVisible(false)

            try {
                const EXCLUDED_DOMAIN = '@quantilytix.co.za'

                const reqsPromise = (async () => {
                    const snap = await getDocs(
                        query(
                            collection(db, 'programRequirements'),
                            where('departmentId', '==', user.departmentId),
                            where('programId', '==', programId)
                        )
                    )

                    const merged: RequiredDoc[] = []
                    snap.docs.forEach(d => {
                        const v = d.data() as any
                        merged.push(...((v.requiredDocuments || []) as RequiredDoc[]))
                    })

                    const uniq = new Map<string, RequiredDoc>()
                    merged.forEach(r => uniq.set(keyForReq(r), r))
                    return Array.from(uniq.values())
                })()

                const appsPromise = (async () => {
                    const appSnap = await getDocs(
                        query(
                            collection(db, 'applications'),
                            where('programId', '==', programId),
                            where('applicationStatus', '==', 'accepted')
                        )
                    )

                    const eligibleDocs = appSnap.docs.filter(d => {
                        const data = d.data() as any
                        const email = String(
                            data.email || data.contactEmail || data.primaryEmail || ''
                        )
                            .toLowerCase()
                            .trim()
                        return email && !email.endsWith(EXCLUDED_DOMAIN)
                    })

                    const rows: Application[] = await Promise.all(
                        eligibleDocs.map(async d => {
                            const base = { id: d.id, ...(d.data() as any) } as Application

                            const upSnap = await getDocs(
                                collection(db, 'applications', d.id, 'complianceDocuments')
                            )
                            const uploads: ComplianceDoc[] = upSnap.docs.map(s => {
                                const v = s.data() as any
                                const friendly =
                                    v.title ||
                                    v.documentName ||
                                    v.type ||
                                    'Document'

                                return {
                                    id: s.id,
                                    kind: 'upload',
                                    slug: normalize(v.presetId || v.preset || v.type || friendly),
                                    documentName: friendly,
                                    status: (v.status || 'pending').toLowerCase(),
                                    issueDate: v.issueDate || '',
                                    expiryDate: v.expiryDate || '',
                                    url: v.url || v.pdfUrl || '',
                                    programId: base.programId,
                                    departmentId: v.departmentId || base.departmentId
                                }
                            })

                            const agSnap = await getDocs(
                                collection(db, 'applications', d.id, 'agreements')
                            )
                            const agreements: ComplianceDoc[] = agSnap.docs.map(s => {
                                const v = s.data() as any
                                const slug = normalize(s.id)
                                const title = v.title || slug.replace(/-/g, ' ')
                                const acceptedIso = v.acceptedAt?.seconds
                                    ? new Date(v.acceptedAt.seconds * 1000)
                                        .toISOString()
                                        .slice(0, 10)
                                    : ''

                                return {
                                    id: s.id,
                                    kind: 'agreement',
                                    slug,
                                    documentName: title,
                                    status: 'valid',
                                    issueDate: acceptedIso,
                                    expiryDate: '',
                                    url: v.pdfUrl || v._original?.pdfUrl || '',
                                    programId: base.programId,
                                    departmentId: base.departmentId
                                }
                            })

                            return { ...base, complianceDocuments: [...uploads, ...agreements] }
                        })
                    )

                    return rows
                })()

                const assignedPromise = (async () => {
                    const snap = await getDocs(
                        query(
                            collection(db, 'assignedInterventions'),
                            where('programId', '==', programId)
                        )
                    )

                    const rows = snap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    })) as AssignedIntervention[]

                    const deptId = user?.departmentId || ''
                    const filtered = rows.filter(r => {
                        if (deptId && r.departmentId) return r.departmentId === deptId
                        if (deptName)
                            return (r.areaOfSupport || '').toLowerCase().trim() === deptName
                        return true
                    })

                    return filtered
                })()

                const [reqs, acceptedApps, assignedRows] = await Promise.all([
                    reqsPromise,
                    appsPromise,
                    assignedPromise
                ])

                if (loadTokenRef.current !== myToken) return

                setReqsForProgram(reqs)
                setApps(acceptedApps)
                setAssigned(assignedRows)
            } finally {
                if (loadTokenRef.current === myToken) {
                    setLoading(false)
                    setPageLoading(false)
                }
            }
        }

        run()
    }, [user?.departmentId, programId, deptName])

    useEffect(() => {
        const run = async () => {
            if (!programId) {
                setInterventionMetrics({
                    totalRequired: 0,
                    assigned: 0,
                    pendingAssignment: 0,
                    inProgress: 0,
                    completed: 0
                })
                return
            }

            try {
                const metrics = await loadInterventionMetrics({
                    programId,
                    assignedMatches: row => {
                        if (user?.departmentId && row.departmentId) return row.departmentId === user.departmentId
                        if (deptName) return String(row.areaOfSupport || '').toLowerCase().trim() === deptName
                        return true
                    },
                    requiredMatches: entry => {
                        if (user?.departmentId && String(entry.departmentId || '') === user.departmentId) return true
                        if (deptName) {
                            return String(entry.areaOfSupport || entry.area || '').toLowerCase().trim() === deptName
                        }
                        return true
                    }
                })
                setInterventionMetrics(metrics)
            } catch (error) {
                console.error('[FinanceDashboard] intervention metrics failed', error)
                setInterventionMetrics({
                    totalRequired: 0,
                    assigned: 0,
                    pendingAssignment: 0,
                    inProgress: 0,
                    completed: 0
                })
            }
        }

        run()
    }, [user?.departmentId, programId, deptName])

    useEffect(() => {
        let cancelled = false

        const run = async () => {
            setFinanceSummaryLoading(true)

            try {
                const token = await getFinanceToken()
                const [participantsSnap, membershipsResponse] = await Promise.all([
                    getDocs(collection(db, 'participants')),
                    axios.get(`${API_BASE_URL}/admin/all-memberships`, {
                        headers: { Authorization: `Bearer ${token}` }
                    })
                ])

                const participants = participantsSnap.docs
                    .map(item => ({ id: item.id, ...item.data() }) as FirestoreParticipant)
                    .filter(participant => isParticipantInProgram(participant, programId || undefined))

                const companies = Array.isArray(membershipsResponse.data?.companies)
                    ? membershipsResponse.data.companies
                    : []

                const scopedCompanies = programId
                    ? companies.filter((company: any) =>
                        participants.some(participant =>
                            isSameIdentity(
                                {
                                    name: getCompanyName(company),
                                    email: getCompanyEmail(company)
                                },
                                participant
                            )
                        )
                    )
                    : companies

                const results = await Promise.allSettled(
                    scopedCompanies.map(async (company: any) => {
                        const email = getCompanyEmail(company)
                        if (!email) return { revenue: 0, growing: false }

                        const [revenueResult, monthlyResult] = await Promise.allSettled([
                            axios.get(`${API_BASE_URL}/api/stats/public/revenue`, {
                                params: { email }
                            }),
                            axios.get(`${API_BASE_URL}/api/stats/public/revenue-monthly`, {
                                params: { email, months: 12 }
                            })
                        ])

                        const revenue =
                            revenueResult.status === 'fulfilled'
                                ? Number(revenueResult.value.data?.value || 0)
                                : 0
                        const months =
                            monthlyResult.status === 'fulfilled'
                                ? normaliseMonthlyFinance(
                                    monthlyResult.value.data?.months ||
                                    monthlyResult.value.data ||
                                    []
                                )
                                : []
                        const current = Number(months[months.length - 1]?.revenue || 0)
                        const previous = Number(months[months.length - 2]?.revenue || 0)
                        const growth = current > previous ? 'growing' : current < previous ? 'declining' : 'flat'

                        return { revenue, growth, months }
                    })
                )

                if (cancelled) return

                const fulfilled = results
                    .filter((result): result is PromiseFulfilledResult<{ revenue: number; growth: string; months: ReturnType<typeof normaliseMonthlyFinance> }> => result.status === 'fulfilled')
                    .map(result => result.value)
                const monthTotals = new Map<string, { label: string; revenue: number }>()

                fulfilled.forEach(item => {
                    item.months.forEach(month => {
                        const key = month.month || month.label
                        if (!key) return
                        const current = monthTotals.get(key) || { label: month.label || key, revenue: 0 }
                        current.revenue += Number(month.revenue || 0)
                        monthTotals.set(key, current)
                    })
                })

                const monthlyRevenue = Array.from(monthTotals.entries())
                    .map(([month, value]) => ({ month, label: value.label, revenue: value.revenue }))
                    .sort((a, b) => a.month.localeCompare(b.month))

                setFinanceSummary({
                    clients: scopedCompanies.length,
                    totalRevenue: fulfilled.reduce((sum, item) => sum + item.revenue, 0),
                    growingSmes: fulfilled.filter(item => item.growth === 'growing').length,
                    flatSmes: fulfilled.filter(item => item.growth === 'flat').length,
                    decliningSmes: fulfilled.filter(item => item.growth === 'declining').length,
                    monthlyRevenue
                })
            } catch (error) {
                console.error('Error loading finance dashboard summary:', error)
                if (!cancelled) setFinanceSummary({ clients: 0, totalRevenue: 0, growingSmes: 0, flatSmes: 0, decliningSmes: 0, monthlyRevenue: [] })
            } finally {
                if (!cancelled) setFinanceSummaryLoading(false)
            }
        }

        run()

        return () => {
            cancelled = true
        }
    }, [programId])


    /* ---------------- grading ---------------- */
    type RowVM = {
        id: string
        beneficiary: string
        scorePct: number
        issues: { missing: number; expired: number; invalid: number; pending: number }
        docs: ComplianceDoc[]
        reqs: RequiredDoc[]
    }

    const gradeApp = useCallback(
        (app: Application): RowVM => {
            const reqs = reqsForProgram || []

            const docs = (app.complianceDocuments || []).filter(d => {
                if (d.kind === 'agreement') return true
                return !user?.departmentId || d.departmentId === user.departmentId
            })

            const byKey = new Map(docs.map(d => [keyForDoc(d), d]))

            const deriveStatus = (d?: ComplianceDoc, r?: RequiredDoc) => {
                if (!d) return 'missing'
                const base = (d.status || 'pending').toLowerCase()
                if (!r?.hasExpiry) return base
                const issue = toDay(d.issueDate)
                const exp =
                    toDay(d.expiryDate) ||
                    (issue && r.expiryMonths ? issue.add(r.expiryMonths, 'month') : null)
                if (exp && exp.isBefore(dayjs(), 'day')) return 'expired'
                return base
            }

            let valid = 0,
                expired = 0,
                invalid = 0,
                pending = 0,
                missing = 0

            reqs.forEach(r => {
                const k = keyForReq(r)
                const d = byKey.get(k)
                const s = deriveStatus(d, r)
                if (s === 'valid') valid++
                else if (s === 'expired') expired++
                else if (s === 'invalid' || s === 'queried') invalid++
                else if (s === 'pending') pending++
                else missing++
            })

            const need = reqs.length || 0
            const scorePct = need ? Math.round((valid / need) * 100) : 0

            return {
                id: app.id,
                beneficiary: app.beneficiaryName || '—',
                scorePct,
                issues: { missing, expired, invalid, pending },
                docs,
                reqs
            }
        },
        [reqsForProgram, user?.departmentId]
    )

    const rows: RowVM[] = useMemo(() => apps.map(gradeApp), [apps, gradeApp])

    const totals = useMemo(() => {
        let full = 0,
            total = rows.length
        rows.forEach(r => {
            const clean =
                r.reqs.length > 0 &&
                r.issues.missing === 0 &&
                r.issues.expired === 0 &&
                r.issues.invalid === 0 &&
                r.issues.pending === 0
            if (clean) full++
        })
        return { total, full, partial: Math.max(total - full, 0) }
    }, [rows])

    const columns = [
        { title: 'Beneficiary', dataIndex: 'beneficiary', key: 'beneficiary' },
        {
            title: 'Compliance Score',
            key: 'score',
            render: (_: any, r: RowVM) => {
                const color = r.scorePct >= 80 ? 'green' : r.scorePct >= 50 ? 'orange' : 'red'
                return <Tag color={color}>{r.scorePct}%</Tag>
            }
        },
        {
            title: 'Issues',
            key: 'issues',
            render: (_: any, r: RowVM) => {
                if (!r.reqs.length) return <Tag>—</Tag>
                const parts: string[] = []
                if (r.issues.missing) parts.push(`Missing ${r.issues.missing}`)
                if (r.issues.expired) parts.push(`Expired ${r.issues.expired}`)
                if (r.issues.pending) parts.push(`Pending ${r.issues.pending}`)
                if (r.issues.invalid) parts.push(`Invalid ${r.issues.invalid}`)
                if (!parts.length) return <Tag color='green'>All valid</Tag>
                return parts.map((p, i) => (
                    <Tag key={i} color='red'>
                        {p}
                    </Tag>
                ))
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, r: RowVM) => (
                <Button
                    icon={<EyeOutlined />}
                    onClick={() => {
                        setSelectedAppId(r.id)
                        setModalVisible(true)
                    }}
                >
                    View
                </Button>
            )
        }
    ]

    const selectedVM = selectedAppId ? rows.find(r => r.id === selectedAppId) : null
    const docMap = new Map((selectedVM?.docs || []).map(d => [keyForDoc(d), d]))

    const hasProgram = !!programId
    const financeTrendOptions = useMemo<Highcharts.Options>(() => ({
        chart: {
            type: 'areaspline',
            height: 220,
            backgroundColor: 'transparent'
        },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            categories: financeSummary.monthlyRevenue.map(item => item.label || item.month),
            lineColor: '#e5e7eb',
            tickColor: '#e5e7eb',
            labels: { style: { color: '#6b7280', fontSize: '11px' } }
        },
        yAxis: {
            title: { text: undefined },
            gridLineColor: '#f0f0f0',
            labels: {
                style: { color: '#6b7280', fontSize: '11px' },
                formatter: function () {
                    return `R ${Number(this.value || 0).toLocaleString()}`
                }
            }
        },
        tooltip: {
            pointFormatter: function () {
                return `<span style="color:${this.color}">\u25CF</span> Revenue: <b>${money(Number(this.y || 0))}</b><br/>`
            }
        },
        plotOptions: {
            areaspline: {
                marker: { radius: 3 },
                lineWidth: 2,
                fillOpacity: 0.16
            }
        },
        series: [
            {
                type: 'areaspline',
                name: 'Revenue',
                color: '#1677ff',
                data: financeSummary.monthlyRevenue.map(item => Number(item.revenue || 0))
            }
        ]
    }), [financeSummary.monthlyRevenue])

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>

            {pageLoading && (
                <LoadingOverlay tip='Loading program data...' />
            )}


            <div style={{ marginBottom: 16 }}>
                <InterventionMetricsGrid metrics={interventionMetrics} loading={pageLoading} />
            </div>

            <Row gutter={16}>
                <Col xs={24} lg={12}>
                    {/* Pass programId down */}
                    <DepartmentInterventionsStatus
                        departmentName={user?.departmentName}
                        programId={programId || undefined}
                    />
                </Col>

                <Col xs={24} lg={12}>
                    <MotionCard style={{ marginBottom: 10 }}>
                        {financeSummaryLoading ? (
                            <Skeleton />
                        ) : (
                            <div>
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} md={8}>
                                        <MotionCard.Metric
                                            title='Clients'
                                            value={financeSummary.clients}
                                            icon={<TeamOutlined />}
                                            iconBg='rgba(22,119,255,.12)'
                                        />
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <MotionCard.Metric
                                            title='Total Revenue'
                                            value={money(financeSummary.totalRevenue)}
                                            icon={<DollarOutlined />}
                                            iconBg='rgba(82,196,26,.14)'
                                        />
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <MotionCard.Metric
                                            title='Growing SMEs'
                                            value={financeSummary.growingSmes}
                                            icon={<RiseOutlined />}
                                            iconBg='rgba(114,46,209,.12)'
                                        />
                                    </Col>
                                </Row>
                                <div style={{ marginTop: 16 }}>
                                    <Row gutter={[12, 12]} align='stretch'>
                                        <Col xs={24} lg={17}>
                                            <MotionCard
                                                style={{
                                                    borderRadius: 8,
                                                    minHeight: 270
                                                }}
                                                styles={{ body: { padding: 12, minHeight: 270 } }}
                                            >
                                                <div style={{ marginBottom: 8 }}>
                                                    <Text strong>12-Month Revenue Trend</Text>
                                                </div>
                                                {financeSummary.monthlyRevenue.length ? (
                                                    <HighchartsReact highcharts={Highcharts} options={financeTrendOptions} />
                                                ) : (
                                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No revenue trend data yet.' />
                                                )}
                                            </MotionCard>
                                        </Col>
                                        <Col xs={24} lg={7}>
                                            <MotionCard
                                                style={{
                                                    borderRadius: 8,
                                                    height: '100%',
                                                    minHeight: 270
                                                }}
                                                styles={{ body: { padding: 12, minHeight: 270 } }}
                                            >
                                                <Text strong>SME Momentum</Text>
                                                <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                                                    <Tag color='green' style={{ margin: 0, padding: '8px 10px' }}>
                                                        Growing: {financeSummary.growingSmes}
                                                    </Tag>
                                                    <Tag color='blue' style={{ margin: 0, padding: '8px 10px' }}>
                                                        Flat: {financeSummary.flatSmes}
                                                    </Tag>
                                                    <Tag color='red' style={{ margin: 0, padding: '8px 10px' }}>
                                                        Declining: {financeSummary.decliningSmes}
                                                    </Tag>
                                                </div>
                                            </MotionCard>
                                        </Col>
                                    </Row>
                                </div>
                            </div>
                        )}
                    </MotionCard>

                    <UpcomingAppointmentsCard
                        departmentId={user?.departmentId}
                        programId={programId}
                        appointments={appointments}
                        daysAhead={7}
                        limit={3}
                        onViewCalendar={() => setCalendarVisible(true)}
                    />


                </Col>
            </Row>

            {/* Modal: documents */}
            <Modal
                title='Compliance Documents'
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={<Button onClick={() => setModalVisible(false)}>Close</Button>}
            >
                <Alert
                    type='info'
                    message='Expiry dates and near-expiry items impact compliance.'
                    showIcon
                    style={{ marginBottom: 12 }}
                />

                {selectedVM ? (
                    <div>
                        {selectedVM.reqs.map(req => {
                            const k = keyForReq(req)
                            const d = docMap.get(k)
                            const issue = toDay(d?.issueDate)
                            const exp = req.hasExpiry
                                ? toDay(d?.expiryDate) ||
                                (issue && req.expiryMonths ? issue.add(req.expiryMonths, 'month') : null)
                                : null

                            const isExpired = !!(exp && exp.isBefore(dayjs(), 'day'))
                            const state = !d ? 'missing' : isExpired ? 'expired' : (d?.status || 'pending').toLowerCase()

                            return (
                                <Row key={k} align='middle' style={{ marginBottom: 8 }}>
                                    <Col span={10}>
                                        <Text>{req.title}</Text>
                                    </Col>
                                    <Col span={4}>
                                        <Tag color={statusColor(state)}>{state}</Tag>
                                    </Col>
                                    <Col span={6}>
                                        {req.hasExpiry
                                            ? exp
                                                ? `Expiry: ${exp.format('YYYY-MM-DD')}`
                                                : 'No expiry date'
                                            : 'No expiry'}
                                    </Col>
                                    <Col span={4}>
                                        {d?.url ? (
                                            <a onClick={() => window.open(d.url!, '_blank')}>view</a>
                                        ) : (
                                            <span style={{ color: '#999' }}>—</span>
                                        )}
                                    </Col>
                                </Row>
                            )
                        })}
                    </div>
                ) : (
                    <Text>No participant selected.</Text>
                )}
            </Modal>

            {/* Calendar modal */}
            <AppointmentsCalendarModal
                open={calendarVisible}
                onClose={() => setCalendarVisible(false)}
                appointments={appointments}
                departmentId={user?.departmentId}
                onAppointmentClick={appointment => {
                    setSelectedAppointment(appointment)
                    setAppointmentDetailsVisible(true)
                }}
            />

            <AppointmentDetailsModal
                open={appointmentDetailsVisible}
                onClose={() => setAppointmentDetailsVisible(false)}
                appointment={selectedAppointment}
            />
        </div>
    )
}

export default FinanceDashboard
