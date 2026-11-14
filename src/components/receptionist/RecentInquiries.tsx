import React, { useState } from 'react'
import { Avatar, Button, Card, Drawer, Empty } from 'antd'
import { ExclamationCircleFilled, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Inquiry, PRIORITY_COLORS, STATUS_COLORS } from '@/types/inquiry'
import InquiryDetail from './InquiryDetail'
import { channelLabel, resolveInquiryAudience, resolveInquiryChannel } from '@/utils/inquirySource'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

/*
 * Five inquiries at the branch, to read only: open urgent ones first, marked
 * in red, then the newest of the rest. No paging and no editing here: both
 * happen on the inquiries page, behind "View all".
 */

const SHOWN = 5

interface RecentInquiriesProps {
    /** All the branch's inquiries, newest first. */
    inquiries: Inquiry[]
    /** The open urgent ones (inquiryService.getReceptionistDashboard decides which). */
    urgentInquiries: Inquiry[]
    onRefresh: () => void
}

const initials = (inquiry: Inquiry) =>
    `${inquiry.contactInfo.firstName?.charAt(0) || ''}${inquiry.contactInfo.lastName?.charAt(0) || ''}`.toUpperCase() || '?'

const RecentInquiries: React.FC<RecentInquiriesProps> = ({ inquiries, urgentInquiries }) => {
    const navigate = useNavigate()
    const [selectedInquiryId, setSelectedInquiryId] = useState<string | null>(null)

    const urgentIds = new Set(urgentInquiries.map(i => i.id))
    const urgentFirst = [...urgentInquiries].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
    const shown = [...urgentFirst, ...inquiries.filter(i => !urgentIds.has(i.id))].slice(0, SHOWN)
    const urgentCount = urgentInquiries.length

    return (
        <>
            <Card className='admin-card' bordered={false}>
                <div className='admin-card-head'>
                    <div>
                        <h3>Recent inquiries</h3>
                        <span>
                            {inquiries.length
                                ? urgentCount
                                    ? `${urgentCount} urgent shown first · ${inquiries.length.toLocaleString()} at your branch`
                                    : `Latest ${shown.length} of ${inquiries.length.toLocaleString()} at your branch`
                                : 'Nothing logged at your branch yet'}
                        </span>
                    </div>
                    <Button type='text' size='small' onClick={() => navigate('/inquiries')}>
                        View all <RightOutlined />
                    </Button>
                </div>

                {shown.length ? (
                    <ul className='rcp-inquiry-list'>
                        {shown.map(inquiry => {
                            const name = `${inquiry.contactInfo.firstName || ''} ${inquiry.contactInfo.lastName || ''}`.trim() || 'Unnamed contact'
                            const detail = [
                                inquiry.inquiryDetails?.inquiryType,
                                inquiry.contactInfo.company,
                                resolveInquiryAudience(inquiry as any) === 'Incubatee' ? 'SME' : inquiry.programId ? '' : 'Non-incubatee'
                            ]
                                .filter(Boolean)
                                .join(' · ')
                            return (
                                <li key={inquiry.id} className={urgentIds.has(inquiry.id) ? 'is-urgent' : undefined}>
                                    <button
                                        type='button'
                                        className='rcp-inquiry-main'
                                        onClick={() => setSelectedInquiryId(inquiry.id)}
                                        aria-label={`Open the inquiry from ${name}`}
                                    >
                                        <Avatar size={38} className='rcp-inquiry-avatar'>
                                            {initials(inquiry)}
                                        </Avatar>
                                        <span className='rcp-inquiry-copy'>
                                            <span className='rcp-inquiry-top'>
                                                <strong>{name}</strong>
                                                <time>{formatDistanceToNow(inquiry.submittedAt, { addSuffix: true })}</time>
                                            </span>
                                            <span className='rcp-inquiry-detail'>{detail || 'Inquiry'}</span>
                                            <span className='rcp-inquiry-meta'>
                                                {urgentIds.has(inquiry.id) && (
                                                    <span className='rcp-urgent-flag'>
                                                        <ExclamationCircleFilled /> Urgent
                                                    </span>
                                                )}
                                                <span className='rcp-pill' style={{ ['--pill' as any]: STATUS_COLORS[inquiry.status as keyof typeof STATUS_COLORS] || '#8c8c8c' }}>
                                                    {inquiry.status}
                                                </span>
                                                {!urgentIds.has(inquiry.id) && (
                                                    <span className='rcp-pill' style={{ ['--pill' as any]: PRIORITY_COLORS[inquiry.priority] || '#8c8c8c' }}>
                                                        {inquiry.priority}
                                                    </span>
                                                )}
                                                <span className='rcp-inquiry-channel'>{channelLabel(resolveInquiryChannel(inquiry.source))}</span>
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No inquiries yet' />
                )}
            </Card>

            <Drawer
                open={Boolean(selectedInquiryId)}
                onClose={() => setSelectedInquiryId(null)}
                width='min(720px, 100vw)'
                title={null}
                destroyOnClose
                styles={{ body: { padding: 24 } }}
            >
                {selectedInquiryId && <InquiryDetail inquiryId={selectedInquiryId} embedded />}
            </Drawer>
        </>
    )
}

export default RecentInquiries
