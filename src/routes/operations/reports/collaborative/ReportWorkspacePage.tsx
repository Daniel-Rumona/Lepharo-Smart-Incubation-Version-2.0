import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Empty,
    Input,
    Modal,
    Progress,
    Radio,
    Segmented,
    Select,
    Space,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { UploadProps } from 'antd'
import {
    CheckOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    EyeOutlined,
    LockOutlined,
    PaperClipOutlined,
    SaveOutlined,
    SendOutlined,
    SettingOutlined,
    TeamOutlined,
    UnlockOutlined
} from '@ant-design/icons'
import { db, storage } from '@/firebase'
import {
    acceptCoordinatorSubmission,
    addReportBlockAttachmentMetadata,
    approveReportBlock,
    delegateReportBlock,
    listenContributorBlocks,
    listenReport,
    listenReportActivity,
    listenReportBlocks,
    requestReportBlockChanges,
    saveReportBlock,
    submitReportBlock,
    updateReportLock,
    updateReportProjectAdminMode
} from './services/reportsService'
import { loadReportUsers } from './services/reportDirectoryService'
import { uploadReportBlockAttachment } from './services/reportStorageService'
import { downloadDocx, generateReportDocx } from './services/docxGenerationService'
import { getReportTemplate } from './services/reportTemplatesService'
import { requestReportWriting, type ReportWritingAction } from './services/aiReportWritingService'
import {
    canUserControlProjectAdminMode,
    canUserDelegateBlock,
    canUserEditBlock,
    canUserManageDepartmentBlock,
    canUserManageReport,
    canUserReviewContributorSubmission,
    canUserReviewDepartmentSubmission,
    canUserViewBlock,
    canUserViewFullReport,
    isCoordinator,
    isOperations,
    isProjectAdmin
} from './reportPermissions'
import type {
    ProjectAdminMode,
    ReportActivity,
    ReportBlock,
    ReportDirectoryUser,
    ReportDocument,
    ReportUserContext
} from './types'
import { BlockStatusTag, ContentTypeTag, PageHeader, formatTimestamp } from './shared'
import NarrativeBlockEditor from './components/NarrativeBlockEditor'
import StructuredTableEditor from './components/StructuredTableEditor'
import BlockCommentsPanel from './components/BlockCommentsPanel'
import BlockHistoryPanel from './components/BlockHistoryPanel'

const { Text, Title } = Typography

type Props = {
    user: ReportUserContext
    reportId: string
    forceContributorOnly?: boolean
    initialBlockId?: string
    onBack: () => void
    onPreview?: () => void
}

