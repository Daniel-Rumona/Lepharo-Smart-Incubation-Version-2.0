import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Form, Input, Modal, Select, Steps, Table, Tag, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { EntityAvatar } from '@/components/workspace'
import { assignLeave } from './leaveActions'
import { LEAVE_TYPES, capFor, validateLeave } from './leavePolicy'
import { countLeaveDays, typeLabel, type Employee, type LeaveRequest, type LeaveSettings, type LeaveType } from './types'

type Props = {
    open: boolean
    onClose: () => void
    employees: Employee[]
    requests: LeaveRequest[]
    settings: LeaveSettings
    /** People ticked when the modal opens, e.g. from the Employees page's "Put on leave". */
    preselectedIds?: string[]
}

/** HR records approved leave for one or more staff: pick people, then the leave, checked per person. */
export const AssignLeaveModal: React.FC<Props> = ({ open, onClose, employees, requests, settings, preselectedIds }) => {
    const [step, setStep] = useState(0)
    const [search, setSearch] = useState('')
    const [team, setTeam] = useState<string>('all')
    const [selectedIds, setSelectedIds] = useState<string[]>([])

    useEffect(() => {
        if (open && preselectedIds?.length) setSelectedIds(preselectedIds)
    }, [open, preselectedIds])
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm()
    const type = Form.useWatch('type', form) as LeaveType | undefined
    const dates = Form.useWatch('dates', form) as [Dayjs, Dayjs] | undefined

    const teams = useMemo(() => {
        const names = new Set<string>()
        employees.forEach(e => [e.departmentName, e.branchName].forEach(n => n && names.add(n)))
        return Array.from(names).sort()
    }, [employees])

    const shown = useMemo(() => {
        const q = search.trim().toLowerCase()
        const matches = employees.filter(
            e =>
                (team === 'all' || e.departmentName === team || e.branchName === team) &&
                (!q || `${e.name} ${e.email}`.toLowerCase().includes(q))
        )
        // People handed in from elsewhere go first so they're visible straight away.
        if (!preselectedIds?.length) return matches
        const first = new Set(preselectedIds)
        return [...matches.filter(e => first.has(e.id)), ...matches.filter(e => !first.has(e.id))]
    }, [employees, search, team, preselectedIds])

    const from = dates?.[0]?.format('YYYY-MM-DD')
    const to = dates?.[1]?.format('YYYY-MM-DD')

    // Each selected person's check against their own balance and leave.
    const review = useMemo(() => {
        if (!type || !from || !to) return []
        return employees
            .filter(e => selectedIds.includes(e.id))
            .map(e => ({ employee: e, ...validateLeave(requests, settings, e.id, type, from, to) }))
    }, [employees, selectedIds, requests, settings, type, from, to])

    const ready = review.filter(r => r.ok)

    const reset = () => {
        setStep(0)
        setSearch('')
        setTeam('all')
        setSelectedIds([])
        form.resetFields()
    }

    const close = () => {
        reset()
        onClose()
    }

    const submit = async () => {
        const values = await form.validateFields()
        if (!ready.length || !type || !from || !to) return
        setSaving(true)
        try {
            await assignLeave(
                ready.map(r => r.employee),
                { type, from, to, reason: String(values.reason || '').trim() }
            )
            message.success(`Leave recorded for ${ready.length} ${ready.length === 1 ? 'person' : 'people'}`)
            close()
        } catch (error: any) {
            console.error('[leave] assign failed', error)
            message.error(error?.code === 'permission-denied' ? 'Only HR or a director can record leave.' : 'That didn’t save. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            title='Record leave'
            open={open}
            onCancel={close}
            width={820}
            destroyOnClose
            footer={
                step === 0 ? (
                    <Button type='primary' disabled={!selectedIds.length} onClick={() => setStep(1)}>
                        Next: leave details ({selectedIds.length})
                    </Button>
                ) : (
                    <>
                        <Button onClick={() => setStep(0)}>Back</Button>
                        <Button type='primary' loading={saving} disabled={!ready.length} onClick={submit}>
                            Record for {ready.length} {ready.length === 1 ? 'person' : 'people'}
                        </Button>
                    </>
                )
            }
        >
            <Steps size='small' current={step} items={[{ title: 'People' }, { title: 'Leave' }]} style={{ marginBottom: 16 }} />

            {step === 0 ? (
                <>
                    <div className='ws-toolbar' style={{ marginBottom: 12 }}>
                        <Input
                            className='ws-toolbar-search'
                            prefix={<SearchOutlined />}
                            placeholder='Search staff'
                            allowClear
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        <Select
                            style={{ flex: '2 1 200px' }}
                            value={team}
                            onChange={setTeam}
                            options={[{ value: 'all', label: 'All teams' }, ...teams.map(t => ({ value: t, label: t }))]}
                            showSearch
                        />
                    </div>
                    <Table
                        size='small'
                        rowKey='id'
                        dataSource={shown}
                        pagination={{ pageSize: 8, showSizeChanger: false }}
                        rowSelection={{
                            selectedRowKeys: selectedIds,
                            preserveSelectedRowKeys: true,
                            onChange: keys => setSelectedIds(keys as string[])
                        }}
                        columns={[
                            {
                                title: 'Employee',
                                render: (_, e: Employee) => (
                                    <div className='lv-person'>
                                        <EntityAvatar name={e.name || e.email || '?'} photo={e.photoURL} size={28} />
                                        <div className='lv-person-text'>
                                            <div className='ws-row-name'>{e.name || '—'}</div>
                                            <div className='ws-row-meta'>{e.email}</div>
                                        </div>
                                    </div>
                                )
                            },
                            { title: 'Team', render: (_, e: Employee) => e.departmentName || e.branchName || '—' }
                        ]}
                    />
                </>
            ) : (
                <>
                    <Form form={form} layout='vertical' preserve>
                        <Form.Item name='type' label='Type' rules={[{ required: true, message: 'Pick a leave type' }]}>
                            <Select
                                placeholder='Leave type'
                                options={LEAVE_TYPES.map(t => ({
                                    value: t,
                                    label: `${typeLabel(t)} (${capFor(settings, t)} days)`
                                }))}
                            />
                        </Form.Item>
                        <Form.Item
                            name='dates'
                            label='Dates'
                            rules={[{ required: true, message: 'Pick the dates' }]}
                            extra={from && to ? `${countLeaveDays(from, to)} days` : undefined}
                        >
                            <DatePicker.RangePicker
                                style={{ width: '100%' }}
                                disabledDate={d => settings.blackoutDates.includes(d.format('YYYY-MM-DD'))}
                            />
                        </Form.Item>
                        <Form.Item name='reason' label='Reason' rules={[{ required: true, whitespace: true, message: 'Add a reason' }]}>
                            <Input.TextArea rows={3} />
                        </Form.Item>
                    </Form>

                    {review.length > 0 && (
                        <>
                            {ready.length < review.length && (
                                <Alert
                                    type='warning'
                                    showIcon
                                    style={{ marginBottom: 12 }}
                                    message={`${review.length - ready.length} of ${review.length} can't take this leave and will be skipped`}
                                />
                            )}
                            <Table
                                size='small'
                                rowKey={r => r.employee.id}
                                dataSource={review}
                                pagination={false}
                                columns={[
                                    { title: 'Employee', render: (_, r) => r.employee.name || r.employee.email },
                                    {
                                        title: 'Check',
                                        render: (_, r) =>
                                            r.ok ? (
                                                <Tag color='green' bordered={false}>
                                                    OK
                                                </Tag>
                                            ) : (
                                                <span className='ws-muted'>{r.reason}</span>
                                            )
                                    }
                                ]}
                            />
                        </>
                    )}
                </>
            )}
        </Modal>
    )
}
