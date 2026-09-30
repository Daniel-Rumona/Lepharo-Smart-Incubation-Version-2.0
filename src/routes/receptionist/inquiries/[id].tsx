import React, { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Breadcrumb, Button, Grid } from 'antd'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  EditOutlined,
  LockOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import InquiryDetail, { type InquiryStatusAction } from '@/components/receptionist/InquiryDetail'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const InquiryDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [statusAction, setStatusAction] = useState<InquiryStatusAction | null>(null)
  const isMobile = !Grid.useBreakpoint().md

  if (!id) {
    return <div>Invalid inquiry ID</div>
  }

  const handleEdit = () => {
    navigate(`/receptionist/inquiries/${id}/edit`)
  }

  const handleBack = () => {
    navigate('/receptionist/inquiries')
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
                <Link to='/receptionist/inquiries'>Inquiries</Link>
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
              {isMobile ? 'Back' : 'Back to List'}
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

      {/* The app layout scrolls and clears the mobile bottom nav, so this just flows. */}
      <div style={{ padding: '24px' }}>
        <InquiryDetail inquiryId={id} onEdit={handleEdit} onStatusAction={setStatusAction} />
      </div>
    </div>
  )
}

export default InquiryDetailPage
