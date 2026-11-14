import { useEffect, useRef } from 'react'
import { Button, Empty, Typography, theme } from 'antd'
import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    ClockCircleOutlined,
    DeploymentUnitOutlined,
    PieChartOutlined,
    SortAscendingOutlined,
    ThunderboltOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'

import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { SAMPLE_TWIN_ID } from '@/services/digitalTwinService'
import {
    isOverdueForService,
    RISK_LEVEL_COLORS,
    riskMovement,
    serviceGapText,
    type RiskMovement
} from '../riskEngine'
import type { SMERow } from '../types'

const { Text } = Typography

export type ListMode = 'attention' | 'all'
export type ListSort = 'risk' | 'last_service' | 'coverage' | 'name'

export const SORT_OPTIONS: SortOption<ListSort>[] = [
    { value: 'risk', label: 'Most urgent', icon: <ThunderboltOutlined /> },
    { value: 'last_service', label: 'Longest without service', icon: <ClockCircleOutlined /> },
    { value: 'coverage', label: 'Lowest coverage', icon: <PieChartOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

// Escalated first, then rising, then new, then the rest; higher scores first within each.
const MOVEMENT_ORDER: Record<RiskMovement['kind'], number> = {
    escalated: 0,
    up: 1,
    new: 2,
    same: 3,
    down: 4
}

const coverageOf = (row: SMERow) =>
    row.expectedDepartmentsCount
        ? row.servicedDepartmentsCount / row.expectedDepartmentsCount
        : 1

export const isAttentionRow = (row: SMERow) =>
    row.riskLevel === 'High' || row.riskLevel === 'Critical'

/** The rows the list shows, in the order it shows them. Most urgent: escalated, then rising, then the highest score. */
export function orderRows(rows: SMERow[], mode: ListMode, sort: ListSort): SMERow[] {
    const today = dayjs()
    const inMode = mode === 'attention' ? rows.filter(isAttentionRow) : [...rows]

    if (sort === 'risk') {
        return inMode
            .map(row => ({ row, kind: riskMovement(row, today).kind }))
            .sort(
                (a, b) =>
                    MOVEMENT_ORDER[a.kind] - MOVEMENT_ORDER[b.kind] ||
                    b.row.riskScore - a.row.riskScore
            )
            .map(item => item.row)
    }
    if (sort === 'name') return inMode.sort((a, b) => a.smeName.localeCompare(b.smeName))
    if (sort === 'coverage') {
        return inMode.sort((a, b) => coverageOf(a) - coverageOf(b) || b.riskScore - a.riskScore)
    }
    // Longest without service: never serviced first, then the longest gap.
    const gap = (row: SMERow) =>
        row.lastInterventionDate ? row.daysSinceLastService ?? 0 : Number.POSITIVE_INFINITY
    return inMode.sort((a, b) => gap(b) - gap(a) || b.riskScore - a.riskScore)
}

export const getAttentionSummary = (row: SMERow, isDepartmentScopedView: boolean) => {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

    const pendingDepartmentReviews = row.expectedDepartments.filter(
        department => !department.deptConfirmed
    ).length
    const pendingSmmeConfirmations = row.expectedDepartments.filter(
        department => department.deptConfirmed && !department.smmeConfirmed
    ).length
    const readyWithoutService = row.expectedDepartments.filter(
        department =>
            department.deptConfirmed &&
            department.smmeConfirmed &&
            Number(department.servicedCount || 0) === 0
    ).length

    if (pendingDepartmentReviews > 0) {
        return isDepartmentScopedView
            ? 'Developmental Plan review pending'
            : `${plural(pendingDepartmentReviews, 'DP review')} pending`
    }
    if (pendingSmmeConfirmations > 0) {
        return `${plural(pendingSmmeConfirmations, 'SME confirmation')} pending`
    }
    if (readyWithoutService > 0) {
        return `${plural(readyWithoutService, 'department')} awaiting service`
    }
    if (row.smePendingAcceptanceCount > 0) {
        return `${plural(row.smePendingAcceptanceCount, 'intervention')} awaiting SME acceptance`
    }
    if (row.smePendingConfirmationCount > 0) {
        return `${plural(row.smePendingConfirmationCount, 'completion')} awaiting SME confirmation`
    }
    if (row.missingDepartmentsCount > 0) {
        return `${plural(row.missingDepartmentsCount, 'outstanding department action')}`
    }
    if (isOverdueForService(row)) return serviceGapText(row)
    return 'No immediate action required'
}

type Props = {
    rows: SMERow[]
    mode: ListMode
    onModeChange: (mode: ListMode) => void
    allCount: number
    sort: ListSort
    onSortChange: (sort: ListSort) => void
    selectedKey: string | null
    onSelect: (row: SMERow) => void
    isDepartmentScopedView: boolean
    height: number | string
}

/** The register's left panel: the SMEs in view as compact rows; arrow keys move the selection. */
export default function SMEList({
    rows,
    mode,
    onModeChange,
    allCount,
    sort,
    onSortChange,
    selectedKey,
    onSelect,
    isDepartmentScopedView,
    height
}: Props) {
    const { token } = theme.useToken()
    const navigate = useNavigate()
    const itemRefs = useRef(new Map<string, HTMLButtonElement>())

    useEffect(() => {
        if (!selectedKey) return
        itemRefs.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' })
    }, [selectedKey])

    const move = (step: number) => {
        if (!rows.length) return
        const index = rows.findIndex(row => row.key === selectedKey)
        const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))]
        if (next) {
            onSelect(next)
            itemRefs.current.get(next.key)?.focus()
        }
    }

    return (
        <div
            style={{
                height,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 14,
                background: token.colorBgContainer,
                overflow: 'hidden'
            }}
        >
            <div style={{ padding: '10px 10px 0' }}>
                <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label="Sort SMEs" />
            </div>

            <div
                role="listbox"
                aria-label="SMEs"
                onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        move(1)
                    }
                    if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        move(-1)
                    }
                }}
                style={{ flex: '1 1 auto', overflowY: 'auto', padding: 6 }}
            >
                {!rows.length ? (
                    <Empty
                        style={{ padding: '40px 12px' }}
                        description={
                            mode === 'attention'
                                ? 'No High or Critical SMEs in this view'
                                : 'No SMEs found for this risk view'
                        }
                    >
                        {mode === 'attention' && allCount ? (
                            <Button onClick={() => onModeChange('all')}>Show all {allCount}</Button>
                        ) : !allCount ? (
                            <Button
                                icon={<DeploymentUnitOutlined />}
                                onClick={() => navigate(`/twin/${SAMPLE_TWIN_ID}`)}
                            >
                                Preview digital twin with sample data
                            </Button>
                        ) : null}
                    </Empty>
                ) : (
                    rows.map(row => {
                        const selected = row.key === selectedKey
                        const movement = riskMovement(row)
                        return (
                            <button
                                key={row.key}
                                ref={element => {
                                    if (element) itemRefs.current.set(row.key, element)
                                    else itemRefs.current.delete(row.key)
                                }}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                tabIndex={selected || (!selectedKey && row === rows[0]) ? 0 : -1}
                                onClick={() => onSelect(row)}
                                aria-label={`${row.smeName}, ${row.riskLevel} risk, score ${row.riskScore}`}
                                onMouseEnter={event => {
                                    if (!selected) event.currentTarget.style.background = token.colorFillQuaternary
                                }}
                                onMouseLeave={event => {
                                    if (!selected) event.currentTarget.style.background = 'transparent'
                                }}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '9px 10px 9px 8px',
                                    marginBottom: 2,
                                    border: `1px solid ${selected ? token.colorPrimaryBorder : 'transparent'}`,
                                    borderLeft: `4px solid ${RISK_LEVEL_COLORS[row.riskLevel]}`,
                                    borderRadius: 10,
                                    background: selected ? token.colorPrimaryBg : 'transparent',
                                    color: 'inherit',
                                    textAlign: 'left',
                                    cursor: 'pointer'
                                }}
                            >
                                <EntityAvatar name={row.smeName} photo={row.photoUrl} size={34} />
                                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                                    <Text strong ellipsis style={{ display: 'block', fontSize: 13.5 }}>
                                        {row.smeName}
                                    </Text>
                                    <Text
                                        type="secondary"
                                        ellipsis
                                        style={{ display: 'block', fontSize: 12 }}
                                    >
                                        {getAttentionSummary(row, isDepartmentScopedView)}
                                    </Text>
                                </div>
                                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                                    <Text strong style={{ fontSize: 15 }}>
                                        {row.riskScore}
                                    </Text>
                                    <div style={{ fontSize: 11, lineHeight: 1.2 }}>
                                        <MovementMark movement={movement} />
                                    </div>
                                </div>
                            </button>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function MovementMark({ movement }: { movement: RiskMovement }) {
    if (movement.kind === 'escalated') {
        return (
            <Text type="danger" style={{ fontSize: 11 }}>
                <ArrowUpOutlined /> {movement.previousLevel ? `from ${movement.previousLevel}` : 'new'}
            </Text>
        )
    }
    if (movement.kind === 'up') {
        return (
            <Text type="danger" style={{ fontSize: 11 }}>
                <ArrowUpOutlined /> {movement.delta}
            </Text>
        )
    }
    if (movement.kind === 'down') {
        return (
            <Text type="success" style={{ fontSize: 11 }}>
                <ArrowDownOutlined /> {-movement.delta}
            </Text>
        )
    }
    return null
}
