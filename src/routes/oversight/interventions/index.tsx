import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Col, Drawer, Empty, Input, Result, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    AlertOutlined,
    AppstoreOutlined,
    CarryOutOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DashboardOutlined,
    FileProtectOutlined,
    FundProjectionScreenOutlined,
    ReloadOutlined,
    SearchOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { Link, useLocation } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DepartmentRoleKey, useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard, DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { buildTowerModel, rollUpByDepartment, type CoverageRow, type StuckItem } from '@/services/interventionTower'
import { useTowerData, type TowerData } from './useTowerData'
import { BLUE, BarList, StackedBars, useChartInk } from './charts'
import { StuckDetailModal } from './StuckDetailModal'
import { ACCENT, CoverageCard, IconChip, StuckRow, pct, severityColor } from './cards'

const { Text, Title } = Typography

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/**
 * ROM (account managers) and M&E see every department; project admins see
 * their own centre. Everyone else has no business here.
 */
export type Access = { allowed: boolean; scope: 'programme' | 'centre'; branchId: string }
function resolveAccess(user: any, departmentRole: DepartmentRoleKey | null): Access {
    const role = norm(user?.role)
    if (role === 'system_admin') return { allowed: true, scope: 'programme', branchId: '' }
    if (role === 'projectadmin') return { allowed: true, scope: 'centre', branchId: String(user?.assignedBranch || '') }
    if (role === 'operations' && (departmentRole === 'rom' || departmentRole === 'monitoring')) {
        return { allowed: true, scope: 'programme', branchId: '' }
    }
    return { allowed: false, scope: 'programme', branchId: '' }
}

/** Rows with no branch recorded stay visible, matching the project admin dashboard. */
const inBranch = (branchId: string, itemBranch: string) => !branchId || !itemBranch || itemBranch === branchId

type View = 'overview' | 'stuck' | 'coverage'
type Kind = 'all' | 'delivery' | 'evidence'

/** Small inline label at the top of a panel body - no header bar, so panels stay short. */
const PanelLabel: React.FC<{ icon: React.ReactNode; title: string; hint?: string; extra?: React.ReactNode }> = ({ icon, title, hint, extra }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <Space size={8} align="center">
            <span style={{ display: 'inline-flex', color: BLUE[450] }}>{icon}</span>
            <Text strong>{title}</Text>
            {hint && <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>}
        </Space>
        {extra}
    </div>
)

export default function InterventionsControlTower() {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { roleOf, nameOf } = useDepartmentRoles()
    const departmentRole = roleOf(user?.departmentId)
    const access = useMemo(() => resolveAccess(user, departmentRole), [user, departmentRole])
    const data = useTowerData(access.allowed ? activeProgramId : null)
    return <ControlTowerView access={access} data={data} nameOf={nameOf} />
}

