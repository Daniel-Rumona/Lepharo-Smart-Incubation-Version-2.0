import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Form,
    Grid,
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
    ArrowLeftOutlined,
    ArrowRightOutlined,
    ClockCircleOutlined,
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
import {
    SOUTH_AFRICAN_PROVINCES,
    citiesForProvince,
    formatLocation,
    matchProvince
} from '@/utils/southAfricanLocations'
import { MotionCard } from '../dashboards/metrics/Header'
import { MobileCardList } from '../shared/MobileCardList'
import '../shared/setup-segmented.css'
import './branch-management.css'

const { Search } = Input
const { Text } = Typography

type CentreCoordinatorOption = {
    id: string
    name: string
    email: string
    phone: string
}

type BranchFormValues = {
    operatingHours: NonNullable<BranchFormData['operatingHours']>
    name: string
    province?: string
    city?: string
    address: string
    centreCoordinatorUserId?: string
    contactEmail: string
    contactPhone?: string
}

const getBranchLocation = (branch?: Branch | null) => {
    if (!branch?.location) return ''

    if (typeof branch.location === 'string') {
        return branch.location
    }

    return formatLocation([
        branch.location.address,
        branch.location.city,
        branch.location.province
    ])
}

/** Splits a stored branch location into the province / city / address form fields. */
const getBranchLocationFields = (branch?: Branch | null) => {
    const location = branch?.location as any

    if (!location) return { province: undefined, city: undefined, address: '' }

    // Older branches stored one free-text string; keep it as the address and
    // let the user pick the province and city when they next edit.
    if (typeof location === 'string') {
        return { province: undefined, city: undefined, address: location }
    }

    const province = matchProvince(location.province)
    const city = String(location.city || '').trim()
    const rawAddress = String(location.address || '').trim()
    // Branches saved by the old form put the whole "Town, Province" text in address.
    const address =
        rawAddress.includes(',') &&
        rawAddress.toLowerCase() === formatLocation([rawAddress, city, location.province]).toLowerCase()
            ? ''
            : rawAddress

    return {
        province,
        city: city || undefined,
        address
    }
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

export const BranchManagement: React.FC = () => {
    const [form] = Form.useForm<BranchFormValues>()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md

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
    const [formSection, setFormSection] = useState<'choose' | 'details' | 'hours'>('details')

    const selectedCoordinatorId = Form.useWatch('centreCoordinatorUserId', form)
    const selectedProvince = Form.useWatch('province', form)
    const [citySearch, setCitySearch] = useState('')

    // Listed towns for the chosen province, plus whatever the user typed so an
    // unlisted town can still be used.
    const cityOptions = useMemo(() => {
        const listed = citiesForProvince(selectedProvince)
        const typed = citySearch.trim()
        const extra =
            typed && !listed.some(city => city.toLowerCase() === typed.toLowerCase()) ? [typed] : []
        return [...listed, ...extra].map(city => ({ value: city, label: city }))
    }, [selectedProvince, citySearch])

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
        setFormSection(edit ? 'choose' : 'details')
        setIsEditMode(edit)
        setCurrentBranch(branch)

        const contact = getBranchContact(branch)
        const raw = branch as any

        form.setFieldsValue({
            operatingHours: branch?.operatingHours || defaultOperatingHours(),
            name: branch?.name || '',
            ...getBranchLocationFields(branch),
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

    const handleSubmit = async () => {
        if (formSection === 'choose') return
        if (!isEditMode && formSection === 'details') {
            setFormSection('hours')
            return
        }
        const values = form.getFieldsValue(true) as BranchFormValues
        setSaving(true)

        try {
            if (isEditMode && currentBranch && formSection === 'hours') {
                await branchService.updateBranch(currentBranch.id, {
                    operatingHours: values.operatingHours
                })
                message.success('Operating hours updated successfully!')
                handleCancel()
                await fetchBranches()
                return
            }

            const coordinator = centreCoordinators.find(
                item => item.id === values.centreCoordinatorUserId
            )

            const payload: BranchFormData = {
                name: values.name.trim(),
                location: {
                    province: String(values.province || '').trim(),
                    city: String(values.city || '').trim(),
                    address: values.address.trim()
                },
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
                const { operatingHours, ...details } = payload
                await branchService.updateBranch(currentBranch.id, details)
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
            width: '18%'
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
            width: '22%'
        },
        {
            title: 'Operating hours',
            key: 'operatingHours',
            render: (_: unknown, record: Branch) => (
                <Tooltip title={<>
                    {OPERATING_DAYS.map(({ key, label }) => {
                        const day = (record.operatingHours || defaultOperatingHours())[key]
                        return <div key={key}>{label}: {day.closed ? 'Closed' : `${day.opens}–${day.closes}`}</div>
                    })}
                    <div>Public holidays: {record.operatingHours?.rules?.publicHolidays
                        ? record.operatingHours.rules.publicHolidays.closed ? 'Closed'
                            : `${record.operatingHours.rules.publicHolidays.opens}–${record.operatingHours.rules.publicHolidays.closes}`
                        : 'Regular schedule'}</div>
                </>}>
                    <Text>{record.operatingHours?.rules
                        ? `${record.operatingHours.rules.defaultHours.opens}–${record.operatingHours.rules.defaultHours.closes}`
                        : record.operatingHours ? 'Weekly schedule' : 'Default: Mon–Fri 07:00–15:00'}</Text>
                </Tooltip>
            ),
            width: '18%'
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, record: Branch) => (
                <Space size='small'>
                    <Tooltip title='Edit Branch'>
                        <Button
                            shape='circle'
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
                                shape='circle'
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
                    <div className='setup-toolbar'>
                        <div className='setup-toolbar-search'>
                            <Search
                                placeholder='Search branches'
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                onSearch={value => setSearchText(value)}
                                style={{ width: '100%' }}
                                allowClear
                            />
                        </div>

                        <div className='setup-toolbar-action'>
                            <Button
                                type='primary'
                                icon={<PlusOutlined />}
                                onClick={() => showModal(false, null)}
                            >
                                Add Branch
                            </Button>
                        </div>
                    </div>
                }
            >
                {loading ? (
                    <Skeleton
                        active
                        title={false}
                        paragraph={{ rows: 8, width: '100%' }}
                    />
                ) : isMobile ? (
                    <MobileCardList
                        data={filteredBranches}
                        getKey={(row: Branch) => row.id}
                        pageSize={8}
                        emptyText='No branches'
                        renderCard={(record: Branch) => {
                            const raw = record as any
                            const contact = getBranchContact(record)
                            const isMain =
                                raw.isMain === true ||
                                raw.is_main === true ||
                                raw.isPrimary === true ||
                                raw.primary === true
                            return {
                                title: record.name,
                                subtitle: getBranchLocation(record) || undefined,
                                badge: isMain ? <Tag color='gold'>HQ</Tag> : undefined,
                                fields: [
                                    {
                                        label: 'Centre Coordinator',
                                        value: String(raw.centreCoordinatorName || '') || 'Not assigned'
                                    },
                                    { label: 'Phone', value: contact.phone || '—' }
                                ],
                                note: contact.email ? <Text type='secondary'>{contact.email}</Text> : undefined,
                                actions: [
                                    <Button key='edit' icon={<EditOutlined />} onClick={() => showModal(true, record)}>
                                        Edit
                                    </Button>,
                                    <Popconfirm
                                        key='delete'
                                        title='Delete Branch'
                                        description='Are you sure you want to delete this branch? This action cannot be undone.'
                                        onConfirm={() => handleDelete(record.id)}
                                        okText='Delete'
                                        cancelText='Cancel'
                                        okButtonProps={{ danger: true, loading: deletingId === record.id }}
                                    >
                                        <Button danger icon={<DeleteOutlined />} loading={deletingId === record.id}>
                                            Delete
                                        </Button>
                                    </Popconfirm>
                                ]
                            }
                        }}
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
                title={isEditMode
                    ? formSection === 'choose' ? 'Edit Branch' : formSection === 'details' ? 'Edit Branch Details' : 'Edit Operating Hours'
                    : formSection === 'details' ? 'Create New Branch' : 'Branch Operating Hours'}
                open={isModalVisible}
                onCancel={saving ? undefined : handleCancel}
                closable={!saving}
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
                    requiredMark
                    disabled={saving}
                >
                    {formSection === 'choose' && (
                        <Row gutter={[16, 16]} style={{ marginTop: 16, marginBottom: 16 }}>
                            {([
                                { section: 'details', title: 'Details', description: 'Name, location and contact details', icon: <EditOutlined /> },
                                { section: 'hours', title: 'Operating Hours', description: 'Default hours, public holidays and day exceptions', icon: <ClockCircleOutlined /> }
                            ] as const).map(option => (
                                <Col span={24} key={option.section}>
                                    <Button
                                        block
                                        className='branch-section-choice'
                                        onClick={() => setFormSection(option.section)}
                                    >
                                        <span className='branch-section-choice-icon'>{option.icon}</span>
                                        <span className='branch-section-choice-copy'>
                                            <span className='branch-section-choice-title'>{option.title}</span>
                                            <Text type='secondary'>{option.description}</Text>
                                        </span>
                                        <ArrowRightOutlined className='branch-section-choice-arrow' />
                                    </Button>
                                </Col>
                            ))}
                        </Row>
                    )}
                    {formSection === 'details' && (
                        <>
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

                            <Row gutter={16}>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name='province'
                                        label='Province'
                                        rules={[{ required: true, message: 'Please select a province' }]}
                                    >
                                        <Select
                                            showSearch
                                            placeholder='Select province'
                                            optionFilterProp='label'
                                            suffixIcon={<EnvironmentOutlined />}
                                            options={SOUTH_AFRICAN_PROVINCES.map(province => ({
                                                value: province,
                                                label: province
                                            }))}
                                            onChange={() => {
                                                form.setFieldsValue({ city: undefined })
                                                setCitySearch('')
                                            }}
                                        />
                                    </Form.Item>
                                </Col>

                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name='city'
                                        label='City / Town'
                                        rules={[{ required: true, message: 'Please select a city or town' }]}
                                    >
                                        <Select
                                            showSearch
                                            disabled={!selectedProvince}
                                            placeholder={selectedProvince ? 'Select or type a city / town' : 'Select a province first'}
                                            optionFilterProp='label'
                                            options={cityOptions}
                                            onSearch={setCitySearch}
                                            onBlur={() => setCitySearch('')}
                                            notFoundContent='Type to add a town'
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={16}>
                                <Col xs={24}>
                                    <Form.Item
                                        name='address'
                                        label='Street Address'
                                        rules={[
                                            { required: true, message: 'Please enter the street address' },
                                            { max: 200, message: 'Address cannot exceed 200 characters' }
                                        ]}
                                    >
                                        <Input
                                            prefix={<EnvironmentOutlined />}
                                            placeholder='e.g. 12 Main Road, Industrial Area'
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

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
                        </>
                    )}
                    {formSection === 'hours' && <OperatingHoursFields />}

                    {formSection !== 'choose' && <Row gutter={12} style={{ marginTop: 8 }}>
                        <Col span={12}>
                            <Button
                                block
                                icon={!isEditMode && formSection === 'details' ? <CloseOutlined /> : <ArrowLeftOutlined />}
                                onClick={() => {
                                    if (isEditMode) setFormSection('choose')
                                    else if (formSection === 'hours') setFormSection('details')
                                    else handleCancel()
                                }}
                                disabled={saving}
                            >
                                {!isEditMode && formSection === 'details' ? 'Cancel' : 'Back'}
                            </Button>
                        </Col>

                        <Col span={12}>
                            <Button
                                block
                                type='primary'
                                htmlType='submit'
                                loading={saving}
                                icon={isEditMode ? <EditOutlined /> : formSection === 'details' ? <ArrowRightOutlined /> : <PlusOutlined />}
                            >
                                {isEditMode ? 'Update' : formSection === 'details' ? 'Next' : 'Create Branch'}
                            </Button>
                        </Col>
                    </Row>}
                </Form>
            </Modal>
        </>
    )
}
