import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    App,
    Avatar,
    Button,
    Card,
    DatePicker,
    Descriptions,
    Empty,
    Modal,
    Result,
    Skeleton,
    Space,
    Tag,
    Typography
} from 'antd'
import {
    CalendarOutlined,
    LeftOutlined,
    RightOutlined,
    TeamOutlined
} from '@ant-design/icons'
import {
    collection,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { type LeaveRequest, typeLabel } from './types'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const LEAVE_REQUESTS_COLLECTION = 'leaveRequests'
const LEAVE_BLACKOUTS_COLLECTION = 'leaveBlackoutDates'

type CalendarRange = [Dayjs, Dayjs]

type FirestoreDateLike =
    | string
    | Date
    | {
        toDate?: () => Date
        seconds?: number
    }
    | null
    | undefined

// ---------------------------------------------------------------------------
// Date helpers (unchanged logic from the original implementation)
// ---------------------------------------------------------------------------

const normalizeDate = (
    value: FirestoreDateLike
): Dayjs | null => {
    if (!value) return null

    if (dayjs.isDayjs(value)) {
        return value
    }

    if (value instanceof Date) {
        const parsed = dayjs(value)
        return parsed.isValid() ? parsed : null
    }

    if (typeof value === 'string') {
        const parsed = dayjs(value)
        return parsed.isValid() ? parsed : null
    }

    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            const parsed = dayjs(value.toDate())
            return parsed.isValid() ? parsed : null
        }

        if (typeof value.seconds === 'number') {
            const parsed = dayjs(value.seconds * 1000)
            return parsed.isValid() ? parsed : null
        }
    }

    return null
}

const normalizeDateKey = (
    value: FirestoreDateLike
): string | null => {
    const parsed = normalizeDate(value)
    return parsed?.isValid()
        ? parsed.format('YYYY-MM-DD')
        : null
}

const normalizeLeaveRequest = (
    id: string,
    data: Record<string, unknown>
): LeaveRequest | null => {
    const from = normalizeDateKey(
        data.from as FirestoreDateLike
    )

    const to = normalizeDateKey(
        data.to as FirestoreDateLike
    )

    if (!from || !to) return null

    return {
        ...data,
        id,
        from,
        to
    } as LeaveRequest
}

const extractBlackoutDates = (
    id: string,
    data: Record<string, unknown>
): string[] => {
    const candidates: FirestoreDateLike[] = []

    if (Array.isArray(data.dates)) {
        candidates.push(
            ...(data.dates as FirestoreDateLike[])
        )
    }

    if (data.date) {
        candidates.push(data.date as FirestoreDateLike)
    }

    if (data.day) {
        candidates.push(data.day as FirestoreDateLike)
    }

    if (
        candidates.length === 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(id)
    ) {
        candidates.push(id)
    }

    return candidates
        .map(normalizeDateKey)
        .filter((date): date is string => Boolean(date))
}

const requestOverlapsRange = (
    request: LeaveRequest,
    range: CalendarRange
) => {
    const from = dayjs(request.from)
    const to = dayjs(request.to)

    if (!from.isValid() || !to.isValid()) {
        return false
    }

    const rangeStart = range[0].startOf('day').valueOf()
    const rangeEnd = range[1].endOf('day').valueOf()

    return (
        from.startOf('day').valueOf() <= rangeEnd &&
        to.endOf('day').valueOf() >= rangeStart
    )
}

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

// A leave-type gets a consistent colour, first from a curated map of common
// leave types, falling back to a deterministic hash across a small palette
// so any custom/unknown type still reads distinctly (but repeatably).
const TYPE_COLOR_MAP: Record<string, string> = {
    annual: '#2f6fed',
    sick: '#e5484d',
    family: '#16a34a',
    study: '#f59e0b',
    maternity: '#ec4899',
    parental: '#0891b2',
    personal: '#8b5cf6' // legacy safety, matches types.ts comment
}

const FALLBACK_PALETTE = [
    '#2f6fed', '#e5484d', '#8b5cf6', '#0891b2',
    '#f59e0b', '#ec4899', '#16a34a', '#64748b'
]

