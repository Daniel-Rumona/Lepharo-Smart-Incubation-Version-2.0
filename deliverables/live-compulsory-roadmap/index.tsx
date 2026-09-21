import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Collapse,
    Col,
    Divider,
    Form,
    Grid,
    Input,
    Progress,
    Row,
    Space,
    Table,
    Tag,
    Typography,
    message,
    Popconfirm,
    Skeleton,
    Select,
    Segmented,
    List
} from 'antd'
import {
    CheckCircleOutlined,
    CheckOutlined,
    DeleteOutlined,
    PlusOutlined,
    FileTextOutlined,
    RocketOutlined,
    CalendarOutlined,
    FlagOutlined,
    RiseOutlined
} from '@ant-design/icons'
import GroupProgressForm from '../group'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    approveDiagnosticPlanMovBySmme,
    createOrUpdateDiagnosticPlanMovDraft
} from '@/services/movService'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

// BEGIN COMPULSORY ROADMAP HELPERS
const isCompulsoryItem = (item: any, catalog: any[]): boolean => {
    const id = String(item?.id || item?.interventionId || '').trim()
    return !!id && catalog.some(def => String(def.id || '').trim() === id && def.compulsory === true)
}
const isCompulsoryOnly = (items: any[], catalog: any[]): boolean =>
    items.length > 0 && items.every(item => isCompulsoryItem(item, catalog))
// END COMPULSORY ROADMAP HELPERS

const { Title, Text } = Typography
const { Panel } = Collapse
const { useBreakpoint } = Grid

type DeptRow = {
    id: string
    name: string
    interventionDepartment?: boolean
}

type SMEDeptConfirm = {
    confirmed: boolean
    confirmedAt?: any
    confirmedByEmail?: string
}

type PlanShape = {
    participantId?: string
    programId?: string
    createdAt?: any

    // legacy – name keyed (keep untouched)
    confirmed?: Record<string, boolean>

    // id keyed (source of truth going forward)
    confirmedByDeptId?: Record<string, boolean>

    interventions?: any[]

    // legacy SME review complete or not required (name keyed) – might exist in old docs
    incubateeDepartmentConfirmations?: Record<string, SMEDeptConfirm>

    // SME review complete or not required (id keyed) – use this going forward
    incubateeDepartmentConfirmationsByDeptId?: Record<string, SMEDeptConfirm>

    incubateeConfirmation?: boolean
    incubateeConfirmationAt?: any
    finalConfirmation?: boolean
    finalConfirmationAt?: any
    finalConfirmationMode?: string
}

const norm = (s: string) =>
    String(s || '')
        .normalize('NFKC')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()

const clean = (o: any): any => {
    if (Array.isArray(o)) return o.map(clean).filter(v => v !== undefined)
    if (!o || typeof o !== 'object') return o
    const r: any = {}
    Object.entries(o).forEach(([k, v]) => {
        if (v === undefined || Number.isNaN(v as any)) return
        r[k] = clean(v)
    })
    return r
}

const formatMaybeDate = (v: any) => {
    if (!v) return '-'
    if (v?.toDate?.()) return v.toDate().toLocaleString()
    if (typeof v === 'string' || typeof v === 'number') {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) return d.toLocaleString()
    }
    return '-'
}

// Best-effort: decide if an intervention belongs to a department
// Prefer stable departmentId (new world), fallback to names/areas (legacy data)
const belongsToDept = (iv: any, dept: DeptRow) => {
    const ivDeptId = String(iv?.departmentId || iv?.departmentID || '')
    if (ivDeptId && dept.id && ivDeptId === dept.id) return true

    const deptName = norm(dept.name)
    const ivDeptName = norm(iv?.departmentName || iv?.department || '')
    const ivArea = norm(iv?.area || '')
    const ivAos = norm(iv?.areaOfSupport || '')

    if (ivDeptName && ivDeptName === deptName) return true
    if (ivArea && ivArea === deptName) return true
    if (ivAos && ivAos === deptName) return true
    return false
}

const getCreatedAtValue = (d: any) => {
    const c = d?.createdAt
    if (!c) return 0
    if (typeof c?.toMillis === 'function') return c.toMillis()
    if (typeof c?.seconds === 'number') return c.seconds * 1000
    if (typeof c === 'number') return c
    if (typeof c === 'string') {
        const t = Date.parse(c)
        return Number.isNaN(t) ? 0 : t
    }
    return 0
}

const CardLike: React.FC<{ children: React.ReactNode; compact?: boolean }> = ({
    children,
    compact = false
}) => (
    <div
        style={{
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 16,
            padding: compact ? 12 : 14,
            background: '#fff',
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.06)'
        }}
    >
        <Space direction='vertical' size={6} style={{ width: '100%' }}>
            {children}
        </Space>
    </div>
)

