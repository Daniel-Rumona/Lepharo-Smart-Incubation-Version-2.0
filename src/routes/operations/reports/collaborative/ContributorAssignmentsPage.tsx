import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Input, Progress, Row, Select, Space, Tag, Typography } from 'antd'
import { ClockCircleOutlined, FileTextOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { listenContributorBlocks } from './services/reportsService'
import { isCoordinator, isOperations } from './reportPermissions'
import type { ReportBlock, ReportUserContext } from './types'
import { BlockStatusTag, ContentTypeTag, PageHeader } from './shared'

const { Text, Title } = Typography

type Props = {
    user: ReportUserContext
    onBack?: () => void
    onOpenContribution: (reportId: string, blockId: string) => void
}

const statusProgress: Record<ReportBlock['status'], number> = {
    not_started: 0,
    draft: 35,
    changes_requested: 50,
    submitted: 80,
    approved: 100
}

const ContributorAssignmentsPage: React.FC<Props> = ({ user, onBack, onOpenContribution }) => {
    const [blocks, setBlocks] = useState<ReportBlock[]>([])
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('all')

    useEffect(() => listenContributorBlocks(db, user, setBlocks), [user.uid, user.departmentId])

    const rows = useMemo(() => blocks.filter(block => {
        const q = search.toLowerCase()
        return `${block.title} ${block.sectionTitle} ${block.reportTitle} ${block.periodLabel}`.toLowerCase().includes(q)
            && (status === 'all' || block.status === status)
    }), [blocks, search, status])

    const heading = isOperations(user) ? 'Department Report Contributions' : 'My Report Contributions'
    const subtitle = isOperations(user)
        ? `${user.departmentName || 'Your department'} · You can manage department-owned blocks and delegate them to coordinators.`
        : isCoordinator(user)
            ? 'Only report blocks explicitly delegated to you are loaded here.'
            : 'Only report blocks assigned directly to your user account are loaded here.'

    return (
        <div className="report-shell">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <PageHeader eyebrow="REPORT CONTRIBUTIONS" title={heading} subtitle={subtitle} onBack={onBack} />

                <Card className="report-soft-card" styles={{ body: { padding: 14 } }}>
                    <Row gutter={[10, 10]}>
                        <Col xs={24} md={18}><Input.Search allowClear placeholder="Search assigned report blocks" value={search} onChange={e => setSearch(e.target.value)} /></Col>
                        <Col xs={24} md={6}><Select style={{ width: '100%' }} value={status} onChange={setStatus} options={[
                            { value: 'all', label: 'All statuses' },
                            { value: 'not_started', label: 'Not started' },
                            { value: 'draft', label: 'Draft' },
                            { value: 'changes_requested', label: 'Changes requested' },
                            { value: 'submitted', label: 'Submitted' },
                            { value: 'approved', label: 'Approved' }
                        ]} /></Col>
                    </Row>
                </Card>

                {rows.length ? <Space direction="vertical" size={11} style={{ width: '100%' }}>
                    {rows.map(block => (
                        <Card key={block.id} className="report-soft-card contribution-card" styles={{ body: { padding: 18 } }}>
                            <Row gutter={[14, 14]} align="middle">
                                <Col xs={24} lg={11}>
                                    <Space align="start" size={12}>
                                        <div className="report-metric-icon" style={{ background: '#eef5ff', color: '#175b9c' }}><FileTextOutlined /></div>
                                        <div>
                                            <Space wrap size={6}>
                                                <Title level={5} style={{ margin: 0 }}>{block.title}</Title>
                                                <BlockStatusTag status={block.status} />
                                                <ContentTypeTag value={block.contentType} />
                                                {block.status === 'submitted' && block.submittedTo === 'department' ? <Tag color="gold">Awaiting HOD</Tag> : null}
                                                {block.status === 'submitted' && block.submittedTo === 'report_manager' ? <Tag color="blue">Awaiting Report Manager</Tag> : null}
                                            </Space>
                                            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>{block.sectionTitle}</Text>
                                            <Text style={{ fontSize: 12, display: 'block', marginTop: 3 }}>{block.reportTitle} · {block.periodLabel}</Text>
                                            {block.delegatedUserNames?.length ? <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 3 }}>Delegated: {block.delegatedUserNames.join(', ')}</Text> : null}
                                            {block.changeRequest?.reason ? <Text type="danger" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>Changes requested: {block.changeRequest.reason}</Text> : null}
                                        </div>
                                    </Space>
                                </Col>
                                <Col xs={24} lg={6}>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space style={{ width: '100%', justifyContent: 'space-between' }}><Text type="secondary" style={{ fontSize: 11 }}>Progress</Text><Text strong>{statusProgress[block.status]}%</Text></Space>
                                        <Progress percent={statusProgress[block.status]} showInfo={false} strokeWidth={7} />
                                    </Space>
                                </Col>
                                <Col xs={24} lg={4}><Space size={6}><ClockCircleOutlined style={{ color: '#8c8c8c' }} /><Text type="secondary" style={{ fontSize: 12 }}>{block.status === 'approved' ? 'Complete' : 'Action required'}</Text></Space></Col>
                                <Col xs={24} lg={3} style={{ textAlign: 'right' }}><Button type={block.status === 'submitted' || block.status === 'approved' ? 'default' : 'primary'} onClick={() => onOpenContribution(block.reportId, block.id)}>{block.status === 'changes_requested' ? 'Update' : block.status === 'approved' ? 'View' : isOperations(user) && block.submittedTo === 'department' ? 'Review' : 'Continue'}</Button></Col>
                            </Row>
                        </Card>
                    ))}
                </Space> : <Card className="report-soft-card"><Empty description="No report blocks are assigned to your reporting scope" /></Card>}
            </Space>
        </div>
    )
}

export default ContributorAssignmentsPage
