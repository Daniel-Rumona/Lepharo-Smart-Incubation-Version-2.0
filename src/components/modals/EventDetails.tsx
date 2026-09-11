import React, { useMemo, useState } from 'react'
import {
    Modal,
    Typography,
    Descriptions,
    Divider,
    Table,
    Tag,
    Space,
    Input,
    Select,
    Row,
    Col,
    Card,
    Button
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    LinkOutlined,
    EnvironmentOutlined,
    InfoCircleOutlined,
    TeamOutlined,
    SearchOutlined,
    FilterOutlined
} from '@ant-design/icons'

const { Text, Paragraph } = Typography
const { Search } = Input

export type Participant = {
    id?: string
    email?: string
    type?: string
    confirmationStatus?: string
}

export type EventDetails = {
    id: string
    title: string
    date?: string
    startTime?: string
    endTime?: string
    type?: string
    format?: string
    location?: string
    link?: string
    description?: string
    participants?: Participant[]
    [key: string]: any
}

type Props = {
    open: boolean
    onClose: () => void
    event?: EventDetails | null
    width?: number
    title?: React.ReactNode
}

const capitalize = (s?: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'

const normalizeStatus = (s?: string) =>
    String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s|_/g, '-')

const statusTag = (s?: string) => {
    const v = normalizeStatus(s)
    if (!v) return <Text type="secondary">—</Text>

    if (['confirmed', 'accepted', 'approved', 'yes'].includes(v)) {
        return <Tag color="green">Accepted</Tag>
    }
    if (['pending', 'awaiting', 'invited', 'requested'].includes(v)) {
        return <Tag color="orange">Pending</Tag>
    }
    if (['declined', 'rejected', 'no'].includes(v)) {
        return <Tag color="red">Declined</Tag>
    }

    return <Tag>{capitalize(s)}</Tag>
}

const getStatusLabel = (s?: string) => {
    const v = normalizeStatus(s)
    if (['confirmed', 'accepted', 'approved', 'yes'].includes(v)) return 'accepted'
    if (['pending', 'awaiting', 'invited', 'requested'].includes(v)) return 'pending'
    if (['declined', 'rejected', 'no'].includes(v)) return 'declined'
    return v || 'unknown'
}

const formatTag = (format?: string) => {
    const value = String(format || '').trim().toLowerCase()
    if (!value) return <Text type="secondary">—</Text>

    if (value === 'virtual') return <Tag color="purple">Virtual</Tag>
    if (value === 'in-person' || value === 'in person') return <Tag color="geekblue">In-person</Tag>
    if (value === 'hybrid') return <Tag color="cyan">Hybrid</Tag>

    return <Tag>{capitalize(format)}</Tag>
}

const typeTag = (type?: string) => {
    if (!type) return <Text type="secondary">—</Text>
    return <Tag color="blue">{capitalize(type)}</Tag>
}

