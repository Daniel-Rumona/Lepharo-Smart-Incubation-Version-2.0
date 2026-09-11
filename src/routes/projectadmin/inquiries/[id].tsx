import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Breadcrumb, Button, Space } from 'antd'
import {
  HomeOutlined,
  ArrowLeftOutlined,
  EditOutlined
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import InquiryDetail from '@/components/receptionist/InquiryDetail'

const ProjectAdminInquiryDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh' // full screen height
      }}
    >
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
        {/* Breadcrumb Navigation */}
        <Breadcrumb>
          <Breadcrumb.Item>
            <Link to='/projectadmin/follow-ups'>Follow-ups</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>Inquiry Details</Breadcrumb.Item>
        </Breadcrumb>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Back to Follow-ups
          </Button>
          <Button type='primary' icon={<EditOutlined />} onClick={handleEdit}>
            Edit Inquiry
          </Button>
        </Space>
      </div>

      {/* Inquiry Detail Component */}
      <InquiryDetail inquiryId={id} onEdit={handleEdit} />
    </div>
  )
}

export default ProjectAdminInquiryDetailPage
