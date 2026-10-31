import React, { useMemo, useState } from 'react'
import { Drawer, Empty, Progress, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { AlertOutlined, AuditOutlined, CheckCircleOutlined, CommentOutlined, FileDoneOutlined, RiseOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cycleStatusTag } from './CyclesModal'
import {
    ACTION_LABELS,
    PHASES,
    compactStatus,
    outstandingActions,
    ratingColor,
    ratingLabel,
    reviewStage,
    rollUpScores,
    type ActionOwner,
    type EmployeeIpmState,
    type OutstandingAction,
    type PerformanceCycle,
    type PhaseKey,
    type ScoreRollUp
} from './ipm'

const { Text } = Typography

export type ComplianceRow = {
    key: string
    name: string
    department?: string
    departmentId?: string | null
    branchId?: string | null
    branchName?: string
    lineManagerName?: string
    /** Annual rating after calibration, or null while unrated. */
    score: number | null
    state: EmployeeIpmState
}

type View = 'compliance' | 'actions' | 'rollup'

const OWNER_LABELS: Record<ActionOwner, string> = { employee: 'Employee', manager: 'Line manager', hr: 'HR', ceo: 'CEO' }
const SIGNED_STAGES = ['calibration', 'validation', 'validated']

const ratio = (done: number, total: number) =>
    total ? (
        <Progress
            percent={Math.round((done / total) * 100)}
            size='small'
            status={done === total ? 'success' : 'normal'}
            format={() => `${done}/${total}`}
            style={{ minWidth: 110, margin: 0 }}
        />
    ) : (
        <Text type='secondary'>—</Text>
    )

const scoreTag = (score: number | null) =>
    score === null ? (
        <Text type='secondary'>—</Text>
    ) : (
        <Tooltip title={ratingLabel(score)}>
            <Tag color={ratingColor(score)} style={{ margin: 0 }}>
                {score.toFixed(2)}
            </Tag>
        </Tooltip>
    )

const difference = (value: number | null, base: number | null) => {
    if (value === null || base === null) return <Text type='secondary'>—</Text>
    const diff = Math.round((value - base) * 100) / 100
    return <Text type={diff < 0 ? 'danger' : diff > 0 ? 'success' : 'secondary'}>{diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}</Text>
}

/**
 * HR's view of the cycle: how far each department has got with compacts,
 * check-ins and reviews; everything still waiting on someone; and ratings
 * rolled up from individuals to department, centre and company.
 */
export const ComplianceDrawer: React.FC<{
    open: boolean
    onClose: () => void
    cycle: PerformanceCycle | null
    rows: ComplianceRow[]
    departments: { value: string; label: string }[]
    nameOf: (uid?: string | null) => string | undefined
}> = ({ open, onClose, cycle, rows, departments, nameOf }) => {
    const isMobile = useIsMobile()
    const [view, setView] = useState<View>('compliance')
    const [department, setDepartment] = useState<string>()
    const [owner, setOwner] = useState<ActionOwner | 'all'>('all')
    const today = dayjs().format('YYYY-MM-DD')

    const evaluated = useMemo(
        () =>
            rows.map(row => {
                const actions = cycle ? outstandingActions(cycle, today, row.state) : []
                const status = compactStatus(row.state.compact?.signoff)
                const agreed = status === 'agreed' || status === 'hr-checked'
                const signed = Object.fromEntries(
                    PHASES.map(p => [p.key, SIGNED_STAGES.includes(reviewStage(row.state.reviews[p.key]))])
                ) as Record<PhaseKey, boolean>
                return { ...row, actions, agreed, signed, checkInDue: actions.some(a => a.kind === 'check-in') }
            }),
        [rows, cycle, today]
    )
    const inDepartment = evaluated.filter(row => !department || row.departmentId === department)
    const phaseStarted = (phase: PhaseKey) => !!cycle && today >= cycle.windows[phase].from

    const summary = (list: typeof evaluated) => {
        const agreed = list.filter(r => r.agreed)
        return {
            staff: list.length,
            agreed: agreed.length,
            checkInsCurrent: agreed.filter(r => !r.checkInDue).length,
            midYear: list.filter(r => r.signed.midYear).length,
            yearEnd: list.filter(r => r.signed.yearEnd).length,
            overdue: list.reduce((n, r) => n + r.actions.filter(a => a.overdue).length, 0),
            noManager: list.filter(r => r.actions.some(a => a.kind === 'assign-manager')).length
        }
    }
    const totals = summary(inDepartment)

    const departmentRows = useMemo(() => {
        const groups = new Map<string, typeof evaluated>()
        inDepartment.forEach(r => {
            const key = r.departmentId || ''
            groups.set(key, [...(groups.get(key) || []), r])
        })
        return [...groups.entries()]
            .map(([key, list]) => ({ key: key || 'none', label: list[0]?.department || (key ? key : 'No department'), ...summary(list) }))
            .sort((a, b) => a.label.localeCompare(b.label))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inDepartment])

    type ActionRow = OutstandingAction & { key: string; ownerName: string; employeeName: string; department?: string }
    const actionRows: ActionRow[] = inDepartment
        .flatMap(row =>
            row.actions.map((action, index) => ({
                ...action,
                key: `${row.key}-${index}`,
                employeeName: row.name,
                department: row.department,
                ownerName:
                    action.owner === 'employee'
                        ? row.name
                        : action.owner === 'manager'
                          ? nameOf(row.state.lineManagerId) || row.lineManagerName || 'Line manager'
                          : OWNER_LABELS[action.owner]
            }))
        )
        .filter(a => owner === 'all' || a.owner === owner)
        .sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || a.ownerName.localeCompare(b.ownerName))

    const actionText = (a: ActionRow) => `${ACTION_LABELS[a.kind]}${a.phase ? ` (${PHASES.find(p => p.key === a.phase)?.label.toLowerCase()})` : ''}`
    const dueTag = (a: ActionRow) =>
        a.overdue ? (
            <Tag color='red' style={{ margin: 0 }}>
                Overdue
            </Tag>
        ) : (
            <Tag style={{ margin: 0 }}>Open</Tag>
        )

    const roll = useMemo(() => {
        const byDepartment = rollUpScores(evaluated, r => (r.departmentId ? { key: r.departmentId, label: r.department || r.departmentId } : null))
        const byCentre = rollUpScores(evaluated, r => (r.branchId ? { key: r.branchId, label: r.branchName || r.branchId } : null))
        const departmentAverage = new Map(byDepartment.groups.map(g => [g.key, g.average]))
        const individuals = evaluated
            .filter(r => r.score !== null)
            .map(r => ({ ...r, departmentAverage: departmentAverage.get(r.departmentId || '') ?? null }))
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        return { company: byDepartment.company, departments: byDepartment.groups, centres: byCentre.groups, individuals }
    }, [evaluated])

    const pctTile = (done: number, total: number) => (total ? `${Math.round((done / total) * 100)}%` : '—')

    const groupTable = (title: string, groups: ScoreRollUp[]) => (
        <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                {title}
            </Text>
            {isMobile ? (
                <MobileCardList
                    data={groups}
                    getKey={g => g.key || 'none'}
                    emptyText='Nothing to show yet.'
                    renderCard={g => ({
                        title: g.label,
                        badge: scoreTag(g.average),
                        fields: [
                            { label: 'Rated', value: `${g.rated}/${g.count}` },
                            { label: 'vs company', value: difference(g.average, roll.company.average) }
                        ]
                    })}
                />
            ) : (
                <Table
                    rowKey={g => g.key || 'none'}
                    size='small'
                    pagination={false}
                    dataSource={groups}
                    columns={[
                        { title: title.replace('By ', '').replace(/^\w/, c => c.toUpperCase()), dataIndex: 'label', key: 'label' },
                        { title: 'Rated', key: 'rated', width: 100, render: (_: unknown, g: ScoreRollUp) => `${g.rated}/${g.count}` },
                        { title: 'Average', key: 'average', width: 110, render: (_: unknown, g: ScoreRollUp) => scoreTag(g.average) },
                        { title: 'vs company', key: 'diff', width: 110, render: (_: unknown, g: ScoreRollUp) => difference(g.average, roll.company.average) }
                    ]}
                />
            )}
        </div>
    )

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={isMobile ? '100%' : 1100}
            destroyOnClose
            title={
                <Space wrap>
                    <AuditOutlined />
                    {`IPM compliance${cycle ? ` · ${cycle.label}` : ''}`}
                    {cycle ? cycleStatusTag(cycle.status) : null}
                    {cycle ? (
                        <Tag color={cycle.reminders ? 'green' : 'default'} style={{ borderRadius: 999, margin: 0 }}>
                            {cycle.reminders ? 'Reminders on' : 'Reminders off'}
                        </Tag>
                    ) : null}
                </Space>
            }
        >
            {!cycle ? (
                <Empty description='Open a performance cycle first.' />
            ) : (
                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <Segmented
                            value={view}
                            onChange={value => setView(value as View)}
                            options={[
                                { value: 'compliance', label: 'Compliance' },
                                { value: 'actions', label: `Outstanding (${inDepartment.reduce((n, r) => n + r.actions.length, 0)})` },
                                { value: 'rollup', label: 'Score roll-up' }
                            ]}
                            block={isMobile}
                            style={isMobile ? { width: '100%' } : undefined}
                        />
                        {view !== 'rollup' ? (
                            <Select
                                allowClear
                                placeholder='All departments'
                                value={department}
                                onChange={setDepartment}
                                options={departments}
                                style={{ width: isMobile ? '100%' : 240 }}
                            />
                        ) : null}
                    </div>

                    {view === 'compliance' ? (
                        <>
                            <MetricsGrid
                                metrics={[
                                    {
                                        key: 'compacts',
                                        important: true,
                                        icon: <FileDoneOutlined />,
                                        tone: 'accent',
                                        title: 'Compacts Agreed',
                                        mobileTitle: 'Compacts',
                                        value: pctTile(totals.agreed, totals.staff),
                                        subtitle: `${totals.agreed} of ${totals.staff} signed by both`
                                    },
                                    {
                                        key: 'checkIns',
                                        icon: <CommentOutlined />,
                                        tone: 'info',
                                        title: 'Check-ins Current',
                                        value: pctTile(totals.checkInsCurrent, totals.agreed),
                                        subtitle: 'Of agreed compacts, last 14 days'
                                    },
                                    {
                                        key: 'midYear',
                                        icon: <CheckCircleOutlined />,
                                        tone: 'success',
                                        title: 'Mid-year Signed',
                                        value: phaseStarted('midYear') ? pctTile(totals.midYear, totals.staff) : '—',
                                        subtitle: phaseStarted('midYear') ? `${totals.midYear} of ${totals.staff}` : `Opens ${dayjs(cycle.windows.midYear.from).format('D MMM')}`
                                    },
                                    {
                                        key: 'yearEnd',
                                        icon: <CheckCircleOutlined />,
                                        tone: 'success',
                                        title: 'Year-end Signed',
                                        value: phaseStarted('yearEnd') ? pctTile(totals.yearEnd, totals.staff) : '—',
                                        subtitle: phaseStarted('yearEnd') ? `${totals.yearEnd} of ${totals.staff}` : `Opens ${dayjs(cycle.windows.yearEnd.from).format('D MMM')}`
                                    },
                                    {
                                        key: 'overdue',
                                        important: true,
                                        icon: <AlertOutlined />,
                                        tone: 'danger',
                                        title: 'Overdue',
                                        value: totals.overdue,
                                        subtitle: totals.noManager ? `${totals.noManager} without a line manager` : 'Past their window',
                                        onClick: () => setView('actions')
                                    }
                                ]}
                            />
                            {isMobile ? (
                                <MobileCardList
                                    data={departmentRows}
                                    getKey={r => r.key}
                                    emptyText='No staff in this cycle.'
                                    renderCard={r => ({
                                        title: r.label,
                                        subtitle: `${r.staff} staff`,
                                        badge: r.overdue ? (
                                            <Tag color='red' style={{ margin: 0 }}>
                                                {r.overdue} overdue
                                            </Tag>
                                        ) : undefined,
                                        fields: [
                                            { label: 'Compacts', value: ratio(r.agreed, r.staff) },
                                            { label: 'Check-ins', value: ratio(r.checkInsCurrent, r.agreed) },
                                            { label: 'Mid-year', value: phaseStarted('midYear') ? ratio(r.midYear, r.staff) : '—' },
                                            { label: 'Year-end', value: phaseStarted('yearEnd') ? ratio(r.yearEnd, r.staff) : '—' }
                                        ]
                                    })}
                                />
                            ) : (
                                <Table
                                    rowKey='key'
                                    size='small'
                                    pagination={false}
                                    dataSource={departmentRows}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No staff in this cycle.' /> }}
                                    columns={[
                                        { title: 'Department', dataIndex: 'label', key: 'label', render: (v: string) => <Text strong>{v}</Text> },
                                        { title: 'Staff', dataIndex: 'staff', key: 'staff', width: 70 },
                                        { title: 'Compacts agreed', key: 'agreed', render: (_: unknown, r: (typeof departmentRows)[number]) => ratio(r.agreed, r.staff) },
                                        { title: 'Check-ins current', key: 'checkIns', render: (_: unknown, r: (typeof departmentRows)[number]) => ratio(r.checkInsCurrent, r.agreed) },
                                        {
                                            title: 'Mid-year signed',
                                            key: 'midYear',
                                            render: (_: unknown, r: (typeof departmentRows)[number]) => (phaseStarted('midYear') ? ratio(r.midYear, r.staff) : <Text type='secondary'>Not open</Text>)
                                        },
                                        {
                                            title: 'Year-end signed',
                                            key: 'yearEnd',
                                            render: (_: unknown, r: (typeof departmentRows)[number]) => (phaseStarted('yearEnd') ? ratio(r.yearEnd, r.staff) : <Text type='secondary'>Not open</Text>)
                                        },
                                        {
                                            title: 'Overdue',
                                            key: 'overdue',
                                            width: 90,
                                            render: (_: unknown, r: (typeof departmentRows)[number]) =>
                                                r.overdue ? <Tag color='red' style={{ margin: 0 }}>{r.overdue}</Tag> : <Text type='secondary'>0</Text>
                                        }
                                    ]}
                                />
                            )}
                        </>
                    ) : null}

                    {view === 'actions' ? (
                        <>
                            <Segmented
                                value={owner}
                                onChange={value => setOwner(value as ActionOwner | 'all')}
                                options={[{ value: 'all', label: 'Everyone' }, ...(['employee', 'manager', 'hr', 'ceo'] as ActionOwner[]).map(o => ({ value: o, label: OWNER_LABELS[o] }))]}
                                block={isMobile}
                                style={isMobile ? { width: '100%' } : undefined}
                            />
                            {isMobile ? (
                                <MobileCardList
                                    data={actionRows}
                                    getKey={a => a.key}
                                    emptyText='Nothing outstanding.'
                                    renderCard={a => ({
                                        title: actionText(a),
                                        subtitle: `For ${a.employeeName}${a.department ? ` · ${a.department}` : ''}`,
                                        badge: dueTag(a),
                                        fields: [{ label: 'Waiting on', value: a.ownerName }]
                                    })}
                                />
                            ) : (
                                <Table
                                    rowKey='key'
                                    size='small'
                                    dataSource={actionRows}
                                    pagination={{ pageSize: 15, hideOnSinglePage: true }}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Nothing outstanding.' /> }}
                                    columns={[
                                        {
                                            title: 'Waiting on',
                                            key: 'owner',
                                            render: (_: unknown, a: ActionRow) => (
                                                <Space direction='vertical' size={0}>
                                                    <Text strong>{a.ownerName}</Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {OWNER_LABELS[a.owner]}
                                                    </Text>
                                                </Space>
                                            )
                                        },
                                        { title: 'Action', key: 'action', render: (_: unknown, a: ActionRow) => actionText(a) },
                                        {
                                            title: 'Employee',
                                            key: 'employee',
                                            render: (_: unknown, a: ActionRow) => (
                                                <Space direction='vertical' size={0}>
                                                    <Text>{a.employeeName}</Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {a.department || ''}
                                                    </Text>
                                                </Space>
                                            )
                                        },
                                        { title: '', key: 'due', width: 90, align: 'right' as const, render: (_: unknown, a: ActionRow) => dueTag(a) }
                                    ]}
                                />
                            )}
                        </>
                    ) : null}

                    {view === 'rollup' ? (
                        <>
                            <MetricsGrid
                                metrics={[
                                    {
                                        key: 'company',
                                        important: true,
                                        icon: <RiseOutlined />,
                                        tone: 'accent',
                                        title: 'Company Average',
                                        mobileTitle: 'Company',
                                        value: roll.company.average !== null ? `${roll.company.average.toFixed(2)}/5` : '—',
                                        subtitle: roll.company.average !== null ? ratingLabel(roll.company.average) : 'No ratings yet'
                                    },
                                    {
                                        key: 'rated',
                                        important: true,
                                        icon: <TeamOutlined />,
                                        tone: 'info',
                                        title: 'Rated',
                                        value: `${roll.company.rated}/${roll.company.count}`,
                                        subtitle: 'Annual rating after calibration'
                                    }
                                ]}
                            />
                            {groupTable('By department', roll.departments)}
                            {groupTable('By centre', roll.centres)}
                            <div>
                                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                                    Individuals against their department and the company
                                </Text>
                                {isMobile ? (
                                    <MobileCardList
                                        data={roll.individuals}
                                        getKey={r => r.key}
                                        emptyText='Nobody has been rated yet.'
                                        renderCard={r => ({
                                            title: r.name,
                                            subtitle: r.department,
                                            badge: scoreTag(r.score),
                                            fields: [
                                                { label: 'vs department', value: difference(r.score, r.departmentAverage) },
                                                { label: 'vs company', value: difference(r.score, roll.company.average) }
                                            ]
                                        })}
                                    />
                                ) : (
                                    <Table
                                        rowKey='key'
                                        size='small'
                                        dataSource={roll.individuals}
                                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Nobody has been rated yet.' /> }}
                                        columns={[
                                            { title: 'Employee', dataIndex: 'name', key: 'name' },
                                            { title: 'Department', dataIndex: 'department', key: 'department' },
                                            { title: 'Rating', key: 'score', width: 100, render: (_: unknown, r: (typeof roll.individuals)[number]) => scoreTag(r.score) },
                                            { title: 'Department average', key: 'dept', width: 160, render: (_: unknown, r: (typeof roll.individuals)[number]) => scoreTag(r.departmentAverage) },
                                            { title: 'vs department', key: 'vsDept', width: 120, render: (_: unknown, r: (typeof roll.individuals)[number]) => difference(r.score, r.departmentAverage) },
                                            { title: 'vs company', key: 'vsCompany', width: 110, render: (_: unknown, r: (typeof roll.individuals)[number]) => difference(r.score, roll.company.average) }
                                        ]}
                                    />
                                )}
                            </div>
                        </>
                    ) : null}
                </Space>
            )}
        </Drawer>
    )
}
