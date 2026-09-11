import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Col,
    Row,
    Statistic,
    Modal,
    Collapse,
    Button,
    List,
    Tag,
    Table,
    Empty,
    Spin
} from 'antd'
import {
    FileTextOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    EyeOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'

const { Panel } = Collapse

// Only these four keys are shown
const ALLOWED_KEYS: Record<string, string> = {
    'ohs-16-1-ceo': 'OHS 16.1 CEO',
    'she-policy': 'SHE Policy',
    'housekeeping-policy': 'Housekeeping Policy',
    'waste-management-policy': 'Waste Management Policy'
}

type SignedAgreement = {
    acceptedAt?: any
    pdfUrl?: string
    pdfURL?: string
    pdf?: string
    url?: string
    pdfPath?: string
    signer?: { email?: string; name?: string }
}

type ApplicationDoc = {
    id: string

    branch?: string
    stage?: string
    fullName?: string
    name?: string
    email?: string
    signedAgreements?: Record<string, SignedAgreement>
}

type ParticipantRow = {
    key: string
    name: string
    email?: string
    stage?: string
    branch?: string
    documents: {
        key: string
        label: string
        status: 'Validated' | 'Pending' | 'Missing'
        acceptedAt?: any
        pdfUrl?: string
    }[]
}

const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 8,
    border: '1px solid #d6e4ff',
    marginBottom: 24
}

const statusColor = (s: ParticipantRow['documents'][number]['status']) =>
    s === 'Validated' ? 'green' : s === 'Pending' ? 'orange' : 'gray'

