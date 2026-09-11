import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Dropdown, Empty, Input, Row, Segmented, Space, Tag, Typography, message } from 'antd'
import { CopyOutlined, FileTextOutlined, MoreOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { archiveReportTemplate, duplicateReportTemplate, listenReportTemplatesForUser, activateReportTemplate } from './services/reportTemplatesService'
import type { ReportTemplate, ReportUserContext } from './types'
import { MetricCard, PageHeader, formatTimestamp } from './shared'

const { Text, Title } = Typography

type Props = {
    user: ReportUserContext
    onBack: () => void
    onUploadTemplate: () => void
    onConfigureTemplate: (templateId: string) => void
    onCreateFromTemplate: (templateId: string) => void
}

const TemplatesManagementPage: React.FC<Props> = ({ user, onBack, onUploadTemplate, onConfigureTemplate, onCreateFromTemplate }) => {
    const [templates, setTemplates] = useState<ReportTemplate[]>([])
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<string | number>('Active')
    const { activeProgramId } = useActiveProgramId()

    useEffect(() => listenReportTemplatesForUser(db, user, setTemplates), [user.uid, user.isAccountManager, user.managedPrograms.join('|')])

    const scopedTemplates = useMemo(
        () => activeProgramId
            ? templates.filter(item => !item.programIds.length || item.programIds.includes(activeProgramId))
            : templates,
        [templates, activeProgramId]
    )

    const rows = useMemo(() => scopedTemplates.filter(item => {
        const statusMatch = filter === 'Active' ? item.status === 'active' : item.status === 'archived'
        return statusMatch && item.name.toLowerCase().includes(search.toLowerCase())
    }), [scopedTemplates, search, filter])

    const activeCount = scopedTemplates.filter(item => item.status === 'active').length
    const archivedCount = scopedTemplates.filter(item => item.status === 'archived').length
    const mappedBlocks = scopedTemplates.reduce((sum, template) => sum + template.sections.reduce((s, section) => s + section.blocks.length, 0), 0)
    const assignedBlocks = scopedTemplates.reduce((sum, template) => sum + template.sections.reduce((s, section) => s + section.blocks.filter(block => block.editorDepartmentIds.length || block.editorUserIds.length).length, 0), 0)

    const doDuplicate = async (templateId: string) => {
        try {
            const id = await duplicateReportTemplate(db, templateId, user)
            message.success('Template duplicated.')
            onConfigureTemplate(id)
        } catch (err: any) {
            message.error(err?.message || 'Could not duplicate template.')
        }
    }

    const doArchiveToggle = async (template: ReportTemplate) => {
        try {
            if (template.status === 'active') await archiveReportTemplate(db, template.id, user)
            else await activateReportTemplate(db, template.id, user)
            message.success(template.status === 'active' ? 'Template archived.' : 'Template activated.')
        } catch (err: any) {
            message.error(err?.message || 'Could not update template.')
        }
    }

    return (
        <div className="report-shell">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <PageHeader
                    eyebrow="REPORT CONFIGURATION"
                    title="Report Templates"
                    subtitle="Templates stay out of day-to-day reporting. Configure DOCX source files, reusable sections, blocks and contributor permissions here."
                    onBack={onBack}
                    actions={<Button type="primary" icon={<PlusOutlined />} onClick={onUploadTemplate}>Upload Template</Button>}
                />

                <Row gutter={[12, 12]}>
                    <Col xs={24} sm={12} lg={6}><MetricCard icon={<FileTextOutlined />} title="Active Templates" value={activeCount} subtitle="Available for new reports" iconBg="rgba(22,119,255,.12)" /></Col>
                    <Col xs={24} sm={12} lg={6}><MetricCard icon={<SettingOutlined />} title="Mapped Blocks" value={mappedBlocks} subtitle="Across all templates" iconBg="rgba(114,46,209,.11)" /></Col>
                    <Col xs={24} sm={12} lg={6}><MetricCard icon={<CopyOutlined />} title="Assigned Blocks" value={assignedBlocks} subtitle="With editor ownership" iconBg="rgba(82,196,26,.12)" /></Col>
                    <Col xs={24} sm={12} lg={6}><MetricCard icon={<FileTextOutlined />} title="Archived" value={archivedCount} subtitle="Hidden from create report" iconBg="rgba(140,140,140,.12)" /></Col>
                </Row>

                <Card className="report-soft-card" styles={{ body: { padding: 14 } }}>
                    <Row gutter={[10, 10]} align="middle">
                        <Col xs={24} md={16}><Input.Search allowClear placeholder="Search report templates" value={search} onChange={e => setSearch(e.target.value)} /></Col>
                        <Col xs={24} md={8} style={{ textAlign: 'right' }}><Segmented value={filter} onChange={setFilter} options={['Active', 'Archived']} /></Col>
                    </Row>
                </Card>

                {rows.length ? <Space direction="vertical" size={11} style={{ width: '100%' }}>
                    {rows.map(item => {
                        const blockCount = item.sections.reduce((sum, section) => sum + section.blocks.length, 0)
                        const ownershipCount = item.sections.reduce((sum, section) => sum + section.blocks.filter(block => block.editorDepartmentIds.length || block.editorUserIds.length).length, 0)
                        return (
                            <Card key={item.id} className="report-soft-card report-card-row" styles={{ body: { padding: 18 } }}>
                                <Row gutter={[14, 14]} align="middle">
                                    <Col xs={24} lg={10}>
                                        <Space align="start" size={12}>
                                            <div className="report-metric-icon" style={{ background: '#eef5ff', color: '#175b9c' }}><FileTextOutlined /></div>
                                            <div>
                                                <Space size={7} wrap><Title level={5} style={{ margin: 0 }}>{item.name}</Title><Tag color={item.status === 'active' ? 'green' : undefined}>{item.status === 'active' ? 'Active' : 'Archived'}</Tag></Space>
                                                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 3 }}>{item.programNames?.length ? item.programNames.join(', ') : 'Any programme'} · {item.frequency}</Text>
                                                {item.sourceFile?.name ? <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 3 }}>Source: {item.sourceFile.name}</Text> : null}
                                            </div>
                                        </Space>
                                    </Col>
                                    <Col xs={8} lg={3}><Text type="secondary" style={{ display: 'block', fontSize: 11 }}>SECTIONS</Text><Text strong>{item.sections.length}</Text></Col>
                                    <Col xs={8} lg={3}><Text type="secondary" style={{ display: 'block', fontSize: 11 }}>BLOCKS</Text><Text strong>{blockCount}</Text></Col>
                                    <Col xs={8} lg={3}><Text type="secondary" style={{ display: 'block', fontSize: 11 }}>ASSIGNED</Text><Text strong>{ownershipCount}/{blockCount}</Text></Col>
                                    <Col xs={24} lg={3}><Text type="secondary" style={{ fontSize: 11 }}>{formatTimestamp(item.updatedAt)}</Text></Col>
                                    <Col xs={24} lg={2} style={{ textAlign: 'right' }}>
                                        <Space>
                                            <Button onClick={() => onConfigureTemplate(item.id)}>Configure</Button>
                                            <Dropdown menu={{
                                                items: [
                                                    ...(item.status === 'active' ? [{ key: 'create', label: 'Create report from template', onClick: () => onCreateFromTemplate(item.id) }] : []),
                                                    { key: 'duplicate', label: 'Duplicate template', onClick: () => doDuplicate(item.id) },
                                                    { type: 'divider' as const },
                                                    { key: 'archive', label: item.status === 'active' ? 'Archive' : 'Activate', onClick: () => doArchiveToggle(item) }
                                                ]
                                            }}><Button icon={<MoreOutlined />} /></Dropdown>
                                        </Space>
                                    </Col>
                                </Row>
                            </Card>
                        )
                    })}
                </Space> : <Card className="report-soft-card"><Empty description="No templates in this view" /></Card>}
            </Space>
        </div>
    )
}

export default TemplatesManagementPage
