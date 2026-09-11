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
import { useNavigate } from 'react-router-dom'
import {
    approveDiagnosticPlanMovBySmme,
    createOrUpdateDiagnosticPlanMovDraft
} from '@/services/movService'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

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

    // legacy SME confirmations (name keyed) – might exist in old docs
    incubateeDepartmentConfirmations?: Record<string, SMEDeptConfirm>

    // SME confirmations (id keyed) – use this going forward
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

    const [selectedView, setSelectedView] = useState<'growth-path' | 'growth-plan' | 'group-progress'>('growth-path')
    const { user } = useFullIdentity()
    const navigate = useNavigate()

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
                                where('departmentId', '==', d.id),
                                orderBy('title', 'asc')
                            )
                        )

                        out[d.id] = snap.docs.map(x => {
                            const data = x.data() as any
                            return {
                                id: x.id,
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

    const TARGET_DEPTS = departments.length || 0

    const deptConfirmedCount = useMemo(() => {
        if (!TARGET_DEPTS) return 0
        return departments.filter(d => !!deptConfirmedById?.[d.id]).length
    }, [departments, deptConfirmedById, TARGET_DEPTS])

    const smeConfirmedCount = useMemo(() => {
        if (!TARGET_DEPTS) return 0
        return departments.filter(d => !!smeConfirmedById?.[d.id]?.confirmed).length
    }, [departments, smeConfirmedById, TARGET_DEPTS])

    const deptPercent = TARGET_DEPTS
        ? Math.min(100, Math.round((deptConfirmedCount / TARGET_DEPTS) * 100))
        : 0
    const smePercent = TARGET_DEPTS
        ? Math.min(100, Math.round((smeConfirmedCount / TARGET_DEPTS) * 100))
        : 0

    const finalized = !!planData?.finalConfirmation

    // Show work for SME:
    // Only display collapses for departments that have confirmed (deptConfirmedById[dept.id] === true)
    const confirmedDepts = useMemo(() => {
        return departments.filter(d => !!deptConfirmedById?.[d.id])
    }, [departments, deptConfirmedById])

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
        const count = departments.filter(d => !!conf?.[d.id]?.confirmed).length

        // Only finalize when SME has confirmed ALL target departments
        if (!data?.finalConfirmation && count >= TARGET_DEPTS) {
            setFinalizing(true)
            await updateDoc(planRef, {
                incubateeConfirmation: true,
                incubateeConfirmationAt: serverTimestamp(),
                finalConfirmation: true,
                finalConfirmationAt: serverTimestamp(),
                finalConfirmationMode: 'incubatee_confirmed_all_departments_by_id'
            })
            setFinalizing(false)
        }
    }

    const handleConfirmDeptBySME = async (dept: DeptRow) => {
        if (!latestPlanId || !userEmail) return
        const deptId = dept.id
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
                                    disabled={finalized || savingDeptId === deptId}
                                >
                                    <Button
                                        danger
                                        size='small'
                                        icon={<DeleteOutlined />}
                                        disabled={finalized || savingDeptId === deptId}
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

        const upcomingAppointments = appointmentViews
            .filter(appointment => {
                const start = getCreatedAtValue({ createdAt: appointment?.startTime })
                return start >= Date.now() && String(appointment?.status || '').toLowerCase() !== 'cancelled'
            })
            .sort((left, right) => getCreatedAtValue({ createdAt: left?.startTime }) - getCreatedAtValue({ createdAt: right?.startTime }))
            .slice(0, 3)
        const nextMilestone = growthPath.milestones[0]

        return (
            <Space direction='vertical' size='large' style={{ width: '100%' }}>
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

            {!growthPathLoading && assignedInterventions.length > 0 && (
                <>
                    <MotionCard title='Next action'>
                        <Space direction={isMobile ? 'vertical' : 'horizontal'} size='middle' style={{ width: '100%', justifyContent: 'space-between' }}>
                            <div>
                                <Text strong>{nextMilestone?.title || 'Review your completed support'}</Text>
                                <br />
                                <Text type='secondary'>{nextMilestone?.detail || 'All currently assigned milestones are complete. Check for any follow-up.'}</Text>
                            </div>
                            <Button type='primary' onClick={() => navigate('/incubatee/interventions')}>
                                {nextMilestone ? 'View intervention' : 'View interventions'}
                            </Button>
                        </Space>
                    </MotionCard>

                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={15}>
                            <MotionCard title='Intervention timeline'>
                                <List
                                    dataSource={[...growthPath.milestones, ...growthPath.completed.slice(0, 3).map((assignment, index) => ({
                                        key: assignment.id || `completed-${index}`,
                                        title: String(assignment?.subInterventionTitle || assignment?.interventionTitle || 'Support milestone'),
                                        progress: 100,
                                        date: 'Completed',
                                        detail: 'This support milestone has been completed.'
                                    }))]}
                                    locale={{ emptyText: 'You have completed the currently assigned milestones.' }}
                                    renderItem={milestone => (
                                        <List.Item style={{ borderLeft: `3px solid ${milestone.progress >= 100 ? '#52c41a' : '#1677ff'}`, paddingLeft: 14 }}>
                                            <List.Item.Meta
                                                avatar={milestone.progress >= 100 ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} /> : <FlagOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
                                                title={<Space wrap><Text strong>{milestone.title}</Text><Tag>{milestone.date}</Tag><Tag color={milestone.progress >= 100 ? 'green' : 'blue'}>{milestone.progress}%</Tag></Space>}
                                                description={milestone.detail}
                                            />
                                        </List.Item>
                                    )}
                                />
                            </MotionCard>
                        </Col>
                        <Col xs={24} lg={9}>
                            <MotionCard title='Upcoming appointments' extra={<Button type='link' onClick={() => navigate('/incubatee/appointments')}>View all</Button>}>
                                <List
                                    dataSource={upcomingAppointments}
                                    locale={{ emptyText: 'No upcoming appointments are scheduled.' }}
                                    renderItem={appointment => (
                                        <List.Item>
                                            <List.Item.Meta
                                                avatar={<CalendarOutlined style={{ color: '#d97706', fontSize: 18 }} />}
                                                title={appointment?.sessionTitle || appointment?.interventionTitle || 'Support appointment'}
                                                description={formatMaybeDate(appointment?.startTime)}
                                            />
                                        </List.Item>
                                    )}
                                />
                            </MotionCard>
                        </Col>
                    </Row>
                </>
            )}
            </Space>
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
            <Space direction='vertical' size='large' style={{ width: '100%' }}>
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
                    <Row gutter={[16, 16]} align='middle'>
                        <Col span={progressCols}>
                            <CardLike>
                                <Text strong>Departments confirmed (by departments)</Text>
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
                                <Text strong>SME confirmations</Text>
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
                        <Collapse accordion>
                            {confirmedDepts.map(dept => {
                                const deptId = dept.id
                                const deptOk = !!deptConfirmedById?.[deptId]
                                const smeOk = !!smeConfirmedById?.[deptId]?.confirmed
                                const ivs = interventionsByDeptId.get(deptId) || []

                                const header = isMobile ? (
                                    <div style={{ width: '100%' }}>
                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                            <Text strong style={{ fontSize: 15 }}>
                                                {dept.name}
                                            </Text>

                                            <Space wrap size={6}>
                                                {deptOk ? <Tag color='blue'>Dept Confirmed</Tag> : <Tag>Pending Dept</Tag>}
                                                {smeOk ? <Tag color='green'>SME Confirmed</Tag> : <Tag>Pending SME</Tag>}
                                            </Space>

                                            {smeOk && (
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    Confirmed: {formatMaybeDate(smeConfirmedById?.[deptId]?.confirmedAt)}
                                                </Text>
                                            )}
                                        </Space>
                                    </div>
                                ) : (
                                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Space wrap>
                                            <Text strong>{dept.name}</Text>
                                            {deptOk ? <Tag color='blue'>Dept Confirmed</Tag> : <Tag>Pending Dept</Tag>}
                                            {smeOk ? <Tag color='green'>SME Confirmed</Tag> : <Tag>Pending SME</Tag>}
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
                                        {!deptOk ? (
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
                                                                        disabled={finalized || savingDeptId === deptId}
                                                                    >
                                                                        <Button
                                                                            danger
                                                                            size='small'
                                                                            icon={<DeleteOutlined />}
                                                                            disabled={finalized || savingDeptId === deptId}
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
                                    </Panel>
                                )
                            })}
                        </Collapse>
                    )}

                    <Divider />

                    {finalized ? (
                        <div style={{ textAlign: 'center' }}>
                            <CheckCircleOutlined style={{ fontSize: 44, color: '#52c41a' }} />
                            <Title level={3} style={{ marginTop: 8, marginBottom: 0, color: '#52c41a' }}>
                                Developmental Plan Finalized
                            </Title>
                            <Text type='secondary'>You confirmed all {TARGET_DEPTS} departments.</Text>
                        </div>
                    ) : (
                        <Alert
                            type='info'
                            showIcon
                            message='Finalization rule'
                            description={`Final confirmation is set automatically when you (SME) confirm all ${TARGET_DEPTS} departments.`}
                        />
                    )}
                </MotionCard>
            </Space>
        )
    }

    const renderGroupProgress = () => <GroupProgressForm />

    const viewOptions = [
        { id: 'growth-path', label: 'Growth Path', icon: <RocketOutlined /> },
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
                <DashboardHeaderCard
                    title='Roadmap'
                    subtitle={isMobile ? undefined : 'Review your Developmental Plan and Group Progress'}
                    extraRight={
                        !isMobile ? (
                            <Space wrap>
                                {viewOptions.map(view => (
                                    <Button
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

                {isMobile && (
                    <Card
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
                                label: view.label,
                                value: view.id,
                                icon: view.icon
                            }))}
                        />
                    </Card>
                )}

                <div
                    style={{
                        marginTop: contentGap,
                        overflowY: 'visible'
                    }}
                >
                    {selectedView === 'growth-path' && renderGrowthPathSimulator()}
                    {selectedView === 'growth-plan' && renderGrowthPlan()}
                    {selectedView === 'group-progress' && renderGroupProgress()}
                </div>
            </div>
        </div>
    )
}

export default RoadmapFlow
