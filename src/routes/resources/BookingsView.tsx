import React, { useMemo } from 'react'
import {
  Button,
  Card,
  Col,
  List,
  Popconfirm,
  Result,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme
} from 'antd'
import {
  AppstoreOutlined,
  CalendarOutlined,
  FieldTimeOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import {
  getBookingPhase,
  ResourceBooking,
  bookedByName,
  toDate
} from '@/lib/resourceBookings'
import { ResourceItem } from '@/types/resources'
import BookingsCalendar from './BookingsCalendar'
import ResourceTimeline from './ResourceTimeline'

const { Text } = Typography

export type BookingsViewMode = 'list' | 'timeline' | 'month'

export const BOOKINGS_VIEW_OPTIONS = [
  { value: 'list', label: 'List', icon: <UnorderedListOutlined /> },
  { value: 'timeline', label: 'Timeline', icon: <FieldTimeOutlined /> },
  { value: 'month', label: 'Month', icon: <CalendarOutlined /> }
]

interface Props {
  bookings: ResourceBooking[]
  resourcesById: Map<string, ResourceItem>
  loading: boolean
  isDesktop: boolean
  hasFilters: boolean
  isSingle: (resource: ResourceItem) => boolean
  getTypeIcon: (type: string) => React.ReactNode
  getTypeLabel: (type: string) => string
  onAdd: () => void
  // Timeline rows (filtered bookable resources) and every booking, so its
  // availability isn't skewed by a search on SME name
  timelineResources: ResourceItem[]
  allBookings: ResourceBooking[]
  onBookSlot: (resourceId: string, day: Dayjs) => void
  hasBookableResources: boolean
  onAddResource: () => void
  // Clicking a booking anywhere opens its read-only details first
  onView: (booking: ResourceBooking) => void
  onEdit: (booking: ResourceBooking) => void
  onDelete: (booking: ResourceBooking) => void
  onClearFilters: () => void
  mode: BookingsViewMode
}


const formatRange = (booking: ResourceBooking) => {
  const start = dayjs(toDate(booking.startTime))
  const end = dayjs(toDate(booking.endTime))
  return start.isSame(end, 'day')
    ? `${start.format('D MMM YYYY, HH:mm')} – ${end.format('HH:mm')}`
    : `${start.format('D MMM, HH:mm')} – ${end.format('D MMM YYYY, HH:mm')}`
}

const BookingsView: React.FC<Props> = ({
  bookings,
  resourcesById,
  loading,
  isDesktop,
  hasFilters,
  isSingle,
  getTypeIcon,
  getTypeLabel,
  onAdd,
  timelineResources,
  allBookings,
  onBookSlot,
  hasBookableResources,
  onAddResource,
  onView,
  onEdit,
  onDelete,
  onClearFilters,
  mode
}) => {
  // The List | Timeline | Month switch lives in the page's filter bar
  const { token } = theme.useToken()

  // Newest first, so upcoming and current bookings sit at the top
  const sorted = useMemo(
    () =>
      [...bookings].sort(
        (a, b) => toDate(b.startTime).getTime() - toDate(a.startTime).getTime()
      ),
    [bookings]
  )

  const renderCard = (booking: ResourceBooking) => {
    const resource = resourcesById.get(booking.resourceId)
    const phase = getBookingPhase(booking)
    const deleteConfirm = (button: React.ReactNode) => (
      <Popconfirm
        title='Delete this booking?'
        okText='Delete'
        okButtonProps={{ danger: true }}
        onConfirm={() => onDelete(booking)}
      >
        {button}
      </Popconfirm>
    )

    return (
      <Card
        size='small'
        hoverable
        style={{ width: '100%', borderRadius: 12 }}
        onClick={() => onView(booking)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 16,
              flexShrink: 0,
              background: token.colorPrimaryBg,
              color: token.colorPrimary
            }}
          >
            {resource ? getTypeIcon(resource.type) : <CalendarOutlined />}
          </div>
          {/* Two lines: what and who, then when and why */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Text strong ellipsis style={{ minWidth: 0 }}>
                {resource?.name || 'Deleted resource'}
              </Text>
              <Tag color={phase.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                {phase.label}
              </Tag>
              <Text type='secondary' ellipsis style={{ fontSize: 12, minWidth: 0 }}>
                {bookedByName(booking)}
                {resource && !isSingle(resource) && ` · ×${booking.quantity}`}
              </Text>
            </div>
            <Text
              type='secondary'
              style={{ fontSize: 12, display: 'block' }}
              ellipsis={{ tooltip: booking.purpose || undefined }}
            >
              <CalendarOutlined style={{ marginRight: 6 }} />
              {formatRange(booking)}
              {booking.purpose && ` · ${booking.purpose}`}
            </Text>
          </div>
          {isDesktop && (
            <Space
              size='small'
              style={{ flexShrink: 0 }}
              // Actions (and their portal popups) mustn't also open the details
              onClick={e => e.stopPropagation()}
            >
              <Tooltip title='Edit booking'>
                <Button
                  shape='circle'
                  icon={<EditOutlined />}
                  onClick={() => onEdit(booking)}
                />
              </Tooltip>
              {deleteConfirm(
                <Tooltip title='Delete booking'>
                  <Button shape='circle' danger icon={<DeleteOutlined />} />
                </Tooltip>
              )}
            </Space>
          )}
        </div>
        {!isDesktop && (
          <Row gutter={8} style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
            <Col span={12}>
              <Button block icon={<EditOutlined />} onClick={() => onEdit(booking)}>
                Edit
              </Button>
            </Col>
            <Col span={12}>
              {deleteConfirm(
                <Button block danger icon={<DeleteOutlined />}>
                  Delete
                </Button>
              )}
            </Col>
          </Row>
        )}
      </Card>
    )
  }

  return (
    <div>
      {mode === 'timeline' ? (
        <ResourceTimeline
          resources={timelineResources}
          bookings={allBookings}
          isDesktop={isDesktop}
          isSingle={isSingle}
          getTypeIcon={getTypeIcon}
          getTypeLabel={getTypeLabel}
          onEdit={onView}
          onBook={onBookSlot}
        />
      ) : mode === 'month' ? (
        <BookingsCalendar
          bookings={bookings}
          resourcesById={resourcesById}
          isDesktop={isDesktop}
          isSingle={isSingle}
          getTypeIcon={getTypeIcon}
          onEdit={onView}
          onAdd={onAdd}
        />
      ) : (
        <List
          dataSource={sorted}
          rowKey='id'
          loading={loading}
          split={false}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{
            emptyText: hasFilters ? (
              <Result
                icon={<CalendarOutlined />}
                title='No bookings found'
                subTitle='Nothing matches your search or filters.'
                extra={<Button onClick={onClearFilters}>Clear filters</Button>}
              />
            ) : !hasBookableResources ? (
              <Result
                icon={<AppstoreOutlined />}
                title='Add resources first'
                subTitle='Bookings are made against external resources. Add one before creating a booking.'
                extra={
                  <Button type='primary' icon={<PlusOutlined />} onClick={onAddResource}>
                    Add Resource
                  </Button>
                }
              />
            ) : (
              <Result
                icon={<CalendarOutlined />}
                title='No bookings yet'
                subTitle='Book an external resource for an SME to see it here.'
                extra={
                  <Button type='primary' icon={<PlusOutlined />} onClick={onAdd}>
                    New Booking
                  </Button>
                }
              />
            )
          }}
          renderItem={booking => (
            <List.Item style={{ padding: '6px 0' }}>{renderCard(booking)}</List.Item>
          )}
        />
      )}
    </div>
  )
}

export default BookingsView
