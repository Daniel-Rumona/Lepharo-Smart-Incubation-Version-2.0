import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Breadcrumb, Button, Grid } from 'antd'
import {
    HomeOutlined,
    ArrowLeftOutlined,
    CheckCircleOutlined,
    EditOutlined,
    LockOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import InquiryDetail, { type InquiryStatusAction } from '@/components/receptionist/InquiryDetail'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const ProjectAdminInquiryDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [statusAction, setStatusAction] = useState<InquiryStatusAction | null>(null)
    const isMobile = !Grid.useBreakpoint().md

    if (!id) {
        return <div>Invalid inquiry ID</div>
    }

    const handleEdit = () => {
        navigate(`/projectadmin/inquiries/${id}/edit`)
    }

    const handleBack = () => {
        navigate('/projectadmin/follow-ups')
    }

    return (
        <div>
            <MotionCard
                style={{ margin: '16px 24px 0' }}
                styles={{ body: { padding: isMobile ? 12 : '12px 20px' } }}
            >
                <div
                    style={{
                        display: isMobile ? 'block' : 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12
                    }}
                >
                    {!isMobile && (
                        <Breadcrumb>
                            <Breadcrumb.Item>
                                <Link to='/projectadmin/follow-ups'>Follow-ups</Link>
                            </Breadcrumb.Item>
                            <Breadcrumb.Item>Inquiry Details</Breadcrumb.Item>
                        </Breadcrumb>
                    )}
                    <div
                        style={
                            isMobile
                                ? {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                    gap: 8
                                }
                                : { display: 'flex', gap: 8 }
                        }
                    >
                        <Button block={isMobile} shape='round' style={{ order: 1 }} icon={<ArrowLeftOutlined />} onClick={handleBack}>
                            {isMobile ? 'Back' : 'Back to Follow-ups'}
                        </Button>
                        {statusAction && (
                            <Button
                                block={isMobile}
                                shape='round'
                                style={isMobile ? { order: 3, gridColumn: '1 / -1' } : { order: 2 }}
                                icon={
                                    statusAction.status === 'In Progress' ? <PlayCircleOutlined />
                                        : statusAction.status === 'Resolved' ? <CheckCircleOutlined />
                                            : <LockOutlined />
                                }
                                loading={statusAction.loading}
                                onClick={statusAction.run}
                            >
                                {statusAction.label}
                            </Button>
                        )}
                        <Button block={isMobile} shape='round' type='primary' style={{ order: isMobile ? 2 : 3 }} icon={<EditOutlined />} onClick={handleEdit}>
                            Edit Inquiry
                        </Button>
                    </div>
                </div>
            </MotionCard>

            {/* Inquiry Detail Component */}
            <InquiryDetail inquiryId={id} onEdit={handleEdit} onStatusAction={setStatusAction} />
        </div>
    )
}

export default ProjectAdminInquiryDetailPage
