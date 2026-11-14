import React, { useEffect, useState } from 'react'
import { Alert, Button, Empty, Modal, Segmented, Tag } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleFilled,
    CheckOutlined,
    CloseCircleFilled,
    FileDoneOutlined,
    HistoryOutlined,
    MailOutlined,
    RollbackOutlined,
    SendOutlined,
    SolutionOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { groupLabel, type GroupEligibility } from '@/services/groupLifecycleService'
import { complianceStatusLabel } from '@/services/complianceResolver'
import {
    MOVEMENT_META,
    complianceStatusColor,
    formatDateTime,
    groupColors,
    movementStateOf,
    type SmeGroupRow
} from './groupData'

type DetailTab = 'requirements' | 'interventions' | 'history'

type Props = {
    row: SmeGroupRow
    eligibility: GroupEligibility
    isROM: boolean
    isME: boolean
    busyKey: string | null
    onRequest: (row: SmeGroupRow) => Promise<void>
    onConfirm: (row: SmeGroupRow) => Promise<void>
    onReturn: (row: SmeGroupRow) => Promise<void>
    onRemind: (row: SmeGroupRow) => Promise<void>
}

/** "in-progress" / "COMPLETED" → "In progress" / "Completed". */
const statusText = (v?: string) => {
    const t = String(v || '').replace(/[-_]+/g, ' ').trim()
    return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'Not started'
}

const interventionColor = (v?: string) => {
    const s = String(v || '').toLowerCase()
    if (s.includes('complete') || s.includes('done')) return 'success'
    if (s.includes('progress') || s.includes('accepted')) return 'processing'
    if (s.includes('declin') || s.includes('reject') || s.includes('cancel')) return 'error'
    return 'default'
}

/**
 * The role's actions for one SME. ROM submits a ready SME to M&E (or reminds
 * one that still owes details); M&E confirms or returns a pending movement.
 */
const MovementActions: React.FC<Props> = ({
    row,
    eligibility,
    isROM,
    isME,
    busyKey,
    onRequest,
    onConfirm,
    onReturn,
    onRemind
}) => {
    const [modal, contextHolder] = Modal.useModal()
    const busy = !!busyKey
    const pending = row.pendingMovement
    const target = eligibility.target

    let actions: React.ReactNode = null
    if (isME && pending) {
        actions = (
            <>
                <Button
                    danger
                    icon={<RollbackOutlined />}
                    loading={busyKey === `return:${row.key}`}
                    disabled={busy}
                    onClick={() => modal.confirm({
                        title: 'Return this request to ROM?',
                        content: 'The SME stays in its current group and ROM can review and resubmit the movement.',
                        okText: 'Return to ROM',
                        okButtonProps: { danger: true },
                        onOk: () => onReturn(row)
                    })}
                >
                    Return
                </Button>
                <Button
                    type='primary'
                    icon={<CheckOutlined />}
                    loading={busyKey === `confirm:${row.key}`}
                    disabled={busy}
                    onClick={() => modal.confirm({
                        title: `Confirm movement to ${groupLabel(pending.to)}?`,
                        content: `ROM submitted this request on ${formatDateTime(pending.requestedAt)}. Confirmation changes the SME's group in both the application and participant record.`,
                        okText: 'Confirm movement',
                        onOk: () => onConfirm(row)
                    })}
                >
                    Confirm
                </Button>
            </>
        )
    } else if (isROM && !pending && target && eligibility.eligible) {
        actions = (
            <Button
                type='primary'
                icon={<SendOutlined />}
                loading={busyKey === `promote:${row.key}`}
                disabled={busy}
                onClick={() => modal.confirm({
                    title: `Submit ${row.name}'s movement to ${groupLabel(target)}?`,
                    content: 'ROM will submit this movement for M&E confirmation. The SME remains in the current group until M&E confirms it.',
                    okText: 'Submit to M&E',
                    onOk: () => onRequest(row)
                })}
            >
                Submit to M&E
            </Button>
        )
    } else if (isROM && !pending && target && eligibility.missing.length) {
        actions = (
            <Button
                icon={<MailOutlined />}
                loading={busyKey === `reminder:${row.key}`}
                disabled={busy || !row.email}
                title={row.email ? undefined : 'This SME has no email address'}
                onClick={() => onRemind(row)}
            >
                Remind SME
            </Button>
        )
    }

    return (
        <>
            {contextHolder}
            {actions && <div className='ws-detail-actions'>{actions}</div>}
        </>
    )
}

const RequirementsTab: React.FC<{ eligibility: GroupEligibility }> = ({ eligibility }) => {
    if (eligibility.requirements?.length) {
        // Outstanding first: that's what ROM chases.
        const items = [...eligibility.requirements].sort((a, b) => Number(a.met) - Number(b.met))
        return (
            <ul className='gpx-items'>
                {items.map(item => (
                    <li key={item.id} className={`gpx-item${item.met ? ' is-met' : ''}`}>
                        {item.met
                            ? <CheckCircleFilled className='gpx-item-icon is-met' />
                            : <CloseCircleFilled className='gpx-item-icon' />}
                        <div className='gpx-item-main'>
                            <div className='gpx-item-title'>{item.title}</div>
                            {item.reason && <div className='gpx-item-sub'>{item.reason}</div>}
                        </div>
                        <Tag color={complianceStatusColor(item.status)} bordered={false}>
                            {complianceStatusLabel(item.status)}
                        </Tag>
                    </li>
                ))}
            </ul>
        )
    }
    if (!eligibility.met.length && !eligibility.missing.length) {
        return <Empty description='Nothing is required for this group' />
    }
    return (
        <ul className='gpx-items'>
            {eligibility.missing.map(item => (
                <li key={`missing-${item}`} className='gpx-item'>
                    <CloseCircleFilled className='gpx-item-icon' />
                    <div className='gpx-item-main'>
                        <div className='gpx-item-title'>{item}</div>
                    </div>
                </li>
            ))}
            {eligibility.met.map(item => (
                <li key={`met-${item}`} className='gpx-item is-met'>
                    <CheckCircleFilled className='gpx-item-icon is-met' />
                    <div className='gpx-item-main'>
                        <div className='gpx-item-title'>{item}</div>
                    </div>
                </li>
            ))}
        </ul>
    )
}

