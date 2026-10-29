import React, { useMemo } from 'react'
import { Card, Typography, Tag, Empty, Button, theme } from 'antd'
import { ArrowLeftOutlined, RightOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { ALL_DEPTS, DeptGap, INTERVENTION_BUCKETS, Intervention, InterventionBucket, formatDateTime, getAssignedCompletedAt, interventionBucket, sentenceCase } from './participantsData'

const { Text } = Typography

export const BucketChips: React.FC<{ counts: Record<InterventionBucket, number> }> = ({ counts }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {(Object.keys(INTERVENTION_BUCKETS) as InterventionBucket[])
            .filter(key => counts[key] > 0)
            .map(key => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: INTERVENTION_BUCKETS[key].color }} />
                    <span style={{ fontWeight: 600 }}>{counts[key]}</span>
                    <span style={{ opacity: 0.7 }}>{INTERVENTION_BUCKETS[key].label}</span>
                </span>
            ))}
    </div>
)

export const BucketBar: React.FC<{ counts: Record<InterventionBucket, number>; total: number; delay?: number; instant?: boolean }> = ({
    counts,
    total,
    delay = 0,
    instant
}) => {
    const { token } = theme.useToken()
    return (
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: token.colorFillSecondary }}>
            {(Object.keys(INTERVENTION_BUCKETS) as InterventionBucket[])
                .filter(key => counts[key] > 0)
                .map(key => (
                    <motion.div
                        key={key}
                        initial={{ width: instant ? `${(counts[key] / (total || 1)) * 100}%` : 0 }}
                        animate={{ width: `${(counts[key] / (total || 1)) * 100}%` }}
                        transition={{ duration: instant ? 0 : 0.5, delay, ease: 'easeOut' }}
                        style={{ background: INTERVENTION_BUCKETS[key].color }}
                    />
                ))}
        </div>
    )
}

export const DetailItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div style={{ minWidth: 0 }}>
        <Text type='secondary' style={{ display: 'block', fontSize: 11 }}>{label}</Text>
        <Text style={{ fontSize: 13 }}>{value}</Text>
    </div>
)

export type DepartmentDrilldownProps = {
    departments: DeptGap[]
    interventions: Intervention[]
    selectedKey: string | null
    onSelect: (key: string | null) => void
    statusFilter: InterventionBucket | null
}