const RoadmapFlow: React.FC = () => {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const contentGap = isMobile ? 12 : 16

    const [selectedView, setSelectedView] = useState<| 'growth-plan' | 'group-progress'>('growth-plan')
    const { user } = useFullIdentity()

    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [participantId, setParticipantId] = useState<string | null>(null)
    const [assignedInterventions, setAssignedInterventions] = useState<any[]>([])
    const [appointmentViews, setAppointmentViews] = useState<any[]>([])
    const [growthPathLoading, setGrowthPathLoading] = useState(false)

    const [deptInterventionsMap, setDeptInterventionsMap] = useState<Record<string, any[]>>({})
    const [loadingDeptInterventions, setLoadingDeptInterventions] = useState(false)


    const [latestPlanId, setLatestPlanId] = useState<string | null>(null)
    const [planData, setPlanData] = useState<PlanShape | null>(null)

    const [departments, setDepartments] = useState<DeptRow[]>([])
    const [departmentsLoading, setDepartmentsLoading] = useState(false)

    const [loadingOverview, setLoadingOverview] = useState(true)

    const [savingDeptId, setSavingDeptId] = useState<string | null>(null)
    const [confirmingDeptId, setConfirmingDeptId] = useState<string | null>(null)
    const [finalizing, setFinalizing] = useState(false)

    const [addForms] = Form.useForm()

    // Resolve the same canonical participant record used by the interventions page.
    // Auth uid, participant document id, and email can legitimately differ.
    useEffect(() => {
        let cancelled = false
        const resolveParticipantAndPlan = async () => {
            if (!user?.email) {
                setUserEmail(null)
                setParticipantId(null)
                setLatestPlanId(null)
                setPlanData(null)
                setLoadingOverview(false)
                return
            }

            try {
                setLoadingOverview(true)
                setUserEmail(user.email)

                const candidateIds = Array.from(new Set([
                    user.participantId,
                    user.participantDocId,
                    user.profileId,
                    user.id,
                    user.uid
                ].map(value => String(value || '').trim()).filter(Boolean)))

                let participantDoc: any = null
                for (const id of candidateIds) {
                    const snapshot = await getDoc(doc(db, 'participants', id))
                    if (snapshot.exists()) {
                        participantDoc = snapshot
                        break
                    }
                }

                if (!participantDoc) {
                    const exact = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
                    participantDoc = exact.docs[0] || null
                }

                if (!participantDoc) {
                    const normalizedEmail = String(user.email).trim().toLowerCase()
                    const participants = await getDocs(collection(db, 'participants'))
                    participantDoc = participants.docs.find(item =>
                        String(item.data()?.email || '').trim().toLowerCase() === normalizedEmail
                    ) || null
                }

                const pid = String(participantDoc?.id || '')
                if (cancelled) return
                setParticipantId(pid || null)

                if (!pid) {
                    setLatestPlanId(null)
                    setPlanData(null)
                    return
                }

                // Sort client-side so roadmap loading never depends on a composite index.
                const plansSnap = await getDocs(
                    query(collection(db, 'diagnosticPlans'), where('participantId', '==', pid))
                )
                const latestDoc = [...plansSnap.docs].sort((a, b) =>
                    getCreatedAtValue(b.data()) - getCreatedAtValue(a.data())
                )[0]
                if (cancelled) return
                setLatestPlanId(latestDoc?.id || null)
                setPlanData(latestDoc ? ((latestDoc.data() as any) || null) : null)
            } catch (err) {
                console.error('Error resolving plan:', err)
            } finally {
                if (!cancelled) setLoadingOverview(false)
            }
        }

        resolveParticipantAndPlan()
        return () => { cancelled = true }
    }, [user?.email, user?.id, user?.participantDocId, user?.participantId, user?.profileId, user?.uid])

    // The simulator is intentionally derived from delivery data. It never
    // writes a forecast back to Firestore or treats a projection as a promise.
    useEffect(() => {
        if (!participantId) {
            setAssignedInterventions([])
            setAppointmentViews([])
            return
        }

        let cancelled = false
            ; (async () => {
                setGrowthPathLoading(true)
                try {
                    const [assignmentSnap, appointmentSnap] = await Promise.all([
                        getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId))),
                        getDocs(query(collection(db, 'appointments'), where('smeId', '==', participantId)))
                    ])
                    const appointments = await hydrateAppointmentViews(
                        appointmentSnap.docs.map(item => ({ id: item.id, data: item.data() as any }))
                    )
                    if (!cancelled) {
                        setAssignedInterventions(assignmentSnap.docs.map(item => ({ id: item.id, ...(item.data() as any) })))
                        setAppointmentViews(appointments)
                    }
                } catch (error) {
                    console.error('Failed to load Growth Path data:', error)
                    if (!cancelled) {
                        setAssignedInterventions([])
                        setAppointmentViews([])
                    }
                } finally {
                    if (!cancelled) setGrowthPathLoading(false)
                }
            })()
        return () => { cancelled = true }
    }, [participantId])

    // ===== Fetch interventions for all departments =====
    useEffect(() => {
        if (!departments.length) return

            ; (async () => {
                setLoadingDeptInterventions(true)
                try {
                    const out: Record<string, any[]> = {}

                    // If your interventions collection is big, you can optimize later
                    for (const d of departments) {
                        const snap = await getDocs(
                            query(
                                collection(db, 'interventions'),
                                where('departmentId', '==', d.id)
                            )
                        )

                        out[d.id] = snap.docs.map(x => {
                            const data = x.data() as any
                            return {
                                id: x.id,
                                compulsory: data.compulsory === true,
                                title: data.title || data.name || data.interventionTitle || 'Untitled',
                                area: data.area || data.areaOfSupport || d.name,
                                areaOfSupport: data.areaOfSupport,
                                departmentId: data.departmentId || d.id
                            }
                        })
                    }

                    setDeptInterventionsMap(out)
                } catch (e) {
                    console.error('Failed to load interventions per dept', e)
                    setDeptInterventionsMap({})
                } finally {
                    setLoadingDeptInterventions(false)
                }
            })()
    }, [departments])

    // ===== Subscribe realtime plan =====
    useEffect(() => {
        if (!latestPlanId) return
        const planRef = doc(db, 'diagnosticPlans', latestPlanId)
        const unsub = onSnapshot(planRef, snap => {
            if (!snap.exists()) return
            setPlanData((snap.data() as any) || null)
        })
        return () => unsub()
    }, [latestPlanId])

    // ===== Load departments (include ONLY interventionDepartment === false) =====
    useEffect(() => {
        ; (async () => {
            setDepartmentsLoading(true)
            try {
                const snap = await getDocs(
                    query(
                        collection(db, 'departments'),
                        orderBy('name', 'asc')
                    )
                )

                const rows: DeptRow[] = snap.docs
                    .map(d => {
                        const data = d.data() as any
                        return {
                            id: d.id,
                            name: data.name || data.departmentName || d.id,
                            interventionsDepartment: data.interventionsDepartment
                        }
                    })
                    // include only explicit false
                    .filter(d => d.interventionsDepartment === true)


                setDepartments(rows)
            } catch (e) {
                console.error('Failed to load departments', e)
                setDepartments([])
            } finally {
                setDepartmentsLoading(false)
            }
        })()
    }, [])

    // ===== BACKFILL: confirmedByDeptId from legacy confirmed (name keyed) =====
    useEffect(() => {
        if (!latestPlanId || !planData || !departments.length) return
        const hasNew = planData.confirmedByDeptId && Object.keys(planData.confirmedByDeptId).length > 0
        if (hasNew) return

        const legacy = planData.confirmed || {}
        if (!legacy || !Object.keys(legacy).length) return

            ; (async () => {
                try {
                    const nameToId = new Map<string, string>()
                    departments.forEach(d => nameToId.set(norm(d.name), d.id))

                    const out: Record<string, boolean> = {}
                    for (const [legacyName, val] of Object.entries(legacy)) {
                        if (!val) continue
                        const id = nameToId.get(norm(legacyName))
                        if (id) out[id] = true
                    }

                    if (Object.keys(out).length) {
                        await updateDoc(doc(db, 'diagnosticPlans', latestPlanId), {
                            confirmedByDeptId: out
                        })
                    }
                } catch (e) {
                    console.error('Backfill confirmedByDeptId failed:', e)
                }
            })()
    }, [latestPlanId, planData, departments])

    // ===== BACKFILL: incubateeDepartmentConfirmationsByDeptId from legacy name keyed =====
    useEffect(() => {
        if (!latestPlanId || !planData || !departments.length) return

        const hasNew =
            planData.incubateeDepartmentConfirmationsByDeptId &&
            Object.keys(planData.incubateeDepartmentConfirmationsByDeptId).length > 0
        if (hasNew) return

        const legacy = planData.incubateeDepartmentConfirmations || {}
        if (!legacy || !Object.keys(legacy).length) return

            ; (async () => {
                try {
                    const nameToId = new Map<string, string>()
                    departments.forEach(d => nameToId.set(norm(d.name), d.id))

                    const out: Record<string, SMEDeptConfirm> = {}
                    for (const [legacyNameKey, conf] of Object.entries(legacy)) {
                        // legacy key might already be normalized — handle both
                        const id = nameToId.get(norm(legacyNameKey))
                        if (!id) continue
                        out[id] = conf as SMEDeptConfirm
                    }

                    if (Object.keys(out).length) {
                        await updateDoc(doc(db, 'diagnosticPlans', latestPlanId), {
                            incubateeDepartmentConfirmationsByDeptId: out
                        })
                    }
                } catch (e) {
                    console.error('Backfill incubateeDepartmentConfirmationsByDeptId failed:', e)
                }
            })()
    }, [latestPlanId, planData, departments])

    // ===== Confirmations (ID-based, stable) =====
    const deptConfirmedById: Record<string, boolean> = planData?.confirmedByDeptId || {}
    const smeConfirmedById: Record<string, SMEDeptConfirm> =
        planData?.incubateeDepartmentConfirmationsByDeptId || {}

    const compulsoryOnlyDeptIds = useMemo(() => new Set(departments.filter(dept =>
        isCompulsoryOnly((planData?.interventions || []).filter(iv => belongsToDept(iv, dept)),
            deptInterventionsMap[dept.id] || [])
    ).map(dept => dept.id)), [departments, planData, deptInterventionsMap])

    const TARGET_DEPTS = departments.length || 0

    const deptConfirmedCount = useMemo(() => {
        if (!TARGET_DEPTS) return 0
        return departments.filter(d => compulsoryOnlyDeptIds.has(d.id) || !!deptConfirmedById?.[d.id]).length
    }, [departments, deptConfirmedById, TARGET_DEPTS, compulsoryOnlyDeptIds])

    const smeConfirmedCount = useMemo(() => {
        if (!TARGET_DEPTS) return 0
        return departments.filter(d => compulsoryOnlyDeptIds.has(d.id) || !!smeConfirmedById?.[d.id]?.confirmed).length
    }, [departments, smeConfirmedById, TARGET_DEPTS, compulsoryOnlyDeptIds])

    const deptPercent = TARGET_DEPTS
        ? Math.min(100, Math.round((deptConfirmedCount / TARGET_DEPTS) * 100))
        : 0
    const smePercent = TARGET_DEPTS
        ? Math.min(100, Math.round((smeConfirmedCount / TARGET_DEPTS) * 100))
        : 0

    // Only departments that have confirmed are available for SME review.
    const confirmedDepts = useMemo(() => {
        return departments.filter(d => compulsoryOnlyDeptIds.has(d.id) || !!deptConfirmedById?.[d.id])
    }, [departments, deptConfirmedById, compulsoryOnlyDeptIds])

    const finalized = !!planData?.finalConfirmation

    const canConfirmDepartment =
        deptConfirmedCount > 0 &&
        confirmedDepts.some(d => !compulsoryOnlyDeptIds.has(d.id) && !smeConfirmedById?.[d.id]?.confirmed) &&
        !finalized

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'roadmap',
            pageTitle: 'Roadmap',
            guides: [
                {
                    id: 'roadmap-overview',
                    title: 'Quick tour',
                    description:
                        'Understand your Roadmap, switch between Developmental Plan and Group Progress, and see where confirmation work happens.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('roadmap-header'),
                            popover: {
                                title: 'Roadmap',
                                description:
                                    'Your Roadmap brings together your Developmental Plan and Group Progress in one workspace.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('roadmap-view-switcher'),
                            popover: {
                                title: 'Roadmap sections',
                                description:
                                    'Switch between your Developmental Plan and Group Progress. The same sections are available on desktop and mobile.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('roadmap-content'),
                            waitForElement: 1500,
                            popover: {
                                title: 'Roadmap workspace',
                                description:
                                    'The content here changes with the selected Roadmap section.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'roadmap-developmental-plan',
                    title: 'Developmental Plan',
                    description:
                        'Review department progress and understand what you need to confirm as the SME.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: guideTarget('roadmap-developmental-plan-tab'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Developmental Plan',
                                description:
                                    'Open the Developmental Plan to review what each confirmed department will deliver.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('roadmap-developmental-plan'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Your Developmental Plan',
                                description:
                                    'Only departments that have already confirmed their offer appear for SME review.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('roadmap-confirmation-progress'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Confirmation progress',
                                description:
                                    'The first bar tracks departments that have confirmed. The second tracks the departments you have confirmed as the SME.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('roadmap-departments'),
                            waitForElement: 1500,
                            skipMissingElement: true,
                            popover: {
                                title: 'Departments ready for review',
                                description:
                                    'Confirmed departments appear here. Open a department to review the interventions attached to its offer.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('roadmap-finalization-status'),
                            waitForElement: 1500,
                            popover: {
                                title: finalized
                                    ? 'Developmental Plan finalized'
                                    : 'Finalization rule',
                                description: finalized
                                    ? 'Your Developmental Plan is finalized because all required department confirmations are complete.'
                                    : 'Final confirmation happens automatically after you confirm every required department.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                ...(canConfirmDepartment
                    ? [
                        {
                            id: 'roadmap-confirm-department',
                            title: 'Confirm a department',
                            description:
                                'Review a department’s interventions and confirm what it will deliver.',
                            kind: 'task' as const,
                            order: 3,
                            steps: [
                                {
                                    element: guideTarget('roadmap-developmental-plan-tab'),
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Developmental Plan',
                                        description:
                                            'Open the Developmental Plan to start reviewing a department.',
                                        side: 'bottom' as const,
                                        align: 'center' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: '[data-guide="roadmap-department-header"]',
                                    waitForElement: 5000,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Open a department',
                                        description:
                                            'Select a confirmed department to review the interventions it plans to deliver.',
                                        side: 'top' as const,
                                        align: 'start' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: '[data-guide="roadmap-department-content"]',
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Review the interventions',
                                        description:
                                            'Review the department’s intervention list before agreeing to its offer.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: '[data-guide="roadmap-confirm-department-action"]',
                                    waitForElement: 1500,
                                    skipMissingElement: true,
                                    popover: {
                                        title: 'Confirm Department',
                                        description:
                                            'Confirming records your agreement with what this department will deliver. Once confirmed, this action becomes unavailable for that department.',
                                        side: 'top' as const,
                                        align: 'center' as const
                                    }
                                }
                            ]
                        }
                    ]
                    : []),
                {
                    id: 'roadmap-group-progress',
                    title: 'Group Progress',
                    description:
                        'Open the Group Progress section of your Roadmap.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: guideTarget('roadmap-group-progress-tab'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Group Progress',
                                description:
                                    'Open Group Progress to review the progress information captured for your group.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('roadmap-group-progress'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Group Progress workspace',
                                description:
                                    'This section contains the Group Progress workflow and records available to you.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                }
            ]
        }),
        [
            canConfirmDepartment,
            finalized
        ]
    )

    usePageGuides(guideRegistration)

    const planInterventions = (planData?.interventions || []) as any[]

    const interventionsByDeptId = useMemo(() => {
        const map = new Map<string, any[]>()
        for (const dept of departments) {
            const list = (planInterventions || []).filter(iv => belongsToDept(iv, dept))
            map.set(dept.id, list)
        }
        return map
    }, [departments, planInterventions])

    const savePlanInterventions = async (nextInterventions: any[]) => {
        if (!latestPlanId) return
        const planRef = doc(db, 'diagnosticPlans', latestPlanId)
        await updateDoc(planRef, { interventions: nextInterventions.map(clean) })
    }

    const handleDeleteIntervention = async (deptId: string, iv: any) => {
        if (isCompulsoryItem(iv, deptInterventionsMap[deptId] || [])) {
            message.info('Compulsory interventions cannot be removed from your development plan.')
            return
        }
        if (!latestPlanId) return
        const msgKey = `del-${deptId}-${iv?.id || iv?.title || ''}`

        try {
            setSavingDeptId(deptId)
            message.loading({ key: msgKey, content: 'Removing intervention…', duration: 0 })

            const next = (planInterventions || []).filter(x => {
                if (iv?.id && x?.id) return String(x.id) !== String(iv.id)

                const a1 = norm(x?.area || x?.areaOfSupport || '')
                const a2 = norm(iv?.area || iv?.areaOfSupport || '')
                const t1 = norm(x?.title || x?.interventionTitle || x?.name || '')
                const t2 = norm(iv?.title || iv?.interventionTitle || iv?.name || '')
                const d1 = String(x?.departmentId || x?.departmentID || '')
                const d2 = String(iv?.departmentId || iv?.departmentID || '')

                // if deptId exists, include it in match to reduce false deletions
                if (deptId && (d1 || d2)) return !(d1 === deptId && d2 === deptId && a1 === a2 && t1 === t2)

                return !(a1 === a2 && t1 === t2)
            })

            await savePlanInterventions(next)
            message.success({ key: msgKey, content: 'Intervention removed.' })
        } catch (e) {
            console.error(e)
            message.error({ key: msgKey, content: 'Could not remove intervention.' })
        } finally {
            setSavingDeptId(null)
        }
    }

    const handleAddIntervention = async (dept: DeptRow) => {
        if (!latestPlanId || !userEmail) return
        const deptId = dept.id
        const msgKey = `add-${deptId}`

        try {
            const values = await addForms.validateFields([`pick_${deptId}`])
            const pickedId = String(values[`pick_${deptId}`] || '').trim()
            if (!pickedId) return

            const catalog = deptInterventionsMap?.[deptId] || []
            const picked = catalog.find(x => String(x.id) === pickedId)
            if (!picked) {
                message.error('Selected intervention not found.')
                return
            }

            // prevent duplicates: by id OR by (title+deptId)
            const already = (planInterventions || []).some(iv => {
                const sameId = iv?.id && String(iv.id) === String(picked.id)
                const sameTitle =
                    norm(iv?.title || iv?.interventionTitle || iv?.name || '') === norm(picked.title) &&
                    String(iv?.departmentId || iv?.departmentID || '') === String(deptId)
                return sameId || sameTitle
            })
            if (already) {
                message.info('That intervention is already in the plan.')
                return
            }

            setSavingDeptId(deptId)
            message.loading({ key: msgKey, content: 'Adding intervention…', duration: 0 })

            const newIv = clean({
                id: picked.id,                 // ✅ use the master intervention id
                title: picked.title,
                area: picked.area || dept.name,
                areaOfSupport: picked.areaOfSupport || undefined,
                departmentId: deptId,          // ✅ stable link
                source: 'CATALOG',             // optional
                addedBy: userEmail,
                addedAt: serverTimestamp()
            })

            await savePlanInterventions([...(planInterventions || []), newIv])

            addForms.setFieldsValue({ [`pick_${deptId}`]: undefined })
            message.success({ key: msgKey, content: 'Intervention added.' })
        } catch (e) {
            if ((e as any)?.errorFields) return
            console.error(e)
            message.error({ key: msgKey, content: 'Could not add intervention.' })
        } finally {
            setSavingDeptId(null)
        }
    }


    const finalizeIfAllSMEConfirmed = async () => {
        if (!latestPlanId) return
        if (!TARGET_DEPTS) return

        const planRef = doc(db, 'diagnosticPlans', latestPlanId)
        const snap = await getDoc(planRef)
        const data = snap.exists() ? (snap.data() as any) : {}

        const conf: Record<string, SMEDeptConfirm> = data?.incubateeDepartmentConfirmationsByDeptId || {}
        const count = departments.filter(d => !!conf?.[d.id]?.confirmed ||
            isCompulsoryOnly((data?.interventions || []).filter((iv: any) => belongsToDept(iv, d)),
                deptInterventionsMap[d.id] || [])).length

        // Only finalize when SME has confirmed ALL target departments
        if (!data?.finalConfirmation && count >= TARGET_DEPTS) {
            setFinalizing(true)
            await updateDoc(planRef, {
                incubateeConfirmation: true,
                incubateeConfirmationAt: serverTimestamp(),
                finalConfirmation: true,
                finalConfirmationAt: serverTimestamp(),
                finalConfirmationMode: 'required_departments_confirmed_compulsory_exempt'
            })
            setFinalizing(false)
        }
    }

    const handleConfirmDeptBySME = async (dept: DeptRow) => {
        if (!latestPlanId || !userEmail) return
        const deptId = dept.id
        if (compulsoryOnlyDeptIds.has(deptId)) {
            message.info('This department only has compulsory interventions. No sign-off is required.')
            return
        }
        const msgKey = `confirm-${deptId}`

        // SME can only confirm AFTER department has confirmed (id-based)
        const deptOk = !!deptConfirmedById?.[deptId]
        if (!deptOk) {
            message.warning('This department has not confirmed yet.')
            return
        }

        try {
            setConfirmingDeptId(deptId)
            message.loading({ key: msgKey, content: 'Confirming department offer…', duration: 0 })

            const planRef = doc(db, 'diagnosticPlans', latestPlanId)

            await updateDoc(planRef, {
                [`incubateeDepartmentConfirmationsByDeptId.${deptId}`]: {
                    confirmed: true,
                    confirmedAt: serverTimestamp(),
                    confirmedByEmail: userEmail
                }
            })

            message.success({ key: msgKey, content: `Confirmed: ${dept.name}` })

            // Confirmation is the primary action. A department may not yet
            // have a diagnostic-plan MOV, so that follow-up must never turn a
            // successful confirmation into a false failure message.
            if (participantId) {
                try {
                    // Older confirmed departments may predate the per-
                    // department MOV. Recreate it first, then apply the SME
                    // signature as one continuous confirmation action.
                    await createOrUpdateDiagnosticPlanMovDraft({
                        db,
                        user: { email: userEmail },
                        diagnosticPlanId: latestPlanId,
                        participantId,
                        programId: String(planData?.programId || ''),
                        departmentId: deptId,
                        departmentName: dept.name,
                        status: 'awaiting_smme'
                    })
                    await approveDiagnosticPlanMovBySmme({
                        db,
                        diagnosticPlanId: latestPlanId,
                        departmentId: deptId,
                        smmeId: participantId,
                        signerSignatureUrl: ''
                    })
                } catch (movError) {
                    console.error('Department confirmed, but its MOV could not be signed:', movError)
                    message.warning({
                        key: msgKey,
                        content: `Confirmed: ${dept.name}. The MOV signature still needs attention.`
                    })
                }
            }

            try {
                await finalizeIfAllSMEConfirmed()
            } catch (finalizeError) {
                console.warn('Department confirmed, but finalization could not run:', finalizeError)
            }
        } catch (e) {
            console.error(e)
            message.error({ key: msgKey, content: 'Could not confirm this department.' })
        } finally {
            setConfirmingDeptId(null)
        }
    }

    const renderInterventionsMobileList = (deptId: string, dept: DeptRow, ivs: any[]) => {
        if (!ivs.length) {
            return (
                <Alert
                    type='info'
                    showIcon
                    message='No interventions listed'
                    description='This department has confirmed, but no interventions are currently attached to this plan.'
                />
            )
        }

        return (
            <List
                dataSource={ivs.map(x => ({
                    ...x,
                    title: x?.title ?? x?.interventionTitle ?? x?.name ?? '-',
                    area: x?.area ?? x?.areaOfSupport ?? dept.name
                }))}
                split={false}
                renderItem={(row: any) => (
                    <List.Item style={{ padding: '8px 0' }}>
                        <div
                            style={{
                                width: '100%',
                                border: '1px solid #f0f0f0',
                                borderRadius: 14,
                                padding: 12,
                                background: '#fff'
                            }}
                        >
                            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                <div>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        Area
                                    </Text>
                                    <div>
                                        <Text strong>{String(row.area ?? '-')}</Text>
                                    </div>
                                </div>

                                <div>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        Intervention
                                    </Text>
                                    <div>
                                        <Text>{String(row.title ?? '-')}</Text>
                                    </div>
                                </div>

                                <Popconfirm
                                    title='Remove this intervention?'
                                    okText='Remove'
                                    cancelText='Cancel'
                                    onConfirm={() => handleDeleteIntervention(deptId, row)}
                                    disabled={finalized || savingDeptId === deptId || isCompulsoryItem(row, deptInterventionsMap[deptId] || [])}
                                >
                                    <Button
                                        danger
                                        size='small'
                                        icon={<DeleteOutlined />}
                                        disabled={finalized || savingDeptId === deptId || isCompulsoryItem(row, deptInterventionsMap[deptId] || [])}
                                        loading={savingDeptId === deptId}
                                        block
                                    >
                                        Remove
                                    </Button>
                                </Popconfirm>
                            </Space>
                        </div>
                    </List.Item>
                )}
            />
        )
    }

    const growthPath = useMemo(() => {
        const isComplete = (assignment: any) =>
            String(assignment?.assignmentStatus || '').toLowerCase() === 'completed' ||
            Number(assignment?.computedProgress ?? assignment?.progress ?? 0) >= 100
        const completed = assignedInterventions.filter(isComplete)
        const active = assignedInterventions.filter(assignment => !isComplete(assignment))
        const attended = appointmentViews.filter(appointment =>
            appointment?.attendance?.status === 'attended' &&
            String(appointment?.status || '') !== 'cancelled'
        )
        const departmentsConnected = new Set(
            [...assignedInterventions, ...appointmentViews]
                .map(item => String(item?.departmentId || '').trim())
                .filter(Boolean)
        ).size
        const totalProgress = assignedInterventions.length
            ? Math.round(assignedInterventions.reduce((sum, assignment) =>
                sum + Math.min(100, Math.max(0, Number(assignment?.computedProgress ?? assignment?.progress ?? 0))), 0
            ) / assignedInterventions.length)
            : 0
        const projectedProgress = active.length
            ? Math.min(100, Math.round(totalProgress + (active.length / Math.max(assignedInterventions.length, 1)) * 35))
            : totalProgress
        const milestones = active
            .sort((left, right) => Number(right?.computedProgress || right?.progress || 0) - Number(left?.computedProgress || left?.progress || 0))
            .slice(0, 3)
            .map((assignment, index) => {
                const due = assignment?.dueDate?.toDate?.() || assignment?.dueDate || null
                const title = String(assignment?.subInterventionTitle || assignment?.interventionTitle || 'Support milestone')
                const recurring = assignment?.recurrence?.every || assignment?.recurrence?.unit
                return {
                    key: assignment.id || `${title}-${index}`,
                    title,
                    progress: Math.round(Number(assignment?.computedProgress ?? assignment?.progress ?? 0)),
                    date: due ? new Date(due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Next up',
                    detail: recurring ? 'Recurring support — this milestone continues through its planned cycle.' : 'Complete the remaining delivery steps to move this forward.'
                }
            })
        const level = totalProgress >= 85 ? 'Ready to scale' : totalProgress >= 55 ? 'Momentum' : totalProgress >= 25 ? 'Building' : 'Foundation'
        return { completed, active, attended, departmentsConnected, totalProgress, projectedProgress, milestones, level }
    }, [assignedInterventions, appointmentViews])

    const renderGrowthPathSimulator = () => {
        const metrics: DashboardMetric[] = [
            { key: 'level', title: 'Current stage', value: growthPath.level, subtitle: 'Based on actual intervention progress', icon: <RocketOutlined />, iconBg: '#e6f4ff', important: true },
            { key: 'completed', title: 'Milestones completed', value: growthPath.completed.length, subtitle: 'Completed intervention assignments', icon: <CheckCircleOutlined />, iconBg: '#f6ffed', important: true },
            { key: 'sessions', title: 'Sessions attended', value: growthPath.attended.length, subtitle: 'Only sessions you attended', icon: <CalendarOutlined />, iconBg: '#fff7e6', important: true },
            { key: 'departments', title: 'Support connected', value: growthPath.departmentsConnected, subtitle: 'Departments supporting your journey', icon: <FlagOutlined />, iconBg: '#f9f0ff' }
        ]

        return (
            <MotionCard
                title={<Space><RocketOutlined /><span>Growth Path</span></Space>}
                extra={<Tag color='blue'>Projection, not a promise</Tag>}
            >
                {growthPathLoading ? <Skeleton active /> : !assignedInterventions.length ? (
                    <Alert showIcon type='info' message='Your Growth Path will appear once interventions are assigned.' />
                ) : (
                    <Space direction='vertical' size='large' style={{ width: '100%' }}>
                        <Text type='secondary'>Your path updates from real delivery, attendance and completed intervention work — not points for their own sake.</Text>
                        <MetricsGrid metrics={metrics} />
                        <CardLike>
                            <Space direction='vertical' size={8} style={{ width: '100%' }}>
                                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                    <Text strong><RiseOutlined /> Likely next progress</Text>
                                    <Text strong>{growthPath.projectedProgress}%</Text>
                                </Space>
                                <Progress percent={growthPath.projectedProgress} strokeColor='#1677ff' />
                                <Text type='secondary'>If your {growthPath.active.length} active intervention{growthPath.active.length === 1 ? '' : 's'} move through the next delivery steps, this is the likely overall progress position. It does not guarantee an outcome.</Text>
                            </Space>
                        </CardLike>
                        <div>
                            <Text strong>What is next</Text>
                            <List
                                style={{ marginTop: 8 }}
                                dataSource={growthPath.milestones}
                                locale={{ emptyText: 'You have completed the currently assigned milestones.' }}
                                renderItem={milestone => (
                                    <List.Item>
                                        <List.Item.Meta
                                            avatar={<FlagOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
                                            title={<Space wrap><Text strong>{milestone.title}</Text><Tag>{milestone.date}</Tag><Tag color='blue'>{milestone.progress}%</Tag></Space>}
                                            description={milestone.detail}
                                        />
                                    </List.Item>
                                )}
                            />
                        </div>
                    </Space>
                )}
            </MotionCard>
        )
    }

    const renderGrowthPlan = () => {
        const progressCols = isMobile ? 24 : 12

        if (loadingOverview || departmentsLoading) {
            return (
                <MotionCard
                    title={
                        <Space>
                            <FileTextOutlined />
                            <span>Developmental Plan — Confirm per Department</span>
                        </Space>
                    }
                >
                    <Skeleton active />
                </MotionCard>
            )
        }

        if (!TARGET_DEPTS) {
            return (
                <MotionCard
                    title={
                        <Space>
                            <FileTextOutlined />
                            <span>Developmental Plan — Confirm per Department</span>
                        </Space>
                    }
                >
                    <Alert
                        type='warning'
                        showIcon
                        message='No departments configured'
                        description='No departments matched the rule (interventionDepartment === false). Fix your department flags, then reload.'
                    />
                </MotionCard>
            )
        }

        return (
            <Space
                data-guide='roadmap-developmental-plan'
                direction='vertical'
                size='large'
                style={{ width: '100%' }}
            >
                <MotionCard
                    title={
                        <Space>
                            <FileTextOutlined />
                            <span>Developmental Plan — Confirm per Department</span>
                        </Space>
                    }
                >
                    <Alert
                        message='What you (SME) confirm'
                        description='You confirm what each department will deliver. Only departments that have confirmed will appear below. For each: review interventions, add/remove if needed, then confirm.'
                        type='info'
                        showIcon
                        style={{ marginBottom: 16 }}
                    />

                    {/* Progress bars: side-by-side desktop, stacked mobile */}
                    <Row
                        data-guide='roadmap-confirmation-progress'
                        gutter={[16, 16]}
                        align='middle'
                    >
                        <Col span={progressCols}>
                            <CardLike>
                                <Text strong>Departments ready (by departments)</Text>
                                <Progress
                                    percent={deptPercent}
                                    size={isMobile ? [220, 12] : [360, 14]}
                                    status={deptPercent === 100 ? 'success' : 'active'}
                                />
                                <Text type='secondary'>
                                    {deptConfirmedCount}/{TARGET_DEPTS}
                                </Text>
                            </CardLike>
                        </Col>

                        <Col span={progressCols}>
                            <CardLike>
                                <Text strong>SME review complete or not required</Text>
                                <Progress
                                    percent={smePercent}
                                    size={isMobile ? [220, 12] : [360, 14]}
                                    status={smePercent === 100 ? 'success' : 'active'}
                                />
                                <Text type='secondary'>
                                    {smeConfirmedCount}/{TARGET_DEPTS}
                                </Text>
                            </CardLike>
                        </Col>
                    </Row>

                    <Divider />

                    {!deptConfirmedCount ? (
                        <Alert
                            type='warning'
                            showIcon
                            message='No department confirmations yet'
                            description='Departments must confirm first. Once they do, you’ll see their interventions below.'
                        />
                    ) : (
                        <div data-guide='roadmap-departments'>
                            <Collapse accordion>
                            {confirmedDepts.map(dept => {
                                const deptId = dept.id
                                const deptOk = !!deptConfirmedById?.[deptId]
                                const smeOk = !!smeConfirmedById?.[deptId]?.confirmed
                                const ivs = interventionsByDeptId.get(deptId) || []
                                const compulsoryOnly = compulsoryOnlyDeptIds.has(deptId)

                                const header = isMobile ? (
                                    <div
                                        data-guide='roadmap-department-header'
                                        style={{ width: '100%' }}
                                    >
                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                            <Text strong style={{ fontSize: 15 }}>
                                                {dept.name}
                                            </Text>

                                            <Space wrap size={6}>
                                                {compulsoryOnly ? <Tag color='blue'>Compulsory</Tag> : deptOk ? <Tag color='blue'>Dept Confirmed</Tag> : <Tag>Pending Dept</Tag>}
                                                {compulsoryOnly ? <Tag>No sign-off required</Tag> : smeOk ? <Tag color='green'>SME Confirmed</Tag> : <Tag>Pending SME</Tag>}
                                            </Space>

                                            {smeOk && (
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    Confirmed: {formatMaybeDate(smeConfirmedById?.[deptId]?.confirmedAt)}
                                                </Text>
                                            )}
                                        </Space>
                                    </div>
                                ) : (
                                    <Space
                                        data-guide='roadmap-department-header'
                                        wrap
                                        style={{ width: '100%', justifyContent: 'space-between' }}
                                    >
                                        <Space wrap>
                                            <Text strong>{dept.name}</Text>
                                            {compulsoryOnly ? <Tag color='blue'>Compulsory</Tag> : deptOk ? <Tag color='blue'>Dept Confirmed</Tag> : <Tag>Pending Dept</Tag>}
                                            {compulsoryOnly ? <Tag>No sign-off required</Tag> : smeOk ? <Tag color='green'>SME Confirmed</Tag> : <Tag>Pending SME</Tag>}
                                        </Space>

                                        <Space>
                                            {smeOk && (
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    SME confirmed: {formatMaybeDate(smeConfirmedById?.[deptId]?.confirmedAt)}
                                                </Text>
                                            )}
                                        </Space>
                                    </Space>
                                )

                                return (
                                    <Panel key={deptId} header={header}>
                                        <div data-guide='roadmap-department-content'>
                                        {compulsoryOnly ? (
                                            <>
                                                <Alert type='info' showIcon message='No DP sign-off required'
                                                    description='These compulsory interventions can proceed without department or SME confirmation.' />
                                                <List dataSource={ivs} renderItem={(iv: any) => (
                                                    <List.Item>{iv.title || iv.interventionTitle || iv.name}</List.Item>
                                                )} />
                                            </>
                                        ) : !deptOk ? (
                                            <Alert
                                                type='info'
                                                showIcon
                                                message='Waiting for department'
                                                description='This department has not confirmed yet.'
                                            />
                                        ) : (
                                            <>
                                                <Alert
                                                    type='success'
                                                    showIcon
                                                    message='Review interventions for this department'
                                                    description='You can remove items you already have, or add missing items, then confirm this department.'
                                                    style={{ marginBottom: 12 }}
                                                />

                                                {isMobile ? (
                                                    renderInterventionsMobileList(deptId, dept, ivs)
                                                ) : (
                                                    <Table
                                                        size='small'
                                                        pagination={false}
                                                        rowKey={(r: any) =>
                                                            `${r?.departmentId || ''}-${r?.id || ''}-${r?.title || r?.name || ''}-${r?.area || ''}`
                                                        }
                                                        columns={[
                                                            {
                                                                title: 'Area',
                                                                dataIndex: 'area',
                                                                key: 'area',
                                                                render: (v: any) => String(v ?? '-')
                                                            },
                                                            {
                                                                title: 'Intervention',
                                                                dataIndex: 'title',
                                                                key: 'title',
                                                                render: (v: any) => String(v ?? '-')
                                                            },
                                                            {
                                                                title: '',
                                                                key: 'actions',
                                                                width: 80,
                                                                render: (_: any, row: any) => (
                                                                    <Popconfirm
                                                                        title='Remove this intervention?'
                                                                        okText='Remove'
                                                                        cancelText='Cancel'
                                                                        onConfirm={() => handleDeleteIntervention(deptId, row)}
                                                                        disabled={finalized || savingDeptId === deptId || isCompulsoryItem(row, deptInterventionsMap[deptId] || [])}
                                                                    >
                                                                        <Button
                                                                            danger
                                                                            size='small'
                                                                            icon={<DeleteOutlined />}
                                                                            disabled={finalized || savingDeptId === deptId || isCompulsoryItem(row, deptInterventionsMap[deptId] || [])}
                                                                            loading={savingDeptId === deptId}
                                                                        />
                                                                    </Popconfirm>
                                                                )
                                                            }
                                                        ]}
                                                        dataSource={ivs.map(x => ({
                                                            ...x,
                                                            title: x?.title ?? x?.interventionTitle ?? x?.name ?? '-',
                                                            area: x?.area ?? x?.areaOfSupport ?? dept.name
                                                        }))}
                                                    />
                                                )}

                                                <Divider />

                                                <Form
                                                    form={addForms}
                                                    layout={isMobile ? 'vertical' : 'inline'}
                                                    style={{ width: '100%' }}
                                                >
                                                    {/*
    ❌ Commented out: Select intervention dropdown
    <Form.Item
      name={`pick_${deptId}`}
      style={{ flex: 1, minWidth: 260 }}
      rules={[{ required: true, message: 'Select an intervention' }]}
    >
      <Select
        showSearch
        placeholder="Select an intervention…"
        loading={loadingDeptInterventions}
        disabled={finalized}
        optionFilterProp="label"
        options={(deptInterventionsMap?.[deptId] || []).map(iv => ({
          value: iv.id,
          label: iv.title
        }))}
        filterOption={(input, option) =>
          String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase())
        }
      />
    </Form.Item>
  */}

                                                    {/*
    We now render ONLY the "Confirm Department" button,
    and give it full width by placing it in a block-style Form.Item
    (since layout='inline' won't stretch it otherwise).
  */}
                                                    <Form.Item style={{ width: '100%', margin: 0 }}>
                                                        <Button
                                                            data-guide='roadmap-confirm-department-action'
                                                            type='primary'
                                                            icon={<CheckOutlined />}
                                                            onClick={() => handleConfirmDeptBySME(dept)}
                                                            disabled={!deptOk || smeOk || finalized || finalizing}
                                                            loading={confirmingDeptId === deptId || finalizing}
                                                            block // 👈 This makes the button span the full width of its container
                                                        >
                                                            Confirm Department
                                                        </Button>
                                                    </Form.Item>

                                                    {/*
    ❌ Commented out: Add button
    <Space size='middle'>
      <Button
        icon={<PlusOutlined />}
        onClick={() => handleAddIntervention(dept)}
        disabled={finalized || savingDeptId === deptId}
        loading={savingDeptId === deptId}
      >
        Add
      </Button>

      <Button
        type='primary'
        icon={<CheckOutlined />}
        onClick={() => handleConfirmDeptBySME(dept)}
        disabled={!deptOk || smeOk || finalized || finalizing}
        loading={confirmingDeptId === deptId || finalizing}
      >
        Confirm Department
      </Button>
    </Space>
  */}
                                                </Form>

                                                {smeOk ? (
                                                    <Alert
                                                        style={{ marginTop: 12 }}
                                                        type='success'
                                                        showIcon
                                                        message='You have confirmed this department.'
                                                    />
                                                ) : (
                                                    <Alert
                                                        style={{ marginTop: 12 }}
                                                        type='warning'
                                                        showIcon
                                                        message='Confirm after reviewing'
                                                        description='Confirming records your agreement with what this department will deliver.'
                                                    />
                                                )}
                                            </>
                                        )}
                                        </div>
                                    </Panel>
                                )
                            })}
                            </Collapse>
                        </div>
                    )}

                    <Divider />

                    <div data-guide='roadmap-finalization-status'>
                    {finalized ? (
                        <div style={{ textAlign: 'center' }}>
                            <CheckCircleOutlined style={{ fontSize: 44, color: '#52c41a' }} />
                            <Title level={3} style={{ marginTop: 8, marginBottom: 0, color: '#52c41a' }}>
                                Developmental Plan Finalized
                            </Title>
                            <Text type='secondary'>All required department confirmations are complete; compulsory-only departments need no sign-off.</Text>
                        </div>
                    ) : (
                        <Alert
                            type='info'
                            showIcon
                            message='Finalization rule'
                            description='Confirm departments that contain optional interventions. Compulsory-only departments do not require sign-off and do not block assignments.'
                        />
                    )}
                    </div>
                </MotionCard>
            </Space>
        )
    }

    const renderGroupProgress = () => (
        <div data-guide='roadmap-group-progress'>
            <GroupProgressForm />
        </div>
    )

    const viewOptions = [
        { id: 'growth-plan', label: 'Developmental Plan', icon: <FileTextOutlined /> },
        { id: 'group-progress', label: 'Group Progress', icon: <FileTextOutlined /> }
    ]

    return (
        <div
            style={{
                minHeight: '100vh',
                padding: 24,
                background: '#fff'
            }}
        >
            <div>
                <div data-guide='roadmap-header'>
                <DashboardHeaderCard
                    title='Roadmap'
                    subtitle={isMobile ? undefined : 'Review your Developmental Plan and Group Progress'}
                    extraRight={
                        !isMobile ? (
                            <Space data-guide='roadmap-view-switcher' wrap>
                                {viewOptions.map(view => (
                                    <Button
                                        data-guide={
                                            view.id === 'growth-plan'
                                                ? 'roadmap-developmental-plan-tab'
                                                : 'roadmap-group-progress-tab'
                                        }
                                        key={view.id}
                                        type={selectedView === (view.id as any) ? 'primary' : 'default'}
                                        icon={view.icon}
                                        onClick={() => setSelectedView(view.id as any)}
                                    >
                                        {view.label}
                                    </Button>
                                ))}
                            </Space>
                        ) : null
                    }
                    cardProps={{
                        bodyStyle: {
                            padding: isMobile ? 14 : 24
                        }
                    }}
                />
                </div>

                {isMobile && (
                    <Card
                        data-guide='roadmap-view-switcher'
                        size='small'
                        style={{
                            marginTop: 12,
                            borderRadius: 16,
                            position: 'sticky',
                            top: 72,
                            zIndex: 20,
                            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)'
                        }}
                        bodyStyle={{ padding: 8 }}
                    >
                        <Segmented
                            block
                            value={selectedView}
                            onChange={value => setSelectedView(value as any)}
                            options={viewOptions.map(view => ({
                                label: (
                                    <span
                                        data-guide={
                                            view.id === 'growth-plan'
                                                ? 'roadmap-developmental-plan-tab'
                                                : 'roadmap-group-progress-tab'
                                        }
                                    >
                                        {view.label}
                                    </span>
                                ),
                                value: view.id,
                                icon: view.icon
                            }))}
                        />
                    </Card>
                )}

                <div
                    data-guide='roadmap-content'
                    style={{
                        marginTop: contentGap,
                        overflowY: 'visible'
                    }}
                >
                    {selectedView === 'growth-plan' && renderGrowthPlan()}
                    {selectedView === 'group-progress' && renderGroupProgress()}
                </div>
            </div>
        </div>
    )
}

export default RoadmapFlow