import React, { useMemo, useState } from 'react'
import {
    Empty,
    Pagination,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme
} from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text } = Typography
const { useToken } = theme

type SubmissionRecord = {
    month?: string
    department?: string
    departmentName?: string
    interventions?: Array<{
        department?: string
        departmentName?: string
    }>
    [key: string]: any
}

type DepartmentMonthlyUploadStatusCardProps = {
    departments: string[]
    submissions: SubmissionRecord[]
    loading?: boolean
    title?: React.ReactNode
    /** Reporting window supplied by the dashboard topbar. */
    dateRange?: [Dayjs, Dayjs] | null
}

type MonthState = {
    key: string
    label: string
    state: 'uploaded' | 'overdue' | 'pending' | 'upcoming'
    days?: number
}

type DepartmentStatus = {
    department: string
    months: MonthState[]
    uploaded: number
    overdue: number
    pending: number
    upcoming: number
    required: number
    maxOverdueDays: number
}

const normalizeText = (value?: string) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')

const normalizeMonth = (value?: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''

    const yyyyMm = raw.match(/^(\d{4})-(\d{2})/)
    if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2]}`

    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('YYYY-MM') : ''
}

const getSubmissionDepartments = (record: SubmissionRecord) => {
    const names = [
        record.department,
        record.departmentName,
        ...(Array.isArray(record.interventions)
            ? record.interventions.flatMap(intervention => [
                intervention?.department,
                intervention?.departmentName
            ])
            : [])
    ]
        .map(value => String(value || '').trim())
        .filter(Boolean)

    return Array.from(new Set(names))
}

const getMonthsInRange = (start: Dayjs, end: Dayjs) => {
    const months: Dayjs[] = []
    let cursor = start.startOf('month')
    const last = end.startOf('month')

    while (cursor.valueOf() <= last.valueOf()) {
        months.push(cursor)
        cursor = cursor.add(1, 'month')
    }

    return months
}

const DepartmentMonthlyUploadStatusCard: React.FC<
    DepartmentMonthlyUploadStatusCardProps
> = ({
    departments,
    submissions,
    loading = false,
    title = (
        <Space size={8}>
            <CalendarOutlined />
            <span>Department Monthly Upload Status</span>
        </Space>
    ),
    dateRange
}) => {
        const { token } = useToken()

        const [page, setPage] = useState(1)
        const PAGE_SIZE = 4

        // An all-time topbar selection intentionally has a bounded monthly
        // presentation: showing every historical month would turn this compact
        // status card into a register. Every explicit topbar range is honoured,
        // including a range that crosses two months.
        const range = useMemo<[Dayjs, Dayjs]>(() => {
            if (dateRange?.[0] && dateRange?.[1]) {
                return [dateRange[0].startOf('month'), dateRange[1].endOf('month')]
            }

            const now = dayjs()
            return [now.startOf('month'), now.endOf('month')]
        }, [dateRange])

        const months = useMemo(
            () => getMonthsInRange(range[0], range[1]),
            [range]
        )

        const uploadedKeys = useMemo(() => {
            const keys = new Set<string>()

            submissions.forEach(submission => {
                const month = normalizeMonth(submission.month)
                if (!month) return

                getSubmissionDepartments(submission).forEach(department => {
                    keys.add(`${normalizeText(department)}::${month}`)
                })
            })

            return keys
        }, [submissions])

        const departmentStatuses = useMemo<DepartmentStatus[]>(() => {
            const now = dayjs().startOf('day')

            return [...new Set(departments.map(name => String(name || '').trim()).filter(Boolean))]
                .map(department => {
                    const normalizedDepartment = normalizeText(department)

                    const monthStates: MonthState[] = months.map(month => {
                        const key = month.format('YYYY-MM')
                        const label = month.format('MMM YYYY')
                        const uploaded = uploadedKeys.has(
                            `${normalizedDepartment}::${key}`
                        )

                        if (uploaded) {
                            return {
                                key,
                                label,
                                state: 'uploaded' as const
                            }
                        }

                        const monthStart = month.startOf('month')
                        const deadline = month.endOf('month').startOf('day')

                        if (monthStart.isAfter(now, 'month')) {
                            return {
                                key,
                                label,
                                state: 'upcoming' as const
                            }
                        }

                        if (monthStart.isSame(now, 'month')) {
                            const daysRemaining = Math.max(
                                0,
                                deadline.diff(now, 'day')
                            )

                            return {
                                key,
                                label,
                                state: 'pending' as const,
                                days: daysRemaining
                            }
                        }

                        const overdueDays = Math.max(
                            1,
                            now.diff(deadline, 'day')
                        )

                        return {
                            key,
                            label,
                            state: 'overdue' as const,
                            days: overdueDays
                        }
                    })

                    const uploaded = monthStates.filter(
                        month => month.state === 'uploaded'
                    ).length
                    const overdueMonths = monthStates.filter(
                        month => month.state === 'overdue'
                    )
                    const pending = monthStates.filter(
                        month => month.state === 'pending'
                    ).length
                    const upcoming = monthStates.filter(
                        month => month.state === 'upcoming'
                    ).length

                    return {
                        department,
                        months: monthStates,
                        uploaded,
                        overdue: overdueMonths.length,
                        pending,
                        upcoming,
                        required: monthStates.length,
                        maxOverdueDays: overdueMonths.reduce(
                            (max, month) => Math.max(max, month.days || 0),
                            0
                        )
                    }
                })
                .sort((a, b) => {
                    if (a.overdue !== b.overdue) return b.overdue - a.overdue
                    if (a.uploaded !== b.uploaded) return a.uploaded - b.uploaded
                    return a.department.localeCompare(
                        b.department,
                        undefined,
                        { sensitivity: 'base' }
                    )
                })
        }, [departments, months, uploadedKeys])

        const pagedDepartmentStatuses = useMemo(() => {
            const start = (page - 1) * PAGE_SIZE
            return departmentStatuses.slice(start, start + PAGE_SIZE)
        }, [departmentStatuses, page])

        React.useEffect(() => {
            const maxPage = Math.max(
                1,
                Math.ceil(departmentStatuses.length / PAGE_SIZE)
            )

            if (page > maxPage) {
                setPage(maxPage)
            }
        }, [departmentStatuses.length, page])

        React.useEffect(() => {
            setPage(1)
        }, [range[0].valueOf(), range[1].valueOf()])

        const periodLabel =
            months.length === 1
                ? months[0].format('MMM YYYY')
                : `${months[0]?.format('MMM YYYY')} – ${months[months.length - 1]?.format('MMM YYYY')}`

        const monthVisual = (month: MonthState) => {
            if (month.state === 'uploaded') {
                return {
                    background: '#52c41a',
                    label: 'Uploaded',
                    detail: 'Uploaded'
                }
            }

            if (month.state === 'overdue') {
                return {
                    background: '#ff4d4f',
                    label: 'Overdue',
                    detail: `Not uploaded • Overdue by ${month.days} day${month.days === 1 ? '' : 's'}`
                }
            }

            if (month.state === 'pending') {
                const detail =
                    month.days === 0
                        ? 'Not uploaded • Due today'
                        : `Not uploaded • ${month.days} day${month.days === 1 ? '' : 's'} remaining`

                return {
                    background: '#faad14',
                    label: 'Pending',
                    detail
                }
            }

            return {
                background: token.colorFillSecondary,
                label: 'Upcoming',
                detail: 'Upcoming month'
            }
        }

        const renderSummary = (status: DepartmentStatus) => {
            if (status.required === 1) {
                const month = status.months[0]

                if (month.state === 'uploaded') {
                    return (
                        <div style={{ textAlign: 'right' }}>
                            <Tag
                                color='success'
                                icon={<CheckCircleOutlined />}
                                style={{ marginInlineEnd: 0, borderRadius: 999 }}
                            >
                                Uploaded
                            </Tag>
                        </div>
                    )
                }

                if (month.state === 'overdue') {
                    return (
                        <div style={{ textAlign: 'right' }}>
                            <Tag
                                color='error'
                                icon={<ExclamationCircleOutlined />}
                                style={{ marginInlineEnd: 0, borderRadius: 999 }}
                            >
                                Not uploaded
                            </Tag>
                            <Text
                                type='danger'
                                style={{
                                    display: 'block',
                                    marginTop: 3,
                                    fontSize: 11
                                }}
                            >
                                Overdue by {month.days} day
                                {month.days === 1 ? '' : 's'}
                            </Text>
                        </div>
                    )
                }

                if (month.state === 'pending') {
                    return (
                        <div style={{ textAlign: 'right' }}>
                            <Tag
                                color='warning'
                                icon={<ClockCircleOutlined />}
                                style={{ marginInlineEnd: 0, borderRadius: 999 }}
                            >
                                Not uploaded
                            </Tag>
                            <Text
                                type='secondary'
                                style={{
                                    display: 'block',
                                    marginTop: 3,
                                    fontSize: 11
                                }}
                            >
                                {month.days === 0
                                    ? 'Due today'
                                    : `${month.days} day${month.days === 1 ? '' : 's'} remaining`}
                            </Text>
                        </div>
                    )
                }

                return (
                    <Tag
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        Upcoming
                    </Tag>
                )
            }

            return (
                <div style={{ textAlign: 'right' }}>
                    <Text
                        strong
                        style={{
                            display: 'block',
                            fontSize: 13
                        }}
                    >
                        {status.uploaded}/{status.required} uploaded
                    </Text>

                    {status.overdue > 0 ? (
                        <Text
                            type='danger'
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 11
                            }}
                        >
                            {status.overdue} overdue
                            {status.overdue === 1 && status.maxOverdueDays
                                ? ` • ${status.maxOverdueDays} days`
                                : ''}
                        </Text>
                    ) : status.pending > 0 ? (
                        <Text
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 11,
                                color: '#d48806'
                            }}
                        >
                            {status.pending} pending
                        </Text>
                    ) : status.upcoming > 0 ? (
                        <Text
                            type='secondary'
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 11
                            }}
                        >
                            {status.upcoming} upcoming
                        </Text>
                    ) : (
                        <Text
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 11,
                                color: '#389e0d'
                            }}
                        >
                            Complete
                        </Text>
                    )}
                </div>
            )
        }

        return (
            <MotionCard
                title={title}
                extra={<Text type='secondary'>{periodLabel}</Text>}
            >
                {loading ? (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                        }}
                    >
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div
                                key={index}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '10px 12px',
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    borderRadius: 12
                                }}
                            >
                                <div style={{ flex: '1 1 38%', minWidth: 0 }}>
                                    <Skeleton.Input
                                        active
                                        size='small'
                                        style={{
                                            width: index % 2 === 0 ? 190 : 145,
                                            maxWidth: '100%'
                                        }}
                                    />
                                </div>

                                <Skeleton.Input
                                    active
                                    size='small'
                                    style={{
                                        flex: '1 1 42%',
                                        width: '100%',
                                        height: 12,
                                        borderRadius: 999
                                    }}
                                />

                                <Skeleton.Input
                                    active
                                    size='small'
                                    style={{
                                        width: 100
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                ) : departmentStatuses.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description='No departments found.'
                    />
                ) : (
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                        }}
                    >
                        {pagedDepartmentStatuses.map(status => (
                            <div
                                key={status.department}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: '10px 12px',
                                    borderRadius: 12,
                                    border: `1px solid ${status.overdue > 0
                                        ? token.colorErrorBorder
                                        : token.colorBorderSecondary
                                        }`,
                                    background:
                                        status.overdue > 0
                                            ? token.colorErrorBg
                                            : token.colorBgContainer
                                }}
                            >
                                <div
                                    style={{
                                        flex: '1 1 auto',
                                        minWidth: 0
                                    }}
                                >
                                    <Text
                                        strong
                                        ellipsis={{
                                            tooltip: status.department
                                        }}
                                        style={{
                                            display: 'block',
                                            fontSize: 13
                                        }}
                                    >
                                        {status.department}
                                    </Text>
                                </div>

                                {status.required > 1 && (
                                    <div
                                        style={{
                                            display: 'flex',
                                            flex: '0 0 150px',
                                            width: 150,
                                            maxWidth: 150,
                                            height: 10,
                                            gap: 3
                                        }}
                                    >
                                        {status.months.map(month => {
                                            const visual = monthVisual(month)

                                            return (
                                                <Tooltip
                                                    key={month.key}
                                                    title={`${month.label}: ${visual.detail}`}
                                                >
                                                    <div
                                                        style={{
                                                            flex: 1,
                                                            minWidth: 6,
                                                            height: '100%',
                                                            borderRadius: 999,
                                                            background: visual.background,
                                                            border:
                                                                month.state === 'upcoming'
                                                                    ? `1px solid ${token.colorBorderSecondary}`
                                                                    : 'none'
                                                        }}
                                                    />
                                                </Tooltip>
                                            )
                                        })}
                                    </div>
                                )}

                                <div
                                    style={{
                                        flex: '0 0 128px',
                                        minWidth: 128
                                    }}
                                >
                                    {renderSummary(status)}
                                </div>
                            </div>
                        ))}

                        {departmentStatuses.length > PAGE_SIZE && (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    marginTop: 14
                                }}
                            >
                                <Pagination
                                    current={page}
                                    pageSize={PAGE_SIZE}
                                    total={departmentStatuses.length}
                                    showSizeChanger={false}
                                    hideOnSinglePage
                                    onChange={setPage}
                                />
                            </div>
                        )}
                    </div>
                )}
            </MotionCard>
        )
    }

export default DepartmentMonthlyUploadStatusCard
