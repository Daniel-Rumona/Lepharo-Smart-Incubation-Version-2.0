import React, { useEffect } from 'react'
import { Form, Input, Button, Space, Row, Col, Card, Typography, Switch } from 'antd'
import {
    TeamOutlined,
    MailOutlined,
    UserOutlined,
    FileTextOutlined
} from '@ant-design/icons'
import { Department, DepartmentFormData } from '@/types/types'

const { TextArea } = Input
const { Text } = Typography

interface DepartmentFormProps {
    initialValues?: Department | null
    onSubmit: (values: DepartmentFormData) => Promise<void>
    onCancel: () => void
    isEditMode: boolean
}

export const DepartmentForm: React.FC<DepartmentFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    isEditMode
}) => {
    const [form] = Form.useForm()

    useEffect(() => {
        if (initialValues) {
            form.setFieldsValue({
                name: initialValues.name,
                description: initialValues.description,
                manager: initialValues.manager,
                contactEmail: initialValues.contactEmail,
                isTraining: initialValues.isTraining === true
            })
        }
    }, [initialValues, form])

    const handleSubmit = async (values: DepartmentFormData) => {
        await onSubmit(values)
    }

    const handleReset = () => {
        form.resetFields()
        if (!isEditMode) {
            form.setFieldsValue({
                isTraining: false
            })
        }
    }

    return (
        <Card bordered={false}>
            <Form
                form={form}
                layout='vertical'
                onFinish={handleSubmit}
                autoComplete='off'
                size='middle'
            >
                <Row gutter={16}>
                    <Col span={24}>
                        <Form.Item
                            label='Department Name'
                            name='name'
                            rules={[
                                { required: true, message: 'Please enter department name' },
                                {
                                    min: 2,
                                    message: 'Department name must be at least 2 characters'
                                },
                                {
                                    max: 100,
                                    message: 'Department name cannot exceed 100 characters'
                                }
                            ]}
                        >
                            <Input
                                placeholder='e.g., Financial Compliance'
                                prefix={<TeamOutlined style={{ color: '#1890ff' }} />}
                                showCount
                                maxLength={100}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={16}>
                    <Col span={24}>
                        <Form.Item
                            label='Description'
                            name='description'
                            rules={[
                                {
                                    required: true,
                                    message: 'Please enter department description'
                                },
                                {
                                    min: 10,
                                    message: 'Description must be at least 10 characters'
                                },
                                {
                                    max: 500,
                                    message: 'Description cannot exceed 500 characters'
                                }
                            ]}
                        >
                            <TextArea
                                placeholder="Describe the department's role and responsibilities"
                                rows={3}
                                showCount
                                maxLength={500}
                            />
                        </Form.Item>
                    </Col>
                </Row>

                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item
                            label='Manager (Optional)'
                            name='manager'
                            rules={[
                                {
                                    max: 100,
                                    message: 'Manager name cannot exceed 100 characters'
                                }
                            ]}
                        >
                            <Input
                                placeholder='Department manager name'
                                prefix={<UserOutlined style={{ color: '#52c41a' }} />}
                                maxLength={100}
                            />
                        </Form.Item>
                    </Col>

                    <Col span={12}>
                        <Form.Item
                            label='Contact Email'
                            name='contactEmail'
                            rules={[
                                { required: true, message: 'Please enter contact email' },
                                { type: 'email', message: 'Please enter a valid email address' }
                            ]}
                        >
                            <Input
                                placeholder='department@company.com'
                                prefix={<MailOutlined style={{ color: '#f5222d' }} />}
                                maxLength={100}
                            />
                        </Form.Item>
                    </Col>
                </Row>


                <Form.Item
                    name='isTraining'
                    valuePropName='checked'
                    label='Training coverage'
                    extra='Requires formal topics or unit standards during meeting coverage. All child departments inherit this setting.'
                >
                    <Switch checkedChildren='Enabled' unCheckedChildren='Disabled' />
                </Form.Item>

                <div style={{ marginTop: 24 }}>
                    <Space>
                        <Button type='primary' htmlType='submit' size='middle'>
                            {isEditMode ? 'Update Department' : 'Create Department'}
                        </Button>

                        <Button onClick={handleReset} size='middle'>
                            Reset
                        </Button>

                        <Button onClick={onCancel} size='middle'>
                            Cancel
                        </Button>
                    </Space>
                </div>

                <div style={{ marginTop: 16 }}>
                    <Text type='secondary' style={{ fontSize: '12px' }}>
                        <strong>Note:</strong> Only Operations users will be assigned to
                        departments. Other roles are assigned to branches instead.
                    </Text>
                </div>
            </Form>
        </Card>
    )
}