/** Presentation only - everything it needs arrives as props, so it can be rendered with sample data. */
export function ControlTowerView({ access, data, nameOf }: { access: Access; data: TowerData; nameOf?: (departmentId: string) => string }) {
    const ink = useChartInk()
    const location = useLocation()

    const [view, setView] = useState<View>('overview')
    const [kind, setKind] = useState<Kind>('all')
    const [department, setDepartment] = useState<string>('all')
    const [owner, setOwner] = useState<string>('all')
    const [search, setSearch] = useState('')
    const [drill, setDrill] = useState<string | null>(null)
    const [detail, setDetail] = useState<StuckItem | null>(null)

    // One clock for every model, so "days waiting" can never differ between views (it ticks once a minute and resets on refresh).
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        setNow(Date.now())
    }, [data.loadedAt])
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000)
        return () => window.clearInterval(timer)
    }, [])

    const scoped = useMemo(() => {
        const keep = (row: Record<string, any>) => inBranch(access.branchId, String(row.branchId || row.assignedBranch || ''))
        return { assignments: data.assignments.filter(keep), movs: data.movs.filter(keep), packs: data.packs }
    }, [data.assignments, data.movs, data.packs, access.branchId])

    // Unfiltered model feeds the department dropdown; the filtered one feeds everything on screen.
    const fullModel = useMemo(() => buildTowerModel({ ...scoped, now, nameOf }), [scoped, now, nameOf])
    const departments = useMemo(() => {
        const byId = new Map<string, string>()
        fullModel.coverage.forEach(row => {
            if (row.departmentId && !byId.has(row.departmentId)) byId.set(row.departmentId, row.departmentName)
        })
        return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
    }, [fullModel.coverage])
    const model = useMemo(() => {
        if (department === 'all') return fullModel
        const byDept = (row: Record<string, any>) => String(row.departmentId || '').trim() === department
        return buildTowerModel({
            assignments: scoped.assignments.filter(byDept),
            movs: scoped.movs.filter(byDept),
            packs: scoped.packs,
            now,
            nameOf
        })
    }, [fullModel, scoped, department, now, nameOf])

    const owners = useMemo(() => Array.from(new Set(model.stuck.map(item => item.owner))).sort(), [model.stuck])

    const stuck = useMemo(() => {
        const needle = norm(search)
        return model.stuck.filter(item => {
            if (kind !== 'all' && item.kind !== kind) return false
            if (owner !== 'all' && item.owner !== owner) return false
            if (!needle) return true
            return [item.participantName, item.interventionTitle, item.assigneeName, item.reason].some(v => norm(v).includes(needle))
        })
    }, [model.stuck, kind, owner, search])

    const departmentRows = useMemo(
        () => rollUpByDepartment(model.coverage).sort((a, b) => b.stuck - a.stuck || a.departmentName.localeCompare(b.departmentName)),
        [model.coverage]
    )

    const completion = useMemo(() => {
        const assigned = departmentRows.reduce((sum, row) => sum + row.summary.assigned, 0)
        const completed = departmentRows.reduce((sum, row) => sum + row.summary.completed, 0)
        return { assigned, completed, rate: pct(completed, assigned) }
    }, [departmentRows])

    const ageBuckets = useMemo(() => {
        const buckets = [
            { label: 'Under 3 days', min: 0, max: 2, color: BLUE[250] },
            { label: '3-6 days', min: 3, max: 6, color: BLUE[350] },
            { label: '1-2 weeks', min: 7, max: 13, color: BLUE[450] },
            { label: '2-4 weeks', min: 14, max: 29, color: BLUE[500] },
            { label: 'Over a month', min: 30, max: Infinity, color: BLUE[600] }
        ]
        return buckets.map(b => ({ label: b.label, color: b.color, value: model.stuck.filter(i => i.days >= b.min && i.days <= b.max).length }))
    }, [model.stuck])

    const ownerBars = useMemo(() => {
        const counts = new Map<string, number>()
        model.stuck.forEach(item => counts.set(item.owner, (counts.get(item.owner) ?? 0) + 1))
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, color: BLUE[450] }))
    }, [model.stuck])

    const funnelBars = useMemo(() => {
        const steps = [BLUE[250], BLUE[300], BLUE[400], BLUE[450], BLUE[550], BLUE[600]]
        return model.pipeline.map((step, index) => ({ label: step.label, value: step.count, color: steps[index] }))
    }, [model.pipeline])

    const deliveryStack = useMemo(() => {
        const rows = departmentRows.filter(row => row.summary.assigned > 0)
        return {
            categories: rows.map(row => row.departmentName),
            series: [
                { name: 'Completed', color: BLUE[450], values: rows.map(row => row.summary.completed) },
                { name: 'In progress', color: '#eb6834', values: rows.map(row => Math.max(0, row.summary.assigned - row.summary.completed)) }
            ]
        }
    }, [departmentRows])

    const drillRow = useMemo(() => departmentRows.find(row => row.departmentId === drill) ?? null, [departmentRows, drill])
    const drillInterventions = useMemo(
        () => (drill ? model.coverage.filter(row => row.departmentId === drill).sort((a, b) => b.stuck - a.stuck) : []),
        [model.coverage, drill]
    )
    const drillStuck = useMemo(() => (drill ? model.stuck.filter(item => item.departmentId === drill) : []), [model.stuck, drill])

    if (!access.allowed) {
        return <Result status="403" title="Not available" subTitle="The Interventions Control Tower is for ROM, M&E and project admins." />
    }

    const openStuck = (nextKind: Kind) => {
        setKind(nextKind)
        setOwner('all')
        setSearch('')
        setView('stuck')
    }

    const loading = data.loading && !data.loadedAt

    const stuckColumns: ColumnsType<StuckItem> = [
        {
            title: 'Waiting',
            dataIndex: 'days',
            width: 110,
            sorter: (a, b) => a.severity - b.severity,
            defaultSortOrder: 'descend',
            render: (_, item) => (
                <Tag bordered={false} color={severityColor(item.severity)} icon={<ClockCircleOutlined />} style={{ borderRadius: 999 }}>
                    {item.days} day{item.days === 1 ? '' : 's'}
                </Tag>
            )
        },
        {
            title: 'What',
            dataIndex: 'reason',
            render: (_, item) => (
                <Space direction="vertical" size={0}>
                    <Text strong>{item.reason}</Text>
                    <Text type="secondary">{item.interventionTitle}</Text>
                </Space>
            )
        },
        { title: 'Participant', dataIndex: 'participantName' },
        { title: 'Department', dataIndex: 'departmentName', width: 180 },
        { title: 'Facilitator', dataIndex: 'assigneeName', width: 160, render: v => v || <Text type="secondary">-</Text> },
        { title: 'Next action by', dataIndex: 'owner', width: 140, render: v => <Tag bordered={false} style={{ borderRadius: 999 }}>{v}</Tag> },
        {
            title: '',
            key: 'open',
            width: 80,
            render: (_, item) => (
                <Button type="link" size="small" onClick={() => setDetail(item)}>
                    Details
                </Button>
            )
        }
    ]

    const metrics = [
        {
            title: 'Interventions tracked',
            value: model.totals.assignments,
            icon: <FundProjectionScreenOutlined style={{ fontSize: 18 }} />,
            tone: 'accent' as const,
            subtitle: `${completion.rate}% completed (${completion.completed} of ${completion.assigned})`,
            onClick: () => setView('coverage')
        },
        {
            title: 'Stuck now',
            value: model.totals.stuck,
            icon: <AlertOutlined style={{ fontSize: 18 }} />,
            tone: 'danger' as const,
            subtitle: model.totals.stuck ? `${pct(model.totals.stuck, Math.max(1, model.totals.assignments))}% of tracked - open the queue` : 'Everything is moving',
            onClick: () => openStuck('all')
        },
        {
            title: 'Delivery blocked',
            value: model.totals.stuckDelivery,
            icon: <CarryOutOutlined style={{ fontSize: 18 }} />,
            tone: 'warning' as const,
            subtitle: `${model.totals.unassigned} without a facilitator`,
            onClick: () => openStuck('delivery')
        },
        {
            title: 'Evidence blocked',
            value: model.totals.stuckEvidence,
            icon: <FileProtectOutlined style={{ fontSize: 18 }} />,
            tone: 'info' as const,
            subtitle: 'MOVs waiting on a sign-off',
            onClick: () => openStuck('evidence')
        }
    ]

    const overview = (
        <>
            {/* MotionCard wraps its card in a div, so equal heights need the wrapper and the card to stretch. */}
            <style>{`.tower-equal > div, .tower-equal > div > .ant-card { height: 100%; }`}</style>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                <Col xs={24} lg={10} className="tower-equal">
                    <MotionCard loading={loading} skeleton="list">
                        <PanelLabel icon={<FileProtectOutlined />} title="MOV evidence chain" hint="open items per step" />
                        <BarList ink={ink} data={funnelBars} empty="No open MOVs" />
                    </MotionCard>
                </Col>
                <Col xs={24} lg={7} className="tower-equal">
                    <MotionCard loading={loading} skeleton="list">
                        <PanelLabel icon={<WarningOutlined />} title="Waiting on" hint="by owner" />
                        <BarList ink={ink} data={ownerBars} empty="Nothing waiting" />
                    </MotionCard>
                </Col>
                <Col xs={24} lg={7} className="tower-equal">
                    <MotionCard loading={loading} skeleton="list">
                        <PanelLabel icon={<ClockCircleOutlined />} title="How long" hint="by wait" />
                        <BarList ink={ink} data={ageBuckets} empty="Nothing waiting" />
                    </MotionCard>
                </Col>
            </Row>
            {model.totals.unrecognisedMovs > 0 && <Alert type="warning" showIcon message={`${model.totals.unrecognisedMovs} ${model.totals.unrecognisedMovs === 1 ? 'MOV has' : 'MOVs have'} a missing or unrecognised status`} description="A MOV is created awaiting the SME when the facilitator completes the intervention, so every MOV should have a real status. These are left out of the counts and the stuck queue until the data is corrected." />}
            <Row gutter={[12, 12]}>
                <Col xs={24} lg={13} className="tower-equal">
                    <MotionCard loading={loading} skeleton="list">
                        <PanelLabel
                            icon={<AlertOutlined />}
                            title="Needs attention first"
                            extra={<Button type="link" size="small" onClick={() => openStuck('all')}>View all {model.totals.stuck}</Button>}
                        />
                        {model.stuck.length ? (
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                {model.stuck.slice(0, 6).map(item => (
                                    <StuckRow key={item.id} item={item} onClick={() => setDetail(item)} />
                                ))}
                            </Space>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing is stuck. Delivery and evidence are moving." />
                        )}
                    </MotionCard>
                </Col>
                <Col xs={24} lg={11} className="tower-equal">
                    <MotionCard loading={loading} skeleton="chart">
                        <PanelLabel
                            icon={<CheckCircleOutlined />}
                            title="Delivery by department"
                            extra={<Button type="link" size="small" onClick={() => setView('coverage')}>Coverage</Button>}
                        />
                        {deliveryStack.categories.length ? (
                            <StackedBars ink={ink} categories={deliveryStack.categories} series={deliveryStack.series} />
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No assignments yet" />
                        )}
                    </MotionCard>
                </Col>
            </Row>
        </>
    )

    const stuckView = (
        <MotionCard
            loading={loading}
            skeleton="table"
            filterBar={
                <Row gutter={[12, 8]} align="middle" style={{ width: '100%' }}>
                    <Col flex="0 0 auto">
                        <Segmented
                            value={kind}
                            onChange={value => setKind(value as Kind)}
                            options={[
                                { label: 'All', value: 'all', icon: <AppstoreOutlined /> },
                                { label: 'Delivery', value: 'delivery', icon: <CarryOutOutlined /> },
                                { label: 'Evidence', value: 'evidence', icon: <FileProtectOutlined /> }
                            ]}
                        />
                    </Col>
                    <Col flex="0 0 auto">
                        <Select
                            value={owner}
                            onChange={setOwner}
                            style={{ width: 170 }}
                            options={[{ label: 'Anyone', value: 'all' }, ...owners.map(o => ({ label: o, value: o }))]}
                        />
                    </Col>
                    <Col flex="1 1 260px">
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="Search participant, intervention, facilitator"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </Col>
                </Row>
            }
        >
            <Table
                rowKey="id"
                size="middle"
                columns={stuckColumns}
                dataSource={stuck}
                pagination={{ pageSize: 25, showSizeChanger: false, position: ['bottomCenter'] }}
                locale={{ emptyText: <Empty description="Nothing is stuck. Delivery and evidence are moving." /> }}
                scroll={{ x: 900 }}
            />
        </MotionCard>
    )

    const coverageView = departmentRows.length ? (
        <Row gutter={[12, 12]}>
            {departmentRows.map(row => (
                <Col key={row.key} xs={24} md={12} xl={8} style={{ display: 'flex' }}>
                    <CoverageCard
                        row={row}
                        ink={ink}
                        title={row.departmentName}
                        subtitle={`${model.coverage.filter(r => r.departmentId === row.departmentId).length} interventions`}
                        onClick={() => setDrill(row.departmentId)}
                    />
                </Col>
            ))}
        </Row>
    ) : (
        <MotionCard><Empty description="No interventions recorded for this programme." /></MotionCard>
    )

    return (
        <div style={{ padding: '6px 24px', flex: 1, minHeight: 0 }}>
            <Helmet>
                <title>Interventions Control Tower | Incubation Platform</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {metrics.map(metric => (
                    <Col xs={12} lg={6} key={metric.title}>
                        <MetricTile loading={loading} {...metric} />
                    </Col>
                ))}
            </Row>

            <DashboardFilterBar marginBottom={16}>
                <Row gutter={[12, 8]} align="middle" justify="space-between" wrap style={{ width: '100%' }}>
                    <Col flex="1 1 360px">
                        <Segmented
                            block
                            value={view}
                            onChange={value => setView(value as View)}
                            options={[
                                { label: 'Overview', value: 'overview', icon: <DashboardOutlined /> },
                                { label: `Stuck queue (${model.stuck.length})`, value: 'stuck', icon: <AlertOutlined /> },
                                { label: 'Coverage', value: 'coverage', icon: <AppstoreOutlined /> }
                            ]}
                        />
                    </Col>
                    <Col flex="0 0 auto">
                        <Space wrap>
                            <Link to={`${location.pathname.startsWith('/projectadmin') ? '/projectadmin' : '/operations'}/digital-twin?${new URLSearchParams({...(access.branchId ? {branch:access.branchId} : {}), department}).toString()}`}>
                                <Button icon={<FundProjectionScreenOutlined />}>Open Intervention Twin</Button>
                            </Link>
                            <Select
                                value={department}
                                onChange={setDepartment}
                                style={{ width: 220 }}
                                options={[{ label: 'All departments', value: 'all' }, ...departments]}
                            />
                            <Button icon={<ReloadOutlined />} loading={data.loading} onClick={data.reload}>
                                Refresh
                            </Button>
                        </Space>
                    </Col>
                </Row>
            </DashboardFilterBar>

            {data.error && <Result status="warning" title={data.error} style={{ padding: 16 }} />}

            {view === 'overview' && overview}
            {view === 'stuck' && stuckView}
            {view === 'coverage' && coverageView}

            <StuckDetailModal item={detail} onClose={() => setDetail(null)} />

            <Drawer
                open={!!drill}
                onClose={() => setDrill(null)}
                width={780}
                styles={{ body: { overflowX: 'hidden' } }}
                destroyOnClose
                title={
                    <Space size={10}>
                        <IconChip color={ACCENT.blue.color} bg={ACCENT.blue.bg}><AppstoreOutlined /></IconChip>
                        <div>
                            <div style={{ fontWeight: 600 }}>{drillRow?.departmentName}</div>
                            <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                                {drillInterventions.length} interventions - {drillStuck.length} stuck
                            </Text>
                        </div>
                    </Space>
                }
            >
                {drillRow && (
                    <Space direction="vertical" size={20} style={{ width: '100%' }}>
                        <CoverageCard row={drillRow} ink={ink} title="Department total" subtitle={`${drillInterventions.length} interventions`} />

                        <div>
                            <Title level={5} style={{ marginTop: 0 }}>Interventions</Title>
                            <Row gutter={[12, 12]}>
                                {drillInterventions.map((row: CoverageRow) => (
                                    <Col key={row.key} xs={24} md={12} style={{ display: 'flex' }}>
                                        <CoverageCard
                                            row={row}
                                            ink={ink}
                                            title={row.interventionTitle || 'Intervention'}
                                            subtitle={`${row.summary.assigned} assigned`}
                                        />
                                    </Col>
                                ))}
                            </Row>
                        </div>

                        <div>
                            <Title level={5} style={{ marginTop: 0 }}>Stuck in this department</Title>
                            {drillStuck.length ? (
                                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                    {drillStuck.slice(0, 20).map(item => (
                                        <StuckRow key={item.id} item={item} onClick={() => setDetail(item)} />
                                    ))}
                                    {drillStuck.length > 20 && (
                                        <Button
                                            type="link"
                                            onClick={() => {
                                                setDepartment(drill as string)
                                                setDrill(null)
                                                openStuck('all')
                                            }}
                                        >
                                            See all {drillStuck.length} in the queue
                                        </Button>
                                    )}
                                </Space>
                            ) : (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing stuck here" />
                            )}
                        </div>
                    </Space>
                )}
            </Drawer>
        </div>
    )
}
