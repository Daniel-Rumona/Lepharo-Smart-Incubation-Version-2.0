import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Select, Skeleton, Space, Tag, Typography, theme } from 'antd'
import { LockOutlined, SearchOutlined, UsergroupAddOutlined } from '@ant-design/icons'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { changeSessionInvitees, type InvitationDraft } from '@/services/sessionInviteesService'
import { type Training, type TrainingEnrollment } from '@/components/trainings/trainingStorage'
import { inviteeKey, listTrainingAttendees, matchesTrainingCategory, trainingInvitees, type TrainingInvitee } from '@/components/trainings/attendeeStorage'
import { invitationFor, isTrainingInterventionId, saveTrainingPlan } from '@/components/trainings/trainingPlan'

const { Text } = Typography

/** Someone currently invited (an active invitation). */
export type InviteeMember = {
    id: string
    smeId: string
    attendeeId?: string | null
    name: string
    email?: string
    checkedIn: boolean
}

/** Someone who could be invited: a programme SME in the same group, or a training's attending person. */
export type InviteeCandidate = {
    key: string
    name: string
    detail?: string
    categories?: string[]
    draft: () => InvitationDraft
}

const memberKey = (m: InviteeMember) => inviteeKey(m.smeId, m.attendeeId)

/**
 * Change who's invited to a booked group session, before attendance is
 * recorded. A training session can switch category (inviting that category's
 * people instead) or add and remove people; a programme group session takes
 * the SMEs of its grouped intervention (programmeCandidates). Withdrawn
 * invitations are cancelled, not deleted, and everyone affected is emailed
 * by the usual appointment notifications.
 */
