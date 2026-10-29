import React from 'react'
import { Button, Empty } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useDepartmentRoles } from '@/services/departmentRoles'
import './choice-cards.css'

dayjs.extend(relativeTime)

const TYPE_LABELS: Record<string, string> = {
    'poe-request': 'Evidence (POE)',
    'mov-request': 'MOV request',
    'mov-issue': 'Session details',
    'general-query': 'Question',
    'completion-rejected': 'Delivery dispute',
    'completion-rejection': 'Delivery dispute',
    'cc-poe-query': 'Evidence (POE)',
    'cc-pack-query': 'Pack query',
    'me-query': 'MOV query'
}

const ROLE_LABELS: Record<string, string> = {
    incubatee: 'SME',
    beneficiary: 'SME',
    operations: 'HOD',
    projectadmin: 'Center Coordinator',
    coordinator: 'Facilitator',
    director: 'Director'
}

const clean = (v: unknown) => String(v ?? '').trim()

/** Who raised it: their name and what they are (an operations user in M&E is M&E, not a HOD). */
const raiserOf = (q: any, isMonitoringDepartment: (departmentId?: string | null) => boolean) => {
    const role = clean(q.raisedByRole || q.raisedBy?.role).toLowerCase()
    const dept = clean(q.raisedByDept || q.raisedBy?.departmentName)
    const label = role === 'operations' && isMonitoringDepartment(q.raisedBy?.departmentId) ? 'M&E' : ROLE_LABELS[role] || dept || ''
    const name = clean(q.raisedByName || q.raisedBy?.name) || (label === 'SME' ? clean(q.beneficiaryName) : '') || label || 'Someone'
    return { name, label: label && label !== name ? label : '' }
}

const toDate = (v: any): Date | null => {
    const d = v?.toDate ? v.toDate() : typeof v?.seconds === 'number' ? new Date(v.seconds * 1000) : v ? new Date(v) : null
    return d && !isNaN(+d) ? d : null
}

/**
 * Queries waiting for your answer, as a short inbox: who asked, what about,
 * when, and one button. Oldest first, so nothing waits longest unseen.
 */
export const QueryInbox: React.FC<{
    queries: any[]
    onAnswer: (query: any) => void
    emptyText?: string
}> = ({ queries, onAnswer, emptyText = 'Nothing waiting for your answer.' }) => {
    const { hasRole } = useDepartmentRoles()
    if (!queries.length) return <Empty description={emptyText} />
    const sorted = [...queries].sort((a, b) => (toDate(a.raisedAt || a.createdAt)?.getTime() || 0) - (toDate(b.raisedAt || b.createdAt)?.getTime() || 0))
    return (
        <ul className='qi-list'>
            {sorted.map(q => {
                const who = raiserOf(q, id => hasRole(id, 'monitoring'))
                const when = toDate(q.raisedAt || q.createdAt)
                const type = clean(q.queryType || q.type)
                const dispute = type.startsWith('completion-reject')
                const sentBack = Number(q.sentBackCount || 0) > 0 || !!clean(q.sentBackNotes)
                const about = [q.beneficiaryName, q.subInterventionTitle || q.interventionTitle].map(clean).filter(Boolean).join(' · ')
                return (
                    <li key={q.id} className='qi-item'>
                        <div className='qi-head'>
                            <span className='qi-who'>{who.name}</span>
                            {who.label && <span className='qi-role'>{who.label}</span>}
                            <span className={`qi-type${dispute ? ' is-dispute' : ''}`}>{TYPE_LABELS[type] || 'Query'}</span>
                            {sentBack && <span className='qi-type is-back'>Sent back</span>}
                            {when && <span className='qi-when' title={dayjs(when).format('D MMM YYYY, HH:mm')}>{dayjs(when).fromNow()}</span>}
                        </div>
                        <p className='qi-text'>{clean(q.sentBackNotes) ? `Still needed: ${clean(q.sentBackNotes)}` : clean(q.queryMessage || q.message) || '—'}</p>
                        <div className='qi-foot'>
                            <span className='qi-about'>{about || '—'}</span>
                            <Button size='small' type='primary' icon={<SendOutlined />} onClick={() => onAnswer(q)}>
                                {dispute ? 'Respond' : 'Answer'}
                            </Button>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}
