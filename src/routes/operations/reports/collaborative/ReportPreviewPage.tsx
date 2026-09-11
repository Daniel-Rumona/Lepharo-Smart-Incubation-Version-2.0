import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Result, Space, Table, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { listenReport, listenReportBlocks } from './services/reportsService'
import { getReportTemplate } from './services/reportTemplatesService'
import { canUserViewFullReport } from './reportPermissions'
import type { ExtractedDocumentNode, ReportBlock, ReportDocument, ReportTemplate, ReportUserContext } from './types'

const { Title, Text, Paragraph } = Typography

type Props = { user: ReportUserContext; reportId: string; onBack: () => void }

const ReportPreviewPage: React.FC<Props> = ({ user, reportId, onBack }) => {
    const [report, setReport] = useState<ReportDocument | null>(null)
    const [blocks, setBlocks] = useState<ReportBlock[]>([])
    const [template, setTemplate] = useState<ReportTemplate | null>(null)

    useEffect(() => listenReport(db, reportId, setReport), [reportId])

    useEffect(() => {
        if (!report?.templateId) return
        getReportTemplate(db, report.templateId).then(setTemplate).catch(() => setTemplate(null))
    }, [report?.templateId])

    const allowed = !!report && canUserViewFullReport(user, report)

    useEffect(() => {
        if (!allowed) {
            setBlocks([])
            return
        }
        return listenReportBlocks(db, reportId, setBlocks)
    }, [reportId, allowed])

    const grouped = useMemo(() => {
        const map = new Map<string, ReportBlock[]>()
        blocks.forEach(block => map.set(block.sectionTitle, [...(map.get(block.sectionTitle) || []), block]))
        return Array.from(map.entries())
    }, [blocks])

    const mappedBlocks = useMemo(() => {
        const map = new Map<string, ReportBlock>()
        blocks.forEach(block => block.sourceDocumentNodeIds?.forEach(id => map.set(id, block)))
        return map
    }, [blocks])

    if (!report) return <Empty description="Loading preview" />
    if (!allowed) return <Result status="403" title="Full report preview is restricted" subTitle="Contributors can only view the blocks assigned to them." extra={<Button onClick={onBack}>Back</Button>} />

    return (
        <div className="report-shell">
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <Space><Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back to Workspace</Button><Text type="secondary">Document Preview · approximates the generated Word layout</Text></Space>
                <div className="preview-wrap">
                    <div className="report-paper">
                        {template?.documentStructure?.nodes.length ? template.documentStructure.nodes.map(node => <DocumentNode key={node.id} node={node} block={mappedBlocks.get(node.id)} />) : <>
                        <Title level={2} style={{ textAlign: 'center' }}>{report.title}</Title>
                        <Text strong style={{ display: 'block', textAlign: 'center', marginBottom: 32 }}>{report.periodLabel}</Text>
                        {grouped.map(([sectionTitle, sectionBlocks]) => (
                            <section key={sectionTitle} className="preview-section">
                                <Title level={3}>{sectionTitle}</Title>
                                {sectionBlocks.map(block => (
                                    <div key={block.id} className="preview-block">
                                        <Title level={4}>{block.title}</Title>
                                        {block.contentType === 'narrative' || block.contentType === 'static' ? (
                                            String(block.content || '').split(/\n{2,}/).map((paragraph, index) => <Paragraph key={index} style={{ whiteSpace: 'pre-wrap' }}>{paragraph}</Paragraph>)
                                        ) : (
                                            <Table
                                                size="small"
                                                pagination={false}
                                                rowKey={(_, index) => String(index)}
                                                dataSource={Array.isArray(block.content?.rows) ? block.content.rows : []}
                                                columns={(block.schema?.columns || []).map(column => ({ title: column, dataIndex: column, key: column }))}
                                                scroll={{ x: true }}
                                            />
                                        )}
                                    </div>
                                ))}
                            </section>
                        ))}</>}
                    </div>
                </div>
            </Space>
        </div>
    )
}

const blockValue = (block?: ReportBlock) => {
    if (!block) return null
    if (typeof block.content === 'string') return block.content
    if (Array.isArray(block.content?.rows)) return block.content.rows.map((row: any) => Object.values(row || {}).join(' | ')).join('\n')
    return String(block.content || '')
}

const DocumentNode: React.FC<{ node: ExtractedDocumentNode; block?: ReportBlock }> = ({ node, block }) => {
    if (node.kind === 'table') {
        const rows = block && Array.isArray(block.content?.rows) ? block.content.rows : Object.values(node.rows || {}).map(row => Object.fromEntries(Object.values(row).map((cell, index) => [`Column ${index + 1}`, cell.text])))
        const columns = block?.schema?.columns?.length ? block.schema.columns : Object.keys(rows[0] || {})
        return <Table size="small" pagination={false} rowKey={(_, index) => String(index)} dataSource={rows} columns={columns.map(column => ({ title: column, dataIndex: column, key: column }))} scroll={{ x: true }} style={{ marginBottom: 16 }} />
    }
    const value = blockValue(block) ?? node.text
    if (!value) return <div style={{ minHeight: 10 }} />
    if (/heading|title/i.test(node.style || '')) return <Title level={node.style?.toLowerCase().includes('1') ? 2 : 3}>{value}</Title>
    return <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{value}</Paragraph>
}

export default ReportPreviewPage
