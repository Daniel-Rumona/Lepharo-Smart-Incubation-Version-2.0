import React from 'react'
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  List,
  Space,
  Tag,
  Typography
} from 'antd'
import { CalendarOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  getBookingPhase,
  ResourceBooking,
  bookedByName,
  toDate,
  upcomingBookings
} from '@/lib/resourceBookings'
import { ResourceItem, isBookableResource } from '@/types/resources'

const { Text, Paragraph } = Typography

interface Props {
  resource: ResourceItem | null
  bookings: ResourceBooking[]
  // Below md it opens as a bottom sheet, matching how modals behave there
  isMobile: boolean
  isSingle: boolean
  typeLabel: string
  statusTag: React.ReactNode
  availability: React.ReactNode
  onClose: () => void
  onEdit: () => void
  onBook: () => void
  onEditBooking: (booking: ResourceBooking) => void
}

const ResourceDrawer: React.FC<Props> = ({
  resource,
  bookings,
  isMobile,
  isSingle,
  typeLabel,
  statusTag,
  availability,
  onClose,
  onEdit,
  onBook,
  onEditBooking
}) => {
  const bookable = !!resource && isBookableResource(resource)
  const blocked =
    resource?.status === 'maintenance' || resource?.status === 'unavailable'
  const upcoming = resource ? upcomingBookings(resource.id, bookings) : []

  return (
    <Drawer
      open={!!resource}
      onClose={onClose}
      {...(isMobile
        ? {
            placement: 'bottom' as const,
            height: '92dvh',
            rootClassName: 'modal-style-drawer responsive-sheet-drawer',
            styles: {
              // Rounded like the mobile modal sheets
              content: { borderRadius: '20px 20px 0 0' },
              body: { padding: '4px 16px 16px' },
              footer: { padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }
            }
          }
        : { width: 440 })}
      title={resource?.name}
      extra={
        <Button shape='circle' icon={<EditOutlined />} onClick={onEdit} />
      }
      footer={
        bookable && (
          <Button
            type='primary'
            block
            icon={<PlusOutlined />}
            disabled={blocked}
            onClick={onBook}
          >
            {blocked ? `Can't book while ${resource?.status}` : 'Book'}
          </Button>
        )
      }
    >
      {resource && (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {availability}
            <Space direction='vertical' size={4}>
              <Space size={8} wrap>
                {statusTag}
                <Tag>{bookable ? 'External' : 'Internal'}</Tag>
              </Space>
              <Text type='secondary'>{typeLabel}</Text>
            </Space>
          </div>

          <Descriptions column={1} size='small' bordered>
            {isSingle ? (
              <Descriptions.Item label='Seats'>
                {resource.seats || '—'}
              </Descriptions.Item>
            ) : (
              <Descriptions.Item label='Quantity'>{resource.capacity}</Descriptions.Item>
            )}
          </Descriptions>

          {resource.description && (
            <Paragraph type='secondary' style={{ margin: 0 }}>
              {resource.description}
            </Paragraph>
          )}

          {bookable && (
            <div>
              <Text strong>Upcoming bookings</Text>
              {upcoming.length ? (
                <List
                  style={{ marginTop: 8 }}
                  split={false}
                  dataSource={upcoming}
                  rowKey='id'
                  renderItem={booking => {
                    const phase = getBookingPhase(booking)
                    return (
                      <List.Item style={{ padding: '4px 0' }}>
                        <Card
                          size='small'
                          hoverable
                          style={{ width: '100%' }}
                          onClick={() => onEditBooking(booking)}
                        >
                          <Space size={8} wrap>
                            <Text strong>{bookedByName(booking)}</Text>
                            <Tag color={phase.color}>{phase.label}</Tag>
                            {!isSingle && <Text type='secondary'>× {booking.quantity}</Text>}
                          </Space>
                          <div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                              <CalendarOutlined style={{ marginRight: 6 }} />
                              {dayjs(toDate(booking.startTime)).format('D MMM, HH:mm')} –{' '}
                              {dayjs(toDate(booking.endTime)).format('D MMM YYYY, HH:mm')}
                            </Text>
                          </div>
                        </Card>
                      </List.Item>
                    )
                  }}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description='No upcoming bookings'
                />
              )}
            </div>
          )}
        </Space>
      )}
    </Drawer>
  )
}

export default ResourceDrawer
