import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Breadcrumb, Button, Space } from 'antd'
import {
  HomeOutlined,
  ArrowLeftOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import InquiryForm from '@/components/receptionist/InquiryForm'

const ProjectAdminEditInquiryPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  if (!id) {
    return <div>Invalid inquiry ID</div>
  }

  const handleSave = () => {
    navigate(`/projectadmin/inquiries/${id}`)
  }

  const handleBack = () => {
    navigate(`/projectadmin/inquiries/${id}`)
  }

  return (
    <div>
      {/* Breadcrumb Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px'
        }}
      >
        <Breadcrumb>
          <Breadcrumb.Item>
            <Link to='/projectadmin'>
              <HomeOutlined /> Dashboard
            </Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <Link to='/projectadmin/follow-ups'>Follow-ups</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <Link to={`/projectadmin/inquiries/${id}`}>Inquiry Details</Link>
          </Breadcrumb.Item>
          <Breadcrumb.Item>Edit Inquiry</Breadcrumb.Item>
        </Breadcrumb>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
            Cancel
          </Button>
          <Button type='primary' icon={<SaveOutlined />} onClick={handleSave}>
            Save Changes
          </Button>
        </Space>
      </div>

      {/* Inquiry Form Component */}
      <InquiryForm inquiryId={id} onSuccess={handleSave} />
    </div>
  )
}

export default ProjectAdminEditInquiryPage
