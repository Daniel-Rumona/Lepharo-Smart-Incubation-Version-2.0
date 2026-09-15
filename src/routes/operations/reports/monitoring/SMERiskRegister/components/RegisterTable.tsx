import { useEffect, useMemo, useState } from 'react'
import {
    Avatar,
    Empty,
    Pagination,
    Progress,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme
} from 'antd'
import {
    ArrowRightOutlined,
    ClockCircleOutlined,
    ShopOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'

import {
    getRiskDriversForRow
} from '../riskEngine'
import type { SMERow } from '../types'
import { getRiskTag } from './riskPresentation'

const { Text } = Typography

type Props = {
    loading: boolean
    rows: SMERow[]
    isDepartmentScopedView: boolean
    onViewRow: (row: SMERow) => void
}

const PAGE_SIZE = 7

const getCoveragePercent = (row: SMERow) => {
    if (!row.expectedDepartmentsCount) return 0

    return Math.round(
        (row.servicedDepartmentsCount /
            row.expectedDepartmentsCount) *
        100
    )
}

const getAttentionSummary = (
    row: SMERow,
    isDepartmentScopedView: boolean
) => {
    const pendingDepartmentReviews = row.expectedDepartments.filter(
        department => !department.deptConfirmed
    ).length

    const pendingSmmeConfirmations = row.expectedDepartments.filter(
        department =>
            department.deptConfirmed &&
            !department.smmeConfirmed
    ).length

    const readyWithoutService = row.expectedDepartments.filter(
        department =>
            department.deptConfirmed &&
            department.smmeConfirmed &&
            Number(department.servicedCount || 0) === 0
    ).length

    if (pendingDepartmentReviews > 0) {
        return isDepartmentScopedView
            ? 'Developmental Plan review pending'
            : `${pendingDepartmentReviews} DP review${pendingDepartmentReviews === 1 ? '' : 's'
            } pending`
    }

    if (pendingSmmeConfirmations > 0) {
        return `${pendingSmmeConfirmations} SME confirmation${pendingSmmeConfirmations === 1 ? '' : 's'
            } pending`
    }

    if (readyWithoutService > 0) {
        return `${readyWithoutService} department${readyWithoutService === 1 ? '' : 's'
            } awaiting service`
    }

    if (row.smePendingAcceptanceCount > 0) {
        return `${row.smePendingAcceptanceCount} intervention${row.smePendingAcceptanceCount === 1 ? '' : 's'
            } awaiting SME acceptance`
    }

    if (row.smePendingConfirmationCount > 0) {
        return `${row.smePendingConfirmationCount} completion${row.smePendingConfirmationCount === 1 ? '' : 's'
            } awaiting SME confirmation`
    }

    if (row.missingDepartmentsCount > 0) {
        return `${row.missingDepartmentsCount} outstanding department action${row.missingDepartmentsCount === 1 ? '' : 's'
            }`
    }

    if ((row.daysSinceLastService ?? 0) >= 30) {
        return `${row.daysSinceLastService} days since last service`
    }

    return 'No immediate action required'
}

const getAttentionColor = (row: SMERow) => {
    if (row.riskLevel === 'Critical') return 'red'
    if (row.riskLevel === 'High') return 'volcano'

    if (
        row.missingDepartmentsCount > 0 ||
        row.smePendingAcceptanceCount > 0 ||
        row.smePendingConfirmationCount > 0
    ) {
        return 'gold'
    }

    return 'green'
}

export default function RegisterTable({
    loading,
    rows,
    isDepartmentScopedView,
    onViewRow
}: Props) {
    const { token } = theme.useToken()
    const [page, setPage] = useState(1)

    useEffect(() => {
        setPage(1)
    }, [rows])

    const pageRows = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE
        return rows.slice(start, start + PAGE_SIZE)
    }, [rows, page])

    if (loading) {
        return (
            <div style={{ padding: 12 }}>
                <Space
                    direction="vertical"
                    size={8}
                    style={{ width: '100%' }}
                >
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div
                            key={index}
                            style={{
                                padding: '10px 12px',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 12
                            }}
                        >
                            <Skeleton
                                active
                                avatar
                                title={{ width: '30%' }}
                                paragraph={{
                                    rows: 1,
                                    width: ['68%']
                                }}
                            />
                        </div>
                    ))}
                </Space>
            </div>
        )
    }

    if (!rows.length) {
        return (
            <Empty
                style={{ padding: '42px 16px' }}
                description="No SMEs found for this risk view"
            />
        )
    }

    return (
        <div style={{ padding: 12 }}>
            <Space
                direction="vertical"
                size={8}
                style={{ width: '100%' }}
            >
                {pageRows.map(row => {
                    const coveragePercent = getCoveragePercent(row)
                    const attention = getAttentionSummary(
                        row,
                        isDepartmentScopedView
                    )
                    const riskDrivers = getRiskDriversForRow(row)

                    return (
                        <button
                            key={row.key}
                            type="button"
                            onClick={() => onViewRow(row)}
                            style={{
                                width: '100%',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 13,
                                background: token.colorBgContainer,
                                padding: 0,
                                cursor: 'pointer',
                                textAlign: 'left',
                                overflow: 'hidden',
                                boxShadow: token.boxShadowTertiary,
                                transition:
                                    'transform .18s ease, border-color .18s ease, box-shadow .18s ease'
                            }}
                            onMouseEnter={event => {
                                event.currentTarget.style.transform =
                                    'translateY(-1px)'
                                event.currentTarget.style.borderColor =
                                    token.colorPrimaryBorder
                                event.currentTarget.style.boxShadow =
                                    token.boxShadowSecondary
                            }}
                            onMouseLeave={event => {
                                event.currentTarget.style.transform =
                                    'translateY(0)'
                                event.currentTarget.style.borderColor =
                                    token.colorBorderSecondary
                                event.currentTarget.style.boxShadow =
                                    token.boxShadowTertiary
                            }}
                        >
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        '4px minmax(0, 1fr) 42px',
                                    minHeight: 86
                                }}
                            >
                                <div
                                    style={{
                                        background:
                                            row.riskLevel === 'Critical'
                                                ? token.colorError
                                                : row.riskLevel === 'High'
                                                    ? token.colorWarning
                                                    : row.riskLevel === 'Medium'
                                                        ? token.colorInfo
                                                        : token.colorSuccess
                                    }}
                                />

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns:
                                            'minmax(220px, 1.3fr) minmax(125px, .55fr) minmax(185px, .8fr) minmax(230px, 1fr)',
                                        gap: 16,
                                        alignItems: 'center',
                                        minWidth: 0,
                                        padding: '10px 14px'
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            minWidth: 0
                                        }}
                                    >
                                        <Avatar
                                            shape="square"
                                            size={38}
                                            icon={<ShopOutlined />}
                                            style={{
                                                background:
                                                    token.colorPrimaryBg,
                                                color:
                                                    token.colorPrimary,
                                                flex: '0 0 auto'
                                            }}
                                        />

                                        <div style={{ minWidth: 0 }}>
                                            <Text
                                                strong
                                                ellipsis={{
                                                    tooltip: row.smeName
                                                }}
                                                style={{
                                                    display: 'block',
                                                    fontSize: 14
                                                }}
                                            >
                                                {row.smeName}
                                            </Text>

                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    marginTop: 3,
                                                    minWidth: 0
                                                }}
                                            >
                                                <Text
                                                    type="secondary"
                                                    ellipsis={{
                                                        tooltip:
                                                            row.ownerName ||
                                                            'Owner not recorded'
                                                    }}
                                                    style={{
                                                        maxWidth: 160,
                                                        fontSize: 11
                                                    }}
                                                >
                                                    {row.ownerName ||
                                                        'Owner not recorded'}
                                                </Text>

                                                {row.currentGroup && (
                                                    <Tag
                                                        style={{
                                                            marginInlineEnd: 0,
                                                            borderRadius: 999
                                                        }}
                                                    >
                                                        Group {row.currentGroup}
                                                    </Tag>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <Text
                                            type="secondary"
                                            style={{
                                                display: 'block',
                                                fontSize: 10,
                                                marginBottom: 4
                                            }}
                                        >
                                            Risk
                                        </Text>

                                        <Tooltip
                                            placement="top"
                                            title={
                                                riskDrivers.length ? (
                                                    <div>
                                                        <div
                                                            style={{
                                                                fontWeight: 600,
                                                                marginBottom: 5
                                                            }}
                                                        >
                                                            Main risk drivers
                                                        </div>

                                                        {riskDrivers
                                                            .slice(0, 4)
                                                            .map(driver => (
                                                                <div
                                                                    key={
                                                                        driver.key
                                                                    }
                                                                    style={{
                                                                        display:
                                                                            'flex',
                                                                        justifyContent:
                                                                            'space-between',
                                                                        gap: 14
                                                                    }}
                                                                >
                                                                    <span>
                                                                        {
                                                                            driver.label
                                                                        }
                                                                    </span>
                                                                    <span>
                                                                        +
                                                                        {
                                                                            driver.points
                                                                        }
                                                                    </span>
                                                                </div>
                                                            ))}
                                                    </div>
                                                ) : (
                                                    'No active risk drivers'
                                                )
                                            }
                                        >
                                            <Space size={6}>
                                                {getRiskTag(row.riskLevel)}
                                                <Text strong>
                                                    {row.riskScore}%
                                                </Text>
                                            </Space>
                                        </Tooltip>
                                    </div>

                                    <div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent:
                                                    'space-between',
                                                gap: 8,
                                                marginBottom: 4
                                            }}
                                        >
                                            <Text
                                                type="secondary"
                                                style={{ fontSize: 10 }}
                                            >
                                                Coverage
                                            </Text>

                                            <Text
                                                strong
                                                style={{ fontSize: 11 }}
                                            >
                                                {
                                                    row.servicedDepartmentsCount
                                                }
                                                /
                                                {
                                                    row.expectedDepartmentsCount
                                                }
                                            </Text>
                                        </div>

                                        <Progress
                                            percent={coveragePercent}
                                            size="small"
                                            showInfo={false}
                                            status={
                                                row.missingDepartmentsCount >
                                                    0
                                                    ? 'active'
                                                    : 'success'
                                            }
                                            style={{ marginBottom: 0 }}
                                        />
                                    </div>

                                    <div style={{ minWidth: 0 }}>
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

                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 7,
                                                minWidth: 0
                                            }}
                                        >
                                            <Tag
                                                color={getAttentionColor(row)}
                                                style={{
                                                    marginInlineEnd: 0,
                                                    borderRadius: 999,
                                                    maxWidth: '100%',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {attention}
                                            </Tag>
                                        </div>

                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 5,
                                                marginTop: 4,
                                                minWidth: 0
                                            }}
                                        >
                                            <ClockCircleOutlined
                                                style={{
                                                    color:
                                                        token.colorTextQuaternary,
                                                    fontSize: 10
                                                }}
                                            />

                                            <Text
                                                type="secondary"
                                                ellipsis
                                                style={{
                                                    fontSize: 10,
                                                    minWidth: 0
                                                }}
                                            >
                                                {row.lastInterventionDate
                                                    ? `Last service ${dayjs(
                                                        row.lastInterventionDate
                                                    ).format('DD MMM YYYY')}`
                                                    : 'No service recorded'}
                                            </Text>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        display: 'grid',
                                        placeItems: 'center',
                                        color: token.colorPrimary,
                                        borderLeft: `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <ArrowRightOutlined
                                        style={{ fontSize: 16 }}
                                    />
                                </div>
                            </div>
                        </button>
                    )
                })}
            </Space>

            {rows.length > PAGE_SIZE && (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        marginTop: 14
                    }}
                >
                    <Pagination
                        current={page}
                        total={rows.length}
                        pageSize={PAGE_SIZE}
                        showSizeChanger={false}
                        onChange={setPage}
                    />
                </div>
            )}
        </div>
    )
}
