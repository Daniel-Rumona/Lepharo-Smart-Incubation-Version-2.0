import React, { useEffect, useState } from 'react'
import { Avatar, Button, Tag, Tooltip, message } from 'antd'
import { BellOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'
import { millis, type TwinItem, type TwinRow } from '@/services/digitalTwin/processTwin'

const DAY_MS = 86400000
/** Attendance as a coloured pill with an icon, so the outcome reads at a glance. */
function AttendanceTag({ status }: { status: string }) {
    const key = status.toLowerCase().replace(/[\s-]+/g, '_')
    const look = key === 'attended' ? { color: 'success', icon: <CheckCircleOutlined /> }
        : key === 'expected' || key === 'pending' || key === 'invited' ? { color: 'processing', icon: <ClockCircleOutlined /> }
        : ['no_show', 'absent', 'missed', 'declined'].includes(key) ? { color: 'error', icon: <CloseCircleOutlined /> }
        : { color: 'default', icon: <MinusCircleOutlined /> }
    return <Tag className="iv-tag" color={look.color} icon={look.icon}>{pretty(status)}</Tag>
}
const initials = (name: string) => name.replace(/\[DEMO\]/g, '').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
const pretty = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bSme\b/g, 'SME')
const when = (value: any, withTime = false) => { const at = typeof value === "number" ? value : millis(value); return at === null ? 'Not recorded' : new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }) }

/** Where a reminder for this item is recorded and who it reaches; null when no one can be chased at this stage. */
type Target = { collection: 'assignedInterventions' | 'movDocuments' | 'consolidatedMOVs'; id: string; state?: string; audience: string; doc: Record<string, any> }
const ASSIGNMENT: Record<string, { state: string; audience: string }> = {
    'awaiting-participant-acceptance': { state: 'awaiting-acceptance', audience: 'SME' },
    'awaiting-participant-confirmation': { state: 'awaiting-confirmation', audience: 'SME' },
    'in-delivery': { state: 'in-delivery', audience: 'Facilitator' },
    'participant-declined': { state: 'declined', audience: 'Facilitator + HOD' },
    'participant-rejected': { state: 'rejected', audience: 'Facilitator + HOD' },
    'needs-reassignment': { state: 'needs-reassignment', audience: 'HOD' }
}
export function reminderTarget(item: TwinItem, pack?: Record<string, any>): Target | null {
    if (item.collection === 'assignedInterventions') { const a = ASSIGNMENT[item.stage]; return a ? { collection: 'assignedInterventions', id: item.id, ...a, doc: item.raw } : null }
    if (item.collection !== 'movDocuments') return null
    switch (item.stage) {
        case 'awaiting_smme': return { collection: 'movDocuments', id: item.id, audience: 'SME', doc: item.raw }
        case 'awaiting_hod': case 'hod_approved': return { collection: 'movDocuments', id: item.id, audience: 'HOD', doc: item.raw }
        case 'queried': case 'rejected': return { collection: 'movDocuments', id: item.id, audience: 'Facilitator + HOD', doc: item.raw }
        case 'in_pack': return pack?.id ? { collection: 'consolidatedMOVs', id: pack.id, audience: 'CC', doc: pack } : null
        case 'cc_confirmed': return pack?.id ? { collection: 'consolidatedMOVs', id: pack.id, audience: 'M&E', doc: pack } : null
        default: return null
    }
}

type DetailProps = {
    item: TwinItem; clock: number; assignment?: TwinRow; pack?: Record<string, any>
    appointments: TwinRow[]; visits: TwinRow[]; assessments: TwinRow[]; sessions: TwinRow[]
}

