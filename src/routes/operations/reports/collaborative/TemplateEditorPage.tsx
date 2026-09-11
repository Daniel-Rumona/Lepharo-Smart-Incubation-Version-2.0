import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    Divider,
    Drawer,
    Empty,
    Result,
    Form,
    Input,
    Popconfirm,
    Radio,
    Row,
    Select,
    Space,
    Spin,
    Tag,
    Typography,
    message
} from 'antd'
import { DeleteOutlined, EyeOutlined, FileSearchOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { getReportTemplate, updateReportTemplate } from './services/reportTemplatesService'
import { extractDocxStructure } from './services/docxExtractionService'
import { detectTemplateBlocks, type TemplateDetectionSuggestion } from './services/aiTemplateDetectionService'
import { loadReportDepartments, loadReportPrograms } from './services/reportDirectoryService'
import type {
    CarryPolicy,
    EvidencePolicy,
    ReportContentType,
    ReportDirectoryDepartment,
    ReportDirectoryProgram,
    ReportTemplate,
    ReportUserContext,
    TemplateBlock,
    TemplateFrequency,
    TemplateSection
} from './types'
import { ContentTypeTag, PageHeader } from './shared'
import { canUserManageTemplate } from './reportPermissions'
import TemplateLayoutPreview from './components/TemplateLayoutPreview'
import ExtractedDocumentPreview from './components/ExtractedDocumentPreview'

const { Text, Title } = Typography

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const newBlock = (): TemplateBlock => ({
    id: uid('block'),
    title: 'New Block',
    contentType: 'narrative',
    required: true,
    carryPolicy: 'review',
    evidencePolicy: 'none',
    editorDepartmentIds: [],
    editorDepartmentNames: [],
    editorUserIds: [],
    editorUserNames: [],
    schema: {},
    defaultContent: ''
})

const newSection = (order: number): TemplateSection => ({ id: uid('section'), title: 'New Section', order, blocks: [newBlock()] })

type Props = {
    user: ReportUserContext
    templateId: string
    onBack: () => void
}

const TemplateEditorPage: React.FC<Props> = ({ user, templateId, onBack }) => {
    const [template, setTemplate] = useState<ReportTemplate | null>(null)
    const [departments, setDepartments] = useState<ReportDirectoryDepartment[]>([])

    const [programs, setPrograms] = useState<ReportDirectoryProgram[]>([])
    const [selected, setSelected] = useState<{ sectionId: string; blockId: string } | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false)
    const [extracting, setExtracting] = useState(false)
    const [detecting, setDetecting] = useState(false)
    const [suggestions, setSuggestions] = useState<TemplateDetectionSuggestion[]>([])
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    useEffect(() => {
        let mounted = true
        setLoading(true)
        Promise.all([
            getReportTemplate(db, templateId),
            loadReportDepartments(db),
            loadReportPrograms(db)
        ]).then(([tpl, deps, progs]) => {
            if (!mounted) return
            setTemplate(tpl)
            setDepartments(deps)
            setPrograms(user.isAccountManager && user.role === 'operations'
                ? progs.filter(item => user.managedPrograms.includes(item.id))
                : progs)
            const first = tpl.sections[0]?.blocks[0]
            if (first) setSelected({ sectionId: tpl.sections[0].id, blockId: first.id })
        }).catch((err: any) => message.error(err?.message || 'Could not load template.')).finally(() => mounted && setLoading(false))
        return () => { mounted = false }
    }, [templateId, user.uid, user.isAccountManager, user.managedPrograms.join('|')])

    const activeBlock = useMemo(() => {
        if (!template || !selected) return null
        return template.sections.find(s => s.id === selected.sectionId)?.blocks.find(b => b.id === selected.blockId) || null
    }, [template, selected])

    const currentProgram = useMemo(
        () => activeProgramId ? programs.find(item => item.id === activeProgramId) : undefined,
        [activeProgramId, programs]
    )

    const updateTemplateMeta = (patch: Partial<ReportTemplate>) => setTemplate(current => current ? ({ ...current, ...patch }) : current)

    const updateSection = (sectionId: string, patch: Partial<TemplateSection>) => setTemplate(current => current ? ({
        ...current,
        sections: current.sections.map(section => section.id === sectionId ? { ...section, ...patch } : section)
    }) : current)

    const updateBlock = (sectionId: string, blockId: string, patch: Partial<TemplateBlock>) => setTemplate(current => current ? ({
        ...current,
        sections: current.sections.map(section => section.id !== sectionId ? section : {
            ...section,
            blocks: section.blocks.map(block => block.id === blockId ? { ...block, ...patch } : block)
        })
    }) : current)

    const addSection = () => {
        if (!template) return
        const section = newSection(template.sections.length + 1)
        setTemplate({ ...template, sections: [...template.sections, section] })
        setSelected({ sectionId: section.id, blockId: section.blocks[0].id })
    }

    const addBlock = (sectionId: string) => {
        if (!template) return
        const block = newBlock()
        setTemplate({
            ...template,
            sections: template.sections.map(section => section.id === sectionId ? { ...section, blocks: [...section.blocks, block] } : section)
        })
        setSelected({ sectionId, blockId: block.id })
    }

    const removeSection = (sectionId: string) => {
        if (!template) return
        const sections = template.sections.filter(section => section.id !== sectionId).map((section, index) => ({ ...section, order: index + 1 }))
        setTemplate({ ...template, sections })
        const first = sections[0]?.blocks[0]
        setSelected(first ? { sectionId: sections[0].id, blockId: first.id } : null)
    }

    const removeBlock = (sectionId: string, blockId: string) => {
        if (!template) return
        const sections = template.sections.map(section => section.id !== sectionId ? section : { ...section, blocks: section.blocks.filter(block => block.id !== blockId) })
        setTemplate({ ...template, sections })
        const first = sections.find(section => section.id === sectionId)?.blocks[0] || sections[0]?.blocks[0]
        const parent = sections.find(section => section.blocks.some(block => block.id === first?.id))
        setSelected(first && parent ? { sectionId: parent.id, blockId: first.id } : null)
    }

    const handleDepartmentChange = (ids: string[]) => {
        if (!activeBlock || !selected) return
        const names = departments.filter(item => ids.includes(item.id)).map(item => item.name)
        updateBlock(selected.sectionId, selected.blockId, { editorDepartmentIds: ids, editorDepartmentNames: names })
    }



    const save = async () => {
        if (!template) return
        if (!template.name.trim()) return message.error('Template name is required.')
        setSaving(true)
        try {
            const programNames = programs.filter(item => template.programIds.includes(item.id)).map(item => item.name)
            await updateReportTemplate({
                db,
                templateId: template.id,
                user,
                patch: {
                    name: template.name.trim(),
                    description: template.description || '',
                    frequency: template.frequency,
                    programIds: template.programIds,
                    programNames,
                    sections: template.sections
                }
            })
            message.success('Template configuration saved.')
        } catch (err: any) {
            message.error(err?.message || 'Could not save template.')
        } finally {
            setSaving(false)
        }
    }

    const resetConfiguration = async () => {
        if (!template) return
        setSaving(true)
        try {
            await updateReportTemplate({ db, templateId: template.id, user, patch: { sections: [] } })
            setTemplate(current => current ? { ...current, sections: [] } : current)
            setSelected(null)
            message.success('Template blocks and mappings cleared. The source DOCX was kept for AI detection.')
        } catch (err: any) {
            message.error(err?.message || 'Could not reset the template configuration.')
        } finally {
            setSaving(false)
        }
    }

    const extractSourceDocument = async () => {
        if (!template?.sourceFile?.url) return message.error('Upload a DOCX source file before extracting its structure.')
        setExtracting(true)
        try {
            const response = await fetch(template.sourceFile.url)
            if (!response.ok) throw new Error('Could not download the source DOCX.')
            const documentStructure = await extractDocxStructure(await response.blob())
            await updateReportTemplate({ db, templateId: template.id, user, patch: { documentStructure } })
            setTemplate(current => current ? { ...current, documentStructure } : current)
            setDocumentPreviewOpen(true)
            message.success('DOCX structure extracted and saved for manual mapping.')
        } catch (err: any) {
            message.error(err?.message || 'Could not extract the DOCX structure.')
        } finally {
            setExtracting(false)
        }
    }

    const detectBlocks = async () => {
        if (!template?.documentStructure) return message.error('Extract the DOCX before using AI detection.')
        setDetecting(true)
        try {
            setSuggestions(await detectTemplateBlocks(template.name, template.frequency, template.documentStructure))
            setDocumentPreviewOpen(true)
        } catch (err: any) { message.error(err?.message || 'Could not detect template blocks.') }
        finally { setDetecting(false) }
    }

    const applyAiSuggestions = async () => {
        if (!template || !suggestions.length) return
        const bySection = new Map<string, TemplateBlock[]>()
        suggestions.forEach(suggestion => {
            const blocks = bySection.get(suggestion.sectionTitle) || []
            blocks.push({
                ...newBlock(),
                id: uid('ai-block'),
                title: suggestion.title,
                contentType: suggestion.contentType,
                sourceDocumentNodeIds: suggestion.nodeIds,
                defaultContent: suggestion.contentType === 'table' || suggestion.contentType === 'kpi' ? { rows: [] } : ''
            })
            bySection.set(suggestion.sectionTitle, blocks)
        })
        const sections = Array.from(bySection.entries()).map(([title, blocks], index) => ({ id: uid('ai-section'), title, order: index + 1, blocks }))
        setSaving(true)
        try {
            await updateReportTemplate({ db, templateId: template.id, user, patch: { sections } })
            setTemplate(current => current ? { ...current, sections } : current)
            const first = sections[0]?.blocks[0]
            setSelected(first ? { sectionId: sections[0].id, blockId: first.id } : null)
            message.success('AI proposals applied as a draft template. Review ownership and evidence settings, then save any adjustments.')
        } catch (err: any) { message.error(err?.message || 'Could not apply AI proposals.') }
        finally { setSaving(false) }
    }

    if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
    if (!template) return <Empty description="Template not found" />
    if (!canUserManageTemplate(user, template)) return <Result status="403" title="You do not manage this template" subTitle="Account Managers can only edit templates whose programmes are fully within managedPrograms." />

    return (
        <div className="report-shell">
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <PageHeader
                    eyebrow="TEMPLATE CONFIGURATION"
                    title={template.name}
                    subtitle="Phase 2 is manual: define the report structure and assign department ownership. Operations/HOD users delegate coordinators on the live report."
                    onBack={onBack}
                    actions={<Space><Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>Preview Blocks</Button><Button icon={<FileSearchOutlined />} loading={extracting} onClick={extractSourceDocument}>Extract DOCX</Button>{template.documentStructure ? <Button loading={detecting} onClick={detectBlocks}>AI Detect Blocks</Button> : null}{template.documentStructure ? <Button onClick={() => setDocumentPreviewOpen(true)}>Source Structure</Button> : null}<Popconfirm title="Reset this template configuration?" description="All sections, blocks and mappings will be removed. The source DOCX stays." okText="Reset configuration" okButtonProps={{ danger: true }} onConfirm={resetConfiguration}><Button danger>Reset Configuration</Button></Popconfirm><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save Template</Button></Space>}
                />

                <Card className="report-soft-card">
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={isAllPrograms ? 8 : 11}><Form.Item label="Template name" style={{ marginBottom: 0 }}><Input value={template.name} onChange={e => updateTemplateMeta({ name: e.target.value })} /></Form.Item></Col>
                        <Col xs={24} md={5}><Form.Item label="Frequency" style={{ marginBottom: 0 }}><Select style={{ width: '100%' }} value={template.frequency} onChange={(frequency: TemplateFrequency) => updateTemplateMeta({ frequency })} options={['Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Ad Hoc'].map(value => ({ value, label: value }))} /></Form.Item></Col>
                        {isAllPrograms ? (
                            <Col xs={24} md={11}><Form.Item label="Programmes" style={{ marginBottom: 0 }}><Select mode="multiple" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} value={template.programIds} onChange={programIds => updateTemplateMeta({ programIds })} options={programs.map(item => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
                        ) : (
                            <Col xs={24} md={8}>
                                <Form.Item label="Programme context" style={{ marginBottom: 0 }}>
                                    <div className="report-program-context"><Tag color="blue">{currentProgram?.name || activeProgramId}</Tag><Text type="secondary">Controlled by the global programme filter</Text></div>
                                </Form.Item>
                            </Col>
                        )}
                        <Col span={24}><Form.Item label="Description" style={{ marginBottom: 0 }}><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={template.description} onChange={e => updateTemplateMeta({ description: e.target.value })} /></Form.Item></Col>
                    </Row>
                </Card>

                <div className="template-structure-grid">
                    <div>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            {template.sections.map(section => (
                                <Card key={section.id} className="report-soft-card template-section-card" title={
                                    <Input variant="borderless" value={section.title} onChange={e => updateSection(section.id, { title: e.target.value })} style={{ fontWeight: 650 }} />
                                } extra={<Space><Button size="small" icon={<PlusOutlined />} onClick={() => addBlock(section.id)}>Block</Button><Popconfirm title="Delete this section?" onConfirm={() => removeSection(section.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space>}>
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                        {section.blocks.length ? section.blocks.map(block => (
                                            <div key={block.id} className={`template-block-row ${selected?.blockId === block.id ? 'active' : ''}`} onClick={() => setSelected({ sectionId: section.id, blockId: block.id })}>
                                                <Row align="middle" gutter={[8, 8]}>
                                                    <Col flex="auto"><Text strong>{block.title}</Text><div><ContentTypeTag value={block.contentType} />{block.required ? <Tag color="red">Required</Tag> : <Tag>Optional</Tag>}{block.evidencePolicy === 'required' ? <Tag color="volcano">Evidence required</Tag> : block.evidencePolicy === 'optional' ? <Tag color="blue">Evidence optional</Tag> : null}</div></Col>
                                                    <Col><Text type="secondary" style={{ fontSize: 11 }}>{(block.editorDepartmentNames?.length || 0) + (block.editorUserNames?.length || 0)} assignment(s)</Text></Col>
                                                </Row>
                                            </div>
                                        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No blocks" />}
                                    </Space>
                                </Card>
                            ))}
                            <Button block icon={<PlusOutlined />} onClick={addSection}>Add Section</Button>
                        </Space>
                    </div>

                    <Card className="report-soft-card template-structure-editor" title="Block Settings">
                        {activeBlock && selected ? (
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <div><Text type="secondary" style={{ fontSize: 11 }}>BLOCK TITLE</Text><Input value={activeBlock.title} onChange={e => updateBlock(selected.sectionId, selected.blockId, { title: e.target.value })} /></div>
                                <div><Text type="secondary" style={{ fontSize: 11 }}>CONTENT TYPE</Text><Select style={{ width: '100%' }} value={activeBlock.contentType} onChange={(contentType: ReportContentType) => updateBlock(selected.sectionId, selected.blockId, { contentType, defaultContent: contentType === 'table' || contentType === 'kpi' ? { rows: [] } : '' })} options={[
                                    { value: 'narrative', label: 'Narrative' },
                                    { value: 'kpi', label: 'KPI Block' },
                                    { value: 'table', label: 'Structured Table' },
                                    { value: 'static', label: 'Static / Read-only' }
                                ]} /></div>
                                <Checkbox checked={activeBlock.required} onChange={e => updateBlock(selected.sectionId, selected.blockId, { required: e.target.checked })}>Required block</Checkbox>
                                {template.documentStructure ? <div><Text type="secondary" style={{ fontSize: 11 }}>SOURCE DOCUMENT BLOCKS</Text><Select mode="multiple" allowClear style={{ width: '100%' }} value={activeBlock.sourceDocumentNodeIds || []} onChange={sourceDocumentNodeIds => updateBlock(selected.sectionId, selected.blockId, { sourceDocumentNodeIds })} options={template.documentStructure.nodes.map(node => ({ value: node.id, label: `${node.id} · ${node.kind} · ${(node.text || 'Empty').slice(0, 90)}` }))} /></div> : null}
                                <div>
                                    <Text type="secondary" style={{ fontSize: 11 }}>SUPPORTING EVIDENCE</Text>
                                    <Select style={{ width: '100%' }} value={activeBlock.evidencePolicy || 'none'} onChange={(evidencePolicy: EvidencePolicy) => updateBlock(selected.sectionId, selected.blockId, { evidencePolicy })} options={[
                                        { value: 'none', label: 'No evidence upload' },
                                        { value: 'optional', label: 'Optional evidence upload' },
                                        { value: 'required', label: 'Required evidence upload' }
                                    ]} />
                                </div>
                                <Divider style={{ margin: '2px 0' }} />
                                <div><Text type="secondary" style={{ fontSize: 11 }}>EDITING DEPARTMENTS</Text><Select mode="multiple" allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} value={activeBlock.editorDepartmentIds} onChange={handleDepartmentChange} options={departments.map(item => ({ value: item.id, label: item.name }))} /></div>
                                <Alert type="info" showIcon message="Coordinator access is delegated by the Operations/HOD on the live report. Templates assign department ownership only." />
                                <Divider style={{ margin: '2px 0' }} />
                                <div>
                                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 5 }}>Q3 → Q4 CARRY POLICY</Text>
                                    <Radio.Group value={activeBlock.carryPolicy} onChange={e => updateBlock(selected.sectionId, selected.blockId, { carryPolicy: e.target.value as CarryPolicy })}>
                                        <Space direction="vertical"><Radio value="carry">Carry forward by default</Radio><Radio value="review">Carry as editable starting content</Radio><Radio value="reset">Reset each reporting period</Radio></Space>
                                    </Radio.Group>
                                </div>
                                {(activeBlock.contentType === 'table' || activeBlock.contentType === 'kpi') ? (
                                    <div><Text type="secondary" style={{ fontSize: 11 }}>TABLE COLUMNS</Text><Input value={(activeBlock.schema?.columns || []).join(', ')} onChange={e => updateBlock(selected.sectionId, selected.blockId, { schema: { ...activeBlock.schema, columns: e.target.value.split(',').map(v => v.trim()).filter(Boolean) } })} placeholder="Indicator, Target, Achieved, Variance, Comments, Status" /></div>
                                ) : null}
                                {activeBlock.contentType === 'narrative' || activeBlock.contentType === 'static' ? (
                                    <div><Text type="secondary" style={{ fontSize: 11 }}>DEFAULT / STATIC TEXT</Text><Input.TextArea autoSize={{ minRows: 5, maxRows: 10 }} value={typeof activeBlock.defaultContent === 'string' ? activeBlock.defaultContent : ''} onChange={e => updateBlock(selected.sectionId, selected.blockId, { defaultContent: e.target.value })} /></div>
                                ) : null}
                                <Popconfirm title="Delete this block?" onConfirm={() => removeBlock(selected.sectionId, selected.blockId)}><Button danger block icon={<DeleteOutlined />}>Delete Block</Button></Popconfirm>
                            </Space>
                        ) : <Empty description="Select a block" />}
                    </Card>
                </div>

                <Drawer
                    open={previewOpen}
                    onClose={() => setPreviewOpen(false)}
                    title="Template Block Preview"
                    width={760}
                    destroyOnHidden
                >
                    <TemplateLayoutPreview
                        template={template}
                        selectedBlockId={selected?.blockId}
                        onSelectBlock={(sectionId, blockId) => setSelected({ sectionId, blockId })}
                    />
                </Drawer>
                <Drawer open={documentPreviewOpen} onClose={() => setDocumentPreviewOpen(false)} title="Extracted DOCX Structure" width={900} destroyOnHidden>
                    {suggestions.length ? <><Alert type="info" showIcon message="AI proposals — review before applying" description={suggestions.map(item => `${item.confidence}% · ${item.sectionTitle}: ${item.title} (${item.contentType}; ${item.nodeIds.join(', ')})`).join('\n')} style={{ whiteSpace: 'pre-line', marginBottom: 12 }} /><Button type="primary" loading={saving} onClick={applyAiSuggestions} style={{ marginBottom: 16 }}>Apply AI Proposals as Template Blocks</Button></> : null}
                    <ExtractedDocumentPreview structure={template.documentStructure} selectedNodeIds={activeBlock?.sourceDocumentNodeIds} />
                </Drawer>
            </Space>
        </div>
    )
}

export default TemplateEditorPage
