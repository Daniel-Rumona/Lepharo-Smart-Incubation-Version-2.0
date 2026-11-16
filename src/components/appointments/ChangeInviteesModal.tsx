import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { changeSessionInvitees, type InvitationDraft } from '@/services/sessionInviteesService'
import { type Training, type TrainingEnrollment } from '@/components/trainings/trainingStorage'
import { inviteeKey, listTrainingAttendees, trainingInvitees, type TrainingInvitee } from '@/components/trainings/attendeeStorage'
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
    const isTraining = isTrainingInterventionId(interventionId)
    const trainingId = isTraining ? interventionId.slice('training_'.length) : ''
    const [loading, setLoading] = useState(false)
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
        if (!isTraining) return
        let cancelled = false
        setLoading(true)
        Promise.all([
            getDoc(doc(db, 'trainings', trainingId)),
            getDocs(query(collection(db, 'trainingEnrollments'), where('trainingId', '==', trainingId))),
            listTrainingAttendees(trainingId).catch(() => []),
            getDoc(doc(db, 'appointmentSessions', sessionId))
        ])
            .then(([trainingSnap, enrollmentSnap, attendees, sessionSnap]) => {
                if (cancelled) return
                const t = trainingSnap.exists() ? ({ ...(trainingSnap.data() as Omit<Training, 'id'>), id: trainingSnap.id } as Training) : null
                const smes = enrollmentSnap.docs.map(d => ({ ...(d.data() as Omit<TrainingEnrollment, 'id'>), id: d.id }))
                setTraining(t)
                setInvitees(trainingInvitees(smes, attendees, null))
                const current = (sessionSnap.data()?.category as string | null) || null
                setCategory(current)
                setOriginalCategory(current)
            })
            .catch(e => !cancelled && message.error(e instanceof Error ? e.message : 'Could not load who can be invited.'))
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
        return invitees.map(invitee => ({
            key: inviteeKey(invitee.enrollment.id, invitee.attendee?.id),
            name: invitee.attendee ? invitee.attendee.name : invitee.enrollment.name,
            detail: invitee.enrollment.companyName || (invitee.attendee ? invitee.enrollment.name : ''),
            categories: invitee.attendee ? invitee.attendee.categories : invitee.enrollment.categories,
            draft: () => invitationFor(invitee, training, planSession, { departmentId: '', role: '' })
        }))
    }, [isTraining, programmeCandidates, training, planSession, invitees])

    // Everyone to list: who could be invited, plus anyone invited who no longer could be.
    const rows = useMemo(() => {
        const byKey = new Map<string, { key: string; name: string; detail?: string; categories?: string[] }>()
        candidates.forEach(c => byKey.set(c.key, c))
        members.forEach(m => {
            if (!byKey.has(memberKey(m))) byKey.set(memberKey(m), { key: memberKey(m), name: m.name, detail: m.email })
        })
        const term = search.trim().toLowerCase()
        return Array.from(byKey.values())
            .filter(r => !term || `${r.name} ${r.detail || ''}`.toLowerCase().includes(term))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [candidates, members, search])

    const pickCategory = (next: string | null) => {
        setCategory(next)
        // The category's people, plus anyone already checked in (who can't be withdrawn).
        // Same test trainingInvitees applies: a person's categories, or the SME's when its people aren't on record.
        const inCategory = (i: TrainingInvitee) =>
            !next || (i.attendee ? i.attendee.categories.includes(next) : !!i.enrollment.categories?.includes(next))
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

    const nameOf = (key: string) => rows.find(r => r.key === key)?.name || candidates.find(c => c.key === key)?.name || key

    return (
        <Modal
            wrapClassName='mobile-sheet'
            centered
            title={`Change who's invited · ${sessionTitle}`}
            open={open}
            onCancel={onClose}
            destroyOnClose
            width={640}
            footer={
                <Button type='primary' block size='large' disabled={!hasChanges || leavesNobody || loading} loading={saving} onClick={() => void save()}>
                    Save changes
                </Button>
            }
        >
            {loading ? (
                <Skeleton active />
            ) : isTraining && training && !planSession ? (
                <Alert type='warning' showIcon message="This session isn't in the training's plan, so people can't be added to it here." />
            ) : (
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    <Text type='secondary'>
                        Tick who should be invited. Anyone unticked is withdrawn and told it's cancelled for them; anyone added gets the
                        invitation. People who have checked in stay invited.
                    </Text>

                    {isTraining && !!training?.categories?.length && (
                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 6 }}>
                                For category
                            </Text>
                            <Select
                                allowClear
                                placeholder='Everyone attending'
                                value={category || undefined}
                                onChange={value => pickCategory(value || null)}
                                options={training.categories.map(c => ({ value: c, label: c }))}
                                style={{ width: '100%' }}
                            />
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Picking a category invites its people instead; adjust individuals below.
                            </Text>
                        </div>
                    )}

                    {rows.length > 8 && (
                        <Input allowClear prefix={<SearchOutlined />} placeholder='Search' value={search} onChange={e => setSearch(e.target.value)} />
                    )}

                    {rows.length ? (
                        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {rows.map(row => {
                                const locked = lockedKeys.has(row.key)
                                return (
                                    <Checkbox
                                        key={row.key}
                                        checked={selected.has(row.key)}
                                        disabled={locked}
                                        onChange={e => toggle(row.key, e.target.checked)}
                                    >
                                        <Space size={6} wrap>
                                            <Text strong>{row.name}</Text>
                                            {row.detail && <Text type='secondary'>{row.detail}</Text>}
                                            {(row.categories || []).map(c => (
                                                <Tag key={c} style={{ marginInlineEnd: 0 }}>
                                                    {c}
                                                </Tag>
                                            ))}
                                            {locked && <Tag color='green'>Checked in</Tag>}
                                        </Space>
                                    </Checkbox>
                                )
                            })}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No one else can be invited to this session.' />
                    )}

                    {leavesNobody && (
                        <Alert type='warning' showIcon message='Keep at least one person invited. To call the session off, cancel it instead.' />
                    )}

                    {hasChanges && !leavesNobody && (
                        <Alert
                            type='info'
                            showIcon
                            message='When you save'
                            description={
                                <Space direction='vertical' size={2}>
                                    {toAdd.length > 0 && <Text>Invite: {toAdd.map(c => c.name).join(', ')}</Text>}
                                    {toWithdraw.length > 0 && <Text>Withdraw: {toWithdraw.map(m => nameOf(memberKey(m))).join(', ')}</Text>}
                                    {categoryChanged && <Text>Category: {category || 'Everyone attending'}</Text>}
                                </Space>
                            }
                        />
                    )}
                </Space>
            )}
        </Modal>
    )
}
