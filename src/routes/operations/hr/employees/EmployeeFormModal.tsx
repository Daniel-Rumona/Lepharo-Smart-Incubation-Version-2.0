import React, { useMemo } from 'react'
import { Col, DatePicker, Form, Input, Modal, Row, Select, Switch } from 'antd'
import dayjs from 'dayjs'
import { PositionSelect } from './PositionSelect'
import {
    CREATABLE_ROLES,
    roleLabel,
    roleNeedsBranch,
    roleNeedsDepartment,
    type EmployeeFormValues,
    type EmployeeRow,
    type NamedOption
} from './employeeShared'

type Props = {
    open: boolean
    /** Null when adding a new employee. */
    employee: EmployeeRow | null
    saving: boolean
    departments: NamedOption[]
    branches: NamedOption[]
    positions: string[]
    lineManagerOptions: { value: string; label: string }[]
    canEditLineManager: boolean
    /** Resolves true when saved, so the modal can close; false keeps the form as typed. */
    onSubmit: (values: EmployeeFormValues) => Promise<boolean>
    onClose: () => void
}

export const EmployeeFormModal: React.FC<Props> = ({
    open,
    employee,
    saving,
    departments,
    branches,
    positions,
    lineManagerOptions,
    canEditLineManager,
    onSubmit,
    onClose
}) => {
    const [form] = Form.useForm<EmployeeFormValues>()
    const isEdit = Boolean(employee)
    const workerType = Form.useWatch('workerType', form)
    const pickedRole = Form.useWatch('role', form)
    const role = employee?.role ?? pickedRole
    const showBranch = roleNeedsBranch(role)
    const showDepartment = roleNeedsDepartment(role)

    const initialValues = useMemo<Partial<EmployeeFormValues>>(
        () =>
            employee
                ? {
                      name: employee.name,
                      email: employee.email,
                      position: employee.position,
                      workerType: employee.workerType,
                      departmentId: employee.departmentId || undefined,
                      branchId: employee.branchId || undefined,
                      startDate: employee.startDate ? dayjs(employee.startDate) : null,
                      endDate: employee.endDate ? dayjs(employee.endDate) : null,
                      active: employee.status !== 'Inactive',
                      lineManagerId: employee.lineManagerSource === 'manual' ? employee.lineManagerId || '' : ''
                  }
                : { workerType: 'permanent', active: true },
        [employee]
    )

    const currentDefaultManager =
        employee && employee.lineManagerSource !== 'manual' && employee.lineManagerId
            ? lineManagerOptions.find(option => option.value === employee.lineManagerId)?.label
            : undefined

    return (
        <Modal
            open={open}
            title={isEdit ? `Edit ${employee?.name}` : 'Add employee'}
            okText={isEdit ? 'Save changes' : 'Add employee'}
            onOk={() => form.submit()}
            onCancel={onClose}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            width={760}
            destroyOnClose
        >
            <Form<EmployeeFormValues>
                form={form}
                layout='vertical'
                initialValues={initialValues}
                preserve={false}
                onFinish={async values => {
                    if (await onSubmit(values)) onClose()
                }}
            >
                <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                        <Form.Item label='Full name' name='name' rules={[{ required: true, whitespace: true, message: 'Enter the full name' }]}>
                            <Input placeholder='Employee full name' />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Login email'
                            name='email'
                            extra={isEdit ? 'Use “Change login email” in the row menu.' : undefined}
                            rules={[
                                { required: true, message: 'Enter the email address' },
                                { type: 'email', message: 'Enter a valid email address' }
                            ]}
                        >
                            <Input placeholder='name@lepharo.co.za' disabled={isEdit} autoComplete='off' />
                        </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                        {isEdit ? (
                            <Form.Item label='System role'>
                                <Input value={roleLabel(employee?.role)} disabled />
                            </Form.Item>
                        ) : (
                            <Form.Item label='System role' name='role' rules={[{ required: true, message: 'Select a system role' }]}>
                                <Select placeholder='Select system role' options={CREATABLE_ROLES} />
                            </Form.Item>
                        )}
                    </Col>
                    <Col xs={24} md={12}>
                        <Form.Item label='HR position' name='position' rules={[{ required: true, message: 'Select or type a position' }]}>
                            <PositionSelect positions={positions} />
                        </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                        <Form.Item label='Worker type' name='workerType' rules={[{ required: true }]}>
                            <Select
                                options={[
                                    { value: 'permanent', label: 'Permanent' },
                                    { value: 'intern', label: 'Intern' }
                                ]}
                            />
                        </Form.Item>
                    </Col>
                    {showBranch && (
                        <Col xs={24} md={12}>
                            <Form.Item label='Branch' name='branchId' rules={[{ required: true, message: 'Select a branch' }]}>
                                <Select
                                    showSearch
                                    placeholder='Select branch'
                                    optionFilterProp='label'
                                    options={branches.map(b => ({ value: b.id, label: b.name }))}
                                />
                            </Form.Item>
                        </Col>
                    )}
                    {showDepartment && (
                        <Col xs={24} md={12}>
                            <Form.Item label='Department' name='departmentId' rules={[{ required: true, message: 'Select a department' }]}>
                                <Select
                                    showSearch
                                    placeholder='Select department'
                                    optionFilterProp='label'
                                    options={departments.map(d => ({ value: d.id, label: d.name }))}
                                />
                            </Form.Item>
                        </Col>
                    )}

                    <Col xs={24} md={12}>
                        <Form.Item label='Start date' name='startDate' rules={[{ required: true, message: 'Select a start date' }]}>
                            <DatePicker style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    {workerType === 'intern' && (
                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Internship end date'
                                name='endDate'
                                dependencies={['startDate']}
                                rules={[
                                    { required: true, message: 'Select the internship end date' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value?: dayjs.Dayjs | null) {
                                            const start = getFieldValue('startDate') as dayjs.Dayjs | null
                                            if (!value || !start || value.isAfter(start, 'day')) return Promise.resolve()
                                            return Promise.reject(new Error('The end date must be after the start date'))
                                        }
                                    })
                                ]}
                            >
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    )}

                    {isEdit && canEditLineManager && (
                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Line manager'
                                name='lineManagerId'
                                tooltip='Default: HoDs report to the CEO, coordinators to their HoD, employees and receptionists to their branch Centre Coordinator.'
                            >
                                <Select
                                    showSearch
                                    optionFilterProp='label'
                                    options={[
                                        {
                                            value: '',
                                            label: currentDefaultManager ? `Default (currently ${currentDefaultManager})` : 'Default (automatic)'
                                        },
                                        ...lineManagerOptions.filter(option => option.value !== employee?.id)
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                    )}

                    <Col xs={24} md={12}>
                        <Form.Item
                            label='Login access'
                            name='active'
                            valuePropName='checked'
                            extra={isEdit ? 'Turning this off disables sign-in. HR records are kept.' : undefined}
                        >
                            <Switch checkedChildren='Active' unCheckedChildren='Disabled' />
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </Modal>
    )
}

export default EmployeeFormModal