const InterventionsTab: React.FC<{ row: SmeGroupRow }> = ({ row }) => {
    if (!row.interventions.length) return <Empty description='No interventions assigned yet' />
    return (
        <ul className='gpx-items'>
            {row.interventions.map(item => (
                <li key={item.id} className='gpx-item'>
                    <div className='gpx-item-main'>
                        <div className='gpx-item-title'>{item.title || 'Untitled intervention'}</div>
                        <div className='gpx-item-sub'>
                            {[item.departmentName, item.facilitatorName].filter(Boolean).join(' · ') || 'Not yet assigned'}
                        </div>
                    </div>
                    <Tag color={interventionColor(item.status)} bordered={false}>
                        {statusText(item.status)}
                    </Tag>
                </li>
            ))}
        </ul>
    )
}

const HistoryTab: React.FC<{ row: SmeGroupRow }> = ({ row }) => {
    if (!row.history.length) return <Empty description='No recorded group movements yet' />
    return (
        <ol className='gpx-timeline'>
            {[...row.history].reverse().map((entry, index) => (
                <li key={`${entry.date}-${index}`}>
                    <div className='gpx-item-title'>
                        {entry.from ? groupLabel(entry.from) : 'Joined'} <ArrowRightOutlined /> {groupLabel(entry.to)}
                    </div>
                    <div className='gpx-item-sub'>{formatDateTime(entry.date)} · {entry.by}</div>
                    {entry.reason && <p className='ws-prose'>{entry.reason}</p>}
                </li>
            ))}
        </ol>
    )
}

export const GroupDetail: React.FC<Props> = props => {
    const { row, eligibility } = props
    const [tab, setTab] = useState<DetailTab>('requirements')
    const reduceMotion = useReducedMotion()

    useEffect(() => setTab('requirements'), [row.key])

    const enter = (delay = 0) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 8 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.26, ease: 'easeOut' as const, delay }
            }

    const state = MOVEMENT_META[movementStateOf(row, eligibility)]
    const outstanding = eligibility.requirements
        ? eligibility.requirements.filter(item => !item.met).length
        : eligibility.missing.length
    const pending = row.pendingMovement

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${row.key}`} className='ws-detail-head' {...enter()}>
                    <EntityAvatar name={row.name} photo={row.photoUrl} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{row.name}</h2>
                        <div className='ws-detail-sub'>
                            {[
                                row.email || 'No email address',
                                `Last reminder ${row.lastReminderAt ? formatDateTime(row.lastReminderAt) : 'never'}`
                            ].join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={groupColors[row.group]}>{groupLabel(row.group)}</Tag>
                            <Tag color={state.color}>{state.label}</Tag>
                            {row.stage && <Tag>{row.stage}</Tag>}
                        </div>
                    </div>
                    <MovementActions {...props} />
                </motion.header>

                <motion.div key={`progress-${row.key}`} className='gpx-progress' {...enter(0.06)}>
                    <div className='gpx-progress-head'>
                        <span className='gpx-progress-path'>
                            {groupLabel(row.group)}
                            {eligibility.target && <> <ArrowRightOutlined /> {groupLabel(eligibility.target)}</>}
                        </span>
                        <span className='gpx-progress-value'>{eligibility.progress}%</span>
                    </div>
                    <div className={`gpx-bar is-large${eligibility.eligible || !eligibility.target ? ' is-done' : ''}`}>
                        <span style={{ width: `${eligibility.progress}%` }} />
                    </div>
                    <div className='gpx-item-sub'>
                        {eligibility.target ? eligibility.summary : 'Incubation complete'}
                    </div>
                </motion.div>

                {pending && (
                    <Alert
                        style={{ margin: '12px 20px 0' }}
                        type='info'
                        showIcon
                        message={`Awaiting M&E confirmation to ${groupLabel(pending.to)}`}
                        description={`Submitted by ${pending.requestedBy} on ${formatDateTime(pending.requestedAt)}.`}
                    />
                )}

                <div className='ws-detail-tabs'>
                    <Segmented
                        block
                        value={tab}
                        onChange={v => setTab(v as DetailTab)}
                        options={[
                            {
                                value: 'requirements',
                                label: `Requirements${outstanding ? ` (${outstanding})` : ''}`,
                                icon: <FileDoneOutlined />
                            },
                            {
                                value: 'interventions',
                                label: `Interventions${row.interventions.length ? ` (${row.interventions.length})` : ''}`,
                                icon: <SolutionOutlined />
                            },
                            { value: 'history', label: 'History', icon: <HistoryOutlined /> }
                        ]}
                    />
                    <div className='ws-detail-pane'>
                        <motion.div key={`${row.key}-${tab}`} className='ws-detail-body' {...enter(0.1)}>
                            {tab === 'requirements' && <RequirementsTab eligibility={eligibility} />}
                            {tab === 'interventions' && <InterventionsTab row={row} />}
                            {tab === 'history' && <HistoryTab row={row} />}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}
