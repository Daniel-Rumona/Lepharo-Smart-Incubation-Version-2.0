import React, { useMemo, useState } from 'react'
import {
    Col,
    Empty,
    Modal,
    Pagination,
    Row,
    Skeleton,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ApartmentOutlined,
    ArrowRightOutlined,
    PieChartOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { resolveAssignmentLifecycle } from '@/services/assignmentLifecycleService'
import type { AssignmentLifecycleKey } from '@/services/assignmentLifecycleService'

const { Text, Title } = Typography
const { useToken } = theme

export type DepartmentStatusIntervention = {
    departmentName?: string
    status?: string
    assignmentStatus?: string
    participantAcceptanceStatus?: string
    participantCompletionStatus?: string
    beneficiaryCompletionStatus?: string
    assigneeCompletionStatus?: string
    completionStatus?: string
}

type DepartmentSummary = {
    key: string
    department: string
    counts: Record<AssignmentLifecycleKey, number>
    total: number
}

type DepartmentInterventionStatusCardProps = {
    interventions: DepartmentStatusIntervention[]
    title?: React.ReactNode
    loading?: boolean
}

export const INTERVENTION_STATUS_COLORS: Record<AssignmentLifecycleKey, string> = {
    assigned: '#1677ff',
    'awaiting-participant-acceptance': '#fa8c16',
    'in-delivery': '#2f54eb',
    'awaiting-participant-confirmation': '#722ed1',
    'participant-rejected': '#d4380d',
    completed: '#52c41a',
    'needs-reassignment': '#eb2f96',
    'participant-declined': '#ff7875',
    cancelled: '#f5222d'
}

export const INTERVENTION_STATUS_ORDER: AssignmentLifecycleKey[] = [
    'assigned',
    'awaiting-participant-acceptance',
    'in-delivery',
    'awaiting-participant-confirmation',
    'participant-rejected',
    'completed',
    'needs-reassignment',
    'participant-declined',
    'cancelled'
]

export const formatInterventionStatusLabel = (status?: string): string => {
    const normalized = String(status || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')

    const labels: Record<string, string> = {
        assigned: 'Assigned',
        'awaiting-participant-acceptance': 'Awaiting SME Acceptance',
        'in-delivery': 'In Delivery',
        'awaiting-participant-confirmation': 'Awaiting SME Confirmation',
        'participant-rejected': 'SME Rejected Completion',
        completed: 'Completed',
        'needs-reassignment': 'Needs Reassignment',
        'participant-declined': 'SME Declined',
        cancelled: 'Cancelled'
    }

    return labels[normalized] || 'Assigned'
}

export const resolveInterventionStatus = (
    record: DepartmentStatusIntervention
): AssignmentLifecycleKey =>
    resolveAssignmentLifecycle({
        ...record,
        assignmentStatus: record.assignmentStatus || record.status,
        participantAcceptanceStatus:
            record.participantAcceptanceStatus ||
            (['in-progress', 'in_progress'].includes(
                String(record.assignmentStatus || record.status || '').toLowerCase()
            )
                ? 'accepted'
                : undefined),
        participantCompletionStatus:
            record.participantCompletionStatus ||
            record.beneficiaryCompletionStatus ||
            (['confirmed', 'completed'].includes(
                String(record.completionStatus || '').toLowerCase()
            )
                ? record.completionStatus
                : undefined),
        assigneeCompletionStatus:
            record.assigneeCompletionStatus ||
            (['submitted', 'done', 'completed'].includes(
                String(record.completionStatus || '').toLowerCase()
            )
                ? record.completionStatus
                : undefined)
    }).key

const createEmptyStatusCounts = (): Record<AssignmentLifecycleKey, number> =>
    Object.fromEntries(
        INTERVENTION_STATUS_ORDER.map(status => [status, 0])
    ) as Record<AssignmentLifecycleKey, number>

const DepartmentInterventionStatusCard: React.FC<
    DepartmentInterventionStatusCardProps
> = ({
    interventions,
    title = (
        <Space size={8}>
            <ApartmentOutlined />
            <span>Department Intervention Status</span>
        </Space>
    ),
    loading = false
}) => {
        const { token } = useToken()
        const [selectedDepartment, setSelectedDepartment] =
            useState<DepartmentSummary | null>(null)

        const [page, setPage] = useState(1)
        const PAGE_SIZE = 4

        const departments = useMemo<DepartmentSummary[]>(() => {
            const grouped: Record<string, DepartmentSummary> = {}

            interventions.forEach(intervention => {
                const department =
                    intervention.departmentName || 'Unspecified Department'
                const status = resolveInterventionStatus(intervention)

                if (!grouped[department]) {
                    grouped[department] = {
                        key: department,
                        department,
                        counts: createEmptyStatusCounts(),
                        total: 0
                    }
                }

                grouped[department].counts[status] += 1
                grouped[department].total += 1
            })

            return Object.values(grouped).sort((a, b) => b.total - a.total)
        }, [interventions])

        const pagedDepartments = useMemo(() => {
            const start = (page - 1) * PAGE_SIZE
            return departments.slice(start, start + PAGE_SIZE)
        }, [departments, page])

        React.useEffect(() => {
            const maxPage = Math.max(
                1,
                Math.ceil(departments.length / PAGE_SIZE)
            )

            if (page > maxPage) {
                setPage(maxPage)
            }
        }, [departments.length, page])

        const selectedStatusRows = useMemo(() => {
            if (!selectedDepartment) return []

            return INTERVENTION_STATUS_ORDER.map(status => {
                const count = selectedDepartment.counts[status] || 0
                const percentage = selectedDepartment.total
                    ? (count / selectedDepartment.total) * 100
                    : 0

                return {
                    status,
                    count,
                    percentage
                }
            })
        }, [selectedDepartment])

        const donutOptions = useMemo<Highcharts.Options>(() => {
            if (!selectedDepartment) return {}

            const data = INTERVENTION_STATUS_ORDER
                .map(status => ({
                    name: formatInterventionStatusLabel(status),
                    y: selectedDepartment.counts[status] || 0,
                    color: INTERVENTION_STATUS_COLORS[status]
                }))
                .filter(item => item.y > 0)

            return {
                chart: {
                    type: 'pie',
                    height: 280,
                    backgroundColor: 'transparent',
                    spacing: [0, 0, 0, 0]
                },
                title: {
                    text: undefined
                },
                credits: {
                    enabled: false
                },
                accessibility: {
                    enabled: false
                },
                tooltip: {
                    useHTML: true,
                    headerFormat: '',
                    pointFormat:
                        '<b>{point.name}</b><br/>{point.y} interventions · {point.percentage:.1f}%'
                },
                plotOptions: {
                    pie: {
                        innerSize: '68%',
                        startAngle: -90,
                        endAngle: 90,
                        center: ['50%', '72%'],
                        size: '118%',
                        borderWidth: 0,
                        dataLabels: {
                            enabled: false
                        },
                        states: {
                            hover: {
                                brightness: 0.08
                            }
                        }
                    }
                },
                legend: {
                    enabled: false
                },
                series: [
                    {
                        type: 'pie',
                        name: 'Interventions',
                        data
                    }
                ]
            }
        }, [selectedDepartment])

        const getActiveStatuses = (department: DepartmentSummary) =>
            INTERVENTION_STATUS_ORDER.filter(
                status => (department.counts[status] || 0) > 0
            )

        return (
            <>
                <MotionCard title={title}>
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
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        overflow: 'hidden',
                                        padding: '11px 12px',
                                        borderRadius: 12,
                                        border: `1px solid ${token.colorBorderSecondary}`,
                                        background: token.colorBgContainer
                                    }}
                                >
                                    <div
                                        style={{
                                            flex: '1 1 38%',
                                            minWidth: 0
                                        }}
                                    >
                                        <Skeleton.Input
                                            active
                                            size='small'
                                            style={{
                                                width: index % 2 === 0 ? 210 : 160,
                                                maxWidth: '100%'
                                            }}
                                        />
                                    </div>

                                    <Skeleton.Input
                                        active
                                        size='small'
                                        style={{
                                            flex: '1 1 42%',
                                            minWidth: 110,
                                            width: '100%',
                                            height: 18,
                                            borderRadius: 999
                                        }}
                                    />

                                    <Skeleton.Input
                                        active
                                        size='small'
                                        style={{
                                            width: 28,
                                            minWidth: 28
                                        }}
                                    />

                                    <Skeleton.Button
                                        active
                                        size='small'
                                        shape='square'
                                        style={{
                                            width: 26,
                                            minWidth: 26,
                                            height: 26
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : departments.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description='No interventions found.'
                        />
                    ) : (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8
                            }}
                        >
                            {pagedDepartments.map(department => {
                                const activeStatuses = getActiveStatuses(department)

                                return (
                                    <div
                                        key={department.key}
                                        role='button'
                                        tabIndex={0}
                                        onClick={() => setSelectedDepartment(department)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                setSelectedDepartment(department)
                                            }
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            overflow: 'hidden',
                                            padding: '11px 12px',
                                            borderRadius: 12,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background: token.colorBgContainer,
                                            cursor: 'pointer',
                                            transition: 'all 0.18s ease'
                                        }}
                                        onMouseEnter={event => {
                                            event.currentTarget.style.borderColor = token.colorPrimaryBorder
                                            event.currentTarget.style.background = token.colorFillQuaternary
                                        }}
                                        onMouseLeave={event => {
                                            event.currentTarget.style.borderColor = token.colorBorderSecondary
                                            event.currentTarget.style.background = token.colorBgContainer
                                        }}
                                    >
                                        <div
                                            style={{
                                                flex: '1 1 38%',
                                                minWidth: 0
                                            }}
                                        >
                                            <Text
                                                strong
                                                ellipsis={{
                                                    tooltip: department.department
                                                }}
                                                style={{
                                                    display: 'block',
                                                    fontSize: 13
                                                }}
                                            >
                                                {department.department}
                                            </Text>
                                        </div>

                                        <div
                                            style={{
                                                display: 'flex',
                                                flex: '1 1 42%',
                                                minWidth: 110,
                                                height: 18,
                                                borderRadius: 999,
                                                overflow: 'hidden',
                                                background: token.colorFillSecondary
                                            }}
                                        >
                                            {activeStatuses.map(status => {
                                                const value = department.counts[status] || 0
                                                const width = department.total
                                                    ? (value / department.total) * 100
                                                    : 0

                                                return (
                                                    <div
                                                        key={status}
                                                        title={`${formatInterventionStatusLabel(status)}: ${value}`}
                                                        style={{
                                                            width: `${width}%`,
                                                            minWidth: value > 0 ? 4 : 0,
                                                            background: INTERVENTION_STATUS_COLORS[status],
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            color: '#fff',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden'
                                                        }}
                                                    >
                                                        {width >= 12 ? value : ''}
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                gap: 8,
                                                flex: '0 0 auto',
                                                minWidth: 62
                                            }}
                                        >
                                            <Text
                                                strong
                                                style={{
                                                    minWidth: 28,
                                                    textAlign: 'right',
                                                    fontSize: 14
                                                }}
                                            >
                                                {department.total}
                                            </Text>

                                            <span
                                                style={{
                                                    width: 26,
                                                    height: 26,
                                                    borderRadius: 8,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                    background: token.colorFillSecondary,
                                                    color: token.colorTextSecondary
                                                }}
                                            >
                                                <ArrowRightOutlined
                                                    style={{ fontSize: 11 }}
                                                />
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}

                            {departments.length > PAGE_SIZE && (
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
                                        total={departments.length}
                                        showSizeChanger={false}
                                        hideOnSinglePage
                                        onChange={setPage}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </MotionCard>

                <Modal
                    centered
                    maskClosable={false}
                    open={!!selectedDepartment}
                    onCancel={() => setSelectedDepartment(null)}
                    footer={null}
                    width={820}
                    title={
                        selectedDepartment ? (
                            <div
                                style={{
                                    paddingRight: 24
                                }}
                            >
                                <Space size={8}>
                                    <PieChartOutlined />
                                    <span>{selectedDepartment.department}</span>
                                </Space>
                            </div>
                        ) : null
                    }
                >
                    {selectedDepartment && (
                        <div>
                            <div
                                style={{
                                    position: 'relative',
                                    maxWidth: 520,
                                    margin: '0 auto'
                                }}
                            >
                                <HighchartsReact
                                    highcharts={Highcharts}
                                    options={donutOptions}
                                />

                                <div
                                    style={{
                                        position: 'absolute',
                                        left: '50%',
                                        bottom: 25,
                                        transform: 'translateX(-50%)',
                                        textAlign: 'center',
                                        pointerEvents: 'none'
                                    }}
                                >
                                    <Title
                                        level={2}
                                        style={{
                                            margin: 0,
                                            lineHeight: 1
                                        }}
                                    >
                                        {selectedDepartment.total}
                                    </Title>
                                    <Text
                                        type='secondary'
                                        style={{
                                            fontSize: 12
                                        }}
                                    >
                                        Interventions
                                    </Text>
                                </div>
                            </div>

                            <Row gutter={[10, 10]} style={{ marginTop: 4 }}>
                                {selectedStatusRows.map(
                                    ({ status, count, percentage }) => (
                                        <Col
                                            key={status}
                                            xs={24}
                                            sm={12}
                                            lg={8}
                                        >
                                            <div
                                                style={{
                                                    height: '100%',
                                                    padding: '12px 14px',
                                                    borderRadius: 12,
                                                    border: `1px solid ${token.colorBorderSecondary}`,
                                                    background:
                                                        count > 0
                                                            ? token.colorFillQuaternary
                                                            : token.colorBgContainer,
                                                    opacity: count > 0 ? 1 : 0.58
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent:
                                                            'space-between',
                                                        gap: 10,
                                                        marginBottom: 6
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 7,
                                                            minWidth: 0
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                width: 9,
                                                                height: 9,
                                                                borderRadius: 3,
                                                                background:
                                                                    INTERVENTION_STATUS_COLORS[
                                                                    status
                                                                    ],
                                                                flexShrink: 0
                                                            }}
                                                        />

                                                        <Text
                                                            style={{
                                                                fontSize: 12,
                                                                lineHeight: 1.3
                                                            }}
                                                        >
                                                            {formatInterventionStatusLabel(
                                                                status
                                                            )}
                                                        </Text>
                                                    </div>

                                                    <Text
                                                        strong
                                                        style={{
                                                            fontSize: 16
                                                        }}
                                                    >
                                                        {count}
                                                    </Text>
                                                </div>

                                                <Text
                                                    type='secondary'
                                                    style={{
                                                        fontSize: 11
                                                    }}
                                                >
                                                    {percentage.toFixed(1)}% of
                                                    department interventions
                                                </Text>
                                            </div>
                                        </Col>
                                    )
                                )}
                            </Row>
                        </div>
                    )}
                </Modal>
            </>
        )
    }

export default DepartmentInterventionStatusCard
