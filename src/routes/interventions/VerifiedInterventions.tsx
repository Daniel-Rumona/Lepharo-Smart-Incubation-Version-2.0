import React, { useEffect, useMemo, useState } from 'react'
import { Button, Col, Drawer, Empty, Grid, Input, Row, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    FileTextOutlined,
    HourglassOutlined,
    SafetyCertificateOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'
import { EntityAvatar } from '@/components/workspace'
import { chunk } from '@/types/mov'
import { filterMovRecords } from '@/utils/reportVisibility'
import { fmtDate, monthLabel, packItems, packStage, resolveMovCompletionDate, safeToDate, type Mov } from '@/routes/operations/movs/movData'
import { MovViewerModal } from './MovViewerModal'

const { Text } = Typography

/**
 * SMEs and the interventions they have received, counting only MOVs M&E has
 * validated (movDocuments.monitoringApproved, set when M&E validates the
 * monthly pack), beside what each SME still needs from their latest
 * developmental (diagnostic) plan.
 *
 * Scope: a department sees its own interventions; M&E, the project admin
 * (centre coordinator), directors and admins see every department and can
 * filter by one.
 */

type Received = {
    movId: string
    key: string
    title: string
    departmentId: string
    departmentName: string
    facilitator: string
    deliveredAt: Date | null
    verifiedAt: Date | null
    /** The MOV document itself, opened in the viewer. */
    mov: Mov
}

type Need = {
    key: string
    title: string
    departmentId: string
    departmentName: string
    /** Where its MOV is when it has been delivered but not yet validated; null when not started. */
    stage: string | null
    mov: Mov | null
}

type SmeRow = {
    participantId: string
    name: string
    contact: string
    received: Received[]
    needs: Need[]
}

const awaitingOf = (r: SmeRow) => r.needs.filter(n => n.stage).length
const notStartedOf = (r: SmeRow) => r.needs.filter(n => !n.stage).length

type Coverage = 'all' | 'outstanding' | 'served'

const clean = (v: unknown) => String(v ?? '').trim()
const lower = (v: unknown) => clean(v).toLowerCase()

const ALL_DEPARTMENT_ROLES = new Set(['projectadmin', 'director', 'system_admin', 'admin'])

/** "HSE (Health, Safety & Environment) and Labour Compliance" → "HSE"; the full name shows on hover. */
const shortDepartment = (name: string) => clean(name.split(' (')[0]) || name

const participantIdOf = (mov: any) => clean(mov?.participantId || mov?.beneficiaryId || mov?.smmeId)

/** One intervention's identity: its id when stored, otherwise its title. */
const interventionKey = (id: unknown, title: unknown) => (clean(id) ? `id:${clean(id)}` : lower(title) ? `title:${lower(title)}` : '')

/**
 * The SME's current developmental plan: this programme's latest, or a legacy
 * plan without a programme when the programme has none (as the plan builder
 * and the confirmed-plan page pick it).
 */
const latestPlanFor = (plans: any[], programId?: string) => {
    const inScope = plans.filter(p => !programId || !clean(p.programId) || clean(p.programId) === programId)
    const own = programId ? inScope.filter(p => clean(p.programId) === programId) : []
    const candidates = own.length ? own : inScope
    return candidates.reduce<any>((best, p) =>
        !best || (safeToDate(p.createdAt)?.getTime() || 0) >= (safeToDate(best.createdAt)?.getTime() || 0) ? p : best, null)
}

/**
 * Where a delivered but not yet validated MOV is, with a rank so the furthest
 * along wins when an intervention has several MOVs.
 */
const pendingStageOf = (mov: any, pack: any): { label: string; rank: number } => {
    if (pack) {
        const stage = packStage(pack)
        const month = monthLabel(pack.month, 'MMM YYYY')
        if (stage === 'me') return { label: `In the ${month} pack · with M&E`, rank: 6 }
        if (stage === 'cc') return { label: `In the ${month} pack · with the Center Coordinator`, rank: 5 }
        return { label: `In the ${month} pack`, rank: 5 }
    }
    if (mov?.approvedByHod === true) return { label: 'Approved by the HOD · not yet in a pack', rank: 4 }
    const status = lower(mov?.status)
    if (status === 'queried') return { label: 'Queried', rank: 3 }
    if (status === 'awaiting_smme') return { label: 'Awaiting the SME’s sign-off', rank: 1 }
    return { label: 'With the HOD', rank: 2 }
}

const VerifiedInterventions: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { hasRole, nameOf, loading: rolesLoading } = useDepartmentRoles()

    const role = lower((user as any)?.role)
    const ownDepartmentId = clean((user as any)?.departmentId)
    const seesAll = ALL_DEPARTMENT_ROLES.has(role) || (role === 'operations' && hasRole(ownDepartmentId, 'monitoring'))
    const scopeDepartmentId = seesAll ? '' : ownDepartmentId

    const [rows, setRows] = useState<SmeRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [department, setDepartment] = useState('all')
    const [coverage, setCoverage] = useState<Coverage>('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [viewingMov, setViewingMov] = useState<Mov | null>(null)
    const isPhone = !Grid.useBreakpoint().md

    useEffect(() => {
        if (!user || rolesLoading) return
        // A department user without a department has nothing of their own to show.
        if (!seesAll && !scopeDepartmentId) {
            setRows([])
            setLoading(false)
            return
        }
        let cancelled = false
        const load = async () => {
            setLoading(true)
            const filters = [where('monitoringApproved', '==', true)]
            if (scopeDepartmentId) filters.push(where('departmentId', '==', scopeDepartmentId))
            if (activeProgramId) filters.push(where('programId', '==', activeProgramId))
            const snap = await getDocs(query(collection(db, 'movDocuments'), ...filters))
            const movs = filterMovRecords(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })), (user as any)?.email)

            const bySme = new Map<string, SmeRow>()
            movs.forEach((mov: any) => {
                const pid = participantIdOf(mov)
                if (!pid) return
                const row = bySme.get(pid) || {
                    participantId: pid,
                    name: clean(mov.smmeCompanyName) || clean(mov.smmeName) || 'Unnamed SME',
                    contact: clean(mov.smmeName),
                    received: [],
                    needs: []
                }
                const departmentId = clean(mov.departmentId)
                row.received.push({
                    movId: mov.id,
                    key: interventionKey(mov.interventionId, mov.interventionTitle),
                    title: clean(mov.interventionTitle) || 'Untitled intervention',
                    departmentId,
                    departmentName: nameOf(departmentId, clean(mov.departmentName) || '—'),
                    facilitator: clean(mov.facilitatorName),
                    deliveredAt: resolveMovCompletionDate(mov),
                    verifiedAt: safeToDate(mov.monitoringApprovedAt || mov.monitoringValidation?.validatedAt),
                    mov
                })
                bySme.set(pid, row)
            })

            // What each SME still needs: the interventions on their developmental
            // (diagnostic) plan not yet received with an M&E-validated MOV.
            const ids = Array.from(bySme.keys())
            const planSnaps = await Promise.all(
                chunk(ids, 30).map(group => getDocs(query(collection(db, 'diagnosticPlans'), where('participantId', 'in', group))).catch(() => null))
            )
            const requiredBySme = new Map<string, any[]>()
            const plansBySme = new Map<string, any[]>()
            planSnaps.forEach(s => s?.docs.forEach(d => {
                const plan = d.data() as any
                const pid = clean(plan.participantId)
                if (pid) plansBySme.set(pid, [...(plansBySme.get(pid) || []), plan])
            }))
            plansBySme.forEach((plans, pid) => {
                const plan = latestPlanFor(plans, activeProgramId)
                if (plan && Array.isArray(plan.interventions)) requiredBySme.set(pid, plan.interventions)
            })

            // Delivered but not yet validated: the SMEs' other MOVs (any status
            // short of M&E validation, except rejected), and the packs they sit in.
            const pendingSnaps = await Promise.all(
                chunk(ids, 30).flatMap(group => ['participantId', 'smmeId'].map(field =>
                    getDocs(query(collection(db, 'movDocuments'), where(field, 'in', group))).catch(() => null)
                ))
            )
            const pendingById = new Map<string, any>()
            pendingSnaps.forEach(s => s?.docs.forEach(d => {
                const mov = { id: d.id, ...(d.data() as any) }
                if (mov.monitoringApproved === true || lower(mov.status) === 'rejected') return
                if (activeProgramId && clean(mov.programId) && clean(mov.programId) !== activeProgramId) return
                if (scopeDepartmentId && clean(mov.departmentId) !== scopeDepartmentId) return
                pendingById.set(d.id, mov)
            }))
            const packFilters = []
            if (scopeDepartmentId) packFilters.push(where('departmentId', '==', scopeDepartmentId))
            if (activeProgramId) packFilters.push(where('programId', '==', activeProgramId))
            const packSnap = await getDocs(query(collection(db, 'consolidatedMOVs'), ...packFilters)).catch(() => null)
            const packOfMov = new Map<string, any>()
            packSnap?.docs.forEach(d => {
                const pack = { id: d.id, ...(d.data() as any) }
                const movIds = [...(Array.isArray(pack.movIds) ? pack.movIds : []), ...packItems(pack).map((m: any) => m?.id)]
                movIds.forEach((id: any) => id && packOfMov.set(String(id), pack))
            })
            // Per SME and intervention key / title: the furthest-along pending MOV.
            const pendingBySme = new Map<string, Map<string, { label: string; rank: number; mov: Mov }>>()
            pendingById.forEach(mov => {
                const pid = participantIdOf(mov)
                const stage = pendingStageOf(mov, packOfMov.get(mov.id))
                const byKey = pendingBySme.get(pid) || new Map()
                ;[interventionKey(mov.interventionId, mov.interventionTitle), `title:${lower(mov.interventionTitle)}`].forEach(k => {
                    if (!k || k === 'title:') return
                    const prev = byKey.get(k)
                    if (!prev || stage.rank > prev.rank) byKey.set(k, { ...stage, mov })
                })
                pendingBySme.set(pid, byKey)
            })

            bySme.forEach((row, pid) => {
                const receivedKeys = new Set(row.received.map(r => r.key))
                const receivedTitles = new Set(row.received.map(r => lower(r.title)))
                const pending = pendingBySme.get(pid)
                const seen = new Set<string>()
                row.needs = (requiredBySme.get(pid) || [])
                    .map((item: any): Need => {
                        const departmentId = clean(item?.departmentId)
                        const key = interventionKey(item?.id || item?.interventionId, item?.title || item?.interventionTitle || item?.name)
                        const title = clean(item?.title || item?.interventionTitle || item?.name) || 'Untitled intervention'
                        const found = pending?.get(key) || pending?.get(`title:${lower(title)}`)
                        return {
                            key,
                            title,
                            departmentId,
                            departmentName: nameOf(departmentId, clean(item?.departmentName || item?.area) || '—'),
                            stage: found?.label || null,
                            mov: found?.mov || null
                        }
                    })
                    .filter(need => {
                        if (!need.key || seen.has(need.key)) return false
                        seen.add(need.key)
                        if (scopeDepartmentId && need.departmentId !== scopeDepartmentId) return false
                        return !receivedKeys.has(need.key) && !receivedTitles.has(lower(need.title))
                    })
                    // Awaiting validation first, then not started.
                    .sort((a, b) => Number(!a.stage) - Number(!b.stage))
                row.received.sort((a, b) => (b.verifiedAt?.getTime() || 0) - (a.verifiedAt?.getTime() || 0))
            })

            if (!cancelled) setRows(Array.from(bySme.values()).sort((a, b) => a.name.localeCompare(b.name)))
        }
        load()
            .catch(error => {
                console.error('[Verified interventions] Failed to load', error)
                if (!cancelled) setRows([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [user, rolesLoading, seesAll, scopeDepartmentId, activeProgramId]) // eslint-disable-line react-hooks/exhaustive-deps

    const departmentOptions = useMemo(() => {
        const names = new Map<string, string>()
        rows.forEach(r => r.received.forEach(i => i.departmentId && names.set(i.departmentId, i.departmentName)))
        return Array.from(names, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
    }, [rows])

    // The department filter narrows each SME to that department's interventions and needs.
    const scoped = useMemo<SmeRow[]>(() => {
        if (department === 'all') return rows
        return rows
            .map(r => ({
                ...r,
                received: r.received.filter(i => i.departmentId === department),
                needs: r.needs.filter(n => n.departmentId === department)
            }))
            .filter(r => r.received.length > 0)
    }, [rows, department])

    const visible = useMemo(() => {
        const q = lower(search)
        return scoped.filter(r => {
            if (coverage === 'outstanding' && !r.needs.length) return false
            if (coverage === 'served' && r.needs.length) return false
            if (!q) return true
            return [r.name, r.contact, ...r.received.map(i => i.title), ...r.needs.map(n => n.title)].some(v => lower(v).includes(q))
        })
    }, [scoped, search, coverage])

    const totals = useMemo(() => ({
        smes: scoped.length,
        received: scoped.reduce((n, r) => n + r.received.length, 0),
        outstanding: scoped.filter(r => r.needs.length).length,
        awaiting: scoped.reduce((n, r) => n + awaitingOf(r), 0),
        notStarted: scoped.reduce((n, r) => n + notStartedOf(r), 0)
    }), [scoped])

    const metrics: DashboardMetric[] = [
        { key: 'smes', title: 'SMEs', value: totals.smes, subtitle: 'With validated MOVs', icon: <TeamOutlined />, tone: 'info', important: true },
        { key: 'received', title: 'Interventions received', value: totals.received, subtitle: 'Validated', icon: <SafetyCertificateOutlined />, tone: 'success', important: true },
        { key: 'outstanding', title: 'Still need support', value: totals.outstanding, subtitle: `${totals.awaiting} awaiting validation · ${totals.notStarted} not started`, icon: <ExclamationCircleOutlined />, tone: 'warning' },
        { key: 'served', title: 'Fully served', value: totals.smes - totals.outstanding, subtitle: 'Every required intervention received', icon: <CheckCircleOutlined />, tone: 'success' }
    ]

    const columns: ColumnsType<SmeRow> = [
        {
            title: 'SME',
            key: 'sme',
            render: (_, r) => (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                    <EntityAvatar name={r.name} size={32} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <Text strong ellipsis={{ tooltip: r.name }} style={{ display: 'block' }}>{r.name}</Text>
                        {r.contact && r.contact !== r.name && (
                            <Text type='secondary' ellipsis style={{ fontSize: 12, display: 'block' }}>{r.contact}</Text>
                        )}
                    </div>
                </div>
            )
        },
        {
            title: 'Departments',
            key: 'departments',
            width: '30%',
            responsive: ['md'],
            render: (_, r) => (
                <Space size={[4, 4]} wrap>
                    {Array.from(new Set(r.received.map(i => i.departmentName))).map(name => (
                        <Tooltip key={name} title={shortDepartment(name) !== name ? name : undefined}>
                            <Tag style={{ marginInlineEnd: 0 }}>{shortDepartment(name)}</Tag>
                        </Tooltip>
                    ))}
                </Space>
            )
        },
        {
            title: 'Received',
            key: 'received',
            align: 'center',
            width: 100,
            sorter: (a, b) => a.received.length - b.received.length,
            render: (_, r) => <Tag color='green' style={{ marginInlineEnd: 0 }}>{r.received.length}</Tag>
        },
        {
            title: 'Awaiting validation',
            key: 'awaiting',
            align: 'center',
            width: 120,
            sorter: (a, b) => awaitingOf(a) - awaitingOf(b),
            render: (_, r) => (awaitingOf(r) ? <Tag color='blue' style={{ marginInlineEnd: 0 }}>{awaitingOf(r)}</Tag> : <Text type='secondary'>None</Text>)
        },
        {
            title: 'Not started',
            key: 'notStarted',
            align: 'center',
            width: 110,
            sorter: (a, b) => notStartedOf(a) - notStartedOf(b),
            render: (_, r) => (notStartedOf(r) ? <Tag color='orange' style={{ marginInlineEnd: 0 }}>{notStartedOf(r)}</Tag> : <Text type='secondary'>None</Text>)
        },
        {
            title: 'Last validated',
            key: 'last',
            width: 130,
            responsive: ['sm'],
            sorter: (a, b) => (a.received[0]?.verifiedAt?.getTime() || 0) - (b.received[0]?.verifiedAt?.getTime() || 0),
            render: (_, r) => fmtDate(r.received[0]?.verifiedAt)
        }
    ]

    // Looked up from the filtered list so the drawer follows the department filter.
    const selected = useMemo(() => scoped.find(r => r.participantId === selectedId) || null, [scoped, selectedId])

    const details = (r: SmeRow) => (
        <Space direction='vertical' size={24} style={{ width: '100%' }}>
            <div>
                <Text strong>Received ({r.received.length}) · Validated</Text>
                <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                    {r.received.map(i => (
                        <div key={i.movId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <CheckCircleOutlined style={{ color: 'var(--ant-color-success, #52c41a)', marginTop: 4 }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div>{i.title}</div>
                                <Text type='secondary' style={{ fontSize: 12 }}>
                                    {[i.departmentName, i.facilitator, i.deliveredAt && `Delivered ${fmtDate(i.deliveredAt)}`, i.verifiedAt && `Validated ${fmtDate(i.verifiedAt)}`].filter(Boolean).join(' · ')}
                                </Text>
                            </div>
                            <Button size='small' icon={<FileTextOutlined />} onClick={() => setViewingMov(i.mov)}>
                                MOV
                            </Button>
                        </div>
                    ))}
                </div>
            </div>
            <div>
                <Text strong>Awaiting validation ({awaitingOf(r)})</Text>
                <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                    {awaitingOf(r) ? r.needs.filter(n => n.stage).map(n => (
                        <div key={n.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <HourglassOutlined style={{ color: 'var(--ant-color-primary, #1677ff)', marginTop: 4 }} />
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div>{n.title}</div>
                                <Text type='secondary' style={{ fontSize: 12 }}>{[n.departmentName, n.stage].join(' · ')}</Text>
                            </div>
                            {n.mov && (
                                <Button size='small' icon={<FileTextOutlined />} onClick={() => setViewingMov(n.mov)}>
                                    MOV
                                </Button>
                            )}
                        </div>
                    )) : <Text type='secondary'>Nothing delivered is waiting on validation.</Text>}
                </div>
            </div>
            <div>
                <Text strong>Not started ({notStartedOf(r)})</Text>
                <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                    {notStartedOf(r) ? r.needs.filter(n => !n.stage).map(n => (
                        <div key={n.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <ExclamationCircleOutlined style={{ color: 'var(--ant-color-warning, #faad14)', marginTop: 4 }} />
                            <div style={{ minWidth: 0 }}>
                                <div>{n.title}</div>
                                <Text type='secondary' style={{ fontSize: 12 }}>{n.departmentName}</Text>
                            </div>
                        </div>
                    )) : <Text type='secondary'>Every intervention on the developmental plan has been delivered.</Text>}
                </div>
            </div>
        </Space>
    )

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Helmet>
                <title>Database | Smart Incubation</title>
                <meta name='description' content='SMEs, the interventions M&E has validated for them, and what they still need.' />
            </Helmet>

            <div style={{ marginBottom: 16 }}>
                <MetricsGrid metrics={metrics} />
            </div>

            <MotionCard
                filterBar={
                    <Row gutter={[12, 12]} align='middle' wrap>
                        <Col flex='auto' style={{ minWidth: 220 }}>
                            <Input.Search allowClear placeholder='Search SME or intervention' value={search} onChange={e => setSearch(e.target.value)} />
                        </Col>
                        {seesAll && (
                            <Col flex='none' style={{ minWidth: 200 }}>
                                <Select
                                    value={department}
                                    onChange={setDepartment}
                                    style={{ width: '100%', minWidth: 200 }}
                                    showSearch
                                    optionFilterProp='label'
                                    options={[{ value: 'all', label: 'All departments' }, ...departmentOptions]}
                                />
                            </Col>
                        )}
                        <Col flex='none' style={{ maxWidth: '100%', overflowX: 'auto' }}>
                            <Segmented
                                value={coverage}
                                onChange={v => setCoverage(v as Coverage)}
                                options={[
                                    { value: 'all', label: 'All' },
                                    { value: 'outstanding', label: 'Still need support' },
                                    { value: 'served', label: 'Fully served' }
                                ]}
                            />
                        </Col>
                    </Row>
                }
            >
                <Table<SmeRow>
                    rowKey='participantId'
                    loading={loading}
                    columns={columns}
                    dataSource={visible}
                    onRow={r => ({ onClick: () => setSelectedId(r.participantId), style: { cursor: 'pointer' } })}
                    pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
                    size='middle'
                    tableLayout='fixed'
                    locale={{
                        emptyText: (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <Space direction='vertical' size={2}>
                                        <Text strong>{search || coverage !== 'all' ? 'No matches' : 'No validated interventions yet'}</Text>
                                        <Text type='secondary'>
                                            {search || coverage !== 'all'
                                                ? 'Try a different search or filter.'
                                                : 'SMEs appear here once M&E validates the monthly pack holding their MOVs.'}
                                        </Text>
                                    </Space>
                                }
                            />
                        )
                    }}
                />
            </MotionCard>

            <Drawer
                open={!!selected}
                onClose={() => setSelectedId(null)}
                width={isPhone ? '100%' : 560}
                destroyOnClose
                title={selected && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <EntityAvatar name={selected.name} size={36} />
                        <div style={{ minWidth: 0 }}>
                            <Text strong ellipsis style={{ display: 'block' }}>{selected.name}</Text>
                            {selected.contact && selected.contact !== selected.name && (
                                <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>{selected.contact}</Text>
                            )}
                        </div>
                    </div>
                )}
            >
                {selected && details(selected)}
            </Drawer>

            <MovViewerModal mov={viewingMov} activeProgramId={activeProgramId} onClose={() => setViewingMov(null)} />
        </div>
    )
}

export default VerifiedInterventions
