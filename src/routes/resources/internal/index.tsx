import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    DatePicker,
    Descriptions,
    Form,
    Grid,
    Input,
    InputNumber,
    List,
    Modal,
    Result,
    Row,
    Segmented,
    Select,
    Space,
    Tag,
    Timeline,
    Typography,
    message,
    theme
} from 'antd'
import {
    AppstoreOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    FileDoneOutlined,
    PlusOutlined,
    SearchOutlined,
    ShoppingOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { addDoc, collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import {
    InternalRequest,
    StageGroup,
    isAdhoc,
    stageGroup,
    stageInfo,
    toDay
} from '@/lib/internalRequests'
import { ResourceItem } from '@/types/resources'
import OptionCards from '../OptionCards'
import { getTypeIcon } from '../typeIcons'

const { Text } = Typography

type GroupFilter = StageGroup | 'all'

const GROUP_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'rejected', label: 'Rejected' }
]

const KIND_OPTIONS = [
    {
        value: 'resource',
        label: 'Existing resource',
        icon: <AppstoreOutlined />,
        description: 'From the resources list'
    },
    {
        value: 'adhoc',
        label: 'Ad-hoc',
        icon: <ShoppingOutlined />,
        description: 'Catering, one-off services'
    }
]

const formatDay = (value: unknown, format = 'D MMM YYYY') => {
    const d = toDay(value)
    return d ? dayjs(d).format(format) : '—'
}

