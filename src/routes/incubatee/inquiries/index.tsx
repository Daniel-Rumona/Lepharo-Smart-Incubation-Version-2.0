import React, { useEffect, useState } from 'react'
import {
    Card,
    Table,
    Button,
    Modal,
    Form,
    Input,
    Select,
    Statistic,
    Row,
    Col,
    Tag,
    Space,
    Typography,
    message,
    Divider
} from 'antd'
import { PlusOutlined, EyeOutlined } from '@ant-design/icons'
import { db } from '@/firebase'
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    deleteDoc,
    doc,
    Timestamp
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import {
    FileSearchOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { motion } from 'framer-motion'

const { Title, Text } = Typography

const INQUIRY_TYPES = ['Request', 'Complaint', 'Follow-Up', 'Other']
const SERVICE_AREAS = [
    'Finance',
    'Marketing',
    'Operations',
    'Compliance',
    'Legal',
    'Wellness',
    'Training',
    'General Support'
]

const IncubateeInquiriesPage: React.FC = () => {
    const { user } = useFullIdentity()
    const [form] = Form.useForm()
    const [inquiries, setInquiries] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [viewModal, setViewModal] = useState(false)
    const [selectedInquiry, setSelectedInquiry] = useState<any>(null)

    const fetchInquiries = async () => {
        if (!user?.id) return
        setLoading(true)
        const q = query(
            collection(db, 'inquiries'),
            where('participantId', '==', user.id)
        )
        const snapshot = await getDocs(q)
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        setInquiries(
            data.sort((a, b) => b.createdAt?.toDate() - a.createdAt?.toDate())
        )
        setLoading(false)
    }

    useEffect(() => {
        fetchInquiries()
    }, [user?.id])

    const handleSubmit = async (formValues: any) => {
        try {
            if (!user?.email || !user?.id) throw new Error('Missing user identity')

            const participantSnap = await getDocs(
                query(collection(db, 'participants'), where('email', '==', user.email))
            )

            if (participantSnap.empty) throw new Error('Participant not found.')

            const participant = participantSnap.docs[0].data()

            const contactInfo = {
                name: participant.ownerName || user.name || '',
                email: participant.email || '',
                phone: participant.phone || ''
            }

            const inquiryDoc = {
                branchId: participant.branchId || 'unknown',
                submittedBy: user.id,
                submittedAt: Timestamp.now(),
                status: 'New',
                priority: null,
                source: 'Beneficiary',
                contactInfo,
                inquiryDetails: {
                    inquiryType: formValues.type,
                    servicesOfInterest: [formValues.serviceArea], // single select now, adjust if you support multi
                    message: formValues.message
                },
                followUp: null,
                statusHistory: [
                    {
                        status: 'New',
                        changedAt: new Date(),
                        changedBy: user.id,
                        notes: 'Created by incubatee'
                    }
                ],
                tags: [],
                updatedAt: Timestamp.now(),
                isActive: true
            }

            await addDoc(collection(db, 'inquiries'), inquiryDoc)
            message.success('Inquiry submitted successfully')
            form.resetFields()
            setModalOpen(false)
            fetchInquiries()
        } catch (err) {
            console.error('Inquiry submission error:', err)
            message.error('Submission failed. Please try again.')
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await deleteDoc(doc(db, 'inquiries', id))
            message.success('Inquiry deleted.')
            fetchInquiries()
        } catch (err) {
            message.error('Failed to delete.')
        }
    }

    const metrics = {
        total: inquiries.length,
        pending: inquiries.filter(i => i.status === 'pending').length,
        responded: inquiries.filter(i => i.status === 'responded').length
    }

    const columns = [
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type'
        },
        {
            title: 'Service Area',
            dataIndex: 'serviceArea',
            key: 'serviceArea'
        },
        {
            title: 'Date',
            dataIndex: 'createdAt',
            key: 'createdAt',
            render: (val: any) => dayjs(val?.toDate?.()).format('YYYY-MM-DD HH:mm')
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (val: string) => (
                <Tag color={val === 'responded' ? 'green' : 'orange'}>
                    {val.toUpperCase()}
                </Tag>
            )
        },
        {
            title: 'Action',
            key: 'action',
            render: (_: any, record: any) => (
                <Space>
                    <Button
                        icon={<EyeOutlined />}
                        onClick={() => {
                            setSelectedInquiry(record)
                            setViewModal(true)
                        }}
                    />
                    {record.status === 'pending' && (
                        <Button danger onClick={() => handleDelete(record.id)}>
                            Delete
                        </Button>
                    )}
                </Space>
            )
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Inquiries Tracking</title>
            </Helmet>

            {/* 🔹 Top Metrics */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={8}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,
                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Row align='middle' gutter={8}>
                                <Col>
                                    <FileSearchOutlined
                                        style={{ fontSize: 28, color: '#1890ff' }}
                                    />
                                </Col>
                                <Col>
                                    <Text>Total Inquiries</Text>
                                    <Title level={4} style={{ margin: 0 }}>
                                        {metrics.total}
                                    </Title>
                                </Col>
                            </Row>
                        </Card>
                    </motion.div>
                </Col>

                <Col xs={24} sm={8}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,

                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Row align='middle' gutter={8}>
                                <Col>
                                    <ClockCircleOutlined
                                        style={{ fontSize: 28, color: '#fa8c16' }}
                                    />
                                </Col>
                                <Col>
                                    <Text>Pending</Text>
                                    <Title level={4} style={{ margin: 0, color: '#fa8c16' }}>
                                        {metrics.pending}
                                    </Title>
                                </Col>
                            </Row>
                        </Card>
                    </motion.div>
                </Col>

                <Col xs={24} sm={8}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <Card
                            style={{
                                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                                transition: 'all 0.3s ease',
                                borderRadius: 12,

                                border: '1px solid #d6e4ff'
                            }}
                        >
                            <Row align='middle' gutter={8}>
                                <Col>
                                    <CheckCircleOutlined
                                        style={{ fontSize: 28, color: '#52c41a' }}
                                    />
                                </Col>
                                <Col>
                                    <Text>Responded</Text>
                                    <Title level={4} style={{ margin: 0, color: '#52c41a' }}>
                                        {metrics.responded}
                                    </Title>
                                </Col>
                            </Row>
                        </Card>
                    </motion.div>
                </Col>
            </Row>

            {/* 🔹 Main Table */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <Card
                    title='Inquiry History'
                    style={{
                        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                        transition: 'all 0.3s ease',
                        borderRadius: 12,
                        border: '1px solid #d6e4ff'
                    }}
                    extra={
                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={() => setModalOpen(true)}
                        >
                            Make New Inquiry
                        </Button>
                    }
                >
                    <Table
                        dataSource={inquiries}
                        columns={columns}
                        // loading={loading}
                        rowKey='id'
                        pagination={{ pageSize: 5 }}
                    />
                </Card>
            </motion.div>

            {/* 🔹 Inquiry Form Modal */}
            <Modal
                title='Submit New Inquiry'
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={() => form.submit()}
                okText='Submit'
                destroyOnClose
            >
                <Form layout='vertical' form={form} onFinish={handleSubmit}>
                    <Form.Item
                        name='type'
                        label='Inquiry Type'
                        rules={[{ required: true }]}
                    >
                        <Select placeholder='Select inquiry type'>
                            {INQUIRY_TYPES.map(type => (
                                <Select.Option key={type} value={type}>
                                    {type}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        name='serviceArea'
                        label='Service Area'
                        rules={[{ required: true }]}
                    >
                        <Select placeholder='Select related service area'>
                            {SERVICE_AREAS.map(area => (
                                <Select.Option key={area} value={area}>
                                    {area}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        name='message'
                        label='Message'
                        rules={[{ required: true }]}
                    >
                        <Input.TextArea
                            rows={4}
                            placeholder='Describe your issue or request...'
                        />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 🔹 View Modal */}
            <Modal
                title='Inquiry Details'
                open={viewModal}
                onCancel={() => setViewModal(false)}
                footer={<Button onClick={() => setViewModal(false)}>Close</Button>}
            >
                {selectedInquiry && (
                    <>
                        <p>
                            <Text strong>Title:</Text> {selectedInquiry.title}
                        </p>
                        <p>
                            <Text strong>Type:</Text> {selectedInquiry.type}
                        </p>
                        <p>
                            <Text strong>Service Area:</Text> {selectedInquiry.serviceArea}
                        </p>
                        <p>
                            <Text strong>Message:</Text>
                            <br />
                            {selectedInquiry.message}
                        </p>
                        <Divider />
                        <p>
                            <Text strong>Response:</Text>
                            <br />
                            {selectedInquiry.response ? (
                                <Text>{selectedInquiry.response}</Text>
                            ) : (
                                <Text type='secondary'>No response yet.</Text>
                            )}
                        </p>
                    </>
                )}
            </Modal>
        </div>
    )
}

export default IncubateeInquiriesPage
