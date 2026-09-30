import React, { useEffect, useState } from 'react'
import { Modal, Spin, message } from 'antd'
import dayjs from 'dayjs'
import InquiryForm from '@/components/receptionist/InquiryForm'
import { inquiryService } from '@/services/inquiryService'
import { resolveInquiryChannel } from '@/utils/inquirySource'

type Props = {
    /** The inquiry to edit; the modal is open while this is set. */
    inquiryId: string | null
    onClose: () => void
    onSaved: () => void
}

/**
 * Edit an inquiry one section at a time: the modal opens on cards for each
 * section, and the chosen section shows Back and Update at full width.
 */
const InquiryEditModal: React.FC<Props> = ({ inquiryId, onClose, onSaved }) => {
    const [initialData, setInitialData] = useState<Record<string, any> | null>(null)

    useEffect(() => {
        if (!inquiryId) {
            setInitialData(null)
            return
        }

        let cancelled = false
        setInitialData(null)

        inquiryService
            .getInquiryById(inquiryId)
            .then(inquiry => {
                if (cancelled) return
                if (!inquiry) {
                    message.error('Inquiry not found')
                    onClose()
                    return
                }

                const audience = inquiry.sourceType || (inquiry.programId ? 'Incubatee' : 'Non-Incubatee')
                const channel = resolveInquiryChannel(inquiry.source)

                setInitialData({
                    firstName: inquiry.contactInfo.firstName,
                    lastName: inquiry.contactInfo.lastName,
                    email: inquiry.contactInfo.email,
                    phone: inquiry.contactInfo.phone,
                    company: inquiry.contactInfo.company,
                    position: inquiry.contactInfo.position,
                    inquiryType: inquiry.inquiryDetails.inquiryType,
                    businessStage: inquiry.inquiryDetails.businessStage,
                    industry: inquiry.inquiryDetails.industry,
                    department:
                        inquiry.inquiryDetails.department ||
                        inquiry.inquiryDetails.servicesOfInterest?.[0],
                    description: inquiry.inquiryDetails.description,
                    budget: inquiry.inquiryDetails.budget,
                    timeline: inquiry.inquiryDetails.timeline,
                    priority: inquiry.priority,
                    classification: inquiry.classification || 'General',
                    sourceTypeInternal: audience,
                    sourceType: audience,
                    programId: inquiry.programId || undefined,
                    smeParticipantId: inquiry.participantId || undefined,
                    representative: Boolean(inquiry.isRepresentative),
                    // Portal inquiries keep the source they arrived with.
                    source: channel === 'System' ? inquiry.source : channel,
                    tags: inquiry.tags,
                    nextFollowUpDate: inquiry.followUp?.nextFollowUpDate
                        ? dayjs(inquiry.followUp.nextFollowUpDate)
                        : undefined,
                    followUpMethod: inquiry.followUp?.followUpMethod,
                    followUpNotes: inquiry.followUp?.notes
                })
            })
            .catch(error => {
                console.error('Error loading inquiry for editing:', error)
                if (cancelled) return
                message.error('Failed to load inquiry for editing')
                onClose()
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inquiryId])

    return (
        <Modal
            title='Edit inquiry'
            open={Boolean(inquiryId)}
            onCancel={onClose}
            footer={null}
            width={760}
            style={{ maxWidth: 'calc(100vw - 24px)' }}
            centered
            destroyOnClose
            styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '24px 36px 0' } }}
        >
            {!initialData ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                    <Spin />
                </div>
            ) : (
                <InquiryForm
                    embedded
                    sectioned
                    inquiryId={inquiryId || undefined}
                    initialData={initialData as any}
                    forcedProgramId={initialData.programId || undefined}
                    onSuccess={onSaved}
                />
            )}
        </Modal>
    )
}

export default InquiryEditModal
