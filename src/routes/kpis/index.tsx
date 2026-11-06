
import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Drawer,
    Empty,
    Grid,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Row,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme,
    message
} from 'antd'
import {
    AimOutlined,
    BarChartOutlined,
    CalendarOutlined,
    DeleteOutlined,
    EditOutlined,
    LineChartOutlined,
    NumberOutlined,
    PercentageOutlined,
    PlusOutlined,
    RightOutlined,
    SaveOutlined,
    SettingOutlined,
    HistoryOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
    addDoc,
    arrayRemove,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    updateDoc,
    where
} from 'firebase/firestore'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { motion, useReducedMotion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, IconChip } from '@/components/dashboards/metrics/MetricTile'
import { KpiCreateModal } from '@/components/kpis/builder/KpiCreateModal'
import { KpiToolbar } from './KpiToolbar'
import { KpiList } from './KpiList'
import { KpiDetail } from './KpiDetail'
import {
    DEFAULT_KPI_FILTERS,
    buildKpiChoices,
    formatPeriodKey,
    hasTarget,
    isManual,
    matchesKpiFilters,
    sortKpis,
    type KpiFilterState,
    type KpiSort
} from './kpiRegisterDefs'
import './kpi-register.css'
import {
    SourceType,
    Unit,
    TargetPeriodType,
    KPI,
    KpiTargetDoc,
    KpiTargetAuditLog,
    prettySourceLabel,
    prettyFilters,
    parsePeriodKeyToSortValue,
    buildPeriodKey,
    parsePeriodKeyToDayjs,
    targetPeriodHasStarted,
    nextTargetPeriodStart,
    currentTargetPeriodStart,
    getUnitLabel
} from '@/components/kpis/builder/kpiModel'

dayjs.extend(quarterOfYear)
dayjs.extend(customParseFormat)
dayjs.extend(isSameOrBefore)

const { Text } = Typography
const { useBreakpoint } = Grid

