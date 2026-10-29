import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    DatePicker,
    Form,
    Grid,
    Input,
    message,
    Modal,
    Row,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    InputNumber,
    Typography
} from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    FileTextOutlined,
    InboxOutlined,
    SearchOutlined
} from '@ant-design/icons'
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { isBookableResource } from '@/types/resources'
import dayjs, { Dayjs } from 'dayjs'
import {
    ResourceBooking,
    availableForRange,
    fetchBookings
} from '@/lib/resourceBookings'
import { requestStatus } from '@/lib/resourceRequests'
import {
    ResourceTypeOption,
    getBookingMode
} from '@/routes/resources/ResourceTypesModal'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    MetricsGrid,
    type DashboardMetric
} from '@/components/dashboards/metrics/MetricsGrid'

const { Title, Text } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

const ResourceRequestForm: React.FC = () => {
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
    const [resources, setResources] = useState<any[]>([])
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [formVisible, setFormVisible] = useState(false)
    const [selectedResource, setSelectedResource] = useState<any | null>(null)
    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [form] = Form.useForm()

    const [resourceTypes, setResourceTypes] = useState<ResourceTypeOption[]>([])
    const [bookings, setBookings] = useState<ResourceBooking[]>([])

    const watchedRange: [Dayjs, Dayjs] | undefined = Form.useWatch('timeRange', form)

    // A type's booking mode decides whether the SME picks a quantity
    const isSingleResource = (resource: any) =>
        getBookingMode(
            resourceTypes.find(type => type.value === resource?.type) || {
                value: resource?.type || ''
            }
        ) === 'single'

    const selectedUnit = selectedResource
        ? {
            id: selectedResource.id,
            name: selectedResource.name,
            capacity: Number(selectedResource.capacity) || 0,
            single: isSingleResource(selectedResource)
        }
        : undefined

    // Same calculation staff use when approving, so the SME sees what's free
    const freeForRange =
        selectedUnit && watchedRange?.[0] && watchedRange?.[1]
            ? availableForRange(
                selectedUnit,
                bookings,
                watchedRange[0].toDate(),
                watchedRange[1].toDate()
            )
            : undefined

    const fetchResources = async () => {
        const [typesSnap, bookingList] = await Promise.all([
            getDocs(collection(db, 'resourceTypes')),
            fetchBookings()
        ])
        setResourceTypes(
            typesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as ResourceTypeOption)
        )
        setBookings(bookingList)
        const snapshot = await getDocs(collection(db, 'resources'))
        // Internal resources are branch inventory and can't be requested
        setResources(snapshot.docs
            .filter(resourceDoc => isBookableResource(resourceDoc.data()))
            .map(resourceDoc => ({
                id: resourceDoc.id,
                ...resourceDoc.data()
            })))
    }

    const fetchRequests = async () => {
        if (!user?.email) {
            setRequests([])
            return
        }

        const normalizedEmail = String(user.email).trim().toLowerCase()
        const legacyIdentities = Array.from(
            new Set(
                [user.name, user.email, normalizedEmail]
                    .map(value => String(value || '').trim())
                    .filter(Boolean)
            )
        )
        const snapshots = await Promise.all([
            ...legacyIdentities.map(identity =>
                getDocs(
                    query(
                        collection(db, 'resourceRequests'),
                        where('requestedBy', '==', identity)
                    )
                )
            ),
            getDocs(
                query(
                    collection(db, 'resourceRequests'),
                    where('requestedByEmail', '==', normalizedEmail)
                )
            )
        ])

        const requestsById = new Map<string, any>()
        snapshots.forEach(snapshot =>
            snapshot.docs.forEach(requestDoc =>
                requestsById.set(requestDoc.id, {
                    id: requestDoc.id,
                    ...requestDoc.data()
                })
            )
        )
        setRequests(Array.from(requestsById.values()))
    }

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        Promise.all([fetchResources(), fetchRequests()])
            .catch(error => {
                console.error(error)
                if (!cancelled) message.error('Failed to load resources.')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [user?.email, user?.name])

    const handleRequest = async (values: any) => {
        if (!selectedResource || !user) return

        const [start, end] = values.timeRange as [Dayjs, Dayjs]
        const days = end.startOf('day').diff(start.startOf('day'), 'day') + 1
        const hours = end.diff(start, 'hour', true)
        const requestedAt = new Date()

        try {
            await addDoc(collection(db, 'resourceRequests'), {
                // Marks this as an SME booking request, not an internal purchase
                requestType: 'external',
                resourceId: selectedResource.id,
                resourceName: selectedResource.name,
                branchId: selectedResource.branchId || null,
                quantity: isSingleResource(selectedResource) ? 1 : Number(values.quantity),
                startTime: start.toDate(),
                endTime: end.toDate(),
                // Kept for older screens that read the needed-by date and duration
                neededByDate: start.toDate(),
                duration:
                    days > 1
                        ? `${days} days`
                        : `${Math.round(hours * 10) / 10} hour${hours === 1 ? '' : 's'}`,
                reason: values.reason,
                purpose: values.reason,
                urgency: values.urgency,
                deliveryMethod: values.deliveryMethod,
                requestedBy: user.name || user.email,
                requestedByEmail: String(user.email || '').trim().toLowerCase(),
                participantId: user.participantId || user.participantDocId || null,
                status: 'pending',
                requestedAt,
                createdAt: requestedAt
            })
            message.success('Resource request submitted successfully.')
            setFormVisible(false)
            setSelectedResource(null)
            form.resetFields()
            await fetchRequests()
        } catch (error) {
            console.error(error)
            message.error('Failed to submit request.')
        }
    }

    const requestTimestamp = (request: any) =>
        request?.requestedAt?.toMillis?.() ||
        Number(request?.requestedAt?.seconds || 0) * 1000 ||
        new Date(request?.requestedAt || 0).getTime() ||
        0

    const latestRequestFor = (resource: any) =>
        requests
            .filter(request => request.resourceId === resource.id)
            .sort((left, right) => requestTimestamp(right) - requestTimestamp(left))[0]

    const getResourceStatus = (resource: any) => {
        if (resource.status === 'maintenance' || resource.status === 'unavailable') {
            return 'unavailable'
        }
        const latestRequest = latestRequestFor(resource)
        // 'rejected' from older records reads as declined
        return latestRequest ? requestStatus(latestRequest) : 'available'
    }

    const getStatusTag = (status: string, resource?: any) => {
        switch (status) {
            case 'available':
                return <Tag color='blue' icon={<InboxOutlined />}>Available</Tag>
            case 'pending':
                return <Tag color='orange' icon={<ClockCircleOutlined />}>Pending</Tag>
            case 'approved':
                return <Tag color='green' icon={<CheckCircleOutlined />}>Approved</Tag>
            case 'declined': {
                const reason = resource && latestRequestFor(resource)?.declineReason
                return (
                    <Tooltip title={reason || undefined}>
                        <Tag color='red' icon={<CloseCircleOutlined />}>Declined</Tag>
                    </Tooltip>
                )
            }
            default:
                return <Tag>Unavailable</Tag>
        }
    }

    const columns = [
        {
            title: 'Resource',
            dataIndex: 'name',
            width: 180,
            render: (name: string) => <Text strong>{name || 'Unnamed resource'}</Text>
        },
        {
            title: 'Category',
            dataIndex: 'category',
            width: 140,
            render: (category: string) => (
                <Tag color='blue' icon={<InboxOutlined />}>
                    {category || 'General'}
                </Tag>
            )
        },
        {
            title: 'Status',
            key: 'status',
            width: 120,
            render: (_: any, record: any) => getStatusTag(getResourceStatus(record), record)
        },
        {
            title: 'Description',
            dataIndex: 'description',
            ellipsis: true
        },
        {
            title: 'Action',
            key: 'action',
            width: 110,
            render: (_: any, record: any) => {
                const status = getResourceStatus(record)
                return (
                    <Button
                        type='primary'
                        size='small'
                        shape='round'
                        // One open request per resource; approved or declined ones can be followed up
                        disabled={status === 'pending' || status === 'unavailable'}
                        onClick={() => {
                            setSelectedResource(record)
                            setFormVisible(true)
                        }}
                    >
                        Request
                    </Button>
                )
            }
        }
    ]

    const filteredResources = useMemo(() => resources.filter(resource => {
        const status = getResourceStatus(resource)
        const normalizedSearch = searchText.trim().toLowerCase()
        const matchesStatus = statusFilter === 'all' || status === statusFilter
        const matchesSearch =
            !normalizedSearch ||
            String(resource.name || '').toLowerCase().includes(normalizedSearch) ||
            String(resource.description || '').toLowerCase().includes(normalizedSearch) ||
            String(resource.category || '').toLowerCase().includes(normalizedSearch)

        return matchesStatus && matchesSearch
    }), [resources, requests, searchText, statusFilter])

    const metrics: DashboardMetric[] = useMemo(() => {
        const pendingRequests = requests.filter(
            request => String(request.status || '').toLowerCase() === 'pending'
        ).length

        return [
            {
                key: 'available-resources',
                important: true,
                icon: <InboxOutlined style={{ fontSize: 20 }} />,
                tone: 'info' as const,
                title: 'Available Resources',
                mobileTitle: 'Available',
                value: resources.filter(
                    resource => resource.status !== 'maintenance' && resource.status !== 'unavailable'
                ).length,
                subtitle: `${resources.length} resources in the catalogue`,
                mobileSubtitle: 'Resources'
            },
            {
                key: 'total-requests',
                important: true,
                icon: <FileTextOutlined style={{ fontSize: 20 }} />,
                tone: 'accent' as const,
                title: 'Total Requests',
                mobileTitle: 'Requests',
                value: requests.length,
                subtitle: `${pendingRequests} currently pending`,
                mobileSubtitle: `${pendingRequests} pending`
            }
        ]
    }, [resources, requests])

    const filterBar = (
        <Row gutter={[12, 12]}>
            <Col xs={24} md={14}>
                <Input
                    prefix={<SearchOutlined />}
                    placeholder='Search resources'
                    value={searchText}
                    onChange={event => setSearchText(event.target.value)}
                    allowClear
                />
            </Col>
            <Col xs={24} md={10}>
                <Select
                    value={statusFilter}
                    onChange={setStatusFilter}
                    style={{ width: '100%' }}
                    options={[
                        { value: 'all', label: 'All statuses' },
                        { value: 'available', label: 'Available' },
                        { value: 'pending', label: 'Pending' },
                        { value: 'approved', label: 'Approved' },
                        { value: 'declined', label: 'Declined' },
                        { value: 'unavailable', label: 'Unavailable' }
                    ]}
                />
            </Col>
        </Row>
    )

    return (
        <div style={{ padding: screens.md ? 24 : 12, minHeight: '100vh' }}>
            <Helmet>
                <title>Resources Tracking</title>
            </Helmet>

            <div style={{ marginTop: 16, marginBottom: 16 }}>
                <MetricsGrid metrics={metrics} />
            </div>

            <MotionCard
                filterBar={filterBar}
                styles={{ body: { padding: screens.md ? 20 : 12 } }}
            >
                <Table
                    dataSource={filteredResources}
                    rowKey='id'
                    columns={columns}
                    loading={loading}
                    size={screens.md ? 'middle' : 'small'}
                    scroll={{ x: 760 }}
                    pagination={{
                        pageSize: 6,
                        responsive: true,
                        showSizeChanger: false,
                        position: ['bottomCenter']
                    }}
                />
            </MotionCard>

            <Modal
                open={formVisible}
                title={`Request Resource: ${selectedResource?.name || ''}`}
                onCancel={() => {
                    setFormVisible(false)
                    setSelectedResource(null)
                    form.resetFields()
                }}
                footer={null}
                destroyOnClose
                centered
            >
                <Form form={form} layout='vertical' onFinish={handleRequest}>
                    <Form.Item
                        label='When do you need it?'
                        name='timeRange'
                        rules={[{ required: true, message: 'Please select when you need it.' }]}
                        extra={
                            selectedUnit?.single &&
                            freeForRange === 0 && (
                                <Text type='danger'>
                                    Already booked for some of this time. You can still
                                    request it, but it may be declined.
                                </Text>
                            )
                        }
                    >
                        <DatePicker.RangePicker
                            showTime={{ format: 'HH:mm' }}
                            format='YYYY-MM-DD HH:mm'
                            disabledDate={current => current && current < dayjs().startOf('day')}
                            style={{ width: '100%' }}
                        />
                    </Form.Item>

                    {selectedUnit && !selectedUnit.single && (
                        <Form.Item
                            label='Quantity'
                            name='quantity'
                            initialValue={1}
                            rules={[{ required: true, message: 'Please enter a quantity.' }]}
                            extra={
                                freeForRange !== undefined && (
                                    <Text type={freeForRange > 0 ? 'secondary' : 'danger'}>
                                        {freeForRange} of {selectedUnit.capacity} free for these dates
                                    </Text>
                                )
                            }
                        >
                            <InputNumber
                                min={1}
                                max={selectedUnit.capacity || undefined}
                                style={{ width: '100%' }}
                            />
                        </Form.Item>
                    )}

                    <Form.Item
                        label='Reason for Request'
                        name='reason'
                        rules={[{ required: true, message: 'Please enter a reason.' }]}
                    >
                        <Input.TextArea
                            rows={3}
                            placeholder='Explain why you need this resource'
                        />
                    </Form.Item>

                    <Form.Item
                        label='Urgency'
                        name='urgency'
                        rules={[{ required: true, message: 'Please select urgency.' }]}
                    >
                        <Select placeholder='Select urgency'>
                            <Option value='Low'>Low</Option>
                            <Option value='Medium'>Medium</Option>
                            <Option value='High'>High</Option>
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label='Preferred Delivery Method'
                        name='deliveryMethod'
                        rules={[{ required: true, message: 'Please select a delivery method.' }]}
                    >
                        <Select placeholder='Choose method'>
                            <Option value='Pick-up'>Pick-up</Option>
                            <Option value='Delivery'>Delivery</Option>
                            <Option value='Email (for digital items)'>
                                Email (for digital items)
                            </Option>
                        </Select>
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0 }}>
                        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                onClick={() => {
                                    setFormVisible(false)
                                    setSelectedResource(null)
                                    form.resetFields()
                                }}
                            >
                                Cancel
                            </Button>
                            <Button type='primary' htmlType='submit'>
                                Submit Request
                            </Button>
                        </Space>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default ResourceRequestForm
