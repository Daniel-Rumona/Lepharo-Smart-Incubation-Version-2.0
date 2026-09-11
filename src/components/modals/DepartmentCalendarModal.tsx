// components/DepartmentCalendarModal.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Modal,
    Calendar,
    Badge,
    Typography,
    Space,
    Button,
    DatePicker,
    Radio
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'
import { FieldTimeOutlined, CalendarOutlined } from '@ant-design/icons'

const { Text } = Typography
type BusyItem = {
    id: string
    title: string
    start: any
    end?: any
    kind: 'event' | 'appointment'
}

type Props = {
    open: boolean
    onClose: () => void
    departmentId: string
    onAddEvent?: (defaultDate: Dayjs) => void
    onAddAppointment?: (defaultDate: Dayjs) => void
    zIndex?: number
}

const toD = (v: any) => (v?.toDate ? dayjs(v.toDate()) : dayjs(v))

export default function DepartmentCalendarModal({
    open,
    onClose,
    departmentId,
    onAddEvent,
    onAddAppointment,
    zIndex = 2100
}: Props) {
    const [value, setValue] = useState<Dayjs>(dayjs())
    const [mode, setMode] = useState<'today' | 'week' | 'month' | 'custom'>(
        'month'
    )
    const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)

    const [events, setEvents] = useState<any[]>([])
    const [appointments, setAppointments] = useState<any[]>([])

    // live dept-scoped data
    useEffect(() => {
        if (!open || !departmentId) return
        const qE = query(
            collection(db, 'events'),
            where('departmentId', '==', departmentId)
        )
        const u1 = onSnapshot(qE, s =>
            setEvents(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
        )
        const qA = query(collection(db, 'appointments'), where('departmentId', '==', departmentId))
        const u2 = onSnapshot(qA, async s => {
            const views = await hydrateAppointmentViews(
                s.docs.map(d => ({ id: d.id, data: d.data() as any }))
            )
            setAppointments(views)
        })
        return () => {
            u1()
            u2()
        }
    }, [open, departmentId])

    const items: BusyItem[] = useMemo(() => {
        const mk = (rows: any[], kind: BusyItem['kind']) =>
            rows
                .map(r => {
                    const start = kind === 'appointment' ? toD(r.startTime) : toD(r.start || r.time || r.date)
                    const end = kind === 'appointment' ? toD(r.endTime) : r.end ? toD(r.end) : start
                    if (!start?.isValid()) return null
                    return { id: r.id, title: kind === 'appointment' ? r.sessionTitle || r.interventionTitle : r.title || 'Untitled', start, end, kind }
                })
                .filter(Boolean) as BusyItem[]

        const all = [...mk(events, 'event'), ...mk(appointments, 'appointment')]

        // filter by quick range
        let from: Dayjs
        let to: Dayjs
        if (mode === 'today') {
            from = dayjs().startOf('day')
            to = dayjs().endOf('day')
        } else if (mode === 'week') {
            from = value.startOf('week')
            to = value.endOf('week')
        } else if (mode === 'custom' && range) {
            from = range[0].startOf('day')
            to = range[1].endOf('day')
        } else {
            from = value.startOf('month').startOf('week')
            to = value.endOf('month').endOf('week')
        }
        return all.filter(i => i.start.isBetween(from, to, 'minute', '[]'))
    }, [events, appointments, value, mode, range])

    const byDay = useMemo(() => {
        const m: Record<string, BusyItem[]> = {}
        items.forEach(i => {
            const k = i.start.format('YYYY-MM-DD')
            m[k] = m[k] || []
            m[k].push(i)
        })
        Object.keys(m).forEach(k =>
            m[k].sort((a, b) => a.start.valueOf() - b.start.valueOf())
        )
        return m
    }, [items])

    const fullCellRender = (date: Dayjs) => {
        const k = date.format('YYYY-MM-DD')
        const todays = byDay[k] || []
        const isToday = date.isSame(dayjs(), 'day')

        return (
            <div style={{ minHeight: 110, padding: 6 }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 4
                    }}
                >
                    <Text strong style={{ color: isToday ? '#1677ff' : undefined }}>
                        {date.date()}
                    </Text>
                    {todays.length > 0 && <Badge count={todays.length} />}
                </div>
                <Space direction='vertical' size={4} style={{ width: '100%' }}>
                    {todays.slice(0, 4).map(i => (
                        <div
                            key={i.id}
                            style={{
                                fontSize: 12,
                                padding: '2px 6px',
                                borderRadius: 6,
                                background: i.kind === 'appointment' ? '#fff1b8' : '#e6f4ff',
                                border: '1px solid #f0f0f0',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}
                            title={`${i.start.format('HH:mm')}${i.end ? `–${i.end.format('HH:mm')}` : ''
                                } ${i.title}`}
                        >
                            <FieldTimeOutlined style={{ marginRight: 6 }} />
                            {i.start.format('HH:mm')}
                            {i.end ? `–${i.end.format('HH:mm')}` : ''} · {i.title}
                        </div>
                    ))}
                    {todays.length > 4 && (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            +{todays.length - 4} more
                        </Text>
                    )}
                </Space>
            </div>
        )
    }

    return (
        <Modal
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CalendarOutlined /> <span>Shared Busy Calendar</span>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={1000}
            zIndex={zIndex}
            bodyStyle={{ padding: 8 }}
            destroyOnClose
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px'
                }}
            >
                <Space>
                    <Button onClick={() => setValue(v => v.subtract(1, 'month'))}>
                        {'‹'} Prev
                    </Button>
                    <Text strong>{value.format('MMMM YYYY')}</Text>
                    <Button onClick={() => setValue(v => v.add(1, 'month'))}>
                        Next {'›'}
                    </Button>
                </Space>
                <Space>
                    <Radio.Group value={mode} onChange={e => setMode(e.target.value)}>
                        <Radio.Button value='today'>Today</Radio.Button>
                        <Radio.Button value='week'>This Week</Radio.Button>
                        <Radio.Button value='month'>This Month</Radio.Button>
                        <Radio.Button value='custom'>Custom</Radio.Button>
                    </Radio.Group>
                    {mode === 'custom' && (
                        <DatePicker.RangePicker
                            value={range as any}
                            onChange={(r: any) => setRange(r)}
                            allowClear={false}
                        />
                    )}
                    <Button onClick={() => onAddEvent?.(value)}>Add Event</Button>
                    <Button type='primary' onClick={() => onAddAppointment?.(value)}>
                        Book Appointment
                    </Button>
                </Space>
            </div>

            <div style={{ padding: 8 }}>
                <Calendar
                    value={value}
                    onSelect={setValue}
                    fullCellRender={fullCellRender}
                    headerRender={() => null} // we provide our own header
                    fullscreen
                />
            </div>
        </Modal>
    )
}