const KPIManager: React.FC = () => {
    const [targetForm] = Form.useForm()
    const { user } = useFullIdentity()
    const { hasRole } = useDepartmentRoles()
    // Project admins (centre coordinators) sit above departments, so like a main
    // department they choose which department owns a KPI, or set up a shared one.
    const isProjectAdmin = String((user as any)?.role || '').toLowerCase().replace(/\s+/g, '') === 'projectadmin'
    const { isAllPrograms, activeProgramId } = useActiveProgramId()

    const [kpis, setKpis] = useState<KPI[]>([])
    const [kpiFilters, setKpiFilters] = useState<KpiFilterState>(DEFAULT_KPI_FILTERS)
    const [kpiSort, setKpiSort] = useState<KpiSort>('name')
    const [selectedKpiId, setSelectedKpiId] = useState<string | null>(null)
    // Phones show the selected KPI in a drawer over the list.
    const [detailOpen, setDetailOpen] = useState(false)
    // The Add/Edit KPI window: create mode (kpi null) or editing a KPI.
    const [kpiModal, setKpiModal] = useState<{ open: boolean; kpi: KPI | null }>({ open: false, kpi: null })
    const [loading, setLoading] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const [departments, setDepartments] = useState<any[]>([])
    const [, setDepartmentsLoading] = useState(false)

    const [interventions, setInterventions] = useState<any[]>([])
    const [isMainDept, setIsMainDept] = useState(false)
    const managesAllDepartments = isMainDept || isProjectAdmin
    const [isMonitoringDept, setIsMonitoringDept] = useState(false)

    const [targetsModalOpen, setTargetsModalOpen] = useState(false)
    const [targetsKpi, setTargetsKpi] = useState<KPI | null>(null)
    const [targetRows, setTargetRows] = useState<KpiTargetDoc[]>([])
    const [targetAuditRows, setTargetAuditRows] = useState<KpiTargetAuditLog[]>([])
    // Who made each target change: user id → display name, so the trail never shows a raw id.
    const [actorNames, setActorNames] = useState<Record<string, string>>({})
    const [targetsLoading, setTargetsLoading] = useState(false)
    const [targetsSaving, setTargetsSaving] = useState(false)
    const [editingTarget, setEditingTarget] = useState<KpiTargetDoc | null>(null)
    const [targetsDeletingId, setTargetsDeletingId] = useState<string | null>(null)
    const [targetModalSection, setTargetModalSection] = useState<'plan' | 'periods' | 'trail'>('plan')

    const { token } = theme.useToken()
    const screens = useBreakpoint()
    const isPhone = !screens.md
    const reduceMotion = useReducedMotion()
    /** Page entrance: tiles, then the filter bar, rise in one after another. */
    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    const targetPeriodType = Form.useWatch('periodType', targetForm) as TargetPeriodType | undefined
    const editingCommittedTarget = Boolean(
        editingTarget && targetPeriodHasStarted(editingTarget.periodType, editingTarget.periodKey)
    )

    // Only filters that would narrow this list are offered (see buildKpiChoices).
    const kpiChoices = useMemo(() => buildKpiChoices(kpis), [kpis])
    const orderedKpis = useMemo(() => {
        const activeKeys = kpiChoices.map(c => c.key)
        return sortKpis(kpis.filter(kpi => matchesKpiFilters(kpi, kpiFilters, activeKeys)), kpiSort)
    }, [kpis, kpiChoices, kpiFilters, kpiSort])

    const kpiStats = useMemo(() => {
        const live = orderedKpis.filter(k => !isManual(k)).length
        const withTarget = orderedKpis.filter(hasTarget).length
        return { total: orderedKpis.length, live, manual: orderedKpis.length - live, withTarget, needsTarget: orderedKpis.length - withTarget }
    }, [orderedKpis])

    const selectedKpi = useMemo(
        () => orderedKpis.find(kpi => kpi.id === selectedKpiId) || null,
        [orderedKpis, selectedKpiId]
    )

    const targetSummary = useMemo(() => {
        const committed = targetRows.filter(row => targetPeriodHasStarted(row.periodType, row.periodKey))
        const future = targetRows.length - committed.length
        return { committed: committed.length, future, total: targetRows.length }
    }, [targetRows])

    useEffect(() => {
        if (!orderedKpis.length) {
            setSelectedKpiId(null)
            return
        }

        if (!selectedKpiId || !orderedKpis.some(kpi => kpi.id === selectedKpiId)) {
            setSelectedKpiId(orderedKpis[0].id)
        }
    }, [orderedKpis, selectedKpiId])

    const checkIfMainDept = async () => {
        try {
            if (!user?.departmentId) {
                setIsMainDept(false)
                setIsMonitoringDept(false)
                return
            }
            const snap = await getDocs(collection(db, 'departments'))
            const deptDoc = snap.docs.find(d => d.id === user.departmentId)
            setIsMainDept(Boolean(deptDoc?.data()?.isMain))
            setIsMonitoringDept(Boolean(deptDoc?.data()?.isMonitoring))
        } catch (err) {
            console.error(err)
            setIsMainDept(false)
            setIsMonitoringDept(false)
        }
    }

    const fetchDepartments = async () => {
        try {
            setDepartmentsLoading(true)
            const snap = await getDocs(collection(db, 'departments'))

            const rows = snap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }))
                .filter(row => String(row?.name || '').trim())

            setDepartments(rows)
        } catch (err) {
            console.error(err)
            setDepartments([])
            message.error('Failed to load departments')
        } finally {
            setDepartmentsLoading(false)
        }
    }

    const fetchInterventions = async () => {
        try {
            const qRef = query(
                collection(db, 'interventions'),
                limit(600)
            )

            const snap = await getDocs(qRef)
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))

            setInterventions(rows)
        } catch (err) {
            console.error(err)
            setInterventions([])
            message.error('Failed to load interventions')
        }
    }

    const fetchKPIs = async () => {
        setLoading(true)
        try {
            const snap = await getDocs(collection(db, 'kpiDefinitions'))

            const allKpis = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as KPI[]

            const programScopedKpis = allKpis.filter(k => {
                if (k.appliesToAllPrograms) return true
                if (isAllPrograms) return true
                return k.programId === activeProgramId
            })

            const visibleKpis =
                !isMainDept && user?.departmentId
                    ? programScopedKpis.filter(k => k.leadDepartmentId === user.departmentId)
                    : programScopedKpis

            const targetSnap = await getDocs(query(collection(db, 'kpiTargets'), limit(1500)))

            const targets = targetSnap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as KpiTargetDoc[]

            const latestByKpiId = new Map<string, KpiTargetDoc>()
            for (const t of targets) {
                const existing = latestByKpiId.get(t.kpiId)
                if (!existing || parsePeriodKeyToSortValue(t.periodKey) > parsePeriodKeyToSortValue(existing.periodKey)) {
                    latestByKpiId.set(t.kpiId, t)
                }
            }

            setKpis(
                visibleKpis.map(kpi => {
                    const latest = latestByKpiId.get(kpi.id)
                    return {
                        ...kpi,
                        latestTargetPeriodType: latest?.periodType || null,
                        latestTargetPeriodKey: latest?.periodKey || null,
                        latestTarget: typeof latest?.target === 'number' ? latest.target : null
                    }
                })
            )
        } catch (err) {
            console.error(err)
            message.error('Failed to load KPIs')
        } finally {
            setLoading(false)
        }
    }

    const resolveActorNames = async (ids: (string | undefined)[]) => {
        const missing = Array.from(new Set(ids.filter((id): id is string => !!id && id !== 'system'))).filter(id => !(id in actorNames))
        if (!missing.length) return
        const found = await Promise.all(missing.map(async id => {
            try {
                const snap = await getDoc(doc(db, 'users', id))
                const data = snap.exists() ? (snap.data() as any) : null
                return [id, String(data?.name || data?.fullName || data?.email || '').trim()] as const
            } catch {
                return [id, ''] as const
            }
        }))
        setActorNames(current => ({ ...current, ...Object.fromEntries(found) }))
    }

    const actorLabel = (id?: string) => {
        if (!id || id === 'system') return 'the system'
        const name = actorNames[id]
        if (id === user?.uid) return name ? `${name} (you)` : 'you'
        return name || 'a team member'
    }

    const fetchTargetsForKpi = async (kpiId: string): Promise<KpiTargetDoc[]> => {
        let loadedRows: KpiTargetDoc[] = []
        setTargetsLoading(true)
        try {
            const [targetsSnap, auditSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, 'kpiTargets'),
                        where('kpiId', '==', kpiId)
                    )
                ),
                getDocs(
                    query(
                        collection(db, 'kpiTargetAuditLogs'),
                        where('kpiId', '==', kpiId),
                        limit(500)
                    )
                )
            ])

            const rows = targetsSnap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }) as KpiTargetDoc)
                .sort((a, b) => parsePeriodKeyToSortValue(b.periodKey) - parsePeriodKeyToSortValue(a.periodKey))

            setTargetRows(rows)
            loadedRows = rows

            const auditRows = auditSnap.docs
                .map(d => ({ id: d.id, ...(d.data() as any) }) as KpiTargetAuditLog)
                .sort((a, b) => {
                    const aTime = a.changedAt?.seconds || new Date(a.changedAt || 0).getTime() || 0
                    const bTime = b.changedAt?.seconds || new Date(b.changedAt || 0).getTime() || 0
                    return bTime - aTime
                })

            setTargetAuditRows(auditRows)
            void resolveActorNames(auditRows.map(r => r.changedBy))
        } catch (err) {
            console.error(err)
            message.error('Failed to load target history')
        } finally {
            setTargetsLoading(false)
        }
        return loadedRows
    }

    /**
     * Where a new target starts: the period running now if it has no target yet
     * (so a KPI is never left unmeasured this month), otherwise the next one.
     */
    const defaultTargetPeriod = (periodType: TargetPeriodType, rows: KpiTargetDoc[] = targetRows) => {
        const current = currentTargetPeriodStart(periodType)
        const taken = rows.some(r => r.periodType === periodType && r.periodKey === buildPeriodKey(periodType, current))
        return taken ? nextTargetPeriodStart(periodType) : current
    }

    useEffect(() => {
        checkIfMainDept()
    }, [user?.departmentId])

    useEffect(() => {
        if (!user) return
        fetchDepartments()
        fetchInterventions()
        fetchKPIs()
    }, [user?.departmentId, isMainDept, activeProgramId, isAllPrograms])

    const writeTargetAuditLog = async (params: {
        action: 'created' | 'updated' | 'revised' | 'deleted'
        kpi: KPI
        targetDocId?: string
        periodType: TargetPeriodType
        periodKey: string
        oldTarget: number | null
        newTarget: number | null
        changeReason?: string
        revisionId?: string
    }) => {
        await addDoc(collection(db, 'kpiTargetAuditLogs'), {
            kpiId: params.kpi.id,
            targetDocId: params.targetDocId || null,
            kpiLabel: params.kpi.kpiLabel,
            departmentId: params.kpi.leadDepartmentId || null,
            department: params.kpi.department,
            periodType: params.periodType,
            periodKey: params.periodKey,
            action: params.action,
            oldTarget: params.oldTarget,
            newTarget: params.newTarget,
            changeReason: params.changeReason || '',
            changedAt: new Date(),
            changedBy: user?.uid || 'system',
            revisionId: params.revisionId || null,
            approvedBy: params.action === 'revised' ? (user?.uid || 'system') : null,
            approvedAt: params.action === 'revised' ? new Date() : null
        })
    }

    const createApprovedTargetRevision = async (params: {
        target: KpiTargetDoc
        kpi: KPI
        revisedTarget: number
        reason: string
    }) => {
        const revisionRef = await addDoc(collection(db, 'kpiTargetRevisions'), {
            targetDocId: params.target.id,
            kpiId: params.kpi.id,
            kpiLabel: params.kpi.kpiLabel,
            departmentId: params.kpi.leadDepartmentId || null,
            department: params.kpi.department,
            periodType: params.target.periodType,
            periodKey: params.target.periodKey,
            committedTarget: params.target.target,
            revisedTarget: params.revisedTarget,
            reason: params.reason,
            status: 'approved',
            approvedBy: user?.uid || 'system',
            approvedAt: new Date(),
            createdAt: new Date()
        })

        await writeTargetAuditLog({
            action: 'revised',
            kpi: params.kpi,
            targetDocId: params.target.id,
            periodType: params.target.periodType,
            periodKey: params.target.periodKey,
            oldTarget: params.target.target,
            newTarget: params.revisedTarget,
            changeReason: params.reason,
            revisionId: revisionRef.id
        })
    }

    const handleDelete = async (record: KPI) => {
        try {
            setDeletingId(record.id)

            const withThisKpi = interventions
                .filter(i => Array.isArray(i.kpiIds) && i.kpiIds.includes(record.id))
                .map(i => i.id as string)

            await Promise.all(
                withThisKpi.map(id =>
                    updateDoc(doc(db, 'interventions', id), { kpiIds: arrayRemove(record.id) })
                )
            )

            {
                const targetSnap = await getDocs(query(collection(db, 'kpiTargets'), where('kpiId', '==', record.id)))

                await Promise.all(
                    targetSnap.docs.map(async d => {
                        const target = d.data() as any
                        await writeTargetAuditLog({
                            action: 'deleted',
                            kpi: record,
                            targetDocId: d.id,
                            periodType: target.periodType,
                            periodKey: target.periodKey,
                            oldTarget: typeof target.target === 'number' ? target.target : null,
                            newTarget: null,
                            changeReason: 'Target removed because KPI was deleted'
                        })
                        await deleteDoc(doc(db, 'kpiTargets', d.id))
                    })
                )
            }

            await deleteDoc(doc(db, 'kpiDefinitions', record.id))
            message.success('KPI deleted')
            fetchKPIs()
        } catch (err) {
            console.error(err)
            message.error('Delete failed')
        } finally {
            setDeletingId(null)
        }
    }

    const openTargetsModal = async (kpi: KPI) => {
        setTargetsKpi(kpi)
        setTargetsModalOpen(true)
        setEditingTarget(null)
        setTargetModalSection('plan')
        targetForm.resetFields()
        targetForm.setFieldsValue({
            periodType: 'monthly',
            periodKey: currentTargetPeriodStart('monthly'),
            target: undefined,
            changeReason: ''
        })
        const rows = await fetchTargetsForKpi(kpi.id)
        targetForm.setFieldsValue({ periodKey: defaultTargetPeriod('monthly', rows) })
    }

    // Deep link from the tracker: ?kpi=<id> selects that KPI; &targets=1 also opens its targets.
    const [searchParams, setSearchParams] = useSearchParams()
    useEffect(() => {
        const kpiId = searchParams.get('kpi')
        if (!kpiId || !kpis.length) return
        const kpi = kpis.find(k => k.id === kpiId)
        if (kpi) {
            setSelectedKpiId(kpi.id)
            if (searchParams.get('targets') === '1') void openTargetsModal(kpi)
        }
        setSearchParams({}, { replace: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kpis, searchParams])

    const startEditTarget = (row: KpiTargetDoc) => {
        setEditingTarget(row)
        setTargetModalSection('plan')
        targetForm.setFieldsValue({
            periodType: row.periodType,
            periodKey: parsePeriodKeyToDayjs(row.periodType, row.periodKey),
            target: row.target,
            changeReason: ''
        })
    }

    const cancelEditTarget = () => {
        setEditingTarget(null)
        targetForm.resetFields()
        targetForm.setFieldsValue({
            periodType: 'monthly',
            periodKey: defaultTargetPeriod('monthly'),
            target: undefined,
            changeReason: ''
        })
    }

    const handleSaveTargetFromDrawer = async () => {
        if (!targetsKpi) {
            message.error('Choose a KPI before saving a target')
            return
        }

        try {
            const values = await targetForm.validateFields()
            setTargetsSaving(true)

            const periodType = values.periodType as TargetPeriodType
            const periodKey = buildPeriodKey(periodType, values.periodKey)
            const periodStartAt = parsePeriodKeyToDayjs(periodType, periodKey).toDate()
            const newTarget = Number(values.target || 0)
            const changeReason = String(values.changeReason || '').trim()

            if (!Number.isFinite(newTarget) || newTarget <= 0) {
                throw new Error('Target must be greater than zero')
            }

            if (editingTarget) {
                const isCommittedPeriod = targetPeriodHasStarted(editingTarget.periodType, editingTarget.periodKey)

                if (isCommittedPeriod) {
                    if (periodType !== editingTarget.periodType || periodKey !== editingTarget.periodKey) {
                        throw new Error('The period for a committed target cannot be changed')
                    }
                    if (!changeReason) {
                        throw new Error('A reason is required to record a target revision')
                    }

                    await createApprovedTargetRevision({
                        target: editingTarget,
                        kpi: targetsKpi,
                        revisedTarget: newTarget,
                        reason: changeReason
                    })

                    message.success('Target revision recorded. The committed target remains unchanged for reporting.')
                } else {
                    const duplicateSnap = await getDocs(
                        query(
                            collection(db, 'kpiTargets'),
                            where('kpiId', '==', targetsKpi.id),
                            where('periodKey', '==', periodKey)
                        )
                    )
                    const duplicate = duplicateSnap.docs.find(row => row.id !== editingTarget.id)
                    if (duplicate) {
                        throw new Error('A target already exists for that period')
                    }

                    const oldTarget = typeof editingTarget.target === 'number' ? editingTarget.target : null

                    await updateDoc(doc(db, 'kpiTargets', editingTarget.id), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        departmentId: targetsKpi.leadDepartmentId || null,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        updatedAt: new Date(),
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'updated',
                        kpi: targetsKpi,
                        targetDocId: editingTarget.id,
                        periodType,
                        periodKey,
                        oldTarget,
                        newTarget,
                        changeReason
                    })

                    message.success('Target updated')
                }
            } else {
                const isRunningPeriod = periodKey === buildPeriodKey(periodType, currentTargetPeriodStart(periodType))
                if (targetPeriodHasStarted(periodType, periodKey) && !isRunningPeriod) {
                    throw new Error('Targets can’t be set for a period that has already ended')
                }

                const snap = await getDocs(
                    query(
                        collection(db, 'kpiTargets'),
                        where('kpiId', '==', targetsKpi.id),
                        where('periodKey', '==', periodKey)
                    )
                )

                // The running period's target is committed once set: never overwrite it here.
                if (isRunningPeriod && !snap.empty) {
                    throw new Error('This period already has a committed target. Use Revise in Target periods to change it.')
                }

                if (!snap.empty) {
                    const existingDoc = snap.docs[0]
                    const existing = existingDoc.data() as any
                    await updateDoc(doc(db, 'kpiTargets', existingDoc.id), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        departmentId: targetsKpi.leadDepartmentId || null,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        updatedAt: new Date(),
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'updated',
                        kpi: targetsKpi,
                        targetDocId: existingDoc.id,
                        periodType,
                        periodKey,
                        oldTarget: typeof existing.target === 'number' ? existing.target : null,
                        newTarget,
                        changeReason
                    })

                    message.success('Existing period target updated')
                } else {
                    const ref = await addDoc(collection(db, 'kpiTargets'), {
                        kpiId: targetsKpi.id,
                        kpiLabel: targetsKpi.kpiLabel,
                        departmentId: targetsKpi.leadDepartmentId || null,
                        department: targetsKpi.department,
                        periodType,
                        periodKey,
                        periodStartAt,
                        target: newTarget,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        createdBy: user?.uid || 'system',
                        updatedBy: user?.uid || 'system',
                        changeReason
                    })

                    await writeTargetAuditLog({
                        action: 'created',
                        kpi: targetsKpi,
                        targetDocId: ref.id,
                        periodType,
                        periodKey,
                        oldTarget: null,
                        newTarget,
                        changeReason
                    })

                    message.success('Target added')
                }
            }

            cancelEditTarget()
            // The write has completed at this point. Refreshing the wider KPI
            // list can wait on a slow Firestore read, so do not keep Save in a
            // loading state while those views catch up.
            void fetchTargetsForKpi(targetsKpi.id).catch(err => console.error('Failed to refresh target periods', err))
            void fetchKPIs().catch(err => console.error('Failed to refresh KPI list', err))
        } catch (err: any) {
            if (err?.errorFields) return
            console.error(err)
            message.error(err?.message || 'Failed to save target')
        } finally {
            setTargetsSaving(false)
        }
    }

    const handleDeleteTarget = async (row: KpiTargetDoc) => {
        if (!targetsKpi) return
        if (targetPeriodHasStarted(row.periodType, row.periodKey)) {
            message.error('Committed targets cannot be deleted. Record a revision instead.')
            return
        }
        try {
            setTargetsDeletingId(row.id)

            await writeTargetAuditLog({
                action: 'deleted',
                kpi: targetsKpi,
                targetDocId: row.id,
                periodType: row.periodType,
                periodKey: row.periodKey,
                oldTarget: typeof row.target === 'number' ? row.target : null,
                newTarget: null,
                changeReason: 'Target deleted manually'
            })

            await deleteDoc(doc(db, 'kpiTargets', row.id))
            message.success('Target deleted')

            await fetchTargetsForKpi(targetsKpi.id)
            await fetchKPIs()

            if (editingTarget?.id === row.id) {
                cancelEditTarget()
            }
        } catch (err) {
            console.error(err)
            message.error('Failed to delete target')
        } finally {
            setTargetsDeletingId(null)
        }
    }

    const columns = useMemo<ColumnsType<KPI>>(
        () => [
            ...(isMainDept ? [{ title: 'Department', dataIndex: 'department', key: 'department', width: 150 }] : []),
            {
                title: 'Program Scope',
                key: 'programScope',
                width: 180,
                render: (_: any, record: KPI) => {
                    if (record.appliesToAllPrograms) {
                        return <Tag color='volcano'>All Programs</Tag>
                    }
                    return <Tag color='blue'>Active Program</Tag>
                }
            },
            {
                title: 'Ownership',
                key: 'belongsToMe',
                width: 140,
                render: (_: any, record: KPI) =>
                    record.belongsToMe !== false
                        ? <Tag color='green'>Belongs to me</Tag>
                        : <Tag color='cyan'>Shared</Tag>
            },
            ...isMainDept ? [{
                title: 'Contributing Departments',
                key: 'contributorDepartmentNames',
                width: 260,
                render: (_: any, record: KPI) => {
                    if (record.belongsToMe !== false) {
                        return <Tag color='green'>{record.department || 'My Department'}</Tag>
                    }

                    const names = record.contributorDepartmentNames || []
                    if (!names.length) return <Text type='secondary'>-</Text>

                    return (
                        <Space size={[4, 4]} wrap>
                            {names.map(name => (
                                <Tag key={name} color='cyan'>
                                    {name}
                                </Tag>
                            ))}
                        </Space>
                    )
                }
            }] : [],
            { title: 'KPI Label', dataIndex: 'kpiLabel', key: 'kpiLabel', width: 240 },
            {
                title: 'Unit',
                dataIndex: 'unit',
                key: 'unit',
                width: 100,
                render: (u: Unit) => {
                    const color = u === 'percent' ? 'purple' : u === 'ZAR' ? 'green' : 'blue'
                    return <Tag color={color}>{getUnitLabel(u)}</Tag>
                }
            },
            {
                title: 'Target Period',
                key: 'latestTargetPeriodKey',
                width: 170,
                render: (_: any, record: KPI) => {
                    if (!record.latestTargetPeriodKey) return <Text type='secondary'>-</Text>
                    return (
                        <Space size={6}>
                            <Tag color={record.latestTargetPeriodType === 'quarterly' ? 'geekblue' : 'blue'}>
                                {record.latestTargetPeriodType || 'monthly'}
                            </Tag>
                            <span>{record.latestTargetPeriodKey}</span>
                        </Space>
                    )
                }
            },
            {
                title: 'Target',
                key: 'latestTarget',
                width: 120,
                render: (_: any, record: KPI) =>
                    record.latestTarget === null || record.latestTarget === undefined
                        ? <Text type='secondary'>-</Text>
                        : record.latestTarget
            },
            {
                title: 'Source',
                dataIndex: 'sourceType',
                key: 'sourceType',
                width: 180,
                render: (st: SourceType) => <Tag color='geekblue'>{prettySourceLabel(st)}</Tag>
            },
            {
                title: 'KPI Type',
                key: 'displayKpiType',
                width: 180,
                render: (_: any, record: KPI) => {
                    const type = record.displayKpiType ||
                        (record.calculationType === 'count'
                            ? 'total_number'
                            : record.calculationType === 'sum'
                                ? 'total_amount'
                                : record.calculationType === 'average'
                                    ? 'average'
                                    : 'percentage')

                    const labelMap: Record<string, string> = {
                        total_number: 'Total number',
                        total_amount: 'Total amount',
                        average: 'Average',
                        percentage: 'Percentage'
                    }

                    return <Tag color='blue'>{labelMap[type]}</Tag>
                }
            },
            {
                title: 'Conditions',
                key: 'conditions',
                width: 260,
                render: (_: any, record: KPI) => {
                    if (record.displayKpiType === 'percentage' || record.calculationType === 'ratio') {
                        return (
                            <Tooltip
                                title={`Top group: ${prettyFilters(record.numerator?.filters || [], record.sourceType)} | Bottom group: ${prettyFilters(record.denominator?.filters || [], record.sourceType)}`}
                            >
                                <Tag icon={<PercentageOutlined />} color='purple'>
                                    Percentage setup
                                </Tag>
                            </Tooltip>
                        )
                    }

                    return (
                        <Tooltip title={prettyFilters(record.filters, record.sourceType)}>
                            <Tag icon={<SettingOutlined />} color='gold'>
                                {record.filters?.length ? `${record.filters.length} condition(s)` : 'No conditions'}
                            </Tag>
                        </Tooltip>
                    )
                }
            },
            {
                title: 'Actions',
                key: 'actions',
                width: 280,
                fixed: 'right',
                render: (_: any, record: KPI) => (
                    <Space>
                        <Button shape='round' icon={<EditOutlined />} onClick={() => setKpiModal({ open: true, kpi: record })}>
                            Edit
                        </Button>

                        <Button shape='round' icon={<HistoryOutlined />} onClick={() => openTargetsModal(record)}>
                            Targets
                        </Button>

                        <Popconfirm
                            placement='left'
                            title='Delete KPI'
                            description='This removes the KPI, its targets, and detaches linked interventions.'
                            okText='Delete'
                            okButtonProps={{ danger: true, loading: deletingId === record.id }}
                            cancelText='Cancel'
                            onConfirm={() => handleDelete(record)}
                        >
                            <Button shape='round' danger icon={<DeleteOutlined />} loading={deletingId === record.id}>
                                Delete
                            </Button>
                        </Popconfirm>
                    </Space>
                )
            }
        ],
        [deletingId]
    )

    const targetColumns = useMemo<ColumnsType<KpiTargetDoc>>(
        () => [
            {
                title: 'Period Type',
                dataIndex: 'periodType',
                key: 'periodType',
                width: 120,
                render: (v: TargetPeriodType) => <Tag color={v === 'quarterly' ? 'geekblue' : 'blue'}>{v}</Tag>
            },
            { title: 'Period', dataIndex: 'periodKey', key: 'periodKey', width: 130 },
            { title: 'Target', dataIndex: 'target', key: 'target', width: 120 },
            {
                title: 'Status',
                key: 'status',
                width: 120,
                render: (_: any, row: KpiTargetDoc) => {
                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                    return <Tag color={committed ? 'gold' : 'blue'}>{committed ? 'Committed' : 'Future'}</Tag>
                }
            },
            {
                title: 'Updated',
                key: 'updatedAt',
                width: 180,
                render: (_: any, row: KpiTargetDoc) => {
                    const raw = row.updatedAt || row.createdAt
                    if (!raw) return '-'
                    const date = raw?.seconds ? dayjs.unix(raw.seconds) : dayjs(raw)
                    return date.isValid() ? date.format('DD MMM YYYY HH:mm') : '-'
                }
            },
            { title: 'By', dataIndex: 'updatedBy', key: 'updatedBy', width: 150, render: (v, row) => v || row.createdBy || '-' },
            {
                title: 'Actions',
                key: 'actions',
                width: 190,
                render: (_: any, row: KpiTargetDoc) => {
                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                    return (
                        <Space>
                            <Button shape='round' icon={<EditOutlined />} onClick={() => startEditTarget(row)}>
                                {committed ? 'Revise' : 'Edit'}
                            </Button>

                            {committed ? (
                                <Tooltip title='Committed targets cannot be deleted.'>
                                    <Button shape='round' danger disabled icon={<DeleteOutlined />}>Delete</Button>
                                </Tooltip>
                            ) : (
                                <Popconfirm
                                    title='Delete target'
                                    description='Delete this future target period?'
                                    okText='Delete'
                                    okButtonProps={{ danger: true, loading: targetsDeletingId === row.id }}
                                    cancelText='Cancel'
                                    onConfirm={() => handleDeleteTarget(row)}
                                >
                                    <Button shape='round' danger icon={<DeleteOutlined />} loading={targetsDeletingId === row.id}>
                                        Delete
                                    </Button>
                                </Popconfirm>
                            )}
                        </Space>
                    )
                }
            }
        ],
        [targetsDeletingId, editingTarget]
    )

    const auditColumns = useMemo<ColumnsType<KpiTargetAuditLog>>(
        () => [
            {
                title: 'When',
                key: 'changedAt',
                width: 180,
                render: (_: any, row: KpiTargetAuditLog) => {
                    const raw = row.changedAt
                    if (!raw) return '-'
                    const date = raw?.seconds ? dayjs.unix(raw.seconds) : dayjs(raw)
                    return date.isValid() ? date.format('DD MMM YYYY HH:mm') : '-'
                }
            },
            { title: 'Action', dataIndex: 'action', key: 'action', width: 110, render: v => <Tag>{v}</Tag> },
            { title: 'Period', dataIndex: 'periodKey', key: 'periodKey', width: 120 },
            { title: 'Old Target', dataIndex: 'oldTarget', key: 'oldTarget', width: 110, render: v => v ?? '-' },
            { title: 'New Target', dataIndex: 'newTarget', key: 'newTarget', width: 110, render: v => v ?? '-' },
            { title: 'Reason', dataIndex: 'changeReason', key: 'changeReason', ellipsis: true },
            { title: 'By', dataIndex: 'changedBy', key: 'changedBy', width: 150, render: v => actorLabel(v) }
        ],
        []
    )

    const renderDetail = () =>
        selectedKpi ? (
            <KpiDetail
                kpi={selectedKpi}
                deleting={deletingId === selectedKpi.id}
                onEdit={() => setKpiModal({ open: true, kpi: selectedKpi })}
                onTargets={() => openTargetsModal(selectedKpi)}
                onDelete={() => handleDelete(selectedKpi)}
            />
        ) : null

    const tiles = [
        { key: 'total', title: isPhone ? 'KPIs' : 'KPIs in view', value: kpiStats.total, icon: <NumberOutlined />, tone: 'accent' as const },
        { key: 'live', title: isPhone ? 'Live' : 'Tracked live', value: kpiStats.live, icon: <LineChartOutlined />, tone: 'info' as const },
        { key: 'target', title: isPhone ? 'Targets' : 'With a target', value: kpiStats.withTarget, icon: <AimOutlined />, tone: 'success' as const },
        { key: 'missing', title: isPhone ? 'No target' : 'Need a target', value: kpiStats.needsTarget, icon: <CalendarOutlined />, tone: 'warning' as const }
    ]

    return (
        <div className='ws-page'>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tiles.map((t, i) => (
                    <Col key={t.key} xs={12} xl={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile title={t.title} value={t.value} icon={t.icon} tone={t.tone} loading={loading} compact={isPhone} />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div {...rise(0.22)}>
                <KpiToolbar
                    filters={kpiFilters}
                    onChange={patch => setKpiFilters(current => ({ ...current, ...patch }))}
                    choices={kpiChoices}
                    onAdd={() => setKpiModal({ open: true, kpi: null })}
                />
            </motion.div>

            {!loading && !kpis.length ? (
                <MotionCard>
                    <Empty className='ws-detail-empty' description='No KPIs yet. Add one to start tracking progress.'>
                        <Button type='primary' icon={<PlusOutlined />} onClick={() => setKpiModal({ open: true, kpi: null })}>
                            Add KPI
                        </Button>
                    </Empty>
                </MotionCard>
            ) : (
                <div className='ws-layout'>
                    <KpiList
                        kpis={orderedKpis}
                        loading={loading}
                        selectedId={selectedKpi?.id || null}
                        onSelect={kpi => {
                            setSelectedKpiId(kpi.id)
                            if (isPhone) setDetailOpen(true)
                        }}
                        sort={kpiSort}
                        onSortChange={setKpiSort}
                        showDepartment={managesAllDepartments}
                        resetKey={JSON.stringify(kpiFilters)}
                    />

                    {!isPhone && (
                        <div className='ws-detail-sticky'>
                            {loading ? (
                                <MotionCard loading skeleton='text' skeletonRows={10}>{null}</MotionCard>
                            ) : renderDetail() || (
                                <MotionCard>
                                    <Empty className='ws-detail-empty' description='No KPIs match these filters' />
                                </MotionCard>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isPhone && (
                <Drawer
                    className='ws-drawer ws-sheet'
                    open={detailOpen && !!selectedKpi}
                    onClose={() => setDetailOpen(false)}
                    placement='bottom'
                    height='88vh'
                    title={selectedKpi?.kpiLabel || 'KPI'}
                >
                    {renderDetail()}
                </Drawer>
            )}

            <Modal
                title={targetsKpi ? `Targets: ${targetsKpi.kpiLabel}` : 'Targets'}
                open={targetsModalOpen}
                onCancel={() => {
                    setTargetsModalOpen(false)
                    setTargetsKpi(null)
                    setTargetRows([])
                    setTargetAuditRows([])
                    setEditingTarget(null)
                    setTargetModalSection('plan')
                    targetForm.resetFields()
                }}
                centered
                footer={null}
                width={1100}
                styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', overflowX: 'hidden' } }}
                destroyOnClose
            >
                {!targetsKpi ? (
                    <Empty />
                ) : (
                    <>
                        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                            {[
                                { title: 'Target periods', value: targetSummary.total, icon: <CalendarOutlined style={{ color: '#1677ff' }} />, background: 'rgba(22,119,255,.12)' },
                                { title: 'Committed', value: targetSummary.committed, icon: <SaveOutlined style={{ color: '#fa8c16' }} />, background: 'rgba(250,140,22,.12)' },
                                { title: 'Future to plan', value: targetSummary.future, icon: <RightOutlined style={{ color: '#52c41a' }} />, background: 'rgba(82,196,26,.12)' }
                            ].map(item => (
                                <Col xs={24} sm={8} key={item.title}>
                                    <Card size='small' style={{ borderRadius: 14, background: token.colorFillAlter }} bodyStyle={{ padding: '13px 16px' }}>
                                        <Space size={10}>
                                            <IconChip size={34} bg={item.background} icon={item.icon} />
                                            <div>
                                                <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>{item.title}</Text>
                                                <Text strong style={{ fontSize: 20 }}>{item.value}</Text>
                                            </div>
                                        </Space>
                                    </Card>
                                </Col>
                            ))}
                        </Row>

                        <Row gutter={[16, 16]} align='top'>
                            <Col xs={24} lg={6}>
                                <div style={{ borderRight: `1px solid ${token.colorBorderSecondary}`, paddingRight: 12 }}>
                                    <Text type='secondary' style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Target workspace</Text>
                                    <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                        {[
                                            { key: 'plan' as const, label: 'Plan target', detail: 'Set or revise', icon: <PlusOutlined /> },
                                            { key: 'periods' as const, label: 'Target periods', detail: `${targetSummary.total} planned`, icon: <CalendarOutlined /> },
                                            { key: 'trail' as const, label: 'Revision trail', detail: `${targetAuditRows.length} entries`, icon: <HistoryOutlined /> }
                                        ].map(item => {
                                            const selected = targetModalSection === item.key
                                            return (
                                                <Button
                                                    key={item.key}
                                                    type={selected ? 'primary' : 'text'}
                                                    block
                                                    icon={item.icon}
                                                    onClick={() => setTargetModalSection(item.key)}
                                                    style={{ height: 52, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderRadius: 10 }}
                                                >
                                                    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
                                                        <span>{item.label}</span>
                                                        <span style={{ opacity: selected ? .78 : .55, fontSize: 11 }}>{item.detail}</span>
                                                    </span>
                                                </Button>
                                            )
                                        })}
                                    </Space>
                                </div>
                            </Col>
                            <Col xs={24} lg={18}>
                                {targetModalSection === 'plan' && <div>
                                    <Form form={targetForm} layout='vertical'>
                                        {editingCommittedTarget && (
                                            <Alert
                                                type='warning'
                                                showIcon
                                                style={{ marginBottom: 16 }}
                                                message={`Committed target: ${editingTarget?.target}`}
                                                description='Your revised value will be logged with your approval and reason. It will not overwrite the committed target used by standard performance reporting.'
                                            />
                                        )}
                                        <Form.Item name='periodType' hidden rules={[{ required: true, message: 'Select period type' }]}><Input /></Form.Item>
                                        <Text strong style={{ display: 'block', marginBottom: 10 }}>Reporting period</Text>
                                        <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
                                            {[
                                                { value: 'monthly' as TargetPeriodType, title: 'Monthly', detail: 'Set a target for one month.', icon: <CalendarOutlined style={{ color: '#1677ff' }} />, background: 'rgba(22,119,255,.12)' },
                                                { value: 'quarterly' as TargetPeriodType, title: 'Quarterly', detail: 'Set a target for one quarter.', icon: <BarChartOutlined style={{ color: '#722ed1' }} />, background: 'rgba(114,46,209,.12)' }
                                            ].map(option => {
                                                const selected = targetPeriodType === option.value
                                                const selectPeriodType = () => targetForm.setFieldsValue({ periodType: option.value, periodKey: defaultTargetPeriod(option.value) })
                                                return (
                                                    <Col xs={24} sm={12} key={option.value}>
                                                        <Card
                                                            hoverable={!editingCommittedTarget}
                                                            role='button'
                                                            tabIndex={editingCommittedTarget ? -1 : 0}
                                                            onClick={editingCommittedTarget ? undefined : selectPeriodType}
                                                            onKeyDown={event => {
                                                                if (editingCommittedTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                                                                event.preventDefault()
                                                                selectPeriodType()
                                                            }}
                                                            style={{ cursor: editingCommittedTarget ? 'not-allowed' : 'pointer', borderColor: selected ? token.colorPrimary : token.colorBorder, background: selected ? token.colorPrimaryBg : token.colorBgContainer, opacity: editingCommittedTarget && !selected ? .55 : 1 }}
                                                            bodyStyle={{ padding: '12px 14px' }}
                                                        >
                                                            <Space size={10}>
                                                                <IconChip size={34} bg={option.background} icon={option.icon} />
                                                                <div><Text strong style={{ display: 'block' }}>{option.title}</Text><Text type='secondary' style={{ fontSize: 12 }}>{option.detail}</Text></div>
                                                            </Space>
                                                        </Card>
                                                    </Col>
                                                )
                                            })}
                                        </Row>

                                        <Form.Item name='periodKey' label={`Which ${targetPeriodType === 'quarterly' ? 'quarter' : 'month'}?`} rules={[{ required: true, message: 'Select period' }]}>
                                            <DatePicker
                                                style={{ width: '100%' }}
                                                picker={targetPeriodType === 'quarterly' ? 'quarter' : 'month'}
                                                disabled={editingCommittedTarget}
                                                format={targetPeriodType === 'quarterly' ? '[Q]Q YYYY' : 'MMMM YYYY'}
                                                // Past periods are closed. The running one is open only while it has no target;
                                                // once set it is committed and changes go through Revise.
                                                disabledDate={current => {
                                                    if (!current) return false
                                                    const type: TargetPeriodType = targetPeriodType === 'quarterly' ? 'quarterly' : 'monthly'
                                                    const start = currentTargetPeriodStart(type)
                                                    if (current.isBefore(start, 'day')) return true
                                                    const isCurrent = buildPeriodKey(type, current) === buildPeriodKey(type, start)
                                                    return isCurrent && targetRows.some(r => r.periodType === type && r.periodKey === buildPeriodKey(type, start))
                                                }}
                                            />
                                        </Form.Item>

                                        <Form.Item name='target' label='Target' rules={[{ required: true, message: 'Enter target' }, { validator: (_rule, value) => Number(value) > 0 ? Promise.resolve() : Promise.reject(new Error('Target must be greater than zero')) }]}>
                                            <InputNumber min={1} style={{ width: '100%' }} />
                                        </Form.Item>

                                <div style={{ display: 'grid', gridTemplateColumns: editingTarget ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 10 }}>
                                    {editingTarget && (
                                        <Button shape='round' block danger onClick={cancelEditTarget} disabled={targetsSaving}>
                                            Cancel edit
                                        </Button>
                                    )}
                                    <Button shape='round' block type='primary' htmlType='button' onClick={handleSaveTargetFromDrawer} icon={<SaveOutlined />} loading={targetsSaving}>
                                        {editingCommittedTarget ? 'Record revision' : editingTarget ? 'Update target' : 'Save target'}
                                    </Button>
                                </div>

                                    </Form>
                                </div>}

                                {targetModalSection === 'periods' && (
                                    <Card title='Committed target periods' extra={<Text type='secondary'>Revise active or past periods</Text>} style={{ borderRadius: 14 }}>
                                        {targetsLoading ? (
                                            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                <Skeleton active paragraph={{ rows: 1 }} />
                                                <Skeleton active paragraph={{ rows: 1 }} />
                                            </Space>
                                        ) : !targetRows.length ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No target periods planned yet.' />
                                        ) : (
                                            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                                                {targetRows.map(row => {
                                                    const committed = targetPeriodHasStarted(row.periodType, row.periodKey)
                                                    const updated = row.updatedAt || row.createdAt
                                                    const updatedLabel = updated
                                                        ? (updated?.seconds ? dayjs.unix(updated.seconds) : dayjs(updated)).format('DD MMM YYYY')
                                                        : 'Not recorded'
                                                    return (
                                                <Card key={row.id} size='small' style={{ borderRadius: 12, borderColor: committed ? token.colorWarningBorder : token.colorPrimaryBorder, background: committed ? token.colorWarningBg : token.colorBgContainer }} bodyStyle={{ padding: '12px 14px' }}>
                                                            <Row gutter={[12, 10]} align='middle'>
                                                                <Col xs={24} sm={9}>
                                                                    <Space size={10}>
                                                                        <IconChip size={34} bg={committed ? 'rgba(250,173,20,.14)' : 'rgba(22,119,255,.12)'} icon={<CalendarOutlined style={{ color: committed ? '#d48806' : '#1677ff' }} />} />
                                                                        <div>
                                                                            <Text strong style={{ display: 'block' }}>{formatPeriodKey(row.periodKey)}</Text>
                                                                            <Text type='secondary' style={{ fontSize: 12 }}>{row.periodType === 'quarterly' ? 'Quarterly target' : 'Monthly target'}</Text>
                                                                        </div>
                                                                    </Space>
                                                                </Col>
                                                                <Col xs={12} sm={5}>
                                                                    <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>Committed target</Text>
                                                                    <Text strong style={{ fontSize: 18 }}>{row.target}</Text>
                                                                </Col>
                                                                <Col xs={12} sm={4}>
                                                                    <Tag color={committed ? 'gold' : 'blue'}>{committed ? 'Committed' : 'Future'}</Tag>
                                                                    <Text type='secondary' style={{ display: 'block', fontSize: 11, marginTop: 5 }}>{updatedLabel}</Text>
                                                                </Col>
                                                                <Col xs={24} sm={6} style={{ textAlign: 'right' }}>
                                                                    <Space size={6} wrap>
                                                                        <Button shape='round' size='small' icon={<EditOutlined />} onClick={() => startEditTarget(row)}>{committed ? 'Revise' : 'Edit'}</Button>
                                                                        {!committed && (
                                                                            <Popconfirm title='Delete future target?' description='This does not affect committed performance history.' okText='Delete' okButtonProps={{ danger: true, loading: targetsDeletingId === row.id }} onConfirm={() => handleDeleteTarget(row)}>
                                                                                <Button shape='round' size='small' danger icon={<DeleteOutlined />} loading={targetsDeletingId === row.id}>Delete</Button>
                                                                            </Popconfirm>
                                                                        )}
                                                                    </Space>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    )
                                                })}
                                            </Space>
                                        )}
                                    </Card>
                                )}

                                {targetModalSection === 'trail' && (
                                    <Card title='Change & revision trail' extra={<Tag color='purple'>{targetAuditRows.length}</Tag>} style={{ borderRadius: 14 }}>
                                        {targetsLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : !targetAuditRows.length ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No changes recorded yet.' />
                                        ) : (
                                            <div style={{ position: 'relative' }}>
                                                {targetAuditRows.map(row => {
                                                    const changedAt = row.changedAt
                                                    const dateLabel = changedAt ? (changedAt?.seconds ? dayjs.unix(changedAt.seconds) : dayjs(changedAt)).format('DD MMM YYYY, HH:mm') : 'Date not recorded'
                                                    const actionMeta = {
                                                        created: { label: 'Target created', color: '#52c41a', background: 'rgba(82,196,26,.12)', icon: <PlusOutlined /> },
                                                        updated: { label: 'Future target updated', color: '#1677ff', background: 'rgba(22,119,255,.12)', icon: <EditOutlined /> },
                                                        revised: { label: 'Committed target revised', color: '#722ed1', background: 'rgba(114,46,209,.12)', icon: <HistoryOutlined /> },
                                                        deleted: { label: 'Future target deleted', color: '#ff4d4f', background: 'rgba(255,77,79,.10)', icon: <DeleteOutlined /> }
                                                    }[row.action]
                                                    return (
                                                        <div key={row.id} style={{ display: 'flex', gap: 12, paddingBottom: 16, position: 'relative' }}>
                                                            <div style={{ width: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                                                <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: actionMeta.color, background: actionMeta.background }}>
                                                                    {actionMeta.icon}
                                                                </div>
                                                                <div style={{ width: 1, flex: 1, background: token.colorBorderSecondary, marginTop: 6, minHeight: 18, visibility: row === targetAuditRows[targetAuditRows.length - 1] ? 'hidden' : 'visible' }} />
                                                            </div>
                                                            <div style={{ minWidth: 0, flex: 1, paddingBottom: 2 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                                                    <Text strong>{actionMeta.label}</Text>
                                                                    <Text type='secondary' style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{dateLabel}</Text>
                                                                </div>
                                                                <Space size={8} wrap style={{ marginTop: 4 }}>
                                                                    <Tag color='blue'>{formatPeriodKey(row.periodKey)}</Tag>
                                                                    <Text type='secondary'>Target</Text>
                                                                    <Text delete={row.oldTarget !== null && row.oldTarget !== undefined}>{row.oldTarget ?? '—'}</Text>
                                                                    <Text strong style={{ color: actionMeta.color }}>→ {row.newTarget ?? '—'}</Text>
                                                                </Space>
                                                                <div style={{ marginTop: 8, padding: '7px 9px', borderRadius: 8, background: token.colorFillAlter }}>
                                                                    <Text type='secondary' style={{ fontSize: 12 }}>{row.changeReason || 'No note added'}</Text>
                                                                </div>
                                                                <Text type='secondary' style={{ display: 'block', fontSize: 11, marginTop: 6 }}>Recorded by {actorLabel(row.changedBy)}</Text>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </Card>
                                )}
                            </Col>
                        </Row>
                    </>
                )}
            </Modal>

            <KpiCreateModal
                open={kpiModal.open}
                editingKpi={kpiModal.kpi}
                onClose={() => setKpiModal({ open: false, kpi: null })}
                onSaved={() => {
                    void fetchKPIs()
                    void fetchInterventions()
                }}
                onManageTargets={kpi => {
                    setKpiModal({ open: false, kpi: null })
                    void openTargetsModal(kpi)
                }}
                departments={departments}
                interventions={interventions}
                uid={user?.uid || 'system'}
                userDepartmentId={user?.departmentId || null}
                userDepartmentName={user?.departmentName || null}
                canControlContributors={managesAllDepartments}
                canChooseDepartment={isMonitoringDept || hasRole(user?.departmentId, 'monitoring') || managesAllDepartments}
                activeProgramId={activeProgramId}
                isAllPrograms={isAllPrograms}
            />
        </div>
    )
}

export default KPIManager
