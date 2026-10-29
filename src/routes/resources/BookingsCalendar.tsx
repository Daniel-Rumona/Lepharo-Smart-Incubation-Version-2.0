import React, { useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Row, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import {
  BookingPhase,
  ResourceBooking,
  bookedByName,
  getBookingPhase,
  toDate
} from '@/lib/resourceBookings'
import { ResourceItem } from '@/types/resources'

const { Text, Title } = Typography

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayKey = (d: Dayjs) => d.format('YYYY-MM-DD')

interface Props {
  bookings: ResourceBooking[]
  resourcesById: Map<string, ResourceItem>
  isDesktop: boolean
  isSingle: (resource: ResourceItem) => boolean
  getTypeIcon: (type: string) => React.ReactNode
  onEdit: (booking: ResourceBooking) => void
  onAdd: () => void
}

// Month grid with a day agenda underneath. Cells show at most two bookings
// (dots on phones) so the grid stays readable; the agenda has the detail.
const BookingsCalendar: React.FC<Props> = ({
  bookings,
  resourcesById,
  isDesktop,
  isSingle,
  getTypeIcon,
  onEdit,
  onAdd
}) => {
  const { token } = theme.useToken()
  const today = dayjs().startOf('day')
  const [month, setMonth] = useState(() => today.startOf('month'))
  const [selected, setSelected] = useState(today)

  const phaseColor = (phase: BookingPhase) =>
    ({
      processing: token.colorPrimary,
      success: token.colorSuccess,
      error: token.colorError,
      default: token.colorTextQuaternary
    })[phase.badge]

  // Day → bookings touching it, earliest first
  const byDay = useMemo(() => {
    const map = new Map<string, ResourceBooking[]>()
    const sorted = [...bookings].sort(
      (a, b) => toDate(a.startTime).getTime() - toDate(b.startTime).getTime()
    )
    sorted.forEach(booking => {
      let cursor = dayjs(toDate(booking.startTime)).startOf('day')
      const last = dayjs(toDate(booking.endTime)).startOf('day')
      if (!cursor.isValid() || !last.isValid()) return
      while (!cursor.isAfter(last)) {
        const key = dayKey(cursor)
        map.set(key, [...(map.get(key) || []), booking])
        cursor = cursor.add(1, 'day')
      }
    })
    return map
  }, [bookings])

  // Six Monday-first weeks covering the month
  const days = useMemo(() => {
    const offset = (month.day() + 6) % 7
    const first = month.subtract(offset, 'day')
    return Array.from({ length: 42 }, (_, i) => first.add(i, 'day'))
  }, [month])

  const goTo = (target: Dayjs) => {
    setMonth(target.startOf('month'))
    setSelected(target.startOf('day'))
  }

  const timeLabel = (booking: ResourceBooking, day: Dayjs) => {
    const start = dayjs(toDate(booking.startTime))
    const end = dayjs(toDate(booking.endTime))
    const startsToday = start.isSame(day, 'day')
    const endsToday = end.isSame(day, 'day')
    if (startsToday && endsToday) return `${start.format('HH:mm')} – ${end.format('HH:mm')}`
    if (startsToday) return `From ${start.format('HH:mm')}`
    if (endsToday) return `Until ${end.format('HH:mm')}`
    return 'All day'
  }

  const resourceName = (booking: ResourceBooking) =>
    resourcesById.get(booking.resourceId)?.name || 'Deleted resource'

  const renderChip = (booking: ResourceBooking) => {
    const phase = getBookingPhase(booking)
    const color = phaseColor(phase)
    return (
      <Tooltip
        key={booking.id}
        title={`${resourceName(booking)} · ${bookedByName(booking)} (${phase.label})`}
      >
        <div
          onClick={e => {
            e.stopPropagation()
            onEdit(booking)
          }}
          style={{
            fontSize: 11,
            lineHeight: '18px',
            padding: '0 6px',
            borderRadius: 4,
            borderLeft: `3px solid ${color}`,
            background: token.colorFillQuaternary,
            color: token.colorText,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textDecoration: booking.status === 'cancelled' ? 'line-through' : undefined,
            cursor: 'pointer'
          }}
        >
          {resourceName(booking)}
        </div>
      </Tooltip>
    )
  }

  const renderCell = (day: Dayjs) => {
    const list = byDay.get(dayKey(day)) || []
    const inMonth = day.isSame(month, 'month')
    const isToday = day.isSame(today, 'day')
    const isSelected = day.isSame(selected, 'day')
    const visible = isDesktop ? 2 : 0

    return (
      <div
        key={dayKey(day)}
        role='button'
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${day.format('D MMMM')}, ${list.length} booking${list.length === 1 ? '' : 's'}`}
        onClick={() => setSelected(day)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') setSelected(day)
        }}
        style={{
          minHeight: isDesktop ? 96 : 52,
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          minWidth: 0,
          cursor: 'pointer',
          borderRadius: 8,
          border: `1px solid ${isSelected ? token.colorPrimary : token.colorBorderSecondary}`,
          background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
          opacity: inMonth ? 1 : 0.4,
          transition: 'background 0.15s ease'
        }}
      >
        <span
          style={{
            alignSelf: isDesktop ? 'flex-start' : 'center',
            width: 24,
            height: 24,
            lineHeight: '24px',
            textAlign: 'center',
            borderRadius: '50%',
            fontSize: 12,
            fontWeight: isToday ? 600 : 400,
            background: isToday ? token.colorPrimary : 'transparent',
            color: isToday ? token.colorWhite : token.colorText
          }}
        >
          {day.date()}
        </span>
        {isDesktop ? (
          <>
            {list.slice(0, visible).map(renderChip)}
            {list.length > visible && (
              <Text type='secondary' style={{ fontSize: 11, paddingLeft: 6 }}>
                +{list.length - visible} more
              </Text>
            )}
          </>
        ) : (
          list.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 3 }}>
              {list.slice(0, 3).map(booking => (
                <span
                  key={booking.id}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: phaseColor(getBookingPhase(booking))
                  }}
                />
              ))}
            </div>
          )
        )}
      </div>
    )
  }

  const selectedList = byDay.get(dayKey(selected)) || []

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={16}>
      <Card style={{ borderRadius: 12, height: '100%' }} styles={{ body: { padding: isDesktop ? 16 : 8 } }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 12
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            {month.format('MMMM YYYY')}
          </Title>
          <Space size={8}>
            <Button
              shape='circle'
              icon={<LeftOutlined />}
              aria-label='Previous month'
              onClick={() => setMonth(month.subtract(1, 'month'))}
            />
            <Button onClick={() => goTo(today)}>Today</Button>
            <Button
              shape='circle'
              icon={<RightOutlined />}
              aria-label='Next month'
              onClick={() => setMonth(month.add(1, 'month'))}
            />
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: isDesktop ? 6 : 4
          }}
        >
          {WEEKDAYS.map(name => (
            <Text
              key={name}
              type='secondary'
              style={{ fontSize: 12, textAlign: 'center', paddingBottom: 6 }}
            >
              {isDesktop ? name : name[0]}
            </Text>
          ))}
          {days.map(renderCell)}
        </div>
      </Card>
      </Col>

      <Col xs={24} xl={8}>
      <Card
        style={{ borderRadius: 12, height: '100%' }}
        // Long days scroll inside the panel instead of stretching the grid
        styles={{ body: { maxHeight: 640, overflowY: 'auto' } }}
        title={
          <Space size={8}>
            <span>{selected.format('dddd, D MMMM')}</span>
            <Text type='secondary' style={{ fontWeight: 400 }}>
              {selectedList.length} booking{selectedList.length === 1 ? '' : 's'}
            </Text>
          </Space>
        }
      >
        {selectedList.length ? (
          <Space direction='vertical' size={8} style={{ width: '100%' }}>
            {selectedList.map(booking => {
              const resource = resourcesById.get(booking.resourceId)
              const phase = getBookingPhase(booking)
              return (
                <div
                  key={booking.id}
                  role='button'
                  tabIndex={0}
                  onClick={() => onEdit(booking)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') onEdit(booking)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderLeft: `4px solid ${phaseColor(phase)}`,
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: 18, color: token.colorTextSecondary }}>
                    {resource && getTypeIcon(resource.type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }} ellipsis>
                      {resourceName(booking)}
                    </Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                      {timeLabel(booking, selected)} · {bookedByName(booking)}
                      {resource && !isSingle(resource) && ` · ×${booking.quantity}`}
                    </Text>
                  </div>
                  <Tag color={phase.color} style={{ marginInlineEnd: 0 }}>
                    {phase.label}
                  </Tag>
                </div>
              )
            })}
          </Space>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description='No bookings on this day'
          >
            <Button icon={<PlusOutlined />} onClick={onAdd}>
              New Booking
            </Button>
          </Empty>
        )}
      </Card>
      </Col>
    </Row>
  )
}

export default BookingsCalendar
