// ConsolidatedInvoicePacks.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Table,
    Card,
    Row,
    Col,
    Typography,
    Tag,
    Space,
    Button,
    Modal,
    Alert,
    message,
    Select,
    DatePicker,
    Form,
    InputNumber,
    Upload,
    Input
} from 'antd'
import {
    FileDoneOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    EyeOutlined,
    CheckOutlined,
    CloseOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import {
    collection,
    getDocs,
    query,
    where,
    addDoc,
    onSnapshot
} from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'

const { Title, Text } = Typography
const { Option } = Select
const { MonthPicker } = DatePicker
const { TextArea } = Input

type MovDoc = {
    id?: string
    smmeCompanyName?: string
    smmeName?: string
    smmeSignatureUrl?: string
    smmeDigitalSignature?: string
    facilitatorName?: string
    facilitatorSignatureUrl?: string
    facilitatorDigitalSignature?: string
    signatureURL?: string
    digitalSignature?: string
    interventionTitle?: string
    interventionDate?: any
    interventionsList?: Array<{ title: string; date: any; signature?: string }>
    departmentName?: string
}

type Approval = { step: string; name?: string; role?: string; date?: any }

type ConsolidatedPack = {
    id: string
    department: string
    month: string
    range?: { from: any; to: any }
    totalItems?: number
    approvals?: Approval[]
    createdAt?: any
    invoiceAttachment?: { name?: string; url?: string } | string | null
    interventions?: MovDoc[]
    interventionsSnapshot?: MovDoc[]
    hodName?: string
    hodSignatureUrl?: string
    hodDigitalSignature?: string
}

type InvoiceDecision = {
    id: string
    packId?: string
    decision?: 'approved' | 'rejected'
    decidedAt?: any
    amount?: number
    popAttachment?: { name?: string; url?: string }
    invoice?: { name?: string; url?: string } | null
}

const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 12,
    border: '1px solid #d6e4ff'
}

const Motion: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
    >
        {children}
    </motion.div>
)

const clip = (s?: string) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—')
const isPdf = (url?: string) => !!url && /\.pdf($|\?)/i.test(url)
const isImage = (url?: string) =>
    !!url && /\.(png|jpe?g|gif|webp)($|\?)/i.test(url)
const financeTag = (d?: 'approved' | 'rejected') =>
    d ? (
        <Tag color={d === 'approved' ? 'green' : 'red'}>{d.toUpperCase()}</Tag>
    ) : (
        <Tag>Pending</Tag>
    )

