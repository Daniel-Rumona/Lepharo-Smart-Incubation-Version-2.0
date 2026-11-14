import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Avatar,
    Button,
    Card,
    Checkbox,
    Col,
    DatePicker,
    Drawer,
    Dropdown,
    Empty,
    Form,
    Input,
    Modal,
    Row,
    Segmented,
    Select,
    Skeleton,
    message,
    theme
} from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    EllipsisOutlined,
    ExclamationCircleOutlined,
    ExportOutlined,
    RollbackOutlined,
    MailOutlined,
    PhoneOutlined,
    ScheduleOutlined,
    SearchOutlined,
    TeamOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Helmet } from 'react-helmet'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import { useAuth } from '@/hooks/useAuth'
import { useDataColor } from '@/lib/chartColors'
import { inquiryService } from '@/services/inquiryService'
import { followUpService, type FollowUp } from '@/services/followUpService'
import { PRIORITY_COLORS } from '@/types/inquiry'
import { useBranchNames } from '@/lib/useBranchNames'
import {
    dueLabel,
    followUpBucket,
    hasTimeOfDay,
    isEscalatedOpen,
    isOpenFollowUp,
    rescheduleOptions,
    startOfDay,
    type FollowUpBucket
} from '@/lib/followUpBuckets'
import { AdminKpiTile, AdminMiniBars, AdminShareRing } from '@/components/admin/AdminKpiTile'
import InquiryDetail from '@/components/receptionist/InquiryDetail'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

/*
 * The receptionist's follow-ups: a worklist in tabs (Overdue, Today, Upcoming,
 * Done), each row with what to do next — mark it done with an outcome,
 * reschedule it, or open the inquiry. The reception desk owns the branch's
 * follow-ups, so every receptionist at the branch sees them all.
 */

const TYPES: FollowUp['followUpType'][] = ['Phone', 'Email', 'In-person', 'Video Call']
const PRIORITIES: FollowUp['priority'][] = ['Urgent', 'High', 'Medium', 'Low']
const DONE_PAGE = 20

const TYPE_ICON: Record<string, React.ReactNode> = {
    Phone: <PhoneOutlined />,
    Email: <MailOutlined />,
    'In-person': <TeamOutlined />,
    'Video Call': <VideoCameraOutlined />
}

const TAB_LABEL: Record<FollowUpBucket, string> = {
    overdue: 'Overdue',
    today: 'Today',
    upcoming: 'Upcoming',
    escalated: 'Escalated',
    done: 'Done'
}

/** Reception has an Escalated tab; a department coordinator's list is all escalations. */
const TABS: Record<FollowUpsMode, FollowUpBucket[]> = {
    reception: ['overdue', 'today', 'upcoming', 'escalated', 'done'],
    department: ['overdue', 'today', 'upcoming', 'done']
}

export type FollowUpsMode = 'reception' | 'department'

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('') || '?'

