import React, { useState } from 'react'
import { Card, List, Tag, Button, Badge, Empty, Space, Modal } from 'antd'
import {
    ExclamationCircleOutlined,
    ClockCircleOutlined,
    EyeOutlined,
    UserOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Inquiry, PRIORITY_COLORS } from '@/types/inquiry'
import { formatDistanceToNow } from 'date-fns'
import { MotionCard } from '../dashboards/metrics/Header'
import InquiryDetail from './InquiryDetail'

interface UrgentInquiriesProps {
    urgentInquiries: Inquiry[]
    pendingFollowUps: number
    onRefresh: () => void
}

const UrgentInquiries: React.FC<UrgentInquiriesProps> = ({
    urgentInquiries,
    pendingFollowUps,
    onRefresh
}) => {
    const navigate = useNavigate()
    const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null)

    const handleViewInquiry = (inquiryId: string) => {
        setSelectedInquiryId(inquiryId)
    }

    const handleViewFollowUps = () => {
        navigate('/receptionist/follow-ups')
    }

    return (
        <div style={{ width: '100%' }}>
            {pendingFollowUps > 0 && (
                <MotionCard
                    size='small'
                    style={{
                        border: '1px solid #fa8c16',
                        backgroundColor: '#fff7e6',
                        marginBottom: 12
                    }}
                >
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <span>
                            <ClockCircleOutlined style={{ color: '#fa8c16', marginRight: 8 }} />
                            <span style={{ fontWeight: 500 }}>
                                {pendingFollowUps} Pending Follow-up
                                {pendingFollowUps > 1 ? 's' : ''}
                            </span>
                        </span>
                        <Button
                            type='link'
                            size='small'
                            onClick={handleViewFollowUps}
                            style={{ color: '#fa8c16', paddingInline: 0 }}
                        >
                            View All
                        </Button>
                    </Space>
                </MotionCard>
            )}

            <MotionCard
                size='small'
                title={
                    <span>
                        <ExclamationCircleOutlined
                            style={{ color: '#f5222d', marginRight: 8 }}
                        />
                        Urgent Inquiries
                    </span>
                }
                extra={
                    urgentInquiries.length > 0 && (
                        <Badge
                            count={urgentInquiries.length}
                            style={{ backgroundColor: '#f5222d' }}
                        />
                    )
                }
            >
                {urgentInquiries.length === 0 ? (
                    <Empty
                        description='No urgent inquiries'
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                ) : (
                    <List
                        size='small'
                        dataSource={urgentInquiries}
                        renderItem={inquiry => (
                            <List.Item
                                key={inquiry.id}
                                style={{ alignItems: 'center' }}
                                actions={[
                                    <Button
                                        key='view'
                                        type='default'
                                        icon={<EyeOutlined />}
                                        size='middle'
                                        shape='round'
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
                                ]}
                            >
                                <List.Item.Meta
                                    title={
                                        <Space size={[6, 4]} wrap>
                                            <span>
                                                {inquiry.contactInfo.firstName} {inquiry.contactInfo.lastName}
                                            </span>
                                            <Tag color={PRIORITY_COLORS[inquiry.priority]}>
                                                {inquiry.priority}
                                            </Tag>
                                            {!inquiry.programId && <Tag>Non-incubatee</Tag>}
                                        </Space>
                                    }
                                    description={
                                        <Space direction='vertical' size={2} style={{ width: '100%' }}>
                                            <span style={{ color: '#595959' }}>
                                                {inquiry.inquiryDetails.inquiryType}
                                                {inquiry.contactInfo.company
                                                    ? ` • ${inquiry.contactInfo.company}`
                                                    : ''}
                                            </span>
                                            <span
                                                style={{
                                                    color: '#595959',
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden'
                                                }}
                                            >
                                                {inquiry.inquiryDetails.description}
                                            </span>
                                            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                                                {formatDistanceToNow(inquiry.submittedAt, { addSuffix: true })}
                                                {' • '}{inquiry.source}
                                                {inquiry.contactInfo.email
                                                    ? ` • ${inquiry.contactInfo.email}`
                                                    : inquiry.contactInfo.phone
                                                        ? ` • ${inquiry.contactInfo.phone}`
                                                        : ''}
                                            </span>
                                        </Space>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                )}
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
        </div>
    )
}

export default UrgentInquiries
