import {
    Col,
    Empty,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    PauseCircleOutlined,
    SafetyCertificateOutlined
} from '@ant-design/icons'

import type { DepartmentSummary, SMERow } from '../types'

const { Text } = Typography

type Props = {
    row: SMERow
    isDepartmentScopedView: boolean
}

function SummaryPill({
    icon,
    label,
    value,
    color
}: {
    icon: React.ReactNode
    label: string
    value: number
    color: string
}) {
    const { token } = theme.useToken()

    return (
        <div
            style={{
                flex: '1 1 150px',
                minWidth: 140,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 11,
                padding: '9px 11px',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                background: token.colorBgContainer
            }}
        >
            <span
                style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    display: 'grid',
                    placeItems: 'center',
                    color,
                    background: token.colorFillQuaternary,
                    fontSize: 15,
                    flex: '0 0 auto'
                }}
            >
                {icon}
            </span>

            <div style={{ minWidth: 0 }}>
                <Text
                    type="secondary"
                    style={{
                        display: 'block',
                        fontSize: 10,
                        lineHeight: 1.25
                    }}
                >
                    {label}
                </Text>

                <Text
                    strong
                    style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: 16,
                        lineHeight: 1
                    }}
                >
                    {value}
                </Text>
            </div>
        </div>
    )
}

function getDepartmentState(department: DepartmentSummary) {
    if (!department.deptConfirmed) {
        return {
            label: 'Awaiting department review',
            color: 'gold',
            attention: 'Review DP',
            attentionColor: 'gold'
        }
    }

    if (!department.smmeConfirmed) {
        return {
            label: 'Awaiting SME confirmation',
            color: 'blue',
            attention: 'Confirm DP',
            attentionColor: 'blue'
        }
    }

    if (department.servicedCount === 0) {
        return {
            label: 'Ready for delivery',
            color: 'green',
            attention: 'Service needed',
            attentionColor: 'volcano'
        }
    }

    if (department.declinedCount > 0) {
        return {
            label: 'Delivery active',
            color: 'green',
            attention: `${department.declinedCount} declined`,
            attentionColor: 'red'
        }
    }

    if (department.pendingCount > 0) {
        return {
            label: 'Delivery active',
            color: 'green',
            attention: `${department.pendingCount} service${department.pendingCount === 1 ? '' : 's'
                } pending`,
            attentionColor: 'gold'
        }
    }

    const expectedCount =
        department.expectedInterventionTitles?.length || 0

    if (
        expectedCount > 0 &&
        department.completedCount >= expectedCount
    ) {
        return {
            label: 'Delivery complete',
            color: 'green',
            attention: 'Complete',
            attentionColor: 'green'
        }
    }

    if (
        expectedCount > 0 &&
        department.servicedCount < expectedCount
    ) {
        const outstanding = Math.max(
            0,
            expectedCount - department.servicedCount
        )

        return {
            label: 'Delivery active',
            color: 'green',
            attention: `${outstanding} not delivered`,
            attentionColor: 'gold'
        }
    }

    return {
        label: 'Delivery active',
        color: 'green',
        attention: 'Monitoring',
        attentionColor: 'default'
    }
}

