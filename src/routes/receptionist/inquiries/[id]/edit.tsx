import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import InquiryDetail from '@/components/receptionist/InquiryDetail'
import InquiryEditModal from '@/components/receptionist/InquiryEditModal'

const EditInquiry: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  if (!id) {
    return <div>Invalid inquiry ID</div>
  }

  const backToDetails = () => navigate(`/receptionist/inquiries/${id}`)

  return (
    <div>
      <InquiryDetail inquiryId={id} />
      <InquiryEditModal inquiryId={id} onClose={backToDetails} onSaved={backToDetails} />
    </div>
  )
}

export default EditInquiry
