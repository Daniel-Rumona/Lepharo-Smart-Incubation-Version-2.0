import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Breadcrumb, message } from 'antd'
import { HomeOutlined, EditOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import InquiryForm from '@/components/receptionist/InquiryForm'
import { inquiryService } from '@/services/inquiryService'
import { InquiryFormFields } from '@/types/inquiry'

const EditInquiry: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [initialData, setInitialData] = useState<
    Partial<InquiryFormFields> | undefined
  >()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      loadInquiry()
    }
  }, [id])

  const loadInquiry = async () => {
    if (!id) return

    try {
      setLoading(true)
      const inquiry = await inquiryService.getInquiryById(id)

      if (!inquiry) {
        message.error('Inquiry not found')
        navigate('/receptionist/inquiries')
        return
      }

      // Convert inquiry to form data format
      const formData: Partial<InquiryFormFields> = {
        firstName: inquiry.contactInfo.firstName,
        lastName: inquiry.contactInfo.lastName,
        email: inquiry.contactInfo.email,
        phone: inquiry.contactInfo.phone,
        company: inquiry.contactInfo.company,
        position: inquiry.contactInfo.position,
        inquiryType: inquiry.inquiryDetails.inquiryType,
        businessStage: inquiry.inquiryDetails.businessStage,
        industry: inquiry.inquiryDetails.industry,
        servicesOfInterest: inquiry.inquiryDetails.servicesOfInterest,
        description: inquiry.inquiryDetails.description,
        budget: inquiry.inquiryDetails.budget,
        timeline: inquiry.inquiryDetails.timeline,
        priority: inquiry.priority,
        source: inquiry.source,
        tags: inquiry.tags,
        nextFollowUpDate: inquiry.followUp?.nextFollowUpDate
          ? new Date(inquiry.followUp.nextFollowUpDate)
          : undefined,
        followUpMethod: inquiry.followUp?.followUpMethod,
        followUpNotes: inquiry.followUp?.notes
      }

      setInitialData(formData)
    } catch (error) {
      console.error('Error loading inquiry:', error)
      message.error('Failed to load inquiry for editing')
      navigate('/receptionist/inquiries')
    } finally {
      setLoading(false)
    }
  }

  const handleSuccess = () => {
    navigate(`/receptionist/inquiries/${id}`)
  }

  if (!id) {
    return <div>Invalid inquiry ID</div>
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div>
      {/* Breadcrumb Navigation */}
      <Breadcrumb style={{ marginBottom: '16px' }}>
        <Breadcrumb.Item>
          <Link to='/receptionist/dashboard'>
            <HomeOutlined /> Dashboard
          </Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Link to='/receptionist/inquiries'>Inquiries</Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <Link to={`/receptionist/inquiries/${id}`}>Inquiry Details</Link>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <EditOutlined /> Edit
        </Breadcrumb.Item>
      </Breadcrumb>

      {/* Inquiry Form */}
      <InquiryForm
        initialData={initialData}
        inquiryId={id}
        onSuccess={handleSuccess}
      />
    </div>
  )
}

export default EditInquiry