const FollowUpsList: React.FC<{ mode?: FollowUpsMode }> = ({ mode = 'reception' }) => {
    const isDept = mode === 'department'
    // Data colour for counts (blue under a red accent); overdue keeps the error colour on purpose.
    const DATA = useDataColor()
    const { token } = theme.useToken()
    const { user, loading: userLoading } = useAuth()
    const branchNames = useBranchNames()
    const branchId = String(user?.assignedBranch || '')
    const me = {
        uid: user?.uid || '',
        name: user?.name || user?.email || '',
        email: user?.email || ''
    }

    const [followUps, setFollowUps] = useState<FollowUp[]>([])
    const [loading, setLoading] = useState(true)
    const [tab, setTab] = useState<FollowUpBucket>('today')
    const [tabChosen, setTabChosen] = useState(false)
    const [search, setSearch] = useState('')
    const [priority, setPriority] = useState<FollowUp['priority'] | 'all'>('all')
    const [doneShown, setDoneShown] = useState(DONE_PAGE)

    const [openInquiryId, setOpenInquiryId] = useState<string | null>(null)
    const [completing, setCompleting] = useState<FollowUp | null>(null)
    const [picking, setPicking] = useState<FollowUp | null>(null)
    const [editing, setEditing] = useState<FollowUp | null>(null)
    const [escalating, setEscalating] = useState<FollowUp | null>(null)
    const [handingBack, setHandingBack] = useState<FollowUp | null>(null)
    const [viewing, setViewing] = useState<FollowUp | null>(null)
    const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
    const [saving, setSaving] = useState(false)
    const [completeForm] = Form.useForm()
    const [pickForm] = Form.useForm()
    const [editForm] = Form.useForm()
    const [escalateForm] = Form.useForm()
    const [handBackForm] = Form.useForm()

    const load = useCallback(async () => {
        if (isDept ? !me.uid : !branchId) return
        setLoading(true)
        try {
            setFollowUps(isDept ? await followUpService.getEscalatedToMe(me.uid) : await followUpService.getFollowUpsByBranch(branchId))
        } catch (error) {
            console.error('Error loading follow-ups:', error)
            message.error('Could not load follow-ups.')
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, isDept, me.uid])

    // The departments a follow-up can be escalated to, loaded when reception first escalates.
    const loadDepartments = async () => {
        if (departments.length) return
        try {
            const snap = await getDocs(collection(db, 'departments'))
            setDepartments(
                snap.docs
                    .map(d => ({ id: d.id, name: String(d.data().name || '').trim() }))
                    .filter(d => d.name)
                    .sort((a, b) => a.name.localeCompare(b.name))
            )
        } catch (error) {
            console.error('Error loading departments:', error)
        }
    }

    useEffect(() => {
        load()
    }, [load])

    const now = new Date()
    // The whole branch's reception follow-ups. Who each is assigned to and who did it
    // is still recorded (assignedTo, completedBy) but not used to split the list.
    const scoped = followUps

    const byBucket = useMemo(() => {
        const groups: Record<FollowUpBucket, FollowUp[]> = { overdue: [], today: [], upcoming: [], escalated: [], done: [] }
        scoped.forEach(f => groups[followUpBucket(f, now, !isDept)].push(f))
        const finishedAt = (f: FollowUp) => (f.completedAt || f.updatedAt)?.getTime() ?? 0
        groups.done.sort((a, b) => finishedAt(b) - finishedAt(a))
        return groups
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scoped])

    // Open on the most pressing tab that has anything in it, until one is picked.
    useEffect(() => {
        if (tabChosen || loading) return
        setTab(byBucket.overdue.length ? 'overdue' : byBucket.today.length ? 'today' : byBucket.upcoming.length ? 'upcoming' : 'today')
    }, [byBucket, tabChosen, loading])

    const figures = useMemo(() => {
        const today = startOfDay(now)
        // Reception's figures leave out what a department is holding.
        const open = scoped.filter(f => isOpenFollowUp(f) && (isDept || !isEscalatedOpen(f)))
        const nextDays = Array.from({ length: 7 }, (_, i) => {
            const day = dayjs(today).add(i + 1, 'day')
            return {
                key: day.valueOf(),
                label: day.format('dd').charAt(0),
                value: open.filter(f => f.scheduledDate && dayjs(f.scheduledDate).isSame(day, 'day')).length
            }
        })
        const monthStart = dayjs(today).startOf('month')
        const completed = scoped.filter(f => f.status === 'Completed')
        const completedIn = (from: Dayjs, to: Dayjs) =>
            completed.filter(f => {
                const at = dayjs(f.completedAt || f.updatedAt)
                return !at.isBefore(from) && at.isBefore(to)
            }).length
        const monthBars = Array.from({ length: 6 }, (_, i) => {
            const start = monthStart.subtract(5 - i, 'month')
            return { key: start.valueOf(), label: start.format('MMM'), value: completedIn(start, start.add(1, 'month')) }
        })
        return {
            open: open.length,
            nextDays,
            nextWeek: nextDays.reduce((t, d) => t + d.value, 0),
            monthBars,
            completedThisMonth: monthBars[5].value
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scoped])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return byBucket[tab].filter(f => {
            if (priority !== 'all' && f.priority !== priority) return false
            if (!needle) return true
            return [f.customerName, f.customerEmail, f.customerPhone, f.inquirySubject, f.notes, f.assignedToName]
                .some(value => String(value || '').toLowerCase().includes(needle))
        })
    }, [byBucket, tab, search, priority])

    const shownRows = tab === 'done' ? visible.slice(0, doneShown) : visible

    // Upcoming is grouped by day; the other tabs are one list.
    const groups = useMemo(() => {
        if (tab !== 'upcoming') return [{ key: tab, title: '', rows: shownRows }]
        const map = new Map<string, { key: string; title: string; rows: FollowUp[] }>()
        shownRows.forEach(f => {
            const day = dayjs(f.scheduledDate)
            const key = day.format('YYYY-MM-DD')
            if (!map.has(key)) {
                const title = day.isSame(dayjs().add(1, 'day'), 'day') ? `Tomorrow · ${day.format('D MMMM')}` : day.format('dddd · D MMMM')
                map.set(key, { key, title, rows: [] })
            }
            map.get(key)!.rows.push(f)
        })
        return [...map.values()]
    }, [shownRows, tab])

    // ---- Actions ----

    const reschedule = async (followUp: FollowUp, date: Date) => {
        try {
            await followUpService.updateFollowUp(followUp.id, { scheduledDate: date })
            message.success(`Moved to ${dueLabel(date, new Date())}.`)
            await load()
        } catch (error) {
            console.error('Error rescheduling follow-up:', error)
            message.error('Could not reschedule this follow-up.')
        }
    }

    const cancelFollowUp = (followUp: FollowUp) =>
        Modal.confirm({
            title: 'Cancel this follow-up?',
            content: `${followUp.customerName} will no longer be on your list. The inquiry is not changed.`,
            okText: 'Cancel follow-up',
            okButtonProps: { danger: true },
            cancelText: 'Keep it',
            onOk: async () => {
                try {
                    await followUpService.updateFollowUpStatus(followUp.id, 'Cancelled')
                    message.success('Follow-up cancelled.')
                    await load()
                } catch (error) {
                    console.error('Error cancelling follow-up:', error)
                    message.error('Could not cancel this follow-up.')
                }
            }
        })

    const openComplete = (followUp: FollowUp) => {
        completeForm.resetFields()
        completeForm.setFieldsValue({ bookNext: false, nextType: followUp.followUpType, nextDate: dayjs(rescheduleOptions(followUp.scheduledDate, new Date())[1].date) })
        setCompleting(followUp)
    }

    const submitComplete = async (values: any) => {
        if (!completing) return
        setSaving(true)
        try {
            await followUpService.completeFollowUp(
                completing,
                values.outcome,
                me,
                values.bookNext ? { scheduledDate: values.nextDate.toDate(), followUpType: values.nextType, notes: values.nextNotes } : undefined
            )
            message.success(values.bookNext ? 'Done, and the next follow-up is booked.' : 'Follow-up marked as done.')
            setCompleting(null)
            await load()
        } catch (error) {
            console.error('Error completing follow-up:', error)
            message.error('Could not mark this follow-up as done.')
        } finally {
            setSaving(false)
        }
    }

    const openEdit = (followUp: FollowUp) => {
        editForm.setFieldsValue({
            scheduledDate: followUp.scheduledDate ? dayjs(followUp.scheduledDate) : null,
            followUpType: followUp.followUpType,
            priority: followUp.priority,
            notes: followUp.notes
        })
        setEditing(followUp)
    }

    const submitEdit = async (values: any) => {
        if (!editing) return
        setSaving(true)
        try {
            await followUpService.updateFollowUp(editing.id, {
                scheduledDate: values.scheduledDate.toDate(),
                followUpType: values.followUpType,
                priority: values.priority,
                notes: values.notes || ''
            })
            message.success('Follow-up updated.')
            setEditing(null)
            await load()
        } catch (error) {
            console.error('Error updating follow-up:', error)
            message.error('Could not update this follow-up.')
        } finally {
            setSaving(false)
        }
    }

    const submitPick = async (values: any) => {
        if (!picking) return
        setSaving(true)
        await reschedule(picking, values.date.toDate())
        setSaving(false)
        setPicking(null)
    }

    // The inquiry's own department is offered first.
    const openEscalate = async (followUp: FollowUp) => {
        escalateForm.resetFields()
        setEscalating(followUp)
        loadDepartments()
        const inquiry = await inquiryService.getInquiryById(followUp.inquiryId).catch(() => null)
        // The inquiry form writes inquiryDetails.departmentId; older and imported inquiries keep it at the top level.
        const departmentId = (inquiry?.inquiryDetails as any)?.departmentId || (inquiry as any)?.departmentId
        if (departmentId) escalateForm.setFieldsValue({ departmentId })
    }

    const submitEscalate = async (values: any) => {
        if (!escalating) return
        const department = departments.find(d => d.id === values.departmentId)
        if (!department) return
        setSaving(true)
        try {
            const recipients = await followUpService.escalateFollowUp(escalating, department, values.note, me)
            message.success(`Escalated to ${department.name}: ${recipients.map(r => r.name).join(', ')}.`)
            setEscalating(null)
            await load()
        } catch (error) {
            if (error instanceof Error && error.message === 'no_coordinator') {
                message.error(`${department.name} has no coordinator set up yet, so there is no one to escalate to.`)
            } else {
                console.error('Error escalating follow-up:', error)
                message.error('Could not escalate this follow-up.')
            }
        } finally {
            setSaving(false)
        }
    }

    const takeBack = (followUp: FollowUp) =>
        Modal.confirm({
            title: 'Take this follow-up back?',
            content: `It comes back to reception's list, and ${followUp.escalation?.departmentName || 'the department'} no longer sees it.`,
            okText: 'Take it back',
            cancelText: 'Leave it with them',
            onOk: async () => {
                try {
                    await followUpService.takeBackFollowUp(followUp)
                    message.success('Back on reception’s list.')
                    await load()
                } catch (error) {
                    console.error('Error taking follow-up back:', error)
                    message.error('Could not take this follow-up back.')
                }
            }
        })

    const submitHandBack = async (values: any) => {
        if (!handingBack) return
        setSaving(true)
        try {
            await followUpService.handBackFollowUp(handingBack, values.note, me)
            message.success('Handed back to reception.')
            setHandingBack(null)
            setViewing(null)
            await load()
        } catch (error) {
            console.error('Error handing follow-up back:', error)
            message.error('Could not hand this follow-up back.')
        } finally {
            setSaving(false)
        }
    }

    // ---- Rendering ----

    if (userLoading) return <Skeleton active style={{ padding: 24 }} />

    if (!branchId && !isDept) {
        return (
            <div style={{ margin: 20 }}>
                <Alert
                    message='Branch assignment required'
                    description='You need to be assigned to a branch to see its follow-ups.'
                    type='warning'
                    showIcon
                />
            </div>
        )
    }

    const branchName = branchNames[branchId] || 'your branch'

    const renderRow = (f: FollowUp) => {
        const bucket = followUpBucket(f, now, !isDept)
        const open = bucket !== 'done'
        const withDepartment = open && isEscalatedOpen(f)
        const esc = f.escalation
        const stop = (event: React.SyntheticEvent) => event.stopPropagation()
        return (
            <li key={f.id} className={`rcp-fu-row is-${bucket}`}>
                <button
                    type='button'
                    className='rcp-inquiry-main'
                    // A department coordinator cannot open the inquiry; they get its details from the escalation.
                    onClick={() => (isDept ? setViewing(f) : setOpenInquiryId(f.inquiryId))}
                    aria-label={`Open the inquiry from ${f.customerName}`}
                >
                    <Avatar size={38} className='rcp-inquiry-avatar'>
                        {initials(f.customerName || '')}
                    </Avatar>
                    <span className='rcp-inquiry-copy'>
                        <span className='rcp-inquiry-top'>
                            <strong>{f.customerName || 'Unnamed contact'}</strong>
                            <time className={`rcp-fu-due is-${bucket}`}>
                                {open
                                    ? tab === 'upcoming' && f.scheduledDate
                                        ? // The day is in the group heading; the row needs only the time.
                                          hasTimeOfDay(f.scheduledDate)
                                            ? dayjs(f.scheduledDate).format('HH:mm')
                                            : 'Any time'
                                        : dueLabel(f.scheduledDate, now)
                                    : f.status === 'Cancelled'
                                        ? 'Cancelled'
                                        : `Done ${dayjs(f.completedAt || f.updatedAt).format('D MMM')}`}
                            </time>
                        </span>
                        <span className='rcp-inquiry-detail'>
                            {(isDept ? [f.inquirySubject, esc?.company] : [f.inquirySubject, f.notes]).filter(Boolean).join(' · ') || 'Follow-up'}
                        </span>
                        {withDepartment && esc && (
                            <span className='rcp-fu-escalation'>
                                <ExportOutlined />{' '}
                                {isDept ? (
                                    <>
                                        <b>From {esc.byName || 'reception'}</b>
                                        {esc.note ? `: ${esc.note}` : ''}
                                    </>
                                ) : (
                                    <>
                                        <b>With {esc.departmentName}</b> ({esc.recipients.map(r => r.name).join(', ')})
                                        {esc.note ? `: ${esc.note}` : ''}
                                    </>
                                )}
                            </span>
                        )}
                        {open && !isDept && esc?.status === 'returned' && (
                            <span className='rcp-fu-escalation is-returned'>
                                <RollbackOutlined /> <b>Handed back by {esc.returnedByName}</b>
                                {esc.returnNote ? `: ${esc.returnNote}` : ''}
                            </span>
                        )}
                        {!open && f.outcome && (
                            <span className='rcp-fu-outcome'>
                                {f.outcome}
                                {esc && f.completedByName && !isDept ? ` — ${f.completedByName}, ${esc.departmentName}` : ''}
                            </span>
                        )}
                        <span className='rcp-inquiry-meta'>
                            <span className='rcp-fu-type'>
                                {TYPE_ICON[f.followUpType] || <ClockCircleOutlined />} {f.followUpType}
                            </span>
                            <span className='rcp-pill' style={{ ['--pill' as any]: PRIORITY_COLORS[f.priority] || '#8c8c8c' }}>
                                {f.priority}
                            </span>
                            {f.customerPhone && (
                                <a className='rcp-fu-contact' href={`tel:${f.customerPhone}`} onClick={stop}>
                                    <PhoneOutlined /> {f.customerPhone}
                                </a>
                            )}
                            {f.customerEmail && (
                                <a className='rcp-fu-contact' href={`mailto:${f.customerEmail}`} onClick={stop}>
                                    <MailOutlined /> {f.customerEmail}
                                </a>
                            )}
                        </span>
                    </span>
                </button>

                {withDepartment && !isDept && (
                    <div className='rcp-fu-actions'>
                        <Button size='small' icon={<RollbackOutlined />} onClick={() => takeBack(f)}>
                            Take back
                        </Button>
                    </div>
                )}

                {open && !(withDepartment && !isDept) && (
                    <div className='rcp-fu-actions'>
                        <Button type='primary' size='small' icon={<CheckOutlined />} onClick={() => openComplete(f)}>
                            Done
                        </Button>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: [
                                    ...rescheduleOptions(f.scheduledDate, now).map(option => ({
                                        key: option.key,
                                        label: `${option.label} (${dayjs(option.date).format('ddd D MMM')})`
                                    })),
                                    { type: 'divider' as const },
                                    { key: 'pick', label: 'Pick a date…' }
                                ],
                                onClick: ({ key }) => {
                                    if (key === 'pick') {
                                        pickForm.setFieldsValue({ date: f.scheduledDate ? dayjs(f.scheduledDate) : dayjs().add(1, 'day') })
                                        setPicking(f)
                                        return
                                    }
                                    const option = rescheduleOptions(f.scheduledDate, new Date()).find(o => o.key === key)
                                    if (option) reschedule(f, option.date)
                                }
                            }}
                        >
                            <Button size='small' icon={<ScheduleOutlined />}>
                                Reschedule
                            </Button>
                        </Dropdown>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: isDept
                                    ? [{ key: 'handBack', label: 'Hand back to reception', icon: <RollbackOutlined /> }]
                                    : [
                                          { key: 'escalate', label: 'Escalate to a department', icon: <ExportOutlined /> },
                                          { type: 'divider' as const },
                                          { key: 'edit', label: 'Edit details' },
                                          { key: 'cancel', label: 'Cancel follow-up', danger: true }
                                      ],
                                onClick: ({ key }) => {
                                    if (key === 'escalate') openEscalate(f)
                                    else if (key === 'handBack') {
                                        handBackForm.resetFields()
                                        setHandingBack(f)
                                    } else if (key === 'edit') openEdit(f)
                                    else cancelFollowUp(f)
                                }
                            }}
                        >
                            <Button size='small' type='text' icon={<EllipsisOutlined />} aria-label='More actions' />
                        </Dropdown>
                    </div>
                )}
            </li>
        )
    }

    const emptyText: Record<FollowUpBucket, string> = {
        overdue: 'Nothing overdue. Well done.',
        today: 'Nothing due today.',
        upcoming: 'Nothing booked after today.',
        escalated: 'Nothing is with a department right now.',
        done: isDept ? 'You have not finished any escalated follow-ups yet.' : 'No follow-ups finished yet.'
    }

    return (
        <div className='admin-overview rcp-dashboard' style={{ ['--rcp-data' as any]: DATA }}>
            <Helmet>
                <title>Follow-ups | Smart Incubation</title>
            </Helmet>

            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<ExclamationCircleOutlined />}
                        label='Overdue'
                        value={byBucket.overdue.length}
                        visual={
                            <span title={`${byBucket.overdue.length} of ${figures.open} open follow-ups`}>
                                <AdminShareRing value={byBucket.overdue.length} total={figures.open} color={token.colorError} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<ClockCircleOutlined />}
                        label='Due today'
                        value={byBucket.today.length}
                        visual={
                            <span title={`${byBucket.today.length} of ${figures.open} open follow-ups`}>
                                <AdminShareRing value={byBucket.today.length} total={figures.open} color={DATA} />
                            </span>
                        }
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<CalendarOutlined />}
                        label='Next 7 days'
                        value={figures.nextWeek}
                        visual={<AdminMiniBars bars={figures.nextDays} />}
                    />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        label='Done this month'
                        value={figures.completedThisMonth}
                        visual={<AdminMiniBars bars={figures.monthBars} />}
                    />
                </Col>
            </Row>

            <div className='admin-toolbar rcp-fu-toolbar'>
                <Segmented
                    className='admin-toolbar-tabs'
                    value={tab}
                    onChange={value => {
                        setTab(value as FollowUpBucket)
                        setTabChosen(true)
                        setDoneShown(DONE_PAGE)
                    }}
                    options={TABS[mode].map(key => ({
                        value: key,
                        label: (
                            <span className='admin-toolbar-tab'>
                                {TAB_LABEL[key]}
                                <span className={`rcp-fu-tab-count is-${key}`}>{byBucket[key].length}</span>
                            </span>
                        )
                    }))}
                />
                <Input
                    allowClear
                    className='admin-toolbar-search'
                    prefix={<SearchOutlined />}
                    placeholder='Search name, email or note'
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                />
                <div className='admin-toolbar-actions'>
                    <Select
                        value={priority}
                        onChange={setPriority}
                        style={{ width: 140 }}
                        options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map(p => ({ value: p, label: p }))]}
                    />
                </div>
            </div>

            <Card className='admin-card rcp-fu-card' bordered={false}>
                <div className='admin-card-head'>
                    <div>
                        <h3>
                            {TAB_LABEL[tab]} follow-ups
                        </h3>
                        <span>
                            {isDept ? 'Escalated to you' : `${branchName} reception`} · {visible.length}{' '}
                            {visible.length === 1 ? 'follow-up' : 'follow-ups'}
                            {search || priority !== 'all' ? ' match your filters' : ''}
                        </span>
                    </div>
                </div>

                {loading ? (
                    <Skeleton active avatar paragraph={{ rows: 3 }} />
                ) : visible.length ? (
                    <>
                        {groups.map(group => (
                            <section key={group.key} className='rcp-fu-group'>
                                {group.title && <h4 className='rcp-fu-day'>{group.title}</h4>}
                                <ul className='rcp-inquiry-list'>{group.rows.map(renderRow)}</ul>
                            </section>
                        ))}
                        {tab === 'done' && visible.length > doneShown && (
                            <Button block type='text' onClick={() => setDoneShown(n => n + DONE_PAGE)} style={{ marginTop: 8 }}>
                                Show {Math.min(DONE_PAGE, visible.length - doneShown)} more
                            </Button>
                        )}
                    </>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={search || priority !== 'all' ? 'No follow-ups match your filters.' : emptyText[tab]}
                    />
                )}
            </Card>

            {/* Mark done, with what came of it, and optionally book the next one. */}
            <Modal
                title={completing ? `Done: ${completing.customerName}` : 'Done'}
                open={Boolean(completing)}
                onCancel={() => setCompleting(null)}
                okText='Mark as done'
                okButtonProps={{ loading: saving }}
                onOk={() => completeForm.submit()}
                destroyOnClose
            >
                <Form form={completeForm} layout='vertical' onFinish={submitComplete} requiredMark={false}>
                    <Form.Item
                        label='What came of it?'
                        name='outcome'
                        rules={[{ required: true, whitespace: true, message: 'Add a short note on the outcome.' }]}
                    >
                        <Input.TextArea rows={3} placeholder='e.g. Spoke to them; sending the application link today.' maxLength={1000} showCount />
                    </Form.Item>
                    {/* Reception books the next touchpoint; a department closes its escalation with the outcome. */}
                    {!isDept && (
                        <Form.Item name='bookNext' valuePropName='checked' style={{ marginBottom: 8 }}>
                            <Checkbox>Book the next follow-up</Checkbox>
                        </Form.Item>
                    )}
                    <Form.Item noStyle shouldUpdate={(a, b) => a.bookNext !== b.bookNext}>
                        {({ getFieldValue }) =>
                            getFieldValue('bookNext') ? (
                                <Row gutter={12}>
                                    <Col xs={24} sm={14}>
                                        <Form.Item label='When' name='nextDate' rules={[{ required: true, message: 'Pick a date.' }]}>
                                            <DatePicker
                                                showTime={{ format: 'HH:mm', minuteStep: 15 }}
                                                format='ddd D MMM YYYY, HH:mm'
                                                style={{ width: '100%' }}
                                                disabledDate={d => d.isBefore(dayjs().startOf('day')) || d.day() === 0 || d.day() === 6}
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} sm={10}>
                                        <Form.Item label='How' name='nextType' rules={[{ required: true }]}>
                                            <Select options={TYPES.map(t => ({ value: t, label: t }))} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={24}>
                                        <Form.Item label='Note for next time' name='nextNotes' style={{ marginBottom: 0 }}>
                                            <Input placeholder='Optional' maxLength={300} />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            ) : null
                        }
                    </Form.Item>
                </Form>
            </Modal>

            {/* Reschedule to a date of your choosing. */}
            <Modal
                title={picking ? `Reschedule: ${picking.customerName}` : 'Reschedule'}
                open={Boolean(picking)}
                onCancel={() => setPicking(null)}
                okText='Reschedule'
                okButtonProps={{ loading: saving }}
                onOk={() => pickForm.submit()}
                destroyOnClose
                width={420}
            >
                <Form form={pickForm} layout='vertical' onFinish={submitPick} requiredMark={false}>
                    <Form.Item label='New date' name='date' rules={[{ required: true, message: 'Pick a date.' }]} style={{ marginBottom: 0 }}>
                        <DatePicker
                            showTime={{ format: 'HH:mm', minuteStep: 15 }}
                            format='ddd D MMM YYYY, HH:mm'
                            style={{ width: '100%' }}
                            disabledDate={d => d.isBefore(dayjs().startOf('day')) || d.day() === 0 || d.day() === 6}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            {/* Escalate to a department's coordinators, with what they need to know. */}
            <Modal
                title={escalating ? `Escalate: ${escalating.customerName}` : 'Escalate'}
                open={Boolean(escalating)}
                onCancel={() => setEscalating(null)}
                okText='Escalate'
                okButtonProps={{ loading: saving }}
                onOk={() => escalateForm.submit()}
                destroyOnClose
            >
                <Form form={escalateForm} layout='vertical' onFinish={submitEscalate} requiredMark={false}>
                    <Form.Item
                        label='Department'
                        name='departmentId'
                        extra="Its coordinators at this centre get it, and a notification. If it has none here, its coordinators at other centres do."
                        rules={[{ required: true, message: 'Choose a department.' }]}
                    >
                        <Select
                            showSearch
                            optionFilterProp='label'
                            placeholder='Choose a department'
                            loading={!departments.length}
                            options={departments.map(d => ({ value: d.id, label: d.name }))}
                        />
                    </Form.Item>
                    <Form.Item
                        label='What do they need to do?'
                        name='note'
                        rules={[{ required: true, whitespace: true, message: 'Tell them what the SME needs.' }]}
                        style={{ marginBottom: 0 }}
                    >
                        <Input.TextArea rows={3} maxLength={1000} showCount placeholder='e.g. Wants advice on registering a trademark before launch.' />
                    </Form.Item>
                </Form>
            </Modal>

            {/* A department coordinator hands it back to reception. */}
            <Modal
                title={handingBack ? `Hand back: ${handingBack.customerName}` : 'Hand back'}
                open={Boolean(handingBack)}
                onCancel={() => setHandingBack(null)}
                okText='Hand back to reception'
                okButtonProps={{ loading: saving }}
                onOk={() => handBackForm.submit()}
                destroyOnClose
            >
                <Form form={handBackForm} layout='vertical' onFinish={submitHandBack} requiredMark={false}>
                    <Form.Item
                        label='Note for reception'
                        name='note'
                        rules={[{ required: true, whitespace: true, message: 'Tell reception why, or what to tell the SME.' }]}
                        style={{ marginBottom: 0 }}
                    >
                        <Input.TextArea rows={3} maxLength={1000} showCount placeholder='e.g. Not one for Legal — they need Financial Compliance.' />
                    </Form.Item>
                </Form>
            </Modal>

            {/* A department coordinator's view of the inquiry: what travelled with the escalation. */}
            <Modal
                title={viewing?.customerName || 'Follow-up'}
                open={Boolean(viewing)}
                onCancel={() => setViewing(null)}
                footer={
                    viewing && isOpenFollowUp(viewing)
                        ? [
                              <Button
                                  key='back'
                                  icon={<RollbackOutlined />}
                                  onClick={() => {
                                      handBackForm.resetFields()
                                      setHandingBack(viewing)
                                  }}
                              >
                                  Hand back
                              </Button>,
                              <Button
                                  key='done'
                                  type='primary'
                                  icon={<CheckOutlined />}
                                  onClick={() => {
                                      const f = viewing
                                      setViewing(null)
                                      openComplete(f)
                                  }}
                              >
                                  Done
                              </Button>
                          ]
                        : null
                }
                destroyOnClose
            >
                {viewing && (
                    <dl className='rcp-fu-facts'>
                        <dt>From reception</dt>
                        <dd>
                            {viewing.escalation?.note || '—'}
                            <small>
                                {viewing.escalation?.byName}
                                {viewing.escalation?.at ? `, ${dayjs(viewing.escalation.at).format('D MMM, HH:mm')}` : ''}
                            </small>
                        </dd>
                        <dt>Inquiry</dt>
                        <dd>
                            {[viewing.inquirySubject, viewing.escalation?.company].filter(Boolean).join(' · ') || '—'}
                            {viewing.escalation?.description && <p>{viewing.escalation.description}</p>}
                        </dd>
                        <dt>Contact</dt>
                        <dd>
                            {viewing.customerPhone && <a href={`tel:${viewing.customerPhone}`}>{viewing.customerPhone}</a>}
                            {viewing.customerPhone && viewing.customerEmail ? ' · ' : ''}
                            {viewing.customerEmail && <a href={`mailto:${viewing.customerEmail}`}>{viewing.customerEmail}</a>}
                            {!viewing.customerPhone && !viewing.customerEmail && '—'}
                        </dd>
                        <dt>Due</dt>
                        <dd>
                            {dueLabel(viewing.scheduledDate, now)} · {viewing.followUpType} · {viewing.priority}
                        </dd>
                        {viewing.outcome && (
                            <>
                                <dt>Outcome</dt>
                                <dd>{viewing.outcome}</dd>
                            </>
                        )}
                    </dl>
                )}
            </Modal>

            {/* Edit the follow-up's own details. */}
            <Modal
                title={editing ? `Edit follow-up: ${editing.customerName}` : 'Edit follow-up'}
                open={Boolean(editing)}
                onCancel={() => setEditing(null)}
                okText='Save'
                okButtonProps={{ loading: saving }}
                onOk={() => editForm.submit()}
                destroyOnClose
            >
                <Form form={editForm} layout='vertical' onFinish={submitEdit} requiredMark={false}>
                    <Row gutter={12}>
                        <Col xs={24} sm={14}>
                            <Form.Item label='When' name='scheduledDate' rules={[{ required: true, message: 'Pick a date.' }]}>
                                <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format='ddd D MMM YYYY, HH:mm' style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={10}>
                            <Form.Item label='How' name='followUpType' rules={[{ required: true }]}>
                                <Select options={TYPES.map(t => ({ value: t, label: t }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={14}>
                            <Form.Item label='Priority' name='priority' rules={[{ required: true }]}>
                                <Select options={PRIORITIES.map(p => ({ value: p, label: p }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item label='Notes' name='notes' style={{ marginBottom: 0 }}>
                        <Input.TextArea rows={3} maxLength={1000} showCount />
                    </Form.Item>
                </Form>
            </Modal>

            <Drawer
                open={Boolean(openInquiryId)}
                onClose={() => setOpenInquiryId(null)}
                width='min(720px, 100vw)'
                title={null}
                destroyOnClose
                styles={{ body: { padding: 24 } }}
            >
                {openInquiryId && <InquiryDetail inquiryId={openInquiryId} embedded />}
            </Drawer>
        </div>
    )
}

export default FollowUpsList
