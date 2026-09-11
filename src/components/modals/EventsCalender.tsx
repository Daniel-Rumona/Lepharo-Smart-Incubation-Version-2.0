import React from 'react'
import {
  Modal,
  Calendar,
  Badge,
  Typography,
  Space,
  Segmented,
  DatePicker,
  Button
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

export type CalendarEvent = {
  id: string
  title: string
  // Any one of these shapes is OK:
  time?: any // Firestore Timestamp | Date | ISO
  start?: string | Date // ISO or Date
  end?: string | Date
  date?: string // 'YYYY-MM-DD' or ISO
  startTime?: string // 'HH:mm'
  endTime?: string // 'HH:mm'
  departmentId?: string
  participants?: Array<{ email?: string }>
  participantsEmails?: string[]
  invitedEmails?: string[]
  organizerEmail?: string
  createdBy?: string
  ownerEmail?: string
  [key: string]: any
}

type Props = {
  open: boolean
  onClose: () => void
  events: CalendarEvent[]
  onEventClick?: (ev: CalendarEvent) => void
  height?: number | string
  width?: number | string
  title?: React.ReactNode

  /** NEW: match the card filtering */
  departmentId?: string | null
  userEmail?: string | null
}

type FilterKey = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM'

const EventsCalendarModal: React.FC<Props> = ({
  open,
  onClose,
  events,
  onEventClick,
  height = '75vh',
  width = '90vw',
  title = 'Calendar',
  departmentId,
  userEmail
}) => {
  const [viewDate, setViewDate] = React.useState<Dayjs>(dayjs())
  const [filter, setFilter] = React.useState<FilterKey>('THIS_MONTH')
  const [customRange, setCustomRange] = React.useState<[Dayjs, Dayjs] | null>(
    null
  )

  const activeRange = React.useMemo<[Dayjs, Dayjs] | null>(() => {
    if (filter === 'TODAY') {
      const d = dayjs()
      return [d.startOf('day'), d.endOf('day')]
    }
    if (filter === 'THIS_WEEK') {
      const d = viewDate
      return [d.startOf('week'), d.endOf('week')]
    }
    if (filter === 'THIS_MONTH') {
      const d = viewDate
      return [d.startOf('month'), d.endOf('month')]
    }
    if (filter === 'CUSTOM' && customRange) return customRange
    return null
  }, [filter, customRange, viewDate])

  /** tolerant date resolver */
  const resolveStart = (e: CalendarEvent): Dayjs | null => {
    if (e.time?.toDate) return dayjs(e.time.toDate())
    if (e.time) return dayjs(e.time)
    if (e.start) return dayjs(e.start)
    if (e.date && e.startTime) return dayjs(`${e.date} ${e.startTime}`)
    if (e.date) return dayjs(e.date) // ISO or 'YYYY-MM-DD'
    return null
  }

  const timeLabel = (e: CalendarEvent) => {
    if (e.startTime) return e.startTime
    const d = resolveStart(e)
    return d?.isValid() ? d.format('HH:mm') : ''
  }

  /** match the card’s filtering (dept + who’s involved) */
  const filtered = React.useMemo(() => {
    let rows = Array.isArray(events) ? [...events] : []

    if (departmentId) {
      rows = rows.filter(e => (e.departmentId || '') === departmentId)
    }

    const email = (userEmail || '').trim().toLowerCase()
    if (email) {
      rows = rows.filter(e => {
        const inObjArray = (e.participants || []).some(
          (p: any) => (p?.email || '').trim().toLowerCase() === email
        )
        const inFlatArray = [
          ...(e.participantsEmails || []),
          ...(e.invitedEmails || [])
        ]
          .map((x: any) => (x || '').toLowerCase())
          .includes(email)
        const isOrganizer =
          (
            (e.organizerEmail || e.createdBy || e.ownerEmail || '') + ''
          ).toLowerCase() === email
        return inObjArray || inFlatArray || isOrganizer
      })
    }

    return rows
  }, [events, departmentId, userEmail])

  /** group by day, within active range */
  const byDay = React.useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}

    const inRange = (d: Dayjs) => {
      if (!activeRange) return true
      const [from, to] = activeRange
      if (d.isBefore(from, 'day')) return false
      if (d.isAfter(to, 'day')) return false
      return true
    }

    filtered.forEach(e => {
      const d = resolveStart(e)
      if (!d || !d.isValid() || !inRange(d)) return
      const key = d.format('YYYY-MM-DD')
      ;(map[key] ||= []).push(e)
    })

    Object.keys(map).forEach(k => {
      map[k].sort((a, b) => {
        const ta = timeLabel(a)
        const tb = timeLabel(b)
        if (ta === tb) return (a.title || '').localeCompare(b.title || '')
        return ta.localeCompare(tb)
      })
    })

    return map
  }, [filtered, activeRange])

  /** when modal opens, jump to month that actually contains the first event */
  React.useEffect(() => {
    if (!open || filtered.length === 0) return
    const first = filtered
      .map(resolveStart)
      .filter((d): d is Dayjs => !!d && d.isValid())
      .sort((a, b) => a.valueOf() - b.valueOf())[0]
    if (first && !first.isSame(viewDate, 'month')) {
      setViewDate(first)
    }
  }, [open, filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  const dateCellRender = (value: Dayjs) => {
    const key = value.format('YYYY-MM-DD')
    const items = byDay[key] || []
    if (!items.length) return null

    const maxShown = 4
    const shown = items.slice(0, maxShown)
    const more = items.length - shown.length

    return (
      <Space direction='vertical' size={4} style={{ width: '100%' }}>
        {shown.map(item => (
          <div
            key={item.id}
            onClick={e => {
              e.stopPropagation()
              onEventClick?.(item)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 6,
              background: '#f5f5f5'
            }}
          >
            <Badge color='#1677ff' />
            <Typography.Text style={{ fontSize: 12 }} ellipsis>
              {timeLabel(item) ? `${timeLabel(item)} ` : ''}
              {item.title || 'Untitled'}
            </Typography.Text>
          </div>
        ))}
        {more > 0 && (
          <Typography.Link
            onClick={e => {
              e.stopPropagation()
              onEventClick?.(items[0])
            }}
            style={{ fontSize: 12 }}
          >
            +{more} more
          </Typography.Link>
        )}
      </Space>
    )
  }

  const headerRender: React.ComponentProps<typeof Calendar>['headerRender'] = ({
    value,
    onChange
  }) => {
    React.useEffect(() => {
      if (!value.isSame(viewDate, 'month')) onChange(viewDate)
    }, [viewDate]) // eslint-disable-line

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
          flexWrap: 'wrap'
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          {viewDate.format('MMMM YYYY')}
        </Typography.Title>

        <Space size={8} style={{ marginLeft: 'auto' }} wrap>
          <Segmented
            value={filter}
            onChange={val => {
              const f = val as FilterKey
              setFilter(f)
              if (f !== 'CUSTOM') setCustomRange(null)
              if (f === 'TODAY' || f === 'THIS_WEEK' || f === 'THIS_MONTH') {
                setViewDate(dayjs())
              }
            }}
            options={[
              { label: 'Today', value: 'TODAY' },
              { label: 'This Week', value: 'THIS_WEEK' },
              { label: 'This Month', value: 'THIS_MONTH' },
              { label: 'Custom', value: 'CUSTOM' }
            ]}
          />

          {filter === 'CUSTOM' && (
            <RangePicker
              value={customRange || undefined}
              onChange={vals => {
                if (!vals || vals.length !== 2 || !vals[0] || !vals[1]) {
                  setCustomRange(null)
                  return
                }
                const r: [Dayjs, Dayjs] = [
                  vals[0].startOf('day'),
                  vals[1].endOf('day')
                ]
                setCustomRange(r)
                setViewDate(r[0])
              }}
              allowClear
              style={{ width: 300 }}
            />
          )}

          <Button
            size='small'
            onClick={() => setViewDate(d => d.subtract(1, 'month'))}
          >
            Prev
          </Button>
          <Button
            size='small'
            onClick={() => setViewDate(d => d.add(1, 'month'))}
          >
            Next
          </Button>
        </Space>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      footer={null}
      width={width}
      bodyStyle={{ padding: 0 }}
      style={{ top: 24 }}
      zIndex={1000}
      destroyOnClose
    >
      <style>{`
        .ecm .ant-picker-calendar-fullscreen
          .ant-picker-cell .ant-picker-calendar-date-content {
          min-height: 110px;
        }
      `}</style>

      <div
        className='ecm'
        style={{
          height,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <Calendar
          value={viewDate}
          onSelect={d => setViewDate(d)}
          mode='month'
          fullscreen
          headerRender={headerRender}
          dateCellRender={dateCellRender}
          style={{ flex: 1, overflow: 'auto', padding: 8 }}
        />
      </div>
    </Modal>
  )
}

export default EventsCalendarModal
