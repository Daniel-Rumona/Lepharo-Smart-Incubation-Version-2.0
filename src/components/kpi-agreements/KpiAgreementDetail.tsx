import React from 'react'
import { Modal, Descriptions, Table, Tag, Typography, Button, Space, Divider, Empty } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { KpiAgreement } from '@/types/types'

const { Text } = Typography

interface KpiAgreementDetailProps {
    agreement: KpiAgreement | null
    open: boolean
    onClose: () => void
    onEdit: (agreement: KpiAgreement) => void
}

export const KpiAgreementDetail: React.FC<KpiAgreementDetailProps> = ({ agreement, open, onClose, onEdit }) => {
    if (!agreement) return null

    const hasSignOff = (name?: string) => !!name?.trim()

    return (
        <Modal
            title={
                <Space direction='vertical' size={0}>
                    <Text strong>{agreement.serviceName || agreement.departmentName}</Text>
                </Space>
            }
            open={open}
            onCancel={onClose}
            width={820}
            footer={[
                <Button key='close' onClick={onClose}>Close</Button>,
                <Button key='edit' type='primary' icon={<EditOutlined />} onClick={() => onEdit(agreement)}>Edit</Button>
            ]}
        >
            <Descriptions column={{ xs: 1, sm: 2 }} size='small' style={{ marginBottom: 16 }}>
                <Descriptions.Item label='Department'>{agreement.departmentName}</Descriptions.Item>
                <Descriptions.Item label='Financial year'>{agreement.fyLabel || '-'}</Descriptions.Item>
                <Descriptions.Item label='Form No / Revision'>{agreement.formNo} · Rev {agreement.revisionNo}</Descriptions.Item>
                <Descriptions.Item label='Effective date'>{agreement.effectiveDate || '-'}</Descriptions.Item>
                <Descriptions.Item label='Monthly capacity' span={2}>{agreement.monthlyCapacity || '-'}</Descriptions.Item>
                {agreement.source?.fileName && (
                    <Descriptions.Item label='Imported from' span={2}>{agreement.source.fileName}</Descriptions.Item>
                )}
            </Descriptions>

            <Divider orientation='left' plain>Numeric Targets</Divider>
            {agreement.numericTargets?.length > 0 ? (
                <Table
                    dataSource={agreement.numericTargets}
                    rowKey='id'
                    pagination={false}
                    size='small'
                    style={{ marginBottom: 16 }}
                    columns={[
                        { title: 'KPI', dataIndex: 'kpiName', key: 'kpiName' },
                        { title: 'Annual', dataIndex: 'annual', key: 'annual', width: 80 },
                        { title: 'Q1', dataIndex: 'q1', key: 'q1', width: 60 },
                        { title: 'Q2', dataIndex: 'q2', key: 'q2', width: 60 },
                        { title: 'Q3', dataIndex: 'q3', key: 'q3', width: 60 },
                        { title: 'Q4', dataIndex: 'q4', key: 'q4', width: 60 }
                    ]}
                />
            ) : (
                <Empty description='No numeric targets' image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginBottom: 16 }} />
            )}

            <Divider orientation='left' plain>Deliverables</Divider>
            {agreement.deliverables?.length > 0 ? (
                <Table
                    dataSource={agreement.deliverables}
                    rowKey='id'
                    pagination={false}
                    size='small'
                    style={{ marginBottom: 16 }}
                    columns={[
                        { title: 'KPI Area', dataIndex: 'kpiArea', key: 'kpiArea', width: 160 },
                        { title: 'Deliverable', dataIndex: 'deliverable', key: 'deliverable' },
                        { title: 'Measurement Indicator', dataIndex: 'measurementIndicator', key: 'measurementIndicator' },
                        { title: 'Frequency', dataIndex: 'frequency', key: 'frequency', width: 100 }
                    ]}
                />
            ) : (
                <Empty description='No deliverables' image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginBottom: 16 }} />
            )}

            <Divider orientation='left' plain>Sign-off</Divider>
            <Space wrap style={{ marginBottom: 8 }}>
                <Tag color={hasSignOff(agreement.signOff?.hod?.name) ? 'green' : 'default'}>
                    HOD: {agreement.signOff?.hod?.name || 'Not signed'}
                </Tag>
                <Tag color={hasSignOff(agreement.signOff?.centerManager?.name) ? 'green' : 'default'}>
                    Center Manager: {agreement.signOff?.centerManager?.name || 'Not signed'}
                </Tag>
                <Tag color={hasSignOff(agreement.signOff?.ceo?.name) ? 'green' : 'default'}>
                    CEO: {agreement.signOff?.ceo?.name || 'Not signed'}
                </Tag>
            </Space>
        </Modal>
    )
}
