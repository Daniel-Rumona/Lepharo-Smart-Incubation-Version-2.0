import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Col, DatePicker, Divider, Form, InputNumber, Modal, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { CalendarOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
    CYCLE_STATUSES,
    DEFAULT_FY_START_MONTH,
    buildCycle,
    cycleForDate,
    type CycleStatus,
    type PerformanceCycle
} from './ipm'

const { Text } = Typography
const { RangePicker } = DatePicker

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: dayjs().month(i).format('MMMM') }))

type WindowKey = 'compacting' | 'midYear' | 'yearEnd'
const WINDOWS: { key: WindowKey; label: string; help: string }[] = [
    { key: 'compacting', label: 'Compacting', help: 'Sessions 1-2: goals, compacts and PDPs agreed and signed.' },
    { key: 'midYear', label: 'Mid-year review', help: 'Session 4: self-assessment, manager assessment and feedback.' },
    { key: 'yearEnd', label: 'Year-end review', help: 'Final scoring and calibration for the financial year.' }
]

type FormValues = {
    startYear: number
    startMonth: number
    status: CycleStatus
    reminders: boolean
} & Record<WindowKey, [Dayjs, Dayjs]>

const remindersTag = (cycle: PerformanceCycle) => (
    <Tag color={cycle.reminders ? 'green' : 'default'} style={{ borderRadius: 999, margin: 0 }}>
        {cycle.reminders ? 'Reminders on' : 'Reminders off'}
    </Tag>
)

export function cycleStatusTag(status?: CycleStatus) {
    const meta = CYCLE_STATUSES.find(s => s.value === status) || CYCLE_STATUSES[0]
    return (
        <Tag color={meta.color} style={{ borderRadius: 999, margin: 0 }}>
            {meta.label}
        </Tag>
    )
}

const toRange = (window: { from: string; to: string }): [Dayjs, Dayjs] => [dayjs(window.from), dayjs(window.to)]

