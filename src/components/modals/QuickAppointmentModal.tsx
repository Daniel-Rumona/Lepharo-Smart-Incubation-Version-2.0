// components/QuickAppointmentModal.tsx
import React, { useEffect, useState } from 'react'
import { Modal, Form, Input, DatePicker, Select, message, Alert } from 'antd'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    setDoc,
    doc,
    Timestamp
} from 'firebase/firestore'

export default function QuickAppointmentModal({
    open,
    onClose,
    departmentId
}: {
    open: boolean
    onClose: () => void
    departmentId: string
}) {
    const [form] = Form.useForm()
    const [people, setPeople] = useState<{ id: string; name: string }[]>([])
    const [busyConflicts, setBusyConflicts] = useState<string[]>([])

    useEffect(() => {
        if (!open) return
            ; (async () => {
                const snap = await getDocs(
                    query(
                        collection(db, 'users'),
                        where('departmentId', '==', departmentId)
                    )
                )
                setPeople(
                    snap.docs.map(d => {
                        const u: any = d.data()
                        return {
                            id: d.id,
                            name: u.name || u.displayName || u.email || 'Unnamed'
                        }
                    })
                )
            })()
    }, [open, departmentId])

    const checkClashes = async (
        start: dayjs.Dayjs,
        end: dayjs.Dayjs,
        attendeeIds: string[]
    ) => {
        if (!start || !attendeeIds?.length) return []
        const evSnap = await getDocs(
            query(
                collection(db, 'events'),
                where('departmentId', '==', departmentId)
            )
        )
        const rows = evSnap.docs.map(d => ({
            id: d.id,
            ...(d.data() as any)
        }))
        const conflicts = rows.filter(r => {
            const s = r.start?.toDate ? dayjs(r.start.toDate()) : dayjs(r.start)
            const e = r.end?.toDate ? dayjs(r.end.toDate()) : dayjs(r.end || r.start)
            if (!s?.isValid()) return false
            const timeOverlap = s.isBefore(end) && e.isAfter(start)
            const audience = (r.attendees || []) as string[]
            return timeOverlap && audience.some(a => attendeeIds.includes(a))
        })
        return conflicts.map(o => o.title || 'Busy')
    }

    const onOk = async () => {
        try {
            const vals = await form.validateFields()
            const start = vals.range[0]
            const end = vals.range[1]
            const attendees: string[] = vals.attendees || []
            const conflicts = await checkClashes(start, end, attendees)
            if (conflicts.length) {
                setBusyConflicts(conflicts.slice(0, 5))
                return
            }

            const id = `event-${Date.now()}`
            await setDoc(doc(db, 'events', id), {
                id,
                title: vals.title,
                start: Timestamp.fromDate(start.toDate()),
                end: Timestamp.fromDate(end.toDate()),
                attendees,
                departmentId,
                createdAt: Timestamp.now()
            })
            message.success('Appointment booked')
            form.resetFields()
            setBusyConflicts([])
            onClose()
        } catch (e) {
            /* noop */
        }
    }

    return (
        <Modal
            open={open}
            onCancel={() => {
                setBusyConflicts([])
                onClose()
            }}
            onOk={onOk}
            title='Book Appointment'
            okText='Book'
        >
            {busyConflicts.length > 0 && (
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Clash detected'
                    description={`Conflicts with: ${busyConflicts.join(', ')}`}
                />
            )}
            <Form layout='vertical' form={form}>
                <Form.Item name='title' label='Subject' rules={[{ required: true }]}>
                    <Input placeholder='e.g. Client discovery call' />
                </Form.Item>
                <Form.Item name='range' label='When' rules={[{ required: true }]}>
                    <DatePicker.RangePicker showTime style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name='attendees' label='With'>
                    <Select
                        mode='multiple'
                        allowClear
                        options={people.map(p => ({ value: p.id, label: p.name }))}
                        placeholder='Choose teammates'
                    />
                </Form.Item>
            </Form>
        </Modal>
    )
}
