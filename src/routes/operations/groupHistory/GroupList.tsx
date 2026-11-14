import React, { useEffect, useState } from 'react'
import { Button, Checkbox, Empty, Pagination, Tag } from 'antd'
import { RiseOutlined, SortAscendingOutlined, TeamOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import { groupLabel, type GroupEligibility } from '@/services/groupLifecycleService'
import { MOVEMENT_META, groupColors, movementStateOf, type SmeGroupRow } from './groupData'
import type { GroupSort } from './GroupFilters'

const PAGE_SIZE = 12

const SORT_OPTIONS: SortOption<GroupSort>[] = [
    { value: 'progress', label: 'Closest to moving', icon: <RiseOutlined /> },
    { value: 'group', label: 'Group', icon: <TeamOutlined /> },
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> }
]

/** Ticking rows for a batch action: ROM submits ready SMEs, M&E confirms pending moves. */
export type GroupSelection = {
    keys: string[]
    onChange: (keys: string[]) => void
    canSelect: (row: SmeGroupRow) => boolean
    actionLabel: string
    onAction: () => void
    loading: boolean
    busy: boolean
}

type Props = {
    rows: SmeGroupRow[]
    loading: boolean
    selectedKey?: string
    onSelect: (row: SmeGroupRow) => void
    sort: GroupSort
    onSortChange: (sort: GroupSort) => void
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
    eligibilityFor: (row: SmeGroupRow) => GroupEligibility
    selection?: GroupSelection
    /** Under All Programs, each row names its programme. */
    showProgram?: boolean
}

export const GroupList: React.FC<Props> = ({
    rows,
    loading,
    selectedKey,
    onSelect,
    sort,
    onSortChange,
    resetKey,
    eligibilityFor,
    selection,
    showProgram
}) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected SME's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedKey) return
        const index = rows.findIndex(r => r.key === selectedKey)
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedKey])

    const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const selectable = selection ? rows.filter(selection.canSelect).map(r => r.key) : []
    const ticked = selection ? selection.keys.filter(k => selectable.includes(k)) : []

    const toggle = (key: string, on: boolean) =>
        selection?.onChange(on ? [...ticked, key] : ticked.filter(k => k !== key))

    return (
        <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={onSortChange} label='Sort SMEs' />

            {selection && selectable.length > 0 && (
                <div className='gpx-bulk'>
                    <Checkbox
                        checked={ticked.length === selectable.length}
                        indeterminate={ticked.length > 0 && ticked.length < selectable.length}
                        onChange={e => selection.onChange(e.target.checked ? selectable : [])}
                    >
                        {ticked.length ? `${ticked.length} selected` : `Select all (${selectable.length})`}
                    </Checkbox>
                    <Button
                        type='primary'
                        size='small'
                        loading={selection.loading}
                        disabled={selection.busy || !ticked.length}
                        onClick={selection.onAction}
                    >
                        {selection.actionLabel}
                    </Button>
                </div>
            )}

            {rows.length === 0 ? (
                <Empty className='ws-list-empty' description='No SMEs match these filters' />
            ) : (
                <>
                    {/* Keyed by page, filters and sort, so each new set of rows staggers in. */}
                    <div key={`${page}|${resetKey}|${sort}`} className='ws-rows' role='listbox' aria-label='SMEs'>
                        {pageItems.map((row, index) => {
                            const eligibility = eligibilityFor(row)
                            const state = MOVEMENT_META[movementStateOf(row, eligibility)]
                            const selected = row.key === selectedKey
                            const meta = [showProgram && row.programName, row.stage, row.email].filter(Boolean).join(' · ')
                            const canTick = !!selection?.canSelect(row)
                            return (
                                <motion.div
                                    key={row.key}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    role='option'
                                    tabIndex={0}
                                    aria-selected={selected}
                                    className={`ws-row${selected ? ' is-selected' : ''}`}
                                    onClick={() => onSelect(row)}
                                    onKeyDown={e => {
                                        if (e.target !== e.currentTarget) return
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            onSelect(row)
                                        }
                                    }}
                                >
                                    {selection && (
                                        // Its own click target: ticking doesn't open the SME.
                                        <span className='gpx-tick' onClick={e => e.stopPropagation()}>
                                            <Checkbox
                                                checked={ticked.includes(row.key)}
                                                disabled={!canTick}
                                                onChange={e => toggle(row.key, e.target.checked)}
                                                aria-label={`Select ${row.name}`}
                                            />
                                        </span>
                                    )}
                                    <EntityAvatar name={row.name} photo={row.photoUrl} size={36} />
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{row.name}</div>
                                        <div className='ws-row-meta'>{meta || 'No email address'}</div>
                                        <div
                                            className={`gpx-bar${eligibility.eligible || !eligibility.target ? ' is-done' : ''}`}
                                            role='progressbar'
                                            aria-label='Progress to the next group'
                                            aria-valuenow={eligibility.progress}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                        >
                                            <span style={{ width: `${eligibility.progress}%` }} />
                                        </div>
                                    </div>
                                    <div className='ws-row-side'>
                                        <Tag color={groupColors[row.group]} bordered={false}>
                                            {groupLabel(row.group)}
                                        </Tag>
                                        <Tag color={state.color} bordered={false}>
                                            {state.label}
                                        </Tag>
                                    </div>
                                </motion.div>
                            )
                        })}
                    </div>

                    {rows.length > PAGE_SIZE && (
                        <div className='ws-pagination'>
                            <Pagination
                                size='small'
                                current={page}
                                pageSize={PAGE_SIZE}
                                total={rows.length}
                                onChange={setPage}
                                showSizeChanger={false}
                            />
                        </div>
                    )}
                </>
            )}
        </MotionCard>
    )
}
