import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import InquiryDetail from '@/components/receptionist/InquiryDetail'
import InquiryEditModal from '@/components/receptionist/InquiryEditModal'
import RecordUnavailable from '@/components/shared/RecordUnavailable'

const ProjectAdminEditInquiryPage: React.FC = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    if (!id) {
        return <RecordUnavailable noun='inquiry' reason='missing-id' back={{ label: 'Back to inquiries', to: '/receptionist/inquiries' }} />
    }

    const backToDetails = () => navigate(`/projectadmin/inquiries/${id}`)

    return (
        <div>
            <InquiryDetail inquiryId={id} listPath={{ label: 'Back to inquiries', to: '/receptionist/inquiries' }} />
            <InquiryEditModal inquiryId={id} onClose={backToDetails} onSaved={backToDetails} />
        </div>
    )
}

export default ProjectAdminEditInquiryPage
