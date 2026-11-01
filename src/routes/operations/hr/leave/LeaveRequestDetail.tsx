import React, { useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Tag, Tooltip, message } from 'antd'
import { CheckOutlined, CloseOutlined, EditOutlined, StopOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { approveLeave, endLeaveToday, rejectLeave, updateLeave } from './leaveActions'
import { LEAVE_TYPES, capFor, isOnLeaveOn, remainingFor, requestDays, validateLeave } from './leavePolicy'
import { STATUS_TAG, dateSpan, displayNameOf } from './LeaveRequestList'
import { countLeaveDays, typeLabel, type Employee, type LeaveRequest, type LeaveSettings, type LeaveType } from './types'

type Props = {
    request: LeaveRequest
    requests: LeaveRequest[]
    employeeById: Map<string, Employee>
    settings: LeaveSettings
    canManage: boolean
}

const overlapsRange = (r: LeaveRequest, from: string, to: string) =>
    !dayjs(r.to).isBefore(dayjs(from), 'day') && !dayjs(to).isBefore(dayjs(r.from), 'day')

/** One request: the facts, whether policy allows it, the balance it uses, who else is away, and the decision. */
export const LeaveRequestDetail: React.FC<Props> = ({ request, requests, employeeById, settings, canManage }) => {
    const [busy, setBusy] = useState<string | null>(null)
    const [rejectOpen, setRejectOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [rejectForm] = Form.useForm()
    const [editForm] = Form.useForm()

    const employee = employeeById.get(request.employeeId)
    const name = displayNameOf(request, employee)
    const days = requestDays(request)
    const onNow = request.status === 'approved' && isOnLeaveOn(request)
    const affiliation = [employee?.departmentName, employee?.branchName].filter(Boolean).join(' · ')

    // Approval check: excludes this request itself, so an approved request is
    // never counted against its own balance.
    const check = useMemo(
        () => validateLeave(requests, settings, request.employeeId, request.type, request.from, request.to, request.id),
        [requests, settings, request]
    )

    const cap = capFor(settings, request.type)
    const remainingBefore = remainingFor(requests, settings, request.employeeId, request.type, request.id)

    // Colleagues in the same department (or branch) with approved leave on any of these days.
    const awayTogether = useMemo(() => {
        const sameTeam = (other?: Employee) =>
            !!other &&
            ((!!employee?.departmentId && other.departmentId === employee.departmentId) ||
                (!!employee?.branchId && other.branchId === employee.branchId))
        return requests.filter(
            r =>
                r.employeeId !== request.employeeId &&
                r.status === 'approved' &&
                overlapsRange(r, request.from, request.to) &&
                sameTeam(employeeById.get(r.employeeId))
        )
    }, [requests, request, employee, employeeById])

    const run = async (key: string, action: () => Promise<void>, done: string) => {
        setBusy(key)
        try {
            await action()
            message.success(done)
        } catch (error: any) {
            console.error('[leave] action failed', error)
            message.error(
                error?.code === 'permission-denied'
                    ? 'Only HR or a director can change leave requests.'
                    : 'That didn’t save. Please try again.'
            )
        } finally {
            setBusy(null)
        }
    }

    const openEdit = () => {
        editForm.setFieldsValue({
            type: request.type,
            dates: [dayjs(request.from), dayjs(request.to)],
            reason: request.reason
        })
        setEditOpen(true)
    }

    const submitEdit = async () => {
        const values = await editForm.validateFields()
        const [start, end] = values.dates as [Dayjs, Dayjs]
        const changes = {
            type: values.type as LeaveType,
            from: start.format('YYYY-MM-DD'),
            to: end.format('YYYY-MM-DD'),
            reason: String(values.reason || '').trim()
        }
        const editCheck = validateLeave(requests, settings, request.employeeId, changes.type, changes.from, changes.to, request.id)
        if (!editCheck.ok) {
            message.error(editCheck.reason)
            return
        }
        await run('edit', () => updateLeave(request, changes), 'Leave updated')
        setEditOpen(false)
    }

    const submitReject = async () => {
        const { reason } = await rejectForm.validateFields()
        await run('reject', () => rejectLeave(request, String(reason).trim()), 'Leave request rejected')
        setRejectOpen(false)
        rejectForm.resetFields()
    }

    const actions = canManage ? (
        <div className='ws-detail-actions'>
            {request.status === 'pending' && (
                <>
                    <Button danger icon={<CloseOutlined />} loading={busy === 'reject'} onClick={() => setRejectOpen(true)}>
                        Reject
                    </Button>
                    <Tooltip title={check.ok ? undefined : check.reason}>
                        <Button
                            type='primary'
                            icon={<CheckOutlined />}
                            disabled={!check.ok}
                            loading={busy === 'approve'}
                            onClick={() => run('approve', () => approveLeave(request), 'Leave request approved')}
                        >
                            Approve
                        </Button>
                    </Tooltip>
                </>
            )}
            {request.status !== 'rejected' && (
                <Button icon={<EditOutlined />} onClick={openEdit}>
                    Edit
                </Button>
            )}
            {onNow && (
                <Popconfirm
                    title='End this leave today?'
                    description='Today becomes the last day of leave.'
                    okText='End today'
                    onConfirm={() => run('end', () => endLeaveToday(request), 'Leave ended today')}
                >
                    <Button icon={<StopOutlined />} loading={busy === 'end'}>
                        End today
                    </Button>
                </Popconfirm>
            )}
        </div>
    ) : null

    return (
        <div className='ws-detail'>
            <MotionCard>
                <header className='ws-detail-head'>
                    <EntityAvatar name={name} photo={request.employeePhoto || employee?.photoURL} size={48} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{name}</h2>
                        <div className='ws-detail-sub'>{affiliation || request.employeeEmail || employee?.email || '—'}</div>
                        <div className='ws-detail-tags'>
                            <Tag color={STATUS_TAG[request.status]?.color} bordered={false}>
                                {STATUS_TAG[request.status]?.label || request.status}
                            </Tag>
                            {onNow && (
                                <Tag color='blue' bordered={false}>
                                    On leave now
                                </Tag>
                            )}
                            <Tag bordered={false}>{typeLabel(request.type)}</Tag>
                        </div>
                    </div>
                    {actions}
                </header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <div className='ws-detail-body'>
                            {request.status === 'pending' && !check.ok && (
                                <Alert type='warning' showIcon message="Can't be approved as it stands" description={check.reason} />
                            )}

                            <section>
                                <h4 className='ws-section-title'>Leave</h4>
                                <dl className='ws-facts'>
                                    <div>
                                        <dt>Dates</dt>
                                        <dd>{dateSpan(request)}</dd>
                                    </div>
                                    <div>
                                        <dt>Days</dt>
                                        <dd>{days}</dd>
                                    </div>
                                    <div>
                                        <dt>Applied</dt>
                                        <dd>{request.appliedDate ? dayjs(request.appliedDate).format('D MMM YYYY') : '—'}</dd>
                                    </div>
                                    {request.status !== 'pending' && (
                                        <div>
                                            <dt>{request.status === 'approved' ? 'Approved by' : 'Rejected by'}</dt>
                                            <dd>
                                                {request.approvedBy || '—'}
                                                {request.approvedDate ? `, ${dayjs(request.approvedDate).format('D MMM YYYY')}` : ''}
                                            </dd>
                                        </div>
                                    )}
                                </dl>
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Reason</h4>
                                <p className='ws-prose'>{request.reason || <span className='ws-muted'>Not given</span>}</p>
                            </section>

                            {request.status === 'rejected' && (
                                <section>
                                    <h4 className='ws-section-title'>Why it was rejected</h4>
                                    <p className='ws-prose'>{request.rejectionReason || <span className='ws-muted'>Not given</span>}</p>
                                </section>
                            )}

                            {cap !== null && remainingBefore !== null && (
                                <section>
                                    <h4 className='ws-section-title'>{typeLabel(request.type)} balance</h4>
                                    <div className='lv-balance'>
                                        <div className='lv-balance-track' aria-hidden='true'>
                                            <span
                                                className='lv-balance-used'
                                                style={{ width: `${Math.min(100, ((cap - remainingBefore) / Math.max(cap, 1)) * 100)}%` }}
                                            />
                                            <span
                                                className={`lv-balance-this${days > remainingBefore ? ' is-over' : ''}`}
                                                style={{ width: `${Math.min(100, (days / Math.max(cap, 1)) * 100)}%` }}
                                            />
                                        </div>
                                        <span className='ws-muted'>
                                            {cap - remainingBefore} used + {days} here of {cap} ·{' '}
                                            {Math.max(0, remainingBefore - days)} left after
                                        </span>
                                    </div>
                                </section>
                            )}

                            <section>
                                <h4 className='ws-section-title'>Also away from the team</h4>
                                {awayTogether.length ? (
                                    <ul className='lv-away'>
                                        {awayTogether.map(r => (
                                            <li key={r.id}>
                                                <span>{displayNameOf(r, employeeById.get(r.employeeId))}</span>
                                                <span className='ws-muted'>{dateSpan(r)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className='ws-prose ws-muted'>No one else in this team is on leave on these days.</p>
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            </MotionCard>

            <Modal
                title='Reject leave request'
                open={rejectOpen}
                onCancel={() => setRejectOpen(false)}
                onOk={submitReject}
                okText='Reject'
                okButtonProps={{ danger: true, loading: busy === 'reject' }}
                destroyOnClose
            >
                <Form form={rejectForm} layout='vertical'>
                    <Form.Item name='reason' label='Reason' rules={[{ required: true, whitespace: true, message: 'Give the employee a reason' }]}>
                        <Input.TextArea rows={4} placeholder='Shown to the employee' />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title='Edit leave'
                open={editOpen}
                onCancel={() => setEditOpen(false)}
                onOk={submitEdit}
                okText='Save'
                okButtonProps={{ loading: busy === 'edit' }}
                destroyOnClose
            >
                <Form form={editForm} layout='vertical'>
                    <Form.Item name='type' label='Type' rules={[{ required: true }]}>
                        <Select options={LEAVE_TYPES.map(t => ({ value: t, label: typeLabel(t) }))} />
                    </Form.Item>
                    <Form.Item
                        name='dates'
                        label='Dates'
                        rules={[{ required: true }]}
                        extra={
                            <Form.Item noStyle shouldUpdate>
                                {() => {
                                    const range = editForm.getFieldValue('dates') as [Dayjs, Dayjs] | undefined
                                    return range?.[0] && range?.[1]
                                        ? `${countLeaveDays(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))} days`
                                        : null
                                }}
                            </Form.Item>
                        }
                    >
                        <DatePicker.RangePicker
                            style={{ width: '100%' }}
                            allowClear={false}
                            disabledDate={d => settings.blackoutDates.includes(d.format('YYYY-MM-DD'))}
                        />
                    </Form.Item>
                    <Form.Item name='reason' label='Reason' rules={[{ required: true, whitespace: true }]}>
                        <Input.TextArea rows={3} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}
