import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Col, Drawer, Empty, Modal, Row } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, TeamOutlined, TrophyOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { GROUPS, MOVEMENT_META, movementStateOf, type SmeGroupRow } from './groupData'
import { useGroupRows } from './useGroupRows'
import { useGroupActions } from './useGroupActions'
import { DEFAULT_GROUP_FILTERS, GroupFilters, type GroupFilterState, type GroupSort } from './GroupFilters'
import { GroupList, type GroupSelection } from './GroupList'
import { GroupDetail } from './GroupDetail'
import './groups.css'

/** Closest to moving first: awaiting M&E, then ready, then by progress. */
const MOVEMENT_ORDER = { awaiting: 0, ready: 1, 'needs-details': 2, complete: 3 } as const

/**
 * Group progression: stats, one-line filters, the programme's accepted SMEs
 * and the selected one's requirements, interventions and movement history.
 * ROM submits ready SMEs to M&E; M&E confirms or returns them. On phones the
 * detail opens in a full-height drawer.
 */
export default function GroupMovementTimeline() {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.3, ease: 'easeOut' as const, delay }
            }

    const { rows, loading, configFor, eligibilityFor, withoutRequirements, usingDefault } =
        useGroupRows({ activeProgramId, isAllPrograms })
    const programList = (names: string[]) => names.join(', ')

    const { hasRole, nameOf } = useDepartmentRoles()
    const departmentId = String((user as any)?.departmentId || '').trim()
    const departmentName = departmentId ? nameOf(departmentId, String((user as any)?.departmentName || '')) : ''
    const isROM = hasRole(departmentId, 'rom')
    const isME = hasRole(departmentId, 'monitoring')

    const actions = useGroupActions({ user, departmentId, departmentName, configFor, eligibilityFor })
    const { busyKey } = actions
    const [modal, contextHolder] = Modal.useModal()

    const [filters, setFilters] = useState<GroupFilterState>(DEFAULT_GROUP_FILTERS)
    const [selectedKey, setSelectedKey] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [ticked, setTicked] = useState<string[]>([])
    const patchFilters = (patch: Partial<GroupFilterState>) => setFilters(prev => ({ ...prev, ...patch }))

    const stageOptions = useMemo(
        () => Array.from(new Set(rows.map(r => String(r.stage || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        [rows]
    )
    const movementOptions = Object.values(MOVEMENT_META).map(m => m.label)

    const visible = useMemo(() => {
        const term = filters.search.trim().toLowerCase()
        const stateOf = (row: SmeGroupRow) => movementStateOf(row, eligibilityFor(row))
        const sorters: Record<GroupSort, (a: SmeGroupRow, b: SmeGroupRow) => number> = {
            progress: (a, b) =>
                MOVEMENT_ORDER[stateOf(a)] - MOVEMENT_ORDER[stateOf(b)] ||
                eligibilityFor(b).progress - eligibilityFor(a).progress ||
                a.name.localeCompare(b.name),
            group: (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name),
            name: (a, b) => a.name.localeCompare(b.name)
        }
        return rows
            .filter(row =>
                (!term || [row.name, row.email].some(v => String(v || '').toLowerCase().includes(term))) &&
                (filters.group === 'all' || row.group === filters.group) &&
                (filters.stage === 'all' || row.stage === filters.stage) &&
                (filters.movement === 'all' || MOVEMENT_META[stateOf(row)].label === filters.movement)
            )
            .sort(sorters[filters.sort])
    }, [rows, filters, eligibilityFor])

    const metrics = useMemo(() => {
        const now = Date.now()
        const daysAgo = (iso?: string) => {
            const time = iso ? new Date(iso).getTime() : NaN
            return Number.isFinite(time) ? (now - time) / 86_400_000 : NaN
        }
        const states = rows.map(row => movementStateOf(row, eligibilityFor(row)))
        return {
            total: rows.length,
            ready: states.filter(state => state === 'ready').length,
            needsDetails: states.filter(state => state === 'needs-details').length,
            pending: rows.filter(row => row.pendingMovement).length,
            /** Submitted to M&E more than 7 days ago and still unanswered. */
            overdue: rows.filter(row => daysAgo(row.pendingMovement?.requestedAt) > 7).length,
            /** Group movements M&E confirmed in the last 30 days (not first placements). */
            confirmedRecently: rows.reduce((sum, row) =>
                sum + row.history.filter(entry => entry.from && daysAgo(entry.date) <= 30).length, 0),
            graduated: rows.filter(row => row.group === 'Graduated').length
        }
    }, [eligibilityFor, rows])

    // Desktop always shows a detail: keep the selection while it's visible, otherwise take the first row.
    useEffect(() => {
        if (isMobile) return
        if (!visible.some(r => r.key === selectedKey)) setSelectedKey(visible[0]?.key)
    }, [visible, selectedKey, isMobile])

    const selected = rows.find(r => r.key === selectedKey)

    const select = (row: SmeGroupRow) => {
        setSelectedKey(row.key)
        if (isMobile) setDrawerOpen(true)
    }

    const tickedRows = () => visible.filter(row => ticked.includes(row.key))

    const selection: GroupSelection | undefined = isROM
        ? {
            keys: ticked,
            onChange: setTicked,
            canSelect: row => !row.pendingMovement && eligibilityFor(row).eligible && !!eligibilityFor(row).target,
            actionLabel: 'Submit to M&E',
            loading: busyKey === 'bulk:submit',
            busy: !!busyKey,
            onAction: () => modal.confirm({
                title: `Submit ${ticked.length} selected SME${ticked.length === 1 ? '' : 's'} to M&E?`,
                content: 'M&E receives one summary email and the SMEs remain in their current groups until confirmation.',
                okText: 'Submit selected',
                onOk: async () => {
                    await actions.submitToME(tickedRows())
                    setTicked([])
                }
            })
        }
        : isME
            ? {
                keys: ticked,
                onChange: setTicked,
                canSelect: row => !!row.pendingMovement,
                actionLabel: 'Confirm selected',
                loading: busyKey === 'bulk:confirm',
                busy: !!busyKey,
                onAction: () => modal.confirm({
                    title: `Confirm ${ticked.length} selected movement${ticked.length === 1 ? '' : 's'}?`,
                    content: 'Eligibility is checked again before each promotion. Confirmed SMEs are updated in both application and participant records.',
                    okText: 'Confirm selected',
                    onOk: async () => {
                        await actions.confirmMany(tickedRows())
                        setTicked([])
                    }
                })
            }
            : undefined

    const remindAll = () => modal.confirm({
        title: 'Email all pending SMEs in this view?',
        content: 'Each SME receives only the details they still need for their next group. SMEs reminded in the last 24 hours are skipped.',
        okText: 'Send reminders',
        onOk: () => actions.remindAll(visible)
    })

    if (!activeProgramId && !isAllPrograms) {
        return (
            <div className='ws-page'>
                <Helmet>
                    <title>Groups</title>
                </Helmet>
                <MotionCard>
                    <Empty description='Select an active programme to view its groups' />
                </MotionCard>
            </div>
        )
    }

    const detail = selected ? (
        <GroupDetail
            row={selected}
            eligibility={eligibilityFor(selected)}
            isROM={isROM}
            isME={isME}
            busyKey={busyKey}
            onRequest={actions.requestMovement}
            onConfirm={actions.confirmMovement}
            onReturn={actions.returnMovement}
            onRemind={actions.sendReminder}
        />
    ) : null

    // Each department sees the counts it acts on: ROM submits ready SMEs and
    // chases missing details; M&E reviews what ROM submitted. Everyone else
    // gets a neutral overview.
    type Tile = { key: string; title: string; mobileTitle?: string; tone: MetricTone; icon: React.ReactNode; value: number; subtitle: string }
    const totalTile: Tile = { key: 'total', title: 'Total SMEs', mobileTitle: 'Total', tone: 'accent' as const, icon: <TeamOutlined />, value: metrics.total, subtitle: isAllPrograms ? 'Accepted across all programmes' : 'Accepted in this programme' }
    const graduatedTile: Tile = { key: 'graduated', title: 'Graduated', tone: 'info' as const, icon: <TrophyOutlined />, value: metrics.graduated, subtitle: 'Completed incubation' }
    const tiles: Tile[] = isROM
        ? [
            totalTile,
            { key: 'ready', title: 'Ready to submit', mobileTitle: 'Ready', tone: 'success' as const, icon: <CheckCircleOutlined />, value: metrics.ready, subtitle: 'Eligible, not yet sent to M&E' },
            { key: 'pending', title: 'Awaiting M&E', mobileTitle: 'With M&E', tone: 'warning' as const, icon: <ClockCircleOutlined />, value: metrics.pending, subtitle: 'Submitted, not yet confirmed' },
            { key: 'needs', title: 'Needs details', mobileTitle: 'Needs details', tone: 'danger' as const, icon: <ExclamationCircleOutlined />, value: metrics.needsDetails, subtitle: 'Still missing requirements' }
        ]
        : isME
            ? [
                totalTile,
                { key: 'pending', title: 'Awaiting your review', mobileTitle: 'To review', tone: 'warning' as const, icon: <ClockCircleOutlined />, value: metrics.pending, subtitle: metrics.overdue ? `${metrics.overdue} waiting over 7 days` : 'Submitted by ROM' },
                { key: 'confirmed', title: 'Confirmed', tone: 'success' as const, icon: <CheckCircleOutlined />, value: metrics.confirmedRecently, subtitle: 'Movements in the last 30 days' },
                graduatedTile
            ]
            : [
                totalTile,
                { key: 'ready', title: 'Ready to move', tone: 'success' as const, icon: <CheckCircleOutlined />, value: metrics.ready, subtitle: 'Eligible, not yet submitted' },
                { key: 'pending', title: 'Pending M&E', tone: 'warning' as const, icon: <ClockCircleOutlined />, value: metrics.pending, subtitle: 'Submitted by ROM' },
                graduatedTile
            ]

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Groups</title>
            </Helmet>
            {contextHolder}

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tiles.map((t, i) => (
                    // Read-only summaries; groups and movement states are filtered from the toolbar.
                    <Col key={t.key} xs={12} lg={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile
                                icon={t.icon}
                                tone={t.tone}
                                title={t.title}
                                mobileTitle={t.mobileTitle}
                                value={t.value}
                                subtitle={t.subtitle}
                                loading={loading}
                                compact={isMobile}
                            />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            {!loading && !isROM && !isME && (
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Group movements are read-only for your department'
                    description='ROM submits eligible movements and M&E confirms or returns them.'
                />
            )}

            {!loading && withoutRequirements.length > 0 && (
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='No Group A requirements are set up'
                    description={isAllPrograms
                        ? `SMEs in Group A can’t move to Group B until requirements are set up for: ${programList(withoutRequirements)}.`
                        : 'SMEs in Group A can’t move to Group B until requirements are set up for this programme.'}
                />
            )}

            {!loading && usingDefault.length > 0 && (
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Using the shared default requirements'
                    description={isAllPrograms
                        ? `These programmes have no requirements of their own, so the shared default list applies: ${programList(usingDefault)}.`
                        : 'This programme has no requirements of its own, so the shared default list applies.'}
                />
            )}

            <motion.div {...rise(0.22)}>
                <GroupFilters
                    filters={filters}
                    onChange={patchFilters}
                    movementOptions={movementOptions}
                    stageOptions={stageOptions}
                    onRemindAll={isROM ? remindAll : undefined}
                    reminding={busyKey === 'reminder:all'}
                    busy={!!busyKey}
                />
            </motion.div>

            <div className='ws-layout'>
                <GroupList
                    rows={visible}
                    loading={loading}
                    selectedKey={selectedKey}
                    onSelect={select}
                    sort={filters.sort}
                    onSortChange={sort => patchFilters({ sort })}
                    resetKey={`${filters.search}|${filters.group}|${filters.movement}|${filters.stage}`}
                    eligibilityFor={eligibilityFor}
                    selection={selection}
                    showProgram={isAllPrograms}
                />

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty
                                    className='ws-detail-empty'
                                    description={rows.length ? 'Select an SME to see its progress' : 'No accepted SMEs yet'}
                                />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='right'
                    width='100%'
                    title={selected?.name || 'SME'}
                >
                    {detail}
                </Drawer>
            )}
        </div>
    )
}
