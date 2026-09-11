import React from 'react'
import {
    Card,
    Empty,
    Timeline,
    Space,
    Tag,
    Typography,
    Button,
    Spin
} from 'antd'
import {
    CalendarOutlined,
    ExclamationCircleOutlined,
    ScheduleOutlined,
    EnvironmentOutlined,
    LinkOutlined,
    TeamOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { db } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    DocumentData
} from 'firebase/firestore'

dayjs.extend(isBetween)
const { Text } = Typography

export type UpcomingEvent = {
    id: string
    title: string
    // can be Firestore Timestamp | Date | string
    time?: any
    // structured variants:
    date?: string // 'YYYY-MM-DD' (or ISO)
    start?: string | Date // ISO or Date
    end?: string | Date
    startTime?: string // 'HH:mm' (24h). If you store '8:30 AM', either convert to 24h or use custom parsing.
    endTime?: string
    type?: 'meeting' | 'deadline' | 'event' | string
    format?: 'virtual' | 'in-person' | string
    link?: string
    location?: string
    departmentId?: string
    department?: string
    departmentName?: string
    [k: string]: any
}

type Props = {
    departmentId?: string | null
    title?: React.ReactNode
    daysAhead?: number
    limit?: number
    onAdd?: () => void
    onViewCalendar?: () => void
    onEventClick?: (ev: UpcomingEvent) => void
    extra?: React.ReactNode
    userEmail?: string
}

/* ---------------- NEW: robust datetime resolver ---------------- */
const resolveStart = (ev: UpcomingEvent) => {
    if (ev?.time?.toDate) return dayjs(ev.time.toDate()) // Firestore Timestamp
    if (ev?.time) return dayjs(ev.time) // Date | ISO
    if (ev?.start) return dayjs(ev.start) // Date | ISO
    if (ev?.date && ev?.startTime) return dayjs(`${ev.date}T${ev.startTime}`) // 'YYYY-MM-DD' + 'HH:mm'
    if (ev?.date) return dayjs(ev.date) // date-only
    return null
}
const timeLabel = (ev: UpcomingEvent) => {
    if (ev.startTime) return ev.startTime
    const d = resolveStart(ev)
    return d?.isValid() ? d.format('HH:mm') : ''
}
/* --------------------------------------------------------------- */

const iconFor = (type?: string) => {
    if (type === 'meeting')
        return <ScheduleOutlined style={{ color: '#1890ff' }} />
    if (type === 'deadline')
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
    if (type === 'event') return <CalendarOutlined style={{ color: '#52c41a' }} />
    return <CalendarOutlined style={{ color: '#1890ff' }} />
}

