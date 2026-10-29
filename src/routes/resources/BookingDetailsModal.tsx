import React from 'react'
import { Button, Col, Descriptions, Modal, Popconfirm, Row, Space, Tag, Typography, theme } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  ResourceBooking,
  bookedByName,
  getBookingPhase,
  toDate
} from '@/lib/resourceBookings'
import { ResourceItem } from '@/types/resources'

const { Text } = Typography

interface Props {
  booking: ResourceBooking | null
  resource?: ResourceItem
  isSingle: boolean
  typeLabel: string
  typeIcon: React.ReactNode
  onClose: () => void
  onEdit: (booking: ResourceBooking) => void
  onDelete: (booking: ResourceBooking) => void
}

// Read-only view of a booking; editing is a deliberate second step
const BookingDetailsModal: React.FC<Props> = ({
  booking,
  resource,
  isSingle,
  typeLabel,
  typeIcon,
  onClose,
  onEdit,
  onDelete
}) => {
  const { token } = theme.useToken()
  if (!booking) return null

  const phase = getBookingPhase(booking)
  const start = dayjs(toDate(booking.startTime))
  const end = dayjs(toDate(booking.endTime))
  const sameDay = start.isSame(end, 'day')
  const hours = end.diff(start, 'hour', true)
  const duration =
    hours < 24
      ? `${Math.round(hours * 10) / 10} hour${hours === 1 ? '' : 's'}`
      : `${end.startOf('day').diff(start.startOf('day'), 'day') + 1} days`

  return (
    <Modal
      open
      onCancel={onClose}
      title='Booking Details'
      destroyOnClose
      footer={
        <Row gutter={8}>
          <Col span={12}>
            <Button
              block
              type='primary'
              icon={<EditOutlined />}
              onClick={() => onEdit(booking)}
            >
              Edit
            </Button>
          </Col>
          <Col span={12}>
            <Popconfirm
              title='Delete this booking?'
              okText='Delete'
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(booking)}
            >
              <Button block danger icon={<DeleteOutlined />}>
                Delete
              </Button>
            </Popconfirm>
          </Col>
        </Row>
      }
    >
      <Space direction='vertical' size={16} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
            {typeIcon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong style={{ fontSize: 16, display: 'block' }} ellipsis>
              {resource?.name || 'Deleted resource'}
            </Text>
            <Text type='secondary'>{typeLabel}</Text>
          </div>
          <Tag color={phase.color} style={{ marginInlineEnd: 0 }}>
            {phase.label}
          </Tag>
        </div>

        <Descriptions column={1} size='small' bordered>
          <Descriptions.Item label='SME'>{bookedByName(booking)}</Descriptions.Item>
          {booking.allocatedToEmail && (
            <Descriptions.Item label='Email'>{booking.allocatedToEmail}</Descriptions.Item>
          )}
          <Descriptions.Item label='When'>
            {sameDay
              ? `${start.format('ddd D MMM YYYY')}, ${start.format('HH:mm')} – ${end.format('HH:mm')}`
              : `${start.format('ddd D MMM, HH:mm')} – ${end.format('ddd D MMM YYYY, HH:mm')}`}
          </Descriptions.Item>
          <Descriptions.Item label='Duration'>{duration}</Descriptions.Item>
          {!isSingle && (
            <Descriptions.Item label='Quantity'>
              {booking.quantity}
              {resource && ` of ${resource.capacity}`}
            </Descriptions.Item>
          )}
          <Descriptions.Item label='Purpose'>{booking.purpose || '—'}</Descriptions.Item>
        </Descriptions>
      </Space>
    </Modal>
  )
}

export default BookingDetailsModal
