import React, { useMemo, useState } from 'react'
import {
  Button,
  Card,
  Empty,
  Input,
  Popover,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme
} from 'antd'
import { LeftOutlined, PlusOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import {
  BookingPhase,
  ResourceBooking,
  bookedByName,
  getBookingPhase,
  peakBookedQuantity,
  toDate
} from '@/lib/resourceBookings'
import { ResourceItem } from '@/types/resources'

const { Text, Title } = Typography

// Resource rows are cards, so every day cell matches their height
const ROW_HEIGHT = 56

interface Props {
  // Rows: bookable resources, already narrowed by the page's filters
  resources: ResourceItem[]
  // Every booking, so availability isn't skewed by search
  bookings: ResourceBooking[]
  isDesktop: boolean
  isSingle: (resource: ResourceItem) => boolean
  getTypeIcon: (type: string) => React.ReactNode
  getTypeLabel: (type: string) => string
  onEdit: (booking: ResourceBooking) => void
  onBook: (resourceId: string, day: Dayjs) => void
}

// Resource × day grid. Single-booking resources show each booking as one bar
// across its dates, so free days are the gaps; quantity resources shade each
// day by how much of the pool is in use.
const ResourceTimeline: React.FC<Props> = ({
  resources,
  bookings,
  isDesktop,
  isSingle,
  getTypeIcon,
  getTypeLabel,
  onEdit,
  onBook
}) => {
  const { token } = theme.useToken()
  const today = dayjs().startOf('day')
  const [span, setSpan] = useState<7 | 14>(isDesktop ? 14 : 7)
  const [rowSearch, setRowSearch] = useState('')
  // Weeks start on Monday
  const [start, setStart] = useState(() => today.subtract((today.day() + 6) % 7, 'day'))

  const days = useMemo(
    () => Array.from({ length: span }, (_, i) => start.add(i, 'day')),
    [start, span]
  )
  const rangeEnd = days[days.length - 1].endOf('day')

  const nameWidth = isDesktop ? 200 : 120
  const dayWidth = isDesktop ? 56 : 44
  const columns = `${nameWidth}px repeat(${span}, minmax(${dayWidth}px, 1fr))`

  // Everything except cancellations is drawn, completed ones included, but only
  // scheduled/active bookings count towards what's in use (peakBookedQuantity)
  const shownIn = (resourceId: string, from: Date, to: Date) =>
    bookings.filter(
      b =>
        b.resourceId === resourceId &&
        b.status !== 'cancelled' &&
        toDate(b.startTime) < to &&
        from < toDate(b.endTime)
    )

  const dayColumns = `repeat(${span}, minmax(${dayWidth}px, 1fr))`

  const groups = useMemo(() => {
    const map = new Map<string, ResourceItem[]>()
    const query = rowSearch.trim().toLowerCase()
    ;[...resources]
      .filter(r => !query || r.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(r => map.set(r.type, [...(map.get(r.type) || []), r]))
    return [...map.entries()].sort(([a], [b]) =>
      getTypeLabel(a).localeCompare(getTypeLabel(b))
    )
  }, [resources, rowSearch, getTypeLabel])

  const phaseColor = (phase: BookingPhase) =>
    ({
      processing: token.colorPrimary,
      success: token.colorSuccess,
      error: token.colorError,
      default: token.colorTextQuaternary
    })[phase.badge]

  const dayBackground = (day: Dayjs) =>
    day.isSame(today, 'day')
      ? token.colorPrimaryBg
      : day.day() === 0 || day.day() === 6
        ? token.colorFillQuaternary
        : 'transparent'

  const cellBorder = `1px solid ${token.colorBorderSecondary}`

  const bookingTitle = (booking: ResourceBooking) => {
    const s = dayjs(toDate(booking.startTime))
    const e = dayjs(toDate(booking.endTime))
    return `${bookedByName(booking)} · ${s.format('D MMM HH:mm')} – ${e.format(
      s.isSame(e, 'day') ? 'HH:mm' : 'D MMM HH:mm'
    )}`
  }

  const renderSingleRow = (resource: ResourceItem) => {
    const bars = shownIn(resource.id, start.toDate(), rangeEnd.toDate())

    return (
      <div style={{ display: 'grid', gridTemplateColumns: dayColumns, height: '100%' }}>
        {days.map((day, i) => (
          <div
            key={day.valueOf()}
            role='button'
            tabIndex={0}
            aria-label={`Book ${resource.name} on ${day.format('D MMMM')}`}
            onClick={() => onBook(resource.id, day)}
            style={{
              gridRow: 1,
              gridColumn: i + 1,
              minHeight: ROW_HEIGHT,
              borderLeft: cellBorder,
              background: dayBackground(day),
              cursor: 'pointer'
            }}
          />
        ))}
        {bars.map(booking => {
          const s = dayjs(toDate(booking.startTime)).startOf('day')
          const e = dayjs(toDate(booking.endTime)).startOf('day')
          const from = Math.max(0, s.diff(start, 'day'))
          const to = Math.min(span - 1, e.diff(start, 'day'))
          const phase = getBookingPhase(booking)
          const color = phaseColor(phase)
          return (
            <Tooltip key={booking.id} title={`${bookingTitle(booking)} (${phase.label})`}>
              <div
                onClick={() => onEdit(booking)}
                style={{
                  gridRow: 1,
                  gridColumn: `${from + 1} / ${to + 2}`,
                  alignSelf: 'center',
                  margin: '0 3px',
                  height: 28,
                  lineHeight: '28px',
                  padding: '0 8px',
                  borderRadius: 6,
                  background: token.colorBgContainer,
                  border: `1px solid ${color}`,
                  borderLeft: `4px solid ${color}`,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'pointer',
                  zIndex: 1,
                  boxShadow: token.boxShadowTertiary
                }}
              >
                {bookedByName(booking)}
              </div>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  const renderQuantityRow = (resource: ResourceItem) => {
    const capacity = Number(resource.capacity) || 0
    return (
      <div style={{ display: 'grid', gridTemplateColumns: dayColumns, height: '100%' }}>
        {days.map(day => {
          const dayStart = day.toDate()
          const dayEnd = day.endOf('day').toDate()
          const used = peakBookedQuantity(bookings, resource.id, dayStart, dayEnd)
          const ratio = capacity > 0 ? used / capacity : 0
          const dayBookings = shownIn(resource.id, dayStart, dayEnd)

          const fill =
            used === 0
              ? dayBackground(day)
              : ratio >= 1
                ? token.colorErrorBg
                : ratio >= 0.5
                  ? token.colorPrimaryBgHover
                  : token.colorPrimaryBg

          const cell = (
            <div
              role='button'
              tabIndex={0}
              aria-label={`${resource.name} on ${day.format('D MMMM')}: ${used} of ${capacity} booked`}
              onClick={used === 0 ? () => onBook(resource.id, day) : undefined}
              style={{
                minHeight: ROW_HEIGHT,
                display: 'grid',
                placeItems: 'center',
                borderLeft: cellBorder,
                background: fill,
                cursor: 'pointer',
                fontSize: 11,
                color: ratio >= 1 ? token.colorError : token.colorText
              }}
            >
              {used > 0 && `${used}/${capacity}`}
            </div>
          )

          if (used === 0) return <React.Fragment key={day.valueOf()}>{cell}</React.Fragment>

          return (
            <Popover
              key={day.valueOf()}
              trigger='click'
              title={`${resource.name} · ${day.format('ddd D MMM')}`}
              content={
                <Space direction='vertical' size={6} style={{ width: 260 }}>
                  <Text type='secondary' style={{ fontSize: 12 }}>
                    {Math.max(0, capacity - used)} of {capacity} free at the busiest point
                  </Text>
                  {dayBookings.map(booking => {
                    const phase = getBookingPhase(booking)
                    return (
                      <div
                        key={booking.id}
                        role='button'
                        tabIndex={0}
                        onClick={() => onEdit(booking)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 8px',
                          borderRadius: 6,
                          border: cellBorder,
                          borderLeft: `3px solid ${phaseColor(phase)}`,
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 12, display: 'block' }} ellipsis>
                            {bookedByName(booking)} · ×{booking.quantity}
                          </Text>
                          <Text type='secondary' style={{ fontSize: 11 }}>
                            {bookingTitle(booking).split(' · ')[1]}
                          </Text>
                        </div>
                        <Tag color={phase.color} style={{ marginInlineEnd: 0 }}>
                          {phase.label}
                        </Tag>
                      </div>
                    )
                  })}
                  {ratio < 1 && (
                    <Button
                      block
                      size='small'
                      icon={<PlusOutlined />}
                      onClick={() => onBook(resource.id, day)}
                    >
                      Book this day
                    </Button>
                  )}
                </Space>
              }
            >
              {cell}
            </Popover>
          )
        })}
      </div>
    )
  }

  const rangeLabel = `${start.format('D MMM')} – ${days[days.length - 1].format('D MMM YYYY')}`

  return (
    <Card style={{ borderRadius: 12 }} styles={{ body: { padding: isDesktop ? 16 : 8 } }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12
        }}
      >
        <Title level={5} style={{ margin: 0 }}>
          {rangeLabel}
        </Title>
        <Space size={8}>
          <Button
            shape='circle'
            icon={<LeftOutlined />}
            aria-label='Previous'
            onClick={() => setStart(start.subtract(span, 'day'))}
          />
          <Segmented
            value={span}
            onChange={value => setSpan(value as 7 | 14)}
            options={[
              { value: 7, label: '1 week' },
              { value: 14, label: '2 weeks' }
            ]}
          />
          <Button
            shape='circle'
            icon={<RightOutlined />}
            aria-label='Next'
            onClick={() => setStart(start.add(span, 'day'))}
          />
        </Space>
      </div>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder='Search resources in the timeline...'
        value={rowSearch}
        onChange={e => setRowSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {groups.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description='No bookable resources match your filters'
        />
      ) : (
        // Scrolls both ways inside the card: the day header stays pinned to the
        // top and the resource cards to the left. Nothing inside may set
        // overflow, or the sticky positioning stops working.
        <div
          style={{
            overflow: 'auto',
            maxHeight: 560,
            border: cellBorder,
            borderRadius: 8
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: columns,
              minWidth: nameWidth + span * dayWidth
            }}
          >
            {/* Day header */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 4,
                background: token.colorBgContainer,
                borderBottom: cellBorder
              }}
            />
            {days.map(day => {
              const isToday = day.isSame(today, 'day')
              return (
                <div
                  key={day.valueOf()}
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 3,
                    padding: '6px 0',
                    textAlign: 'center',
                    borderLeft: cellBorder,
                    borderBottom: cellBorder,
                    // Solid so rows don't show through while scrolling
                    background: isToday ? token.colorPrimaryBg : token.colorBgContainer
                  }}
                >
                  <Text type='secondary' style={{ fontSize: 11, display: 'block' }}>
                    {day.format(isDesktop ? 'ddd' : 'dd')}
                  </Text>
                  <Text
                    strong={isToday}
                    style={{ fontSize: 13, color: isToday ? token.colorPrimary : undefined }}
                  >
                    {day.date()}
                  </Text>
                </div>
              )
            })}

            {groups.map(([type, list]) => (
              <React.Fragment key={type}>
                <div
                  style={{
                    gridColumn: `1 / span ${span + 1}`,
                    background: token.colorFillTertiary,
                    borderBottom: cellBorder
                  }}
                >
                  <span
                    style={{
                      position: 'sticky',
                      left: 0,
                      display: 'inline-block',
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: token.colorTextSecondary
                    }}
                  >
                    <span style={{ marginRight: 6 }}>{getTypeIcon(type)}</span>
                    {getTypeLabel(type)} · {list.length}
                  </span>
                </div>
                {list.map(resource => (
                  <React.Fragment key={resource.id}>
                    <div
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 2,
                        padding: 4,
                        minWidth: 0,
                        background: token.colorBgContainer,
                        borderBottom: cellBorder
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          height: '100%',
                          minHeight: ROW_HEIGHT - 8,
                          padding: '4px 10px',
                          borderRadius: 8,
                          border: cellBorder,
                          background: token.colorBgContainer,
                          boxShadow: token.boxShadowTertiary
                        }}
                      >
                        <span style={{ color: token.colorTextSecondary, flexShrink: 0 }}>
                          {getTypeIcon(resource.type)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <Text
                            style={{ fontSize: 13, display: 'block' }}
                            ellipsis={{ tooltip: resource.name }}
                          >
                            {resource.name}
                          </Text>
                          <Text type='secondary' style={{ fontSize: 11 }}>
                            {isSingle(resource)
                              ? resource.seats
                                ? `${resource.seats} seats`
                                : 'Single'
                              : `${resource.capacity} total`}
                          </Text>
                        </div>
                      </div>
                    </div>
                    <div style={{ gridColumn: `2 / span ${span}`, borderBottom: cellBorder }}>
                      {isSingle(resource) ? renderSingleRow(resource) : renderQuantityRow(resource)}
                    </div>
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <Space size={16} wrap style={{ marginTop: 12 }}>
        <Text type='secondary' style={{ fontSize: 12 }}>
          Click an empty day to book it. Click a bar or a shaded day to see its bookings.
        </Text>
      </Space>
    </Card>
  )
}

export default ResourceTimeline