const ReportWorkspacePage: React.FC<Props> = ({
    user,
    reportId,
    forceContributorOnly = false,
    initialBlockId,
    onBack,
    onPreview
}) => {
    const [report, setReport] = useState<ReportDocument | null>(null)
    const [blocks, setBlocks] = useState<ReportBlock[]>([])
    const [activeId, setActiveId] = useState(initialBlockId || '')
    const [draftContent, setDraftContent] = useState<any>('')
    const [saving, setSaving] = useState(false)
    const [generatingWord, setGeneratingWord] = useState(false)
    const [aiWriting, setAiWriting] = useState(false)
    const [aiSuggestion, setAiSuggestion] = useState('')
    const [rightTab, setRightTab] = useState('Comments')
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

        if (fullView) {
            return listenReportBlocks(db, reportId, setBlocks)
        }

        return listenContributorBlocks(db, user, rows => {
            setBlocks(rows.filter(block => block.reportId === reportId))
        })
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
            .then(rows => setCoordinators(rows.filter(item =>
                String(item.role || '').toLowerCase() === 'coordinator' &&
                item.departmentId === user.departmentId
            )))
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
            setActiveId(initialBlockId && visibleBlocks.some(block => block.id === initialBlockId)
                ? initialBlockId
                : visibleBlocks[0].id)
        }
    }, [visibleBlocks, activeId, initialBlockId])

    const active = visibleBlocks.find(block => block.id === activeId) || null

    useEffect(() => {
        if (active) {
            setDraftContent(JSON.parse(JSON.stringify(
                active.content ?? (active.contentType === 'table' || active.contentType === 'kpi' ? { rows: [] } : '')
            )))
            setDelegateIds(active.delegatedUserIds || [])
        }
    }, [active?.id, active?.updatedAt])

    const editable = !!report && !!active && canUserEditBlock(user, report, active)
    const departmentManager = !!active && canUserManageDepartmentBlock(user, active)
    const delegatedContributor = !!active && !departmentManager && !reportManager && (
        active.delegatedUserIds.includes(user.uid) || active.editorUserIds.includes(user.uid)
    )
    const reviewContributor = !!active && canUserReviewContributorSubmission(user, active)
    const reviewDepartment = !!report && !!active && canUserReviewDepartmentSubmission(user, report, active)
    const canDelegate = !!report && !!active && canUserDelegateBlock(user, report, active)

    const save = async () => {
        if (!active || !editable) return
        setSaving(true)
        try {
            await saveReportBlock({ db, block: active, user, content: draftContent })
            message.success('Block saved.')
        } catch (err: any) {
            message.error(err?.message || 'Could not save block.')
        } finally {
            setSaving(false)
        }
    }

    const submit = async () => {
        if (!active || !report || !editable) return
        if (active.evidencePolicy === 'required' && !active.attachments?.length) {
            message.error('Attach at least one supporting evidence file before submitting this block.')
            return
        }
        setSaving(true)
        try {
            await saveReportBlock({ db, block: active, user, content: draftContent, summary: 'Saved before submission.' })
            const target = delegatedContributor && active.editorDepartmentIds.length ? 'department' : 'report_manager'
            await submitReportBlock({ db, block: { ...active, content: draftContent }, user, target })
            message.success(target === 'department' ? 'Block submitted to your HOD.' : 'Block submitted to the report manager.')
        } catch (err: any) {
            message.error(err?.message || 'Could not submit block.')
        } finally {
            setSaving(false)
        }
    }

    const acceptAndForward = async () => {
        if (!active || !reviewContributor) return
        setSaving(true)
        try {
            await acceptCoordinatorSubmission({ db, block: active, user })
            message.success('Contribution accepted and submitted to the report manager.')
        } catch (err: any) {
            message.error(err?.message || 'Could not forward contribution.')
        } finally {
            setSaving(false)
        }
    }

    const approve = async () => {
        if (!active || !reviewDepartment) return
        setSaving(true)
        try {
            await approveReportBlock({ db, block: active, user })
            message.success('Block approved.')
        } catch (err: any) {
            message.error(err?.message || 'Could not approve block.')
        } finally {
            setSaving(false)
        }
    }

    const openRequestChanges = (target: 'contributor' | 'department') => {
        setRequestTarget(target)
        setChangeReason('')
        setRequestOpen(true)
    }

    const requestChanges = async () => {
        if (!active || !changeReason.trim()) return
        setSaving(true)
        try {
            await requestReportBlockChanges({
                db,
                block: active,
                user,
                reason: changeReason.trim(),
                target: requestTarget
            })
            setChangeReason('')
            setRequestOpen(false)
            message.success('Changes requested.')
        } catch (err: any) {
            message.error(err?.message || 'Could not request changes.')
        } finally {
            setSaving(false)
        }
    }

    const saveDelegation = async () => {
        if (!active || !canDelegate) return
        const selected = coordinators.filter(item => delegateIds.includes(item.id))
        setSaving(true)
        try {
            await delegateReportBlock({
                db,
                block: active,
                user,
                contributorIds: selected.map(item => item.id),
                contributorNames: selected.map(item => item.name)
            })
            setDelegateOpen(false)
            message.success(selected.length ? 'Coordinator delegation updated.' : 'Coordinator delegation removed.')
        } catch (err: any) {
            message.error(err?.message || 'Could not update delegation.')
        } finally {
            setSaving(false)
        }
    }

    const saveAccess = async () => {
        if (!report || !canControlAccess) return
        setSaving(true)
        try {
            await updateReportProjectAdminMode({ db, report, user, mode: projectAdminMode })
            setAccessOpen(false)
            message.success('Center Coordinator report access updated.')
        } catch (err: any) {
            message.error(err?.message || 'Could not update report access.')
        } finally {
            setSaving(false)
        }
    }

    const toggleLock = async () => {
        if (!report || !canControlAccess) return
        setSaving(true)
        try {
            await updateReportLock({
                db,
                report,
                user,
                locked: !report.lock?.locked,
                reason: report.lock?.locked ? undefined : (lockReason.trim() || 'Report locked by Account Manager.')
            })
            message.success(report.lock?.locked ? 'Report unlocked.' : 'Report locked.')
        } catch (err: any) {
            message.error(err?.message || 'Could not update report lock.')
        } finally {
            setSaving(false)
        }
    }

    const generateWord = async () => {
        if (!report || !fullView) return
        setGeneratingWord(true)
        try {
            const template = await getReportTemplate(db, report.templateId)
            const file = await generateReportDocx({ template, blocks })
            downloadDocx(file, `${report.title}-${report.periodLabel}.docx`)
            message.success('Word report generated.')
        } catch (err: any) {
            message.error(err?.message || 'Could not generate the Word report.')
        } finally {
            setGeneratingWord(false)
        }
    }

    const assistWriting = async (action: ReportWritingAction) => {
        if (!active || !editable) return
        setAiWriting(true)
        try {
            setAiSuggestion(await requestReportWriting(action, active, draftContent))
        } catch (err: any) { message.error(err?.message || 'Could not generate writing assistance.') }
        finally { setAiWriting(false) }
    }

    const uploadProps: UploadProps = {
        showUploadList: false,
        beforeUpload: async file => {
            if (!active || !editable) return false
            try {
                const uploaded = await uploadReportBlockAttachment(storage, active.reportId, active.id, file as File)
                await addReportBlockAttachmentMetadata({ db, block: active, user, attachment: uploaded })
                message.success('Attachment uploaded.')
            } catch (err: any) {
                message.error(err?.message || 'Could not upload attachment.')
            }
            return false
        }
    }

    const grouped = useMemo(() => {
        const map = new Map<string, ReportBlock[]>()
        visibleBlocks.forEach(block => map.set(block.sectionTitle, [...(map.get(block.sectionTitle) || []), block]))
        return Array.from(map.entries())
    }, [visibleBlocks])

    const renderEditor = () => {
        if (!active) return <Empty description="No report block selected" />
        if (active.contentType === 'narrative') return <NarrativeBlockEditor value={typeof draftContent === 'string' ? draftContent : ''} onChange={setDraftContent} readOnly={!editable} />
        if (active.contentType === 'table' || active.contentType === 'kpi') return <StructuredTableEditor columns={active.schema?.columns || []} value={draftContent} onChange={setDraftContent} readOnly={!editable} kpiMode={active.contentType === 'kpi'} />
        return <div className="block-editor-body"><Text style={{ whiteSpace: 'pre-wrap' }}>{String(draftContent || '')}</Text></div>
    }

    if (!report) return <div style={{ padding: 48, textAlign: 'center' }}><Text type="secondary">Loading report...</Text></div>

    if (!fullView && !visibleBlocks.length) {
        return (
            <Card className="report-soft-card">
                <Empty description="No report blocks are assigned to your department or user account" />
                <div style={{ textAlign: 'center', marginTop: 12 }}><Button onClick={onBack}>Back</Button></div>
            </Card>
        )
    }

    const contributorOnly = !fullView
    const projectAdminReadOnly = isProjectAdmin(user) && report.access?.projectAdminMode === 'read_only'

    return (
        <div className="report-shell">
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <PageHeader
                    eyebrow={contributorOnly ? (departmentManager ? 'DEPARTMENT REPORT CONTRIBUTION' : 'MY REPORT CONTRIBUTIONS') : 'REPORT WORKSPACE'}
                    title={`${report.title} · ${report.periodLabel}`}
                    subtitle={contributorOnly
                        ? `${visibleBlocks.length} block(s) in your reporting scope`
                        : `${report.completedBlocks}/${report.totalBlocks} blocks approved · ${report.progressPercent}% overall progress`}
                    onBack={onBack}
                    actions={
                        <Space wrap>
                            {fullView && onPreview ? <Button icon={<EyeOutlined />} onClick={onPreview}>Preview</Button> : null}
                            {canControlAccess ? <Button icon={<SettingOutlined />} onClick={() => setAccessOpen(true)}>Report Access</Button> : null}
                            {canControlAccess ? <Button icon={report.lock?.locked ? <UnlockOutlined /> : <LockOutlined />} onClick={toggleLock} loading={saving}>{report.lock?.locked ? 'Unlock Report' : 'Lock Report'}</Button> : null}
                            {fullView ? <Button icon={<DownloadOutlined />} loading={generatingWord} onClick={generateWord}>Generate Word</Button> : null}
                        </Space>
                    }
                />

                {report.sourceReportTitle ? <Alert type="info" showIcon message={`This report was carried over from ${report.sourceReportTitle}. Review carried content before submission.`} /> : null}
                {projectAdminReadOnly ? <Alert type="warning" showIcon message="This report is read-only for the Center Coordinator. The Account Manager can restore full control." /> : null}
                {report.lock?.locked ? <Alert type="error" showIcon message="Report locked" description={report.lock.reason || 'Editing and workflow actions are disabled until the Account Manager unlocks the report.'} /> : null}

                <div className="workspace-grid" style={contributorOnly ? { gridTemplateColumns: '270px minmax(0,1fr) 310px' } : undefined}>
                    <div className="workspace-panel">
                        <div className="workspace-panel-header">
                            <Text strong>{contributorOnly ? (isOperations(user) ? 'Department Blocks' : 'My Blocks') : 'Report Structure'}</Text>
                            <Progress percent={report.progressPercent} size="small" showInfo={false} style={{ marginTop: 8 }} />
                        </div>
                        <div className="workspace-section-list">
                            {grouped.map(([sectionTitle, sectionBlocks]) => (
                                <div key={sectionTitle} style={{ marginBottom: 10 }}>
                                    <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, padding: '0 10px' }}>{sectionTitle.toUpperCase()}</Text>
                                    {sectionBlocks.map(block => (
                                        <button key={block.id} className={`workspace-section-item ${activeId === block.id ? 'active' : ''}`} onClick={() => setActiveId(block.id)}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <Text strong style={{ color: 'inherit', fontSize: 12 }}>{block.title}</Text>
                                                <div style={{ marginTop: 3 }}>
                                                    <Space size={4} wrap>
                                                        <BlockStatusTag status={block.status} />
                                                        {block.status === 'submitted' && block.submittedTo === 'department' ? <Tag color="gold">Awaiting HOD</Tag> : null}
                                                        {block.status === 'submitted' && block.submittedTo === 'report_manager' ? <Tag color="blue">Awaiting Report Manager</Tag> : null}
                                                    </Space>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="workspace-panel">
                        {active ? <>
                            <div className="workspace-editor-header">
                                <Space direction="vertical" size={7} style={{ width: '100%' }}>
                                    <Space wrap size={6}><Title level={4} style={{ margin: 0 }}>{active.title}</Title><ContentTypeTag value={active.contentType} /><BlockStatusTag status={active.status} />{active.carriedFromPeriodLabel ? <Tag color="gold">Carried from {active.carriedFromPeriodLabel}</Tag> : null}</Space>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        Department: {active.editorDepartmentNames?.length ? active.editorDepartmentNames.join(', ') : 'Unassigned'}
                                    </Text>
                                    {active.delegatedUserNames?.length ? <Space size={6} wrap><TeamOutlined /><Text type="secondary" style={{ fontSize: 12 }}>Delegated to {active.delegatedUserNames.join(', ')}</Text></Space> : null}
                                    {active.changeRequest?.reason ? <Alert type="warning" showIcon message={`Changes requested: ${active.changeRequest.reason}`} /> : null}
                                </Space>
                            </div>

                            {renderEditor()}

                            {editable ? <Space wrap style={{ padding: '0 14px 14px' }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>AI writing:</Text>
                                <Button size="small" loading={aiWriting} onClick={() => assistWriting('improve')}>Improve</Button>
                                <Button size="small" loading={aiWriting} onClick={() => assistWriting('summarise')}>Summarise</Button>
                                <Button size="small" loading={aiWriting} onClick={() => assistWriting('expand')}>Expand</Button>
                                <Button size="small" loading={aiWriting} onClick={() => assistWriting('commentary')}>Draft Commentary</Button>
                                <Button size="small" loading={aiWriting} onClick={() => assistWriting('risk_mitigation')}>Risk Mitigation</Button>
                            </Space> : null}

                            <div style={{ padding: 14, borderTop: '1px solid #e7edf5' }}>
                                <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                                    <Space wrap>
                                        {active.evidencePolicy !== 'none' ? <Upload {...uploadProps}><Button icon={<PaperClipOutlined />} disabled={!editable}>{active.evidencePolicy === 'required' ? 'Attach Required Evidence' : 'Attach Evidence'}</Button></Upload> : null}
                                        {active.attachments?.length ? <Tag>{active.attachments.length} attachment(s)</Tag> : null}
                                        {active.evidencePolicy === 'required' && !active.attachments?.length ? <Tag color="red">Evidence required before submission</Tag> : null}
                                        {canDelegate ? <Button icon={<TeamOutlined />} onClick={() => { setDelegateIds(active.delegatedUserIds || []); setDelegateOpen(true) }}>Delegate Coordinator</Button> : null}
                                    </Space>
                                    <Space wrap>
                                        {editable ? <Button icon={<SaveOutlined />} onClick={save} loading={saving}>Save Draft</Button> : null}
                                        {editable && !reportManager && active.status !== 'submitted' && active.status !== 'approved' ? <Button type="primary" icon={<SendOutlined />} onClick={submit} loading={saving}>{delegatedContributor && active.editorDepartmentIds.length ? 'Submit to HOD' : 'Submit to Report Manager'}</Button> : null}
                                        {reviewContributor ? <><Button danger icon={<CloseCircleOutlined />} onClick={() => openRequestChanges('contributor')}>Request Changes</Button><Button type="primary" icon={<SendOutlined />} onClick={acceptAndForward} loading={saving}>Accept & Submit</Button></> : null}
                                        {reviewDepartment ? <><Button danger icon={<CloseCircleOutlined />} onClick={() => openRequestChanges('department')}>Request Changes</Button><Button type="primary" icon={<CheckOutlined />} onClick={approve} loading={saving}>Approve</Button></> : null}
                                    </Space>
                                </Space>
                            </div>
                        </> : <Empty description="No visible report blocks" />}
                    </div>

                    <div className="workspace-panel">
                        <div className="workspace-panel-header"><Segmented block value={rightTab} onChange={value => setRightTab(String(value))} options={fullView ? ['Comments', 'History', 'Activity'] : ['Comments', 'History']} /></div>
                        <div className="collab-body">
                            {active && rightTab === 'Comments' ? <BlockCommentsPanel blockId={active.id} user={user} /> : null}
                            {active && rightTab === 'History' ? <BlockHistoryPanel blockId={active.id} /> : null}
                            {rightTab === 'Activity' ? (
                                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                                    {activity.slice(0, 20).map(item => <div key={item.id} className="activity-item"><Text strong style={{ fontSize: 12 }}>{item.createdByName}</Text><Text style={{ display: 'block', fontSize: 12 }}>{item.detail || item.action}</Text><Text type="secondary" style={{ fontSize: 11 }}>{formatTimestamp(item.createdAt)}</Text></div>)}
                                    {!activity.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity yet" /> : null}
                                </Space>
                            ) : null}
                        </div>
                    </div>
                </div>
            </Space>

                <Modal open={!!aiSuggestion} title="AI writing suggestion" width={720} okText={active?.contentType === 'narrative' || active?.contentType === 'static' ? 'Use suggestion' : 'Close'} cancelText="Keep my draft" onCancel={() => setAiSuggestion('')} onOk={() => { if (active?.contentType === 'narrative' || active?.contentType === 'static') setDraftContent(aiSuggestion); setAiSuggestion('') }}>
                    <Input.TextArea value={aiSuggestion} onChange={e => setAiSuggestion(e.target.value)} autoSize={{ minRows: 10, maxRows: 20 }} />
                    {active?.contentType === 'table' || active?.contentType === 'kpi' ? <Text type="secondary">Review this proposed commentary and copy it into an appropriate narrative block; table values are never changed by AI.</Text> : null}
                </Modal>
                <Modal
                open={requestOpen}
                onCancel={() => setRequestOpen(false)}
                title={requestTarget === 'contributor' ? 'Request Changes from Coordinator' : 'Request Department Changes'}
                okText="Send Request"
                onOk={requestChanges}
                confirmLoading={saving}
                okButtonProps={{ disabled: !changeReason.trim() }}
                destroyOnHidden
            >
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={changeReason} onChange={e => setChangeReason(e.target.value)} placeholder="Explain what needs to be changed..." />
            </Modal>

            <Modal
                open={delegateOpen}
                onCancel={() => setDelegateOpen(false)}
                title="Delegate Coordinator"
                okText="Save Delegation"
                onOk={saveDelegation}
                confirmLoading={saving}
                destroyOnHidden
            >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Alert type="info" showIcon message="Only coordinators in your department are listed. You remain the department owner and reviewer for this block." />
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                        value={delegateIds}
                        onChange={setDelegateIds}
                        placeholder="Select coordinator(s)"
                        options={coordinators.map(item => ({ value: item.id, label: `${item.name}${item.email ? ` · ${item.email}` : ''}` }))}
                    />
                    {!coordinators.length ? <Text type="secondary">No coordinators with this departmentId were found in users.</Text> : null}
                </Space>
            </Modal>

            <Modal
                open={accessOpen}
                onCancel={() => setAccessOpen(false)}
                title="Report Access"
                okText="Save Access"
                onOk={saveAccess}
                confirmLoading={saving}
                destroyOnHidden
            >
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Alert type="info" showIcon message="Account Manager authority is programme-scoped through managedPrograms. This setting only controls Center Coordinator access to this report." />
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Center Coordinator</Text>
                        <Radio.Group value={projectAdminMode} onChange={e => setProjectAdminMode(e.target.value)}>
                            <Space direction="vertical">
                                <Radio value="manage">Full Control — edit, assign, review and approve</Radio>
                                <Radio value="read_only">Read Only — view, preview and download only</Radio>
                            </Space>
                        </Radio.Group>
                    </div>
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Lock reason</Text>
                        <Input value={lockReason} onChange={e => setLockReason(e.target.value)} placeholder="Used if you lock the report" />
                    </div>
                </Space>
            </Modal>
        </div>
    )
}

export default ReportWorkspacePage
