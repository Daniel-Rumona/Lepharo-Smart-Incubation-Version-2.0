import React from 'react'
import { Modal, Descriptions, Table, Tag, Typography, Button, Space, Divider, Empty, theme } from 'antd'
import { EditOutlined, FilePdfOutlined, CheckCircleTwoTone, CloseCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { QualityObjective, getRatingMeta, SMART_CRITERIA_META } from '@/types/types'

const { Paragraph, Text } = Typography

interface QualityObjectiveDetailProps {
    objective: QualityObjective | null
    open: boolean
    onClose: () => void
    onEdit: (objective: QualityObjective) => void
    onPrint: (objective: QualityObjective) => void
    printing?: boolean
}

const formatDate = (value?: string) => (value ? dayjs(value).format('DD MMM YYYY') : '-')

export const QualityObjectiveDetail: React.FC<QualityObjectiveDetailProps> = ({
    objective,
    open,
    onClose,
    onEdit,
    onPrint,
    printing
}) => {
    const { token } = theme.useToken()

    if (!objective) return null

    const ratingMeta = getRatingMeta(objective.overallRating)
    const kpis = objective.kpis || []
    const kpiWeightingTotal = kpis.reduce((sum, kpi) => sum + (Number(kpi.weighting) || 0), 0)

    return (
        <Modal
            title={
                <Space direction='vertical' size={0}>
                    <Text strong>{objective.referenceNumber} · Objective {objective.objectiveNumber}</Text>
                </Space>
            }
            open={open}
            onCancel={onClose}
            width={860}
            centered
            footer={[
                <Button key='close' onClick={onClose}>Close</Button>,
                <Button key='print' icon={<FilePdfOutlined />} loading={printing} onClick={() => onPrint(objective)}>
                    Print / Export PDF
                </Button>,
                <Button key='edit' type='primary' icon={<EditOutlined />} onClick={() => onEdit(objective)}>
                    Edit
                </Button>
            ]}
        >
            <Descriptions column={{ xs: 1, sm: 2 }} size='small' style={{ marginBottom: 16 }}>
                <Descriptions.Item label='Department'>{objective.departmentName}</Descriptions.Item>
                <Descriptions.Item label='Period'>
                    {formatDate(objective.periodStart)} – {formatDate(objective.periodEnd)}
                </Descriptions.Item>
                <Descriptions.Item label='Form No / Revision'>
                    {objective.formNo} · Rev {objective.revisionNo}
                </Descriptions.Item>
                <Descriptions.Item label='Effective date'>{objective.effectiveDate || '-'}</Descriptions.Item>
            </Descriptions>

            <Paragraph style={{ background: token.colorFillAlter, padding: 12, borderRadius: token.borderRadius }}>
                {objective.objectiveText}
            </Paragraph>

            <Divider orientation='left' plain>Key Performance Area</Divider>
            <Space wrap style={{ marginBottom: 8 }}>
                <Text strong>{objective.kpaName || 'No KPA set'}</Text>
                <Tag color='geekblue'>{objective.weighting ?? 0}% weight</Tag>
            </Space>
            <div style={{ marginBottom: 16 }}>
                <Space wrap size={[8, 8]}>
                    {SMART_CRITERIA_META.map(c => {
                        const met = !!objective.smart?.[c.key]
                        return (
                            <Tag
                                key={c.key}
                                icon={met ? <CheckCircleTwoTone twoToneColor={token.colorSuccess} /> : <CloseCircleOutlined />}
                                color={met ? 'success' : 'default'}
                            >
                                {c.label}
                            </Tag>
                        )
                    })}
                </Space>
            </div>

            <Divider orientation='left' plain>Key Performance Indicators</Divider>
            {kpis.length > 0 ? (
                <Table
                    dataSource={kpis}
                    rowKey='id'
                    pagination={false}
                    size='small'
                    style={{ marginBottom: 8 }}
                    columns={[
                        { title: 'KPI', dataIndex: 'description', key: 'description' },
                        { title: 'Target', dataIndex: 'targetValue', key: 'targetValue', width: 100 },
                        { title: 'Actual', dataIndex: 'actualValue', key: 'actualValue', width: 100, render: (v: string) => v || '-' },
                        { title: 'Weighting', dataIndex: 'weighting', key: 'weighting', width: 90, render: (v: number) => `${v}%` },
                        {
                            title: 'Rating',
                            dataIndex: 'rating',
                            key: 'rating',
                            width: 130,
                            render: (rating: string) => {
                                const meta = getRatingMeta(rating as any)
                                return meta ? <Tag color={meta.color}>{meta.shortLabel}</Tag> : <Tag>Not rated</Tag>
                            }
                        }
                    ]}
                    footer={() => (
                        <Text type={kpiWeightingTotal === 100 ? 'success' : 'warning'}>
                            Total weighting: {kpiWeightingTotal}%{kpiWeightingTotal !== 100 ? ' (should be 100%)' : ''}
                        </Text>
                    )}
                />
            ) : (
                <Empty description='No KPIs captured' image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginBottom: 16 }} />
            )}

            <Divider orientation='left' plain>Means / Steps</Divider>
            {objective.steps?.length > 0 ? (
                <Table
                    dataSource={objective.steps}
                    rowKey='id'
                    pagination={false}
                    size='small'
                    style={{ marginBottom: 16 }}
                    columns={[
                        { title: 'Step', dataIndex: 'description', key: 'description' },
                        { title: 'Responsible', dataIndex: 'responsiblePerson', key: 'responsiblePerson', width: 150 },
                        { title: 'Target', dataIndex: 'targetDate', key: 'targetDate', width: 100 },
                        { title: 'Completion', dataIndex: 'completionDate', key: 'completionDate', width: 100 }
                    ]}
                />
            ) : (
                <Empty description='No steps captured' image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginBottom: 16 }} />
            )}

            <Divider orientation='left' plain>Evaluation</Divider>
            <div style={{ marginBottom: 16 }}>
                {ratingMeta ? (
                    <Tag color={ratingMeta.color} style={{ marginBottom: 8 }}>{ratingMeta.label}</Tag>
                ) : (
                    <Tag style={{ marginBottom: 8 }}>Not yet rated</Tag>
                )}
                {objective.ratingComments && <Paragraph type='secondary'>{objective.ratingComments}</Paragraph>}
            </div>

            <Divider orientation='left' plain>Sign-off</Divider>
            <Descriptions column={{ xs: 1, sm: 2 }} size='small'>
                <Descriptions.Item label='Prepared by'>{objective.preparedBy}</Descriptions.Item>
                <Descriptions.Item label='Prepared date'>{formatDate(objective.preparedDate)}</Descriptions.Item>
                <Descriptions.Item label='Approved by CEO'>{objective.approvedByCEO}</Descriptions.Item>
                <Descriptions.Item label='Acknowledged by HOD'>{objective.acknowledgedByHOD}</Descriptions.Item>
            </Descriptions>
        </Modal>
    )
}