export const CyclesModal: React.FC<{
    open: boolean
    onClose: () => void
    cycles: PerformanceCycle[]
    onSaved: (cycleId: string) => void
    userId: string
}> = ({ open, onClose, cycles, onSaved, userId }) => {
    const [form] = Form.useForm<FormValues>()
    const isMobile = useIsMobile()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [formOpen, setFormOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const startYear = Form.useWatch('startYear', form)
    const startMonth = Form.useWatch('startMonth', form)

    const preview = useMemo(
        () => (startYear && startMonth ? buildCycle(Number(startYear), Number(startMonth)) : null),
        [startYear, startMonth]
    )

    // A new cycle starts from the current financial year, or the one after the
    // latest cycle already opened.
    const nextStartYear = () => {
        const current = cycleForDate(new Date())
        const currentYear = Number(current.startDate.slice(0, 4))
        const latest = Math.max(...cycles.map(c => Number(c.startDate.slice(0, 4))), currentYear - 1)
        return Math.max(currentYear, latest + 1)
    }

    const applyDefaults = (year: number, month: number) => {
        const cycle = buildCycle(year, month)
        form.setFieldsValue({
            compacting: toRange(cycle.windows.compacting),
            midYear: toRange(cycle.windows.midYear),
            yearEnd: toRange(cycle.windows.yearEnd)
        })
    }

    const startNew = () => {
        const year = nextStartYear()
        setEditingId(null)
        form.setFieldsValue({ startYear: year, startMonth: DEFAULT_FY_START_MONTH, status: 'planning', reminders: false })
        applyDefaults(year, DEFAULT_FY_START_MONTH)
        setFormOpen(true)
    }

    const startEdit = (cycle: PerformanceCycle) => {
        setEditingId(cycle.id)
        form.setFieldsValue({
            startYear: Number(cycle.startDate.slice(0, 4)),
            startMonth: Number(cycle.startDate.slice(5, 7)),
            status: cycle.status,
            reminders: !!cycle.reminders,
            compacting: toRange(cycle.windows.compacting),
            midYear: toRange(cycle.windows.midYear),
            yearEnd: toRange(cycle.windows.yearEnd)
        })
        setFormOpen(true)
    }

    useEffect(() => {
        if (!open) setFormOpen(false)
        else if (!cycles.length) startNew()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const save = async (values: FormValues) => {
        const base = buildCycle(Number(values.startYear), Number(values.startMonth))
        if (!editingId && cycles.some(c => c.id === base.id)) {
            message.warning(`${base.label} is already open. Edit it instead.`)
            return
        }
        const window = (range: [Dayjs, Dayjs]) => ({ from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') })
        setSaving(true)
        try {
            await setDoc(
                doc(db, 'performanceCycles', editingId || base.id),
                {
                    ...(editingId ? {} : { id: base.id, label: base.label, startDate: base.startDate, endDate: base.endDate, createdAt: serverTimestamp(), createdBy: userId }),
                    status: values.status,
                    reminders: !!values.reminders,
                    windows: {
                        compacting: window(values.compacting),
                        midYear: window(values.midYear),
                        yearEnd: window(values.yearEnd)
                    },
                    updatedAt: serverTimestamp(),
                    updatedBy: userId
                },
                { merge: true }
            )
            message.success(editingId ? 'Cycle updated.' : `${base.label} opened.`)
            setFormOpen(false)
            onSaved(editingId || base.id)
        } catch (error) {
            console.error(error)
            message.error('Could not save the cycle.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={860}
            destroyOnClose
            title={
                <Space>
                    <CalendarOutlined />
                    Performance cycles
                </Space>
            }
        >
            {isMobile ? (
                <MobileCardList
                    data={cycles}
                    getKey={c => c.id}
                    emptyText='No cycle has been opened yet.'
                    renderCard={(c: PerformanceCycle) => ({
                        title: c.label,
                        subtitle: `${dayjs(c.startDate).format('D MMM YYYY')} – ${dayjs(c.endDate).format('D MMM YYYY')}`,
                        badge: cycleStatusTag(c.status),
                        fields: [
                            {
                                label: 'Compacting',
                                value: `${dayjs(c.windows.compacting.from).format('D MMM')} – ${dayjs(c.windows.compacting.to).format('D MMM')}`
                            },
                            {
                                label: 'Mid-year',
                                value: `${dayjs(c.windows.midYear.from).format('D MMM')} – ${dayjs(c.windows.midYear.to).format('D MMM')}`
                            },
                            { label: 'Reminders', value: remindersTag(c) }
                        ],
                        actions: [
                            <Button key='edit' icon={<EditOutlined />} onClick={() => startEdit(c)}>
                                Edit
                            </Button>
                        ]
                    })}
                />
            ) : (
            <Table
                rowKey='id'
                size='small'
                dataSource={cycles}
                pagination={false}
                locale={{ emptyText: 'No cycle has been opened yet.' }}
                columns={[
                    { title: 'Cycle', dataIndex: 'label', key: 'label', render: (v: string) => <Text strong>{v}</Text> },
                    {
                        title: 'Period',
                        key: 'period',
                        render: (_: any, c: PerformanceCycle) =>
                            `${dayjs(c.startDate).format('D MMM YYYY')} – ${dayjs(c.endDate).format('D MMM YYYY')}`
                    },
                    { title: 'Stage', key: 'status', render: (_: any, c: PerformanceCycle) => cycleStatusTag(c.status) },
                    { title: 'Reminders', key: 'reminders', render: (_: any, c: PerformanceCycle) => remindersTag(c) },
                    {
                        title: '',
                        key: 'edit',
                        align: 'right' as const,
                        render: (_: any, c: PerformanceCycle) => (
                            <Button size='small' shape='round' icon={<EditOutlined />} onClick={() => startEdit(c)}>
                                Edit
                            </Button>
                        )
                    }
                ]}
            />
            )}

            {!formOpen ? (
                <Button type='dashed' block icon={<PlusOutlined />} style={{ marginTop: 16 }} onClick={startNew}>
                    Open a new cycle
                </Button>
            ) : (
                <>
                    <Divider style={{ margin: '20px 0 16px' }}>{editingId ? `Edit ${editingId.replace(/-/g, '/')}` : 'Open a new cycle'}</Divider>
                    <Form form={form} layout='vertical' onFinish={save} requiredMark={false}>
                        <Row gutter={12}>
                            <Col xs={12} md={6}>
                                <Form.Item name='startYear' label='Starts in year' rules={[{ required: true }]}>
                                    <InputNumber
                                        min={2020}
                                        max={2100}
                                        style={{ width: '100%' }}
                                        disabled={!!editingId}
                                        onChange={value => value && applyDefaults(Number(value), Number(form.getFieldValue('startMonth')))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={12} md={6}>
                                <Form.Item
                                    name='startMonth'
                                    label='Starts in month'
                                    tooltip='Lepharo runs April to March. Change this only if the financial year changes.'
                                    rules={[{ required: true }]}
                                >
                                    <Select
                                        options={MONTHS}
                                        disabled={!!editingId}
                                        onChange={value => applyDefaults(Number(form.getFieldValue('startYear')), Number(value))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                                <Form.Item name='status' label='Stage'>
                                    <Select options={CYCLE_STATUSES.map(s => ({ value: s.value, label: s.label }))} />
                                </Form.Item>
                            </Col>
                        </Row>

                        {preview && !editingId ? (
                            <Alert
                                type='info'
                                showIcon
                                style={{ marginBottom: 16 }}
                                message={`${preview.label}: ${dayjs(preview.startDate).format('D MMMM YYYY')} to ${dayjs(preview.endDate).format('D MMMM YYYY')}`}
                            />
                        ) : null}

                        <Row gutter={12}>
                            {WINDOWS.map(w => (
                                <Col xs={24} md={8} key={w.key}>
                                    <Form.Item name={w.key} label={w.label} tooltip={w.help} rules={[{ required: true, message: 'Set the window' }]}>
                                        <RangePicker style={{ width: '100%' }} format='D MMM YY' />
                                    </Form.Item>
                                </Col>
                            ))}
                        </Row>

                        <Form.Item
                            name='reminders'
                            label='Send reminders'
                            valuePropName='checked'
                            extra='A weekly email and in-app digest to each person with something waiting on them: compacts to sign, overdue check-ins, reviews to book, complete, sign, calibrate or validate.'
                        >
                            <Switch />
                        </Form.Item>

                        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                            <Button onClick={() => setFormOpen(false)} disabled={saving}>
                                Cancel
                            </Button>
                            <Button type='primary' htmlType='submit' loading={saving}>
                                {editingId ? 'Save cycle' : 'Open cycle'}
                            </Button>
                        </Space>
                    </Form>
                </>
            )}
        </Modal>
    )
}
