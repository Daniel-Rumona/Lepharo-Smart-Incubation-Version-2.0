import React from 'react'
import { Alert, Form, Input, Modal } from 'antd'
import { PositionSelect } from './PositionSelect'
import type { EmployeeRow } from './employeeShared'

export const ChangeEmailModal: React.FC<{
    employee: EmployeeRow | null
    saving: boolean
    onSubmit: (email: string) => Promise<boolean>
    onClose: () => void
}> = ({ employee, saving, onSubmit, onClose }) => {
    const [form] = Form.useForm<{ email: string }>()
    return (
        <Modal
            open={Boolean(employee)}
            title={`Change login email${employee ? ` · ${employee.name}` : ''}`}
            okText='Update email'
            onOk={() => form.submit()}
            onCancel={onClose}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            destroyOnClose
        >
            <Alert
                type='warning'
                showIcon
                style={{ marginBottom: 16 }}
                message='They must sign in with the new email from now on. Records that mention the old email are updated too.'
            />
            <Form
                form={form}
                layout='vertical'
                preserve={false}
                initialValues={{ email: employee?.email }}
                onFinish={async ({ email }) => {
                    if (await onSubmit(email.trim().toLowerCase())) onClose()
                }}
            >
                <Form.Item
                    name='email'
                    label='New login email'
                    rules={[
                        { required: true, message: 'Enter the new email address' },
                        { type: 'email', message: 'Enter a valid email address' },
                        {
                            validator: (_, value?: string) =>
                                value && value.trim().toLowerCase() === String(employee?.email || '').toLowerCase()
                                    ? Promise.reject(new Error('This is already their login email'))
                                    : Promise.resolve()
                        }
                    ]}
                >
                    <Input autoComplete='off' />
                </Form.Item>
            </Form>
        </Modal>
    )
}

export const BulkPositionModal: React.FC<{
    open: boolean
    count: number
    positions: string[]
    saving: boolean
    onSubmit: (position: string) => Promise<boolean>
    onClose: () => void
}> = ({ open, count, positions, saving, onSubmit, onClose }) => {
    const [form] = Form.useForm<{ position: string }>()
    return (
        <Modal
            open={open}
            title={`Set HR position for ${count} employee${count === 1 ? '' : 's'}`}
            okText='Update selected'
            onOk={() => form.submit()}
            onCancel={onClose}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            destroyOnClose
        >
            <Form
                form={form}
                layout='vertical'
                preserve={false}
                onFinish={async ({ position }) => {
                    if (await onSubmit(position)) onClose()
                }}
            >
                <Form.Item name='position' label='HR position' rules={[{ required: true, message: 'Select or type a position' }]}>
                    <PositionSelect positions={positions} />
                </Form.Item>
            </Form>
        </Modal>
    )
}