const EventDetailsModal: React.FC<Props> = ({
    open,
    onClose,
    event,
    width = 1040,
    title = 'Event Details'
}) => {
    const [searchText, setSearchText] = useState('')
    const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)

    const participants = useMemo(() => {
        const list = event?.participants || []
        return list.map((p, idx) => ({
            key: p.id || p.email || `p-${idx}`,
            email: p.email || '—',
            confirmationStatus: p.confirmationStatus
        }))
    }, [event?.participants])

    const filteredParticipants = useMemo(() => {
        return participants.filter((p) => {
            const matchesSearch = !searchText
                ? true
                : String(p.email || '')
                    .toLowerCase()
                    .includes(searchText.trim().toLowerCase())

            const normalized = getStatusLabel(p.confirmationStatus)
            const matchesStatus = !statusFilter ? true : normalized === statusFilter

            return matchesSearch && matchesStatus
        })
    }, [participants, searchText, statusFilter])

    const acceptedCount = useMemo(
        () => participants.filter((p) => getStatusLabel(p.confirmationStatus) === 'accepted').length,
        [participants]
    )

    const pendingCount = useMemo(
        () => participants.filter((p) => getStatusLabel(p.confirmationStatus) === 'pending').length,
        [participants]
    )

    const declinedCount = useMemo(
        () => participants.filter((p) => getStatusLabel(p.confirmationStatus) === 'declined').length,
        [participants]
    )

    const columns: ColumnsType<{
        key: string
        email: string
        confirmationStatus?: string
    }> = [
            {
                title: 'Email',
                dataIndex: 'email',
                key: 'email',
                ellipsis: true,
                render: (v: string) => <Text>{v}</Text>
            },
            {
                title: 'Acceptance',
                dataIndex: 'confirmationStatus',
                key: 'confirmationStatus',
                width: 180,
                render: (v?: string) => statusTag(v)
            }
        ]

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            title={title}
            width={width}
            zIndex={2000}
            destroyOnClose
            styles={{
                body: {
                    paddingTop: 12
                }
            }}
        >
            {!event ? (
                <Text type="secondary">Loading…</Text>
            ) : (
                <>
                    <Descriptions
                        bordered
                        size="middle"
                        column={{ xs: 1, sm: 1, md: 2, lg: 2 }}
                        labelStyle={{
                            width: 150,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            verticalAlign: 'top'
                        }}
                        contentStyle={{
                            background: '#fff',
                            wordBreak: 'break-word',
                            whiteSpace: 'normal'
                        }}
                    >
                        <Descriptions.Item label={<Space><InfoCircleOutlined />Title</Space>} span={2}>
                            <Text strong>{event.title || '—'}</Text>
                        </Descriptions.Item>

                        <Descriptions.Item label={<Space><CalendarOutlined />Date</Space>}>
                            <Space wrap>
                                <Tag color="gold">{event.date || '—'}</Tag>
                            </Space>
                        </Descriptions.Item>

                        <Descriptions.Item label={<Space><ClockCircleOutlined />Time</Space>}>
                            <Space wrap>
                                <Tag color="volcano">
                                    {event.startTime || '—'}
                                    {event.endTime ? ` - ${event.endTime}` : ''}
                                </Tag>
                            </Space>
                        </Descriptions.Item>

                        <Descriptions.Item label="Type">
                            <Space wrap>{typeTag(event.type)}</Space>
                        </Descriptions.Item>

                        <Descriptions.Item label="Format">
                            <Space wrap>{formatTag(event.format)}</Space>
                        </Descriptions.Item>

                        <Descriptions.Item label={<Space><TeamOutlined />Attendees</Space>}>
                            <Space wrap size="small">
                                <Tag>{participants.length} Total</Tag>
                                <Tag color="green">{acceptedCount} Accepted</Tag>
                                <Tag color="orange">{pendingCount} Pending</Tag>
                                <Tag color="red">{declinedCount} Declined</Tag>
                            </Space>
                        </Descriptions.Item>

                        {event.format?.toLowerCase() === 'in-person' && (
                            <Descriptions.Item
                                label={<Space><EnvironmentOutlined />Location</Space>}
                                span={event.description ? 1 : 2}
                            >
                                <Paragraph style={{ marginBottom: 0 }}>
                                    {event.location || '—'}
                                </Paragraph>
                            </Descriptions.Item>
                        )}

                        {event.format?.toLowerCase() === 'virtual' && (
                            <Descriptions.Item
                                label={<Space><LinkOutlined />Meeting Link</Space>}
                                span={event.description ? 1 : 2}
                            >
                                {event.link ? (
                                    <Button
                                        type="primary"
                                        icon={<LinkOutlined />}
                                        href={event.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Join Meeting
                                    </Button>
                                ) : (
                                    '—'
                                )}
                            </Descriptions.Item>
                        )}

                        <Descriptions.Item label="Description" span={2}>
                            <Paragraph style={{ marginBottom: 0 }}>
                                {event.description || '—'}
                            </Paragraph>
                        </Descriptions.Item>
                    </Descriptions>

                    <Divider style={{ margin: '18px 0 14px' }} />

                    <Card
                        size="small"
                        styles={{
                            body: {
                                paddingBottom: 8
                            }
                        }}
                    >
                        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
                            <Col xs={24} md={14}>
                                <Search
                                    allowClear
                                    placeholder="Search attendee by email"
                                    prefix={<SearchOutlined />}
                                    value={searchText}
                                    onChange={(e) => setSearchText(e.target.value)}
                                />
                            </Col>

                            <Col xs={24} md={10}>
                                <Select
                                    allowClear
                                    style={{ width: '100%' }}
                                    placeholder="Filter by acceptance status"
                                    value={statusFilter}
                                    onChange={(value) => setStatusFilter(value)}
                                    suffixIcon={<FilterOutlined />}
                                    options={[
                                        { label: 'Accepted', value: 'accepted' },
                                        { label: 'Pending', value: 'pending' },
                                        { label: 'Declined', value: 'declined' }
                                    ]}
                                />
                            </Col>
                        </Row>

                        <Table
                            title={() => (
                                <Space>
                                    <TeamOutlined />
                                    <Text strong>Attendees</Text>
                                    <Tag>{filteredParticipants.length}</Tag>
                                </Space>
                            )}
                            columns={columns}
                            dataSource={filteredParticipants}
                            size="small"
                            pagination={{
                                pageSize: 10,
                                showSizeChanger: false
                            }}
                            locale={{ emptyText: 'No attendees found' }}
                            scroll={{ x: 600 }}
                        />
                    </Card>
                </>
            )}
        </Modal>
    )
}

export default EventDetailsModal
