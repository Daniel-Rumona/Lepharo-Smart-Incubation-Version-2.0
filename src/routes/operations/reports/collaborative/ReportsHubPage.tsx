import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Input, message, Popconfirm, Progress, Result, Row, Select, Space, Tag, Typography } from 'antd'
import {
    CheckCircleOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    PlusOutlined,
    SettingOutlined,
    SyncOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { deleteReport, getReportTemplateSignature, listenReportsForUser, syncReportWithTemplate } from './services/reportsService'
import { listenReportTemplatesForUser } from './services/reportTemplatesService'
import { isAccountManager, isProjectAdmin } from './reportPermissions'
import type { ReportDocument, ReportTemplate, ReportUserContext } from './types'
import { MetricCard, PageHeader, ReportStatusTag, formatTimestamp } from './shared'

const { Text, Title } = Typography

type Props = {
    user?: ReportUserContext
    onCreate: () => void
    onManageTemplates: () => void
    onMyContributions: () => void
    onOpenReport: (reportId: string) => void
}

const ReportsHubPage: React.FC<Props> = ({ user, onCreate, onManageTemplates, onMyContributions, onOpenReport }) => {
    if (!user) {
        return (
            <Result
                status="500"
                title="Report user context is missing"
                subTitle="Render CollaborativeReportsModule on the route instead of rendering ReportsHubPage directly."
            />
        )
    }

    const [reports, setReports] = useState<ReportDocument[]>([])
    const [templates, setTemplates] = useState<ReportTemplate[]>([])
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('all')
    const [program, setProgram] = useState('all')
    const [actionReportId, setActionReportId] = useState<string | null>(null)
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    useEffect(
        () => listenReportsForUser(db, user, setReports),
        [user.uid, user.role, user.isAccountManager, user.managedPrograms.join('|')]
    )

    useEffect(
        () => listenReportTemplatesForUser(db, user, setTemplates),
        [user.uid, user.role, user.isAccountManager, user.managedPrograms.join('|')]
    )

    const scopedReports = useMemo(
        () => activeProgramId ? reports.filter(item => item.programId === activeProgramId) : reports,
        [reports, activeProgramId]
    )

    const programs = useMemo(() => Array.from(new Map(
        reports.filter(item => item.programId).map(item => [item.programId!, item.programName || item.programId!])
    ).entries()), [reports])

    const rows = useMemo(() => scopedReports.filter(item => {
        const q = search.toLowerCase()
        const matchesSearch = `${item.title} ${item.periodLabel} ${item.programName || ''}`.toLowerCase().includes(q)
        const matchesStatus = status === 'all' || item.status === status
        const matchesProgram = !isAllPrograms || program === 'all' || item.programId === program
        return matchesSearch && matchesStatus && matchesProgram
    }), [scopedReports, search, status, program, isAllPrograms])

    const active = scopedReports.filter(item => item.status === 'draft' || item.status === 'in_progress').length
    const review = scopedReports.filter(item => item.status === 'review').length
    const completed = scopedReports.filter(item => item.status === 'approved').length
    const contributorKeys = new Set(scopedReports.flatMap(item => item.contributorKeys || []))
    const templateSignatures = useMemo(
        () => new Map(templates.map(template => [template.id, getReportTemplateSignature(template)])),
        [templates]
    )
    const authority = isAccountManager(user) && !isProjectAdmin(user)
        ? `Account Manager · ${user.managedPrograms.length} managed programme(s)`
        : 'Center Coordinator · full report management by default'

    const applyTemplate = async (report: ReportDocument) => {
        setActionReportId(report.id)
        try {
            await syncReportWithTemplate({ db, report, user })
            message.success('Latest template configuration applied. Existing report content was preserved.')
        } catch (error: any) {
            message.error(error?.message || 'Could not apply the latest template configuration.')
        } finally {
            setActionReportId(null)
        }
    }

    const removeReport = async (report: ReportDocument) => {
        setActionReportId(report.id)
        try {
            await deleteReport({ db, report, user })
            message.success('Report deleted.')
        } catch (error: any) {
            message.error(error?.message || 'Could not delete the report.')
        } finally {
            setActionReportId(null)
        }
    }

    return (
        <div className="report-shell">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <PageHeader
                    title="Collaborative Reports"
                    subtitle={`Create, coordinate, review and approve programme reports. ${authority}.`}
                    actions={
                        <Space wrap>
                            <Button icon={<TeamOutlined />} onClick={onMyContributions}>My Contributions</Button>
                            {user.canManageTemplates ? <Button icon={<SettingOutlined />} onClick={onManageTemplates}>Manage Templates</Button> : null}
                            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>Create Report</Button>
                        </Space>
                    }
                />

                <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12} xl={6}><MetricCard icon={<FileDoneOutlined />} iconBg="rgba(22,119,255,.12)" title="Active Reports" value={active} subtitle="Draft or in progress" /></Col>
                    <Col xs={24} sm={12} xl={6}><MetricCard icon={<FileTextOutlined />} iconBg="rgba(114,46,209,.11)" title="Under Review" value={review} subtitle="Department submissions awaiting approval" /></Col>
                    <Col xs={24} sm={12} xl={6}><MetricCard icon={<CheckCircleOutlined />} iconBg="rgba(82,196,26,.12)" title="Completed" value={completed} subtitle="Fully approved" /></Col>
                    <Col xs={24} sm={12} xl={6}><MetricCard icon={<TeamOutlined />} iconBg="rgba(250,173,20,.13)" title="Assignments" value={contributorKeys.size} subtitle="Department / delegated assignment keys" /></Col>
                </Row>

                <Card className="report-soft-card" styles={{ body: { padding: 14 } }}>
                    <Row gutter={[10, 10]} align="middle">
                        <Col xs={24} md={isAllPrograms ? 14 : 19}><Input.Search allowClear placeholder="Search reports" value={search} onChange={e => setSearch(e.target.value)} /></Col>
                        <Col xs={24} md={5}>
                            <Select style={{ width: '100%' }} value={status} onChange={setStatus} options={[
                                { value: 'all', label: 'All statuses' },
                                { value: 'draft', label: 'Draft' },
                                { value: 'in_progress', label: 'In progress' },
                                { value: 'review', label: 'Under review' },
                                { value: 'approved', label: 'Approved' }
                            ]} />
                        </Col>
                        {isAllPrograms ? (
                            <Col xs={24} md={5}>
                                <Select style={{ width: '100%' }} value={program} onChange={setProgram} options={[
                                    { value: 'all', label: 'All programmes' },
                                    ...programs.map(([value, label]) => ({ value, label }))
                                ]} />
                            </Col>
                        ) : null}
                    </Row>
                </Card>

                {rows.length ? (
                    <Space direction="vertical" size={11} style={{ width: '100%' }}>
                        {rows.map(item => (
                            <Card key={item.id} className="report-soft-card report-card-row" styles={{ body: { padding: 18 } }}>
                                <Row gutter={[16, 16]} align="middle">
                                    <Col xs={24} lg={10}>
                                        <Space size={13} align="start">
                                            <div className="report-metric-icon" style={{ background: '#eef5ff', color: '#175b9c' }}><FileTextOutlined /></div>
                                            <div>
                                                <Space size={8} wrap>
                                                    <Title level={5} style={{ margin: 0 }}>{item.title}</Title>
                                                    <ReportStatusTag status={item.status} />
                                                    {item.lock?.locked ? <Tag color="red">Locked</Tag> : null}
                                                    {isProjectAdmin(user) && item.access?.projectAdminMode === 'read_only' ? <Tag color="gold">Read only</Tag> : null}
                                                </Space>
                                                <Text strong style={{ display: 'block', marginTop: 3 }}>{item.periodLabel}</Text>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{item.programName || 'No programme'} · {item.templateName}</Text>
                                                {item.sourceReportTitle ? <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 3 }}>Carried over from {item.sourceReportTitle}</Text> : null}
                                            </div>
                                        </Space>
                                    </Col>
                                    <Col xs={24} lg={7}>
                                        <div style={{ maxWidth: 360 }}>
                                            <Space style={{ width: '100%', justifyContent: 'space-between' }}><Text type="secondary" style={{ fontSize: 12 }}>Completion</Text><Text strong>{item.progressPercent}%</Text></Space>
                                            <Progress percent={item.progressPercent} showInfo={false} strokeWidth={7} />
                                            <Text type="secondary" style={{ fontSize: 11 }}>{item.completedBlocks}/{item.totalBlocks} blocks approved</Text>
                                        </div>
                                    </Col>
                                    <Col xs={24} lg={4}><Text type="secondary" style={{ fontSize: 12 }}>{formatTimestamp(item.updatedAt)}</Text></Col>
                                    <Col xs={24} lg={3} style={{ textAlign: 'right' }}>
                                        <Space direction="vertical" size={6} style={{ alignItems: 'flex-end' }}>
                                            <Button type={item.status === 'in_progress' ? 'primary' : 'default'} onClick={() => onOpenReport(item.id)}>Open Report</Button>
                                            {templateSignatures.get(item.templateId) !== item.templateSignature ? <Button size="small" icon={<SyncOutlined />} loading={actionReportId === item.id} disabled={item.lock?.locked} onClick={() => applyTemplate(item)}>Apply Latest Template</Button> : null}
                                            <Popconfirm
                                                title="Delete this report?"
                                                description="This permanently removes the report, its blocks, comments and revision history."
                                                okText="Delete report"
                                                okButtonProps={{ danger: true, loading: actionReportId === item.id }}
                                                onConfirm={() => removeReport(item)}
                                            >
                                                <Button size="small" danger disabled={item.lock?.locked || actionReportId === item.id}>Delete Report</Button>
                                            </Popconfirm>
                                        </Space>
                                    </Col>
                                </Row>
                            </Card>
                        ))}
                    </Space>
                ) : <Card className="report-soft-card"><Empty description="No reports found in your reporting scope" /></Card>}
            </Space>
        </div>
    )
}

export default ReportsHubPage