const InternalResourceRequestView: React.FC = () => {
    const [form] = Form.useForm()
    const { user } = useFullIdentity()
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    const isDesktop = screens.sm !== false
    // Below md, modals become bottom sheets (index.css) and the filter bar stacks
    const isMobile = screens.md === false
    const barCol = (flex: string) => (isMobile ? { span: 24 } : { flex })

    const [requests, setRequests] = useState<InternalRequest[]>([])
    const [resources, setResources] = useState<ResourceItem[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [group, setGroup] = useState<GroupFilter>('all')
    const [viewing, setViewing] = useState<InternalRequest | null>(null)
    const [requestOpen, setRequestOpen] = useState(false)
    const [saving, setSaving] = useState(false)

    const kind: 'resource' | 'adhoc' | undefined = Form.useWatch('kind', form)

    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, 'resources'), snapshot => {
            setResources(
                snapshot.docs
                    .map(d => ({ id: d.id, ...d.data() }) as ResourceItem)
                    .sort((a, b) => a.name.localeCompare(b.name))
            )
        })
        return () => unsubscribe()
    }, [])

    // Only this branch's requests; staff without a branch see none
    const branchId = user?.assignedBranch || ''
    // Internal requests only ever come from a project admin (Center Coordinator)
    // for their branch; anyone else opening this page can only read
    const canRequest = user?.role === 'projectadmin' && !!branchId

    useEffect(() => {
        if (!branchId) {
            setRequests([])
            setLoading(false)
            return
        }
        setLoading(true)
        const unsubscribe = onSnapshot(
            query(
                collection(db, 'resourceRequests'),
                where('requestType', '==', 'internal'),
                where('requestedFrom', '==', branchId)
            ),
            snapshot => {
                setRequests(
                    snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as InternalRequest)
                )
                setLoading(false)
            },
            error => {
                console.error('Failed to load internal requests:', error)
                message.error('Failed to load requests')
                setLoading(false)
            }
        )
        return () => unsubscribe()
    }, [branchId])

    const resourcesById = useMemo(
        () => new Map(resources.map(r => [r.id, r])),
        [resources]
    )

    const counts = useMemo(() => {
        const c = { in_progress: 0, completed: 0, rejected: 0 }
        requests.forEach(r => (c[stageGroup(r.status)] += 1))
        return c
    }, [requests])

    // Newest first
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return requests
            .filter(
                r =>
                    (group === 'all' || stageGroup(r.status) === group) &&
                    (!q ||
                        (r.resourceName || '').toLowerCase().includes(q) ||
                        (r.purpose || '').toLowerCase().includes(q))
            )
            .sort(
                (a, b) =>
                    (toDay(b.createdAt)?.getTime() || 0) - (toDay(a.createdAt)?.getTime() || 0)
            )
    }, [requests, search, group])

    const openRequestForm = () => {
        if (!canRequest) return
        form.resetFields()
        form.setFieldsValue({ kind: 'resource', quantity: 1 })
        setRequestOpen(true)
    }

    const handleSubmit = async () => {
        let values: Record<string, any>
        try {
            values = await form.validateFields()
        } catch {
            return
        }
        const adhoc = values.kind === 'adhoc'
        const resource = adhoc ? undefined : resourcesById.get(values.resourceId)
        const now = Timestamp.now()

        setSaving(true)
        try {
            await addDoc(collection(db, 'resourceRequests'), {
                requestType: 'internal',
                resourceName: adhoc ? values.customResource.trim() : resource?.name || '',
                resourceId: adhoc ? null : values.resourceId,
                quantity: Number(values.quantity) || 1,
                neededBy: values.neededBy.toISOString(),
                purpose: values.purpose.trim(),
                status: 'pending_purchase_approval',
                progress: [{ stage: 'pending_purchase_approval', timestamp: now }],
                createdAt: now,
                // IHF's screens read the role and branch from these
                requestedBy: user?.role || '',
                requestedByName: user?.name || user?.email || '',
                requestedFrom: user?.assignedBranch || ''
            })
            message.success('Request submitted')
            setRequestOpen(false)
        } catch (error) {
            console.error('Failed to submit request:', error)
            message.error('Failed to submit request')
        } finally {
            setSaving(false)
        }
    }

    const iconFor = (request: InternalRequest) => {
        const resource = request.resourceId ? resourcesById.get(request.resourceId) : undefined
        return resource ? getTypeIcon(resource.type) : <ShoppingOutlined />
    }

    const iconCircle = (icon: React.ReactNode, size: number) => (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: size / 2.2,
                flexShrink: 0,
                background: token.colorPrimaryBg,
                color: token.colorPrimary
            }}
        >
            {icon}
        </div>
    )

    const renderCard = (request: InternalRequest) => {
        const stage = stageInfo(request.status)
        return (
            <Card
                size='small'
                hoverable
                style={{ width: '100%', borderRadius: 12 }}
                onClick={() => setViewing(request)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {iconCircle(iconFor(request), 36)}
                    {/* Two lines: what and where it's at, then when and why */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Text strong ellipsis style={{ minWidth: 0 }}>
                                {request.resourceName || 'Unnamed request'}
                            </Text>
                            <Tag color={stage.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                                {stage.label}
                            </Tag>
                            {isAdhoc(request) && (
                                <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>Ad-hoc</Tag>
                            )}
                            {(request.quantity || 0) > 1 && (
                                <Text type='secondary' style={{ fontSize: 12, flexShrink: 0 }}>
                                    ×{request.quantity}
                                </Text>
                            )}
                        </div>
                        <Text
                            type='secondary'
                            style={{ fontSize: 12, display: 'block' }}
                            ellipsis={{ tooltip: request.purpose || undefined }}
                        >
                            <CalendarOutlined style={{ marginRight: 6 }} />
                            Needed by {formatDay(request.neededBy)}
                            {request.purpose && ` · ${request.purpose}`}
                        </Text>
                    </div>
                </div>
            </Card>
        )
    }

    const viewingStage = viewing ? stageInfo(viewing.status) : undefined

    return (
        <div style={{ minHeight: '100vh', padding: isDesktop ? 24 : 12 }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<FileDoneOutlined />}
                        tone='accent'
                        title='Total Requests'
                        value={requests.length}
                        loading={loading}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <MetricTile
                        icon={<ClockCircleOutlined />}
                        tone='warning'
                        title='In Progress'
                        value={counts.in_progress}
                        loading={loading}
                    />
                </Col>
                {/* Two metrics fit side by side on mobile; the outcomes are left out */}
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CheckCircleOutlined />}
                        tone='success'
                        title='Completed'
                        value={counts.completed}
                        loading={loading}
                    />
                </Col>
                <Col xs={0} md={6}>
                    <MetricTile
                        icon={<CloseCircleOutlined />}
                        tone='danger'
                        title='Rejected'
                        value={counts.rejected}
                        loading={loading}
                    />
                </Col>
            </Row>

            <DashboardFilterBar>
                <Row gutter={[12, 12]} align='middle'>
                    <Col {...barCol('2 1 220px')}>
                        <Input
                            placeholder='Search requests...'
                            prefix={<SearchOutlined />}
                            allowClear
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </Col>
                    <Col {...barCol('2 1 360px')}>
                        <Segmented
                            block
                            value={group}
                            onChange={value => setGroup(value as GroupFilter)}
                            options={GROUP_OPTIONS}
                        />
                    </Col>
                    <Col {...barCol('0 1 160px')}>
                        <Button
                            block
                            type='primary'
                            icon={<PlusOutlined />}
                            // A request without a branch would never show up for anyone
                            disabled={!canRequest}
                            onClick={openRequestForm}
                        >
                            Request
                        </Button>
                    </Col>
                </Row>
            </DashboardFilterBar>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <List
                    dataSource={filtered}
                    rowKey='id'
                    loading={loading}
                    split={false}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    locale={{
                        emptyText: !branchId ? (
                            <Result
                                status='warning'
                                title='No branch assigned'
                                subTitle='Internal requests are shared within a branch. Ask an administrator to assign you to one.'
                            />
                        ) : search || group !== 'all' ? (
                                <Result
                                    icon={<SearchOutlined />}
                                    title='No requests found'
                                    subTitle='Nothing matches your search or filter.'
                                    extra={
                                        <Button
                                            onClick={() => {
                                                setSearch('')
                                                setGroup('all')
                                            }}
                                        >
                                            Clear filters
                                        </Button>
                                    }
                                />
                            ) : (
                                <Result
                                    icon={<ShoppingOutlined />}
                                    title='No internal requests yet'
                                    subTitle='Request a resource or a one-off service for your team.'
                                    extra={
                                        canRequest && (
                                        <Button
                                            type='primary'
                                            icon={<PlusOutlined />}
                                            onClick={openRequestForm}
                                        >
                                            Request
                                        </Button>
                                        )
                                    }
                                />
                            )
                    }}
                    renderItem={request => (
                        <List.Item style={{ padding: '6px 0' }}>{renderCard(request)}</List.Item>
                    )}
                />
            </motion.div>

            {/* Read-only details, with the stage history that used to be "Track" */}
            <Modal
                open={!!viewing}
                onCancel={() => setViewing(null)}
                title='Request Details'
                footer={null}
                destroyOnClose
            >
                {viewing && viewingStage && (
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {iconCircle(iconFor(viewing), 44)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Text strong style={{ fontSize: 16, display: 'block' }} ellipsis>
                                    {viewing.resourceName || 'Unnamed request'}
                                </Text>
                                <Text type='secondary'>
                                    {isAdhoc(viewing) ? 'Ad-hoc request' : 'Existing resource'}
                                </Text>
                            </div>
                            <Tag color={viewingStage.color} style={{ marginInlineEnd: 0 }}>
                                {viewingStage.label}
                            </Tag>
                        </div>

                        <Descriptions column={1} size='small' bordered>
                            <Descriptions.Item label='Quantity'>
                                {viewing.quantity || 1}
                            </Descriptions.Item>
                            <Descriptions.Item label='Needed by'>
                                {formatDay(viewing.neededBy)}
                            </Descriptions.Item>
                            <Descriptions.Item label='Purpose'>
                                {viewing.purpose || '—'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Requested'>
                                {formatDay(viewing.createdAt, 'D MMM YYYY, HH:mm')}
                                {viewing.requestedByName && ` by ${viewing.requestedByName}`}
                            </Descriptions.Item>
                            {viewing.status === 'rejected' && (
                                <Descriptions.Item label='Rejection reason'>
                                    <Text type='danger'>{viewing.rejectionReason || 'No reason given'}</Text>
                                </Descriptions.Item>
                            )}
                        </Descriptions>

                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 12 }}>
                                Progress
                            </Text>
                            <Timeline
                                items={(viewing.progress || []).map((entry, i, all) => ({
                                    color:
                                        entry.stage === 'rejected'
                                            ? 'red'
                                            : i === all.length - 1
                                              ? 'blue'
                                              : 'green',
                                    children: (
                                        <div>
                                            <Text strong>{stageInfo(entry.stage).label}</Text>
                                            <div>
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    {formatDay(entry.timestamp, 'D MMM YYYY, HH:mm')}
                                                    {entry.actor && ` · ${entry.actor}`}
                                                </Text>
                                            </div>
                                            {entry.note && (
                                                <Text style={{ fontSize: 12 }}>{entry.note}</Text>
                                            )}
                                        </div>
                                    )
                                }))}
                            />
                        </div>
                    </Space>
                )}
            </Modal>

            <Modal
                open={requestOpen}
                onCancel={() => setRequestOpen(false)}
                title='New Internal Request'
                destroyOnClose
                footer={
                    <Button type='primary' block loading={saving} onClick={handleSubmit}>
                        Submit Request
                    </Button>
                }
            >
                <Form form={form} layout='vertical'>
                    <Form.Item name='kind' label='What do you need?' rules={[{ required: true }]}>
                        <OptionCards indicator options={KIND_OPTIONS} />
                    </Form.Item>

                    {kind === 'adhoc' ? (
                        <Form.Item
                            name='customResource'
                            label='Describe it'
                            rules={[{ required: true, whitespace: true }]}
                        >
                            <Input placeholder='e.g. Catering for 40, tent hire' />
                        </Form.Item>
                    ) : (
                        <Form.Item
                            name='resourceId'
                            label='Resource'
                            rules={[{ required: true }]}
                        >
                            <Select
                                showSearch
                                optionFilterProp='label'
                                placeholder='Select a resource'
                                options={resources.map(r => ({ value: r.id, label: r.name }))}
                            />
                        </Form.Item>
                    )}

                    <Row gutter={12}>
                        <Col xs={24} sm={16}>
                            <Form.Item
                                name='neededBy'
                                label='Needed by'
                                rules={[{ required: true }]}
                            >
                                <DatePicker
                                    style={{ width: '100%' }}
                                    disabledDate={current =>
                                        current && current < dayjs().startOf('day')
                                    }
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                            <Form.Item name='quantity' label='Quantity' rules={[{ required: true }]}>
                                <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name='purpose'
                        label='Purpose'
                        rules={[{ required: true, whitespace: true }]}
                    >
                        <Input.TextArea rows={3} placeholder='Why do you need this?' />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default InternalResourceRequestView