// ---------- Component ----------
const ConsolidatedInvoicePacks: React.FC = () => {
    const { user } = useFullIdentity()
    const [allPacks, setAllPacks] = useState<ConsolidatedPack[]>([])
    const [loading, setLoading] = useState(false)

    // finance decisions index: packId -> latest decision
    const [decisionsByPack, setDecisionsByPack] = useState<
        Record<string, InvoiceDecision>
    >({})

    // filters
    const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(null)
    const [dept, setDept] = useState<string>('all')

    // pack modal
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [activePack, setActivePack] = useState<ConsolidatedPack | null>(null)

    // invoice viewer modal
    const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

    // approve/reject modals
    const [approveOpen, setApproveOpen] = useState(false)
    const [rejectOpen, setRejectOpen] = useState(false)
    const [approveSubmitting, setApproveSubmitting] = useState(false)
    const [rejectSubmitting, setRejectSubmitting] = useState(false)
    const [popFile, setPopFile] = useState<File | null>(null)
    const [approveForm] = Form.useForm()
    const [rejectForm] = Form.useForm()

    // fetch packs
    const fetchPacks = async () => {
        setLoading(true)
        try {
            const qy = query(
                collection(db, 'consolidatedMOVs')

            )
            const snap = await getDocs(qy)
            const list = snap.docs.map(d => ({
                id: d.id,
                ...(d.data() as any)
            })) as ConsolidatedPack[]
            setAllPacks(list)
        } catch (e) {
            console.error(e)
            message.error('Failed to load consolidated MOV packs')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPacks()
    }, [])

    // subscribe to invoices and build a decisions index (latest per packId)
    useEffect(() => {
        const qy = query(
            collection(db, 'invoices')
        )
        const unsub = onSnapshot(qy, snap => {
            const map: Record<string, InvoiceDecision> = {}
            snap.forEach(d => {
                const data = d.data() as any
                const pid = data.packId
                if (!pid) return
                const prev = map[pid]
                const currTime = data.decidedAt?.toMillis?.() || 0
                const prevTime = prev?.decidedAt?.toMillis?.() || 0
                if (!prev || currTime >= prevTime) {
                    map[pid] = {
                        id: d.id,
                        packId: pid,
                        decision: data.decision,
                        decidedAt: data.decidedAt,
                        amount: data.amount,
                        popAttachment: data.popAttachment || undefined,
                        invoice: data.invoice || null
                    }
                }
            })
            setDecisionsByPack(map)
        })
        return () => unsub()
    }, [])

    // Only packs that have final admin confirmation
    const finalConfirmed = useMemo(() => {
        const hasFinal = (a?: Approval[]) =>
            (a || []).some(x =>
                ['final_submission', 'final_confirmation'].includes(
                    String(x.step || '').toLowerCase()
                )
            )
        const inDept = (p: ConsolidatedPack) =>
            dept === 'all'
                ? true
                : (p.department || '').toLowerCase() === dept.toLowerCase()
        const inMonth = (p: ConsolidatedPack) => {
            if (!selectedMonth) return true
            const m = dayjs(p.month, ['YYYY-MM', 'YYYY-MM-DD'])
            return m.isValid() && m.isSame(selectedMonth, 'month')
        }
        return allPacks
            .filter(p => hasFinal(p.approvals))
            .filter(p => inDept(p) && inMonth(p))
            .sort((a, b) => {
                const aT = a.createdAt?.toDate?.() || a.createdAt || 0
                const bT = b.createdAt?.toDate?.() || b.createdAt || 0
                return new Date(bT).getTime() - new Date(aT).getTime()
            })
    }, [allPacks, dept, selectedMonth])

    const uniqueDepartments = useMemo(
        () =>
            Array.from(new Set(allPacks.map(p => p.department).filter(Boolean))).sort(
                (a, b) => String(a).localeCompare(String(b))
            ),
        [allPacks]
    )

    // metrics
    const metrics = useMemo(() => {
        const packs = finalConfirmed
        const count = packs.length
        const hasInvoice = packs.filter(p => {
            const inv = p.invoiceAttachment
            const url = typeof inv === 'string' ? inv : inv?.url
            return !!url
        }).length
        const awaitingME = packs.filter(
            p => !(p.approvals || []).some(a => a.step === 'validation')
        ).length
        return {
            total: count,
            withInvoice: hasInvoice,
            withoutInvoice: count - hasInvoice,
            awaitingME
        }
    }, [finalConfirmed])

    // table (listing)
    const columns = [
        {
            title: 'Month',
            dataIndex: 'month',
            render: (m: string) =>
                dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                    ? dayjs(m).format('MMM YYYY')
                    : m
        },
        { title: 'Department', dataIndex: 'department' },
        {
            title: 'Items',
            render: (rec: ConsolidatedPack) =>
                (rec.interventions || rec.interventionsSnapshot || []).length ||
                rec.totalItems ||
                0
        },
        {
            title: 'Invoice',
            render: (_: any, rec: ConsolidatedPack) => {
                const inv = rec.invoiceAttachment
                const url = typeof inv === 'string' ? inv : inv?.url
                const name = typeof inv === 'string' ? 'Invoice' : inv?.name
                return url ? (
                    <Button
                        type='link'
                        onClick={() => {
                            setActivePack(rec)
                            setInvoiceModalOpen(true)
                        }}
                    >
                        {name || 'View'}
                    </Button>
                ) : (
                    <Tag color='volcano'>Missing</Tag>
                )
            }
        },
        {
            title: 'Finance',
            render: (rec: ConsolidatedPack) =>
                financeTag(decisionsByPack[rec.id]?.decision)
        },
        {
            title: 'Actions',
            render: (_: any, rec: ConsolidatedPack) => {
                const decided = !!decisionsByPack[rec.id]?.decision
                return (
                    <Space>
                        <Button
                            type='link'
                            icon={<EyeOutlined />}
                            onClick={() => {
                                setActivePack(rec)
                                setPackModalOpen(true)
                            }}
                        >
                            View Pack
                        </Button>
                        {!decided && (
                            <>
                                <Button
                                    onClick={() => {
                                        setActivePack(rec)
                                        setApproveOpen(true)
                                    }}
                                    icon={<CheckOutlined />}
                                    type='link'
                                >
                                    Approve
                                </Button>
                                <Button
                                    danger
                                    onClick={() => {
                                        setActivePack(rec)
                                        setRejectOpen(true)
                                    }}
                                    icon={<CloseOutlined />}
                                    type='link'
                                >
                                    Reject
                                </Button>
                            </>
                        )}
                    </Space>
                )
            }
        }
    ]

    const monthLabel = (m?: string) =>
        m && dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
            ? dayjs(m).format('MMMM YYYY')
            : m || ''

    // ---------- helpers for uploads / writes ----------
    const uploadPOPIfAny = async (file: File | null, pathBase: string) => {
        if (!file) return null
        try {
            const storage = getStorage()
            const safe = file.name.replace(/\s+/g, '_')
            const rf = ref(storage, `${pathBase}/${Date.now()}_${safe}`)
            await uploadBytes(rf, file)
            const url = await getDownloadURL(rf)
            return { name: file.name, url, path: rf.fullPath }
        } catch (e) {
            console.error(e)
            message.error(
                'Failed to upload POP (approve will still save without it).'
            )
            return null
        }
    }

    const writeInvoiceDecision = async (payload: any) => {
        await addDoc(collection(db, 'invoices'), payload)
    }

    // ---------- approve / reject submit ----------
    const handleApproveSubmit = async () => {
        if (!activePack || !user) return
        try {
            const vals = await approveForm.validateFields()
            setApproveSubmitting(true)

            const inv = activePack.invoiceAttachment
            const invoiceUrl = typeof inv === 'string' ? inv : inv?.url || null
            const invoiceName =
                typeof inv === 'string' ? 'Invoice' : inv?.name || null

            const popMeta = await uploadPOPIfAny(
                popFile,
                `invoices/${activePack.department}/${dayjs(
                    activePack.month
                ).format('YYYY-MM')}`
            )

            await writeInvoiceDecision({
                decision: 'approved',
                department: activePack.department || null,
                month: activePack.month || null,
                packId: activePack.id,
                items:
                    (activePack.interventions || activePack.interventionsSnapshot || [])
                        .length ||
                    activePack.totalItems ||
                    0,
                invoice: invoiceUrl ? { name: invoiceName, url: invoiceUrl } : null,
                popAttachment: popMeta,
                amount: vals.amount ?? null,
                paidDate: vals.paidDate ? vals.paidDate.toDate() : null,
                notes: vals.notes || null,
                decidedAt: new Date(),
                decidedBy: {
                    uid: user.uid,
                    name: user.name || '',
                    role: user.role || '',
                    email: user.email || ''
                },
                type: 'department_invoice'
            })

            message.success('Invoice approved and saved.')
            setApproveOpen(false)
            setPopFile(null)
            approveForm.resetFields()
            // no manual UI mutation needed — onSnapshot(invoices) will hide the buttons
        } catch (e) {
            if ((e as any).errorFields) return
            console.error(e)
            message.error('Could not save approval.')
        } finally {
            setApproveSubmitting(false)
        }
    }

    const handleRejectSubmit = async () => {
        if (!activePack || !user) return
        try {
            const vals = await rejectForm.validateFields()
            setRejectSubmitting(true)

            const inv = activePack.invoiceAttachment
            const invoiceUrl = typeof inv === 'string' ? inv : inv?.url || null
            const invoiceName =
                typeof inv === 'string' ? 'Invoice' : inv?.name || null

            await writeInvoiceDecision({
                decision: 'rejected',
                reason: vals.reason || null,
                department: activePack.department || null,
                month: activePack.month || null,
                packId: activePack.id,
                items:
                    (activePack.interventions || activePack.interventionsSnapshot || [])
                        .length ||
                    activePack.totalItems ||
                    0,
                invoice: invoiceUrl ? { name: invoiceName, url: invoiceUrl } : null,
                decidedAt: new Date(),
                decidedBy: {
                    uid: user.uid,
                    name: user.name || '',
                    role: user.role || '',
                    email: user.email || ''
                }
            })

            message.success('Rejection saved.')
            setRejectOpen(false)
            rejectForm.resetFields()
            // buttons will hide automatically via invoices subscription
        } catch (e) {
            if ((e as any).errorFields) return
            console.error(e)
            message.error('Could not save rejection.')
        } finally {
            setRejectSubmitting(false)
        }
    }

    // ---------- Render ----------
    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Motion>
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='Consolidated MOV Invoice Packs (Confirmed)'
                    description='Below are only the monthly packs that have reached the final confirmation stage.'
                />
            </Motion>

            {/* KPI Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
                <Col xs={24} sm={8}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div
                                    style={{
                                        background: '#e6f7ff',
                                        padding: 12,
                                        borderRadius: '50%',
                                        marginRight: 16
                                    }}
                                >
                                    <FileDoneOutlined
                                        style={{ fontSize: 24, color: '#1890ff' }}
                                    />
                                </div>
                                <div>
                                    <Text type='secondary'>Total Packs</Text>
                                    <Title level={3} style={{ margin: 0, color: '#1890ff' }}>
                                        {metrics.total}
                                    </Title>
                                </div>
                            </div>
                        </Card>
                    </Motion>
                </Col>
                <Col xs={24} sm={8}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div
                                    style={{
                                        background: '#f6ffed',
                                        padding: 12,
                                        borderRadius: '50%',
                                        marginRight: 16
                                    }}
                                >
                                    <CheckCircleOutlined
                                        style={{ fontSize: 24, color: '#52c41a' }}
                                    />
                                </div>
                                <div>
                                    <Text type='secondary'>With Invoice</Text>
                                    <Title level={3} style={{ margin: 0, color: '#52c41a' }}>
                                        {metrics.withInvoice}
                                    </Title>
                                </div>
                            </div>
                        </Card>
                    </Motion>
                </Col>
                <Col xs={24} sm={8}>
                    <Motion>
                        <Card hoverable style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <div
                                    style={{
                                        background: '#fff7e6',
                                        padding: 12,
                                        borderRadius: '50%',
                                        marginRight: 16
                                    }}
                                >
                                    <ExclamationCircleOutlined
                                        style={{ fontSize: 24, color: '#fa8c16' }}
                                    />
                                </div>
                                <div>
                                    <Text type='secondary'>Missing Invoice</Text>
                                    <Title level={3} style={{ margin: 0, color: '#fa8c16' }}>
                                        {metrics.withoutInvoice}
                                    </Title>
                                </div>
                            </div>
                        </Card>
                    </Motion>
                </Col>
            </Row>

            {/* Filters */}
            <Motion>
                <Card hoverable style={cardStyle}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={8}>
                            <Select style={{ width: '100%' }} value={dept} onChange={setDept}>
                                <Option key='all' value='all'>
                                    All Departments
                                </Option>
                                {uniqueDepartments.map(d => (
                                    <Option key={d} value={d!}>
                                        {d}
                                    </Option>
                                ))}
                            </Select>
                        </Col>
                        <Col xs={24} sm={8}>
                            <MonthPicker
                                style={{ width: '100%' }}
                                value={selectedMonth as any}
                                onChange={setSelectedMonth as any}
                            />
                        </Col>
                        <Col xs={24} sm={8}>
                            <Space wrap>
                                <Button onClick={() => setSelectedMonth(null)}>Clear</Button>
                                <Button type='primary' onClick={fetchPacks}>
                                    Refresh
                                </Button>
                            </Space>
                        </Col>
                    </Row>
                </Card>
            </Motion>

            {/* Table */}
            <Motion>
                <Card hoverable style={{ ...cardStyle, marginTop: 12 }}>
                    <Table
                        rowKey='id'
                        dataSource={finalConfirmed}
                        loading={loading}
                        columns={columns as any}
                        pagination={{ pageSize: 10 }}
                    />
                </Card>
            </Motion>

            {/* PACK MODAL — document style */}
            <Modal
                open={packModalOpen}
                onCancel={() => setPackModalOpen(false)}
                footer={null}
                width={1100}
                title={
                    activePack
                        ? `Consolidated MOV • ${activePack.department} • ${monthLabel(
                            activePack.month
                        )}`
                        : 'Pack'
                }
            >
                {activePack && (
                    <div
                        style={{
                            background: '#fff',
                            border: '1px solid #e8e8e8',
                            borderRadius: 8,
                            padding: 16
                        }}
                    >
                        {/* Header 3 cols */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 2fr 1fr',
                                alignItems: 'center',
                                marginBottom: 12
                            }}
                        >
                            <div style={{ textAlign: 'left' }}>
                                <img
                                    src='/assets/images/Sibanye-brand-logo.png'
                                    alt='Sibanye'
                                    style={{ height: 120, objectFit: 'contain' }}
                                />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 12, color: '#666' }}>
                                    {activePack.department} • {monthLabel(activePack.month)}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <img
                                    src='/assets/images/lepharo.png'
                                    alt='Lepharo'
                                    style={{ height: 42, objectFit: 'contain' }}
                                />
                            </div>
                        </div>

                        <div
                            style={{ borderTop: '1px solid #eee', margin: '6px 0 12px' }}
                        />

                        <Table
                            size='small'
                            bordered
                            pagination={{ pageSize: 8 }}
                            rowKey={(x: any, i) =>
                                x.id ||
                                `${x.smmeCompanyName}-${x.interventionTitle}-${x.interventionDate}-${i}`
                            }
                            dataSource={(
                                activePack.interventions ||
                                activePack.interventionsSnapshot ||
                                []
                            ).map(x => ({ ...x }))}
                            columns={[
                                { title: 'Beneficiary', dataIndex: 'smmeCompanyName' },
                                { title: 'Intervention', dataIndex: 'interventionTitle' },
                                { title: 'Facilitator', dataIndex: 'facilitatorName' },
                                {
                                    title: 'Date Completed',
                                    dataIndex: 'interventionDate',
                                    render: (val: any) => {
                                        const d =
                                            typeof val?.toDate === 'function' ? val.toDate() : val
                                        return dayjs(d).isValid()
                                            ? dayjs(d).format('YYYY-MM-DD')
                                            : '—'
                                    }
                                },
                                {
                                    title: 'Facilitator Signature',
                                    render: (_: any, mov: MovDoc) => {
                                        const img = mov.facilitatorSignatureUrl || mov.signatureURL
                                        const crypto =
                                            mov.facilitatorDigitalSignature || mov.digitalSignature
                                        return img ? (
                                            <img
                                                src={img}
                                                alt='Facilitator signature'
                                                style={{ height: 36 }}
                                            />
                                        ) : (
                                            <span style={{ fontFamily: 'monospace' }}>
                                                {clip(crypto)}
                                            </span>
                                        )
                                    }
                                }
                            ]}
                        />

                        {/* Invoice + action buttons */}
                        <div
                            style={{
                                marginTop: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                flexWrap: 'wrap'
                            }}
                        >
                            <div>
                                <Text strong>Invoice: </Text>
                                {(() => {
                                    const inv = activePack.invoiceAttachment
                                    const url = typeof inv === 'string' ? inv : inv?.url
                                    const name = typeof inv === 'string' ? 'Invoice' : inv?.name
                                    return url ? (
                                        <Button
                                            type='link'
                                            onClick={() => setInvoiceModalOpen(true)}
                                        >
                                            {name || 'View'}
                                        </Button>
                                    ) : (
                                        <em>None</em>
                                    )
                                })()}
                            </div>

                            {/* Finance status + actions */}
                            <Space>
                                {financeTag(decisionsByPack[activePack.id]?.decision)}
                                {!decisionsByPack[activePack.id]?.decision && (
                                    <>
                                        <Button type='primary' onClick={() => setApproveOpen(true)}>
                                            Approve
                                        </Button>
                                        <Button danger onClick={() => setRejectOpen(true)}>
                                            Reject
                                        </Button>
                                    </>
                                )}
                            </Space>
                        </div>

                        {/* Signatures bottom */}
                        <div
                            style={{ borderTop: '1px solid #eee', margin: '14px 0 10px' }}
                        />
                        <Title level={5} style={{ margin: '0 0 8px' }}>
                            Signatures
                        </Title>
                        <Row gutter={24}>
                            <Col span={12}>
                                {(() => {
                                    const first = (activePack.interventions ||
                                        activePack.interventionsSnapshot ||
                                        [])[0] as MovDoc | undefined
                                    const smmeName =
                                        first?.smmeName || first?.smmeCompanyName || '—'
                                    const smmeSig = first?.smmeSignatureUrl
                                    const smmeCrypto = first?.smmeDigitalSignature
                                    return (
                                        <div>
                                            <div style={{ marginBottom: 4 }}>
                                                <Text strong>Client (SMME) Name: </Text>
                                                <Text>{smmeName}</Text>
                                            </div>
                                            <div style={{ marginBottom: 4 }}>
                                                <Text strong>Signature: </Text>
                                                {smmeSig ? (
                                                    <img
                                                        src={smmeSig}
                                                        alt='SMME signature'
                                                        style={{
                                                            height: 48,
                                                            border: '1px dashed #ddd',
                                                            padding: 4
                                                        }}
                                                    />
                                                ) : (
                                                    <em>—</em>
                                                )}
                                            </div>
                                            <div style={{ color: '#888' }}>
                                                Cryptographic: {clip(smmeCrypto)}
                                            </div>
                                        </div>
                                    )
                                })()}
                            </Col>
                            <Col span={12}>
                                <div>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text strong>HOD Name: </Text>
                                        <Text>{activePack.hodName || '—'}</Text>
                                    </div>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text strong>Signature: </Text>
                                        {activePack.hodSignatureUrl ? (
                                            <img
                                                src={activePack.hodSignatureUrl}
                                                alt='HOD signature'
                                                style={{
                                                    height: 48,
                                                    border: '1px dashed #ddd',
                                                    padding: 4
                                                }}
                                            />
                                        ) : (
                                            <em>—</em>
                                        )}
                                    </div>
                                    <div style={{ color: '#888' }}>
                                        Cryptographic: {clip(activePack.hodDigitalSignature)}
                                    </div>
                                </div>
                            </Col>
                        </Row>
                    </div>
                )}
            </Modal>

            {/* INVOICE VIEWER MODAL */}
            <Modal
                open={invoiceModalOpen}
                onCancel={() => setInvoiceModalOpen(false)}
                footer={null}
                width={900}
                title='Invoice'
                bodyStyle={{ padding: 0 }}
            >
                {activePack &&
                    (() => {
                        const inv = activePack.invoiceAttachment
                        const url = typeof inv === 'string' ? inv : inv?.url
                        if (!url)
                            return (
                                <div style={{ padding: 16 }}>
                                    <em>No invoice</em>
                                </div>
                            )
                        if (isPdf(url))
                            return (
                                <embed
                                    src={url}
                                    type='application/pdf'
                                    style={{ width: '100%', height: 600, border: 0 }}
                                />
                            )
                        if (isImage(url))
                            return (
                                <img
                                    src={url}
                                    alt='Invoice'
                                    style={{
                                        width: '100%',
                                        maxHeight: 600,
                                        objectFit: 'contain'
                                    }}
                                />
                            )
                        return (
                            <div style={{ padding: 16 }}>
                                <a href={url} target='_blank' rel='noreferrer'>
                                    Open invoice
                                </a>
                            </div>
                        )
                    })()}
            </Modal>

            {/* APPROVE MODAL */}
            <Modal
                open={approveOpen}
                onCancel={() => {
                    setApproveOpen(false)
                    approveForm.resetFields()
                    setPopFile(null)
                }}
                onOk={handleApproveSubmit}
                confirmLoading={approveSubmitting}
                okText='Approve & Save'
                title='Approve Invoice'
            >
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Optionally include payment details and upload Proof of Payment (POP).'
                />
                <Form form={approveForm} layout='vertical'>
                    <Form.Item name='amount' label='Amount (optional)'>
                        <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
                    </Form.Item>
                    <Form.Item name='paidDate' label='Paid Date (optional)'>
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name='notes' label='Notes (optional)'>
                        <TextArea rows={3} />
                    </Form.Item>
                    <Form.Item label='Upload POP (optional)'>
                        <Upload
                            beforeUpload={file => {
                                setPopFile(file)
                                return false
                            }}
                            maxCount={1}
                            accept='.pdf,.png,.jpg,.jpeg,.webp'
                        >
                            <Button>Choose File</Button>
                        </Upload>
                        {popFile && (
                            <div style={{ marginTop: 6 }}>
                                <Tag color='blue'>{popFile.name}</Tag>
                            </div>
                        )}
                    </Form.Item>
                </Form>
            </Modal>

            {/* REJECT MODAL */}
            <Modal
                open={rejectOpen}
                onCancel={() => {
                    setRejectOpen(false)
                    rejectForm.resetFields()
                }}
                onOk={handleRejectSubmit}
                confirmLoading={rejectSubmitting}
                okText='Reject & Save'
                okButtonProps={{ danger: true }}
                title='Reject Invoice'
            >
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Provide a reason for rejection. This will be stored with the invoice record.'
                />
                <Form form={rejectForm} layout='vertical'>
                    <Form.Item
                        name='reason'
                        label='Reason'
                        rules={[{ required: true, message: 'Please provide a reason.' }]}
                    >
                        <TextArea rows={4} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default ConsolidatedInvoicePacks
