import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Input, Modal, Progress, Row, Select, Space, Steps, Tag, Typography, message, theme } from 'antd'
import { CheckCircleFilled, WarningOutlined } from '@ant-design/icons'
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

const { Text, Title, Paragraph } = Typography

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
    const steps = (
        <Steps
            size='small'
            direction={isMobile ? 'vertical' : 'horizontal'}
            current={stageIndex(stage)}
            status={stage === 'disputed' ? 'error' : stage === 'validated' ? 'finish' : 'process'}
            items={REVIEW_STAGES.map(s => ({
                title: s.key === 'discussion' && stage === 'disputed' ? 'Disputed' : s.label,
                description: s.owner
            }))}
        />
    )

    const columns = [
        {
            title: 'KPA',
            key: 'kpa',
            width: 240,
            render: (_: unknown, item: CompactItem) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{item.kpa || 'Untitled'}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {sectionLabel(item)} · weight {item.weight}%{item.target ? ` · target ${item.target}` : ''}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Self',
            key: 'self',
            width: 220,
            render: (_: unknown, item: CompactItem) => (
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    <Select
                        allowClear
                        placeholder={canEditSelf ? 'Rate yourself' : 'Not rated'}
                        style={{ width: '100%' }}
                        disabled={!canEditSelf}
                        value={self[item.id]?.rating ?? undefined}
                        options={ratingOptions}
                        onChange={value => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], rating: value ?? null } }))}
                    />
                    <Input.TextArea
                        placeholder='Your comment'
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        disabled={!canEditSelf}
                        value={self[item.id]?.comment}
                        onChange={e => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], comment: e.target.value } }))}
                    />
                    <Input
                        placeholder='Evidence (document, link, result)'
                        disabled={!canEditSelf}
                        value={self[item.id]?.evidence}
                        onChange={e => setSelf(s => ({ ...s, [item.id]: { ...s[item.id], evidence: e.target.value } }))}
                    />
                </Space>
            )
        },
        {
            title: 'Manager',
            key: 'manager',
            width: 220,
            render: (_: unknown, item: CompactItem) =>
                isSelf && !managerSubmitted ? (
                    <Text type='secondary'>Shown once your line manager submits</Text>
                ) : (
                    <Space direction='vertical' size={6} style={{ width: '100%' }}>
                        <Select
                            allowClear
                            placeholder='Manager rating'
                            style={{ width: '100%' }}
                            disabled={!canEditManager}
                            value={review.ratings[item.id]?.manager ?? undefined}
                            options={ratingOptions}
                            onChange={value => onRating(item.id, { manager: value ?? null })}
                        />
                        <Input.TextArea
                            placeholder='Manager comment'
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            disabled={!canEditManager}
                            value={review.ratings[item.id]?.managerComment}
                            onChange={e => onRating(item.id, { managerComment: e.target.value })}
                        />
                    </Space>
                )
        },
        {
            title: 'Final',
            key: 'final',
            width: 190,
            render: (_: unknown, item: CompactItem) => {
                if (isSelf && !managerSubmitted) return <Text type='secondary'>—</Text>
                const gap = gaps.find(g => g.itemId === item.id)
                return (
                    <Space direction='vertical' size={4} style={{ width: '100%' }}>
                        <Select
                            allowClear
                            placeholder='Final rating'
                            style={{ width: '100%' }}
                            disabled={!canEditManager}
                            status={canEditManager && !review.ratings[item.id]?.final ? 'warning' : undefined}
                            value={review.ratings[item.id]?.final ?? undefined}
                            options={ratingOptions}
                            onChange={value => onRating(item.id, { final: value ?? null })}
                        />
                        {gap ? (
                            <Tag color={Math.abs(gap.gap) >= 2 ? 'red' : 'gold'} style={{ margin: 0 }}>
                                Gap {gap.gap > 0 ? `+${gap.gap}` : gap.gap} vs self
                            </Tag>
                        ) : null}
                    </Space>
                )
            }
        }
    ]

    const actions: React.ReactNode[] = []
    if (isSelf) {
        if (canEditSelf) {
            actions.push(
                <Button key='save' onClick={() => saveSelf(false)} loading={busy}>
                    Save draft
                </Button>,
                <Button key='submit' type='primary' onClick={() => saveSelf(true)} loading={busy}>
                    {record?.selfSubmittedAt ? 'Update submission' : 'Submit self-assessment'}
                </Button>
            )
        }
        if (stage === 'discussion' && !record?.signoff?.employee) {
            actions.push(
                <Button key='sign' type='primary' onClick={() => confirmSign('employee')} loading={busy}>
                    Sign review
                </Button>
            )
            if (!record?.dispute) {
                actions.push(
                    <Button key='dispute' danger icon={<WarningOutlined />} onClick={() => setDisputeOpen(true)}>
                        Raise dispute
                    </Button>
                )
            }
        }
    } else if (isLineManager || isOverseer) {
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
        if (managerSubmitted && isLineManager && (stage === 'discussion' || stage === 'disputed')) {
            actions.push(
                <Button key='reopen' onClick={reopen} loading={busy}>
                    Reopen assessment
                </Button>
            )
        }
    }

    const signatureLine = (role: 'manager' | 'employee', label: string) => {
        const signature = record?.signoff?.[role]
        return (
            <Space size={6}>
                {signature ? <CheckCircleFilled style={{ color: token.colorSuccess }} /> : null}
                <Text type={signature ? undefined : 'secondary'}>
                    {label}: {signature ? `${signature.name}, ${dayjs(signature.at).format('D MMM YYYY')}` : 'not signed'}
                </Text>
            </Space>
        )
    }

    return (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            <Card size='small'>{steps}</Card>

            {stage === 'self' && isSelf ? (
                <Alert
                    type='info'
                    showIcon
                    message='Assess yourself first'
                    description='Rate each item, explain what you delivered, and point to your evidence. Then submit it to your line manager.'
                />
            ) : null}
            {stage === 'manager' && isSelf ? <Alert type='info' showIcon message='Submitted. Your line manager is now assessing.' /> : null}

            <Card size='small'>
                <Row gutter={[16, 12]} align='middle'>
                    <Col xs={24} md={8}>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {result.score !== null ? 'Weighted final rating' : 'Rating so far'}
                        </Text>
                        <Space align='baseline' size={8} style={{ display: 'flex' }}>
                            <Title level={2} style={{ margin: 0 }}>
                                {isSelf && !managerSubmitted ? '—' : shown !== null ? shown.toFixed(2) : '—'}
                            </Title>
                            <Text type='secondary'>/ 5</Text>
                        </Space>
                        {calibrated !== null && record?.calibration ? (
                            <Tag color={ratingColor(calibrated)} style={{ borderRadius: 999 }}>
                                Calibrated {calibrated.toFixed(2)} · {ratingLabel(calibrated)}
                            </Tag>
                        ) : shown !== null && !(isSelf && !managerSubmitted) ? (
                            <Tag color={ratingColor(shown)} style={{ borderRadius: 999 }}>{ratingLabel(shown)}</Tag>
                        ) : null}
                    </Col>
                    <Col xs={24} md={16}>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {result.rated} of {result.total} items have a final rating
                        </Text>
                        <Progress percent={result.total ? Math.round((result.rated / result.total) * 100) : 0} />
                        <Space direction='vertical' size={2}>
                            {signatureLine('manager', 'Line manager')}
                            {signatureLine('employee', 'Employee')}
                            {record?.validation ? (
                                <Text type='success'>
                                    Validated by {record.validation.byName || 'the CEO'} on {dayjs(record.validation.at).format('D MMM YYYY')}
                                </Text>
                            ) : null}
                        </Space>
                    </Col>
                </Row>
            </Card>

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
                            <Alert type='success' showIcon message='Resolution' description={record.dispute.resolution} />
                        ) : isOverseer && isManage ? (
                            <>
                                <Input.TextArea
                                    placeholder='How the dispute was resolved (HR mediation)'
                                    autoSize={{ minRows: 2, maxRows: 6 }}
                                    value={resolution}
                                    onChange={e => setResolution(e.target.value)}
                                />
                                <Button type='primary' onClick={resolveDispute} loading={busy}>
                                    Resolve dispute
                                </Button>
                            </>
                        ) : (
                            <Text type='secondary'>HR is mediating.</Text>
                        )}
                    </Space>
                </Card>
            ) : null}

            {gaps.length && (managerSubmitted || isManage) ? (
                <Alert
                    type={gaps.some(g => Math.abs(g.gap) >= 2) ? 'warning' : 'info'}
                    showIcon
                    message={`${gaps.length} item${gaps.length === 1 ? '' : 's'} where self and final ratings differ`}
                    description='Discuss these first: what was delivered, the evidence, and what affected performance.'
                />
            ) : null}

            <Card size='small' title={phaseLabel}>
                <EditableRows<CompactItem> rows={items} isMobile={isMobile} scrollX={900} emptyText='No weighted items in the compact' columns={columns} />
            </Card>

            <Card size='small' title='Overall comments'>
                <Row gutter={12}>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Employee</Text>
                        <Input.TextArea rows={4} disabled={!canEditSelf} value={overallSelf} onChange={e => setOverallSelf(e.target.value)} />
                    </Col>
                    <Col xs={24} md={12}>
                        <Text type='secondary' style={{ fontSize: 12 }}>Line manager</Text>
                        <Input.TextArea
                            rows={4}
                            disabled={!canEditManager}
                            value={review.overallManagerComment}
                            onChange={e => onOverall({ overallManagerComment: e.target.value })}
                        />
                    </Col>
                </Row>
            </Card>

            {actions.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>{actions}</div>
            ) : null}

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
