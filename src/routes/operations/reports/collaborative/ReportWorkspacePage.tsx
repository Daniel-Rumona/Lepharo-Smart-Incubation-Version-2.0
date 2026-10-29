import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Dropdown, Empty, Input, Modal, Progress, Radio, Segmented, Select, Space, Upload } from 'antd'
import type { UploadProps } from 'antd'
import {
    DownOutlined,
    DownloadOutlined,
    EyeOutlined,
    LockOutlined,
    MoreOutlined,
    PaperClipOutlined,
    SettingOutlined,
    TeamOutlined,
    UnlockOutlined
} from '@ant-design/icons'
import { db, storage } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { StatusPill } from '@/routes/operations/movs/movParts'
import {
    SectionChangedError,
    acceptCoordinatorSubmission,
    addReportBlockAttachmentMetadata,
    approveReportBlock,
    delegateReportBlock,
    listenContributorBlocks,
    listenReport,
    listenReportActivity,
    listenReportBlocks,
    reopenReportBlock,
    requestReportBlockChanges,
    saveReportBlock,
    submitReportBlock,
    updateReportLock,
    updateReportProjectAdminMode
} from './services/reportsService'
import { loadReportUsers } from './services/reportDirectoryService'
import { uploadReportBlockAttachment } from './services/reportStorageService'
import { downloadDocx, generateReportDocx, summarizeExport } from './services/docxGenerationService'
import { getReportTemplate } from './services/reportTemplatesService'
import { requestReportWriting, type ReportWritingAction } from './services/aiReportWritingService'
import {
    canUserApproveBlock,
    canUserControlProjectAdminMode,
    canUserDelegateBlock,
    canUserEditBlock,
    canUserManageDepartmentBlock,
    canUserManageReport,
    canUserReopenBlock,
    canUserReviewContributorSubmission,
    canUserViewBlock,
    canUserViewFullReport,
    isOperations,
    isProjectAdmin
} from './reportPermissions'
import type { ProjectAdminMode, ReportActivity, ReportBlock, ReportDirectoryUser, ReportDocument, ReportUserContext } from './types'
import { CONTENT_TYPE_LABEL, PageHeader, formatTimestamp, sectionStatus } from './shared'
import NarrativeBlockEditor from './components/NarrativeBlockEditor'
import StructuredTableEditor from './components/StructuredTableEditor'
import BlockCommentsPanel from './components/BlockCommentsPanel'
import BlockHistoryPanel from './components/BlockHistoryPanel'

type Props = {
    user: ReportUserContext
    reportId: string
    forceContributorOnly?: boolean
    initialBlockId?: string
    onBack: () => void
    onPreview?: () => void
}

const AI_ACTIONS: { key: ReportWritingAction; label: string }[] = [
    { key: 'improve', label: 'Improve the writing' },
    { key: 'summarise', label: 'Make it shorter' },
    { key: 'expand', label: 'Add more detail' },
    { key: 'commentary', label: 'Draft commentary' },
    { key: 'risk_mitigation', label: 'Suggest risks and mitigations' }
]

const emptyContentFor = (block: ReportBlock) =>
    block.content ?? (block.contentType === 'table' || block.contentType === 'kpi' ? { rows: [] } : '')

