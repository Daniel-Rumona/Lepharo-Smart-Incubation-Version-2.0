import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    Form,
    Input,
    Modal,
    Radio,
    Row,
    Select,
    Space,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { UploadFile } from 'antd'
import {
    ArrowLeftOutlined,
    CloudUploadOutlined,
    CopyOutlined,
    FileTextOutlined,
    FolderOpenOutlined,
    RightOutlined
} from '@ant-design/icons'
import { db, storage } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import type {
    CarryOverOptions,
    ReportDirectoryProgram,
    ReportDocument,
    ReportTemplate,
    ReportUserContext,
    TemplateFrequency
} from './types'
import { listenUsableReportTemplatesForUser, createReportTemplate } from './services/reportTemplatesService'
import { createReportFromTemplate, listPreviousReportsForTemplate } from './services/reportsService'
import { loadReportPrograms } from './services/reportDirectoryService'
import { uploadReportTemplateSource } from './services/reportStorageService'
import { SRMCDT_QUARTERLY_STARTER_STRUCTURE } from './starterSrmcdtTemplate'
import { isAccountManager, isProjectAdmin } from './reportPermissions'

const { Dragger } = Upload
const { Text, Title } = Typography

type Flow = 'choose' | 'template' | 'upload'

type Props = {
    open: boolean
    user: ReportUserContext
    initialFlow?: Flow
    preferredTemplateId?: string
    onClose: () => void
    onReportCreated: (reportId: string) => void
    onTemplateCreated: (templateId: string) => void
}

const defaultCarryOver: CarryOverOptions = {
    carryNarrative: true,
    carryOpenItems: true,
    carryTargets: true,
    carryActuals: false,
    carryAttachments: false
}

