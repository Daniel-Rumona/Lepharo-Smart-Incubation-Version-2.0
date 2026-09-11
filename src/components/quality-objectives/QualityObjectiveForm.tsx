import React, { useEffect, useState } from 'react'
import {
    Form,
    Input,
    InputNumber,
    DatePicker,
    Select,
    Button,
    Space,
    Row,
    Col,
    Card,
    Alert,
    Divider
} from 'antd'
import { PlusCircleOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import dayjs, { Dayjs } from 'dayjs'
import { QualityObjective, QualityObjectiveFormData, Department } from '@/types/types'
import { departmentService } from '@/services/departmentService'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { TextArea } = Input

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
    period: [Dayjs, Dayjs]
    preparedBy: string
    preparedDate: Dayjs
    approvedByCEO: string
    acknowledgedByHOD: string
    steps: { description: string; responsiblePerson: string; targetDate: string; completionDate: string }[]
}

const makeEmptyStep = () => ({
    description: '',
    responsiblePerson: '',
    targetDate: '',
    completionDate: ''
})

export const QualityObjectiveForm: React.FC<QualityObjectiveFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    isEditMode
}) => {
    const [form] = Form.useForm<FormShape>()
    const { user } = useFullIdentity()
    const [departments, setDepartments] = useState<Department[]>([])
    const [loadingDepartments, setLoadingDepartments] = useState(true)

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
                period: [dayjs(initialValues.periodStart), dayjs(initialValues.periodEnd)],
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
                preparedBy: user?.name || '',
                preparedDate: dayjs(),
                steps: [makeEmptyStep()]
            } as any)
        }
    }, [initialValues, form, user?.name])

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
            periodStart: values.period[0].toISOString(),
            periodEnd: values.period[1].toISOString(),
            steps: values.steps.map(step => ({
                description: step.description,
                responsiblePerson: step.responsiblePerson,
                targetDate: step.targetDate,
                completionDate: step.completionDate
            })),
            preparedBy: values.preparedBy,
            preparedDate: values.preparedDate.toISOString(),
            approvedByCEO: values.approvedByCEO,
            acknowledgedByHOD: values.acknowledgedByHOD,
        }

        await onSubmit(payload)
    }

    return (
        <Card bordered={false}>
            <Form form={form} layout='vertical' onFinish={handleSubmit} autoComplete='off' size='middle'>
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
                    <Col xs={24} md={8}>
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
                    <Col xs={24} md={6}>
                        <Form.Item label='Form No' name='formNo' rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                    </Col>
                    <Col xs={12} md={3}>
                        <Form.Item label='Revision No' name='revisionNo' rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                    </Col>
                    <Col xs={12} md={3}>
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

                <Divider orientation='left'>Means / Steps</Divider>
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
                                                                style={{ marginBottom: 10, background: '#fbfdff' }}
                                                            >
                                                                <Row gutter={[12, 8]} align='top'>
                                                                    <Col flex='0 0 28px' {...dragProvided.dragHandleProps} style={{ cursor: 'grab', textAlign: 'center', color: '#8c8c8c', paddingTop: 6 }}>
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
                                                                            style={{ border: '1px solid red' }}
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

                <Divider orientation='left'>Sign-off</Divider>
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

                <div style={{ marginTop: 24 }}>
                    <Space>
                        <Button type='primary' htmlType='submit' size='middle'>
                            {isEditMode ? 'Update Quality Objective' : 'Create Quality Objective'}
                        </Button>
                        <Button onClick={onCancel} size='middle'>
                            Cancel
                        </Button>
                    </Space>
                </div>
            </Form>
        </Card>
    )
}
