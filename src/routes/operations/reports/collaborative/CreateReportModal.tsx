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
import { ChoiceCards } from '@/components/queries/ChoiceCards'

const { Dragger } = Upload
const { Text, Title } = Typography

type Flow = 'template' | 'upload'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The period after the last report's ("Q3 2026" → "Q4 2026"), else the current one. */
const suggestPeriod = (frequency: TemplateFrequency, lastPeriod?: string) => {
    const now = new Date()
    const q = /^Q([1-4]) (\d{4})$/.exec(lastPeriod || '')
    if (frequency === 'Quarterly') {
        if (q) return Number(q[1]) === 4 ? `Q1 ${Number(q[2]) + 1}` : `Q${Number(q[1]) + 1} ${q[2]}`
        return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
    }
    const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(lastPeriod || '')
    if (frequency === 'Monthly') {
        if (m && MONTHS.includes(m[1])) {
            const i = MONTHS.indexOf(m[1])
            return i === 11 ? `Jan ${Number(m[2]) + 1}` : `${MONTHS[i + 1]} ${m[2]}`
        }
        return `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
    }
    const h = /^H([12]) (\d{4})$/.exec(lastPeriod || '')
    if (frequency === 'Semi-Annual') {
        if (h) return h[1] === '1' ? `H2 ${h[2]}` : `H1 ${Number(h[2]) + 1}`
        return `H${now.getMonth() < 6 ? 1 : 2} ${now.getFullYear()}`
    }
    if (frequency === 'Annual') return lastPeriod && /^\d{4}$/.test(lastPeriod) ? String(Number(lastPeriod) + 1) : String(now.getFullYear())
    return ''
}

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
    initialFlow = 'template',
    preferredTemplateId,
    onClose,
    onReportCreated,
    onTemplateCreated
}) => {
    const [flow, setFlow] = useState<Flow>('template')
    const [showCopyOptions, setShowCopyOptions] = useState(false)
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
    const [starterMode, setStarterMode] = useState<'blank' | 'srmcdt'>('blank')
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
        setStarterMode('blank')
        setShowCopyOptions(false)
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
                const template = templates.find(item => item.id === templateId)
                const period = suggestPeriod(template?.frequency || reportFrequency, rows[0]?.periodLabel)
                if (period) setPeriodLabel(current => current || period)
            })
            .catch(() => {
                setPreviousReports([])
                setSourceReportId(undefined)
                setStartMode('fresh')
            })
    }, [templateId, programId, open, user.uid])

    // The name follows the template and period until someone types their own.
    const autoTitle = selectedTemplate ? `${selectedTemplate.name.replace(/ Reporting Template$/i, '')}${periodLabel ? ` · ${periodLabel}` : ''}` : ''
    const [titleTouched, setTitleTouched] = useState(false)
    useEffect(() => {
        if (!titleTouched) setTitle(autoTitle)
    }, [autoTitle, titleTouched])
    useEffect(() => {
        if (open) setTitleTouched(false)
    }, [open])

    const resetAndClose = () => {
        onClose()
    }

    const handleCreateReport = async () => {
        if (!templateId || !selectedTemplate) return message.error('Select a report template.')
        if (!title.trim()) return message.error('Enter a report name.')
        if (!periodLabel.trim()) return message.error('Enter the reporting period.')
        const effectiveProgramId = activeProgramId || programId
        if (isAccountManager(user) && !isProjectAdmin(user) && !effectiveProgramId) return message.error('Select one of your managed programmes.')
        if (startMode === 'carry_over' && !sourceReportId) return message.error('Choose the report to copy from.')

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
            message.success('Template uploaded. Set up its sections next.')
            resetAndClose()
            onTemplateCreated(templateIdCreated)
        } catch (err: any) {
            message.error(err?.message || 'Could not create the template.')
        } finally {
            setCreating(false)
        }
    }

    const templateFlow = (
        <div className="cr-form">
            {templates.length === 0 ? (
                <Alert
                    type="info"
                    showIcon
                    message="There’s no report template yet"
                    description={user.canManageTemplates ? 'Add one under Templates (upload the Word report you fill in each period), then come back.' : 'Ask a report owner to set one up.'}
                />
            ) : null}
            <div className="cr-form-row">
                <div className="cr-field">
                    <label className="cr-label" htmlFor="cr-template">Template</label>
                    <Select
                        id="cr-template"
                        style={{ width: '100%' }}
                        value={templateId}
                        onChange={value => { setTemplateId(value); setPeriodLabel('') }}
                        placeholder="Choose a template"
                        options={templates.map(item => ({ value: item.id, label: `${item.name} · ${item.frequency}` }))}
                    />
                </div>
                <div className="cr-field">
                    <label className="cr-label" htmlFor="cr-period">Period</label>
                    <Select
                        id="cr-period"
                        showSearch
                        optionFilterProp="label"
                        value={periodLabel || undefined}
                        onChange={setPeriodLabel}
                        placeholder={`Choose the ${(selectedTemplate?.frequency || 'report').toLowerCase()} period`}
                        options={periodOptions.map(value => ({ value, label: value }))}
                        style={{ width: '100%' }}
                    />
                </div>
            </div>

            <div className="cr-form-row">
                <div className="cr-field">
                    <label className="cr-label" htmlFor="cr-title">Report name</label>
                    <Input id="cr-title" value={title} onChange={e => { setTitle(e.target.value); setTitleTouched(true) }} />
                </div>
                {isAllPrograms ? (
                    <div className="cr-field">
                        <label className="cr-label" htmlFor="cr-programme">Programme</label>
                        <Select
                            id="cr-programme"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            style={{ width: '100%' }}
                            value={programId}
                            onChange={setProgramId}
                            placeholder={isAccountManager(user) && !isProjectAdmin(user) ? 'Choose one of your programmes' : 'Optional'}
                            options={programs.map(item => ({ value: item.id, label: item.name }))}
                        />
                    </div>
                ) : (
                    <div className="cr-field">
                        <span className="cr-label">Programme</span>
                        <div className="cr-static">{currentProgram?.name || 'The programme in view'}</div>
                    </div>
                )}
            </div>

            <div className="cr-field">
                <span className="cr-label">How to start</span>
                <ChoiceCards<'carry_over' | 'fresh'>
                    compact
                    label="How to start the report"
                    value={startMode}
                    onChange={value => setStartMode(value)}
                    options={[
                        ...(previousReports.length
                            ? [{ value: 'carry_over' as const, label: 'Copy from the last report', detail: 'Start from what was written last time', icon: <CopyOutlined /> }]
                            : []),
                        { value: 'fresh' as const, label: 'Start blank', detail: 'Same sections, empty', icon: <FileTextOutlined /> }
                    ]}
                />
            </div>

            {startMode === 'carry_over' ? (
                <div className="cr-copy">
                    <div className="cr-field">
                        <label className="cr-label" htmlFor="cr-source">Copy from</label>
                        <Select
                            id="cr-source"
                            style={{ width: '100%' }}
                            value={sourceReportId}
                            onChange={setSourceReportId}
                            options={previousReports.map(item => ({ value: item.id, label: `${item.title} · ${item.periodLabel}` }))}
                        />
                    </div>
                    <Button type="link" size="small" className="cr-link" onClick={() => setShowCopyOptions(v => !v)}>
                        {showCopyOptions ? 'Hide what to copy' : 'Choose what to copy'}
                    </Button>
                    {showCopyOptions ? (
                        <div className="cr-copy-options">
                            <Checkbox checked={carryOver.carryNarrative} onChange={e => setCarryOver(v => ({ ...v, carryNarrative: e.target.checked }))}>Written text</Checkbox>
                            <Checkbox checked={carryOver.carryOpenItems} onChange={e => setCarryOver(v => ({ ...v, carryOpenItems: e.target.checked }))}>Open issues, risks and plans</Checkbox>
                            <Checkbox checked={carryOver.carryTargets} onChange={e => setCarryOver(v => ({ ...v, carryTargets: e.target.checked }))}>KPI targets</Checkbox>
                            <Checkbox checked={carryOver.carryActuals} onChange={e => setCarryOver(v => ({ ...v, carryActuals: e.target.checked }))}>Last period’s achieved values</Checkbox>
                            <Checkbox checked={carryOver.carryAttachments} onChange={e => setCarryOver(v => ({ ...v, carryAttachments: e.target.checked }))}>Evidence files</Checkbox>
                        </div>
                    ) : (
                        <span className="cr-hint">Copies the text, open issues and KPI targets; achieved values and evidence start empty.</span>
                    )}
                </div>
            ) : null}
        </div>
    )

    const uploadFlow = (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <span className="cr-hint">Upload the Word report you fill in each period. Next you’ll set up its sections and who writes each one.</span>
            <Dragger
                accept=".docx"
                multiple={false}
                beforeUpload={() => false}
                fileList={fileList}
                onChange={({ fileList: next }) => setFileList(next.slice(-1))}
            >
                <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
                <p className="ant-upload-text">Drop the Word report here, or click to choose it</p>
                <p className="ant-upload-hint">.docx</p>
            </Dragger>
            <Row gutter={[12, 12]}>
                <Col xs={24} md={12}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>TEMPLATE NAME</Text>
                    <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Quarterly programme report" />
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
                <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 6 }}>SECTIONS TO START WITH</Text>
                <Radio.Group value={starterMode} onChange={e => setStarterMode(e.target.value)}>
                    <Space direction="vertical">
                        <Radio value="blank">None — find them in the document (AI can suggest them)</Radio>
                        <Radio value="srmcdt">A sample quarterly report’s sections</Radio>
                    </Space>
                </Radio.Group>
            </div>
        </Space>
    )

    return (
        <Modal
            open={open}
            onCancel={resetAndClose}
            width={flow === 'template' ? 640 : 760}
            destroyOnClose
            title={flow === 'template' ? 'New report' : 'New template'}
            footer={
                flow === 'template' ? (
                    <Button block type="primary" onClick={handleCreateReport} loading={creating} disabled={!templates.length}>
                        Create report
                    </Button>
                ) : (
                    <Button block type="primary" onClick={handleCreateTemplate} loading={creating}>
                        Upload and set up sections
                    </Button>
                )
            }
        >
            {flow === 'template' ? templateFlow : uploadFlow}
        </Modal>
    )
}

export default CreateReportModal
