import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Form,
    Input,
    Modal,
    Popconfirm,
    Row,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    message
} from 'antd'
import {
    CloseOutlined,
    DeleteOutlined,
    EditOutlined,
    EnvironmentOutlined,
    MailOutlined,
    PhoneOutlined,
    PlusOutlined,
    UserOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { branchService } from '@/services/branchService'
import { Branch, BranchFormData } from '@/types/types'
import { defaultOperatingHours, OPERATING_DAYS } from '@/utils/branchOperatingHours'
import { OperatingHoursFields } from './OperatingHoursFields'
import { MotionCard } from '../dashboards/metrics/Header'

const { Search } = Input
const { Text } = Typography

type BranchManagementProps = {
    filterBarLeading?: React.ReactNode
}

type CentreCoordinatorOption = {
    id: string
    name: string
    email: string
    phone: string
}

type BranchFormValues = {
    operatingHours: NonNullable<BranchFormData['operatingHours']>
    name: string
    location: string
    centreCoordinatorUserId?: string
    contactEmail: string
    contactPhone?: string
}

const getBranchLocation = (branch?: Branch | null) => {
    if (!branch?.location) return ''

    if (typeof branch.location === 'string') {
        return branch.location
    }

    return [branch.location.address, branch.location.city]
        .filter(Boolean)
        .join(', ')
}

const getBranchContact = (branch?: Branch | null) => {
    if (!branch || typeof branch.contact !== 'object' || !branch.contact) {
        return { email: '', phone: '' }
    }

    return {
        email: String(branch.contact.email || ''),
        phone: String(branch.contact.phone || '')
    }
}

export const BranchManagement: React.FC<BranchManagementProps> = ({
    filterBarLeading
}) => {
    const [form] = Form.useForm<BranchFormValues>()

    const [branches, setBranches] = useState<Branch[]>([])
    const [centreCoordinators, setCentreCoordinators] = useState<CentreCoordinatorOption[]>([])
    const [loading, setLoading] = useState(true)
    const [coordinatorsLoading, setCoordinatorsLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [currentBranch, setCurrentBranch] = useState<Branch | null>(null)
    const [searchText, setSearchText] = useState('')

    const selectedCoordinatorId = Form.useWatch('centreCoordinatorUserId', form)

    const selectedCoordinator = useMemo(
        () => centreCoordinators.find(item => item.id === selectedCoordinatorId),
        [centreCoordinators, selectedCoordinatorId]
    )

    const fetchBranches = async () => {
        try {
            setLoading(true)
            const branchData = await branchService.getAllBranches()
            setBranches(branchData)
        } catch (error) {
            console.error('Error fetching branches:', error)
            const errorMessage =
                error instanceof Error ? error.message : 'Failed to fetch branches'
            message.error(errorMessage)
        } finally {
            setLoading(false)
        }
    }

    const fetchCentreCoordinators = async () => {
        try {
            setCoordinatorsLoading(true)

            const snapshot = await getDocs(
                query(
                    collection(db, 'users'),
                    where('role', '==', 'projectadmin')
                )
            )

            const rows = snapshot.docs
                .map(docSnap => {
                    const data = docSnap.data() as any

                    return {
                        id: docSnap.id,
                        name: String(
                            data.fullName ||
                            data.name ||
                            data.displayName ||
                            data.email ||
                            'Unnamed user'
                        ),
                        email: String(data.email || ''),
                        phone: String(data.phone || '')
                    } satisfies CentreCoordinatorOption
                })
                .sort((a, b) => a.name.localeCompare(b.name))

            setCentreCoordinators(rows)
        } catch (error) {
            console.error('Error fetching centre coordinators:', error)
            message.error('Failed to load Centre Coordinators')
        } finally {
            setCoordinatorsLoading(false)
        }
    }

    useEffect(() => {
        void fetchBranches()
        void fetchCentreCoordinators()
    }, [])

    const filteredBranches = useMemo(() => {
        const keyword = searchText.trim().toLowerCase()
        if (!keyword) return branches

        return branches.filter(branch => {
            const contact = getBranchContact(branch)
            const raw = branch as any

            return [
                branch.name,
                getBranchLocation(branch),
                contact.email,
                contact.phone,
                raw.centreCoordinatorName,
                raw.centreCoordinatorEmail,
                raw.centreCoordinatorPhone
            ]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(keyword))
        })
    }, [branches, searchText])

    const showModal = (edit = false, branch: Branch | null = null) => {
        setIsEditMode(edit)
        setCurrentBranch(branch)

        const contact = getBranchContact(branch)
        const raw = branch as any

        form.setFieldsValue({
            operatingHours: branch?.operatingHours || defaultOperatingHours(),
            name: branch?.name || '',
            location: getBranchLocation(branch),
            centreCoordinatorUserId: raw?.centreCoordinatorUserId || undefined,
            contactEmail: contact.email,
            contactPhone: contact.phone
        })

        setIsModalVisible(true)
    }

    const handleCancel = () => {
        setIsModalVisible(false)
        setCurrentBranch(null)
        setIsEditMode(false)
        form.resetFields()
    }

    const handleCoordinatorChange = (userId?: string) => {
        if (!userId) {
            form.setFieldsValue({
                centreCoordinatorUserId: undefined,
                contactEmail: '',
                contactPhone: ''
            })
            return
        }

        const coordinator = centreCoordinators.find(item => item.id === userId)

        form.setFieldsValue({
            centreCoordinatorUserId: userId,
            contactEmail: coordinator?.email || '',
            contactPhone: coordinator?.phone || ''
        })
    }

    const handleSubmit = async (values: BranchFormValues) => {
        setSaving(true)

        try {
            const coordinator = centreCoordinators.find(
                item => item.id === values.centreCoordinatorUserId
            )

            const payload: BranchFormData = {
                name: values.name.trim(),
                location: values.location.trim(),
                contactEmail: values.contactEmail.trim(),
                contactPhone: String(values.contactPhone || '').trim(),
                operatingHours: values.operatingHours,
                centreCoordinatorUserId: coordinator?.id || null,
                centreCoordinatorName: coordinator?.name || '',
                centreCoordinatorEmail: coordinator ? values.contactEmail.trim() : '',
                centreCoordinatorPhone: coordinator
                    ? String(values.contactPhone || '').trim()
                    : ''
            }

            if (isEditMode && currentBranch) {
                await branchService.updateBranch(currentBranch.id, payload)
                message.success('Branch updated successfully!')
            } else {
                await branchService.createBranch(payload)
                message.success('Branch created successfully!')
            }

            handleCancel()
            await fetchBranches()
        } catch (error: any) {
            console.error('Branch save error:', error)
            message.error(error?.message || 'Operation failed')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (branchId: string) => {
        setDeletingId(branchId)

        try {
            await branchService.deleteBranch(branchId)
            message.success('Branch deleted successfully!')
            setBranches(previous => previous.filter(branch => branch.id !== branchId))
        } catch (error: any) {
            console.error('Branch delete error:', error)
            message.error(error?.message || 'Failed to delete branch')
        } finally {
            setDeletingId(null)
        }
    }

    const columns = [
        {
            title: 'Branch Name',
            dataIndex: 'name',
            key: 'name',
            render: (name: string, record: Branch) => {
                const raw = record as any
                const isMain =
                    raw.isMain === true ||
                    raw.is_main === true ||
                    raw.isPrimary === true ||
                    raw.primary === true

                return (
                    <div>
                        <Text strong>{name}</Text>
                        {isMain ? (
                            <Tag color='gold' style={{ marginLeft: 8 }}>
                                HQ
                            </Tag>
                        ) : null}
                    </div>
                )
            },
            width: '22%'
        },
        {
            title: 'Location',
            key: 'location',
            render: (_: unknown, record: Branch) => (
                <Space>
                    <EnvironmentOutlined style={{ color: '#1890ff' }} />
                    <Text>{getBranchLocation(record) || '—'}</Text>
                </Space>
            ),
            width: '22%'
        },
        {
            title: 'Centre Coordinator',
            key: 'centreCoordinator',
            render: (_: unknown, record: Branch) => {
                const name = String((record as any).centreCoordinatorName || '')

                return name ? (
                    <Space>
                        <UserOutlined style={{ color: '#1677ff' }} />
                        <Text>{name}</Text>
                    </Space>
                ) : (
                    <Text type='secondary'>Not assigned</Text>
                )
            },
            width: '20%'
        },
        {
            title: 'Contact Information',
            key: 'contact',
            render: (_: unknown, record: Branch) => {
                const contact = getBranchContact(record)

                return (
                    <div>
                        <div style={{ marginBottom: 4 }}>
                            <MailOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                            {contact.email ? (
                                <Text copyable={{ text: contact.email }}>{contact.email}</Text>
                            ) : (
                                <Text type='secondary'>—</Text>
                            )}
                        </div>
                        <div>
                            <PhoneOutlined style={{ color: '#722ed1', marginRight: 8 }} />
                            {contact.phone ? (
                                <Text copyable={{ text: contact.phone }}>{contact.phone}</Text>
                            ) : (
                                <Text type='secondary'>—</Text>
                            )}
                        </div>
                    </div>
                )
            },
            width: '26%'
        },
        {
            title: 'Operating hours',
            key: 'operatingHours',
            render: (_: unknown, record: Branch) => (
                <Tooltip title={OPERATING_DAYS.map(({ key, label }) => {
                    const day = (record.operatingHours || defaultOperatingHours())[key]
                    return <div key={key}>{label}: {day.closed ? 'Closed' : `${day.opens}–${day.closes}`}</div>
                })}>
                    <Text>{record.operatingHours ? 'Weekly schedule' : 'Default: Mon–Fri 07:00–15:00'}</Text>
                </Tooltip>
            )
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, record: Branch) => (
                <Space size='small'>
                    <Tooltip title='Edit Branch'>
                        <Button
                            type='text'
                            icon={<EditOutlined />}
                            onClick={() => showModal(true, record)}
                            size='small'
                        />
                    </Tooltip>

                    <Popconfirm
                        title='Delete Branch'
                        description={
                            <div>
                                <p>Are you sure you want to delete this branch?</p>
                                <p style={{ color: '#ff4d4f', fontSize: 12, marginBottom: 0 }}>
                                    This action cannot be undone.
                                </p>
                            </div>
                        }
                        onConfirm={() => handleDelete(record.id)}
                        okText='Delete'
                        cancelText='Cancel'
                        okButtonProps={{ danger: true, loading: deletingId === record.id }}
                    >
                        <Tooltip title='Delete Branch'>
                            <Button
                                type='text'
                                icon={<DeleteOutlined />}
                                danger
                                size='small'
                                loading={deletingId === record.id}
                            />
                        </Tooltip>
                    </Popconfirm>
                </Space>
            ),
            width: '10%'
        }
    ]

    return (
        <>
            <MotionCard
                filterBar={
                    <Row gutter={12} wrap={false} style={{ width: '100%' }}>
                        <Col span={8}>
                            {filterBarLeading}
                        </Col>

                        <Col span={8}>
                            <Search
                                placeholder='Search branches'
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                onSearch={value => setSearchText(value)}
                                style={{ width: '100%' }}
                                allowClear
                            />
                        </Col>

                        <Col span={8}>
                            <Button
                                block
                                type='primary'
                                icon={<PlusOutlined />}
                                onClick={() => showModal(false, null)}
                            >
                                Add Branch
                            </Button>
                        </Col>
                    </Row>
                }
            >
                {loading ? (
                    <Skeleton
                        active
                        title={false}
                        paragraph={{ rows: 8, width: '100%' }}
                    />
                ) : (
                    <Table
                        dataSource={filteredBranches}
                        columns={columns}
                        rowKey='id'
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: false,
                            position: ['bottomCenter']
                        }}
                        scroll={{ x: 800 }}
                    />
                )}
            </MotionCard>

            <Modal
                title={isEditMode ? 'Edit Branch' : 'Create New Branch'}
                open={isModalVisible}
                onCancel={handleCancel}
                footer={null}
                centered
                maskClosable={false}
                width={640}
                destroyOnClose
            >
                <Form<BranchFormValues>
                    form={form}
                    layout='vertical'
                    onFinish={handleSubmit}
                    requiredMark='optional'
                >
                    <Form.Item
                        name='name'
                        label='Branch Name'
                        rules={[
                            { required: true, message: 'Please enter the branch name' },
                            { max: 120, message: 'Branch name cannot exceed 120 characters' }
                        ]}
                    >
                        <Input placeholder='e.g. Lephalale Centre' />
                    </Form.Item>

                    <Form.Item
                        name='location'
                        label='Location'
                        rules={[
                            { required: true, message: 'Please enter the branch location' },
                            { max: 250, message: 'Location cannot exceed 250 characters' }
                        ]}
                    >
                        <Input
                            prefix={<EnvironmentOutlined />}
                            placeholder='e.g. Lephalale, Limpopo'
                        />
                    </Form.Item>

                    <Form.Item
                        name='centreCoordinatorUserId'
                        label='Centre Coordinator'
                    >
                        <Select
                            allowClear
                            showSearch
                            loading={coordinatorsLoading}
                            placeholder='Select Centre Coordinator'
                            optionFilterProp='label'
                            onChange={handleCoordinatorChange}
                            options={centreCoordinators.map(coordinator => ({
                                value: coordinator.id,
                                label: coordinator.email
                                    ? `${coordinator.name} — ${coordinator.email}`
                                    : coordinator.name
                            }))}
                        />
                    </Form.Item>

                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='contactEmail'
                                label='Contact Email'
                                rules={[
                                    { required: true, message: 'Please enter a contact email' },
                                    { type: 'email', message: 'Please enter a valid email address' }
                                ]}
                            >
                                <Input
                                    prefix={<MailOutlined />}
                                    placeholder='centre@example.com'
                                    disabled={Boolean(selectedCoordinator?.email)}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='contactPhone'
                                label='Phone'
                            >
                                <Input
                                    prefix={<PhoneOutlined />}
                                    placeholder='Enter phone number'
                                    disabled={Boolean(selectedCoordinator?.phone)}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <OperatingHoursFields />

                    <Row gutter={12} style={{ marginTop: 8 }}>
                        <Col span={12}>
                            <Button
                                block
                                danger
                                icon={<CloseOutlined />}
                                onClick={handleCancel}
                                disabled={saving}
                            >
                                Cancel
                            </Button>
                        </Col>

                        <Col span={12}>
                            <Button
                                block
                                type='primary'
                                htmlType='submit'
                                loading={saving}
                                icon={isEditMode ? <EditOutlined /> : <PlusOutlined />}
                            >
                                {isEditMode ? 'Update Branch' : 'Create Branch'}
                            </Button>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </>
    )
}