/** Compact record view: the facts in a grid, then one line per appointment and assessment. */
export function InterventionDetail({ item, clock, assignment, pack, appointments, visits, assessments, sessions }: DetailProps) {
    const waiting = item.owner !== 'None' && item.enteredAt !== null && item.enteredAt <= clock ? `${Math.floor((clock - item.enteredAt) / DAY_MS)} days` : null
    const facts: Array<[string, string]> = [
        ['Who needs to act', item.owner === 'None' ? 'No pending action' : item.owner],
        ...(waiting ? [['Waiting', waiting] as [string, string]] : []),
        ...(item.enteredAt !== null ? [['Stage started', when(item.enteredAt)] as [string, string]] : []),
        ...(assignment?.assigneeName ? [['Facilitator', String(assignment.assigneeName)] as [string, string]] : []),
        ...(assignment?.assignedAt ? [['Assigned', when(assignment.assignedAt)] as [string, string]] : []),
        ...(assignment?.cycleKey ? [['Delivery cycle', String(assignment.cycleKey)] as [string, string]] : [])
    ]
    const reports: Array<[string, string]> = [...(item.raw.answer ? [['Facilitator report', pretty(item.raw.answer)] as [string, string]] : []), ...(item.raw.smeAnswer ? [['SME report', pretty(item.raw.smeAnswer)] as [string, string]] : [])]
    return <div className="iv">
        <header className="iv-head">
            <Avatar size={40}>{initials(item.participant)}</Avatar>
            <div><h4>{item.participant}</h4><p>{item.title}</p></div>
            <Tag color="blue">{item.state}</Tag>
        </header>
        <dl className="iv-facts">{[...facts, ...reports].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {pack && <p className="iv-line"><b>Monthly evidence pack</b> {pack.month} · {pretty(pack.status || 'Status unavailable')}</p>}
        {appointments.length > 0 && <section>
            <h5>Appointments</h5>
            {appointments.map(a => {
                const session = sessions.find(s => s.id === a.appointmentSessionId)
                return <div key={a.id} className="iv-row">
                    <span><b>{session?.title || 'Session'}</b><small>{[session?.startAt ? when(session.startAt) : '', session?.deliveryMethod === 'in_person' ? 'In person' : session?.deliveryMethod ? pretty(session.deliveryMethod) : ''].filter(Boolean).join(' · ')}</small></span>
                    {a.attendance?.status && <AttendanceTag status={String(a.attendance.status)} />}
                </div>
            })}
        </section>}
        {assessments.length > 0 && <section>
            <h5>Outcome assessments</h5>
            {[...assessments].sort((x, y) => (millis(x.at) || 0) - (millis(y.at) || 0)).map(a => <div key={a.id} className="iv-row">
                <span><b>{pretty(a.byRole || 'Assessor')} · {pretty(a.assessment || 'Unknown')}</b><small>{[a.at ? when(a.at) : '', a.confidence ? pretty(a.confidence) : '', a.note || ''].filter(Boolean).join(' · ')}</small></span>
            </div>)}
        </section>}
    </div>
}

/** Modal footer: one button that chases whoever has to act next, through the function the Control Tower uses. One reminder per record per day. */
export function RemindFooter({ item, pack }: { item: TwinItem; pack?: Record<string, any> }) {
    const target = reminderTarget(item, pack)
    const [sending, setSending] = useState(false), [sent, setSent] = useState<string | null>(null)
    useEffect(() => { setSent(null) }, [item.key])
    if (!target) return <div className="iv-foot"><span className="iv-foot-text">There is no one to remind at this stage.</span></div>
    const last = millis(target.doc.lastManualReminder?.at), by = target.doc.lastManualReminder?.byName
    const remindedToday = !!sent || (last !== null && Date.now() - last < DAY_MS)
    const send = async () => {
        setSending(true)
        try {
            const result: any = await httpsCallable(functions, 'remindMovOwner')({ collection: target.collection, id: target.id, state: target.state })
            if (result.data?.suppressed) message.info(result.data.reason || 'Synthetic data does not send reminders.')
            else message.success(`Reminder sent to ${result.data?.audience || target.audience}.`)
            setSent(result.data?.audience || target.audience)
        } catch (error: any) { message.warning(error?.message || 'Could not send the reminder.') } finally { setSending(false) }
    }
    return <div className="iv-foot">
        <Tooltip title={remindedToday ? (last !== null ? `Last reminded ${when(last)}${by ? ` by ${by}` : ''}.` : `Sent to ${sent}.`) : `Emails the ${target.audience} and notifies them in the app. One reminder a day.`}>
            <span className="iv-foot-btn"><Button type="primary" block shape="round" icon={<BellOutlined />} loading={sending} disabled={remindedToday} onClick={send}>{remindedToday ? 'Reminded today' : `Remind ${target.audience}`}</Button></span>
        </Tooltip>
    </div>
}
