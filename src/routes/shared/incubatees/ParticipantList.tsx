
import React, { useEffect, useState } from 'react'
import { Empty, Pagination, Tag } from 'antd'
import {
    ClockCircleOutlined,
    DollarCircleOutlined,
    SortAscendingOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import type { SmeRow } from './participantsData'
import { smeStatusColor } from './SmeStatusPanel'

export type ParticipantSort = 'name' | 'revenue' | 'employees' | 'newest'

export const PARTICIPANT_SORT_OPTIONS: SortOption<ParticipantSort>[] = [
    { value: 'name', label: 'Company A–Z', icon: <SortAscendingOutlined /> },
    { value: 'revenue', label: 'Highest revenue', icon: <DollarCircleOutlined /> },
    { value: 'employees', label: 'Most employees', icon: <TeamOutlined /> },
    { value: 'newest', label: 'Newest onboarded', icon: <ClockCircleOutlined /> }
]

const PAGE_SIZE = 10

type Props = {
    rows: SmeRow[]
    loading: boolean
    selectedId?: string | null
    onSelect: (row: SmeRow) => void
    sort: ParticipantSort
    onSortChange: (sort: ParticipantSort) => void
    /** Changes whenever the filters do, so the list returns to page 1. */
    resetKey: string
}

export const ParticipantList: React.FC<Props> = ({
    rows,
    loading,
    selectedId,
    onSelect,
    sort,
    onSortChange,
    resetKey
}) => {
    const [page, setPage] = useState(1)
    const reduceMotion = useReducedMotion()

    useEffect(() => setPage(1), [resetKey, sort])

    // Keep the selected SME's page in view when it changes from outside.
    useEffect(() => {
        if (!selectedId) return

        const index = rows.findIndex(r => r.appId === selectedId)

        if (index >= 0) {
            setPage(Math.floor(index / PAGE_SIZE) + 1)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId])

    const pageItems = rows.slice(
        (page - 1) * PAGE_SIZE,
        page * PAGE_SIZE
    )

    return (
        <div data-guide='sme-overview-list'>
            <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
                <SortSelect
                    value={sort}
                    options={PARTICIPANT_SORT_OPTIONS}
                    onChange={onSortChange}
                    label='Sort SMEs'
                />

                {rows.length === 0 ? (
                    <Empty
                        className='ws-list-empty'
                        description='No SMEs match these filters'
                    />
                ) : (
                    <>
                        <div
                            key={`${page}|${resetKey}|${sort}`}
                            className='ws-rows'
                            role='listbox'
                            aria-label='SMEs'
                        >
                            {pageItems.map((row, index) => {
                                const selected = row.appId === selectedId

                                const meta = [
                                    row.registrationNumber || row.smmeNo,
                                    row.province || row.town
                                ]
                                    .filter(Boolean)
                                    .join(' · ')

                                return (
                                    <motion.button
                                        key={row.appId}
                                        data-guide='sme-list-card'
                                        initial={
                                            reduceMotion
                                                ? false
                                                : { opacity: 0, y: 8 }
                                        }
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            duration: 0.24,
                                            ease: 'easeOut',
                                            delay: Math.min(index * 0.035, 0.3)
                                        }}
                                        type='button'
                                        role='option'
                                        aria-selected={selected}
                                        className={`ws-row${selected ? ' is-selected' : ''}`}
                                        onClick={() => onSelect(row)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 10,
                                            width: '100%'
                                        }}
                                    >
                                        <EntityAvatar
                                            name={row.companyName}
                                            photo={row.photoUrl}
                                            size={36}
                                        />

                                        <div
                                            className='ws-row-main'
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'flex-start',
                                                gap: 4
                                            }}
                                        >
                                            {/* SME identity */}
                                            <div
                                                className='ws-row-name'
                                                style={{
                                                    width: '100%',
                                                    textAlign: 'left'
                                                }}
                                            >
                                                {row.companyName}
                                            </div>

                                            <div
                                                className='ws-row-meta'
                                                style={{
                                                    width: '100%',
                                                    textAlign: 'left'
                                                }}
                                            >
                                                {meta || row.sector || '—'}
                                            </div>

                                            {/* Status, group and employees below identity */}
                                            <div
                                                className='ptx-row-badges'
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'flex-start',
                                                    flexWrap: 'wrap',
                                                    gap: 6,
                                                    width: '100%',
                                                    marginTop: 5,
                                                    textAlign: 'left'
                                                }}
                                            >
                                                <Tag
                                                    color={smeStatusColor(row.incubationStatus)}
                                                    style={{ marginInlineEnd: 0 }}
                                                >
                                                    {row.incubationStatus || 'Active'}
                                                </Tag>

                                                {row.group && (
                                                    <Tag
                                                        bordered={false}
                                                        className='ptx-group-tag'
                                                        style={{ marginInlineEnd: 0 }}
                                                    >
                                                        Group {row.group}
                                                    </Tag>
                                                )}

                                                <span
                                                    className='ptx-row-staff'
                                                    title='Current employees'
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 5,
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    <TeamOutlined aria-hidden='true' />
                                                    {row.metrics.currentEmployees || 0}
                                                </span>

                                                {row.exitQualified && (
                                                    <Tag
                                                        color='red'
                                                        style={{ marginInlineEnd: 0 }}
                                                    >
                                                        Exit review due
                                                    </Tag>
                                                )}
                                            </div>
                                        </div>
                                    </motion.button>
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
                                    showLessItems
                                />
                            </div>
                        )}
                    </>
                )}
            </MotionCard>
        </div>
    )
}
