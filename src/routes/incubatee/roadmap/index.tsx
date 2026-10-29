import { isCompulsoryIntervention } from '@/utils/compulsoryInterventions'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Typography, message } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    belongsToDept,
    confirmDepartmentBySme,
    finalizeIfAllSmeConfirmed,
    loadLatestDiagnosticPlan,
    resolveIncubateeParticipantId
} from '@/services/devPlanConfirmationService'
import DevelopmentPlanView, { type PlanDept, type PlanDeptStatus } from '@/components/incubatee/DevelopmentPlanView'

const { Title, Text } = Typography

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

    confirmedByDeptId?: Record<string, boolean>

    interventions?: any[]

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

const formatConfirmDate = (v: any) => {
    const d = v?.toDate?.() || (typeof v === 'string' || typeof v === 'number' ? new Date(v) : null)
    if (!d || Number.isNaN(d.getTime())) return undefined
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

const RoadmapFlow: React.FC = () => {
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

                const pid = await resolveIncubateeParticipantId(user)
                if (cancelled) return
                setParticipantId(pid || null)

                if (!pid) {
                    setLatestPlanId(null)
                    setPlanData(null)
                    return
                }

                const latest = await loadLatestDiagnosticPlan(pid)
                if (cancelled) return
                setLatestPlanId(latest?.id || null)
                setPlanData(latest?.data || null)
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
                                where('departmentId', '==', d.id)
                            )
                        )

                        out[d.id] = snap.docs.map(x => {
                            const data = x.data() as any
                            return {
                                id: x.id,
                                compulsory: data.compulsory === true,
                                title: data.title || data.name || data.interventionTitle || 'Untitled',
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

    // ===== Confirmations (ID-based, stable) =====
    const deptConfirmedById: Record<string, boolean> = planData?.confirmedByDeptId || {}
    const smeConfirmedById: Record<string, SMEDeptConfirm> =
        planData?.incubateeDepartmentConfirmationsByDeptId || {}

    const finalized = !!planData?.finalConfirmation

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
        if (isCompulsoryIntervention(iv, deptInterventionsMap[deptId] || [])) {
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

                const t1 = norm(x?.title || x?.interventionTitle || x?.name || '')
                const t2 = norm(iv?.title || iv?.interventionTitle || iv?.name || '')
                const d1 = String(x?.departmentId || x?.departmentID || '')
                const d2 = String(iv?.departmentId || iv?.departmentID || '')

                // if deptId exists, include it in match to reduce false deletions
                if (deptId && (d1 || d2)) return !(d1 === deptId && d2 === deptId && t1 === t2)

                return !(d1 === d2 && t1 === t2)
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

    const handleConfirmDeptBySME = async (dept: DeptRow) => {
        if (!latestPlanId || !userEmail) return
        try {
            setConfirmingDeptId(dept.id)
            await confirmDepartmentBySme({
                planId: latestPlanId,
                plan: planData,
                participantId,
                userEmail,
                dept,
                departments,
                catalogByDeptId: deptInterventionsMap,
                onFinalizing: setFinalizing
            })
        } finally {
            setConfirmingDeptId(null)
        }
    }

    // Each department as the view shows it: where it stands for the SME and
    // what it will deliver.
    const planDepts: PlanDept[] = useMemo(() => departments.map(dept => {
        const catalog = deptInterventionsMap[dept.id] || []
        const ivs = interventionsByDeptId.get(dept.id) || []
        const compulsoryOnly = ivs.length > 0 && ivs.every(iv => isCompulsoryIntervention(iv, catalog))
        const status: PlanDeptStatus = compulsoryOnly
            ? 'no-signoff'
            : smeConfirmedById?.[dept.id]?.confirmed
                ? 'confirmed'
                : deptConfirmedById?.[dept.id]
                    ? 'ready'
                    : 'waiting'
        return {
            id: dept.id,
            name: dept.name,
            status,
            confirmedAt: formatConfirmDate(smeConfirmedById?.[dept.id]?.confirmedAt),
            interventions: ivs.map((iv, index) => ({
                key: `${iv?.id || ''}-${iv?.title || iv?.name || ''}-${index}`,
                title: String(iv?.title ?? iv?.interventionTitle ?? iv?.name ?? 'Intervention'),
                departmentName: dept.name,
                compulsory: isCompulsoryIntervention(iv, catalog),
                raw: iv
            }))
        }
    }), [departments, deptInterventionsMap, interventionsByDeptId, smeConfirmedById, deptConfirmedById])

    // Plans confirmed before compulsory-only departments stopped blocking
    // finalization can be sitting with nothing left to confirm. Finish them
    // through the same service call a last confirmation would make.
    const finalizeAttemptedFor = useRef<string | null>(null)
    useEffect(() => {
        if (!latestPlanId || finalized || loadingDeptInterventions) return
        if (finalizeAttemptedFor.current === latestPlanId) return
        if (!departments.length || departments.some(d => !(d.id in deptInterventionsMap))) return
        const nothingLeft = planDepts.every(d => d.status === 'confirmed' || d.status === 'no-signoff')
        if (!nothingLeft || !planDepts.some(d => d.status === 'confirmed')) return

        finalizeAttemptedFor.current = latestPlanId
        finalizeIfAllSmeConfirmed({
            planId: latestPlanId,
            departments,
            catalogByDeptId: deptInterventionsMap,
            onFinalizing: setFinalizing
        }).catch(error => console.warn('Could not finalize the development plan:', error))
    }, [latestPlanId, finalized, loadingDeptInterventions, departments, deptInterventionsMap, planDepts])

    return (
        <div className='dp-page'>
            <header className='dp-page-head'>
                <Title level={3} className='dp-page-title'>
                    <FileTextOutlined />
                    Development plan
                </Title>
                <Text type='secondary'>
                    Each department sets out what it will deliver for your business. Review each one and confirm it.
                    Your plan is finalized once every department is confirmed.
                </Text>
            </header>

            <DevelopmentPlanView
                loading={loadingOverview || departmentsLoading || loadingDeptInterventions}
                departments={planDepts}
                finalized={finalized}
                confirmingId={confirmingDeptId}
                finalizing={finalizing}
                removingDeptId={savingDeptId}
                onConfirm={deptId => {
                    const dept = departments.find(d => d.id === deptId)
                    if (dept) handleConfirmDeptBySME(dept)
                }}
                onRemove={handleDeleteIntervention}
            />
        </div>
    )
}

export default RoadmapFlow
