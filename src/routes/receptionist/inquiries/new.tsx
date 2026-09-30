import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, Modal } from 'antd'
import InquiryForm from '@/components/receptionist/InquiryForm'
import { useActiveProgramId } from '@/lib/useActiveProgramId'

const NewInquiry: React.FC = () => {
  const navigate = useNavigate()
  const { activeProgramId } = useActiveProgramId()
  const backToList = () => navigate('/receptionist/inquiries')

  return (
    <div style={{ minHeight: '100vh', padding: '24px' }}>
      <Modal
        title='New inquiry'
        open
        onCancel={backToList}
        footer={null}
        width={860}
        style={{ maxWidth: 'calc(100vw - 24px)' }}
        centered
        destroyOnClose
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '24px 36px 0' } }}
      >
        {activeProgramId ? (
          <InquiryForm embedded stepped forcedProgramId={activeProgramId} onSuccess={backToList} />
        ) : (
          <Empty description='Select a program before creating an inquiry.' />
        )}
      </Modal>
    </div>
  )
}

export default NewInquiry
