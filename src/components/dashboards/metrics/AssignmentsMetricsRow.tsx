import React, { useEffect, useMemo, useState } from 'react'
import { Button, Col, Empty, Progress, Row, Space, Spin, Statistic, Typography } from 'antd'
import {
    ArrowRightOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    HomeOutlined,
    PhoneOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { normalizeAppointmentRecord } from '@/services/appointmentService'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

const { Text } = Typography

type DateRangeValue = [Dayjs | null, Dayjs | null] | null

type Props = {
    dateRange?: [Dayjs | null, Dayjs | null] | null
    departmentId?: string
}

type AppointmentRow = {
    id: string
    programId?: string
    date?: string
    startTime?: any
    endTime?: any
    status?: string
    deliveryMethod?: string
}

const DELIVERY_METHODS = [
    {
        key: 'in_person',
        label: 'In-person',
        icon: <HomeOutlined />,
        color: '#1677ff'
    },
    {
        key: 'virtual',
        label: 'Online',
        icon: <VideoCameraOutlined />,
        color: '#52c41a'
    },
    {
        key: 'telephonically',
        label: 'Telephonic',
        icon: <PhoneOutlined />,
        color: '#fa8c16'
    }
]

const toDayjs = (value: any): Dayjs | null => {
    if (!value) return null

    if (dayjs.isDayjs(value)) return value

    if (typeof value?.toDate === 'function') {
        const d = dayjs(value.toDate())
        return d.isValid() ? d : null
    }

    const d = dayjs(value)
    return d.isValid() ? d : null
}

const formatTime = (value: any) => {
    const d = toDayjs(value)
    return d?.isValid() ? d.format('HH:mm') : ''
}

const getAppointmentEnd = (appointment: AppointmentRow) => {
    const date = String(appointment.date || '').trim()
    if (!date) return null

    const endTime = formatTime(appointment.endTime)
    const startTime = formatTime(appointment.startTime)

    const candidate = dayjs(
        `${date} ${endTime || startTime || '23:59'}`,
        'YYYY-MM-DD HH:mm'
    )

    return candidate.isValid() ? candidate : dayjs(date).endOf('day')
}

const getDeliveryKey = (value?: string) => {
    const raw = String(value || '').trim().toLowerCase()

    if (['in-person', 'in_person', 'in person'].includes(raw)) return 'in_person'
    if (['online', 'virtual', 'zoom', 'teams'].includes(raw)) return 'virtual'
    if (['telephonic', 'telephonically', 'phone', 'call'].includes(raw)) return 'telephonically'

    return raw || 'unspecified'
}

const AppointmentsDistributionCard: React.FC<Props> = ({ dateRange, departmentId }) => {
    const navigate = useNavigate()
    const { user } = useFullIdentity() as { user?: any }
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [appointments, setAppointments] = useState<AppointmentRow[]>([])

    useEffect(() => {
        if (!user) {
            setAppointments([])
            setLoading(false)
            return
        }

        setLoading(true)

        const constraints: any[] = []

        if (departmentId && departmentId !== 'all') {
            constraints.push(where('departmentId', '==', departmentId))
        }

        if (!isAllPrograms && activeProgramId) {
            constraints.push(where('programId', '==', activeProgramId))
        }

        const unsub = onSnapshot(
            query(collection(db, 'appointments'), ...constraints),
            async (snap) => {
                try {
                    const hydrated = await hydrateAppointmentViews(
                        snap.docs.map((d) => ({ id: d.id, data: d.data() as any }))
                    )
                    setAppointments(hydrated.map((row) => normalizeAppointmentRecord(row.id, row) as AppointmentRow))
                } finally {
                    setLoading(false)
                }
            },
            (error) => {
                console.error('Failed to load appointment distribution:', error)
                setAppointments([])
                setLoading(false)
            }
        )

        return () => unsub()
    }, [user, departmentId, activeProgramId, isAllPrograms])

    const stats = useMemo(() => {
        const [start, end] = dateRange || []

        const scoped = appointments.filter((appointment) => {
            const apptEnd = getAppointmentEnd(appointment)
            const apptDate = appointment.date ? dayjs(appointment.date, 'YYYY-MM-DD') : apptEnd

            if (!apptDate?.isValid()) return false

            if (start && apptDate.isBefore(start.startOf('day'))) return false
            if (end && apptDate.isAfter(end.endOf('day'))) return false

            return true
        })

        const nonCancelled = scoped.filter(
            (appointment) => String(appointment.status || '').toLowerCase() !== 'cancelled'
        )

        const completed = nonCancelled.filter((appointment) => {
            const apptEnd = getAppointmentEnd(appointment)
            return apptEnd ? apptEnd.isBefore(dayjs()) : false
        }).length

        const cancelled = scoped.length - nonCancelled.length
        const scheduled = Math.max(nonCancelled.length - completed, 0)

        const deliveryCounts = new Map<string, number>()

        nonCancelled.forEach((appointment) => {
            const key = getDeliveryKey(appointment.deliveryMethod)
            deliveryCounts.set(key, (deliveryCounts.get(key) || 0) + 1)
        })

        const deliveryBreakdown = DELIVERY_METHODS.map((method) => {
            const value = deliveryCounts.get(method.key) || 0
            const percent = nonCancelled.length
                ? Math.round((value / nonCancelled.length) * 100)
                : 0

            return {
                ...method,
                value,
                percent
            }
        })

        return {
            total: scoped.length,
            completed,
            scheduled,
            cancelled,
            completionPercent: nonCancelled.length
                ? Math.round((completed / nonCancelled.length) * 100)
                : 0,
            deliveryBreakdown
        }
    }, [appointments, dateRange])

    return (
        <MotionCard
            title={
                <Space>
                    <CalendarOutlined />
                    <span>Appointments Distribution</span>
                </Space>
            }
            extra={
                <Button
                    variant='filled'
                    color='geekblue'
                    style={{ border: '1px solid dodgerblue' }}
                    shape='round'
                    icon={<ArrowRightOutlined />}
                    onClick={() => navigate('/consultants/appointments')}
                >
                    View All
                </Button>
            }
        >
            <Spin spinning={loading}>
                {stats.total ? (
                    <Space direction='vertical' size={16} style={{ width: '100%' }}>
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                                gap: 12,
                                width: '100%'
                            }}
                        >
                            {[
                                {
                                    title: 'Appointments',
                                    value: stats.total,
                                    icon: <CalendarOutlined style={{ color: '#1677ff' }} />,
                                    iconBg: 'rgba(22,119,255,0.12)',
                                    border: '#dbeafe',
                                    bg: 'linear-gradient(135deg,#eff6ff 0%,#ffffff 100%)'
                                },
                                {
                                    title: 'Completed',
                                    value: stats.completed,
                                    icon: <CheckCircleOutlined style={{ color: '#16a34a' }} />,
                                    iconBg: 'rgba(22,163,74,0.12)',
                                    border: '#dcfce7',
                                    bg: 'linear-gradient(135deg,#f0fdf4 0%,#ffffff 100%)'
                                },
                                {
                                    title: 'Scheduled',
                                    value: stats.scheduled,
                                    icon: <ClockCircleOutlined style={{ color: '#d97706' }} />,
                                    iconBg: 'rgba(217,119,6,0.12)',
                                    border: '#fef3c7',
                                    bg: 'linear-gradient(135deg,#fffbeb 0%,#ffffff 100%)'
                                },
                                {
                                    title: 'Cancelled',
                                    value: stats.cancelled,
                                    icon: <CloseCircleOutlined style={{ color: '#dc2626' }} />,
                                    iconBg: 'rgba(220,38,38,0.12)',
                                    border: '#fecaca',
                                    bg: 'linear-gradient(135deg,#fef2f2 0%,#ffffff 100%)'
                                }
                            ].map(item => (
                                <MotionCard
                                    key={item.title}
                                    bodyStyle={{ padding: 14 }}
                                    style={{
                                        borderRadius: 16,
                                        border: `1px solid ${item.border}`,
                                        background: item.bg,
                                        minWidth: 0
                                    }}
                                >
                                    <Space align='center' size={12} style={{ width: '100%' }}>
                                        <MotionCard.IconChip
                                            icon={item.icon}
                                            bg={item.iconBg}
                                            size={44}
                                            radius={14}
                                        />

                                        <div style={{ minWidth: 0 }}>
                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                {item.title}
                                            </Text>

                                            <div
                                                style={{
                                                    fontSize: 24,
                                                    fontWeight: 800,
                                                    lineHeight: 1.1
                                                }}
                                            >
                                                {item.value}
                                            </div>
                                        </div>
                                    </Space>
                                </MotionCard>
                            ))}
                        </div>

                        <div>
                            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <Text strong>Completion</Text>
                                <Text type='secondary'>{stats.completionPercent}%</Text>
                            </Space>

                            <Progress
                                percent={stats.completionPercent}
                                showInfo={false}
                                strokeColor='#52c41a'
                            />
                        </div>

                        <Space direction='vertical' size={12} style={{ width: '100%' }}>
                            {stats.deliveryBreakdown.map((item) => (
                                <div key={item.key}>
                                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                        <Text>
                                            {item.icon} {item.label}
                                        </Text>
                                        <Text type='secondary'>
                                            {item.value} • {item.percent}%
                                        </Text>
                                    </Space>

                                    <Progress
                                        percent={item.percent}
                                        showInfo={false}
                                        strokeColor={item.color}
                                    />
                                </div>
                            ))}
                        </Space>
                    </Space>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description='No appointments found'
                    />
                )}
            </Spin>
        </MotionCard>
    )
}

export default AppointmentsDistributionCard