export function ChangeInviteesModal({
    open,
    sessionId,
    sessionTitle,
    interventionId,
    members,
    programmeCandidates = [],
    onClose,
    onSaved
}: {
    open: boolean
    sessionId: string
    sessionTitle: string
    interventionId: string
    members: InviteeMember[]
    programmeCandidates?: InviteeCandidate[]
    onClose: () => void
    onSaved: () => void
}) {
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const isTraining = isTrainingInterventionId(interventionId)
    const trainingId = isTraining ? interventionId.slice('training_'.length) : ''
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState('')
    const [saving, setSaving] = useState(false)
    const [training, setTraining] = useState<Training | null>(null)
    const [invitees, setInvitees] = useState<TrainingInvitee[]>([])
    const [category, setCategory] = useState<string | null>(null)
    const [originalCategory, setOriginalCategory] = useState<string | null>(null)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState('')

    const lockedKeys = useMemo(() => new Set(members.filter(m => m.checkedIn).map(memberKey)), [members])

    useEffect(() => {
        if (!open) return
        setSelected(new Set(members.map(memberKey)))
        setSearch('')
        setLoadError('')
        if (!isTraining) return
        let cancelled = false
        setLoading(true)
        Promise.all([
            getDoc(doc(db, 'trainings', trainingId)),
            getDocs(query(collection(db, 'trainingEnrollments'), where('trainingId', '==', trainingId))),
            listTrainingAttendees(trainingId),
            getDoc(doc(db, 'appointmentSessions', sessionId))
        ])
            .then(([trainingSnap, enrollmentSnap, attendees, sessionSnap]) => {
                if (cancelled) return
                const t = trainingSnap.exists() ? ({ ...(trainingSnap.data() as Omit<Training, 'id'>), id: trainingSnap.id } as Training) : null
                const smes = enrollmentSnap.docs.map(d => ({ ...(d.data() as Omit<TrainingEnrollment, 'id'>), id: d.id }))
                setTraining(t)
                setInvitees(trainingInvitees(smes, attendees, null))
                const current = (sessionSnap.data()?.category as string | null) ||
                    t?.plan?.find(p => p.appointmentSessionId === sessionId)?.category || null
                setCategory(current)
                setOriginalCategory(current)
            })
            .catch(e => !cancelled && setLoadError(e instanceof Error ? e.message : 'Could not load who can be invited.'))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sessionId])

    // The plan session the training invitations are built from.
    const planSession = training?.plan?.find(p => p.appointmentSessionId === sessionId)

    const candidates: InviteeCandidate[] = useMemo(() => {
        if (!isTraining) return programmeCandidates
        if (!training || !planSession) return []
        return invitees.filter(invitee => matchesTrainingCategory(invitee.attendee?.categories || invitee.enrollment.categories, category)).map(invitee => ({
            key: inviteeKey(invitee.enrollment.id, invitee.attendee?.id),
            name: invitee.attendee ? invitee.attendee.name : invitee.enrollment.name,
            detail: invitee.enrollment.companyName || (invitee.attendee ? invitee.enrollment.name : ''),
            categories: invitee.attendee ? invitee.attendee.categories : invitee.enrollment.categories,
            draft: () => invitationFor(invitee, training, planSession, { departmentId: '', role: '' })
        }))
    }, [isTraining, programmeCandidates, training, planSession, invitees, category])

    // Everyone to list: who could be invited, plus anyone invited who no longer could be.
    const rows = useMemo(() => {
        const byKey = new Map<string, { key: string; name: string; detail?: string; categories?: string[] }>()
        candidates.forEach(c => byKey.set(c.key, c))
        members.forEach(m => {
            if (!byKey.has(memberKey(m)) && (!isTraining || selected.has(memberKey(m)) || lockedKeys.has(memberKey(m)))) {
                byKey.set(memberKey(m), { key: memberKey(m), name: m.name, detail: isTraining
                    ? lockedKeys.has(memberKey(m)) ? "Already checked in — invitation retained" : "Not eligible for this selection — untick to withdraw"
                    : m.email })
            }
        })
        const term = search.trim().toLowerCase()
        return Array.from(byKey.values())
            .filter(r => !term || `${r.name} ${r.detail || ''}`.toLowerCase().includes(term))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [candidates, members, search, isTraining, selected, lockedKeys])

    const pickCategory = (next: string | null) => {
        setCategory(next)
        // The category's people, plus anyone already checked in (who can't be withdrawn).
        // Same test trainingInvitees applies: a person's categories, or the SME's when its people aren't on record.
        const inCategory = (i: TrainingInvitee) =>
            matchesTrainingCategory(i.attendee ? i.attendee.categories : i.enrollment.categories, next)
        const keys = new Set(invitees.filter(inCategory).map(i => inviteeKey(i.enrollment.id, i.attendee?.id)))
        lockedKeys.forEach(key => keys.add(key))
        setSelected(keys)
    }

    const currentKeys = useMemo(() => new Set(members.map(memberKey)), [members])
    const toAdd = candidates.filter(c => selected.has(c.key) && !currentKeys.has(c.key))
    const toWithdraw = members.filter(m => !selected.has(memberKey(m)) && !m.checkedIn)
    const categoryChanged = isTraining && category !== originalCategory
    const hasChanges = toAdd.length > 0 || toWithdraw.length > 0 || categoryChanged
    // A session with no one invited is a cancelled session; that's what Cancel is for.
    const leavesNobody = members.length - toWithdraw.length + toAdd.length <= 0

    const toggle = (key: string, checked: boolean) =>
        setSelected(prev => {
            const next = new Set(prev)
            if (checked) next.add(key)
            else next.delete(key)
            return next
        })

    const save = async () => {
        setSaving(true)
        try {
            const result = await changeSessionInvitees({
                sessionId,
                add: toAdd.map(c => c.draft()),
                withdraw: toWithdraw.map(m => m.id),
                ...(categoryChanged ? { sessionPatch: { category } } : {})
            })
            // The training's own record of the session keeps the same category.
            if (categoryChanged && training?.plan?.length) {
                const fresh = await getDoc(doc(db, 'trainings', training.id))
                const plan = ((fresh.data()?.plan || []) as NonNullable<Training['plan']>).map(p =>
                    p.appointmentSessionId === sessionId ? { ...p, category } : p
                )
                await saveTrainingPlan(training.id, plan)
            }
            const parts = [
                result.added ? `${result.added} invited` : '',
                result.withdrawn ? `${result.withdrawn} withdrawn` : ''
            ].filter(Boolean)
            message.success(parts.length ? `${parts.join(', ')}. They're emailed about the change.` : 'Saved.')
            if (result.keptCheckedIn) message.info(`${result.keptCheckedIn} already checked in, so they stay invited.`)
            onSaved()
        } catch (e) {
            message.error(e instanceof Error ? e.message : 'Could not change who is invited.')
        } finally {
            setSaving(false)
        }
    }

    // Existing invitees outside this selection belong in the withdrawal count,
    // not the pool of people available to invite.
    const totalCandidates = new Set(candidates.map(candidate => candidate.key)).size
    const invitedCount = members.length - toWithdraw.length + toAdd.length
    const allVisibleSelected = rows.length > 0 && rows.every(row => selected.has(row.key))
    const availableVisibleKeys = rows.filter(row => !lockedKeys.has(row.key)).map(row => row.key)

    const toggleVisible = () => {
        setSelected(previous => {
            const next = new Set(previous)
            availableVisibleKeys.forEach(key => {
                if (allVisibleSelected) next.delete(key)
                else next.add(key)
            })
            lockedKeys.forEach(key => next.add(key))
            return next
        })
    }

    return (
        <Modal
            wrapClassName='mobile-sheet'
            centered
            open={open}
            onCancel={onClose}
            destroyOnClose
            width={580}
            title={
                <Space size={8} style={{ maxWidth: '100%' }}>
                    <UsergroupAddOutlined style={{ color: token.colorPrimary }} />
                    <Text strong>Manage invitees</Text>
                </Space>
            }
            styles={{ body: { paddingTop: 8 } }}
            footer={
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button shape='round' onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        type='primary'
                        shape='round'
                        disabled={!hasChanges || leavesNobody || loading || !!loadError}
                        loading={saving}
                        onClick={() => void save()}
                    >
                        Save changes
                    </Button>
                </div>
            }
        >
            {loadError ? <Alert type='error' showIcon message={loadError} /> : loading ? (
                <Skeleton active paragraph={{ rows: 5 }} />
            ) : isTraining && training && !planSession ? (
                <Alert type='warning' showIcon message="This session isn't in the training plan." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Text
                        type='secondary'
                        ellipsis={{ tooltip: sessionTitle }}
                        style={{ display: 'block', fontSize: 12 }}
                    >
                        {sessionTitle}
                    </Text>

                    <div
                        style={{
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                        }}
                    >
                        <Space size={6} wrap>
                            <Tag color='blue' bordered={false} style={{ marginInlineEnd: 0 }}>
                                {invitedCount} invited
                            </Tag>
                            <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
                                {totalCandidates} available
                            </Tag>
                            {lockedKeys.size > 0 && (
                                <Tag color='green' bordered={false} style={{ marginInlineEnd: 0 }}>
                                    {lockedKeys.size} checked in
                                </Tag>
                            )}
                        </Space>
                        <Button type='link' size='small' onClick={toggleVisible} disabled={!availableVisibleKeys.length} style={{ paddingInline: 0 }}>
                            {allVisibleSelected ? 'Clear visible' : 'Select visible'}
                        </Button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: isTraining && !!training?.categories?.length ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr', gap: 8 }}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder='Search people or SMEs'
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                        />
                        {isTraining && !!training?.categories?.length && (
                            <Select
                                allowClear
                                placeholder='All categories'
                                value={category || undefined}
                                onChange={value => pickCategory(value || null)}
                                options={training.categories.map(value => ({ value, label: value }))}
                                style={{ width: '100%', minWidth: 0 }}
                            />
                        )}
                    </div>

                    <div
                        style={{
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: token.borderRadiusLG,
                            overflow: 'hidden'
                        }}
                    >
                        <div
                            style={{
                                maxHeight: 280,
                                minHeight: rows.length ? 50 : undefined,
                                overflowY: 'auto',
                                overscrollBehavior: 'contain'
                            }}
                        >
                            {rows.length ? rows.map((row, index) => {
                                const locked = lockedKeys.has(row.key)
                                const checked = selected.has(row.key)
                                return (
                                    <label
                                        key={row.key}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10,
                                            minHeight: 49,
                                            padding: '7px 12px',
                                            cursor: locked ? 'not-allowed' : 'pointer',
                                            borderBottom: index === rows.length - 1 ? undefined : `1px solid ${token.colorSplit}`,
                                            background: checked ? token.colorPrimaryBg : token.colorBgContainer
                                        }}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            disabled={locked}
                                            onChange={event => toggle(row.key, event.target.checked)}
                                        />
                                        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                            <Text strong ellipsis style={{ fontSize: 13, lineHeight: '18px' }}>
                                                {row.name}
                                            </Text>
                                            {row.detail && (
                                                <Text type='secondary' ellipsis style={{ fontSize: 11, lineHeight: '15px' }}>
                                                    {row.detail}
                                                </Text>
                                            )}
                                        </div>
                                        {locked && <LockOutlined title='Already checked in' style={{ color: token.colorSuccess }} />}
                                    </label>
                                )
                            }) : (
                                <div style={{ padding: 18 }}>
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No matching people' />
                                </div>
                            )}
                        </div>
                    </div>

                    {leavesNobody ? (
                        <Text type='danger' style={{ fontSize: 12 }}>
                            At least one invitee is required. Cancel the session to remove everyone.
                        </Text>
                    ) : hasChanges ? (
                        <Space size={6} wrap>
                            {toAdd.length > 0 && <Tag color='green' bordered={false}>+{toAdd.length} to invite</Tag>}
                            {toWithdraw.length > 0 && <Tag color='red' bordered={false}>-{toWithdraw.length} to withdraw</Tag>}
                            {categoryChanged && <Tag color='blue' bordered={false}>Category updated</Tag>}
                            <Text type='secondary' style={{ fontSize: 11 }}>Affected invitees will be notified.</Text>
                        </Space>
                    ) : (
                        <Text type='secondary' style={{ fontSize: 11 }}>
                            Checked-in people cannot be removed.
                        </Text>
                    )}
                </div>
            )}
        </Modal>
    )
}
