import React, { useEffect, useState } from 'react'
import { Button, Col, Descriptions, Input, Modal, Row, Tag, Typography, theme } from 'antd'
import { CheckOutlined, CloseOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { toDate } from '@/lib/resourceBookings'
import {
  REQUEST_STATUS_INFO,
  SmeResourceRequest,
  requestReason,
  requestStatus
} from '@/lib/resourceRequests'
import { ResourceItem } from '@/types/resources'
import { requestTime, requestWhen } from './RequestsView'

const { Text } = Typography

interface DetailsProps {
  request: SmeResourceRequest | null
  resource?: ResourceItem
  isSingle: boolean
  typeLabel: string
  typeIcon: React.ReactNode
  onClose: () => void
  onApprove: (request: SmeResourceRequest) => void
  onDecline: (request: SmeResourceRequest) => void
}

// Read-only view of an SME request; pending ones can be approved or declined
export const RequestDetailsModal: React.FC<DetailsProps> = ({
  request,
  resource,
  isSingle,
  typeLabel,
  typeIcon,
  onClose,
  onApprove,
  onDecline
}) => {
  const { token } = theme.useToken()
  if (!request) return null

  const status = requestStatus(request)
  const info = REQUEST_STATUS_INFO[status]
  const requestedAt = requestTime(request.requestedAt || request.createdAt)

  return (
    <Modal
      open
      onCancel={onClose}
      title='Request Details'
      destroyOnClose
      footer={
        status === 'pending' ? (
          <Row gutter={8}>
            <Col span={12}>
              <Button
                block
                type='primary'
                icon={<CheckOutlined />}
                onClick={() => onApprove(request)}
              >
                Approve
              </Button>
            </Col>
            <Col span={12}>
              <Button block danger icon={<CloseOutlined />} onClick={() => onDecline(request)}>
                Decline
              </Button>
            </Col>
          </Row>
        ) : null
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 20,
            flexShrink: 0,
            background: token.colorPrimaryBg,
            color: token.colorPrimary
          }}
        >
          {typeIcon || <InboxOutlined />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 16, display: 'block' }} ellipsis>
            {resource?.name || request.resourceName || 'Deleted resource'}
          </Text>
          <Text type='secondary'>{typeLabel}</Text>
        </div>
        <Tag color={info.color} style={{ marginInlineEnd: 0 }}>
          {info.label}
        </Tag>
      </div>

      <Descriptions column={1} size='small' bordered>
        <Descriptions.Item label='SME'>{request.requestedBy || '—'}</Descriptions.Item>
        {request.requestedByEmail && (
          <Descriptions.Item label='Email'>{request.requestedByEmail}</Descriptions.Item>
        )}
        <Descriptions.Item label='When'>{requestWhen(request)}</Descriptions.Item>
        {!isSingle && request.quantity && (
          <Descriptions.Item label='Quantity'>
            {request.quantity}
            {resource && ` of ${resource.capacity}`}
          </Descriptions.Item>
        )}
        <Descriptions.Item label='Reason'>{requestReason(request) || '—'}</Descriptions.Item>
        {request.urgency && (
          <Descriptions.Item label='Urgency'>{request.urgency}</Descriptions.Item>
        )}
        {request.deliveryMethod && (
          <Descriptions.Item label='Delivery'>{request.deliveryMethod}</Descriptions.Item>
        )}
        {requestedAt > 0 && (
          <Descriptions.Item label='Requested'>
            {dayjs(requestedAt).format('D MMM YYYY, HH:mm')}
          </Descriptions.Item>
        )}
        {status === 'declined' && (
          <Descriptions.Item label='Decline reason'>
            {request.declineReason || '—'}
          </Descriptions.Item>
        )}
      </Descriptions>
      {status === 'approved' && request.bookingId && (
        <Text type='secondary' style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          A booking was created for this request and appears under Bookings.
        </Text>
      )}
    </Modal>
  )
}

interface DeclineProps {
  request: SmeResourceRequest | null
  onClose: () => void
  onConfirm: (request: SmeResourceRequest, reason: string) => Promise<void>
}

export const DeclineRequestModal: React.FC<DeclineProps> = ({
  request,
  onClose,
  onConfirm
}) => {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (request) setReason('')
  }, [request])

  return (
    <Modal
      open={!!request}
      onCancel={onClose}
      title='Decline Request'
      destroyOnClose
      footer={
        <Button
          block
          danger
          type='primary'
          loading={saving}
          onClick={async () => {
            if (!request) return
            setSaving(true)
            try {
              await onConfirm(request, reason)
            } finally {
              setSaving(false)
            }
          }}
        >
          Decline Request
        </Button>
      }
    >
      <Text type='secondary' style={{ display: 'block', marginBottom: 8 }}>
        {request?.requestedBy || 'The SME'} will see this reason with their request.
      </Text>
      <Input.TextArea
        rows={3}
        autoFocus
        placeholder='Optional, e.g. the resource is booked for those dates'
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
    </Modal>
  )
}
