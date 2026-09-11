import { Col, Empty, Progress, Row, Skeleton, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

import { SEMANTIC_DANGER_COLOR, SEMANTIC_SUCCESS_COLOR, getRiskRowStyle } from '../riskEngine'
import type { DepartmentSummary, SMERow } from '../types'
import { getInactivityTag, getRiskTag } from './riskPresentation'

const { Text } = Typography

type Props = {
    loading: boolean
    rows: SMERow[]
    isDepartmentScopedView: boolean
    expectedDepartmentsLabel: string
    servicedDepartmentsLabel: string
    missingDepartmentsLabel: string
    selectedKey?: string
    onViewRow: (row: SMERow) => void
}

export default function RegisterTable({
    loading,
    rows,
    isDepartmentScopedView,
    expectedDepartmentsLabel,
    servicedDepartmentsLabel,
    missingDepartmentsLabel,
    selectedKey,
    onViewRow
}: Props) {
    const columns: ColumnsType<SMERow> = [
        {
            title: 'SME',
            dataIndex: 'smeName',
            key: 'smeName',
            fixed: 'left',
            width: 210,
            render: (_, record) => (
                <div>
                    <div style={{ fontWeight: 700 }}>{record.smeName}</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
                        {record.ownerName || 'No owner name'}
                    </div>
                </div>
            )
        },
        {
            title: 'Risk',
            key: 'risk',
            width: 96,
            render: (_, record) => (
                <Space direction="vertical" size={2}>
                    {getRiskTag(record.riskLevel)}
                    <Text type="secondary">{record.riskScore}%</Text>
                </Space>
            )
        },
        {
            title: 'Delivery status',
            key: 'deliveryStatus',
            width: 230,
            render: (_, record) => {
                const percent = record.expectedDepartmentsCount > 0
                    ? Math.round((record.servicedDepartmentsCount / record.expectedDepartmentsCount) * 100)
                    : 0

                return (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        <Space size={6} wrap>
                            <Text strong>{record.servicedDepartmentsCount}/{record.expectedDepartmentsCount} departments</Text>
                            {getInactivityTag(record.inactivityBucket)}
                        </Space>
                        <Progress percent={percent} size="small" status={record.missingDepartmentsCount > 0 ? 'active' : 'success'} />
                        <Space size={4} wrap>
                            <Tag color="green">{record.completedTouches} completed</Tag>
                            {record.pendingTouches > 0 && <Tag color="gold">{record.pendingTouches} pending</Tag>}
                        </Space>
                        <Text type="secondary">
                            {record.lastInterventionDate
                                ? `Last service ${dayjs(record.lastInterventionDate).format('DD MMM YYYY')}`
                                : 'No service recorded'}
                        </Text>
                    </Space>
                )
            }
        }
    ]

    if (loading) {
        return (
            <div style={{ minHeight: 360 }}>
                <Skeleton active title={{ width: 180 }} paragraph={{ rows: 8 }} />
            </div>
        )
    }

    if (rows.length === 0) {
        return <Empty description="No SMEs found for this coverage view" />
    }

    return (
        <Table<SMERow>
            rowKey="key"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 5, showSizeChanger: false }}
            scroll={{ x: 600 }}
            onRow={record => ({
                style: {
                    ...getRiskRowStyle(record.riskLevel),
                    cursor: 'pointer',
                    boxShadow: record.key === selectedKey ? 'inset 4px 0 0 #1677ff' : undefined
                },
                onClick: () => onViewRow(record)
            })}
            expandable={{
                showExpandColumn: false,
                expandedRowRender: record => (
                    <div style={{ padding: '6px 0' }}>
                        <Row gutter={[16, 16]}>
                            <Col xs={24} lg={8}>
                                <Text strong>{expectedDepartmentsLabel}</Text>
                                <div style={{ marginTop: 8 }}>
                                    <Space size={[4, 4]} wrap>
                                        {record.expectedDepartments.length === 0 ? (
                                            <Tag>{isDepartmentScopedView ? 'No services listed for my department' : 'No DP departments'}</Tag>
                                        ) : (
                                            record.expectedDepartments.map(dep => (
                                                <Tag key={dep.departmentId}>
                                                    {isDepartmentScopedView
                                                        ? `${dep.expectedInterventionIds.length} expected`
                                                        : `${dep.departmentName} (${dep.expectedInterventionIds.length})`}
                                                </Tag>
                                            ))
                                        )}
                                    </Space>
                                </div>
                            </Col>

                            <Col xs={24} lg={8}>
                                <Text strong>{servicedDepartmentsLabel}</Text>
                                <div style={{ marginTop: 8 }}>
                                    <Space size={[4, 4]} wrap>
                                        {record.servicedDepartments.length === 0 ? (
                                            <Tag>No service yet</Tag>
                                        ) : (
                                            record.servicedDepartments.map(dep => (
                                                <Tag color="blue" key={dep.departmentId}>
                                                    {isDepartmentScopedView
                                                        ? `${dep.servicedCount} delivered`
                                                        : `${dep.departmentName} (${dep.servicedCount})`}
                                                </Tag>
                                            ))
                                        )}
                                    </Space>
                                </div>
                            </Col>

                            <Col xs={24} lg={8}>
                                <Text strong>{missingDepartmentsLabel}</Text>
                                <div style={{ marginTop: 8 }}>
                                    <Space size={[4, 4]} wrap>
                                        {record.missingDepartments.length === 0 ? (
                                            <Tag color="green">None</Tag>
                                        ) : (
                                            record.missingDepartments.map(dep => (
                                                <Tag color="red" key={dep.departmentId}>
                                                    {isDepartmentScopedView ? 'Action needed' : dep.departmentName}
                                                </Tag>
                                            ))
                                        )}
                                    </Space>
                                </div>
                            </Col>
                        </Row>

                        <div style={{ height: 12 }} />

                        <Table<DepartmentSummary>
                            rowKey="departmentId"
                            size="small"
                            pagination={false}
                            dataSource={record.expectedDepartments}
                            columns={[
                                {
                                    title: isDepartmentScopedView ? 'Service Area' : 'Department',
                                    dataIndex: 'departmentName',
                                    key: 'departmentName'
                                },
                                {
                                    title: 'Expected Services',
                                    key: 'expectedInterventions',
                                    render: (_, dep) => (
                                        <Space size={[4, 4]} wrap>
                                            {dep.expectedInterventionTitles.length === 0 ? (
                                                <Tag>None</Tag>
                                            ) : (
                                                dep.expectedInterventionTitles.map(title => (
                                                    <Tag key={`${dep.departmentId}-${title}`}>{title}</Tag>
                                                ))
                                            )}
                                        </Space>
                                    )
                                },
                                {
                                    title: isDepartmentScopedView ? 'DP Reviewed by My Dept' : 'DP Reviewed by Dept',
                                    key: 'deptConfirmed',
                                    width: 190,
                                    render: (_, dep) => (
                                        <Tag color={dep.deptConfirmed ? 'green' : 'gold'}>
                                            {dep.deptConfirmed ? 'Reviewed' : 'Not Reviewed'}
                                        </Tag>
                                    )
                                },
                                {
                                    title: 'SME DP Confirmation',
                                    key: 'smmeConfirmed',
                                    width: 170,
                                    render: (_, dep) => (
                                        <Tag color={dep.smmeConfirmed ? 'green' : dep.deptConfirmed ? 'gold' : 'default'}>
                                            {dep.smmeConfirmed ? 'Confirmed' : dep.deptConfirmed ? 'Awaiting SME' : 'Locked Until Dept Review'}
                                        </Tag>
                                    )
                                },
                                {
                                    title: 'Services',
                                    key: 'touches',
                                    width: 100,
                                    render: (_, dep) => dep.servicedCount
                                },
                                {
                                    title: 'Completed',
                                    key: 'completed',
                                    width: 100,
                                    render: (_, dep) => dep.completedCount
                                },
                                {
                                    title: 'Pending',
                                    key: 'pending',
                                    width: 100,
                                    render: (_, dep) => dep.pendingCount
                                },
                                {
                                    title: 'Latest',
                                    key: 'latest',
                                    width: 140,
                                    render: (_, dep) =>
                                        dep.latestServiceDate
                                            ? dayjs(dep.latestServiceDate).format('DD MMM YYYY')
                                            : '—'
                                }
                            ]}
                        />
                    </div>
                )
            }}
        />
    )
}
