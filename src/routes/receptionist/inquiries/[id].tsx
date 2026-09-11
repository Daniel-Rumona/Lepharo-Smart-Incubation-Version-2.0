import React from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Breadcrumb, Button, Space } from 'antd'
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons'
import InquiryDetail from '@/components/receptionist/InquiryDetail'

const InquiryDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh' // full screen height
      }}
    >
      {/* Header / Breadcrumb Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0
        }}
      >
        <Breadcrumb>
          <Breadcrumb.Item>
            <Link to='/receptionist/inquiries'>Inquiries</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>Inquiry Details</Breadcrumb.Item>
        </Breadcrumb>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Back to List
          </Button>
          <Button type='primary' icon={<EditOutlined />} onClick={handleEdit}>
            Edit Inquiry
          </Button>
        </Space>
      </div>

      {/* Main Content - expands and scrolls if needed */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px'
        }}
      >
        <InquiryDetail inquiryId={id} onEdit={handleEdit} />
      </div>
    </div>
  )
}

export default InquiryDetailPage
