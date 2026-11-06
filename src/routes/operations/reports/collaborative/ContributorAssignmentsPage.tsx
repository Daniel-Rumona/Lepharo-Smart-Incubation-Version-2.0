import React, { useEffect, useMemo, useState } from 'react'
import { Empty, Input, Segmented } from 'antd'
import { FileTextOutlined, SearchOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { StatusPill } from '@/routes/operations/movs/movParts'
import { listenContributorBlocks } from './services/reportsService'
import { canUserManageDepartmentBlock, isOperations } from './reportPermissions'
import type { ReportBlock, ReportUserContext } from './types'
import { PageHeader, sectionStatus } from './shared'

type Props = {
    user: ReportUserContext
    onBack?: () => void
    onOpenContribution: (reportId: string, blockId: string) => void
}

type Filter = 'todo' | 'waiting' | 'done' | 'all'

/**
 * My sections: the report sections handed to this person (or their department).
 * "To do" is what needs them now — including coordinators' work a department head
 * must check; "Waiting" is with someone else.
 */
const ContributorAssignmentsPage: React.FC<Props> = ({ user, onBack, onOpenContribution }) => {
    const [blocks, setBlocks] = useState<ReportBlock[]>([])
    const [loaded, setLoaded] = useState(false)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<Filter>('todo')

    useEffect(
        () =>
            listenContributorBlocks(db, user, rows => {
                setBlocks(rows)
                setLoaded(true)
            }),
        [user.uid, user.departmentId]
    )

    const stageOf = (block: ReportBlock): Exclude<Filter, 'all'> => {
        if (block.status === 'approved') return 'done'
        if (block.status === 'submitted') {
            // A coordinator's section sent to the department head is the head's to-do.
            return block.submittedTo === 'department' && canUserManageDepartmentBlock(user, block) ? 'todo' : 'waiting'
        }
        return 'todo'
    }

    const searched = useMemo(() => {
        const q = search.trim().toLowerCase()
        return blocks.filter(b => !q || `${b.title} ${b.sectionTitle} ${b.reportTitle} ${b.periodLabel}`.toLowerCase().includes(q))
    }, [blocks, search])
    const counts = useMemo(() => {
        const c = { todo: 0, waiting: 0, done: 0, all: searched.length }
        searched.forEach(b => c[stageOf(b)]++)
        return c
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searched])
    const rows = filter === 'all' ? searched : searched.filter(b => stageOf(b) === filter)

    return (
        <>
            <PageHeader
                title="My report sections"
                subtitle={
                    isOperations(user) && user.departmentName
                        ? `Sections ${user.departmentName} writes, and ones you handed to coordinators.`
                        : 'Sections you’ve been asked to write.'
                }
                onBack={onBack}
            />
            <DashboardFilterBar>
                <div className="ws-toolbar">
                    <Segmented
                        className="ws-toolbar-status mv-status-strip"
                        block
                        value={filter}
                        onChange={v => setFilter(v as Filter)}
                        aria-label="Filter sections"
                        options={[
                            { value: 'todo', label: 'To do', tone: 'warning' },
                            { value: 'waiting', label: 'Waiting', tone: 'info' },
                            { value: 'done', label: 'Done', tone: 'success' },
                            { value: 'all', label: 'All', tone: 'neutral' }
                        ].map(o => ({
                            value: o.value,
                            label: (
                                <span className="mv-seg">
                                    {o.label}
                                    {loaded ? <span className={`mv-seg-count qtx-tone-${o.tone}`}>{counts[o.value as Filter]}</span> : null}
                                </span>
                            )
                        }))}
                    />
                    <Input
                        className="ws-toolbar-search"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="Search sections or reports"
                        aria-label="Search sections"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </DashboardFilterBar>

            <MotionCard loading={!loaded}>
                {rows.length === 0 ? (
                    <Empty
                        className="ws-list-empty"
                        description={blocks.length === 0 ? 'No report sections have been handed to you.' : filter === 'todo' && !search ? 'Nothing needs you right now.' : 'No sections match.'}
                    />
                ) : (
                    <div className="ws-rows" role="list" aria-label="Report sections">
                        {rows.map(block => {
                            const st = sectionStatus(block)
                            return (
                                <button key={block.id} type="button" role="listitem" className="ws-row" onClick={() => onOpenContribution(block.reportId, block.id)}>
                                    <span className="cr-row-icon" aria-hidden="true">
                                        <FileTextOutlined />
                                    </span>
                                    <div className="ws-row-main">
                                        <div className="ws-row-name">{block.title}</div>
                                        <div className="ws-row-meta">
                                            {[block.reportTitle, block.periodLabel, block.sectionTitle].filter(Boolean).join(' · ')}
                                        </div>
                                        {block.changeRequest?.reason ? (
                                            <div className="mv-row-flags">
                                                <span className="mv-flag is-danger">Changes asked: {block.changeRequest.reason}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="ws-row-side">
                                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
            </MotionCard>
        </>
    )
}

export default ContributorAssignmentsPage
