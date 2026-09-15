import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Collapse,
    Col,
    Divider,
    Form,
    Grid,
    Progress,
    Row,
    Space,
    Table,
    Tag,
    Typography,
    message,
    Popconfirm,
    Skeleton,
    List
} from 'antd'
import {
    CheckCircleOutlined,
    CheckOutlined,
    DeleteOutlined,
    FileTextOutlined
} from '@ant-design/icons'
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

    const { user } = useFullIdentity()

    const [userEmail, setUserEmail] = useState<string | null>(null)
    const [participantId, setParticipantId] = useState<string | null>(null)

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

    const renderDevelopmentalPlan = () => {
        if (loadingOverview || departmentsLoading) {
            return <Skeleton active />
        }

        if (!TARGET_DEPTS) {
            return (
                <Alert
                    type='warning'
                    showIcon
                    message='No departments configured'
                    description='No departments matched the rule (interventionDepartment === false). Fix your department flags, then reload.'
                />
            )
        }

        return (
            <Space direction='vertical' size={isMobile ? 14 : 'large'} style={{ width: '100%' }}>
                {!isMobile && (
                    <Alert
                        message='What you (SME) confirm'
                        description='You confirm what each department will deliver. Only departments that have confirmed will appear below. For each: review interventions, add/remove if needed, then confirm.'
                        type='info'
                        showIcon
                    />
                )}

                {/* Confirmation progress: one combined card on mobile, side-by-side on desktop */}
                {isMobile ? (
                    <CardLike compact>
                        <Text strong style={{ fontSize: 13 }}>Confirmations</Text>
                        <div style={{ width: '100%' }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>Departments</Text>
                            <Progress
                                percent={deptPercent}
                                size={['100%', 10]}
                                status={deptPercent === 100 ? 'success' : 'active'}
                                format={() => `${deptConfirmedCount}/${TARGET_DEPTS}`}
                            />
                        </div>
                        <div style={{ width: '100%' }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>SME</Text>
                            <Progress
                                percent={smePercent}
                                size={['100%', 10]}
                                status={smePercent === 100 ? 'success' : 'active'}
                                format={() => `${smeConfirmedCount}/${TARGET_DEPTS}`}
                            />
                        </div>
                    </CardLike>
                ) : (
                    <Row gutter={[12, 12]} align='middle'>
                        <Col span={12}>
                            <CardLike>
                                <Text strong style={{ fontSize: 14 }}>Departments confirmed</Text>
                                <Progress
                                    percent={deptPercent}
                                    size={['100%', 14]}
                                    status={deptPercent === 100 ? 'success' : 'active'}
                                />
                                <Text type='secondary'>
                                    {deptConfirmedCount}/{TARGET_DEPTS}
                                </Text>
                            </CardLike>
                        </Col>

                        <Col span={12}>
                            <CardLike>
                                <Text strong style={{ fontSize: 14 }}>SME confirmations</Text>
                                <Progress
                                    percent={smePercent}
                                    size={['100%', 14]}
                                    status={smePercent === 100 ? 'success' : 'active'}
                                />
                                <Text type='secondary'>
                                    {smeConfirmedCount}/{TARGET_DEPTS}
                                </Text>
                            </CardLike>
                        </Col>
                    </Row>
                )}

                <Divider style={{ margin: isMobile ? '4px 0' : undefined }} />

                {!deptConfirmedCount ? (
                    <Alert
                        type='warning'
                        showIcon
                        message='No department confirmations yet'
                        description={isMobile ? undefined : 'Departments must confirm first. Once they do, you’ll see their interventions below.'}
                    />
                ) : (
                    <Collapse accordion bordered={false} style={{ background: 'transparent' }}>
                        {confirmedDepts.map((dept, index) => {
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
                                <Panel
                                    key={deptId}
                                    header={header}
                                    style={{
                                        marginBottom: index === confirmedDepts.length - 1 ? 0 : 14,
                                        background: '#fff',
                                        borderRadius: 14,
                                        border: '1px solid rgba(0,0,0,0.06)',
                                        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.06)',
                                        overflow: 'hidden'
                                    }}
                                >
                                    {!deptOk ? (
                                        <Alert
                                            type='info'
                                            showIcon
                                            message='Waiting for department'
                                            description='This department has not confirmed yet.'
                                        />
                                    ) : (
                                        <>
                                            {!isMobile && (
                                                <Alert
                                                    type='success'
                                                    showIcon
                                                    message='Review interventions for this department'
                                                    description='You can remove items you already have, or add missing items, then confirm this department.'
                                                    style={{ marginBottom: 12 }}
                                                />
                                            )}

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
                                                <Form.Item style={{ width: '100%', margin: 0 }}>
                                                    <Button
                                                        type='primary'
                                                        icon={<CheckOutlined />}
                                                        onClick={() => handleConfirmDeptBySME(dept)}
                                                        disabled={!deptOk || smeOk || finalized || finalizing}
                                                        loading={confirmingDeptId === deptId || finalizing}
                                                        block
                                                    >
                                                        Confirm Department
                                                    </Button>
                                                </Form.Item>
                                            </Form>

                                            {smeOk ? (
                                                isMobile ? (
                                                    <Tag color='green' style={{ marginTop: 12 }}>
                                                        You have confirmed this department
                                                    </Tag>
                                                ) : (
                                                    <Alert
                                                        style={{ marginTop: 12 }}
                                                        type='success'
                                                        showIcon
                                                        message='You have confirmed this department.'
                                                    />
                                                )
                                            ) : isMobile ? (
                                                <Text type='secondary' style={{ marginTop: 12, display: 'block', fontSize: 12 }}>
                                                    Confirming records your agreement with what this department will deliver.
                                                </Text>
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

                <Divider style={{ margin: isMobile ? '4px 0' : undefined }} />

                {finalized ? (
                    <div style={{ textAlign: 'center' }}>
                        <CheckCircleOutlined style={{ fontSize: isMobile ? 34 : 44, color: '#52c41a' }} />
                        <Title level={isMobile ? 4 : 3} style={{ marginTop: 8, marginBottom: 0, color: '#52c41a' }}>
                            Developmental Plan Finalized
                        </Title>
                        <Text type='secondary'>You confirmed all {TARGET_DEPTS} departments.</Text>
                    </div>
                ) : !isMobile ? (
                    <Alert
                        type='info'
                        showIcon
                        message='Finalization rule'
                        description={`Final confirmation is set automatically when you (SME) confirm all ${TARGET_DEPTS} departments.`}
                    />
                ) : null}
            </Space>
        )
    }

    return (
        <div
            style={{
                padding: isMobile ? 14 : 24,
            }}
        >
            <Title
                level={isMobile ? 4 : 3}
                style={{
                    margin: 0,
                    marginBottom: isMobile ? 12 : 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    textAlign: 'center'
                }}
            >
                <FileTextOutlined />
                Developmental Plan
            </Title>

            {renderDevelopmentalPlan()}
        </div>
    )
}

export default RoadmapFlow