const UpcomingEventsCard: React.FC<Props> = ({
    departmentId,
    title = (
        <Space>
            <CalendarOutlined />
            <span>Upcoming Week — Events</span>
        </Space>
    ),
    daysAhead = 7,
    limit = 6,
    onAdd,
    onViewCalendar,
    onEventClick,
    extra,
    userEmail
}) => {
    const [loading, setLoading] = React.useState(false)
    const [events, setEvents] = React.useState<UpcomingEvent[]>([])
    const [deptMap, setDeptMap] = React.useState<Record<string, string>>({})

    // departments map
    React.useEffect(() => {
        const run = async () => {
            setLoading(true)
            try {
                const depSnap = await getDocs(
                    query(
                        collection(db, 'departments'),
                    )
                )
                const map: Record<string, string> = {}
                depSnap.docs.forEach(d => {
                    const data = d.data() as any
                    map[d.id] = data.name || data.departmentName || 'Unspecified'
                })
                setDeptMap(map)
            } finally {
                setLoading(false)
            }
        }

    }, [])

    // load events (optionally by department)
    React.useEffect(() => {
        const run = async () => {

            setLoading(true)
            try {
                const base: any[] = []
                if (departmentId) base.push(where('departmentId', '==', departmentId))

                const evSnap = await getDocs(query(collection(db, 'events'), ...base))
                const rows: UpcomingEvent[] = evSnap.docs.map(d => {
                    const data = d.data() as DocumentData
                    return { id: d.id, ...data }
                })

                // filter to events involving this user (if provided)
                const email = (userEmail || '').trim().toLowerCase()
                const mine = !email
                    ? rows
                    : rows.filter(e => {
                        const inObjArray = (e.participants || []).some(
                            (p: any) => (p?.email || '').trim().toLowerCase() === email
                        )
                        const inFlatArray = [
                            ...(e.participantsEmails || []),
                            ...(e.invitedEmails || [])
                        ]
                            .map((x: any) => (x || '').toLowerCase())
                            .includes(email)
                        const isOrganizer =
                            (
                                (e.organizerEmail || e.createdBy || e.ownerEmail || '') + ''
                            ).toLowerCase() === email
                        return inObjArray || inFlatArray || isOrganizer
                    })

                // window filter + sort + limit
                const now = dayjs()
                const to = now.add(daysAhead, 'day')
                const upcoming = mine
                    .filter(e => {
                        const t = resolveStart(e) // ← use new resolver
                        return (
                            !!t &&
                            t.isBetween(now.startOf('day'), to.endOf('day'), 'day', '[]')
                        )
                    })
                    .sort(
                        (a, b) =>
                            (resolveStart(a)?.valueOf() || 0) -
                            (resolveStart(b)?.valueOf() || 0)
                    )
                    .slice(0, limit)

                // attach department name
                const withDept = upcoming.map(e => ({
                    ...e,
                    departmentName:
                        (e.departmentId && deptMap[e.departmentId]) ||
                        e.departmentName ||
                        e.department ||
                        '—'
                }))

                setEvents(withDept)
            } catch (err) {
                console.error('Error loading events', err)
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [departmentId, daysAhead, limit, deptMap, userEmail])

    const headerExtra =
        extra ??
        (onAdd ? (
            <Button type='primary' size='small' onClick={onAdd}>
                Add Event
            </Button>
        ) : null)

    return (
        <Card
            style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 8,
                border: '1px solid #d6e4ff'
            }}
            title={title}
            extra={headerExtra}
        >
            {loading ? (
                <div style={{ textAlign: 'center', padding: 32 }}>
                    <Spin />
                </div>
            ) : events.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='No events in this period.'
                />
            ) : (
                <>
                    <Timeline mode='left'>
                        {events.map(ev => {
                            const dt = resolveStart(ev) // ← use new resolver
                            const dateText = dt?.isValid() ? dt.format('YYYY-MM-DD') : 'N/A'
                            const t = timeLabel(ev) // ← HH:mm or ''
                            const when = t ? `${dateText} ${t}` : dateText

                            const title =
                                ev.title?.length > 60 ? `${ev.title.slice(0, 57)}...` : ev.title
                            const isVirtual = (ev.format || '').toLowerCase() === 'virtual'
                            const hasLink = !!ev.link

                            return (
                                <Timeline.Item key={ev.id} dot={iconFor(ev.type)}>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text strong style={{ fontSize: 16 }}>
                                            {title || 'Untitled Event'}
                                        </Text>
                                    </div>
                                    <div style={{ marginBottom: 4 }}>
                                        <Text type='secondary'>🕒 {when}</Text>
                                    </div>
                                    <Space size='small' wrap>
                                        {ev.type && (
                                            <Tag
                                                color={
                                                    ev.type === 'meeting'
                                                        ? 'blue'
                                                        : ev.type === 'deadline'
                                                            ? 'red'
                                                            : ev.type === 'event'
                                                                ? 'green'
                                                                : 'purple'
                                                }
                                            >
                                                {ev.type.charAt(0).toUpperCase() + ev.type.slice(1)}
                                            </Tag>
                                        )}

                                        {isVirtual && hasLink ? (
                                            <a
                                                href={ev.link!}
                                                target='_blank'
                                                rel='noreferrer'
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 6
                                                }}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <LinkOutlined /> Join Now
                                            </a>
                                        ) : (
                                            ev.location && (
                                                <span
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 6
                                                    }}
                                                >
                                                    <EnvironmentOutlined />
                                                    <Text>{ev.location}</Text>
                                                </span>
                                            )
                                        )}

                                        <Tag icon={<TeamOutlined />} color='geekblue'>
                                            {ev.departmentName || '—'}
                                        </Tag>

                                        <Button
                                            size='small'
                                            type='link'
                                            onClick={() => onEventClick?.(ev)}
                                            style={{ paddingLeft: 0 }}
                                        >
                                            Details
                                        </Button>
                                    </Space>
                                </Timeline.Item>
                            )
                        })}
                    </Timeline>

                    {onViewCalendar && (
                        <Button type='link' style={{ padding: 0 }} onClick={onViewCalendar}>
                            View Full Calendar
                        </Button>
                    )}
                </>
            )}
        </Card>
    )
}

export default UpcomingEventsCard
