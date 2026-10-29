import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Drawer, Dropdown, Empty, Grid, Input, Pagination, Progress, Segmented, Select } from 'antd'
import { DeleteOutlined, FileTextOutlined, MoreOutlined, PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { StatusPill } from '@/routes/operations/movs/movParts'
import { deleteReport, getReportTemplateSignature, listenReportBlocks, listenReportsForUser, syncReportWithTemplate } from './services/reportsService'
import { listenReportTemplatesForUser } from './services/reportTemplatesService'
import { canUserManageReport } from './reportPermissions'
import type { ReportBlock, ReportDocument, ReportTemplate, ReportUserContext } from './types'
import { REPORT_STATUS, formatTimestamp, sectionStatus } from './shared'

type Props = {
    user: ReportUserContext
    onCreate: () => void
    onManageTemplates: () => void
    onMyContributions: () => void
    onOpenReport: (reportId: string) => void
}

type StatusFilter = 'writing' | 'review' | 'done' | 'all'

const stageOf = (report: ReportDocument): Exclude<StatusFilter, 'all'> =>
    report.status === 'approved' ? 'done' : report.status === 'review' ? 'review' : 'writing'

const PAGE_SIZE = 12

/**
 * Reports: the list on the left, the chosen report's sections on the right.
 * One main action (New report); templates and "my sections" are links.
 */
const ReportsHubPage: React.FC<Props> = ({ user, onCreate, onManageTemplates, onMyContributions, onOpenReport }) => {
    const { modal, message } = App.useApp()
    const isMobile = !Grid.useBreakpoint().md
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [reports, setReports] = useState<ReportDocument[]>([])
    const [templates, setTemplates] = useState<ReportTemplate[]>([])
    const [loaded, setLoaded] = useState(false)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<StatusFilter>('writing')
    const [program, setProgram] = useState('all')
    const [page, setPage] = useState(1)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [sections, setSections] = useState<ReportBlock[]>([])
    const [busyId, setBusyId] = useState<string | null>(null)

    useEffect(
        () =>
            listenReportsForUser(db, user, rows => {
                setReports(rows)
                setLoaded(true)
            }),
        [user.uid, user.role, user.isAccountManager, user.managedPrograms.join('|')]
    )
    useEffect(
        () => listenReportTemplatesForUser(db, user, setTemplates),
        [user.uid, user.role, user.isAccountManager, user.managedPrograms.join('|')]
    )

    const scoped = useMemo(
        () => (activeProgramId ? reports.filter(item => item.programId === activeProgramId) : reports),
        [reports, activeProgramId]
    )
    const programs = useMemo(
        () => Array.from(new Map(reports.filter(item => item.programId).map(item => [item.programId!, item.programName || item.programId!])).entries()),
        [reports]
    )
    const searched = useMemo(() => {
        const q = search.trim().toLowerCase()
        return scoped.filter(item => {
            const matchesSearch = !q || `${item.title} ${item.periodLabel} ${item.programName || ''}`.toLowerCase().includes(q)
            const matchesProgram = !isAllPrograms || program === 'all' || item.programId === program
            return matchesSearch && matchesProgram
        })
    }, [scoped, search, program, isAllPrograms])
    const counts = useMemo(() => {
        const c = { writing: 0, review: 0, done: 0, all: searched.length }
        searched.forEach(item => c[stageOf(item)]++)
        return c
    }, [searched])
    const rows = status === 'all' ? searched : searched.filter(item => stageOf(item) === status)
    const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    useEffect(() => setPage(1), [status, search, program])

    const selected = reports.find(item => item.id === selectedId) || null
    useEffect(() => {
        if (!selectedId) {
            setSections([])
            return
        }
        return listenReportBlocks(db, selectedId, setSections)
    }, [selectedId])

    // Only templates this person can see carry a signature; a missing one is "unknown", not "out of date".
    const signatures = useMemo(() => new Map(templates.map(t => [t.id, getReportTemplateSignature(t)])), [templates])
    const templateIsNewer = (report: ReportDocument) => {
        const latest = signatures.get(report.templateId)
        return !!latest && latest !== report.templateSignature
    }

    const applyTemplate = async (report: ReportDocument) => {
        setBusyId(report.id)
        try {
            await syncReportWithTemplate({ db, report, user })
            message.success('Updated to the latest template. Everything already written was kept.')
        } catch (error: any) {
            message.error(error?.message || 'Couldn’t update the report to the latest template.')
        } finally {
            setBusyId(null)
        }
    }

    const confirmDelete = (report: ReportDocument) =>
        modal.confirm({
            title: `Delete ${report.title}?`,
            content: 'Its sections, comments and history are deleted too. This can’t be undone.',
            okText: 'Delete report',
            okButtonProps: { danger: true },
            centered: true,
            onOk: async () => {
                setBusyId(report.id)
                try {
                    await deleteReport({ db, report, user })
                    if (selectedId === report.id) setSelectedId(null)
                    message.success('Report deleted.')
                } catch (error: any) {
                    message.error(error?.message || 'Couldn’t delete the report.')
                } finally {
                    setBusyId(null)
                }
            }
        })

    const renderDetail = (report: ReportDocument) => {
        const canManage = canUserManageReport(user, report)
        const menuItems = [
            ...(canManage && templateIsNewer(report) ? [{ key: 'sync', icon: <SyncOutlined />, label: 'Use the latest template' }] : []),
            ...(canManage ? [{ key: 'delete', icon: <DeleteOutlined />, label: 'Delete report', danger: true }] : [])
        ]
        const s = REPORT_STATUS[report.status] || REPORT_STATUS.draft
        const bySection = new Map<string, ReportBlock[]>()
        sections.forEach(b => bySection.set(b.sectionTitle || 'Sections', [...(bySection.get(b.sectionTitle || 'Sections') || []), b]))
        return (
            <MotionCard>
                <div className="cr-detail">
                    <div className="cr-detail-head">
                        <div className="cr-detail-title">{report.title}</div>
                        <div className="cr-detail-sub">
                            {report.periodLabel}
                            {report.programName ? ` · ${report.programName}` : ''}
                            <StatusPill tone={s.tone}>{s.label}</StatusPill>
                            {report.lock?.locked ? <StatusPill tone="danger">Locked</StatusPill> : null}
                        </div>
                    </div>
                    <div className="cr-detail-progress">
                        <Progress percent={report.progressPercent} size="small" showInfo={false} />
                        <span>
                            {report.completedBlocks} of {report.totalBlocks} sections done
                        </span>
                    </div>
                    <div className="cr-actions">
                        <Button type="primary" block onClick={() => onOpenReport(report.id)}>
                            Open report
                        </Button>
                        {menuItems.length ? (
                            <Dropdown
                                trigger={['click']}
                                menu={{
                                    items: menuItems,
                                    onClick: ({ key }) => (key === 'sync' ? void applyTemplate(report) : confirmDelete(report))
                                }}
                            >
                                <Button shape="circle" icon={<MoreOutlined />} aria-label="More actions" loading={busyId === report.id} />
                            </Dropdown>
                        ) : null}
                    </div>
                    {report.sourceReportTitle ? <div className="cr-muted">Copied from {report.sourceReportTitle}</div> : null}
                    <div className="cr-section-list">
                        {Array.from(bySection.entries()).map(([title, blocks]) => (
                            <div key={title} className="cr-section-group">
                                <div className="ws-section-title">{title}</div>
                                {blocks.map(block => {
                                    const st = sectionStatus(block)
                                    const who = block.delegatedUserNames?.length
                                        ? block.delegatedUserNames.join(', ')
                                        : block.editorDepartmentNames?.join(', ') || block.editorUserNames?.join(', ') || 'The report owner'
                                    return (
                                        <div key={block.id} className="cr-section-row">
                                            <div className="cr-section-main">
                                                <div className="cr-section-name">{block.title}</div>
                                                <div className="cr-muted">{who}</div>
                                            </div>
                                            <StatusPill tone={st.tone}>{st.label}</StatusPill>
                                        </div>
                                    )
                                })}
                            </div>
                        ))}
                        {!sections.length ? <div className="cr-muted">No sections yet.</div> : null}
                    </div>
                    <div className="cr-muted">Updated {formatTimestamp(report.updatedAt)}</div>
                </div>
            </MotionCard>
        )
    }

    return (
        <>
            <DashboardFilterBar>
                <div className="ws-toolbar">
                    <Segmented
                        className="ws-toolbar-status mv-status-strip"
                        block
                        value={status}
                        onChange={value => setStatus(value as StatusFilter)}
                        aria-label="Filter reports by status"
                        options={[
                            { value: 'writing', label: 'Writing', tone: 'info' },
                            { value: 'review', label: 'Waiting for review', tone: 'warning' },
                            { value: 'done', label: 'Done', tone: 'success' },
                            { value: 'all', label: 'All', tone: 'neutral' }
                        ].map(o => ({
                            value: o.value,
                            label: (
                                <span className="mv-seg">
                                    {o.label}
                                    {loaded ? <span className={`mv-seg-count qtx-tone-${o.tone}`}>{counts[o.value as StatusFilter]}</span> : null}
                                </span>
                            )
                        }))}
                    />
                    <Input
                        className="ws-toolbar-search"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="Search reports"
                        aria-label="Search reports"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {isAllPrograms && programs.length > 1 ? (
                        <Select
                            className="ws-toolbar-button"
                            value={program}
                            onChange={setProgram}
                            aria-label="Programme"
                            options={[{ value: 'all', label: 'All programmes' }, ...programs.map(([value, label]) => ({ value, label }))]}
                        />
                    ) : null}
                    <Button className="ws-toolbar-button" onClick={onMyContributions}>
                        My sections
                    </Button>
                    {user.canManageTemplates ? (
                        <Button className="ws-toolbar-button" onClick={onManageTemplates}>
                            Templates
                        </Button>
                    ) : null}
                    <Button className="ws-toolbar-button" type="primary" icon={<PlusOutlined />} onClick={onCreate}>
                        New report
                    </Button>
                </div>
            </DashboardFilterBar>

            <div className="ws-layout">
                <MotionCard loading={!loaded}>
                    {rows.length === 0 ? (
                        <Empty
                            className="ws-list-empty"
                            description={
                                reports.length === 0
                                    ? 'No reports yet. Start one with New report.'
                                    : status === 'writing' && !search
                                        ? 'Nothing is being written right now.'
                                        : 'No reports match.'
                            }
                        />
                    ) : (
                        <>
                            <div className="ws-rows" role="listbox" aria-label="Reports">
                                {pageRows.map(item => {
                                    const s = REPORT_STATUS[item.status] || REPORT_STATUS.draft
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            role="option"
                                            aria-selected={item.id === selectedId}
                                            className={`ws-row${item.id === selectedId ? ' is-selected' : ''}`}
                                            onClick={() => setSelectedId(item.id)}
                                        >
                                            <span className="cr-row-icon" aria-hidden="true">
                                                <FileTextOutlined />
                                            </span>
                                            <div className="ws-row-main">
                                                <div className="ws-row-name">{item.title}</div>
                                                <div className="ws-row-meta">
                                                    {[item.periodLabel, item.programName, `${item.completedBlocks}/${item.totalBlocks} sections done`].filter(Boolean).join(' · ')}
                                                </div>
                                            </div>
                                            <div className="ws-row-side">
                                                <StatusPill tone={s.tone}>{s.label}</StatusPill>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                            {rows.length > PAGE_SIZE ? (
                                <div className="ws-pagination">
                                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} showSizeChanger={false} showLessItems />
                                </div>
                            ) : null}
                        </>
                    )}
                </MotionCard>
                {!isMobile ? (
                    <div className="ws-detail-sticky">
                        {selected ? (
                            renderDetail(selected)
                        ) : (
                            <MotionCard>
                                <Empty className="ws-detail-empty" description="Choose a report to see its sections." />
                            </MotionCard>
                        )}
                    </div>
                ) : null}
            </div>

            {isMobile ? (
                <Drawer
                    className="ws-drawer ws-sheet"
                    open={!!selected}
                    onClose={() => setSelectedId(null)}
                    placement="bottom"
                    height="92vh"
                    title={selected?.title || 'Report'}
                >
                    {selected ? renderDetail(selected) : null}
                </Drawer>
            ) : null}
        </>
    )
}

export default ReportsHubPage
