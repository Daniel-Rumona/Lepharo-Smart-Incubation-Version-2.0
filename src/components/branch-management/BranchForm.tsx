import React from 'react'
import { Form, Input, Button, Space, Col, Row } from 'antd'
import { Branch, BranchFormData } from '@/types/types'
import { CloseOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { defaultOperatingHours } from '@/utils/branchOperatingHours'
import { OperatingHoursFields } from './OperatingHoursFields'

interface BranchFormProps {
    initialValues?: Branch | null
    onSubmit: (values: BranchFormData) => Promise<void>
    onCancel: () => void
    isEditMode: boolean
}

export const BranchForm: React.FC<BranchFormProps> = ({
    initialValues,
    onSubmit,
    onCancel,
    isEditMode
}) => {
    const [form] = Form.useForm()

    const getFormValues = () => {
        if (!initialValues) return { operatingHours: defaultOperatingHours() }

        return {
            operatingHours: initialValues.operatingHours || defaultOperatingHours(),
            name: initialValues.name,
            location:
                typeof initialValues.location === 'string'
                    ? initialValues.location
                    : `${initialValues.location.address}, ${initialValues.location.city}`,
            contactEmail:
                typeof initialValues.contact === 'object'
                    ? initialValues.contact.email
                    : '',
            contactPhone:
                typeof initialValues.contact === 'object'
                    ? initialValues.contact.phone
                    : '',
        }
    }

    React.useEffect(() => {
        if (isEditMode && initialValues) {
            form.setFieldsValue(getFormValues())
        }
    }, [initialValues, isEditMode, form])

    const handleSubmit = async (values: BranchFormData) => {
        await onSubmit(values)
    }

    return (
        <Form
            form={form}
            layout='vertical'
            onFinish={handleSubmit}
            autoComplete='off'
            initialValues={getFormValues()}
        >
            <Form.Item
                name='name'
                label='Branch Name'
                rules={[
                    { required: true, message: 'Please enter branch name' },
                    { min: 2, message: 'Branch name must be at least 2 characters' }
                ]}
            >
                <Input placeholder='e.g., Springs (Head Office)' />
            </Form.Item>

            <Form.Item
                name='location'
                label='Location'
                rules={[
                    { required: true, message: 'Please enter location' },
                    { min: 3, message: 'Location must be at least 3 characters' }
                ]}
            >
                <Input placeholder='e.g., Springs, Gauteng' />
            </Form.Item>

            {/* OPTIONAL EMAIL */}
            <Form.Item
                name='contactEmail'
                label='Contact Email'
                rules={[
                    {
                        type: 'email',
                        message: 'Please enter a valid email address'
                    }
                ]}
            >
                <Input placeholder='e.g., springs@lepharo.co.za' />
            </Form.Item>

            {/* OPTIONAL PHONE */}
            <Form.Item
                name='contactPhone'
                label='Contact Phone'
                rules={[
                    {
                        pattern: /^\+?[\d\s\-\(\)]+$/,
                        message: 'Please enter a valid phone number'
                    }
                ]}
            >
                <Input placeholder='e.g., +27 11 000 0000' />
            </Form.Item>

            <OperatingHoursFields />
            <Form.Item style={{ marginTop: 24 }}>
                <Row gutter={12}>
                    <Col span={12}>
                        <Button
                            block
                            danger
                            icon={<CloseOutlined />}
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    </Col>

                    <Col span={12}>
                        <Button
                            block
                            type='primary'
                            htmlType='submit'
                            icon={isEditMode ? <EditOutlined /> : <PlusOutlined />}
                        >
                            {isEditMode ? 'Update Branch' : 'Create Branch'}
                        </Button>
                    </Col>
                </Row>
            </Form.Item>
        </Form>
    )
}
