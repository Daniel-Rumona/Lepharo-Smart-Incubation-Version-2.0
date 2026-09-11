import React, { useState } from 'react'
import { Card, List, Tag, Button, Space, Empty, Badge, Modal } from 'antd'
import {
    EyeOutlined,
    EditOutlined,
    UserOutlined,
    ArrowRightOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Inquiry, PRIORITY_COLORS, STATUS_COLORS } from '@/types/inquiry'
import { formatDistanceToNow } from 'date-fns'
import { MotionCard } from '../dashboards/metrics/Header'
import InquiryDetail from './InquiryDetail'

interface RecentInquiriesProps {
    inquiries: Inquiry[]
    onRefresh: () => void
}

const RecentInquiries: React.FC<RecentInquiriesProps> = ({
    inquiries,
    onRefresh
}) => {
    const navigate = useNavigate()
    const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null)

    const handleViewInquiry = (inquiryId: string) => {
        setSelectedInquiryId(inquiryId)
    }

    const handleEditInquiry = (inquiryId: string) => {
        navigate(`/receptionist/inquiries/${inquiryId}/edit`)
    }

    const handleViewAll = () => {
        navigate('/receptionist/inquiries')
    }

    if (inquiries.length === 0) {
        return (
            <MotionCard
                title='Recent Inquiries'
                extra={
                    <Button
                        icon={<ArrowRightOutlined />}
                        iconPosition='end'
                        type='link'
                        onClick={handleViewAll}
                    >
                        View All
                    </Button>
                }
            >
                <Empty
                    description='No recent inquiries'
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </MotionCard>
        )
    }

    return (
        <>
        <MotionCard
            title='Recent Inquiries'
            extra={
                <Button
                    icon={<ArrowRightOutlined />}
                    iconPosition='end'
                    type='link'
                    onClick={handleViewAll}
                >
                    View All ({inquiries.length})
                </Button>
            }
        >
            <List
                itemLayout='horizontal'
                dataSource={inquiries}
                split={false}
                pagination={{
                    pageSize: 4,
                    size: 'small',
                    hideOnSinglePage: true,
                    showSizeChanger: false,
                    position: 'bottom'
                }}
                renderItem={inquiry => (
                    <List.Item
                        key={inquiry.id}
                        style={{
                            padding: '10px 12px',
                            marginBottom: 8,
                            border: '1px solid #f0f0f0',
                            borderRadius: 10,
                            alignItems: 'center'
                        }}
                        actions={[
                            <Space key='actions' size={10} wrap={false}>
                                <Button
                                    type='default'
                                    size='middle'
                                    shape='round'
                                    icon={<EyeOutlined />}
                                    onClick={() => handleViewInquiry(inquiry.id)}
                                    style={{
                                        color: '#1677ff',
                                        borderColor: '#1677ff',
                                        background: '#e6f4ff',
                                        fontWeight: 600,
                                    }}
                                >
                                    View
                                </Button>
                                <Button
                                    type='default'
                                    size='middle'
                                    shape='round'
                                    icon={<EditOutlined />}
                                    onClick={() => handleEditInquiry(inquiry.id)}
                                    style={{
                                        color: '#d46b08',
                                        borderColor: '#fa8c16',
                                        background: '#fff7e6',
                                        fontWeight: 600,
                                    }}
                                >
                                    Edit
                                </Button>
                            </Space>
                        ]}
                    >
                        <List.Item.Meta
                            title={
                                <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    <span>
                                        {inquiry.contactInfo.firstName}{' '}
                                        {inquiry.contactInfo.lastName}
                                    </span>
                                    {inquiry.source === 'SME' && (
                                        <Badge
                                            count={<UserOutlined style={{ color: '#1890ff' }} />}
                                            title='SME Inquiry'
                                            style={{ backgroundColor: '#e6f7ff' }}
                                        />
                                    )}
                                    <Tag
                                        color={PRIORITY_COLORS[inquiry.priority]}
                                        style={{ fontSize: '10px' }}
                                    >
                                        {inquiry.priority}
                                    </Tag>
                                    <Tag
                                        color={STATUS_COLORS[inquiry.status]}
                                        style={{ fontSize: '10px' }}
                                    >
                                        {inquiry.status}
                                    </Tag>
                                    {!inquiry.programId && (
                                        <Tag color='default' style={{ fontSize: '10px' }}>
                                            Non-incubatee
                                        </Tag>
                                    )}
                                </div>
                            }
                            description={
                                <Space
                                    direction='vertical'
                                    size='small'
                                    style={{ width: '100%' }}
                                >
                                    <div style={{ color: '#666', lineHeight: 1.35 }}>
                                        {inquiry.inquiryDetails.inquiryType}
                                        {inquiry.contactInfo.company &&
                                            ` • ${inquiry.contactInfo.company}`}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#999', lineHeight: 1.3 }}>
                                        {formatDistanceToNow(inquiry.submittedAt, {
                                            addSuffix: true
                                        })}{' '}
                                        • {inquiry.source}
                                    </div>
                                </Space>
                            }
                        />
                        <div
                            style={{
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: '#666',
                                fontSize: '13px'
                            }}
                        >
                            {inquiry.inquiryDetails.description}
                        </div>
                    </List.Item>
                )}
            />
        </MotionCard>
        <Modal
            open={Boolean(selectedInquiryId)}
            onCancel={() => setSelectedInquiryId(null)}
            footer={null}
            width={1240}
            style={{ maxWidth: 'calc(100vw - 24px)' }}
            centered
            destroyOnClose
            styles={{
                body: {
                    maxHeight: '78vh',
                    overflowY: 'auto',
                    overflowX: 'hidden'
                }
            }}
        >
            {selectedInquiryId && (
                <InquiryDetail inquiryId={selectedInquiryId} embedded />
            )}
        </Modal>
        </>
    )
}

export default RecentInquiries
