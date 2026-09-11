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

    const fetchResources = async () => {
        const snapshot = await getDocs(collection(db, 'resources'))
        setResources(snapshot.docs.map(resourceDoc => ({
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
        if (!selectedResource) return

        try {
            await addDoc(collection(db, 'resourceRequests'), {
                resourceId: selectedResource.id,
                resourceName: selectedResource.name,
                reason: values.reason,
                duration: values.duration,
                urgency: values.urgency,
                deliveryMethod: values.deliveryMethod,
                neededByDate: values.neededByDate?.toDate?.() || null,
                requestedBy: user.name || user.email,
                requestedByEmail: String(user.email || '').trim().toLowerCase(),
                participantId: user.participantId || user.participantDocId || null,
                status: 'pending',
                requestedAt: new Date()
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

    const getResourceStatus = (resource: any) => {
        const latestRequest = requests
            .filter(request => request.resourceId === resource.id)
            .sort((left, right) => requestTimestamp(right) - requestTimestamp(left))[0]

        if (!latestRequest) return resource.available ? 'available' : 'unavailable'
        return String(latestRequest.status || 'pending').toLowerCase()
    }

    const getStatusTag = (status: string) => {
        switch (status) {
            case 'available':
                return <Tag color='blue' icon={<InboxOutlined />}>Available</Tag>
            case 'pending':
                return <Tag color='orange' icon={<ClockCircleOutlined />}>Pending</Tag>
            case 'approved':
                return <Tag color='green' icon={<CheckCircleOutlined />}>Approved</Tag>
            case 'declined':
                return <Tag color='red' icon={<CloseCircleOutlined />}>Declined</Tag>
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
            render: (_: any, record: any) => getStatusTag(getResourceStatus(record))
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
                        disabled={status !== 'available'}
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
                icon: <InboxOutlined style={{ fontSize: 20, color: '#1677ff' }} />,
                iconBg: 'rgba(22,119,255,.12)',
                title: 'Available Resources',
                mobileTitle: 'Available',
                value: resources.filter(resource => resource.available === true).length,
                subtitle: `${resources.length} resources in the catalogue`,
                mobileSubtitle: 'Resources'
            },
            {
                key: 'total-requests',
                important: true,
                icon: <FileTextOutlined style={{ fontSize: 20, color: '#722ed1' }} />,
                iconBg: 'rgba(114,46,209,.12)',
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
                        label='Usage Duration'
                        name='duration'
                        rules={[{ required: true, message: 'Please enter usage duration.' }]}
                    >
                        <Input placeholder='e.g. 2 weeks, 3 days or 1 month' />
                    </Form.Item>

                    <Form.Item
                        label='Date Needed'
                        name='neededByDate'
                        rules={[{ required: true, message: 'Please select the date needed.' }]}
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>

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
