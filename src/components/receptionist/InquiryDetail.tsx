import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  message
} from 'antd'
import {
  CheckOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  MailOutlined,
  MessageOutlined,
  PhoneOutlined,
  PlusOutlined,
  RollbackOutlined,
  ScheduleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import { inquiryService } from '@/services/inquiryService'
import { followUpService, type FollowUp } from '@/services/followUpService'
import { PRIORITY_COLORS, STATUS_COLORS } from '@/types/inquiry'
import type { Inquiry, InquiryStatus } from '@/types/inquiry'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import RecordUnavailable from '@/components/shared/RecordUnavailable'
import { channelLabel, resolveInquiryAudience, resolveInquiryChannel } from '@/utils/inquirySource'
import { dueLabel, followUpBucket, isEscalatedOpen, isOpenFollowUp, rescheduleOptions } from '@/lib/followUpBuckets'
import { buildInquiryActivity, type ActivityKind } from '@/lib/inquiryActivity'
import { INQUIRY_STATUSES } from '@/lib/inquiryList'
import InquiryEmailComposer from './InquiryEmailComposer'
import '@/styles/receptionist-dashboard.css'

/*
 * One inquiry, for the people who answer it: who it is and what they asked,
 * the next step, its follow-ups (from the same records as the follow-ups page,
 * with their actions), and one activity list of everything that has happened.
 * Emails and logged notes are written from here, under the sender's own name.
 */

/** The next step for an inquiry, so a page can show its button (e.g. in its own header). */
export type InquiryStatusAction = {
  status: InquiryStatus
  label: string
  loading: boolean
  run: () => void
}

const nextStatusFor = (status?: InquiryStatus): InquiryStatus | null => {
  switch (status) {
    case 'New':
      return 'In Progress'
    case 'In Progress':
    case 'Contacted':
      return 'Resolved'
    case 'Resolved':
    case 'Converted':
      return 'Closed'
    default:
      return null
  }
}

const statusActionLabel = (next: InquiryStatus) =>
  next === 'In Progress' ? 'Move to In Progress' : next === 'Resolved' ? 'Mark as Resolved' : 'Close inquiry'

const outcomeLabel = (status: InquiryStatus) =>
  ({
    New: 'Back to New',
    'In Progress': 'In Progress',
    Contacted: 'Contacted',
    Converted: 'Converted (joined a programme)',
    Resolved: 'Resolved',
    Closed: 'Closed',
    Lost: 'Lost'
  } as Record<string, string>)[status] || status

interface InquiryDetailProps {
  inquiryId: string
  onEdit?: () => void
  embedded?: boolean
  /**
   * When given, the page owns the status and edit buttons (in its header): the next status is
   * reported here and this view's own next-step button is not shown.
   */
  onStatusAction?: (action: InquiryStatusAction | null) => void
  /** Where this role's inquiry list lives; the way out when the inquiry can't be shown. */
  listPath?: { label: string; to: string }
  /** Told when the inquiry turns out to be missing or unreadable, so the page can drop its header actions. */
  onUnavailable?: (unavailable: boolean) => void
}

// Firestore Timestamp | Date | number | ISO string -> Date | null
const asDate = (v: any): Date | null => {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v?.toDate === 'function') {
    const d = v.toDate()
    return isNaN(d.getTime()) ? null : d
  }
  if (v?.seconds) {
    const d = new Date(v.seconds * 1000)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

const TYPES: FollowUp['followUpType'][] = ['Phone', 'Email', 'In-person', 'Video Call']
const ACTIVITY_SHOWN = 8

const ACTIVITY_ICON: Record<ActivityKind, React.ReactNode> = {
  received: <PlusOutlined />,
  status: <CheckOutlined />,
  email: <MailOutlined />,
  note: <MessageOutlined />,
  'followup-booked': <ScheduleOutlined />,
  'followup-done': <CheckOutlined />,
  'followup-cancelled': <RollbackOutlined />,
  escalated: <ExportOutlined />,
  returned: <RollbackOutlined />
}

const noWeekendsOrPast = (d: dayjs.Dayjs) => d.isBefore(dayjs().startOf('day')) || d.day() === 0 || d.day() === 6

const InquiryDetail: React.FC<InquiryDetailProps> = ({
  inquiryId,
  onEdit,
  embedded = false,
  onStatusAction,
  listPath = { label: 'Back to inquiries', to: '/inquiries' },
  onUnavailable
}) => {
  const { user } = useFullIdentity()
  const me = {
    uid: user?.uid || 'system',
    name: user?.name || user?.email || 'Team member',
    role: user?.role || 'staff',
    email: user?.email || ''
  }
  const canEscalate = ['receptionist', 'projectadmin', 'director', 'system_admin'].includes(me.role)

  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [activityAll, setActivityAll] = useState(false)
  const [saving, setSaving] = useState(false)

  const [emailOpen, setEmailOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [outcomeFor, setOutcomeFor] = useState<InquiryStatus | null>(null)
  const [booking, setBooking] = useState(false)
  const [completing, setCompleting] = useState<FollowUp | null>(null)
  const [picking, setPicking] = useState<FollowUp | null>(null)
  const [escalating, setEscalating] = useState<FollowUp | null>(null)
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])

  const [noteForm] = Form.useForm()
  const [outcomeForm] = Form.useForm()
  const [bookForm] = Form.useForm()
  const [doneForm] = Form.useForm()
  const [pickForm] = Form.useForm()
  const [escalateForm] = Form.useForm()

  const unavailable = !loading && (!inquiry || !inquiry.contactInfo || !inquiry.inquiryDetails)
  useEffect(() => {
    onUnavailable?.(unavailable)
  }, [unavailable, onUnavailable])

  const load = useCallback(
    async (quiet = false) => {
      if (!inquiryId) return setLoading(false)
      if (!quiet) setLoading(true)
      try {
        const data = await inquiryService.getInquiryById(inquiryId)
        if (!data) {
          setInquiry(null)
          return
        }
        const normalized = {
          ...data,
          submittedAt: asDate(data.submittedAt),
          followUp: data.followUp ? { ...data.followUp, nextFollowUpDate: asDate(data.followUp.nextFollowUpDate) } : undefined,
          statusHistory: (data.statusHistory || []).map((e: any) => ({ ...e, changedAt: asDate(e.changedAt) })),
          communications: (data.communications || []).map((c: any) => ({ ...c, sentAt: asDate(c.sentAt) }))
        } as Inquiry
        setInquiry(normalized)
        setFollowUps(await followUpService.getFollowUpsForInquiry(inquiryId).catch(() => []))

        // Opening an SME-submitted inquiry counts as acknowledging it (clears the
        // "new inquiry" sidebar badge). Best-effort - never blocks the view.
        if (data.source === 'SME' && !data.acknowledgedAt) {
          inquiryService.acknowledgeInquiry(inquiryId, me.uid).catch(() => {})
        }
      } catch (error) {
        console.error('Error loading inquiry:', error)
        message.error('Could not load this inquiry.')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inquiryId]
  )

  useEffect(() => {
    load()
  }, [load])

  // Older status changes and notes stored only a user id: look the names up once.
  useEffect(() => {
    if (!inquiry) return
    const ids = new Set<string>()
    ;(inquiry.statusHistory || []).forEach(e => e.changedBy && !e.changedByName && ids.add(e.changedBy))
    ;(inquiry.communications || []).forEach(c => c.sentBy && ids.add(c.sentBy))
    ids.delete('system')
    const missing = [...ids].filter(id => !(id in names))
    if (!missing.length) return
    Promise.all(
      missing.map(id =>
        getDoc(doc(db, 'users', id))
          .then(snap => [id, String(snap.data()?.name || snap.data()?.email || '')] as const)
          .catch(() => [id, ''] as const)
      )
    ).then(pairs => setNames(prev => ({ ...prev, ...Object.fromEntries(pairs) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiry])

  // ---- Status ----
  const changeStatus = async (status: InquiryStatus, note?: string) => {
    if (!inquiry) return
    setStatusUpdating(true)
    try {
      await inquiryService.updateInquiryStatus(inquiryId, status, me.uid, note?.trim() || undefined, me.name)
      message.success(`Status changed to ${status}.`)
      await load(true)
    } catch (error) {
      console.error('Error updating status:', error)
      message.error('Could not change the status.')
    } finally {
      setStatusUpdating(false)
    }
  }
  const changeStatusRef = useRef(changeStatus)
  changeStatusRef.current = changeStatus

  const nextStatus = nextStatusFor(inquiry?.status)
  useEffect(() => {
    if (!onStatusAction) return
    onStatusAction(
      nextStatus
        ? { status: nextStatus, label: statusActionLabel(nextStatus), loading: statusUpdating, run: () => changeStatusRef.current(nextStatus) }
        : null
    )
  }, [nextStatus, statusUpdating, onStatusAction])
  useEffect(() => () => onStatusAction?.(null), [onStatusAction])

  // ---- Follow-up actions (the same as on the follow-ups page) ----
  const afterFollowUpChange = async (text: string) => {
    message.success(text)
    await load(true)
  }

  const submitBook = async (values: any) => {
    if (!inquiry) return
    setSaving(true)
    try {
      await followUpService.createFollowUp({
        inquiryId,
        branchId: inquiry.branchId,
        scheduledDate: values.date.toDate(),
        followUpType: values.type,
        priority: inquiry.priority,
        notes: values.notes || '',
        assignedTo: me.uid,
        assignedToName: me.name,
        assignedToEmail: me.email
      })
      setBooking(false)
      await afterFollowUpChange('Follow-up booked.')
    } catch (error) {
      console.error('Error booking follow-up:', error)
      message.error('Could not book the follow-up.')
    } finally {
      setSaving(false)
    }
  }

  const submitDone = async (values: any) => {
    if (!completing) return
    setSaving(true)
    try {
      await followUpService.completeFollowUp(
        completing,
        values.outcome,
        { uid: me.uid, name: me.name, email: me.email },
        values.bookNext ? { scheduledDate: values.nextDate.toDate(), followUpType: values.nextType } : undefined
      )
      setCompleting(null)
      await afterFollowUpChange(values.bookNext ? 'Done, and the next follow-up is booked.' : 'Follow-up marked as done.')
    } catch (error) {
      console.error('Error completing follow-up:', error)
      message.error('Could not mark the follow-up as done.')
    } finally {
      setSaving(false)
    }
  }

  const reschedule = async (followUp: FollowUp, date: Date) => {
    try {
      await followUpService.updateFollowUp(followUp.id, { scheduledDate: date })
      setPicking(null)
      await afterFollowUpChange(`Moved to ${dueLabel(date, new Date())}.`)
    } catch (error) {
      console.error('Error rescheduling follow-up:', error)
      message.error('Could not reschedule the follow-up.')
    }
  }

  const openEscalate = async (followUp: FollowUp) => {
    escalateForm.resetFields()
    const departmentId = (inquiry?.inquiryDetails as any)?.departmentId
    if (departmentId) escalateForm.setFieldsValue({ departmentId })
    setEscalating(followUp)
    if (!departments.length) {
      const snap = await getDocs(collection(db, 'departments')).catch(() => null)
      if (snap) {
        setDepartments(
          snap.docs
            .map(d => ({ id: d.id, name: String(d.data().name || '').trim() }))
            .filter(d => d.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      }
    }
  }

  const submitEscalate = async (values: any) => {
    if (!escalating) return
    const department = departments.find(d => d.id === values.departmentId)
    if (!department) return
    setSaving(true)
    try {
      const recipients = await followUpService.escalateFollowUp(escalating, department, values.note, { uid: me.uid, name: me.name })
      setEscalating(null)
      await afterFollowUpChange(`Escalated to ${department.name}: ${recipients.map(r => r.name).join(', ')}.`)
    } catch (error) {
      if (error instanceof Error && error.message === 'no_coordinator') {
        message.error(`${department.name} has no coordinator set up yet, so there is no one to escalate to.`)
      } else {
        console.error('Error escalating follow-up:', error)
        message.error('Could not escalate the follow-up.')
      }
    } finally {
      setSaving(false)
    }
  }

  // ---- Notes ----
  const submitNote = async (values: any) => {
    setSaving(true)
    try {
      await inquiryService.addCommunication(inquiryId, {
        type: 'note',
        noteKind: values.kind,
        message: values.text.trim(),
        sentBy: me.uid,
        sentByName: me.name,
        sentByRole: me.role,
        isInternal: true
      })
      setNoteOpen(false)
      message.success('Note saved.')
      await load(true)
    } catch (error) {
      console.error('Error saving note:', error)
      message.error('Could not save the note.')
    } finally {
      setSaving(false)
    }
  }

  // ---- Activity ----
  const activity = useMemo(
    () =>
      inquiry
        ? buildInquiryActivity({
            submittedAt: asDate(inquiry.submittedAt),
            sourceLabel: channelLabel(resolveInquiryChannel(inquiry.source)),
            communications: inquiry.communications as any,
            statusHistory: inquiry.statusHistory as any,
            followUps,
            names
          })
        : [],
    [inquiry, followUps, names]
  )

  // ---- Rendering ----

  if (loading) {
    return (
      <div style={{ padding: embedded ? 0 : 24 }}>
        <Skeleton active avatar paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (!inquiry) return <RecordUnavailable noun='inquiry' reason='not-found' back={listPath} />

  if (!inquiry.contactInfo || !inquiry.inquiryDetails) {
    const missing = [!inquiry.contactInfo && 'contact details', !inquiry.inquiryDetails && 'inquiry details'].filter(Boolean).join(' and ')
    return <RecordUnavailable noun='inquiry' reason='incomplete' back={listPath} detail={`Missing ${missing}`} />
  }

  const contact = inquiry.contactInfo
  const details = inquiry.inquiryDetails
  const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed contact'
  const initials = `${contact.firstName?.charAt(0) || ''}${contact.lastName?.charAt(0) || ''}`.toUpperCase() || '?'
  const received = asDate(inquiry.submittedAt)
  const isSme = resolveInquiryAudience(inquiry as any) === 'Incubatee'
  const now = new Date()
  const openFollowUps = followUps.filter(isOpenFollowUp)
  const pastFollowUps = followUps.filter(f => !isOpenFollowUp(f)).reverse()

  const facts: [string, React.ReactNode][] = [
    ['Department', details.department],
    ['Type', details.inquiryType],
    ['Business stage', details.businessStage],
    ['Industry', details.industry],
    ['Services', details.servicesOfInterest?.length ? details.servicesOfInterest.join(', ') : null],
    ['Budget', details.budget],
    ['Timeline', details.timeline],
    ['Classification', inquiry.classification]
  ].filter(([, value]) => Boolean(value)) as [string, React.ReactNode][]

  const renderFollowUp = (f: FollowUp) => {
    const open = isOpenFollowUp(f)
    const withDept = open && isEscalatedOpen(f)
    const bucket = followUpBucket(f, now)
    return (
      <li key={f.id} className={`rcp-det-fu is-${open ? (withDept ? 'escalated' : bucket) : 'done'}`}>
        <div className='rcp-det-fu-top'>
          <strong>
            {open
              ? withDept
                ? `With ${f.escalation?.departmentName}`
                : dueLabel(f.scheduledDate, now)
              : f.status === 'Cancelled'
                ? 'Cancelled'
                : `Done ${dayjs(f.completedAt || f.updatedAt).format('D MMM')}`}
          </strong>
          <span>{f.followUpType}</span>
        </div>
        {f.notes && <p>{f.notes}</p>}
        {withDept && f.escalation?.note && <p className='rcp-det-fu-note'>{f.escalation.note}</p>}
        {open && f.escalation?.status === 'returned' && (
          <p className='rcp-det-fu-note'>
            Handed back by {f.escalation.returnedByName}
            {f.escalation.returnNote ? `: ${f.escalation.returnNote}` : ''}
          </p>
        )}
        {!open && f.outcome && (
          <p className='rcp-det-fu-note'>
            {f.outcome}
            {f.completedByName ? ` — ${f.completedByName}` : ''}
          </p>
        )}
        {open && !withDept && (
          <div className='rcp-det-fu-actions'>
            <Button
              size='small'
              type='primary'
              icon={<CheckOutlined />}
              onClick={() => {
                doneForm.resetFields()
                doneForm.setFieldsValue({ bookNext: false, nextType: f.followUpType, nextDate: dayjs(rescheduleOptions(f.scheduledDate, new Date())[1].date) })
                setCompleting(f)
              }}
            >
              Done
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  ...rescheduleOptions(f.scheduledDate, now).map(o => ({ key: o.key, label: `${o.label} (${dayjs(o.date).format('ddd D MMM')})` })),
                  { type: 'divider' as const },
                  { key: 'pick', label: 'Pick a date…' },
                  ...(canEscalate ? [{ type: 'divider' as const }, { key: 'escalate', label: 'Escalate to a department', icon: <ExportOutlined /> }] : [])
                ],
                onClick: ({ key }) => {
                  if (key === 'escalate') return openEscalate(f)
                  if (key === 'pick') {
                    pickForm.setFieldsValue({ date: f.scheduledDate ? dayjs(f.scheduledDate) : dayjs().add(1, 'day') })
                    return setPicking(f)
                  }
                  const option = rescheduleOptions(f.scheduledDate, new Date()).find(o => o.key === key)
                  if (option) reschedule(f, option.date)
                }
              }}
            >
              <Button size='small' icon={<ScheduleOutlined />}>
                Reschedule <DownOutlined />
              </Button>
            </Dropdown>
          </div>
        )}
      </li>
    )
  }

  const shownActivity = activityAll ? activity : activity.slice(0, ACTIVITY_SHOWN)

  return (
    <div className={`rcp-dashboard rcp-inq-detail${embedded ? ' is-embedded' : ''}`}>
      {/* Who, and what state it is in. */}
      <header className='rcp-det-head'>
        <Avatar size={52} className='rcp-inquiry-avatar'>
          {initials}
        </Avatar>
        <div className='rcp-det-who'>
          <h2>
            {name}
            {inquiry.isRepresentative && <span className='rcp-inq-rep'>Representative</span>}
          </h2>
          <div className='rcp-det-sub'>
            {[contact.position, contact.company, isSme ? 'SME' : 'Non-incubatee'].filter(Boolean).join(' · ')}
          </div>
          <div className='rcp-inquiry-meta'>
            <span className='rcp-pill' style={{ ['--pill' as any]: STATUS_COLORS[inquiry.status as keyof typeof STATUS_COLORS] || '#8c8c8c' }}>
              {inquiry.status}
            </span>
            <span className='rcp-pill' style={{ ['--pill' as any]: PRIORITY_COLORS[inquiry.priority] || '#8c8c8c' }}>
              {inquiry.priority}
            </span>
            <span className='rcp-inquiry-channel'>
              {channelLabel(resolveInquiryChannel(inquiry.source))}
              {received ? ` · received ${dayjs(received).format('D MMM YYYY, HH:mm')}` : ''}
            </span>
          </div>
        </div>
        <div className='rcp-det-contact'>
          {contact.phone && (
            <Button href={`tel:${contact.phone}`} icon={<PhoneOutlined />}>
              Call
            </Button>
          )}
          {contact.email && (
            <Button icon={<MailOutlined />} onClick={() => setEmailOpen(true)}>
              Email
            </Button>
          )}
        </div>
      </header>

      {/* The next step: the usual next status, any other outcome, and edit. */}
      <div className='rcp-det-next'>
        {!onStatusAction && nextStatus && (
          <Button type='primary' loading={statusUpdating} onClick={() => changeStatus(nextStatus)}>
            {statusActionLabel(nextStatus)}
          </Button>
        )}
        <Dropdown
          trigger={['click']}
          menu={{
            items: INQUIRY_STATUSES.filter(s => s !== inquiry.status && s !== nextStatus).map(s => ({ key: s, label: outcomeLabel(s as InquiryStatus) })),
            onClick: ({ key }) => {
              outcomeForm.resetFields()
              setOutcomeFor(key as InquiryStatus)
            }
          }}
        >
          <Button>
            {onStatusAction || !nextStatus ? 'Change status' : 'Other outcome'} <DownOutlined />
          </Button>
        </Dropdown>
        <span className='rcp-det-next-spacer' />
        <Button icon={<MessageOutlined />} onClick={() => { noteForm.resetFields(); noteForm.setFieldsValue({ kind: 'call' }); setNoteOpen(true) }}>
          Log a note
        </Button>
        {!onStatusAction && onEdit && (
          <Button icon={<EditOutlined />} onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>

      <Row gutter={[20, 20]}>
        {/* What they asked. */}
        <Col xs={24} lg={13}>
          <section className='rcp-det-card'>
            <h3>What they asked</h3>
            {details.description ? <p className='rcp-det-desc'>{details.description}</p> : <p className='rcp-det-muted'>No description given.</p>}
            {facts.length > 0 && (
              <dl className='rcp-det-facts'>
                {facts.map(([label, value]) => (
                  <React.Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </section>
          <section className='rcp-det-card'>
            <h3>Contact</h3>
            <dl className='rcp-det-facts'>
              <dt>Name</dt>
              <dd>{name}</dd>
              {contact.email && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </dd>
                </>
              )}
              {contact.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  </dd>
                </>
              )}
              {contact.company && (
                <>
                  <dt>Company</dt>
                  <dd>{contact.company}</dd>
                </>
              )}
              {contact.position && (
                <>
                  <dt>Position</dt>
                  <dd>{contact.position}</dd>
                </>
              )}
            </dl>
          </section>
        </Col>

        {/* Its follow-ups: the records the follow-ups page works from. */}
        <Col xs={24} lg={11}>
          <section className='rcp-det-card'>
            <div className='rcp-det-card-head'>
              <h3>Follow-ups</h3>
              <Button
                size='small'
                type='text'
                icon={<PlusOutlined />}
                onClick={() => {
                  bookForm.resetFields()
                  bookForm.setFieldsValue({ type: 'Phone', date: dayjs(rescheduleOptions(null, new Date())[0].date).hour(9).minute(0) })
                  setBooking(true)
                }}
              >
                Book
              </Button>
            </div>
            {followUps.length ? (
              <ul className='rcp-det-fus'>
                {openFollowUps.map(renderFollowUp)}
                {pastFollowUps.map(renderFollowUp)}
              </ul>
            ) : (
              <p className='rcp-det-muted'>No follow-ups yet. Book one to put it on the follow-ups list.</p>
            )}
          </section>
        </Col>
      </Row>

      {/* Everything that has happened, newest first. */}
      <section className='rcp-det-card'>
        <h3>Activity</h3>
        {activity.length ? (
          <ol className='rcp-det-activity'>
            {shownActivity.map(item => (
              <li key={item.key} className={`is-${item.kind}`}>
                <span className='rcp-det-act-icon'>{ACTIVITY_ICON[item.kind]}</span>
                <div>
                  <div className='rcp-det-act-top'>
                    <strong>{item.title}</strong>
                    <time title={dayjs(item.at).format('D MMM YYYY, HH:mm')}>{dayjs(item.at).format('D MMM, HH:mm')}</time>
                  </div>
                  {item.by && <small>{item.by}</small>}
                  {item.body && <p>{item.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Nothing has happened yet.' />
        )}
        {activity.length > ACTIVITY_SHOWN && (
          <Button type='text' block onClick={() => setActivityAll(v => !v)}>
            {activityAll ? 'Show less' : `Show all ${activity.length}`}
          </Button>
        )}
      </section>

      {/* ---- Dialogs ---- */}

      <InquiryEmailComposer
        inquiry={inquiry}
        inquiryId={inquiryId}
        open={emailOpen}
        sender={{ uid: me.uid, name: me.name, role: me.role }}
        onClose={() => setEmailOpen(false)}
        onSent={() => load(true)}
      />

      <Modal
        title='Log a note'
        open={noteOpen}
        onCancel={() => setNoteOpen(false)}
        okText='Save note'
        okButtonProps={{ loading: saving }}
        onOk={() => noteForm.submit()}
        destroyOnClose
      >
        <Form form={noteForm} layout='vertical' onFinish={submitNote} requiredMark={false}>
          <Form.Item label='What is it?' name='kind' rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'call', label: 'A phone call' },
                { value: 'visit', label: 'A visit or walk-in' },
                { value: 'internal', label: 'An internal note' }
              ]}
            />
          </Form.Item>
          <Form.Item
            label='Note'
            name='text'
            rules={[{ required: true, whitespace: true, message: 'Write what happened.' }]}
            extra='Saved to this inquiry only. Nothing is sent to the SME.'
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={4} maxLength={2000} showCount placeholder='e.g. Called; they will bring their CIPC documents on Monday.' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={outcomeFor ? `Change status to ${outcomeFor}` : 'Change status'}
        open={Boolean(outcomeFor)}
        onCancel={() => setOutcomeFor(null)}
        okText='Change status'
        okButtonProps={{ loading: statusUpdating }}
        onOk={() => outcomeForm.submit()}
        destroyOnClose
      >
        <Form
          form={outcomeForm}
          layout='vertical'
          requiredMark={false}
          onFinish={async values => {
            if (!outcomeFor) return
            await changeStatus(outcomeFor, values.note)
            setOutcomeFor(null)
          }}
        >
          <Form.Item
            label={outcomeFor === 'Lost' ? 'Why was it lost?' : 'Note (optional)'}
            name='note'
            rules={outcomeFor === 'Lost' ? [{ required: true, whitespace: true, message: 'Say why, so the reason is on record.' }] : []}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title='Book a follow-up'
        open={booking}
        onCancel={() => setBooking(false)}
        okText='Book'
        okButtonProps={{ loading: saving }}
        onOk={() => bookForm.submit()}
        destroyOnClose
      >
        <Form form={bookForm} layout='vertical' onFinish={submitBook} requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item label='When' name='date' rules={[{ required: true, message: 'Pick a date.' }]}>
                <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format='ddd D MMM YYYY, HH:mm' style={{ width: '100%' }} disabledDate={noWeekendsOrPast} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item label='How' name='type' rules={[{ required: true }]}>
                <Select options={TYPES.map(t => ({ value: t, label: t }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label='What to follow up' name='notes' style={{ marginBottom: 0 }}>
            <Input placeholder='Optional' maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title='Mark the follow-up as done'
        open={Boolean(completing)}
        onCancel={() => setCompleting(null)}
        okText='Mark as done'
        okButtonProps={{ loading: saving }}
        onOk={() => doneForm.submit()}
        destroyOnClose
      >
        <Form form={doneForm} layout='vertical' onFinish={submitDone} requiredMark={false}>
          <Form.Item label='What came of it?' name='outcome' rules={[{ required: true, whitespace: true, message: 'Add a short note on the outcome.' }]}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item name='bookNext' valuePropName='checked' style={{ marginBottom: 8 }}>
            <Checkbox>Book the next follow-up</Checkbox>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.bookNext !== b.bookNext}>
            {({ getFieldValue }) =>
              getFieldValue('bookNext') ? (
                <Row gutter={12}>
                  <Col xs={24} sm={14}>
                    <Form.Item label='When' name='nextDate' rules={[{ required: true, message: 'Pick a date.' }]} style={{ marginBottom: 0 }}>
                      <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format='ddd D MMM YYYY, HH:mm' style={{ width: '100%' }} disabledDate={noWeekendsOrPast} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={10}>
                    <Form.Item label='How' name='nextType' rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                      <Select options={TYPES.map(t => ({ value: t, label: t }))} />
                    </Form.Item>
                  </Col>
                </Row>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title='Reschedule the follow-up'
        open={Boolean(picking)}
        onCancel={() => setPicking(null)}
        okText='Reschedule'
        onOk={() => pickForm.submit()}
        destroyOnClose
        width={420}
      >
        <Form form={pickForm} layout='vertical' requiredMark={false} onFinish={values => picking && reschedule(picking, values.date.toDate())}>
          <Form.Item label='New date' name='date' rules={[{ required: true, message: 'Pick a date.' }]} style={{ marginBottom: 0 }}>
            <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format='ddd D MMM YYYY, HH:mm' style={{ width: '100%' }} disabledDate={noWeekendsOrPast} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title='Escalate to a department'
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
            extra='Its coordinators at this centre get it, and a notification. If it has none here, its coordinators at other centres do.'
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
          <Form.Item label='What do they need to do?' name='note' rules={[{ required: true, whitespace: true, message: 'Tell them what the SME needs.' }]} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default InquiryDetail
