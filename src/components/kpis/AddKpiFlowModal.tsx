import React, { useEffect, useRef, useState } from 'react'
import {
    Modal,
    Select,
    Button,
    Row,
    Col,
    Card,
    Alert,
    Typography,
    Space,
    Spin,
    Input,
    InputNumber,
    DatePicker,
    Tag,
    Tooltip,
    Switch,
    message,
    theme
} from 'antd'
import {
    InboxOutlined,
    LeftOutlined,
    MessageOutlined,
    SaveOutlined,
    SendOutlined,
    ToolOutlined,
    CheckCircleOutlined,
    QuestionCircleOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import type { Department } from '@/types/types'
import type {
    KpiCandidate,
    KpiCandidateChatMessage,
    KpiCandidateDraft,
    KpiCandidateSourceType
} from '@/types/kpiCandidate'
import { extractKpiCandidates, sendKpiCandidateChatTurn } from '@/services/kpiCandidateService'
import { recordAiFeedback, type AiFeedbackItem } from '@/services/aiFeedbackService'

dayjs.extend(quarterOfYear)

const { Text } = Typography

const KPI_SOURCE_MAPPING_FEEDBACK_FEATURE = 'kpi_source_mapping'

export interface CandidateFilter {
    field: string
    op: '==' | '!=' | 'in'
    value: any
}

export interface CandidateDecision {
    kpiName: string
    annual: number
    q1: number
    q2: number
    q3: number
    q4: number
    trackingMode: 'computed' | 'manual'
    sourceType?: KpiCandidateSourceType
    field?: string | null
    calculationType?: 'count' | 'sum' | 'average'
    countMode?: 'records'
    unit: 'count' | 'ZAR' | 'percent'
    filters: CandidateFilter[]
    reminderCadence?: 'monthly' | 'quarterly'
    aiMapping: KpiCandidate['mapping']
}

export interface CreateFromCandidatesInput {
    departmentId: string
    departmentName: string
    fyLabel: string
    quarterStartDate: Dayjs
    decisions: CandidateDecision[]
}

interface AddKpiFlowModalProps {
    open: boolean
    onClose: () => void
    departments: Department[]
    defaultDepartmentId?: string | null
    isMonitoring?: boolean
    onManualConfigure: () => void
    onCreateCandidates: (input: CreateFromCandidatesInput) => Promise<void>
}

type ReviewRow = CandidateDecision & { include: boolean; kpiArea: string }

/** metrics/interventions field -> deterministic unit + calc, independent of whatever free text the model returned. */
const resolveComputedShape = (mapping: KpiCandidate['mapping']): Pick<CandidateDecision, 'sourceType' | 'field' | 'calculationType' | 'unit' | 'filters' | 'countMode'> | null => {
    if (!mapping?.sourceType) return null

    if (mapping.sourceType === 'metrics' && mapping.field) {
        const isRevenue = mapping.field === 'monthlyRevenue'
        return {
            sourceType: 'metrics',
            field: mapping.field,
            calculationType: mapping.calculationType === 'average' ? 'average' : 'sum',
            unit: isRevenue ? 'ZAR' : 'count',
            filters: []
        }
    }

    if (mapping.sourceType === 'interventions' && mapping.interventionTitleMatch) {
        return {
            sourceType: 'interventions',
            field: null,
            calculationType: 'count',
            countMode: 'records',
            unit: 'count',
            filters: [{ field: 'interventionTitle', op: '==', value: mapping.interventionTitleMatch }]
        }
    }

    if (mapping.sourceType === 'applications') {
        return { sourceType: 'applications', field: null, calculationType: 'count', unit: 'count', filters: [] }
    }

    return null
}

const candidateToRow = (candidate: KpiCandidate): ReviewRow => {
    const computed = resolveComputedShape(candidate.mapping)
    return {
        kpiName: candidate.kpiName,
        kpiArea: candidate.kpiArea,
        annual: candidate.annual,
        q1: candidate.q1,
        q2: candidate.q2,
        q3: candidate.q3,
        q4: candidate.q4,
        include: true,
        trackingMode: computed ? 'computed' : 'manual',
        unit: computed?.unit || 'count',
        filters: computed?.filters || [],
        reminderCadence: computed ? undefined : 'quarterly',
        aiMapping: candidate.mapping,
        ...(computed || {})
    }
}

export const AddKpiFlowModal: React.FC<AddKpiFlowModalProps> = ({
    open,
    onClose,
    departments,
    defaultDepartmentId,
    isMonitoring = false,
    onManualConfigure,
    onCreateCandidates
}) => {
    const { token } = theme.useToken()

    const [phase, setPhase] = useState<'entry' | 'chat' | 'review'>('entry')
    const [departmentId, setDepartmentId] = useState<string | undefined>(defaultDepartmentId || undefined)
    const [extracting, setExtracting] = useState(false)
    const [saving, setSaving] = useState(false)
    const [warnings, setWarnings] = useState<string[]>([])
    const [fyLabel, setFyLabel] = useState('')
    const [quarterStartDate, setQuarterStartDate] = useState<Dayjs>(dayjs().startOf('month'))
    const [rows, setRows] = useState<ReviewRow[]>([])

    const [chatMessages, setChatMessages] = useState<KpiCandidateChatMessage[]>([])
    const [chatInput, setChatInput] = useState('')
    const [chatSending, setChatSending] = useState(false)

    const aiDraftRef = useRef<KpiCandidateDraft | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!open) return
        setPhase('entry')
        setDepartmentId(defaultDepartmentId || undefined)
        setWarnings([])
        setFyLabel('')
        setQuarterStartDate(dayjs().startOf('month'))
        setRows([])
        setChatMessages([])
        setChatInput('')
        aiDraftRef.current = null
    }, [open, defaultDepartmentId])

    const applyDraft = (draft: KpiCandidateDraft) => {
        setFyLabel(draft.fyLabel || '')
        setWarnings(draft.warnings || [])
        setRows(draft.candidates.map(candidateToRow))
        aiDraftRef.current = JSON.parse(JSON.stringify(draft))
        setPhase('review')
    }

    const handleExtract = async (file: File) => {
        if (!departmentId) {
            message.warning('Choose a department before uploading the letter.')
            return
        }
        try {
            setExtracting(true)
            const draft = await extractKpiCandidates(file, departmentId)
            applyDraft(draft)
            message.success('Draft ready — review each KPI below before saving.')
        } catch (error: any) {
            message.error(error?.message || 'Could not read that document')
        } finally {
            setExtracting(false)
        }
    }

    const handleChatSend = async () => {
        if (!departmentId) {
            message.warning('Choose a department before starting the conversation.')
            return
        }
        const text = chatInput.trim()
        if (!text || chatSending) return

        const nextMessages: KpiCandidateChatMessage[] = [...chatMessages, { role: 'user', content: text }]
        setChatMessages(nextMessages)
        setChatInput('')

        try {
            setChatSending(true)
            const result = await sendKpiCandidateChatTurn(nextMessages, departmentId)
            setChatMessages([...nextMessages, { role: 'assistant', content: result.message }])
            if (result.done && result.draft) {
                applyDraft(result.draft)
                message.success('Draft ready — review each KPI below before saving.')
            }
        } catch (error: any) {
            message.error(error?.message || 'The assistant is unavailable right now.')
        } finally {
            setChatSending(false)
        }
    }

    const updateRow = (index: number, patch: Partial<ReviewRow>) => {
        setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    }

    const recordMappingFeedback = (finalRows: ReviewRow[]) => {
        const items: AiFeedbackItem[] = []
        finalRows.forEach(row => {
            if (!row.aiMapping) return
            if (!row.include) {
                items.push({ entityType: 'mapping', suggested: row.aiMapping, final: null, action: 'declined' })
                return
            }
            const aiWantedComputed = !!row.aiMapping.sourceType
            const keptComputed = row.trackingMode === 'computed'
            items.push({
                entityType: 'mapping',
                suggested: row.aiMapping,
                final: { trackingMode: row.trackingMode, sourceType: row.sourceType || null, field: row.field || null },
                action: aiWantedComputed === keptComputed ? 'accepted' : 'edited'
            })
        })
        if (items.length) {
            recordAiFeedback(KPI_SOURCE_MAPPING_FEEDBACK_FEATURE, items).catch(() => {})
        }
    }

    const handleSave = async () => {
        const department = departments.find(d => d.id === departmentId)
        if (!department) {
            message.warning('Choose a department first.')
            return
        }
        const included = rows.filter(r => r.include)
        if (!included.length) {
            message.warning('Select at least one KPI to create.')
            return
        }

        try {
            setSaving(true)
            await onCreateCandidates({
                departmentId: department.id,
                departmentName: department.name,
                fyLabel,
                quarterStartDate,
                decisions: included
            })
            recordMappingFeedback(rows)
            message.success(`${included.length} KPI${included.length === 1 ? '' : 's'} created.`)
            onClose()
        } catch (error: any) {
            message.error(error?.message || 'Failed to create KPIs')
        } finally {
            setSaving(false)
        }
    }

    const mappedCount = rows.filter(r => r.include && r.trackingMode === 'computed').length
    const manualCount = rows.filter(r => r.include && r.trackingMode === 'manual').length

    return (
        <Modal
            title='Add KPI'
            open={open}
            onCancel={onClose}
            footer={null}
            maskClosable={false}
            width={960}
            destroyOnClose
        >
            {isMonitoring && phase === 'entry' && (
                <Row style={{ marginBottom: 12 }}>
                    <Col span={24}>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Department</Text>
                        <Select
                            placeholder='Select department'
                            style={{ width: '100%' }}
                            showSearch
                            optionFilterProp='label'
                            value={departmentId}
                            onChange={setDepartmentId}
                            options={departments.map(d => ({ value: d.id, label: d.name }))}
                        />
                    </Col>
                </Row>
            )}

            {phase === 'entry' && (
                <>
                    <Alert
                        type='info'
                        showIcon
                        style={{ marginBottom: 16 }}
                        message='Each KPI is checked against live data — one that matches gets tracked automatically; one that doesn’t falls back to a manual target with reminders.'
                    />
                    <Row gutter={[12, 12]} align='stretch'>
                        <Col xs={24} sm={8} style={{ display: 'flex' }}>
                            <input
                                ref={fileInputRef}
                                type='file'
                                accept='.pdf,.docx,.png,.jpg,.jpeg,.txt'
                                style={{ display: 'none' }}
                                onChange={e => {
                                    const file = e.target.files?.[0]
                                    e.target.value = ''
                                    if (file) handleExtract(file)
                                }}
                            />
                            <Card
                                hoverable={!extracting}
                                onClick={() => !extracting && fileInputRef.current?.click()}
                                style={{ height: '100%', width: '100%', border: `1px solid ${token.colorBorder}`, cursor: extracting ? 'default' : 'pointer' }}
                                bodyStyle={{ padding: 12 }}
                            >
                                <Space align='start' size={12}>
                                    <MotionCard.IconChip size={36} bg='rgba(22,119,255,.12)' icon={<InboxOutlined style={{ color: '#1677ff', fontSize: 18 }} />} />
                                    <div>
                                        <Text strong style={{ display: 'block' }}>{extracting ? 'Reading document…' : 'Upload a letter'}</Text>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            PDF, Word (.docx), image, or text file.
                                        </Text>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} sm={8} style={{ display: 'flex' }}>
                            <Card
                                hoverable={!extracting}
                                onClick={() => !extracting && setPhase('chat')}
                                style={{ height: '100%', width: '100%', border: `1px solid ${token.colorBorder}` }}
                                bodyStyle={{ padding: 12 }}
                            >
                                <Space align='start' size={12}>
                                    <MotionCard.IconChip size={36} bg='rgba(114,46,209,.12)' icon={<MessageOutlined style={{ color: '#722ed1', fontSize: 18 }} />} />
                                    <div>
                                        <Text strong style={{ display: 'block' }}>Describe it conversationally</Text>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            No letter handy? Answer a few questions instead.
                                        </Text>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} sm={8} style={{ display: 'flex' }}>
                            <Card
                                hoverable={!extracting}
                                onClick={() => !extracting && onManualConfigure()}
                                style={{ height: '100%', width: '100%', border: `1px solid ${token.colorBorder}` }}
                                bodyStyle={{ padding: 12 }}
                            >
                                <Space align='start' size={12}>
                                    <MotionCard.IconChip size={36} bg='rgba(19,168,168,.12)' icon={<ToolOutlined style={{ color: '#13a8a8', fontSize: 18 }} />} />
                                    <div>
                                        <Text strong style={{ display: 'block' }}>Configure manually</Text>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Build a single KPI's formula and targets yourself.
                                        </Text>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            {phase === 'chat' && (
                <>
                    {departmentId && (
                        <div style={{ marginBottom: 10 }}>
                            <Tag color='purple'>
                                {departments.find(d => d.id === departmentId)?.name || 'Department'}
                            </Tag>
                            {isMonitoring && (
                                <Button
                                    type='link'
                                    size='small'
                                    onClick={() => setDepartmentId(undefined)}
                                    style={{ padding: 0 }}
                                >
                                    Change
                                </Button>
                            )}
                        </div>
                    )}

                    <div
                        style={{
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadius,
                            background: token.colorFillAlter,
                            padding: 12,
                            marginBottom: 12,
                            maxHeight: 320,
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                        }}
                    >
                        {!departmentId ? (
                            <div>
                                <Text style={{ display: 'block', marginBottom: 10 }}>Which department is this for?</Text>
                                <Row gutter={[8, 8]}>
                                    {departments.map(dept => (
                                        <Col key={dept.id}>
                                            <Card
                                                hoverable
                                                size='small'
                                                onClick={() => setDepartmentId(dept.id)}
                                                style={{ cursor: 'pointer', borderColor: token.colorBorder }}
                                                bodyStyle={{ padding: '6px 12px' }}
                                            >
                                                <Text>{dept.name}</Text>
                                            </Card>
                                        </Col>
                                    ))}
                                    {!departments.length && <Text type='secondary'>No departments found.</Text>}
                                </Row>
                            </div>
                        ) : (
                            <>
                                {chatMessages.length === 0 && (
                                    <Text type='secondary'>
                                        Tell the assistant which KPIs this department needs to track, and any targets you already know.
                                    </Text>
                                )}
                                {chatMessages.map((msg, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                            maxWidth: '80%',
                                            background: msg.role === 'user' ? token.colorPrimaryBg : token.colorBgContainer,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            borderRadius: token.borderRadius,
                                            padding: '6px 10px'
                                        }}
                                    >
                                        <Text>{msg.content}</Text>
                                    </div>
                                ))}
                                {chatSending && <div style={{ alignSelf: 'flex-start' }}><Spin size='small' /></div>}
                            </>
                        )}
                    </div>

                    <Space.Compact style={{ width: '100%' }}>
                        <Input
                            placeholder='Type your answer…'
                            value={chatInput}
                            disabled={chatSending || !departmentId}
                            onChange={e => setChatInput(e.target.value)}
                            onPressEnter={handleChatSend}
                        />
                        <Button type='primary' icon={<SendOutlined />} loading={chatSending} disabled={!departmentId} onClick={handleChatSend}>
                            Send
                        </Button>
                    </Space.Compact>

                    <div style={{ marginTop: 24 }}>
                        <Button shape='round' icon={<LeftOutlined />} onClick={() => setPhase('entry')} block>Back</Button>
                    </div>
                </>
            )}

            {phase === 'review' && (
                <>
                    {warnings.length > 0 && (
                        <Alert
                            type='warning'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='Some parts of the document needed attention'
                            description={<ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                        />
                    )}

                    <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col xs={24} md={8}>
                            <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>Financial year</Text>
                            <Input value={fyLabel} onChange={e => setFyLabel(e.target.value)} placeholder='e.g. 2026-27 FY' />
                        </Col>
                        <Col xs={24} md={8}>
                            <Tooltip title="The letter's Q1 — pick the month it actually starts so quarterly targets land on the right calendar quarter.">
                                <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>Q1 starts <QuestionCircleOutlined /></Text>
                            </Tooltip>
                            <DatePicker
                                picker='month'
                                style={{ width: '100%' }}
                                value={quarterStartDate}
                                onChange={value => value && setQuarterStartDate(value.startOf('month'))}
                                allowClear={false}
                            />
                        </Col>
                        <Col xs={24} md={8} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                            <Tag color='blue'>{mappedCount} tracked automatically</Tag>
                            <Tag color='orange'>{manualCount} manual</Tag>
                        </Col>
                    </Row>

                    <Space direction='vertical' size={10} style={{ width: '100%' }}>
                        {rows.map((row, index) => (
                            <Card
                                key={`${row.kpiName}-${index}`}
                                size='small'
                                style={{
                                    opacity: row.include ? 1 : 0.5,
                                    background: token.colorFillAlter,
                                    borderColor: token.colorBorderSecondary
                                }}
                            >
                                <Row gutter={[12, 8]} align='top'>
                                    <Col xs={24} md={9}>
                                        <Input
                                            value={row.kpiName}
                                            onChange={e => updateRow(index, { kpiName: e.target.value })}
                                            disabled={!row.include}
                                        />
                                        <div style={{ marginTop: 6 }}>
                                            {row.trackingMode === 'computed' ? (
                                                <Tooltip title={row.aiMapping?.rationale}>
                                                    <Tag icon={<CheckCircleOutlined />} color={row.aiMapping?.confidence === 'high' ? 'green' : 'gold'}>
                                                        Tracked automatically
                                                        {row.field ? ` · ${row.field}` : row.filters[0] ? ` · ${row.filters[0].value}` : ''}
                                                    </Tag>
                                                </Tooltip>
                                            ) : (
                                                <Tag color='orange'>No live source — manual target</Tag>
                                            )}
                                        </div>
                                    </Col>
                                    <Col xs={12} md={3}>
                                        <Text type='secondary' style={{ fontSize: 11 }}>Annual</Text>
                                        <InputNumber min={0} style={{ width: '100%' }} value={row.annual} disabled={!row.include}
                                            onChange={v => updateRow(index, { annual: Number(v || 0) })} />
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Text type='secondary' style={{ fontSize: 11 }}>Q1</Text>
                                        <InputNumber min={0} style={{ width: '100%' }} value={row.q1} disabled={!row.include}
                                            onChange={v => updateRow(index, { q1: Number(v || 0) })} />
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Text type='secondary' style={{ fontSize: 11 }}>Q2</Text>
                                        <InputNumber min={0} style={{ width: '100%' }} value={row.q2} disabled={!row.include}
                                            onChange={v => updateRow(index, { q2: Number(v || 0) })} />
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Text type='secondary' style={{ fontSize: 11 }}>Q3</Text>
                                        <InputNumber min={0} style={{ width: '100%' }} value={row.q3} disabled={!row.include}
                                            onChange={v => updateRow(index, { q3: Number(v || 0) })} />
                                    </Col>
                                    <Col xs={6} md={2}>
                                        <Text type='secondary' style={{ fontSize: 11 }}>Q4</Text>
                                        <InputNumber min={0} style={{ width: '100%' }} value={row.q4} disabled={!row.include}
                                            onChange={v => updateRow(index, { q4: Number(v || 0) })} />
                                    </Col>
                                    <Col xs={24} md={4} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                        {row.aiMapping?.sourceType && (
                                            <Space size={4}>
                                                <Text style={{ fontSize: 11 }}>Track live</Text>
                                                <Switch
                                                    size='small'
                                                    checked={row.trackingMode === 'computed'}
                                                    disabled={!row.include}
                                                    onChange={checked => updateRow(index, { trackingMode: checked ? 'computed' : 'manual', reminderCadence: checked ? undefined : 'quarterly' })}
                                                />
                                            </Space>
                                        )}
                                        <Button
                                            size='small'
                                            danger={row.include}
                                            type='text'
                                            icon={row.include ? <DeleteOutlined /> : undefined}
                                            onClick={() => updateRow(index, { include: !row.include })}
                                        >
                                            {row.include ? 'Skip' : 'Restore'}
                                        </Button>
                                    </Col>
                                </Row>
                            </Card>
                        ))}
                        {!rows.length && <Text type='secondary'>Nothing drafted yet.</Text>}
                    </Space>

                    <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                        <Button shape='round' icon={<LeftOutlined />} onClick={() => setPhase('entry')} style={{ flex: 1 }}>Back</Button>
                        <Button shape='round' type='primary' icon={<SaveOutlined />} loading={saving} style={{ flex: 1 }} onClick={handleSave}>
                            Create {rows.filter(r => r.include).length || ''} KPI{rows.filter(r => r.include).length === 1 ? '' : 's'}
                        </Button>
                    </div>
                </>
            )}
        </Modal>
    )
}
