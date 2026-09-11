import React, { useEffect, useMemo, useState } from 'react'
import { Card, Col, Row, Spin, Statistic, Table, Tag } from 'antd'
import {
    EnvironmentOutlined,
    PhoneOutlined,
    UserOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { fetchAppointments } from '@/services/appointmentService'

type DeliveryMethod = 'virtual' | 'in_person' | 'telephonically' | string

interface Appointment {
    id: string
    assigneeName?: string
    participantName: string
    interventionTitle: string
    deliveryMethod: DeliveryMethod
    date: string
    status: string
    programId?: string
    departmentId?: string
}

type Props = {
    departmentId?: string
    programId?: string
    dateRange?: [Dayjs, Dayjs] | null
    pageSize?: number
}

const methodTag = (method: string) => {
    if (method === 'virtual')
        return <Tag color='blue' icon={<VideoCameraOutlined />}>Online</Tag>
    if (method === 'in_person')
        return <Tag color='green' icon={<EnvironmentOutlined />}>In Person</Tag>
    if (method === 'telephonically')
        return <Tag color='orange' icon={<PhoneOutlined />}>Telephonic</Tag>
    return <Tag>{method || '—'}</Tag>
}

const statusTag = (s: string) => {
    if (s === 'completed') return <Tag color='green'>Completed</Tag>
    if (s === 'cancelled') return <Tag color='red'>Cancelled</Tag>
    if (s === 'scheduled') return <Tag color='blue'>Scheduled</Tag>
    return <Tag>{s}</Tag>
}

// const columns = [
//     { title: 'Participant', dataIndex: 'participantName', key: 'participantName', ellipsis: true },
//     { title: 'Facilitator', dataIndex: 'consultantName', key: 'consultantName', ellipsis: true },
//     { title: 'Intervention', dataIndex: 'interventionTitle', key: 'interventionTitle', ellipsis: true },
//     { title: 'Date', dataIndex: 'date', key: 'date', width: 100 },
//     {
//         title: 'Method',
//         dataIndex: 'deliveryMethod',
//         key: 'deliveryMethod',
//         width: 130,
//         render: (m: string) => methodTag(m)
//     },
//     {
//         title: 'Status',
//         dataIndex: 'status',
//         key: 'status',
//         width: 110,
//         render: (s: string) => statusTag(s)
//     }
// ]

const columns = [
    {
        title: 'Participant',
        dataIndex: 'participantName',
        key: 'participantName',
        ellipsis: true
    },
    {
        title: 'Appointment',
        key: 'appointment',
        ellipsis: true,
        render: (_: any, record: Appointment) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 600 }}>
                    {record.interventionTitle || 'Untitled intervention'}
                </span>

                <span
                    style={{
                        color: 'rgba(0,0,0,0.45)',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                    }}
                >
                    <UserOutlined />
                    {record.assigneeName || 'No assignee'}
                </span>
            </div>
        )
    },
    {
        title: 'Date',
        dataIndex: 'date',
        key: 'date',
        width: 100
    },
    {
        title: 'Method',
        dataIndex: 'deliveryMethod',
        key: 'deliveryMethod',
        width: 130,
        render: (m: string) => methodTag(m)
    },
    {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (s: string) => statusTag(s)
    }
]

const AppointmentsCard: React.FC<Props> = ({
    departmentId,
    programId,
    dateRange,
    pageSize = 5
}) => {
    const [loading, setLoading] = useState(true)
    const [appointments, setAppointments] = useState<Appointment[]>([])

    useEffect(() => {
        const fetch = async () => {
            setLoading(true)
            try {
                const rows = await fetchAppointments({ programId, departmentId })
                setAppointments(rows as Appointment[])
            } catch (err) {
                console.error('AppointmentsCard fetch error:', err)
                setAppointments([])
            } finally {
                setLoading(false)
            }
        }
        fetch()
    }, [departmentId, programId])

    const filtered = useMemo(() => {
        if (!dateRange) return appointments
        const [from, to] = dateRange
        const f = from.format('YYYY-MM-DD')
        const t = to.format('YYYY-MM-DD')
        return appointments.filter(a => a.date >= f && a.date <= t)
    }, [appointments, dateRange])

    const onlineCount = filtered.filter(a => a.deliveryMethod === 'virtual').length
    const inPersonCount = filtered.filter(a => a.deliveryMethod === 'in_person').length
    const telephonicCount = filtered.filter(a => a.deliveryMethod === 'telephonically').length

    return (
        <Card
            title='Appointments'
            style={{
                borderRadius: 12,
                border: '1px solid #d6e4ff',
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease'
            }}
        >
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Spin />
                </div>
            ) : (
                <>
                    {/* Delivery method breakdown */}
                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                        <Col xs={24} sm={8}>
                            <Card
                                size='small'
                                style={{
                                    textAlign: 'center',
                                    background: '#e6f4ff',
                                    border: '1px solid #91caff',
                                    borderRadius: 8
                                }}
                            >
                                <Statistic
                                    title={
                                        <span style={{ color: '#1677ff' }}>
                                            <VideoCameraOutlined style={{ marginRight: 4 }} />
                                            Online
                                        </span>
                                    }
                                    value={onlineCount}
                                    valueStyle={{ color: '#1677ff', fontWeight: 700 }}
                                />
                            </Card>
                        </Col>
                        <Col xs={24} sm={8}>
                            <Card
                                size='small'
                                style={{
                                    textAlign: 'center',
                                    background: '#f6ffed',
                                    border: '1px solid #b7eb8f',
                                    borderRadius: 8
                                }}
                            >
                                <Statistic
                                    title={
                                        <span style={{ color: '#52c41a' }}>
                                            <EnvironmentOutlined style={{ marginRight: 4 }} />
                                            In Person
                                        </span>
                                    }
                                    value={inPersonCount}
                                    valueStyle={{ color: '#52c41a', fontWeight: 700 }}
                                />
                            </Card>
                        </Col>
                        <Col xs={24} sm={8}>
                            <Card
                                size='small'
                                style={{
                                    textAlign: 'center',
                                    background: '#fff7e6',
                                    border: '1px solid #ffd591',
                                    borderRadius: 8
                                }}
                            >
                                <Statistic
                                    title={
                                        <span style={{ color: '#fa8c16' }}>
                                            <PhoneOutlined style={{ marginRight: 4 }} />
                                            Telephonic
                                        </span>
                                    }
                                    value={telephonicCount}
                                    valueStyle={{ color: '#fa8c16', fontWeight: 700 }}
                                />
                            </Card>
                        </Col>
                    </Row>

                    <Table
                        rowKey='id'
                        size='small'
                        scroll={{ x: true }}
                        dataSource={filtered}
                        columns={columns as any}
                        pagination={{
                            pageSize,
                            showSizeChanger: false,
                            position: ['bottomCenter']
                        }}
                        locale={{ emptyText: 'No appointments found for this period.' }}
                    />
                </>
            )}
        </Card>
    )
}

export default AppointmentsCard