const hashString = (value: string) => {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

const getTypeColor = (type?: string): string => {
    const key = String(type || '').toLowerCase()
    if (TYPE_COLOR_MAP[key]) return TYPE_COLOR_MAP[key]
    return FALLBACK_PALETTE[
        hashString(key) % FALLBACK_PALETTE.length
    ]
}

const getStatusTagColor = (
    status?: string
): string => {
    switch (String(status || '').toLowerCase()) {
        case 'approved':
            return 'success'
        case 'rejected':
            return 'error'
        default:
            return 'processing' // pending
    }
}

const getInitials = (name?: string): string => {
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    const initials = parts
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() ?? '')
        .join('')
    return initials || '?'
}

const WEEKDAY_LABELS = [
    'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
]

// Small, scoped styles for interactions that are awkward to express as
// inline styles (hover states, focus rings, the blackout stripe texture).
const CALENDAR_STYLES = `
.lc-cell { transition: background-color .15s ease; }
.lc-cell:hover { background-color: rgba(15, 23, 42, 0.025); }
.lc-blackout { background-image: repeating-linear-gradient(45deg, rgba(229,72,77,0.08) 0, rgba(229,72,77,0.08) 6px, transparent 6px, transparent 13px); }
.lc-chip { display:flex; align-items:center; gap:6px; padding:3px 7px 3px 6px; border-radius:6px; border-left:3px solid; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,0.08); cursor:pointer; transition: transform .12s ease, box-shadow .12s ease; }
.lc-chip:hover { transform: translateY(-1px); box-shadow:0 3px 9px rgba(15,23,42,0.14); }
.lc-chip:focus-visible { outline:2px solid #2f6fed; outline-offset:2px; }
.lc-today-dot { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 4px; border-radius:11px; background:#2f6fed; color:#fff; font-weight:600; font-size:12px; }
.lc-agenda-row:hover { background-color: rgba(15,23,42,0.02); }
`

