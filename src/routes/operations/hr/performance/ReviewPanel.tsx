import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Modal, Select, Space, Tag, Tooltip, Typography, message, theme } from 'antd'
import { CheckCircleFilled, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { EditableRows } from './EditableRows'
import { clean, signatureFor } from './signature'
import {
    RATING_SCALE,
    REVIEW_STAGES,
    phaseScore,
    ratingColor,
    ratingGaps,
    ratingLabel,
    reviewDocId,
    reviewStage,
    type CompactItem,
    type ItemRating,
    type PerformanceCycle,
    type PhaseKey,
    type PhaseReview,
    type ReviewRecord,
    type ScoreResult,
    type SelfRating
} from './ipm'
import type { CompactEmployee, CompactMode } from './CompactDrawer'

const { Text, Paragraph } = Typography

const ratingOptions = RATING_SCALE.map(r => ({ value: r.value, label: `${r.value} · ${r.label}` }))

const stageIndex = (stage: ReturnType<typeof reviewStage>) => {
    if (stage === 'disputed') return 2
    if (stage === 'validated') return REVIEW_STAGES.length
    return REVIEW_STAGES.findIndex(s => s.key === stage)
}

/**
 * One review phase (mid-year or year-end), following the toolkit's workflow:
 * the employee self-assesses, the line manager assesses against the compact,
 * gaps are discussed, both sign or the employee disputes and HR mediates, then
 * HR calibrates and the CEO validates (those two happen in the Calibration view).
 */
export const ReviewPanel: React.FC<{
    phase: PhaseKey
    phaseLabel: string
    mode: CompactMode
    items: CompactItem[]
    sectionLabel: (item: CompactItem) => string
    review: PhaseReview
    result: ScoreResult
    weightsValid: boolean
    record: ReviewRecord | null
    employee: CompactEmployee | null
    lineManagerName?: string
    cycle: PerformanceCycle | null
    user: { id: string; name: string; role: string }
    isLineManager: boolean
    isOverseer: boolean
    onRating: (itemId: string, patch: Partial<ItemRating>) => void
    onOverall: (patch: { overallManagerComment?: string }) => void
    /** Saves the compact (with the manager's ratings); resolves to whether it saved. */
    saveCompact: () => Promise<boolean>
    onChanged: () => void
}> = ({
    phase,
    phaseLabel,
    mode,
    items,
    sectionLabel,
    review,
    result,
    weightsValid,
    record,
    employee,
    lineManagerName,
    cycle,
    user,
    isLineManager,
    isOverseer,
    onRating,
    onOverall,
    saveCompact,
    onChanged
}) => {
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [self, setSelf] = useState<Record<string, SelfRating>>({})
    const [overallSelf, setOverallSelf] = useState('')
    const [busy, setBusy] = useState(false)
    const [disputeOpen, setDisputeOpen] = useState(false)
    const [disputeReason, setDisputeReason] = useState('')
    const [resolution, setResolution] = useState('')

    const stage = reviewStage(record)
    const isSelf = mode === 'self'
    const isManage = mode === 'manage'
    const managerSubmitted = !!record?.managerSubmittedAt

    // Self-assessment: the employee's own record; ratings captured on the compact before
    // self-assessment existed still show until the employee records their own.
    useEffect(() => {
        const fromRecord = record?.self || {}
        const merged: Record<string, SelfRating> = {}
        for (const item of items) {
            merged[item.id] = fromRecord[item.id] || {
                rating: review.ratings[item.id]?.self ?? null,
                comment: review.ratings[item.id]?.selfComment || ''
            }
        }
        setSelf(merged)
        setOverallSelf(record?.overallSelfComment ?? review.overallSelfComment ?? '')
        setResolution(record?.dispute?.resolution || '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [record, items.length, phase])

    const canEditSelf = isSelf && !managerSubmitted && !record?.validation
    const canEditManager = isManage && (!managerSubmitted || (stage === 'disputed' && isOverseer))
    const gaps = useMemo(() => ratingGaps(items, self, review.ratings), [items, self, review.ratings])
    const calibrated = phaseScore(result.score, record)

    const employeeUid = employee ? employee.authUid || employee.id : ''
    const ref = cycle && employeeUid ? doc(db, 'performanceReviews', reviewDocId(cycle.id, employeeUid, phase)) : null

    /** Merge into the review record, creating it with its identifying fields the first time. */
    const writeReview = async (patch: Record<string, unknown>, success: string) => {
        if (!ref || !employee || !cycle) return false
        setBusy(true)
        try {
            const base = record
                ? {}
                : {
                      employeeAuthUid: employeeUid,
                      employeeId: employee.id,
                      employeeName: employee.name || '',
                      lineManagerId: employee.lineManagerId || null,
                      cycleId: cycle.id,
                      phase,
                      createdAt: serverTimestamp()
                  }
            await setDoc(ref, { ...base, ...clean(patch), updatedAt: serverTimestamp() }, { merge: true })
            message.success(success)
            onChanged()
            return true
        } catch (error) {
            console.error(error)
            message.error('Could not save the review.')
            return false
        } finally {
            setBusy(false)
        }
    }

    const saveSelf = (submit: boolean) => {
        const unrated = items.filter(item => !self[item.id]?.rating)
        if (submit && unrated.length) {
            message.warning(`Rate every item before submitting (${unrated.length} left).`)
            return
        }
        const go = () =>
            writeReview(
                { self, overallSelfComment: overallSelf, ...(submit ? { selfSubmittedAt: new Date().toISOString() } : {}) },
                submit ? 'Self-assessment submitted to your line manager.' : 'Self-assessment saved.'
            )
        if (submit) {
            Modal.confirm({
                title: 'Submit your self-assessment?',
                content: 'Your line manager uses it for their assessment. You can still change it until they submit theirs.',
                okText: 'Submit',
                onOk: go
            })
        } else go()
    }

    const submitAssessment = () => {
        if (!weightsValid) {
            message.warning('Fix the compact weights first.')
            return
        }
        const missing = items.filter(item => !review.ratings[item.id]?.final)
        if (missing.length) {
            message.warning(`Give every item a final rating (${missing.length} left).`)
            return
        }
        Modal.confirm({
            title: `Submit the ${phaseLabel.toLowerCase()}?`,
            content: record?.selfSubmittedAt
                ? 'The employee then sees your ratings and the gaps against their self-assessment, and signs or raises a dispute.'
                : 'The employee has not submitted a self-assessment. Submitting closes it; consider waiting for theirs first.',
            okText: 'Submit assessment',
            onOk: async () => {
                if (await saveCompact()) {
                    await writeReview({ managerSubmittedAt: new Date().toISOString() }, 'Assessment submitted.')
                }
            }
        })
    }

    const reopen = () =>
        Modal.confirm({
            title: 'Reopen the assessment?',
            content: 'You can change ratings again. Any review signatures are withdrawn and both of you sign again.',
            okText: 'Reopen',
            onOk: async () => {
                if (!ref) return
                setBusy(true)
                try {
                    await updateDoc(ref, { managerSubmittedAt: null, signoff: {}, updatedAt: serverTimestamp() })
                    message.success('Assessment reopened.')
                    onChanged()
                } catch (error) {
                    console.error(error)
                    message.error('Could not reopen the assessment.')
                } finally {
                    setBusy(false)
                }
            }
        })

    const sign = async (role: 'manager' | 'employee') =>
        writeReview({ signoff: { [role]: await signatureFor(user) } }, 'Review signed.')

    const confirmSign = (role: 'manager' | 'employee') =>
        Modal.confirm({
            title: 'Sign this review?',
            content:
                role === 'employee'
                    ? 'You confirm the review was discussed with you. If you disagree with the ratings, raise a dispute instead.'
                    : 'You confirm the review was discussed with the employee.',
            okText: 'Sign',
            onOk: () => sign(role)
        })

    const raiseDispute = async () => {
        if (!disputeReason.trim()) {
            message.warning('Explain what you disagree with.')
            return
        }
        const ok = await writeReview(
            { dispute: { raisedBy: user.id, raisedAt: new Date().toISOString(), reason: disputeReason.trim() } },
            'Dispute raised. HR will mediate between you and your line manager.'
        )
        if (ok) setDisputeOpen(false)
    }

    const resolveDispute = () => {
        if (!resolution.trim() || !record?.dispute) {
            message.warning('Record how the dispute was resolved.')
            return
        }
        Modal.confirm({
            title: 'Resolve the dispute?',
            content: 'Adjust any ratings first and save the compact. Both parties then sign the review.',
            okText: 'Resolve',
            onOk: () =>
                writeReview(
                    { dispute: { ...record.dispute, resolution: resolution.trim(), resolvedBy: user.id, resolvedAt: new Date().toISOString() } },
                    'Dispute resolved.'
                )
        })
    }

    const shown = result.score ?? result.partial
    const hideScore = isSelf && !managerSubmitted
    const stepNumber = Math.min(stageIndex(stage) + 1, REVIEW_STAGES.length)
    const employeeName = isSelf ? 'you' : employee?.name || 'the employee'
    const managerName = isLineManager ? 'you' : lineManagerName || 'the line manager'
    const unsigned = [
        !record?.signoff?.manager ? managerName : '',
        !record?.signoff?.employee ? employeeName : ''
    ].filter(Boolean)
    const waitingOn: Record<typeof stage, string> = {
        self: `Waiting on ${employeeName}`,
        manager: `Waiting on ${managerName}`,
        discussion: unsigned.length ? `Waiting on ${unsigned.join(' and ')} to sign` : 'Signed',
        disputed: 'Disputed · HR is mediating',
        calibration: 'Signed · with HR for calibration',
        validation: 'Calibrated · awaiting the CEO',
        validated: `Final · validated by ${record?.validation?.byName || 'the CEO'}`
    }
    const stageTitle = stage === 'disputed' ? 'Discuss and sign' : stage === 'validated' ? 'Complete' : REVIEW_STAGES[stageIndex(stage)]?.label

    const statusBar = (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                padding: '12px 16px',
                borderRadius: 12,
                background: stage === 'disputed' ? token.colorErrorBg : token.colorFillQuaternary
            }}
        >
            <div>
                <Text type='secondary' style={{ fontSize: 12, display: 'block' }}>
                    {stage === 'validated' ? phaseLabel : `${phaseLabel} · step ${stepNumber} of ${REVIEW_STAGES.length}`}
                </Text>
                <Text strong>
                    {stageTitle} · {waitingOn[stage]}
                </Text>
                {stage === 'discussion' && gaps.length ? (
                    <Text type='secondary' style={{ fontSize: 12, display: 'block' }}>
                        {gaps.length} goal{gaps.length === 1 ? '' : 's'} where the self and final ratings differ: discuss these first.
                    </Text>
                ) : null}
            </div>
            <Space size={16} wrap>
                <Space size={10}>
                    {(['manager', 'employee'] as const).map(role => {
                        const signature = record?.signoff?.[role]
                        return (
                            <Tooltip key={role} title={signature ? `${signature.name}, ${dayjs(signature.at).format('D MMM YYYY')}` : 'Not signed yet'}>
                                <Space size={4}>
                                    {signature ? (
                                        <CheckCircleFilled style={{ color: token.colorSuccess }} />
                                    ) : (
                                        <ClockCircleOutlined style={{ color: token.colorTextQuaternary }} />
                                    )}
                                    <Text type={signature ? undefined : 'secondary'} style={{ fontSize: 12 }}>
                                        {role === 'manager' ? 'Manager' : 'Employee'}
                                    </Text>
                                </Space>
                            </Tooltip>
                        )
                    })}
                </Space>
                {hideScore || shown === null ? (
                    <Tag style={{ borderRadius: 999, margin: 0 }}>Not rated yet</Tag>
                ) : record?.calibration && calibrated !== null ? (
                    <Tooltip title={`Before calibration: ${shown.toFixed(2)}`}>
                        <Tag color={ratingColor(calibrated)} style={{ borderRadius: 999, margin: 0, fontSize: 13 }}>
                            {calibrated.toFixed(2)} · {ratingLabel(calibrated)} (calibrated)
                        </Tag>
                    </Tooltip>
                ) : (
                    <Tooltip title={result.score === null ? `${result.rated} of ${result.total} goals rated so far` : ''}>
                        <Tag color={ratingColor(shown)} style={{ borderRadius: 999, margin: 0, fontSize: 13 }}>
                            {shown.toFixed(2)} · {ratingLabel(shown)}
                            {result.score === null ? ' so far' : ''}
                        </Tag>
                    </Tooltip>
                )}
            </Space>
        </div>
    )

    const ratingTag = (value?: number | null) =>
        value ? (
            <Tag color={ratingColor(value)} style={{ margin: 0 }}>
                {ratingOptions.find(o => o.value === value)?.label || value}
            </Tag>
        ) : (
            <Text type='secondary'>Not rated</Text>
        )

    const gapTag = (item: CompactItem) => {
        const gap = gaps.find(g => g.itemId === item.id)
        return gap ? (
            <Tag color={Math.abs(gap.gap) >= 2 ? 'red' : 'gold'} style={{ margin: 0 }}>
                Gap {gap.gap > 0 ? `+${gap.gap}` : gap.gap}
            </Tag>
        ) : null
    }

    const goalColumn = {
        title: 'Goal',
        key: 'kpa',
        width: 260,
        render: (_: unknown, item: CompactItem) => (
            <Space direction='vertical' size={0}>
                <Text strong>{item.kpa || 'Untitled'}</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>
                    {sectionLabel(item)} · {item.weight}%{item.target ? ` · target ${item.target}` : ''}
                </Text>
            </Space>
        )
    }

    // The employee's own assessment, editable until the manager submits.
    const selfColumn = (title: string) => ({
        title,
        key: 'self',
        render: (_: unknown, item: CompactItem) => {
            const entry = self[item.id] || {}
            if (!canEditSelf) {
                return entry.rating || entry.comment ? (
                    <Space direction='vertical' size={2}>
                        <Space size={6}>
                            {ratingTag(entry.rating)}
                            {isManage ? gapTag(item) : null}
                        </Space>
                        {entry.comment ? <Text>{entry.comment}</Text> : null}
                        {entry.evidence ? (
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Evidence: {entry.evidence}
                            </Text>
                        ) : null}
                    </Space>
                ) : (
                    <Text type='secondary'>{record?.selfSubmittedAt ? 'No rating given' : 'Not submitted yet'}</Text>
                )
            }
            return (
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <Select
                        allowClear
                        placeholder='Rate yourself'
                        style={{ width: '100%' }}
                        value={entry.rating ?? undefined}
                        options={ratingOptions}
                        onChange={value => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], rating: value ?? null } }))}
                    />
                    <Input.TextArea
                        placeholder='What you delivered'
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={entry.comment}
                        onChange={e => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], comment: e.target.value } }))}
                    />
                    <Input
                        placeholder='Evidence (document, link, result)'
                        value={entry.evidence}
                        onChange={e => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], evidence: e.target.value } }))}
                    />
                </Space>
            )
        }
    })

    // The manager's rating. It is also the final rating, unless HR changes the
    // final rating while mediating a dispute.
    const managerColumn = (title: string) => ({
        title,
        key: 'manager',
        render: (_: unknown, item: CompactItem) => {
            const rating = review.ratings[item.id] || {}
            if (isSelf && !managerSubmitted) return <Text type='secondary'>Shown once your line manager submits</Text>
            if (!canEditManager) {
                return (
                    <Space direction='vertical' size={2}>
                        <Space size={6} wrap>
                            {ratingTag(rating.final ?? rating.manager)}
                            {isSelf ? gapTag(item) : null}
                            {rating.final && rating.manager && rating.final !== rating.manager ? (
                                <Text type='secondary' style={{ fontSize: 12 }}>
                                    (manager rated {rating.manager})
                                </Text>
                            ) : null}
                        </Space>
                        {rating.managerComment ? <Text>{rating.managerComment}</Text> : null}
                    </Space>
                )
            }
            if (stage === 'disputed') {
                return (
                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Manager rated {rating.manager ?? '—'}. Final after mediation:
                        </Text>
                        <Select
                            placeholder='Final rating'
                            style={{ width: '100%' }}
                            value={rating.final ?? undefined}
                            options={ratingOptions}
                            onChange={value => onRating(item.id, { final: value ?? null })}
                        />
                    </Space>
                )
            }
            return (
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <Select
                        allowClear
                        placeholder='Rating'
                        style={{ width: '100%' }}
                        status={!rating.final ? 'warning' : undefined}
                        value={rating.final ?? rating.manager ?? undefined}
                        options={ratingOptions}
                        onChange={value => onRating(item.id, { manager: value ?? null, final: value ?? null })}
                    />
                    <Input.TextArea
                        placeholder='Comment'
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={rating.managerComment}
                        onChange={e => onRating(item.id, { managerComment: e.target.value })}
                    />
                </Space>
            )
        }
    })

    const columns = isSelf
        ? [goalColumn, selfColumn('Your assessment'), ...(managerSubmitted ? [managerColumn('Line manager')] : [])]
        : [goalColumn, selfColumn("Employee's view"), managerColumn(isLineManager ? 'Your rating' : 'Line manager')]

    const actions: React.ReactNode[] = []
    if (isSelf) {
        if (canEditSelf) {
            actions.push(
                <Button key='save' onClick={() => saveSelf(false)} loading={busy}>
                    Save draft
                </Button>,
                <Button key='submit' type='primary' onClick={() => saveSelf(true)} loading={busy}>
                    {record?.selfSubmittedAt ? 'Update submission' : 'Submit to my line manager'}
                </Button>
            )
        }
        if (stage === 'discussion' && !record?.signoff?.employee) {
            if (!record?.dispute) {
                actions.push(
                    <Button key='dispute' danger icon={<WarningOutlined />} onClick={() => setDisputeOpen(true)}>
                        I disagree
                    </Button>
                )
            }
            actions.push(
                <Button key='sign' type='primary' onClick={() => confirmSign('employee')} loading={busy}>
                    Sign review
                </Button>
            )
        }
    } else if (isLineManager || isOverseer) {
        if (managerSubmitted && isLineManager && (stage === 'discussion' || stage === 'disputed')) {
            actions.push(
                <Button key='reopen' onClick={reopen} loading={busy}>
                    Reopen
                </Button>
            )
        }
        if (!managerSubmitted && isLineManager) {
            actions.push(
                <Button key='submit' type='primary' onClick={submitAssessment} loading={busy}>
                    Submit assessment
                </Button>
            )
        }
        if (stage === 'discussion' && isLineManager && !record?.signoff?.manager) {
            actions.push(
                <Button key='sign' type='primary' onClick={() => confirmSign('manager')} loading={busy}>
                    Sign review
                </Button>
            )
        }
    }

    // Each person writes their own overall comment and reads the other's.
    const overallBlock = (label: string, value: string | undefined, editable: boolean, onChange: (text: string) => void, placeholder: string) => (
        <div style={{ flex: '1 1 280px' }}>
            <Text type='secondary' style={{ fontSize: 12 }}>{label}</Text>
            {editable ? (
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
            ) : (
                <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }} type={value ? undefined : 'secondary'}>
                    {value || 'No comment yet'}
                </Paragraph>
            )}
        </div>
    )
    const showManagerOverall = !isSelf || managerSubmitted

    return (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            {statusBar}

            {record?.dispute ? (
                <Card size='small' title={record.dispute.resolution ? 'Dispute (resolved)' : 'Dispute'}>
                    <Space direction='vertical' size={8} style={{ width: '100%' }}>
                        <div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Raised {dayjs(record.dispute.raisedAt).format('D MMM YYYY')}
                            </Text>
                            <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{record.dispute.reason}</Paragraph>
                        </div>
                        {record.dispute.resolution ? (
                            <Text type='success'>Resolution: {record.dispute.resolution}</Text>
                        ) : isOverseer && isManage ? (
                            <>
                                <Input.TextArea
                                    placeholder='How the dispute was resolved'
                                    autoSize={{ minRows: 2, maxRows: 6 }}
                                    value={resolution}
                                    onChange={e => setResolution(e.target.value)}
                                />
                                <Button type='primary' onClick={resolveDispute} loading={busy} style={{ width: 'fit-content' }}>
                                    Resolve dispute
                                </Button>
                            </>
                        ) : (
                            <Text type='secondary'>HR is mediating.</Text>
                        )}
                    </Space>
                </Card>
            ) : null}

            <EditableRows<CompactItem> rows={items} isMobile={isMobile} emptyText='No weighted goals in the compact' columns={columns} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {overallBlock(isSelf ? 'Your overall comment' : "Employee's overall comment", overallSelf, canEditSelf, setOverallSelf, 'Your year so far, in a few lines')}
                {showManagerOverall
                    ? overallBlock(
                          isLineManager ? 'Your overall comment' : "Line manager's overall comment",
                          review.overallManagerComment,
                          canEditManager,
                          text => onOverall({ overallManagerComment: text }),
                          'Overall feedback'
                      )
                    : null}
            </div>

            {actions.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>{actions}</div> : null}

            <Modal
                open={disputeOpen}
                onCancel={() => setDisputeOpen(false)}
                onOk={raiseDispute}
                okText='Raise dispute'
                okButtonProps={{ danger: true, loading: busy }}
                title='Raise a dispute'
                destroyOnClose
            >
                <Space direction='vertical' size={8} style={{ width: '100%' }}>
                    <Text type='secondary'>
                        HR mediates between you and your line manager. Say which ratings you disagree with and why, with your evidence.
                    </Text>
                    <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} value={disputeReason} onChange={e => setDisputeReason(e.target.value)} />
                </Space>
            </Modal>
        </Space>
    )
}