// Two views that slide between each other: a vertical list of departments with a
// status breakdown, and - after a click - that department's intervention cards.
export const DepartmentDrilldown: React.FC<DepartmentDrilldownProps> = ({
    departments: allDepartments,
    interventions,
    selectedKey,
    onSelect,
    statusFilter
}) => {
    const { token } = theme.useToken()
    const { nameOf } = useDepartmentRoles()
    const reduceMotion = !!useReducedMotion()
    const shift = reduceMotion ? 0 : 24

    // With a status filter on, every department keeps only that status' count.
    const departments = useMemo(() => !statusFilter ? allDepartments : allDepartments.map(d => {
        const count = d[statusFilter]
        return {
            ...d,
            needed: count,
            completed: statusFilter === 'completed' ? count : 0,
            inProgress: statusFilter === 'inProgress' ? count : 0,
            missing: statusFilter === 'missing' ? count : 0
        }
    }), [allDepartments, statusFilter])

    const totals = useMemo<DeptGap>(() => departments.reduce<DeptGap>((acc, d) => ({
        ...acc,
        needed: acc.needed + d.needed,
        completed: acc.completed + d.completed,
        inProgress: acc.inProgress + d.inProgress,
        missing: acc.missing + d.missing
    }), { key: ALL_DEPTS, label: 'All departments', needed: 0, completed: 0, inProgress: 0, missing: 0 }), [departments])

    const selected = selectedKey === ALL_DEPTS ? totals : departments.find(d => d.key === selectedKey)

    const items = useMemo(() => {
        if (!selectedKey) return []
        return interventions.filter(i =>
            (selectedKey === ALL_DEPTS || (i.departmentId || 'other') === selectedKey) &&
            (!statusFilter || interventionBucket(i.status) === statusFilter)
        )
    }, [interventions, selectedKey, statusFilter])

    const visibleDepartments = statusFilter ? departments.filter(d => d.needed > 0) : departments
    const rows = visibleDepartments.length > 1 ? [totals, ...visibleDepartments] : visibleDepartments

    return (
        <div data-guide='sme-interventions-table' style={{ overflow: 'hidden' }}>
            <AnimatePresence mode='wait' initial={false}>
                {!selected ? (
                    <motion.div
                        key='list'
                        initial={{ opacity: 0, x: -shift }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -shift }}
                        transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                    >
                        {rows.map((dept, index) => {
                            const counts = { completed: dept.completed, inProgress: dept.inProgress, missing: dept.missing }
                            return (
                                <motion.div
                                    key={dept.key}
                                    role='button'
                                    tabIndex={0}
                                    aria-label={`Show ${dept.label} interventions`}
                                    onClick={() => onSelect(dept.key)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            onSelect(dept.key)
                                        }
                                    }}
                                    initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.25, delay: reduceMotion ? 0 : index * 0.04 }}
                                    whileHover={reduceMotion ? undefined : { x: 3 }}
                                    whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '12px 14px',
                                        borderRadius: 10,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                                        <Text strong ellipsis style={{ minWidth: 0 }}>{dept.label}</Text>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                {dept.needed} intervention{dept.needed === 1 ? '' : 's'}
                                            </Text>
                                            <RightOutlined style={{ fontSize: 11, color: token.colorTextTertiary }} />
                                        </span>
                                    </div>
                                    <BucketBar counts={counts} total={dept.needed} delay={reduceMotion ? 0 : 0.1 + index * 0.04} instant={reduceMotion} />
                                    <div style={{ marginTop: 8 }}>
                                        <BucketChips counts={counts} />
                                    </div>
                                </motion.div>
                            )
                        })}
                    </motion.div>
                ) : (
                    <motion.div
                        key='detail'
                        initial={{ opacity: 0, x: shift }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: shift }}
                        transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
                    >
                        <Button
                            type='text'
                            size='small'
                            icon={<ArrowLeftOutlined />}
                            onClick={() => onSelect(null)}
                            style={{ marginBottom: 8, marginLeft: -8 }}
                        >
                            Departments
                        </Button>
                        <div style={{ marginBottom: 14 }}>
                            <Text strong style={{ display: 'block', fontSize: 16, marginBottom: 8 }}>{selected.label}</Text>
                            <BucketBar
                                counts={{ completed: selected.completed, inProgress: selected.inProgress, missing: selected.missing }}
                                total={selected.needed}
                                instant={reduceMotion}
                            />
                            <div style={{ marginTop: 8 }}>
                                <BucketChips counts={{ completed: selected.completed, inProgress: selected.inProgress, missing: selected.missing }} />
                            </div>
                        </div>

                        {!items.length ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={statusFilter ? 'No interventions with this status in this department.' : 'No interventions in this department.'} />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
                                {items.map((item, index) => {
                                    const bucket = interventionBucket(item.status)
                                    const statusText = item.status && bucket === 'missing'
                                        ? sentenceCase(String(item.status))
                                        : INTERVENTION_BUCKETS[bucket].label
                                    const assignee = item.assigneeName || item.facilitatorName || item.assignedToName
                                    return (
                                        <motion.div
                                            key={item.id}
                                            initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.25, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.05 }}
                                        >
                                            <Card
                                                size='small'
                                                style={{ border: `1px solid ${INTERVENTION_BUCKETS[bucket].color}` }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <Text strong style={{ display: 'block' }}>
                                                            {item.interventionTitle || 'Untitled intervention'}
                                                        </Text>
                                                        {selectedKey === ALL_DEPTS && (
                                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                                {nameOf(item.departmentId, item.departmentName || 'Other')}
                                                            </Text>
                                                        )}
                                                    </div>
                                                    <Tag color={INTERVENTION_BUCKETS[bucket].tag} style={{ marginInlineEnd: 0, flex: '0 0 auto' }}>
                                                        {statusText}
                                                    </Tag>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                                        gap: '8px 16px',
                                                        marginTop: 10
                                                    }}
                                                >
                                                    <DetailItem label='Assigned' value={formatDateTime(item.assignedAt || item.createdAt || item.updatedAt)} />
                                                    {item.dueDate ? <DetailItem label='Due' value={formatDateTime(item.dueDate)} /> : null}
                                                    {bucket === 'completed' ? (
                                                        <DetailItem label='Completed' value={formatDateTime(getAssignedCompletedAt(item))} />
                                                    ) : null}
                                                    {assignee ? <DetailItem label='Assigned to' value={assignee} /> : null}
                                                    {item.movStatus ? <DetailItem label='MOV' value={sentenceCase(String(item.movStatus))} /> : null}
                                                </div>
                                            </Card>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