const ReportWorkspacePage: React.FC<Props> = ({ user, reportId, forceContributorOnly = false, initialBlockId, onBack, onPreview }) => {
    const { message, modal } = App.useApp()
    const [report, setReport] = useState<ReportDocument | null>(null)
    const [blocks, setBlocks] = useState<ReportBlock[]>([])
    const [activeId, setActiveId] = useState(initialBlockId || '')
    const [draftContent, setDraftContent] = useState<any>('')
    /** The section's updatedAt when its text was loaded into the editor. */
    const [draftBase, setDraftBase] = useState<any>(null)
    const [dirty, setDirty] = useState(false)
    /** Set when someone else saved this section while it had unsaved edits here. */
    const [changedBy, setChangedBy] = useState<string | null>(null)

    const [saving, setSaving] = useState(false)
    const [generatingWord, setGeneratingWord] = useState(false)
    const [aiWriting, setAiWriting] = useState(false)
    const [aiSuggestion, setAiSuggestion] = useState('')
    const [lowerTab, setLowerTab] = useState('Comments')
    const [activity, setActivity] = useState<ReportActivity[]>([])
    const [changeReason, setChangeReason] = useState('')
    const [requestOpen, setRequestOpen] = useState(false)
    const [requestTarget, setRequestTarget] = useState<'contributor' | 'department'>('department')

    const [coordinators, setCoordinators] = useState<ReportDirectoryUser[]>([])
    const [delegateOpen, setDelegateOpen] = useState(false)
    const [delegateIds, setDelegateIds] = useState<string[]>([])

    const [accessOpen, setAccessOpen] = useState(false)
    const [projectAdminMode, setProjectAdminMode] = useState<ProjectAdminMode>('manage')
    const [lockReason, setLockReason] = useState('')

    useEffect(() => listenReport(db, reportId, setReport), [reportId])

    const fullView = !!report && canUserViewFullReport(user, report) && !forceContributorOnly
    const reportManager = !!report && canUserManageReport(user, report)
    const canControlAccess = !!report && canUserControlProjectAdminMode(user, report)

    useEffect(() => {
        if (!report) return
        if (fullView) return listenReportBlocks(db, reportId, setBlocks)
        return listenContributorBlocks(db, user, rows => setBlocks(rows.filter(block => block.reportId === reportId)))
    }, [reportId, report?.id, fullView, user.uid, user.departmentId])

    useEffect(() => {
        if (!report || !fullView) {
            setActivity([])
            return
        }
        return listenReportActivity(db, reportId, setActivity)
    }, [reportId, report?.id, fullView])

    useEffect(() => {
        if (!isOperations(user) || !user.departmentId) {
            setCoordinators([])
            return
        }
        loadReportUsers(db)
            .then(rows => setCoordinators(rows.filter(item => item.departmentId === user.departmentId)))
            .catch(() => setCoordinators([]))
    }, [user.uid, user.role, user.departmentId])

    useEffect(() => {
        if (!report) return
        setProjectAdminMode(report.access?.projectAdminMode || 'manage')
        setLockReason(report.lock?.reason || '')
    }, [report?.id, report?.access?.projectAdminMode, report?.lock?.locked])

    const visibleBlocks = useMemo(() => {
        if (!report) return []
        if (fullView) return blocks
        return blocks.filter(block => canUserViewBlock(user, report, block))
    }, [blocks, report, fullView, user])

    useEffect(() => {
        if (!visibleBlocks.length) {
            setActiveId('')
            return
        }
        if (!activeId || !visibleBlocks.some(block => block.id === activeId)) {
            setActiveId(initialBlockId && visibleBlocks.some(block => block.id === initialBlockId) ? initialBlockId : visibleBlocks[0].id)
        }
    }, [visibleBlocks, activeId, initialBlockId])

    const active = visibleBlocks.find(block => block.id === activeId) || null

    // Load the text when the section changes — only then. (Reloading on every update,
    // as before, wiped what someone was typing whenever anyone saved anything.)
    useEffect(() => {
        if (!active) return
        setDraftContent(JSON.parse(JSON.stringify(emptyContentFor(active))))
        setDraftBase(active.updatedAt ?? null)
        setDirty(false)
        setChangedBy(null)
        setDelegateIds(active.delegatedUserIds || [])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.id])

    // The section changed on the server: take it if nothing is unsaved here, else say so.
    const activeUpdatedMs = active?.updatedAt?.toMillis?.() ?? 0
    useEffect(() => {
        if (!active) return
        if (!dirty) {
            setDraftContent(JSON.parse(JSON.stringify(emptyContentFor(active))))
            setDraftBase(active.updatedAt ?? null)
            setChangedBy(null)
        } else if (active.updatedBy === user.uid) {
            setDraftBase(active.updatedAt ?? null)
        } else if ((draftBase?.toMillis?.() ?? 0) !== activeUpdatedMs) {
            setChangedBy(active.updatedByName || 'Someone else')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeUpdatedMs])

    // Leaving with unsaved text asks first.
    useEffect(() => {
        if (!dirty) return
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [dirty])

    const editDraft = (value: any) => {
        setDraftContent(value)
        setDirty(true)
    }

    const reloadSection = () => {
        if (!active) return
        setDraftContent(JSON.parse(JSON.stringify(emptyContentFor(active))))
        setDraftBase(active.updatedAt ?? null)
        setDirty(false)
        setChangedBy(null)
    }

    const switchTo = (id: string) => {
        if (id === activeId) return
        if (!dirty) return setActiveId(id)
        modal.confirm({
            title: 'Leave this section without saving?',
            content: 'Your changes to this section haven’t been saved.',
            okText: 'Leave without saving',
            cancelText: 'Stay',
            centered: true,
            onOk: () => setActiveId(id)
        })
    }

    const leavePage = () => {
        if (!dirty) return onBack()
        modal.confirm({
            title: 'Leave without saving?',
            content: 'Your changes to this section haven’t been saved.',
            okText: 'Leave',
            cancelText: 'Stay',
            centered: true,
            onOk: onBack
        })
    }

    const editable = !!report && !!active && canUserEditBlock(user, report, active)
    const departmentManager = !!active && canUserManageDepartmentBlock(user, active)
    const delegatedContributor = !!active && !departmentManager && !reportManager && (active.delegatedUserIds.includes(user.uid) || active.editorUserIds.includes(user.uid))
    const reviewContributor = !!active && canUserReviewContributorSubmission(user, active)
    const canApprove = !!report && !!active && canUserApproveBlock(user, report, active)
    const canReopen = !!report && !!active && canUserReopenBlock(user, report, active)
    const canDelegate = !!report && !!active && canUserDelegateBlock(user, report, active)
    const submittedToOwner = !!active && active.status === 'submitted' && active.submittedTo === 'report_manager'

    const run = async (work: () => Promise<void>, done: string, failed: string) => {
        setSaving(true)
        try {
            await work()
            message.success(done)
        } catch (err: any) {
            if (err instanceof SectionChangedError) setChangedBy(err.message.split(' changed')[0] || 'Someone else')
            message.error(err?.message || failed)
        } finally {
            setSaving(false)
        }
    }

    const persist = async (summary?: string) => {
        if (!active) return
        await saveReportBlock({ db, block: active, user, content: draftContent, summary, baseUpdatedAt: draftBase })
        setDirty(false)
    }

    const save = () => run(() => persist(), 'Saved.', 'Couldn’t save the section.')

    const submit = () => {
        if (!active || !report || !editable) return
        if (active.evidencePolicy === 'required' && !active.attachments?.length) {
            message.error('Attach the supporting evidence first. This section needs it.')
            return
        }
        const target = delegatedContributor && active.editorDepartmentIds.length ? 'department' : 'report_manager'
        return run(
            async () => {
                await persist('Saved before sending for review.')
                await submitReportBlock({ db, block: { ...active, status: active.status === 'not_started' ? 'draft' : active.status, content: draftContent }, user, target })
            },
            target === 'department' ? 'Sent to your department head.' : 'Sent to the report owner for review.',
            'Couldn’t send the section.'
        )
    }

    const acceptAndForward = () =>
        active && run(() => acceptCoordinatorSubmission({ db, block: active, user }), 'Accepted and sent to the report owner.', 'Couldn’t send it on.')

    const approve = () =>
        active &&
        run(
            async () => {
                // The owner may have edited before approving; a first save moves "not started" to "in progress".
                const saved = dirty && editable
                if (saved) await persist('Saved before approving.')
                await approveReportBlock({
                    db,
                    block: saved && active.status === 'not_started' ? { ...active, status: 'draft' } : active,
                    user
                })
            },
            'Section done.',
            'Couldn’t approve the section.'
        )

    const reopen = () => active && run(() => reopenReportBlock({ db, block: active, user }), 'Reopened for editing.', 'Couldn’t reopen the section.')

    const openRequestChanges = (target: 'contributor' | 'department') => {
        setRequestTarget(target)
        setChangeReason('')
        setRequestOpen(true)
    }

    const requestChanges = async () => {
        if (!active || !changeReason.trim()) return
        await run(
            async () => {
                await requestReportBlockChanges({ db, block: active, user, reason: changeReason.trim(), target: requestTarget })
                setRequestOpen(false)
            },
            'Changes asked for.',
            'Couldn’t send the request.'
        )
    }

    const saveDelegation = async () => {
        if (!active || !canDelegate) return
        const chosen = coordinators.filter(item => delegateIds.includes(item.id))
        await run(
            async () => {
                await delegateReportBlock({ db, block: active, user, contributorIds: chosen.map(i => i.id), contributorNames: chosen.map(i => i.name) })
                setDelegateOpen(false)
            },
            chosen.length ? 'Handed over.' : 'Taken back.',
            'Couldn’t update who writes this section.'
        )
    }

    const saveAccess = async () => {
        if (!report || !canControlAccess) return
        await run(
            async () => {
                await updateReportProjectAdminMode({ db, report, user, mode: projectAdminMode })
                setAccessOpen(false)
            },
            'Access updated.',
            'Couldn’t update access.'
        )
    }

    const toggleLock = () =>
        report &&
        run(
            () => updateReportLock({ db, report, user, locked: !report.lock?.locked, reason: report.lock?.locked ? undefined : lockReason.trim() || 'Locked by the report owner.' }),
            report.lock?.locked ? 'Report unlocked.' : 'Report locked.',
            'Couldn’t change the lock.'
        )

    const downloadWord = async () => {
        if (!report || !fullView) return
        const { unmapped, unfinished } = summarizeExport(blocks)
        const go = async () => {
            setGeneratingWord(true)
            try {
                const template = await getReportTemplate(db, report.templateId)
                const file = await generateReportDocx({ template, blocks })
                downloadDocx(file, `${report.title}-${report.periodLabel}.docx`)
            } catch (err: any) {
                message.error(err?.message || 'Couldn’t make the Word document.')
            } finally {
                setGeneratingWord(false)
            }
        }
        if (!unmapped.length && !unfinished.length) return go()
        modal.confirm({
            title: 'Download anyway?',
            centered: true,
            okText: 'Download',
            content: (
                <div className="cr-confirm-list">
                    {unfinished.length ? <p>{unfinished.length} section{unfinished.length === 1 ? ' isn’t' : 's aren’t'} done yet; they’re included as they are.</p> : null}
                    {unmapped.length ? (
                        <p>
                            Not linked to the Word template, so left out: {unmapped.slice(0, 5).join(', ')}
                            {unmapped.length > 5 ? ` and ${unmapped.length - 5} more` : ''}.
                        </p>
                    ) : null}
                </div>
            ),
            onOk: go
        })
    }

    const assistWriting = async (action: ReportWritingAction) => {
        if (!active || !editable) return
        setAiWriting(true)
        try {
            setAiSuggestion(await requestReportWriting(action, active, draftContent))
        } catch (err: any) {
            message.error(err?.message || 'The AI couldn’t help with this just now.')
        } finally {
            setAiWriting(false)
        }
    }

    const uploadProps: UploadProps = {
        showUploadList: false,
        beforeUpload: async file => {
            if (!active || !editable) return false
            try {
                const uploaded = await uploadReportBlockAttachment(storage, active.reportId, active.id, file as File)
                await addReportBlockAttachmentMetadata({ db, block: active, user, attachment: uploaded })
                message.success('Evidence attached.')
            } catch (err: any) {
                message.error(err?.message || 'Couldn’t attach the file.')
            }
            return false
        }
    }

    const grouped = useMemo(() => {
        const map = new Map<string, ReportBlock[]>()
        visibleBlocks.forEach(block => map.set(block.sectionTitle || 'Sections', [...(map.get(block.sectionTitle || 'Sections') || []), block]))
        return Array.from(map.entries())
    }, [visibleBlocks])

    if (!report) return <div className="cr-muted" style={{ padding: 48, textAlign: 'center' }}>Loading the report…</div>

    if (!fullView && !visibleBlocks.length) {
        return (
            <MotionCard>
                <Empty description="None of this report’s sections are yours to write." />
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <Button onClick={onBack}>Back</Button>
                </div>
            </MotionCard>
        )
    }

    const projectAdminReadOnly = isProjectAdmin(user) && report.access?.projectAdminMode === 'read_only'
    const reportMenu = [
        ...(canControlAccess
            ? [
                { key: 'lock', icon: report.lock?.locked ? <UnlockOutlined /> : <LockOutlined />, label: report.lock?.locked ? 'Unlock report' : 'Lock report' },
                { key: 'access', icon: <SettingOutlined />, label: 'Project admin access' }
            ]
            : [])
    ]

    const st = active ? sectionStatus(active) : null
    const primaryAction = !active ? null : canReopen ? (
        <Button onClick={reopen} loading={saving}>
            Reopen
        </Button>
    ) : reviewContributor ? (
        <>
            <Button danger onClick={() => openRequestChanges('contributor')}>
                Ask for changes
            </Button>
            <Button type="primary" onClick={acceptAndForward} loading={saving}>
                Accept and send on
            </Button>
        </>
    ) : canApprove ? (
        <>
            {submittedToOwner ? (
                <Button danger onClick={() => openRequestChanges('department')}>
                    Ask for changes
                </Button>
            ) : null}
            <Button type="primary" onClick={approve} loading={saving}>
                {submittedToOwner ? 'Approve' : 'Mark as done'}
            </Button>
        </>
    ) : editable && active.status !== 'submitted' ? (
        <Button type="primary" onClick={submit} loading={saving}>
            {delegatedContributor && active.editorDepartmentIds.length ? 'Send to department head' : 'Send for review'}
        </Button>
    ) : null

    return (
        <div className="cr-workspace">
            <PageHeader
                title={report.title}
                subtitle={`${report.periodLabel}${report.programName ? ` · ${report.programName}` : ''} · ${report.completedBlocks} of ${report.totalBlocks} sections done`}
                onBack={leavePage}
                actions={
                    fullView ? (
                        <Space wrap>
                            {onPreview ? (
                                <Button icon={<EyeOutlined />} onClick={onPreview}>
                                    Preview
                                </Button>
                            ) : null}
                            <Button icon={<DownloadOutlined />} loading={generatingWord} onClick={() => void downloadWord()}>
                                Download Word
                            </Button>
                            {reportMenu.length ? (
                                <Dropdown
                                    trigger={['click']}
                                    menu={{ items: reportMenu, onClick: ({ key }) => (key === 'lock' ? void toggleLock() : setAccessOpen(true)) }}
                                >
                                    <Button shape="circle" icon={<MoreOutlined />} aria-label="More report actions" />
                                </Dropdown>
                            ) : null}
                        </Space>
                    ) : null
                }
            />

            {report.lock?.locked ? <Alert type="error" showIcon message="This report is locked" description={report.lock.reason || 'Nobody can edit it until the report owner unlocks it.'} /> : null}
            {projectAdminReadOnly ? <Alert type="warning" showIcon message="You can view this report, but not edit it. The report owner can change that." /> : null}

            <div className="cr-workspace-grid">
                <MotionCard className="cr-sections-card">
                    <div className="cr-sections-head">
                        <span className="ws-section-title">{fullView ? 'Sections' : 'Your sections'}</span>
                        <Progress percent={report.progressPercent} size="small" showInfo={false} />
                    </div>
                    <div className="cr-sections-nav">
                        {grouped.map(([title, sectionBlocks]) => (
                            <div key={title} className="cr-nav-group">
                                <div className="cr-nav-group-title">{title}</div>
                                {sectionBlocks.map(block => {
                                    const s = sectionStatus(block)
                                    return (
                                        <button
                                            key={block.id}
                                            type="button"
                                            className={`cr-nav-item${activeId === block.id ? ' is-active' : ''}`}
                                            aria-current={activeId === block.id}
                                            onClick={() => switchTo(block.id)}
                                        >
                                            <span className="cr-nav-name">{block.title}</span>
                                            <StatusPill tone={s.tone}>{s.label}</StatusPill>
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </MotionCard>

                <div className="cr-editor-col">
                    <MotionCard>
                        {active && st ? (
                            <div className="cr-editor">
                                <div className="cr-editor-head">
                                    <div className="cr-editor-title">
                                        <h2>{active.title}</h2>
                                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                                        {dirty ? <StatusPill tone="warning">Unsaved</StatusPill> : null}
                                    </div>
                                    <div className="cr-muted">
                                        {CONTENT_TYPE_LABEL[active.contentType]} · Written by{' '}
                                        {active.delegatedUserNames?.length
                                            ? active.delegatedUserNames.join(', ')
                                            : active.editorDepartmentNames?.length
                                                ? active.editorDepartmentNames.join(', ')
                                                : 'the report owner'}
                                        {active.carriedFromPeriodLabel ? ` · Copied from ${active.carriedFromPeriodLabel}` : ''}
                                    </div>
                                    {active.changeRequest?.reason ? <Alert type="warning" showIcon message={`Changes asked: ${active.changeRequest.reason}`} /> : null}
                                    {changedBy ? (
                                        <Alert
                                            type="warning"
                                            showIcon
                                            message={`${changedBy} changed this section while you were editing.`}
                                            description="Reloading shows their version and drops your unsaved changes. Copy anything you want to keep first."
                                            action={
                                                <Button size="small" onClick={reloadSection}>
                                                    Reload section
                                                </Button>
                                            }
                                        />
                                    ) : null}
                                </div>

                                {active.contentType === 'narrative' ? (
                                    <NarrativeBlockEditor value={typeof draftContent === 'string' ? draftContent : ''} onChange={editDraft} readOnly={!editable} />
                                ) : active.contentType === 'table' || active.contentType === 'kpi' ? (
                                    <StructuredTableEditor
                                        columns={active.schema?.columns || []}
                                        value={draftContent}
                                        onChange={editDraft}
                                        readOnly={!editable}
                                        kpiMode={active.contentType === 'kpi'}
                                    />
                                ) : (
                                    <div className="cr-static-text">{String(draftContent || '')}</div>
                                )}

                                <div className="cr-editor-foot">
                                    <Space wrap>
                                        {active.evidencePolicy !== 'none' ? (
                                            <Upload {...uploadProps}>
                                                <Button icon={<PaperClipOutlined />} disabled={!editable}>
                                                    {active.evidencePolicy === 'required' ? 'Attach evidence (needed)' : 'Attach evidence'}
                                                </Button>
                                            </Upload>
                                        ) : null}
                                        {active.attachments?.length ? <span className="cr-muted">{active.attachments.length} file{active.attachments.length === 1 ? '' : 's'} attached</span> : null}
                                        {canDelegate ? (
                                            <Button icon={<TeamOutlined />} onClick={() => { setDelegateIds(active.delegatedUserIds || []); setDelegateOpen(true) }}>
                                                Hand to a coordinator
                                            </Button>
                                        ) : null}
                                        {editable && active.contentType !== 'static' ? (
                                            <Dropdown
                                                trigger={['click']}
                                                disabled={aiWriting}
                                                menu={{ items: AI_ACTIONS.map(a => ({ key: a.key, label: a.label })), onClick: ({ key }) => void assistWriting(key as ReportWritingAction) }}
                                            >
                                                <Button loading={aiWriting}>
                                                    AI help <DownOutlined />
                                                </Button>
                                            </Dropdown>
                                        ) : null}
                                    </Space>
                                    <Space wrap>
                                        {editable ? (
                                            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
                                                Save
                                            </Button>
                                        ) : null}
                                        {primaryAction}
                                    </Space>
                                </div>
                            </div>
                        ) : (
                            <Empty description="Choose a section." />
                        )}
                    </MotionCard>

                    {active ? (
                        <MotionCard>
                            <Segmented
                                value={lowerTab}
                                onChange={v => setLowerTab(String(v))}
                                options={fullView ? ['Comments', 'History', 'Activity'] : ['Comments', 'History']}
                            />
                            <div className="cr-lower">
                                {lowerTab === 'Comments' ? <BlockCommentsPanel blockId={active.id} user={user} /> : null}
                                {lowerTab === 'History' ? <BlockHistoryPanel blockId={active.id} /> : null}
                                {lowerTab === 'Activity' ? (
                                    activity.length ? (
                                        <div className="cr-activity">
                                            {activity.slice(0, 20).map(item => (
                                                <div key={item.id} className="cr-activity-item">
                                                    <strong>{item.createdByName}</strong> {item.detail || item.action}
                                                    <div className="cr-muted">{formatTimestamp(item.createdAt)}</div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" />
                                    )
                                ) : null}
                            </div>
                        </MotionCard>
                    ) : null}
                </div>
            </div>

            <Modal
                open={!!aiSuggestion}
                title="AI suggestion"
                width={720}
                okText={active?.contentType === 'narrative' || active?.contentType === 'static' ? 'Use this' : 'Close'}
                cancelText="Keep mine"
                onCancel={() => setAiSuggestion('')}
                onOk={() => {
                    if (active?.contentType === 'narrative' || active?.contentType === 'static') editDraft(aiSuggestion)
                    setAiSuggestion('')
                }}
            >
                <Input.TextArea value={aiSuggestion} onChange={e => setAiSuggestion(e.target.value)} autoSize={{ minRows: 10, maxRows: 20 }} />
                {active?.contentType === 'table' || active?.contentType === 'kpi' ? (
                    <div className="cr-muted" style={{ marginTop: 8 }}>
                        Copy this into a written section if it helps. The AI never changes table values.
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={requestOpen}
                onCancel={() => setRequestOpen(false)}
                title="Ask for changes"
                okText="Send"
                onOk={() => void requestChanges()}
                confirmLoading={saving}
                okButtonProps={{ disabled: !changeReason.trim() }}
                destroyOnClose
            >
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={changeReason} onChange={e => setChangeReason(e.target.value)} placeholder="What needs to change?" />
            </Modal>

            <Modal
                open={delegateOpen}
                onCancel={() => setDelegateOpen(false)}
                title="Hand this section to a coordinator"
                okText="Save"
                onOk={() => void saveDelegation()}
                confirmLoading={saving}
                destroyOnClose
            >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <div className="cr-muted">They write it and send it back to you to check before it goes to the report owner.</div>
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                        value={delegateIds}
                        onChange={setDelegateIds}
                        placeholder="Choose coordinators"
                        options={coordinators.map(item => ({ value: item.id, label: `${item.name}${item.email ? ` · ${item.email}` : ''}` }))}
                    />
                    {!coordinators.length ? <div className="cr-muted">There are no coordinators in your department.</div> : null}
                </Space>
            </Modal>

            <Modal open={accessOpen} onCancel={() => setAccessOpen(false)} title="Project admin access" okText="Save" onOk={() => void saveAccess()} confirmLoading={saving} destroyOnClose>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Radio.Group value={projectAdminMode} onChange={e => setProjectAdminMode(e.target.value)}>
                        <Space direction="vertical">
                            <Radio value="manage">Can edit, hand over and approve sections</Radio>
                            <Radio value="read_only">Can only view and download</Radio>
                        </Space>
                    </Radio.Group>
                    <div>
                        <div className="cr-label">Reason shown when the report is locked</div>
                        <Input value={lockReason} onChange={e => setLockReason(e.target.value)} placeholder="Optional" />
                    </div>
                </Space>
            </Modal>
        </div>
    )
}

export default ReportWorkspacePage