export const LeaveCalendar: React.FC = () => {
    const { message } = App.useApp()

    const {
        user,
        loading: identityLoading
    } = useFullIdentity()

    const currentMonth = dayjs().startOf('month')

    const [cursor, setCursor] =
        useState<Dayjs>(currentMonth)

    const [range, setRange] =
        useState<CalendarRange>([
            currentMonth.startOf('month'),
            currentMonth.endOf('month')
        ])

    const [requests, setRequests] =
        useState<LeaveRequest[]>([])

    const [blackoutDates, setBlackoutDates] =
        useState<string[]>([])

    const [requestsLoading, setRequestsLoading] =
        useState(true)

    const [blackoutsLoading, setBlackoutsLoading] =
        useState(true)

    const [loadError, setLoadError] =
        useState<string | null>(null)

    const [selectedRequest, setSelectedRequest] =
        useState<LeaveRequest | null>(null)

    const [isCompact, setIsCompact] =
        useState(false)

    // Track viewport so narrow screens get a scannable agenda list instead
    // of a squeezed 7-column grid.
    useEffect(() => {
        if (typeof window === 'undefined') return

        const mediaQuery = window.matchMedia(
            '(max-width: 640px)'
        )

        const handleChange = () =>
            setIsCompact(mediaQuery.matches)

        handleChange()
        mediaQuery.addEventListener(
            'change',
            handleChange
        )

        return () =>
            mediaQuery.removeEventListener(
                'change',
                handleChange
            )
    }, [])

    useEffect(() => {
        if (identityLoading) return

        setLoadError(null)
        setRequestsLoading(true)
        setBlackoutsLoading(true)

        const requestsQuery = query(
            collection(
                db,
                LEAVE_REQUESTS_COLLECTION
            )
        )

        const blackoutsQuery = query(
            collection(
                db,
                LEAVE_BLACKOUTS_COLLECTION
            )
        )

        const unsubscribeRequests = onSnapshot(
            requestsQuery,
            snapshot => {
                const rows = snapshot.docs
                    .map(document =>
                        normalizeLeaveRequest(
                            document.id,
                            document.data()
                        )
                    )
                    .filter(
                        (
                            request
                        ): request is LeaveRequest =>
                            Boolean(request)
                    )

                rows.sort((a, b) => {
                    return (
                        dayjs(a.from).valueOf() -
                        dayjs(b.from).valueOf()
                    )
                })

                setRequests(rows)
                setRequestsLoading(false)
            },
            error => {
                console.error(
                    'Failed to load leave requests:',
                    error
                )

                setLoadError(
                    'Leave requests could not be loaded.'
                )

                setRequestsLoading(false)
                message.error(
                    'Failed to load leave requests'
                )
            }
        )

        const unsubscribeBlackouts = onSnapshot(
            blackoutsQuery,
            snapshot => {
                const dates = Array.from(
                    new Set(
                        snapshot.docs.flatMap(document =>
                            extractBlackoutDates(
                                document.id,
                                document.data()
                            )
                        )
                    )
                ).sort()

                setBlackoutDates(dates)
                setBlackoutsLoading(false)
            },
            error => {
                console.error(
                    'Failed to load blackout dates:',
                    error
                )

                setLoadError(
                    current =>
                        current ||
                        'Blackout dates could not be loaded.'
                )

                setBlackoutsLoading(false)
            }
        )

        return () => {
            unsubscribeRequests()
            unsubscribeBlackouts()
        }
    }, [
        identityLoading,
        message
    ])

    const loading =
        identityLoading ||
        requestsLoading ||
        blackoutsLoading

    const daysInView = useMemo(() => {
        const startOfGrid = cursor
            .startOf('month')
            .startOf('week')

        return Array.from(
            { length: 42 },
            (_, index) =>
                startOfGrid.add(index, 'day')
        )
    }, [cursor])

    const approvedRequests = useMemo(
        () => requests.filter(
            request => request.status === 'approved'
        ),
        [requests]
    )

    const filteredRequests = useMemo(() => {
        return approvedRequests.filter(request =>
            requestOverlapsRange(
                request,
                range
            )
        )
    }, [approvedRequests, range])

    const eventsByDay = useMemo(() => {
        const map: Record<
            string,
            LeaveRequest[]
        > = {}

        filteredRequests.forEach(request => {
            let current = dayjs(request.from).startOf('day')
            const end = dayjs(request.to).startOf('day')

            if (
                !current.isValid() ||
                !end.isValid() ||
                current.valueOf() > end.valueOf()
            ) {
                return
            }

            let safetyCounter = 0

            while (
                current.valueOf() <= end.valueOf() &&
                safetyCounter < 730
            ) {
                const key =
                    current.format('YYYY-MM-DD')

                map[key] = [
                    ...(map[key] || []),
                    request
                ]

                current = current.add(1, 'day')
                safetyCounter += 1
            }
        })

        return map
    }, [filteredRequests])

    const blackoutDateSet = useMemo(
        () => new Set(blackoutDates),
        [blackoutDates]
    )

    // Distinct leave types present in the current range, for the legend.
    const visibleTypes = useMemo(() => {
        const seen = new Map<string, string>()

        filteredRequests.forEach(request => {
            const key = String(request.type || 'other')
            if (!seen.has(key)) {
                seen.set(key, typeLabel(request.type))
            }
        })

        return Array.from(seen.entries())
    }, [filteredRequests])

    const onLeaveTodayCount = useMemo(() => {
        const today = dayjs().startOf('day').valueOf()

        return approvedRequests.filter(request => {
            const from = dayjs(request.from).startOf('day').valueOf()
            const to = dayjs(request.to).endOf('day').valueOf()

            return from <= today && to >= today
        }).length
    }, [approvedRequests])

    const moveMonth = (
        direction: -1 | 1
    ) => {
        const nextMonth = cursor
            .add(direction, 'month')
            .startOf('month')

        setCursor(nextMonth)

        setRange([
            nextMonth.startOf('month'),
            nextMonth.endOf('month')
        ])
    }

    const goToToday = () => {
        const today = dayjs()
        const month = today.startOf('month')

        setCursor(month)

        setRange([
            month.startOf('month'),
            month.endOf('month')
        ])
    }

    const handleRangeChange = (
        dates: [
            Dayjs | null,
            Dayjs | null
        ] | null
    ) => {
        const start = dates?.[0]
        const end = dates?.[1]

        if (!start || !end) return

        setRange([start, end])
        setCursor(start.startOf('month'))
    }

    const renderChip = (request: LeaveRequest, key: string) => {
        const typeColor = getTypeColor(request.type)

        return (
            <div
                key={key}
                role='button'
                tabIndex={0}
                aria-label={`${request.employeeName}, ${typeLabel(request.type)}, ${request.status || 'pending'}`}
                onClick={() => setSelectedRequest(request)}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedRequest(request)
                    }
                }}
                className='lc-chip'
                style={{ borderLeftColor: typeColor }}
            >
                <Avatar
                    size={16}
                    src={request.employeePhoto || undefined}
                    style={{
                        backgroundColor: typeColor,
                        fontSize: 9,
                        flexShrink: 0
                    }}
                >
                    {getInitials(request.employeeName)}
                </Avatar>

                <Text
                    ellipsis={{
                        tooltip: `${request.employeeName} · ${typeLabel(request.type)}`
                    }}
                    style={{
                        display: 'block',
                        fontSize: 12,
                        lineHeight: '16px'
                    }}
                >
                    {request.employeeName}
                </Text>
            </div>
        )
    }

    return (
        <div style={{ padding: 24 }}>
            <style>{CALENDAR_STYLES}</style>

            <Card
                styles={{
                    body: {
                        padding: 0
                    }
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        padding: 12,
                        gap: 12,
                        borderBottom:
                            '1px solid #f0f0f0'
                    }}
                >
                    <Button
                        icon={<LeftOutlined />}
                        onClick={() => moveMonth(-1)}
                        aria-label='Previous month'
                    />

                    <Title
                        level={5}
                        style={{
                            margin: 0,
                            minWidth: 140,
                            textAlign: 'center'
                        }}
                    >
                        {cursor.format('MMMM YYYY')}
                    </Title>

                    <Button
                        icon={<RightOutlined />}
                        onClick={() => moveMonth(1)}
                        aria-label='Next month'
                    />

                    <Button
                        icon={<CalendarOutlined />}
                        onClick={goToToday}
                    >
                        Today
                    </Button>

                    {onLeaveTodayCount > 0 && (
                        <Tag
                            icon={<TeamOutlined />}
                            color='blue'
                            style={{
                                margin: 0,
                                borderRadius: 12,
                                padding: '2px 10px'
                            }}
                        >
                            {onLeaveTodayCount} on leave today
                        </Tag>
                    )}

                    <div style={{ flex: 1 }} />

                    <RangePicker
                        value={range}
                        onChange={handleRangeChange}
                        allowClear={false}
                        format='DD MMM YYYY'
                    />
                </div>

                {visibleTypes.length > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 14,
                            padding: '8px 12px',
                            borderBottom: '1px solid #f0f0f0',
                            background: '#fbfbfc'
                        }}
                    >
                        {visibleTypes.map(([key, label]) => (
                            <span
                                key={key}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 12,
                                    color: 'rgba(0,0,0,0.65)'
                                }}
                            >
                                <span
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        background: getTypeColor(key),
                                        display: 'inline-block'
                                    }}
                                />
                                {label}
                            </span>
                        ))}

                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12,
                                color: 'rgba(0,0,0,0.65)'
                            }}
                        >
                            <span
                                className='lc-blackout'
                                style={{
                                    width: 14,
                                    height: 10,
                                    display: 'inline-block',
                                    borderRadius: 2,
                                    border: '1px solid rgba(229,72,77,0.4)'
                                }}
                            />
                            Blackout date
                        </span>
                    </div>
                )}

                {loadError && (
                    <div
                        style={{
                            padding: '12px 12px 0'
                        }}
                    >
                        <Alert
                            type='warning'
                            showIcon
                            message={loadError}
                        />
                    </div>
                )}

                {loading ? (
                    <div style={{ padding: 24 }}>
                        <Skeleton
                            active
                            paragraph={{ rows: 10 }}
                        />
                    </div>
                ) : filteredRequests.length === 0 && blackoutDates.length === 0 ? (
                    <div style={{ padding: '48px 24px' }}>
                        <Empty
                            description={
                                <Space direction='vertical' size={2}>
                                    <Text strong>No leave scheduled</Text>
                                    <Text type='secondary'>
                                        Approved and pending requests for this
                                        period will show up here.
                                    </Text>
                                </Space>
                            }
                        />
                    </div>
                ) : isCompact ? (
                    <div style={{ padding: 8 }}>
                        {daysInView
                            .filter(date => {
                                const key = date.format('YYYY-MM-DD')
                                return (
                                    date.format('YYYY-MM') === cursor.format('YYYY-MM') &&
                                    ((eventsByDay[key] || []).length > 0 || blackoutDateSet.has(key))
                                )
                            })
                            .map(date => {
                                const key = date.format('YYYY-MM-DD')
                                const items = eventsByDay[key] || []
                                const isBlackout = blackoutDateSet.has(key)
                                const isToday = key === dayjs().format('YYYY-MM-DD')

                                return (
                                    <div
                                        key={key}
                                        className='lc-agenda-row'
                                        style={{
                                            display: 'flex',
                                            gap: 12,
                                            padding: '10px 8px',
                                            borderRadius: 8
                                        }}
                                    >
                                        <div
                                            style={{
                                                minWidth: 56,
                                                textAlign: 'center'
                                            }}
                                        >
                                            {isToday ? (
                                                <span className='lc-today-dot'>
                                                    {date.format('D')}
                                                </span>
                                            ) : (
                                                <Text strong>{date.format('ddd D')}</Text>
                                            )}
                                        </div>

                                        <Space direction='vertical' size={4} style={{ flex: 1 }}>
                                            {isBlackout && (
                                                <Tag color='red' style={{ width: 'fit-content' }}>
                                                    Blackout date
                                                </Tag>
                                            )}
                                            {items.map((request, index) =>
                                                renderChip(request, `${request.id}-${index}`)
                                            )}
                                        </Space>
                                    </div>
                                )
                            })}
                    </div>
                ) : (
                    <div
                        style={{
                            width: '100%',
                            overflowX: 'auto'
                        }}
                    >
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns:
                                    'repeat(7, minmax(125px, 1fr))',
                                minWidth: 875
                            }}
                        >
                            {WEEKDAY_LABELS.map(day => (
                                <div
                                    key={day}
                                    style={{
                                        padding: 10,
                                        textAlign: 'center',
                                        fontWeight: 600,
                                        fontSize: 12,
                                        letterSpacing: 0.3,
                                        textTransform: 'uppercase',
                                        color: 'rgba(0,0,0,0.45)',
                                        background:
                                            '#fafafa',
                                        borderRight:
                                            '1px solid #f0f0f0',
                                        borderBottom:
                                            '1px solid #f0f0f0'
                                    }}
                                >
                                    {day}
                                </div>
                            ))}

                            {daysInView.map(date => {
                                const dateKey =
                                    date.format(
                                        'YYYY-MM-DD'
                                    )

                                const items =
                                    eventsByDay[
                                    dateKey
                                    ] || []

                                const isOtherMonth =
                                    date.format(
                                        'YYYY-MM'
                                    ) !==
                                    cursor.format(
                                        'YYYY-MM'
                                    )

                                const isBlackout =
                                    blackoutDateSet.has(
                                        dateKey
                                    )

                                const isToday =
                                    dateKey ===
                                    dayjs().format(
                                        'YYYY-MM-DD'
                                    )

                                return (
                                    <div
                                        key={dateKey}
                                        className={`lc-cell${isBlackout ? ' lc-blackout' : ''}`}
                                        style={{
                                            minHeight: 118,
                                            padding: 8,
                                            borderRight:
                                                '1px solid #f0f0f0',
                                            borderBottom:
                                                '1px solid #f0f0f0',
                                            background:
                                                !isBlackout && isToday
                                                    ? 'rgba(47,111,237,0.04)'
                                                    : undefined,
                                            opacity:
                                                isOtherMonth
                                                    ? 0.45
                                                    : 1
                                        }}
                                    >
                                        <div
                                            style={{
                                                display:
                                                    'flex',
                                                alignItems:
                                                    'center',
                                                justifyContent:
                                                    'space-between',
                                                gap: 6,
                                                marginBottom: 8
                                            }}
                                        >
                                            {isToday ? (
                                                <span className='lc-today-dot'>
                                                    {date.date()}
                                                </span>
                                            ) : (
                                                <Text>
                                                    {date.date()}
                                                </Text>
                                            )}

                                            {isBlackout && (
                                                <Tag
                                                    color='red'
                                                    style={{
                                                        marginInlineEnd: 0,
                                                        fontSize: 11
                                                    }}
                                                >
                                                    Blackout
                                                </Tag>
                                            )}
                                        </div>

                                        <Space
                                            direction='vertical'
                                            size={4}
                                            style={{
                                                width: '100%'
                                            }}
                                        >
                                            {items
                                                .slice(0, 3)
                                                .map((request, index) =>
                                                    renderChip(
                                                        request,
                                                        `${request.id}-${index}`
                                                    )
                                                )}

                                            {items.length > 3 && (
                                                <Tag
                                                    style={{
                                                        width: 'fit-content',
                                                        cursor: 'pointer'
                                                    }}
                                                    onClick={() =>
                                                        setSelectedRequest(items[3])
                                                    }
                                                >
                                                    +{items.length - 3} more
                                                </Tag>
                                            )}
                                        </Space>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </Card>

            <Modal
                title='Leave request'
                open={Boolean(selectedRequest)}
                onCancel={() =>
                    setSelectedRequest(null)
                }
                footer={
                    <Button
                        type='primary'
                        onClick={() =>
                            setSelectedRequest(null)
                        }
                    >
                        Close
                    </Button>
                }
                centered
            >
                {selectedRequest && (
                    <>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                marginBottom: 16
                            }}
                        >
                            <Avatar
                                size={44}
                                src={selectedRequest.employeePhoto || undefined}
                                style={{
                                    backgroundColor: getTypeColor(selectedRequest.type),
                                    fontSize: 16
                                }}
                            >
                                {getInitials(selectedRequest.employeeName)}
                            </Avatar>

                            <div>
                                <Text strong style={{ fontSize: 16, display: 'block' }}>
                                    {selectedRequest.employeeName || 'Not specified'}
                                </Text>

                                <Space size={6} style={{ marginTop: 4 }}>
                                    <Tag
                                        style={{
                                            color: getTypeColor(selectedRequest.type),
                                            borderColor: getTypeColor(selectedRequest.type),
                                            background: 'transparent'
                                        }}
                                    >
                                        {typeLabel(selectedRequest.type)}
                                    </Tag>

                                    <Tag
                                        color={getStatusTagColor(selectedRequest.status)}
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        {selectedRequest.status || 'pending'}
                                    </Tag>
                                </Space>
                            </div>
                        </div>

                        <Descriptions
                            bordered
                            size='small'
                            column={1}
                        >
                            <Descriptions.Item label='From'>
                                {dayjs(
                                    selectedRequest.from
                                ).format('DD MMMM YYYY')}
                            </Descriptions.Item>

                            <Descriptions.Item label='To'>
                                {dayjs(
                                    selectedRequest.to
                                ).format('DD MMMM YYYY')}
                            </Descriptions.Item>

                            <Descriptions.Item label='Duration'>
                                {selectedRequest.days ??
                                    Math.max(
                                        dayjs(selectedRequest.to).diff(
                                            dayjs(selectedRequest.from),
                                            'day'
                                        ) + 1,
                                        1
                                    )}{' '}
                                day(s)
                            </Descriptions.Item>

                            {selectedRequest.reason && (
                                <Descriptions.Item label='Reason'>
                                    {selectedRequest.reason}
                                </Descriptions.Item>
                            )}

                            {selectedRequest.approvedBy && (
                                <Descriptions.Item label='Approved by'>
                                    {selectedRequest.approvedBy}
                                    {selectedRequest.approvedDate
                                        ? ` on ${dayjs(selectedRequest.approvedDate).format('DD MMM YYYY')}`
                                        : ''}
                                </Descriptions.Item>
                            )}
                        </Descriptions>
                    </>
                )}
            </Modal>
        </div>
    )
}

export default LeaveCalendar