const CreateReportModal: React.FC<Props> = ({
    open,
    user,
    initialFlow = 'choose',
    preferredTemplateId,
    onClose,
    onReportCreated,
    onTemplateCreated
}) => {
    const [flow, setFlow] = useState<Flow>('choose')
    const [templates, setTemplates] = useState<ReportTemplate[]>([])
    const [programs, setPrograms] = useState<ReportDirectoryProgram[]>([])
    const [templateId, setTemplateId] = useState<string | undefined>()
    const [startMode, setStartMode] = useState<'fresh' | 'carry_over'>('fresh')
    const [previousReports, setPreviousReports] = useState<ReportDocument[]>([])
    const [sourceReportId, setSourceReportId] = useState<string | undefined>()
    const [title, setTitle] = useState('')
    const [periodLabel, setPeriodLabel] = useState('')
    const [reportFrequency, setReportFrequency] = useState<TemplateFrequency>('Quarterly')
    const [programId, setProgramId] = useState<string | undefined>()
    const [carryOver, setCarryOver] = useState<CarryOverOptions>(defaultCarryOver)
    const [creating, setCreating] = useState(false)

    const [templateName, setTemplateName] = useState('')
    const [templateFrequency, setTemplateFrequency] = useState<TemplateFrequency>('Quarterly')
    const [templateProgramIds, setTemplateProgramIds] = useState<string[]>([])
    const [starterMode, setStarterMode] = useState<'blank' | 'srmcdt'>('srmcdt')
    const [fileList, setFileList] = useState<UploadFile[]>([])
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const selectedTemplate = useMemo(() => templates.find(item => item.id === templateId), [templates, templateId])
    const periodOptions = useMemo(() => {
        const years = [2025, 2026, 2027, 2028]
        const frequency = reportFrequency
        if (frequency === 'Daily') return years.flatMap(year =>
            Array.from({ length: 12 }, (_, month) =>
                Array.from({ length: 31 }, (_, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`)
            )
        ).flat()
        if (frequency === 'Quarterly') return years.flatMap(year => [1, 2, 3, 4].map(quarter => `Q${quarter} ${year}`))
        if (frequency === 'Monthly') return years.flatMap(year => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(month => `${month} ${year}`))
        if (frequency === 'Semi-Annual') return years.flatMap(year => [`H1 ${year}`, `H2 ${year}`])
        if (frequency === 'Annual') return years.map(String)
        if (frequency === 'Weekly') return years.flatMap(year => Array.from({ length: 53 }, (_, index) => `Week ${index + 1} · ${year}`))
        if (frequency === 'Bi-Weekly') return years.flatMap(year => Array.from({ length: 26 }, (_, index) => `Bi-week ${index + 1} · ${year}`))
        return years.map(year => `Ad Hoc · ${year}`)
    }, [reportFrequency])

    useEffect(() => {
        if (!open) return
        setFlow(initialFlow)
        setStartMode('fresh')
        setCarryOver(defaultCarryOver)
        setSourceReportId(undefined)
        setTitle('')
        setPeriodLabel('')
        setReportFrequency('Quarterly')
        setProgramId(activeProgramId)
        setTemplateName('')
        setTemplateFrequency('Quarterly')
        setTemplateProgramIds(activeProgramId ? [activeProgramId] : [])
        setStarterMode('srmcdt')
        setFileList([])
    }, [open, initialFlow, activeProgramId])

    useEffect(() => {
        if (selectedTemplate) setReportFrequency(selectedTemplate.frequency)
    }, [selectedTemplate?.id])

    useEffect(() => {
        if (!open) return
        const unsubscribe = listenUsableReportTemplatesForUser(db, user, rows => {
            const active = rows.filter(item => item.status === 'active')
            const scoped = activeProgramId
                ? active.filter(item => !item.programIds.length || item.programIds.includes(activeProgramId))
                : active
            setTemplates(scoped)
            const preferred = preferredTemplateId && scoped.some(item => item.id === preferredTemplateId)
                ? preferredTemplateId
                : scoped[0]?.id
            setTemplateId(current => current && scoped.some(item => item.id === current) ? current : preferred)
        })
        loadReportPrograms(db).then(rows => {
            setPrograms(isAccountManager(user) && !isProjectAdmin(user)
                ? rows.filter(item => user.managedPrograms.includes(item.id))
                : rows)
        }).catch(() => setPrograms([]))
        return unsubscribe
    }, [open, preferredTemplateId, activeProgramId, user.uid, user.isAccountManager, user.managedPrograms.join('|')])

    const currentProgram = useMemo(
        () => activeProgramId ? programs.find(item => item.id === activeProgramId) : undefined,
        [activeProgramId, programs]
    )

    useEffect(() => {
        if (!templateId || !open) {
            setPreviousReports([])
            return
        }
        listPreviousReportsForTemplate(db, templateId, user, programId)
            .then(rows => {
                setPreviousReports(rows)
                setSourceReportId(rows[0]?.id)
                setStartMode(rows.length ? 'carry_over' : 'fresh')
            })
            .catch(() => {
                setPreviousReports([])
                setSourceReportId(undefined)
                setStartMode('fresh')
            })
    }, [templateId, programId, open, user.uid])

    useEffect(() => {
        if (!selectedTemplate) return
        if (!title) setTitle(`${selectedTemplate.name.replace(/ Reporting Template$/i, '')} · New Report`)
    }, [selectedTemplate, title])

    const resetAndClose = () => {
        setFlow('choose')
        onClose()
    }

    const handleCreateReport = async () => {
        if (!templateId || !selectedTemplate) return message.error('Select a report template.')
        if (!title.trim()) return message.error('Enter a report name.')
        if (!periodLabel.trim()) return message.error('Enter the reporting period.')
        const effectiveProgramId = activeProgramId || programId
        if (isAccountManager(user) && !isProjectAdmin(user) && !effectiveProgramId) return message.error('Select one of your managed programmes.')
        if (startMode === 'carry_over' && !sourceReportId) return message.error('Select the previous report to carry over from.')

        const selectedProgram = programs.find(item => item.id === effectiveProgramId)
        setCreating(true)
        try {
            const reportId = await createReportFromTemplate({
                db,
                user,
                input: {
                    templateId,
                    title: title.trim(),
                    periodLabel: periodLabel.trim(),
                    frequency: reportFrequency,
                    programId: effectiveProgramId || null,
                    programName: selectedProgram?.name || null,
                    startMode,
                    sourceReportId: startMode === 'carry_over' ? sourceReportId || null : null,
                    carryOver
                }
            })
            message.success('Report created.')
            resetAndClose()
            onReportCreated(reportId)
        } catch (err: any) {
            message.error(err?.message || 'Could not create report.')
        } finally {
            setCreating(false)
        }
    }

    const handleCreateTemplate = async () => {
        const rawFile = fileList[0]?.originFileObj as File | undefined
        if (!rawFile) return message.error('Upload a Word .docx file.')
        if (!templateName.trim()) return message.error('Enter a template name.')
        const effectiveTemplateProgramIds = activeProgramId ? [activeProgramId] : templateProgramIds
        if (isAccountManager(user) && !isProjectAdmin(user) && !effectiveTemplateProgramIds.length) return message.error('Select at least one managed programme for this template.')

        setCreating(true)
        try {
            const draftId = `template-${Date.now()}`
            const sourceFile = await uploadReportTemplateSource(storage, draftId, rawFile)
            const selectedPrograms = programs.filter(item => effectiveTemplateProgramIds.includes(item.id))
            const sections = starterMode === 'srmcdt' ? SRMCDT_QUARTERLY_STARTER_STRUCTURE : []
            const templateIdCreated = await createReportTemplate({
                db,
                user,
                id: draftId,
                name: templateName.trim(),
                frequency: templateFrequency,
                programIds: effectiveTemplateProgramIds,
                programNames: selectedPrograms.map(item => item.name),
                sections,
                sourceFile
            })
            message.success('Template created. Configure its sections and block ownership next.')
            resetAndClose()
            onTemplateCreated(templateIdCreated)
        } catch (err: any) {
            message.error(err?.message || 'Could not create the template.')
        } finally {
            setCreating(false)
        }
    }

    const chooseCards = (
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <Text type="secondary">Choose how this reporting workflow should start.</Text>
            <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                    <Card className="create-modal-option" onClick={() => setFlow('template')}>
                        <Space direction="vertical" size={15} style={{ width: '100%' }}>
                            <div className="report-metric-icon" style={{ width: 54, height: 54, background: '#eef5ff', color: '#1765ad' }}><FolderOpenOutlined /></div>
                            <div>
                                <Title level={4} style={{ marginBottom: 6 }}>Use Template</Title>
                                <Text type="secondary">Create from a configured report template. Quarterly reports can carry approved Q3 content into Q4.</Text>
                            </div>
                            <Space size={6} wrap><Tag color="blue">Recommended</Tag><Tag>Supports carry-over</Tag></Space>
                            <Button type="primary" block>Choose Template</Button>
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card className="create-modal-option" onClick={() => setFlow('upload')}>
                        <Space direction="vertical" size={15} style={{ width: '100%' }}>
                            <div className="report-metric-icon" style={{ width: 54, height: 54, background: '#f5f0ff', color: '#722ed1' }}><FileTextOutlined /></div>
                            <div>
                                <Title level={4} style={{ marginBottom: 6 }}>Upload Word Document</Title>
                                <Text type="secondary">Store a DOCX as a reusable template and configure its sections and contributors manually. AI parsing comes later.</Text>
                            </div>
                            <Space size={6} wrap><Tag color="purple">DOCX</Tag><Tag>Manual setup for Phase 2</Tag></Space>
                            <Button block>Upload Document</Button>
                        </Space>
                    </Card>
                </Col>
            </Row>
        </Space>
    )

    const templateFlow = (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>TEMPLATE</Text>
                    <Select
                        style={{ width: '100%' }}
                        value={templateId}
                        onChange={value => { setTemplateId(value); setPeriodLabel('') }}
                        placeholder="Select a template"
                        options={templates.map(item => ({ value: item.id, label: `${item.name} · ${item.frequency}` }))}
                    />
                </Col>
                {isAllPrograms ? (
                    <Col xs={24} md={12}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>PROGRAMME</Text>
                        <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            value={programId}
                            onChange={setProgramId}
                            placeholder={isAccountManager(user) && !isProjectAdmin(user) ? 'Select managed programme' : 'Optional programme'}
                            options={programs.map(item => ({ value: item.id, label: item.name }))}
                        />
                    </Col>
                ) : (
                    <Col xs={24} md={12}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>PROGRAMME CONTEXT</Text>
                        <div className="report-program-context"><Tag color="blue">{currentProgram?.name || activeProgramId}</Tag><Text type="secondary">From global filter</Text></div>
                    </Col>
                )}
            </Row>

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>REPORT NAME</Text>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="SRMCDT Project Report · Quarter 4" />
                </Col>
                <Col xs={24} md={5}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>REPORTING CADENCE</Text>
                    <Select value={reportFrequency} onChange={value => { setReportFrequency(value); setPeriodLabel('') }} options={['Daily', 'Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Ad Hoc'].map(value => ({ value, label: value }))} style={{ width: '100%' }} />
                </Col>
                <Col xs={24} md={7}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>REPORTING PERIOD</Text>
                    <Select showSearch optionFilterProp="label" value={periodLabel || undefined} onChange={setPeriodLabel} placeholder={`Select ${selectedTemplate?.frequency || 'report'} period`} options={periodOptions.map(value => ({ value, label: value }))} style={{ width: '100%' }} />
                </Col>
            </Row>

            <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                    <Card className={`carry-choice ${startMode === 'fresh' ? 'selected' : ''}`} onClick={() => setStartMode('fresh')}>
                        <Space align="start">
                            <Radio checked={startMode === 'fresh'} />
                            <div><Text strong>Start fresh</Text><Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Use the configured structure but start period content empty.</Text></div>
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} md={12}>
                    <Card className={`carry-choice ${startMode === 'carry_over' ? 'selected' : ''}`} onClick={() => previousReports.length && setStartMode('carry_over')} style={{ opacity: previousReports.length ? 1 : .55 }}>
                        <Space align="start">
                            <Radio checked={startMode === 'carry_over'} disabled={!previousReports.length} />
                            <div>
                                <Space size={6} wrap><Text strong>Carry over previous report</Text><Tag color="gold" icon={<CopyOutlined />}>Quarterly</Tag></Space>
                                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Use an earlier report as the editable starting point.</Text>
                            </div>
                        </Space>
                    </Card>
                </Col>
            </Row>

            {startMode === 'carry_over' ? (
                <Card size="small" style={{ background: '#fffdf5', borderColor: '#f5d98f' }}>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <div>
                            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>COPY FROM</Text>
                            <Select
                                style={{ width: '100%' }}
                                value={sourceReportId}
                                onChange={setSourceReportId}
                                options={previousReports.map(item => ({ value: item.id, label: `${item.title} · ${item.periodLabel} · ${item.status}` }))}
                            />
                        </div>
                        <Row gutter={[10, 8]}>
                            <Col xs={24} md={12}><Checkbox checked={carryOver.carryNarrative} onChange={e => setCarryOver(v => ({ ...v, carryNarrative: e.target.checked }))}>Narrative and reusable text</Checkbox></Col>
                            <Col xs={24} md={12}><Checkbox checked={carryOver.carryOpenItems} onChange={e => setCarryOver(v => ({ ...v, carryOpenItems: e.target.checked }))}>Open issues, risks and planned items</Checkbox></Col>
                            <Col xs={24} md={12}><Checkbox checked={carryOver.carryTargets} onChange={e => setCarryOver(v => ({ ...v, carryTargets: e.target.checked }))}>KPI targets</Checkbox></Col>
                            <Col xs={24} md={12}><Checkbox checked={carryOver.carryActuals} onChange={e => setCarryOver(v => ({ ...v, carryActuals: e.target.checked }))}>Previous achieved values / actuals</Checkbox></Col>
                            <Col xs={24} md={12}><Checkbox checked={carryOver.carryAttachments} onChange={e => setCarryOver(v => ({ ...v, carryAttachments: e.target.checked }))}>Attachments and evidence</Checkbox></Col>
                        </Row>
                        <Alert type="info" showIcon message="Recommended: carry context and targets, but reset period-specific achieved values, expenditure and evidence." />
                    </Space>
                </Card>
            ) : null}
        </Space>
    )

    const uploadFlow = (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Alert type="warning" showIcon message="No AI in Phase 2. The DOCX is stored now; you configure its sections, blocks and permissions manually after upload." />
            <Dragger
                accept=".docx"
                multiple={false}
                beforeUpload={() => false}
                fileList={fileList}
                onChange={({ fileList: next }) => setFileList(next.slice(-1))}
            >
                <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                <p className="ant-upload-text">Drop a Word document here or click to browse</p>
                <p className="ant-upload-hint">.docx only</p>
            </Dragger>
            <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>TEMPLATE NAME</Text>
                    <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="SRMCDT Quarterly Reporting Template" />
                </Col>
                <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>FREQUENCY</Text>
                    <Select
                        style={{ width: '100%' }}
                        value={templateFrequency}
                        onChange={setTemplateFrequency}
                        options={['Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'Ad Hoc'].map(value => ({ value, label: value }))}
                    />
                </Col>
            </Row>
            {isAllPrograms ? (
                <div>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>PROGRAMMES USING THIS TEMPLATE</Text>
                    <Select
                        mode="multiple"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                        value={templateProgramIds}
                        onChange={setTemplateProgramIds}
                        options={programs.map(item => ({ value: item.id, label: item.name }))}
                    />
                </div>
            ) : (
                <div>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>PROGRAMME CONTEXT</Text>
                    <div className="report-program-context"><Tag color="blue">{currentProgram?.name || activeProgramId}</Tag><Text type="secondary">The template will be scoped to the active programme automatically.</Text></div>
                </div>
            )}
            <div>
                <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>STARTING STRUCTURE FOR THIS TEST</Text>
                <Radio.Group value={starterMode} onChange={e => setStarterMode(e.target.value)}>
                    <Space direction="vertical">
                        <Radio value="srmcdt">Use SRMCDT quarterly starter structure from the supplied Q3 example</Radio>
                        <Radio value="blank">Blank structure — configure all sections and blocks manually</Radio>
                    </Space>
                </Radio.Group>
            </div>
        </Space>
    )

    return (
        <Modal
            open={open}
            onCancel={resetAndClose}
            width={940}
            destroyOnHidden
            title={flow === 'choose' ? 'Create Report' : flow === 'template' ? 'Create from Template' : 'Upload Word Template'}
            footer={flow === 'choose' ? null : (
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setFlow('choose')} disabled={creating}>Back</Button>
                    {flow === 'template' ? (
                        <Button type="primary" icon={<RightOutlined />} onClick={handleCreateReport} loading={creating}>Create Report</Button>
                    ) : (
                        <Button type="primary" icon={<RightOutlined />} onClick={handleCreateTemplate} loading={creating}>Create Template & Configure</Button>
                    )}
                </Space>
            )}
        >
            {flow === 'choose' ? chooseCards : flow === 'template' ? templateFlow : uploadFlow}
        </Modal>
    )
}

export default CreateReportModal
