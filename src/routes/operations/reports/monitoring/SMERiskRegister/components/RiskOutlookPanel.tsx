import { Alert, Col, Collapse, Row, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'

import { getChallengeStatusColor, isOpenChallengeStatus, normalizeText, toDate } from '../riskEngine'
import type { BounceStatus, CommunicationAttempt, OperationalChallenge, ReminderEmailLog, SMERow } from '../types'
import RiskSimulationPanel from './RiskSimulationPanel'

const { Title, Text } = Typography

type Props = {
    row: SMERow
    mode?: 'outlook' | 'communication'
    getSMEChallenges: (participantId: string) => OperationalChallenge[]
    getCommunicationAttempts: (participantId: string) => Array<CommunicationAttempt & { attemptedAt?: any }>
    getReminderEmails: (participantId: string) => ReminderEmailLog[]
    getBounceStatus: (participantId: string) => BounceStatus | undefined
}

type TimelineEntry = {
    key: string
    source: 'manual' | 'auto'
    date: Date | null
    channel: string
    status?: 'sent' | 'failed'
    detail?: string
}

export default function RiskOutlookPanel({ row, mode = 'outlook', getSMEChallenges, getCommunicationAttempts, getReminderEmails, getBounceStatus }: Props) {
    const challenges = getSMEChallenges(row.participantId)
    const openChallenges = challenges.filter(challenge => isOpenChallengeStatus(challenge.status))
    const bounceStatus = getBounceStatus(row.participantId)
    const timeline: TimelineEntry[] = [
        ...getCommunicationAttempts(row.participantId).map((attempt, index) => ({
            key: `manual-${index}-${String(attempt.attemptedAt)}`,
            source: 'manual' as const,
            date: toDate(attempt.attemptedAt),
            channel: attempt.channel || 'Method not recorded',
            detail: attempt.notes || (attempt.items?.length ? `Awaiting: ${attempt.items.join(', ')}` : undefined)
        })),
        ...getReminderEmails(row.participantId).map(email => ({
            key: `auto-${email.id}`,
            source: 'auto' as const,
            date: email.createdAt,
            channel: 'Automated reminder email',
            status: email.status,
            detail: email.status === 'failed' ? (email.error || 'Send failed') : undefined
        }))
    ].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))

    const latestEntry = timeline[0]
    const suggestedAction = openChallenges.flatMap(challenge => challenge.mitigationSteps || []).map(normalizeText).find(Boolean)
    const contactIsRecent = !!latestEntry?.date && dayjs().diff(latestEntry.date, 'day') <= 14
    const hasOverdueChallenge = openChallenges.some(challenge => {
        const dueDate = toDate(challenge.dueDate)
        return !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')
    })
    const outlookTrend = hasOverdueChallenge || ((row.riskLevel === 'High' || row.riskLevel === 'Critical') && !contactIsRecent)
        ? { label: 'Needs attention', type: 'error' as const, detail: hasOverdueChallenge ? 'An open challenge is overdue.' : 'Current risk is high and delivery evidence still needs attention.' }
        : openChallenges.length > 0
            ? { label: 'Mitigation in progress', type: 'info' as const, detail: 'Open mitigation work is recorded.' }
            : { label: 'Stable', type: 'success' as const, detail: 'No overdue mitigation is recorded.' }

    if (mode === 'outlook') {
        const confirmationHoldUps = row.smePendingAcceptanceCount + row.smePendingConfirmationCount
        return (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div>
                    <Title level={5} style={{ margin: 0 }}>Risk outlook</Title>
                    <Text type="secondary">Decision support based on delivery, confirmation, and mitigation status.</Text>
                </div>
                <Row gutter={[12, 12]}>
                    <Col xs={12}>
                        <Text type="secondary">Service coverage</Text>
                        <div><Text strong>{row.servicedDepartmentsCount}/{row.expectedDepartmentsCount}</Text></div>
                    </Col>
                    <Col xs={12}>
                        <Text type="secondary">Confirmation hold-ups</Text>
                        <div><Tag color={confirmationHoldUps ? 'gold' : 'green'}>{confirmationHoldUps}</Tag></div>
                    </Col>
                    <Col xs={24}>
                        <Text type="secondary">Recommended next action</Text>
                        <div style={{ marginTop: 4, fontWeight: 600 }}>
                            {suggestedAction || (row.missingDepartmentsCount > 0
                                ? 'Resolve the outstanding Developmental Plan or service delivery hold-up.'
                                : 'Continue monitoring service delivery progress.')}
                        </div>
                    </Col>
                </Row>
                <Alert type={outlookTrend.type} showIcon message={`Trend: ${outlookTrend.label}`} description={outlookTrend.detail} />
                <RiskSimulationPanel row={row} />
            </Space>
        )
    }

    return (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
                <Title level={5} style={{ margin: 0 }}>Communication history</Title>
                <Text type="secondary">Recorded contact attempts, automatic reminders, and linked operational challenges.</Text>
            </div>
            {bounceStatus && (
                <Alert type="error" showIcon message="This SME’s email previously bounced." description={`${bounceStatus.to} was rejected by the receiving mail server (${bounceStatus.lastError || bounceStatus.reason}). Update the participant email before sending another reminder.`} />
            )}
            {latestEntry ? (
                <Alert
                    type={latestEntry.source === 'auto' && latestEntry.status === 'failed' ? 'warning' : 'info'}
                    showIcon
                    message={<Space><Text strong>Latest contact: {latestEntry.channel}{latestEntry.date ? ` on ${dayjs(latestEntry.date).format('DD MMM YYYY, HH:mm')}` : ''}</Text><Tag color={latestEntry.source === 'auto' ? 'purple' : 'default'}>{latestEntry.source === 'auto' ? 'Auto reminder' : 'Manual'}</Tag></Space>}
                    description={latestEntry.detail || 'No outcome notes were recorded.'}
                />
            ) : (
                <Alert type="warning" showIcon message="No communication attempt has been recorded for this SME." description="Communication is read from Success & Challenges and automated SME reminders." />
            )}
            {challenges.length > 0 && (
                <Collapse
                    items={challenges.map(challenge => ({
                        key: challenge.id,
                        label: <Space wrap><Text strong>{challenge.title || 'Operational challenge'}</Text><Tag color={getChallengeStatusColor(challenge.status)}>{challenge.status || 'Open'}</Tag><Tag>{(challenge.communicationAttempts || []).length} contact attempt{(challenge.communicationAttempts || []).length === 1 ? '' : 's'}</Tag></Space>,
                        children: (
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                {challenge.details && <Text>{challenge.details}</Text>}
                                {(challenge.communicationAttempts || []).map((attempt, index) => (
                                    <div key={`${challenge.id}-${index}`} style={{ padding: '8px 12px', borderLeft: '3px solid #91caff', background: '#f5faff' }}>
                                        <Text strong>{attempt.channel || 'Contact attempt'}</Text>
                                        <Text type="secondary"> · {toDate(attempt.attemptedAt) ? dayjs(toDate(attempt.attemptedAt)).format('DD MMM YYYY, HH:mm') : 'Date not recorded'}</Text>
                                        {attempt.items?.length ? <div>Awaiting: {attempt.items.join(', ')}</div> : null}
                                        {attempt.notes ? <div>{attempt.notes}</div> : null}
                                    </div>
                                ))}
                                {challenge.mitigationSteps?.length ? <Text type="secondary">Mitigation: {challenge.mitigationSteps.join(' · ')}</Text> : null}
                            </Space>
                        )
                    }))}
                />
            )}
        </Space>
    )
}