export default function HSEDocumentDashboard() {
    const { user } = useFullIdentity()
    const [loading, setLoading] = useState(true)
    const [participants, setParticipants] = useState<ParticipantRow[]>([])

    const [modalVisible, setModalVisible] = useState(false)
    const [selectedParticipantKey, setSelectedParticipantKey] = useState<
        string | null
    >(null)

    // PDF viewer
    const [viewerUrl, setViewerUrl] = useState<string | null>(null)
    const [viewerTitle, setViewerTitle] = useState<string>('Document')

    useEffect(() => {
        setLoading(true)

        const qy = query(
            collection(db, 'applications'),
        )

        const unsub = onSnapshot(
            qy,
            snap => {
                const rows: ParticipantRow[] = snap.docs.map(d => {
                    const data = { id: d.id, ...(d.data() as any) } as ApplicationDoc

                    const name =
                        data.fullName ||
                        data.name ||
                        // fallback: try any signer name in allowed docs
                        Object.values(ALLOWED_KEYS)
                            .map((_, idx) =>
                                data.signedAgreements
                                    ? Object.values(data.signedAgreements)[idx]?.signer?.name
                                    : undefined
                            )
                            .find(Boolean) ||
                        'Unknown'

                    const email =
                        data.email ||
                        // fallback: any signer email
                        (data.signedAgreements &&
                            Object.values(data.signedAgreements).find(x => x?.signer?.email)
                                ?.signer?.email) ||
                        undefined

                    const docs = Object.keys(ALLOWED_KEYS).map(k => {
                        const ag: SignedAgreement | undefined = data.signedAgreements?.[k]
                        const accepted = !!ag?.acceptedAt
                        const hasRecord = !!ag
                        const pdfUrl =
                            ag?.pdfUrl || ag?.pdfURL || ag?.pdf || ag?.url || undefined
                        return {
                            key: k,
                            label: ALLOWED_KEYS[k],
                            status: accepted
                                ? 'Validated'
                                : hasRecord
                                    ? 'Pending'
                                    : 'Missing',
                            acceptedAt: ag?.acceptedAt,
                            pdfUrl
                        }
                    })

                    return {
                        key: data.id,
                        name,
                        email,
                        stage: data.stage || undefined,
                        branch: data.branch || undefined,
                        documents: docs
                    }
                })

                // sort by: who has more missing items first, then name
                rows.sort((a, b) => {
                    const missA = a.documents.filter(d => d.status === 'Missing').length
                    const missB = b.documents.filter(d => d.status === 'Missing').length
                    if (missA !== missB) return missB - missA
                    return a.name.localeCompare(b.name)
                })

                setParticipants(rows)
                setLoading(false)
            },
            err => {
                console.error(err)
                setLoading(false)
            }
        )

        return () => unsub()
    }, [])

    const openModal = (p: ParticipantRow) => {
        setSelectedParticipantKey(p.key)
        setModalVisible(true)
    }

    const selectedParticipant = participants.find(
        p => p.key === selectedParticipantKey
    )

    // ---- metrics (from the four whitelisted docs only)
    const metrics = useMemo(() => {
        const allDocs = participants.flatMap(p => p.documents)
        const total = allDocs.length
        const validated = allDocs.filter(d => d.status === 'Validated').length
        const pending = allDocs.filter(d => d.status === 'Pending').length
        const missing = allDocs.filter(d => d.status === 'Missing').length
        return [
            { title: 'Total Documents', value: total, icon: <FileTextOutlined /> },
            { title: 'Validated', value: validated, icon: <CheckCircleOutlined /> },
            { title: 'Pending', value: pending, icon: <FileTextOutlined /> },
            { title: 'Missing', value: missing, icon: <CloseCircleOutlined /> }
        ]
    }, [participants])

    const columns = [
        { title: 'Participant', dataIndex: 'name', key: 'name' },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            render: (v: string) => v || <span style={{ color: '#999' }}>—</span>
        },
        {
            title: 'Stage',
            dataIndex: 'stage',
            key: 'stage',
            render: (v: string) => v || <span style={{ color: '#999' }}>—</span>
        },
        {
            title: 'Branch',
            dataIndex: 'branch',
            key: 'branch',
            render: (v: string) => v || <span style={{ color: '#999' }}>—</span>
        },
        {
            title: 'Status (4 required docs)',
            key: 'agg',
            render: (_: any, rec: ParticipantRow) => {
                const v = rec.documents.reduce(
                    (acc, d) => {
                        acc[d.status]++
                        return acc
                    },
                    { Validated: 0, Pending: 0, Missing: 0 } as Record<
                        'Validated' | 'Pending' | 'Missing',
                        number
                    >
                )
                return (
                    <span>
                        <Tag color='green'>Validated: {v.Validated}</Tag>
                        <Tag color='orange'>Pending: {v.Pending}</Tag>
                        <Tag color='gray'>Missing: {v.Missing}</Tag>
                    </span>
                )
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, rec: ParticipantRow) => (
                <Button
                    type='primary'
                    icon={<EyeOutlined />}
                    onClick={() => openModal(rec)}
                >
                    View Documents
                </Button>
            )
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row gutter={16}>
                {metrics.map((metric, idx) => (
                    <Col span={6} key={idx}>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <Card style={cardStyle}>
                                <Statistic
                                    title={metric.title}
                                    value={metric.value}
                                    prefix={
                                        <span
                                            style={{
                                                background: '#bae7ff',
                                                padding: 8,
                                                borderRadius: '50%',
                                                marginRight: 8,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                        >
                                            {metric.icon}
                                        </span>
                                    }
                                />
                            </Card>
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <Card style={{ ...cardStyle, marginTop: 16 }}>
                {loading ? (
                    <Spin />
                ) : participants.length ? (
                    <Table
                        columns={columns as any}
                        dataSource={participants}
                        rowKey='key'
                        pagination={{ pageSize: 10, showSizeChanger: false, position: ['bottomCenter'] }}
                        expandable={{
                            expandedRowRender: (participant: ParticipantRow) => {
                                const totalDocs = participant.documents.length
                                return (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.4 }}
                                    >
                                        <Card style={cardStyle}>
                                            <p>
                                                <strong>Total Required Docs:</strong> {totalDocs}
                                            </p>
                                            <Button
                                                type='primary'
                                                icon={<EyeOutlined />}
                                                onClick={() => openModal(participant)}
                                            >
                                                View All Documents
                                            </Button>
                                        </Card>
                                    </motion.div>
                                )
                            }
                        }}
                    />
                ) : (
                    <Empty description='No applications found' />
                )}
            </Card>

            {/* Participant Docs Modal */}
            <Modal
                title={`${selectedParticipant?.name || 'Participant'
                    } — Required Documents`}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={820}
            >
                {selectedParticipant ? (
                    <Collapse accordion>
                        <Panel header='Compliance Policies' key='req'>
                            <List
                                dataSource={selectedParticipant.documents}
                                renderItem={doc => (
                                    <List.Item key={doc.key}>
                                        <List.Item.Meta
                                            title={doc.label}
                                            description={
                                                <>
                                                    <Tag color={statusColor(doc.status)}>
                                                        {doc.status}
                                                    </Tag>
                                                    {doc.acceptedAt && (
                                                        <span style={{ marginLeft: 8, color: '#999' }}>
                                                            Accepted:{' '}
                                                            {dayjs(
                                                                doc.acceptedAt?.toDate?.() || doc.acceptedAt
                                                            ).format('YYYY-MM-DD HH:mm')}
                                                        </span>
                                                    )}
                                                </>
                                            }
                                        />
                                        <div>
                                            <Button
                                                size='small'
                                                type='link'
                                                icon={<EyeOutlined />}
                                                disabled={!doc.pdfUrl}
                                                onClick={() => {
                                                    setViewerTitle(doc.label)
                                                    setViewerUrl(doc.pdfUrl!)
                                                }}
                                            >
                                                View PDF
                                            </Button>
                                        </div>
                                    </List.Item>
                                )}
                            />
                        </Panel>
                    </Collapse>
                ) : null}
            </Modal>

            {/* PDF Viewer Modal */}
            <Modal
                title={viewerTitle}
                open={!!viewerUrl}
                onCancel={() => setViewerUrl(null)}
                footer={null}
                width={900}
                bodyStyle={{ height: '70vh', padding: 0 }}
            >
                {viewerUrl ? (
                    <iframe
                        title='policy-pdf'
                        src={viewerUrl}
                        style={{ width: '100%', height: '100%', border: 0 }}
                    />
                ) : null}
            </Modal>
        </div>
    )
}
