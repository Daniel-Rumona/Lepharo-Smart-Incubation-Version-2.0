import React, { useEffect, useState } from 'react'
import {
    Alert,
    Statistic,
    Card,
    Row,
    Col,
    Table,
    Button,
    Tag,
    Modal,
    Timeline,
    Select,
    Input,
    DatePicker,
    Form,
    message,
    Space,
    Checkbox
} from 'antd'
import {
    ClockCircleOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    FileDoneOutlined,
    PlusOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import {
    collection,
    query,
    where,
    onSnapshot,
    addDoc,
    Timestamp
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Option } = Select

const statusLabels = {
    pending_purchase_approval: 'Pending Purchase Approval',
    pending_quotation: 'Approved and Awaiting Quotation',
    quotation_submitted: 'Quotation Submitted and Awaiting Approval',
    quotation_approved: 'Quotation Approved',
    invoice_requested: 'Invoice Requested',
    invoice_uploaded: 'Invoice Uploaded',
    invoice_approved: 'Invoice Approved',
    ceo_approval: 'Awaiting CEO Approval',
    approved_final: 'Final Approval Granted',
    completed: 'Completed'
}

const InternalResourceRequestView = () => {
    const [form] = Form.useForm()
    const [requests, setRequests] = useState([])
    const [trackModal, setTrackModal] = useState(false)
    const [requestModal, setRequestModal] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState(null)
    const [filters, setFilters] = useState({ status: '', search: '' })
    const [isAdhoc, setIsAdhoc] = useState(false)
    const [resources, setResources] = useState([])
    const { user } = useFullIdentity()

    useEffect(() => {
        const q = query(
            collection(db, 'resources')
        )
        const unsubscribe = onSnapshot(q, snapshot => {
            const resourceData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }))
            setResources(resourceData)
        })

        return () => unsubscribe()
    }, [])

    useEffect(() => {
        const q = query(
            collection(db, 'resourceRequests'),
            where('requestType', '==', 'internal')
        )
        const unsubscribe = onSnapshot(q, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            setRequests(data)
        })
        return () => unsubscribe()
    }, [])

    const handleSubmit = async values => {
        const selectedResource = resources.find(r => r.id === values.resourceId)
        const resourceName = isAdhoc
            ? values.customResource
            : selectedResource?.name

        try {
            await addDoc(collection(db, 'resourceRequests'), {
                resourceName,
                resourceId: values.resourceId || null,
                neededBy: values.neededBy.toISOString(),
                purpose: values.purpose,
                status: 'pending_purchase_approval',
                requestType: 'internal',
                progress: [
                    {
                        stage: 'pending_purchase_approval',
                        timestamp: Timestamp.now()
                    }
                ],
                createdAt: Timestamp.now(),
                requestedBy: user?.role || '',
                requestedFrom: user?.assignedBranch || ''
            })
            message.success('Request submitted')
            form.resetFields()
            setRequestModal(false)
            setIsAdhoc(false)
        } catch (err) {
            console.error(err)
            message.error('Failed to submit request')
        }
    }

    const filteredRequests = requests.filter(req => {
        return (
            (!filters.status || req.status === filters.status) &&
            (!filters.search ||
                req.resourceName.toLowerCase().includes(filters.search.toLowerCase()) ||
                req.purpose.toLowerCase().includes(filters.search.toLowerCase()))
        )
    })

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Alert
                message='Internal Requests System'
                description='Use this tool to request resources needed for operations. Requests can be standard or ad-hoc and will be routed through a structured approval workflow.'
                type='info'
                showIcon
                closable
                style={{ marginBottom: 24 }}
            />

            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                    <Card
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Total'
                            value={requests.length}
                            prefix={<FileDoneOutlined />}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Pending'
                            value={
                                requests.filter(r => r.status.startsWith('pending')).length
                            }
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: '#faad14' }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Approved'
                            value={requests.filter(r => r.status === 'approved_final').length}
                            prefix={<CheckOutlined />}
                            valueStyle={{ color: '#52c41a' }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <Statistic
                            title='Completed'
                            value={requests.filter(r => r.status === 'completed').length}
                            prefix={<CheckCircleOutlined />}
                            valueStyle={{ color: '#1890ff' }}
                        />
                    </Card>
                </Col>
            </Row>

            <MotionCard>
                <Space style={{ marginBottom: 10 }}>
                    <Select
                        placeholder='Filter by Status'
                        onChange={val => setFilters(prev => ({ ...prev, status: val }))}
                        allowClear
                    >
                        {Object.keys(statusLabels).map(status => (
                            <Option key={status}>{statusLabels[status]}</Option>
                        ))}
                    </Select>
                    <Input.Search
                        placeholder='Search...'
                        onChange={e =>
                            setFilters(prev => ({ ...prev, search: e.target.value }))
                        }
                        allowClear
                    />
                    <Button
                        type='primary'
                        icon={<PlusOutlined />}
                        iconPosition='start'
                        onClick={() => setRequestModal(true)}
                    >
                        New Resource Request
                    </Button>
                </Space>
                <Table
                    dataSource={filteredRequests}
                    rowKey='id'
                    columns={[
                        { title: 'Resource', dataIndex: 'resourceName' },
                        { title: 'Purpose', dataIndex: 'purpose' },
                        {
                            title: 'Needed By',
                            dataIndex: 'neededBy',
                            render: val => dayjs(val).format('YYYY-MM-DD')
                        },
                        {
                            title: 'Status',
                            dataIndex: 'status',
                            render: s => <Tag>{statusLabels[s] || s}</Tag>
                        },
                        {
                            title: 'Actions',
                            render: (_, record) =>
                                record.status !== 'rejected' && (
                                    <Button
                                        onClick={() => {
                                            setSelectedRequest(record)
                                            setTrackModal(true)
                                        }}
                                    >
                                        Track
                                    </Button>
                                )
                        }
                    ]}
                />
            </MotionCard>

            <Modal
                open={trackModal}
                onCancel={() => setTrackModal(false)}
                footer={null}
                title='Request Progress'
            >
                {selectedRequest && (
                    <Timeline>
                        {selectedRequest.progress.map((p, idx) => (
                            <Timeline.Item key={idx}>
                                <b>{statusLabels[p.stage] || p.stage}</b> —{' '}
                                {dayjs(
                                    p.timestamp.toDate ? p.timestamp.toDate() : p.timestamp
                                ).format('YYYY-MM-DD HH:mm')}
                                {/* {p.actor && ` by ${p.actor}`} */}
                            </Timeline.Item>
                        ))}
                    </Timeline>
                )}
            </Modal>

            <Modal
                open={requestModal}
                title='New Internal Resource Request'
                onCancel={() => {
                    setRequestModal(false)
                    setIsAdhoc(false)
                }}
                onOk={() => form.submit()}
                okText='Submit'
                cancelText='Cancel'
            >
                <Form form={form} layout='vertical' onFinish={handleSubmit}>
                    <Form.Item>
                        <Checkbox
                            checked={isAdhoc}
                            onChange={e => setIsAdhoc(e.target.checked)}
                        >
                            This is an ad-hoc request (e.g. catering, one-time service)
                        </Checkbox>
                    </Form.Item>

                    {!isAdhoc ? (
                        <Form.Item
                            name='resourceId'
                            label='Select Resource'
                            rules={[{ required: true }]}
                        >
                            <Select placeholder='Select'>
                                {resources.map(r => (
                                    <Option key={r.id} value={r.id}>
                                        {r.name}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>
                    ) : (
                        <Form.Item
                            name='customResource'
                            label='Describe Resource'
                            rules={[{ required: true }]}
                        >
                            <Input placeholder='e.g. Catering for event, Tent hire' />
                        </Form.Item>
                    )}

                    <Form.Item
                        name='neededBy'
                        label='Needed By'
                        rules={[{ required: true }]}
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                        name='purpose'
                        label='Purpose'
                        rules={[{ required: true }]}
                    >
                        <Input.TextArea
                            rows={3}
                            placeholder='Why do you need this resource?'
                        />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default InternalResourceRequestView
