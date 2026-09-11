import { Alert, Collapse, Empty, Progress, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

import { buildServiceProgressRows, getActionStatusColor } from '../riskEngine'
import type { ServiceProgressRow, SMERow } from '../types'

const { Title, Text } = Typography

type Props = {
    row: SMERow
    isDepartmentScopedView: boolean
}

export default function DepartmentServiceCollapse({ row, isDepartmentScopedView }: Props) {
    const awaitingDepartmentReview = row.expectedDepartments.filter(dep => !dep.deptConfirmed)
    const awaitingSmeConfirmation = row.expectedDepartments.filter(dep => dep.deptConfirmed && !dep.smmeConfirmed)
    const readyDepartments = row.expectedDepartments.filter(dep => dep.deptConfirmed && dep.smmeConfirmed)

    return (
        <>
            <Title level={5} style={{ marginTop: 0 }}>Service delivery</Title>

            {row.expectedDepartments.length === 0 ? (
                <Empty description={isDepartmentScopedView ? 'No services found for my department' : 'No Developmental Plan services found'} />
            ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {awaitingDepartmentReview.map(dep => (
                        <Alert
                            key={`department-review-${dep.departmentId}`}
                            type="warning"
                            showIcon
                            message={`${dep.departmentName}: awaiting department review`}
                            description="The department has not reviewed this SME’s Developmental Plan yet. Services cannot be planned until that review is complete."
                        />
                    ))}

                    {awaitingSmeConfirmation.map(dep => (
                        <Alert
                            key={`sme-confirmation-${dep.departmentId}`}
                            type="info"
                            showIcon
                            message={`${dep.departmentName}: awaiting SME DP confirmation`}
                            description="The department has reviewed the Developmental Plan. The SME still needs to confirm it before services can be planned or delivered."
                        />
                    ))}

                    {readyDepartments.length === 0 ? (
                        <Alert
                            type="info"
                            showIcon
                            message="No services are ready to deliver yet."
                            description="The status messages above show the exact confirmation currently holding up service delivery."
                        />
                    ) : (
                        <>
                            <Text type="secondary">Only confirmed Developmental Plan services are shown below.</Text>
                            <Collapse
                                items={readyDepartments.map(dep => ({
                                    key: dep.departmentId,
                                    label: (
                                        <Space wrap>
                                            <Text strong>{dep.departmentName}</Text>
                                            <Tag color="green">Ready for service planning</Tag>
                                            <Tag color="blue">Services {dep.servicedCount}</Tag>
                                            <Tag color="green">Completed {dep.completedCount}</Tag>
                                            {dep.pendingCount > 0 && <Tag color="gold">Pending {dep.pendingCount}</Tag>}
                                            {dep.declinedCount > 0 && <Tag color="volcano">Declined {dep.declinedCount}</Tag>}
                                        </Space>
                                    ),
                                    children: dep.expectedInterventionTitles.length === 0 && dep.actions.length === 0 ? (
                                        <Alert type="warning" showIcon message="No expected or assigned services found." />
                                    ) : (
                                        <Table<ServiceProgressRow>
                                            rowKey="key"
                                            size="small"
                                            pagination={buildServiceProgressRows(dep).length > 5 ? { pageSize: 5, showSizeChanger: false } : false}
                                            dataSource={buildServiceProgressRows(dep)}
                                            columns={[
                                                {
                                                    title: 'Service', key: 'expectedTitle', render: (_, progressRow) => (
                                                        <Space size={6} wrap><Text>{progressRow.expectedTitle}</Text>{!progressRow.isExpected && <Tag>Extra assignment</Tag>}</Space>
                                                    )
                                                },
                                                {
                                                    title: 'Status', key: 'status', width: 120, render: (_, progressRow) => progressRow.action
                                                        ? <Tag color={getActionStatusColor(progressRow.action.status)}>{progressRow.action.status || 'Unknown'}</Tag>
                                                        : <Tag>Not assigned</Tag>
                                                },
                                                { title: 'Hold-up', key: 'bottleneck', width: 220, render: (_, progressRow) => progressRow.action?.bottleneck || 'Ready to assign' },
                                                { title: 'Facilitator', dataIndex: 'consultantName', key: 'consultantName', width: 150, render: (value?: string) => value || '—' },
                                                { title: 'Cycle', dataIndex: 'cycleKey', key: 'cycleKey', width: 120, render: (value?: string | null) => value || '—' },
                                                { title: 'Progress', key: 'progress', width: 120, render: (_, progressRow) => <Progress percent={Math.round(Number(progressRow.progress || 0))} size="small" /> },
                                                { title: 'Latest activity', key: 'date', width: 140, render: (_, progressRow) => progressRow.date ? dayjs(progressRow.date).format('DD MMM YYYY') : '—' }
                                            ]}
                                        />
                                    )
                                }))}
                            />
                        </>
                    )}
                </Space>
            )}
        </>
    )
}
