import React, { useEffect, useRef, useState } from 'react'
import {
    Modal,
    Form,
    Input,
    InputNumber,
    Select,
    Button,
    Row,
    Col,
    Card,
    Alert,
    Typography,
    Upload,
    Divider,
    Space,
    Spin,
    message,
    theme
} from 'antd'
import { InboxOutlined, PlusCircleOutlined, DeleteOutlined, MessageOutlined, SendOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'
import { KpiAgreement, KpiAgreementFormData, Department } from '@/types/types'
import { departmentService } from '@/services/departmentService'
import {
    extractKpiAgreement,
    sendKpiAgreementChatTurn,
    KpiAgreementChatMessage,
    KpiAgreementExtractionResult
} from '@/services/kpiAgreementExtractionService'
import { recordAiFeedback, diffScalarFeedback, diffArrayFeedback, AiFeedbackItem } from '@/services/aiFeedbackService'

const { Dragger } = Upload
const { Title, Text } = Typography

const KPI_AGREEMENT_FEEDBACK_FEATURE = 'kpi_agreement'

interface KpiAgreementFormModalProps {
    open: boolean
    onClose: () => void
    onSaved: (values: KpiAgreementFormData, sourceFileName?: string) => Promise<void>
    initialValues?: KpiAgreement | null
}

type FormShape = {
    departmentId: string
    serviceName: string
    fyLabel: string
    formNo: string
    revisionNo: string
    effectiveDate: string
    monthlyCapacity: string
    numericTargets: { kpiName: string; annual: number; q1: number; q2: number; q3: number; q4: number }[]
    deliverables: { kpiArea: string; deliverable: string; measurementIndicator: string; frequency: string }[]
    hodName: string
    hodDate: string
    centerManagerName: string
    centerManagerDate: string
    ceoName: string
    ceoDate: string
}

export const KpiAgreementFormModal: React.FC<KpiAgreementFormModalProps> = ({
    open,
    onClose,
    onSaved,
    initialValues
}) => {
    const [form] = Form.useForm<FormShape>()
    const { token } = theme.useToken()
    const isEditMode = !!initialValues

    const [phase, setPhase] = useState<'entry' | 'chat' | 'review'>(isEditMode ? 'review' : 'entry')
    const [departments, setDepartments] = useState<Department[]>([])
    const [loadingDepartments, setLoadingDepartments] = useState(true)
    const [extracting, setExtracting] = useState(false)
    const [saving, setSaving] = useState(false)
    const [warnings, setWarnings] = useState<string[]>([])
    const [sourceFileName, setSourceFileName] = useState<string | undefined>(initialValues?.source?.fileName)

    const [chatMessages, setChatMessages] = useState<KpiAgreementChatMessage[]>([])
    const [chatInput, setChatInput] = useState('')
    const [chatSending, setChatSending] = useState(false)

    // The AI's original suggestion for this review session, if any — diffed
    // against what actually gets saved so the reusable feedback loop can
    // learn what it got right or wrong. Null for a from-scratch edit of an
    // already-saved agreement, since there's no fresh suggestion to compare.
    const aiDraftRef = useRef<KpiAgreementExtractionResult | null>(null)

    useEffect(() => {
        if (!open) return
        const fetchDepartments = async () => {
            try {
                setLoadingDepartments(true)
                const data = await departmentService.getDepartments()
                setDepartments(data)
            } catch (error) {
                console.error('Error fetching departments for KPI agreement form:', error)
            } finally {
                setLoadingDepartments(false)
            }
        }
        fetchDepartments()
    }, [open])

    useEffect(() => {
        if (!open) return
        setPhase(isEditMode ? 'review' : 'entry')
        setWarnings([])
        setSourceFileName(initialValues?.source?.fileName)
        setChatMessages([])
        setChatInput('')
        aiDraftRef.current = null

        if (initialValues) {
            form.setFieldsValue({
                departmentId: initialValues.departmentId,
                serviceName: initialValues.serviceName,
                fyLabel: initialValues.fyLabel,
                formNo: initialValues.formNo,
                revisionNo: initialValues.revisionNo,
                effectiveDate: initialValues.effectiveDate,
                monthlyCapacity: initialValues.monthlyCapacity,
                numericTargets: initialValues.numericTargets.map(t => ({
                    kpiName: t.kpiName, annual: t.annual, q1: t.q1, q2: t.q2, q3: t.q3, q4: t.q4
                })),
                deliverables: initialValues.deliverables.map(d => ({
                    kpiArea: d.kpiArea,
                    deliverable: d.deliverable,
                    measurementIndicator: d.measurementIndicator,
                    frequency: d.frequency
                })),
                hodName: initialValues.signOff.hod.name,
                hodDate: initialValues.signOff.hod.date,
                centerManagerName: initialValues.signOff.centerManager.name,
                centerManagerDate: initialValues.signOff.centerManager.date,
                ceoName: initialValues.signOff.ceo.name,
                ceoDate: initialValues.signOff.ceo.date
            })
        } else {
            form.resetFields()
            form.setFieldsValue({
                formNo: 'LEP QMS 054 F',
                revisionNo: '0',
                numericTargets: [],
                deliverables: [],
                hodName: '', hodDate: '', centerManagerName: '', centerManagerDate: '', ceoName: '', ceoDate: ''
            } as any)
        }
    }, [open, initialValues, form, isEditMode])

    /** Populate the form from a draft and remember it for feedback diffing, regardless of which entry point produced it. */
    const applyDraft = (draft: KpiAgreementExtractionResult) => {
        form.setFieldsValue({
            serviceName: draft.serviceName,
            fyLabel: draft.fyLabel,
            formNo: draft.formNo || 'LEP QMS 054 F',
            revisionNo: draft.revisionNo || '0',
            effectiveDate: draft.effectiveDate,
            monthlyCapacity: draft.monthlyCapacity,
            numericTargets: draft.numericTargets,
            deliverables: draft.deliverables
        } as any)
        setWarnings(draft.warnings || [])
        aiDraftRef.current = JSON.parse(JSON.stringify(draft))
        setPhase('review')
    }

    const handleExtract: UploadProps['beforeUpload'] = async (file) => {
        const departmentId = form.getFieldValue('departmentId')
        if (!departmentId) {
            message.warning('Choose a department before uploading the letter.')
            return Upload.LIST_IGNORE
        }

        try {
            setExtracting(true)
            const draft = await extractKpiAgreement(file as File)
            setSourceFileName((file as File).name)
            applyDraft(draft)
            message.success('Draft ready — review and confirm the details below.')
        } catch (error: any) {
            message.error(error?.message || 'Could not read that document')
        } finally {
            setExtracting(false)
        }

        return Upload.LIST_IGNORE
    }

    const handleChatSend = async () => {
        const departmentId = form.getFieldValue('departmentId')
        if (!departmentId) {
            message.warning('Choose a department before starting the conversation.')
            return
        }
        const text = chatInput.trim()
        if (!text || chatSending) return

        const nextMessages: KpiAgreementChatMessage[] = [...chatMessages, { role: 'user', content: text }]
        setChatMessages(nextMessages)
        setChatInput('')

        try {
            setChatSending(true)
            const result = await sendKpiAgreementChatTurn(nextMessages)
            setChatMessages([...nextMessages, { role: 'assistant', content: result.message }])
            if (result.done && result.draft) {
                setSourceFileName(undefined)
                applyDraft(result.draft)
                message.success('Draft ready — review and confirm the details below.')
            }
        } catch (error: any) {
            message.error(error?.message || 'The assistant is unavailable right now.')
        } finally {
            setChatSending(false)
        }
    }

    const handleSave = async (values: FormShape) => {
        const department = departments.find(d => d.id === values.departmentId)
        const payload: KpiAgreementFormData = {
            departmentId: values.departmentId,
            departmentName: department?.name || initialValues?.departmentName || '',
            serviceName: values.serviceName,
            formNo: values.formNo,
            revisionNo: values.revisionNo,
            effectiveDate: values.effectiveDate,
            fyLabel: values.fyLabel,
            monthlyCapacity: values.monthlyCapacity,
            numericTargets: values.numericTargets || [],
            deliverables: values.deliverables || [],
            signOff: {
                hod: { name: values.hodName || '', date: values.hodDate || '' },
                centerManager: { name: values.centerManagerName || '', date: values.centerManagerDate || '' },
                ceo: { name: values.ceoName || '', date: values.ceoDate || '' }
            },
            source: sourceFileName ? { fileName: sourceFileName, extractedAt: new Date().toISOString() } : null
        }

        try {
            setSaving(true)
            await onSaved(payload, sourceFileName)
            recordDraftFeedback(payload)
        } finally {
            setSaving(false)
        }
    }

    /** Diff the AI's original draft against what actually got saved and log it — fire-and-forget. */
    const recordDraftFeedback = (payload: KpiAgreementFormData) => {
        const draft = aiDraftRef.current
        if (!draft) return

        const items: AiFeedbackItem[] = []
        diffScalarFeedback('field:serviceName', draft.serviceName, payload.serviceName, items)
        diffScalarFeedback('field:fyLabel', draft.fyLabel, payload.fyLabel, items)
        diffScalarFeedback('field:effectiveDate', draft.effectiveDate, payload.effectiveDate, items)
        diffScalarFeedback('field:monthlyCapacity', draft.monthlyCapacity, payload.monthlyCapacity, items)
        diffArrayFeedback('numericTarget', draft.numericTargets, payload.numericTargets, items)
        diffArrayFeedback('deliverable', draft.deliverables, payload.deliverables, items)

        if (items.length) {
            recordAiFeedback(KPI_AGREEMENT_FEEDBACK_FEATURE, items, sourceFileName).catch(() => {})
        }
    }

    const subtleCardStyle: React.CSSProperties = {
        marginBottom: 10,
        background: token.colorFillAlter,
        borderColor: token.colorBorderSecondary
    }

    return (
        <Modal
            title={isEditMode ? 'Edit KPI Agreement' : 'Import KPI Agreement'}
            open={open}
            onCancel={onClose}
            footer={null}
            maskClosable={false}
            width={960}
            destroyOnClose
        >
            <Form form={form} layout='vertical' onFinish={handleSave} autoComplete='off' size='middle'>
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Department'
                            name='departmentId'
                            rules={[{ required: true, message: 'Please select a department' }]}
                        >
                            <Select
                                placeholder='Select department'
                                loading={loadingDepartments}
                                showSearch
                                optionFilterProp='children'
                                disabled={isEditMode}
                                options={departments.map(dept => ({ value: dept.id, label: dept.name }))}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                {phase === 'entry' && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='Upload a KPI agreement letter, or answer a few questions instead. Either way the assistant drafts the targets below for you to check before saving — nothing is saved automatically.'
                        />
                        <Dragger
                            accept='.pdf,.docx,.png,.jpg,.jpeg,.txt'
                            multiple={false}
                            showUploadList={false}
                            disabled={extracting}
                            beforeUpload={handleExtract}
                        >
                            <p className='ant-upload-drag-icon'><InboxOutlined /></p>
                            <p className='ant-upload-text'>
                                {extracting ? 'Reading document…' : 'Click or drag the KPI agreement letter here'}
                            </p>
                            <p className='ant-upload-hint'>PDF, Word (.docx), image, or text file</p>
                        </Dragger>

                        <Divider plain>or</Divider>

                        <Button
                            block
                            icon={<MessageOutlined />}
                            disabled={extracting}
                            onClick={() => setPhase('chat')}
                        >
                            Answer a few questions instead
                        </Button>

                        <div style={{ marginTop: 24, display: 'flex' }}>
                            <Button onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
                        </div>
                    </>
                )}

                {phase === 'chat' && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message="No letter handy? Answer a few short questions and the assistant will draft the agreement from your answers."
                        />

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
                            {chatMessages.length === 0 && (
                                <Text type='secondary'>
                                    Start by telling the assistant which department/service this is for and the financial year.
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
                            {chatSending && (
                                <div style={{ alignSelf: 'flex-start' }}>
                                    <Spin size='small' />
                                </div>
                            )}
                        </div>

                        <Space.Compact style={{ width: '100%' }}>
                            <Input
                                placeholder='Type your answer…'
                                value={chatInput}
                                disabled={chatSending}
                                onChange={e => setChatInput(e.target.value)}
                                onPressEnter={handleChatSend}
                            />
                            <Button type='primary' icon={<SendOutlined />} loading={chatSending} onClick={handleChatSend}>
                                Send
                            </Button>
                        </Space.Compact>

                        <div style={{ marginTop: 24, display: 'flex' }}>
                            <Button onClick={() => setPhase('entry')} style={{ flex: 1 }}>Back</Button>
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
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='Review the drafted agreement below, correct anything the assistant got wrong, then confirm to save.'
                        />

                        <Row gutter={16}>
                            <Col xs={24} md={12}>
                                <Form.Item label='Service name' name='serviceName' rules={[{ required: true, message: 'Required' }]}>
                                    <Input placeholder='e.g. Financial Compliance Services' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item label='Financial year' name='fyLabel' rules={[{ required: true, message: 'e.g. 2026-27 FY' }]}>
                                    <Input placeholder='e.g. 2026-27 FY' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item label='Effective date' name='effectiveDate'>
                                    <Input placeholder='e.g. 01 December 2019' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Row gutter={16}>
                            <Col xs={12} md={6}>
                                <Form.Item label='Form No' name='formNo' rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={6}>
                                <Form.Item label='Revision No' name='revisionNo' rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item label='Monthly capacity' name='monthlyCapacity'>
                                    <Input placeholder='e.g. 30 MSMEs financial compliance services' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Divider orientation='left'>Numeric Targets (Annual / Quarterly)</Divider>
                        <Form.List name='numericTargets'>
                            {(fields, { add, remove }) => (
                                <>
                                    {fields.length === 0 && (
                                        <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>
                                            No numeric targets — this letter may use deliverables instead.
                                        </Text>
                                    )}
                                    {fields.map(field => (
                                        <Card key={field.key} size='small' style={subtleCardStyle}>
                                            <Row gutter={[12, 8]} align='top'>
                                                <Col xs={24} md={9}>
                                                    <Form.Item
                                                        {...field}
                                                        label='KPI name'
                                                        name={[field.name, 'kpiName']}
                                                        rules={[{ required: true, message: 'Required' }]}
                                                    >
                                                        <Input placeholder='e.g. Direct Jobs Management accounts' />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={9} md={3}>
                                                    <Form.Item {...field} label='Annual' name={[field.name, 'annual']}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={9} md={2}>
                                                    <Form.Item {...field} label='Q1' name={[field.name, 'q1']}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={9} md={2}>
                                                    <Form.Item {...field} label='Q2' name={[field.name, 'q2']}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={9} md={2}>
                                                    <Form.Item {...field} label='Q3' name={[field.name, 'q3']}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={9} md={2}>
                                                    <Form.Item {...field} label='Q4' name={[field.name, 'q4']}>
                                                        <InputNumber min={0} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={2} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <Button shape='round' danger onClick={() => remove(field.name)} icon={<DeleteOutlined />} />
                                                </Col>
                                            </Row>
                                        </Card>
                                    ))}
                                    <Button
                                        type='dashed'
                                        onClick={() => add({ kpiName: '', annual: 0, q1: 0, q2: 0, q3: 0, q4: 0 })}
                                        icon={<PlusCircleOutlined />}
                                        block
                                    >
                                        Add numeric target
                                    </Button>
                                </>
                            )}
                        </Form.List>

                        <Divider orientation='left'>Deliverables</Divider>
                        <Form.List name='deliverables'>
                            {(fields, { add, remove }) => (
                                <>
                                    {fields.length === 0 && (
                                        <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>
                                            No deliverables — this letter may use numeric targets instead.
                                        </Text>
                                    )}
                                    {fields.map(field => (
                                        <Card key={field.key} size='small' style={subtleCardStyle}>
                                            <Row gutter={[12, 8]} align='top'>
                                                <Col xs={24} md={6}>
                                                    <Form.Item
                                                        {...field}
                                                        label='KPI area'
                                                        name={[field.name, 'kpiArea']}
                                                        rules={[{ required: true, message: 'Required' }]}
                                                    >
                                                        <Input placeholder='e.g. BBBEE Compliance Support' />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={7}>
                                                    <Form.Item {...field} label='Deliverable' name={[field.name, 'deliverable']}>
                                                        <Input.TextArea rows={1} placeholder='e.g. Monitoring and updating BBBEE compliance status' />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={7}>
                                                    <Form.Item {...field} label='Measurement indicator' name={[field.name, 'measurementIndicator']}>
                                                        <Input.TextArea rows={1} placeholder='e.g. Number of MSMEs with updated records' />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={18} md={3}>
                                                    <Form.Item {...field} label='Frequency' name={[field.name, 'frequency']}>
                                                        <Input placeholder='Monthly' />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={6} md={1} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <Button shape='round' danger onClick={() => remove(field.name)} icon={<DeleteOutlined />} />
                                                </Col>
                                            </Row>
                                        </Card>
                                    ))}
                                    <Button
                                        type='dashed'
                                        onClick={() => add({ kpiArea: '', deliverable: '', measurementIndicator: '', frequency: 'Monthly' })}
                                        icon={<PlusCircleOutlined />}
                                        block
                                    >
                                        Add deliverable
                                    </Button>
                                </>
                            )}
                        </Form.List>

                        <Divider orientation='left'>Sign-off</Divider>
                        <Row gutter={16}>
                            <Col xs={24} md={8}>
                                <Title level={5} style={{ marginBottom: 8 }}>HOD</Title>
                                <Form.Item label='Name & surname' name='hodName'><Input /></Form.Item>
                                <Form.Item label='Date' name='hodDate'><Input placeholder='DD Month YYYY' /></Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                                <Title level={5} style={{ marginBottom: 8 }}>Center Manager</Title>
                                <Form.Item label='Name & surname' name='centerManagerName'><Input /></Form.Item>
                                <Form.Item label='Date' name='centerManagerDate'><Input placeholder='DD Month YYYY' /></Form.Item>
                            </Col>
                            <Col xs={24} md={8}>
                                <Title level={5} style={{ marginBottom: 8 }}>CEO</Title>
                                <Form.Item label='Name & surname' name='ceoName'><Input /></Form.Item>
                                <Form.Item label='Date' name='ceoDate'><Input placeholder='DD Month YYYY' /></Form.Item>
                            </Col>
                        </Row>

                        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                            {!isEditMode ? (
                                <Button onClick={() => setPhase('entry')} style={{ flex: 1 }}>Back</Button>
                            ) : (
                                <Button onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
                            )}
                            <Button type='primary' htmlType='submit' loading={saving} style={{ flex: 1 }}>
                                {isEditMode ? 'Save changes' : 'Confirm & save agreement'}
                            </Button>
                        </div>
                    </>
                )}
            </Form>
        </Modal>
    )
}
