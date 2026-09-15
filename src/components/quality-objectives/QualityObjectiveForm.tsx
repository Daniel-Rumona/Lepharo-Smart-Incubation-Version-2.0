import React, { useEffect, useState } from 'react'
import {
    Form,
    Input,
    InputNumber,
    DatePicker,
    Select,
    Button,
    Row,
    Col,
    Card,
    Alert,
    Checkbox,
    Tooltip,
    Tag,
    Typography,
    theme
} from 'antd'
import { PlusCircleOutlined, DeleteOutlined, HolderOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import dayjs, { Dayjs } from 'dayjs'
import {
    QualityObjective,
    QualityObjectiveFormData,
    Department,
    SmartCriteria,
    RATING_LEVELS,
    SMART_CRITERIA_META,
    makeDefaultSmartCriteria
} from '@/types/types'
import { departmentService } from '@/services/departmentService'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { TextArea } = Input
const { Title, Text } = Typography

interface QualityObjectiveFormProps {
    initialValues?: QualityObjective | null
    onSubmit: (values: QualityObjectiveFormData) => Promise<void>
    onCancel: () => void
    isEditMode: boolean
}

type FormShape = {
    departmentId: string
    formNo: string
    revisionNo: string
    effectiveDate: Dayjs
    referenceNumber: string
    objectiveNumber: number
    objectiveText: string
    kpaName: string
    weighting: number
    smart: SmartCriteria
    kpis: { description: string; targetValue: string; actualValue: string; weighting: number; rating?: string }[]
    period: [Dayjs, Dayjs]
    preparedBy: string
    preparedDate: Dayjs
    approvedByCEO: string
    acknowledgedByHOD: string
    steps: { description: string; responsiblePerson: string; targetDate: string; completionDate: string }[]
    overallRating?: string
    ratingComments?: string
}

const makeEmptyStep = () => ({
    description: '',
    responsiblePerson: '',
    targetDate: '',
    completionDate: ''
})

const makeEmptyKpi = () => ({
    description: '',
    targetValue: '',
    actualValue: '',
    weighting: 0,
    rating: undefined
})

// Each "page" of the conversational modal. No progress indicator is shown for
// these — just Back/Next controls — but the title/description keep each step
// feeling like a focused question rather than a slice of one giant form.
const WIZARD_STEPS = [
    {
        title: 'The basics',
        description: 'Which department is this objective for, and what period does it cover?'
    },
    {
        title: 'Key Performance Area',
        description: 'Name the functional area this objective belongs to and how it should be weighted.'
    },
    {
        title: 'Key Performance Indicators',
        description: 'List the measurable deliverables that show whether this objective has been met.'
    },
    {
        title: 'Means / Steps',
        description: 'What steps get this objective done, and who is responsible for each?'
    },
    {
        title: 'Evaluation & sign-off',
        description: 'Rate achievement (if known yet) and capture who prepared and approved this objective.'
    }
]

export const QualityObjectiveForm: React.FC<QualityObjectiveFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    isEditMode
}) => {
    const [form] = Form.useForm<FormShape>()
    const { token } = theme.useToken()
    const { user } = useFullIdentity()
    const [departments, setDepartments] = useState<Department[]>([])
    const [loadingDepartments, setLoadingDepartments] = useState(true)
    const [currentStep, setCurrentStep] = useState(0)
    const kpisWatch: { weighting?: number }[] = Form.useWatch('kpis', form) || []
    const kpiWeightingTotal = kpisWatch.reduce((sum, kpi) => sum + (Number(kpi?.weighting) || 0), 0)

    const isFirstStep = currentStep === 0
    const isLastStep = currentStep === WIZARD_STEPS.length - 1

    const subtleCardStyle: React.CSSProperties = {
        marginBottom: 10,
        background: token.colorFillAlter,
        borderColor: token.colorBorderSecondary
    }

    useEffect(() => {
        const fetchDepartments = async () => {
            try {
                setLoadingDepartments(true)
                const data = await departmentService.getDepartments()
                setDepartments(data)
            } catch (error) {
                console.error('Error fetching departments for quality objective form:', error)
            } finally {
                setLoadingDepartments(false)
            }
        }
        fetchDepartments()
    }, [])

    useEffect(() => {
        if (initialValues) {
            form.setFieldsValue({
                departmentId: initialValues.departmentId,
                formNo: initialValues.formNo,
                revisionNo: initialValues.revisionNo,
                effectiveDate: initialValues.effectiveDate ? dayjs(initialValues.effectiveDate) : undefined,
                referenceNumber: initialValues.referenceNumber,
                objectiveNumber: initialValues.objectiveNumber,
                objectiveText: initialValues.objectiveText,
                kpaName: initialValues.kpaName,
                weighting: initialValues.weighting,
                smart: initialValues.smart || makeDefaultSmartCriteria(),
                kpis: (initialValues.kpis || []).map(kpi => ({
                    description: kpi.description,
                    targetValue: kpi.targetValue,
                    actualValue: kpi.actualValue,
                    weighting: kpi.weighting,
                    rating: kpi.rating
                })),
                period: [dayjs(initialValues.periodStart), dayjs(initialValues.periodEnd)],
                overallRating: initialValues.overallRating,
                ratingComments: initialValues.ratingComments,
                preparedBy: initialValues.preparedBy,
                preparedDate: initialValues.preparedDate ? dayjs(initialValues.preparedDate) : undefined,
                approvedByCEO: initialValues.approvedByCEO,
                acknowledgedByHOD: initialValues.acknowledgedByHOD,
                steps: initialValues.steps.map(step => ({
                    description: step.description,
                    responsiblePerson: step.responsiblePerson,
                    targetDate: step.targetDate,
                    completionDate: step.completionDate
                }))
            } as any)
        } else {
            form.setFieldsValue({
                formNo: 'LEP-QMS 024 F',
                revisionNo: '0',
                effectiveDate: dayjs(),
                objectiveNumber: 1,
                weighting: 0,
                smart: makeDefaultSmartCriteria(),
                kpis: [makeEmptyKpi()],
                preparedBy: user?.name || '',
                preparedDate: dayjs(),
                steps: [makeEmptyStep()]
            } as any)
        }
    }, [initialValues, form, user?.name])

    const goNext = async () => {
        try {
            // Only the current step's Form.Items are mounted, so this validates
            // just what's visible on screen right now.
            await form.validateFields()
            setCurrentStep(step => Math.min(step + 1, WIZARD_STEPS.length - 1))
        } catch {
            // Validation errors are already shown inline by AntD.
        }
    }

    const goBack = () => setCurrentStep(step => Math.max(step - 1, 0))

    const handleSubmit = async (values: FormShape) => {
        const department = departments.find(d => d.id === values.departmentId)
        const payload: QualityObjectiveFormData = {
            departmentId: values.departmentId,
            departmentName: department?.name || initialValues?.departmentName || '',
            formNo: values.formNo,
            revisionNo: values.revisionNo,
            effectiveDate: values.effectiveDate.format('DD MMM YYYY'),
            referenceNumber: values.referenceNumber,
            objectiveNumber: values.objectiveNumber,
            objectiveText: values.objectiveText,
            kpaName: values.kpaName,
            weighting: values.weighting,
            smart: values.smart || makeDefaultSmartCriteria(),
            kpis: (values.kpis || []).map(kpi => ({
                description: kpi.description,
                targetValue: kpi.targetValue,
                actualValue: kpi.actualValue,
                weighting: kpi.weighting,
                rating: kpi.rating as any
            })),
            periodStart: values.period[0].toISOString(),
            periodEnd: values.period[1].toISOString(),
            steps: values.steps.map(step => ({
                description: step.description,
                responsiblePerson: step.responsiblePerson,
                targetDate: step.targetDate,
                completionDate: step.completionDate
            })),
            overallRating: values.overallRating as any,
            ratingComments: values.ratingComments || '',
            preparedBy: values.preparedBy,
            preparedDate: values.preparedDate.toISOString(),
            approvedByCEO: values.approvedByCEO,
            acknowledgedByHOD: values.acknowledgedByHOD,
        }

        await onSubmit(payload)
    }

    const stepMeta = WIZARD_STEPS[currentStep]

    return (
        <div>
            <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                <Title level={4} style={{ marginBottom: 4 }}>{stepMeta.title}</Title>
                <Text type='secondary'>{stepMeta.description}</Text>
            </div>

            <Form form={form} layout='vertical' onFinish={handleSubmit} autoComplete='off' size='middle'>
                {currentStep === 0 && (
                    <>
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
                                        options={departments.map(dept => ({ value: dept.id, label: dept.name }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item
                                    label='Period (start - end)'
                                    name='period'
                                    rules={[{ required: true, message: 'Please select the objective period' }]}
                                >
                                    <DatePicker.RangePicker style={{ width: '100%' }} format='DD MMM YYYY' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Row gutter={16}>
                            <Col xs={24} md={6}>
                                <Form.Item
                                    label='Reference Number'
                                    name='referenceNumber'
                                    rules={[{ required: true, message: 'e.g. HR 001/2023' }]}
                                >
                                    <Input placeholder='e.g. HR 001/2023' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={4}>
                                <Form.Item
                                    label='Objective No.'
                                    name='objectiveNumber'
                                    rules={[{ required: true, message: 'Required' }]}
                                >
                                    <InputNumber min={1} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={5}>
                                <Form.Item label='Form No' name='formNo' rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={4}>
                                <Form.Item label='Revision No' name='revisionNo' rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={5}>
                                <Form.Item label='Effective date' name='effectiveDate' rules={[{ required: true }]}>
                                    <DatePicker style={{ width: '100%' }} format='DD MMM YYYY' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Row gutter={16}>
                            <Col span={24}>
                                <Form.Item
                                    label='Quality Objective statement'
                                    name='objectiveText'
                                    rules={[{ required: true, message: 'Describe the objective and its target' }]}
                                >
                                    <TextArea
                                        rows={3}
                                        placeholder='e.g. To ensure that 90% of new employee information required for the HR files are collected within 30 days from the date of employment.'
                                        showCount
                                        maxLength={600}
                                    />
                                </Form.Item>
                            </Col>
                        </Row>
                    </>
                )}

                {currentStep === 1 && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='A KPA is the functional area this objective belongs to (e.g. Recruitment, Document Control, Client Retention). Weighting reflects how important this objective is relative to the department’s other objectives for the period — all objectives for a department should add up to 100%.'
                        />
                        <Row gutter={16}>
                            <Col xs={24} md={18}>
                                <Form.Item
                                    label='Key Performance Area'
                                    name='kpaName'
                                    rules={[{ required: true, message: 'Name the KPA this objective belongs to' }]}
                                >
                                    <Input placeholder='e.g. Employee Records Management' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item
                                    label='Weighting'
                                    name='weighting'
                                    rules={[{ required: true, message: 'Required' }]}
                                >
                                    <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter='%' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Form.Item label='SMART criteria' style={{ marginBottom: 8 }}>
                            <Row gutter={[16, 8]}>
                                {SMART_CRITERIA_META.map(criterion => (
                                    <Col xs={24} sm={12} md={8} key={criterion.key}>
                                        <Tooltip title={criterion.description}>
                                            <Form.Item name={['smart', criterion.key]} valuePropName='checked' noStyle>
                                                <Checkbox>
                                                    {criterion.label} <InfoCircleOutlined style={{ color: token.colorTextTertiary }} />
                                                </Checkbox>
                                            </Form.Item>
                                        </Tooltip>
                                    </Col>
                                ))}
                            </Row>
                        </Form.Item>
                    </>
                )}

                {currentStep === 2 && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='List the measurable deliverables used to indicate whether this objective/KPA has been met, with the target and (once available) actual result. KPI weightings should add up to 100%.'
                        />

                        <Form.List name='kpis' rules={[{
                            validator: async (_, kpis) => {
                                if (!kpis || kpis.length < 1) {
                                    return Promise.reject(new Error('Add at least one KPI'))
                                }
                            }
                        }]}>
                            {(fields, { add, remove }, { errors }) => {
                                return (
                                    <>
                                        {fields.map(field => (
                                            <Card key={field.key} size='small' style={subtleCardStyle}>
                                                <Row gutter={[12, 8]} align='top'>
                                                    <Col xs={24} md={9}>
                                                        <Form.Item
                                                            {...field}
                                                            label='KPI'
                                                            name={[field.name, 'description']}
                                                            rules={[{ required: true, message: 'Describe this KPI' }]}
                                                        >
                                                            <TextArea rows={2} placeholder='e.g. % of new employee files completed within 30 days' />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={12} md={5}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Target'
                                                            name={[field.name, 'targetValue']}
                                                            rules={[{ required: true, message: 'Required' }]}
                                                        >
                                                            <Input placeholder='e.g. 90%' />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={12} md={5}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Actual'
                                                            name={[field.name, 'actualValue']}
                                                        >
                                                            <Input placeholder='Once measured' />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={12} md={3}>
                                                        <Form.Item
                                                            {...field}
                                                            label='Weighting'
                                                            name={[field.name, 'weighting']}
                                                            rules={[{ required: true, message: 'Required' }]}
                                                        >
                                                            <InputNumber min={0} max={100} style={{ width: '100%' }} addonAfter='%' />
                                                        </Form.Item>
                                                    </Col>
                                                    <Col xs={24} md={2} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                        <Button
                                                            shape='round'
                                                            danger
                                                            onClick={() => remove(field.name)}
                                                            icon={<DeleteOutlined />}
                                                        />
                                                    </Col>
                                                </Row>
                                            </Card>
                                        ))}

                                        <Form.ErrorList errors={errors} />

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                            <Button type='dashed' onClick={() => add(makeEmptyKpi())} icon={<PlusCircleOutlined />}>
                                                Add KPI
                                            </Button>
                                            <Tag color={kpiWeightingTotal === 100 ? 'green' : 'orange'}>
                                                Total weighting: {kpiWeightingTotal}%{kpiWeightingTotal !== 100 ? ' (should be 100%)' : ''}
                                            </Tag>
                                        </div>
                                    </>
                                )
                            }}
                        </Form.List>
                    </>
                )}

                {currentStep === 3 && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='List each step needed to achieve this objective, who is responsible, and the target/completion cadence (e.g. "Monthly", "Annually", or an actual date). Drag to reorder.'
                        />

                        <Form.List name='steps' rules={[{
                            validator: async (_, steps) => {
                                if (!steps || steps.length < 1) {
                                    return Promise.reject(new Error('Add at least one step'))
                                }
                            }
                        }]}>
                            {(fields, { add, remove, move }, { errors }) => {
                                const onDragEnd = (result: DropResult) => {
                                    if (!result.destination) return
                                    if (result.destination.index === result.source.index) return
                                    move(result.source.index, result.destination.index)
                                }

                                return (
                                    <>
                                        <DragDropContext onDragEnd={onDragEnd}>
                                            <Droppable droppableId='steps'>
                                                {provided => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps}>
                                                        {fields.map((field, index) => (
                                                            <Draggable key={field.key} draggableId={String(field.key)} index={index}>
                                                                {dragProvided => (
                                                                    <Card
                                                                        ref={dragProvided.innerRef}
                                                                        {...dragProvided.draggableProps}
                                                                        size='small'
                                                                        style={subtleCardStyle}
                                                                    >
                                                                        <Row gutter={[12, 8]} align='top'>
                                                                            <Col flex='0 0 28px' {...dragProvided.dragHandleProps} style={{ cursor: 'grab', textAlign: 'center', color: token.colorTextTertiary, paddingTop: 6 }}>
                                                                                <HolderOutlined />
                                                                            </Col>

                                                                            <Col xs={24} md={9}>
                                                                                <Form.Item
                                                                                    {...field}
                                                                                    label='Means / Step'
                                                                                    name={[field.name, 'description']}
                                                                                    rules={[{ required: true, message: 'Describe this step' }]}
                                                                                >
                                                                                    <TextArea rows={2} placeholder='e.g. Establish the Training Matrix for all personnel.' />
                                                                                </Form.Item>
                                                                            </Col>

                                                                            <Col xs={24} md={5}>
                                                                                <Form.Item
                                                                                    {...field}
                                                                                    label='Responsible Person'
                                                                                    name={[field.name, 'responsiblePerson']}
                                                                                    rules={[{ required: true, message: 'Required' }]}
                                                                                >
                                                                                    <Input placeholder='e.g. HR Manager' />
                                                                                </Form.Item>
                                                                            </Col>

                                                                            <Col xs={12} md={4}>
                                                                                <Form.Item
                                                                                    {...field}
                                                                                    label='Target date'
                                                                                    name={[field.name, 'targetDate']}
                                                                                    rules={[{ required: true, message: 'Required' }]}
                                                                                >
                                                                                    <Input placeholder='Monthly' />
                                                                                </Form.Item>
                                                                            </Col>

                                                                            <Col xs={12} md={4}>
                                                                                <Form.Item
                                                                                    {...field}
                                                                                    label='Completion date'
                                                                                    name={[field.name, 'completionDate']}
                                                                                >
                                                                                    <Input placeholder='Monthly' />
                                                                                </Form.Item>
                                                                            </Col>

                                                                            <Col xs={24} md={2} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                                                <Button
                                                                                    shape='round'
                                                                                    danger
                                                                                    onClick={() => remove(field.name)}
                                                                                    icon={<DeleteOutlined />}
                                                                                />
                                                                            </Col>
                                                                        </Row>
                                                                    </Card>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </DragDropContext>

                                        <Form.ErrorList errors={errors} />

                                        <Button type='dashed' onClick={() => add(makeEmptyStep())} icon={<PlusCircleOutlined />} block>
                                            Add Step
                                        </Button>
                                    </>
                                )
                            }}
                        </Form.List>
                    </>
                )}

                {currentStep === 4 && (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 12 }}
                            message='Once the period ends (or at a mid-period check-in), rate overall achievement against this objective using the standard 5-point performance scale.'
                        />
                        <Row gutter={16}>
                            <Col xs={24} md={8}>
                                <Form.Item label='Overall rating' name='overallRating'>
                                    <Select
                                        allowClear
                                        placeholder='Select a rating'
                                        options={RATING_LEVELS.map(r => ({
                                            value: r.value,
                                            label: (
                                                <span>
                                                    <Tag color={r.color} style={{ marginRight: 6 }}>{r.shortLabel}</Tag>
                                                </span>
                                            )
                                        }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={16}>
                                <Form.Item label='Rating comments' name='ratingComments'>
                                    <Input placeholder='Optional notes supporting the rating' />
                                </Form.Item>
                            </Col>
                        </Row>

                        <Title level={5} style={{ marginBottom: 4 }}>Sign-off</Title>
                        <Row gutter={16}>
                            <Col xs={24} md={8}>
                                <Form.Item label='Prepared by' name='preparedBy' rules={[{ required: true, message: 'Required' }]}>
                                    <Input placeholder='e.g. Admin' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={4}>
                                <Form.Item label='Prepared date' name='preparedDate' rules={[{ required: true, message: 'Required' }]}>
                                    <DatePicker style={{ width: '100%' }} format='DD MMM YYYY' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item label='Approved by CEO' name='approvedByCEO' rules={[{ required: true, message: 'Required' }]}>
                                    <Input placeholder='e.g. Mr Zenzo Nkomo' />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={6}>
                                <Form.Item label='Acknowledged by HOD' name='acknowledgedByHOD' rules={[{ required: true, message: 'Required' }]}>
                                    <Input placeholder='e.g. Ms Namhla Mxenge' />
                                </Form.Item>
                            </Col>
                        </Row>
                    </>
                )}

                <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                    {isFirstStep ? (
                        <Button onClick={onCancel} size='middle' style={{ flex: 1 }}>
                            Cancel
                        </Button>
                    ) : (
                        <Button onClick={goBack} size='middle' style={{ flex: 1 }}>
                            Back
                        </Button>
                    )}
                    {isLastStep ? (
                        <Button type='primary' htmlType='submit' size='middle' style={{ flex: 1 }}>
                            {isEditMode ? 'Update Quality Objective' : 'Create Quality Objective'}
                        </Button>
                    ) : (
                        <Button type='primary' onClick={goNext} size='middle' style={{ flex: 1 }}>
                            Next
                        </Button>
                    )}
                </div>
            </Form>
        </div>
    )
}