function DepartmentRow({
    department
}: {
    department: DepartmentSummary
}) {
    const { token } = theme.useToken()

    const expectedCount =
        department.expectedInterventionTitles?.length || 0

    const deliveredCount = department.servicedCount || 0

    const coveragePercent =
        expectedCount > 0
            ? Math.min(
                100,
                Math.round(
                    (deliveredCount / expectedCount) * 100
                )
            )
            : deliveredCount > 0
                ? 100
                : 0

    const state = getDepartmentState(department)

    return (
        <div
            style={{
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 11,
                padding: '10px 12px',
                background: token.colorBgContainer
            }}
        >
            <Row gutter={[12, 8]} align="middle">
                <Col xs={24} md={7}>
                    <Text
                        strong
                        ellipsis={{
                            tooltip: department.departmentName
                        }}
                        style={{
                            display: 'block',
                            fontSize: 13
                        }}
                    >
                        {department.departmentName}
                    </Text>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 2,
                            fontSize: 10
                        }}
                    >
                        {expectedCount} expected service
                        {expectedCount === 1 ? '' : 's'}
                    </Text>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 10,
                            marginBottom: 4
                        }}
                    >
                        Developmental Plan
                    </Text>

                    <Tag
                        color={state.color}
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        {state.label}
                    </Tag>
                </Col>

                <Col xs={24} sm={12} md={7}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 3
                        }}
                    >
                        <Text
                            type="secondary"
                            style={{ fontSize: 10 }}
                        >
                            Delivery
                        </Text>

                        <Text
                            strong
                            style={{ fontSize: 11 }}
                        >
                            {deliveredCount}
                            {expectedCount > 0
                                ? ` / ${expectedCount}`
                                : ''}
                        </Text>
                    </div>

                    <Progress
                        percent={coveragePercent}
                        showInfo={false}
                        size="small"
                        status={
                            department.declinedCount > 0
                                ? 'exception'
                                : coveragePercent >= 100
                                    ? 'success'
                                    : 'active'
                        }
                        style={{
                            marginBottom: 0
                        }}
                    />
                </Col>

                <Col xs={24} md={4}>
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            fontSize: 10,
                            marginBottom: 4
                        }}
                    >
                        Attention
                    </Text>

                    <Tag
                        color={state.attentionColor}
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        {state.attention}
                    </Tag>
                </Col>
            </Row>
        </div>
    )
}

export default function DepartmentServiceCollapse({
    row,
    isDepartmentScopedView
}: Props) {
    const { token } = theme.useToken()

    const awaitingDepartmentReview =
        row.expectedDepartments.filter(
            department => !department.deptConfirmed
        )

    const awaitingSmeConfirmation =
        row.expectedDepartments.filter(
            department =>
                department.deptConfirmed &&
                !department.smmeConfirmed
        )

    const readyDepartments =
        row.expectedDepartments.filter(
            department =>
                department.deptConfirmed &&
                department.smmeConfirmed
        )

    if (row.expectedDepartments.length === 0) {
        return (
            <Empty
                description={
                    isDepartmentScopedView
                        ? 'No services found for my department'
                        : 'No Developmental Plan services found'
                }
            />
        )
    }

    const sortedDepartments = [
        ...row.expectedDepartments
    ].sort((a, b) => {
        const aState = getDepartmentState(a)
        const bState = getDepartmentState(b)

        const priority = (attention: string) => {
            if (attention === 'Review DP') return 1
            if (attention === 'Confirm DP') return 2
            if (attention === 'Service needed') return 3
            if (attention.includes('declined')) return 4
            if (attention.includes('pending')) return 5
            if (attention.includes('not delivered')) return 6
            if (attention === 'Monitoring') return 7
            if (attention === 'Complete') return 8
            return 9
        }

        const difference =
            priority(aState.attention) -
            priority(bState.attention)

        if (difference !== 0) return difference

        return a.departmentName.localeCompare(
            b.departmentName
        )
    })

    return (
        <Space
            direction="vertical"
            size={12}
            style={{ width: '100%' }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    gap: 8,
                    flexWrap: 'wrap'
                }}
            >
                <SummaryPill
                    icon={<PauseCircleOutlined />}
                    label="Department review pending"
                    value={awaitingDepartmentReview.length}
                    color={token.colorWarning}
                />

                <SummaryPill
                    icon={<ClockCircleOutlined />}
                    label="Awaiting SME"
                    value={awaitingSmeConfirmation.length}
                    color={token.colorInfo}
                />

                <SummaryPill
                    icon={<CheckCircleOutlined />}
                    label="Ready"
                    value={readyDepartments.length}
                    color={token.colorSuccess}
                />

                <SummaryPill
                    icon={<SafetyCertificateOutlined />}
                    label="Departments"
                    value={row.expectedDepartments.length}
                    color={token.colorPrimary}
                />
            </div>

            <div
                style={{
                    display: 'grid',
                    gap: 7
                }}
            >
                {sortedDepartments.map(department => (
                    <DepartmentRow
                        key={department.departmentId}
                        department={department}
                    />
                ))}
            </div>
        </Space>
    )
}
