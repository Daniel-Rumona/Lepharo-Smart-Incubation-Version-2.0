import {
    Alert,
    Col,
    Collapse,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ApartmentOutlined,
    ArrowRightOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'

import {
    getChallengeStatusColor,
    isOpenChallengeStatus,
    normalizeText,
    toDate
} from '../riskEngine'
import type {
    BounceStatus,
    CommunicationAttempt,
    OperationalChallenge,
    ReminderEmailLog,
    SMERow
} from '../types'
import RiskSimulationPanel from './RiskSimulationPanel'
import { useMemo } from 'react'

const { Text, Title } = Typography

type Props = {
    row: SMERow
    mode?: 'outlook' | 'communication'
    getSMEChallenges: (participantId: string) => OperationalChallenge[]
    getCommunicationAttempts: (
        participantId: string
    ) => Array<CommunicationAttempt & { attemptedAt?: any }>
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

export default function RiskOutlookPanel({
    row,
    mode = 'outlook',
    getSMEChallenges,
    getCommunicationAttempts,
    getReminderEmails,
    getBounceStatus
}: Props) {
    const { token } = theme.useToken()

    const challenges = getSMEChallenges(row.participantId)

    const openChallenges = challenges.filter(challenge =>
        isOpenChallengeStatus(challenge.status)
    )

    const bounceStatus = getBounceStatus(row.participantId)

    const timeline: TimelineEntry[] = [
        ...getCommunicationAttempts(row.participantId).map(
            (attempt, index) => ({
                key: `manual-${index}-${String(
                    attempt.attemptedAt
                )}`,
                source: 'manual' as const,
                date: toDate(attempt.attemptedAt),
                channel:
                    attempt.channel || 'Method not recorded',
                detail:
                    attempt.notes ||
                    (attempt.items?.length
                        ? `Awaiting: ${attempt.items.join(', ')}`
                        : undefined)
            })
        ),
        ...getReminderEmails(row.participantId).map(email => ({
            key: `auto-${email.id}`,
            source: 'auto' as const,
            date: email.createdAt,
            channel: 'Automated reminder email',
            status: email.status,
            detail:
                email.status === 'failed'
                    ? email.error || 'Send failed'
                    : undefined
        }))
    ].sort(
        (a, b) =>
            (b.date?.getTime() || 0) -
            (a.date?.getTime() || 0)
    )

    const latestEntry = timeline[0]

    const suggestedAction = openChallenges
        .flatMap(challenge => challenge.mitigationSteps || [])
        .map(normalizeText)
        .find(Boolean)

    const contactIsRecent =
        !!latestEntry?.date &&
        dayjs().diff(latestEntry.date, 'day') <= 14

    const hasOverdueChallenge = openChallenges.some(challenge => {
        const dueDate = toDate(challenge.dueDate)

        return (
            !!dueDate &&
            dayjs(dueDate).isBefore(dayjs(), 'day')
        )
    })

    const recommendedAction = useMemo(() => {
        // 1. Explicit mitigation recorded against an open challenge
        if (suggestedAction) {
            return suggestedAction
        }

        // 2. Department has not reviewed the DP
        const pendingDepartmentReviews = row.expectedDepartments.filter(
            department => !department.deptConfirmed
        )

        if (pendingDepartmentReviews.length > 0) {
            const names = pendingDepartmentReviews
                .map(department => department.departmentName)
                .join(', ')

            return pendingDepartmentReviews.length === 1
                ? `Follow up with ${names} to review the Developmental Plan.`
                : `Follow up with ${names} to review their Developmental Plan sections.`
        }

        // 3. Department reviewed, but SME has not confirmed
        const pendingSmmeConfirmations = row.expectedDepartments.filter(
            department =>
                department.deptConfirmed &&
                !department.smmeConfirmed
        )

        if (pendingSmmeConfirmations.length > 0) {
            const names = pendingSmmeConfirmations
                .map(department => department.departmentName)
                .join(', ')

            return pendingSmmeConfirmations.length === 1
                ? `Remind the SME to confirm the Developmental Plan for ${names}.`
                : `Remind the SME to confirm the Developmental Plans for ${names}.`
        }

        // 4. Services are approved but nothing has been delivered
        if (
            row.fullyConfirmedDepartmentsCount > 0 &&
            row.totalTouches === 0
        ) {
            return `Schedule the first service intervention for the SME.`
        }

        // 5. An intervention is awaiting SME acceptance
        if (row.smePendingAcceptanceCount > 0) {
            return row.smePendingAcceptanceCount === 1
                ? 'Follow up with the SME to accept the pending intervention.'
                : `Follow up with the SME to accept ${row.smePendingAcceptanceCount} pending interventions.`
        }

        // 6. Completion is waiting for SME confirmation
        if (row.smePendingConfirmationCount > 0) {
            return row.smePendingConfirmationCount === 1
                ? 'Follow up with the SME to confirm the completed intervention.'
                : `Follow up with the SME to confirm ${row.smePendingConfirmationCount} completed interventions.`
        }

        // 7. Service inactivity
        if ((row.daysSinceLastService ?? 0) >= 30) {
            return `Schedule a follow-up service; the SME has not been serviced for ${row.daysSinceLastService} days.`
        }

        // 8. Declined service/intervention
        if (row.declinedTouches > 0) {
            return row.declinedTouches === 1
                ? 'Review the declined intervention and agree on the next delivery step with the SME.'
                : `Review the ${row.declinedTouches} declined interventions and agree on the next delivery steps with the SME.`
        }

        return 'Continue monitoring the SME’s service delivery progress.'
    }, [
        suggestedAction,
        row.expectedDepartments,
        row.fullyConfirmedDepartmentsCount,
        row.totalTouches,
        row.smePendingAcceptanceCount,
        row.smePendingConfirmationCount,
        row.daysSinceLastService,
        row.declinedTouches
    ])

    const outlookTrend =
        hasOverdueChallenge ||
            ((row.riskLevel === 'High' ||
                row.riskLevel === 'Critical') &&
                !contactIsRecent)
            ? {
                label: 'Needs attention',
                type: 'error' as const,
                detail: hasOverdueChallenge
                    ? 'An open challenge is overdue.'
                    : 'Current risk is high and delivery evidence still needs attention.'
            }
            : openChallenges.length > 0
                ? {
                    label: 'Mitigation in progress',
                    type: 'info' as const,
                    detail: 'Open mitigation work is recorded.'
                }
                : {
                    label: 'Stable',
                    type: 'success' as const,
                    detail: 'No overdue mitigation is recorded.'
                }

    if (mode === 'outlook') {
        const { token } = theme.useToken()

        const confirmationHoldUps =
            row.smePendingAcceptanceCount +
            row.smePendingConfirmationCount

        const coveragePercent =
            row.expectedDepartmentsCount > 0
                ? Math.round(
                    (row.servicedDepartmentsCount /
                        row.expectedDepartmentsCount) *
                    100
                )
                : 0

        const trendColor =
            outlookTrend.type === 'error'
                ? token.colorError
                : outlookTrend.type === 'info'
                    ? token.colorInfo
                    : token.colorSuccess

        const trendBackground =
            outlookTrend.type === 'error'
                ? token.colorErrorBg
                : outlookTrend.type === 'info'
                    ? token.colorInfoBg
                    : token.colorSuccessBg

        const trendBorder =
            outlookTrend.type === 'error'
                ? token.colorErrorBorder
                : outlookTrend.type === 'info'
                    ? token.colorInfoBorder
                    : token.colorSuccessBorder

        return (
            <Space
                direction="vertical"
                size={14}
                style={{ width: '100%' }}
            >
                <Row gutter={[8, 8]}>
                    <Col xs={24} md={8}>
                        <div
                            style={{
                                height: '100%',
                                minHeight: 82,
                                padding: 11,
                                borderRadius: 11,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorFillQuaternary
                            }}
                        >
                            <Space size={7}>
                                <ApartmentOutlined
                                    style={{
                                        color: token.colorPrimary
                                    }}
                                />

                                <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                >
                                    Service coverage
                                </Text>
                            </Space>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                    marginTop: 8
                                }}
                            >
                                <Text
                                    strong
                                    style={{ fontSize: 17 }}
                                >
                                    {row.servicedDepartmentsCount}/
                                    {row.expectedDepartmentsCount}
                                </Text>

                                <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                >
                                    {coveragePercent}%
                                </Text>
                            </div>

                            <Progress
                                percent={coveragePercent}
                                showInfo={false}
                                size="small"
                                style={{
                                    marginTop: 5,
                                    marginBottom: 0
                                }}
                            />
                        </div>
                    </Col>

                    <Col xs={12} md={8}>
                        <div
                            style={{
                                height: '100%',
                                minHeight: 82,
                                padding: 11,
                                borderRadius: 11,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorFillQuaternary
                            }}
                        >
                            <Space size={7}>
                                <CheckCircleOutlined
                                    style={{
                                        color:
                                            confirmationHoldUps > 0
                                                ? token.colorWarning
                                                : token.colorSuccess
                                    }}
                                />

                                <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                >
                                    Confirmation hold-ups
                                </Text>
                            </Space>

                            <div style={{ marginTop: 9 }}>
                                <Text
                                    strong
                                    style={{ fontSize: 20 }}
                                >
                                    {confirmationHoldUps}
                                </Text>

                                <Text
                                    type="secondary"
                                    style={{
                                        display: 'block',
                                        marginTop: 2,
                                        fontSize: 10
                                    }}
                                >
                                    {confirmationHoldUps > 0
                                        ? 'Still awaiting action'
                                        : 'No confirmations pending'}
                                </Text>
                            </div>
                        </div>
                    </Col>

                    <Col xs={12} md={8}>
                        <div
                            style={{
                                height: '100%',
                                minHeight: 82,
                                padding: 11,
                                borderRadius: 11,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorFillQuaternary
                            }}
                        >
                            <Space size={7}>
                                <ExclamationCircleOutlined
                                    style={{
                                        color:
                                            openChallenges.length > 0
                                                ? token.colorWarning
                                                : token.colorSuccess
                                    }}
                                />

                                <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                >
                                    Open challenges
                                </Text>
                            </Space>

                            <div style={{ marginTop: 9 }}>
                                <Text
                                    strong
                                    style={{ fontSize: 20 }}
                                >
                                    {openChallenges.length}
                                </Text>

                                <Text
                                    type="secondary"
                                    style={{
                                        display: 'block',
                                        marginTop: 2,
                                        fontSize: 10
                                    }}
                                >
                                    {openChallenges.length > 0
                                        ? 'Mitigation required'
                                        : 'No open challenges'}
                                </Text>
                            </div>
                        </div>
                    </Col>
                </Row>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            '34px minmax(0, 1fr) 28px',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 11,
                        border: `1px solid ${token.colorPrimaryBorder}`,
                        background: token.colorPrimaryBg
                    }}
                >
                    <div
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 9,
                            display: 'grid',
                            placeItems: 'center',
                            background: token.colorPrimary,
                            color: token.colorTextLightSolid
                        }}
                    >
                        <ArrowRightOutlined />
                    </div>

                    <div style={{ minWidth: 0 }}>
                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                fontSize: 10
                            }}
                        >
                            Recommended next action
                        </Text>

                        <Text
                            strong
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 13
                            }}
                        >
                            {recommendedAction}
                        </Text>
                    </div>

                    <ArrowRightOutlined
                        style={{
                            color: token.colorPrimary
                        }}
                    />
                </div>

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 11px',
                        borderRadius: 10,
                        border: `1px solid ${trendBorder}`,
                        background: trendBackground
                    }}
                >
                    <div
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 999,
                            display: 'grid',
                            placeItems: 'center',
                            background: trendColor,
                            color: token.colorTextLightSolid,
                            flex: '0 0 auto'
                        }}
                    >
                        {outlookTrend.type === 'success' ? (
                            <CheckCircleOutlined />
                        ) : (
                            <ExclamationCircleOutlined />
                        )}
                    </div>

                    <div
                        style={{
                            minWidth: 0,
                            flex: '1 1 auto'
                        }}
                    >
                        <Space
                            size={6}
                            wrap
                            style={{
                                marginBottom: 1
                            }}
                        >
                            <Text strong>
                                {outlookTrend.label}
                            </Text>

                            <Tag
                                color={
                                    outlookTrend.type === 'error'
                                        ? 'red'
                                        : outlookTrend.type === 'info'
                                            ? 'blue'
                                            : 'green'
                                }
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                Trend
                            </Tag>
                        </Space>

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                fontSize: 11
                            }}
                        >
                            {outlookTrend.detail}
                        </Text>
                    </div>
                </div>

                <RiskSimulationPanel row={row} />
            </Space>
        )
    }

    return (
        <Space
            direction="vertical"
            size={14}
            style={{ width: '100%' }}
        >
            <div>
                <Text
                    strong
                    style={{
                        display: 'block',
                        fontSize: 15
                    }}
                >
                    Communication history
                </Text>

                <Text
                    type="secondary"
                    style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: 11
                    }}
                >
                    Manual contact attempts, automated reminders,
                    and linked operational challenges.
                </Text>
            </div>

            {bounceStatus && (
                <Alert
                    type="error"
                    showIcon
                    message="This SME’s email previously bounced."
                    description={`${bounceStatus.to} was rejected by the receiving mail server (${bounceStatus.lastError || bounceStatus.reason}). Update the participant email before sending another reminder.`}
                />
            )}

            {latestEntry ? (
                <Alert
                    type={
                        latestEntry.source === 'auto' &&
                            latestEntry.status === 'failed'
                            ? 'warning'
                            : 'info'
                    }
                    showIcon
                    message={
                        <Space wrap>
                            <Text strong>
                                Latest contact: {latestEntry.channel}
                                {latestEntry.date
                                    ? ` on ${dayjs(
                                        latestEntry.date
                                    ).format(
                                        'DD MMM YYYY, HH:mm'
                                    )}`
                                    : ''}
                            </Text>

                            <Tag
                                color={
                                    latestEntry.source === 'auto'
                                        ? 'purple'
                                        : 'default'
                                }
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                {latestEntry.source === 'auto'
                                    ? 'Auto reminder'
                                    : 'Manual'}
                            </Tag>
                        </Space>
                    }
                    description={
                        latestEntry.detail ||
                        'No outcome notes were recorded.'
                    }
                />
            ) : (
                <Alert
                    type="warning"
                    showIcon
                    message="No communication attempt has been recorded for this SME."
                    description="Communication is read from Success & Challenges and automated SME reminders."
                />
            )}

            {timeline.length > 1 && (
                <div
                    style={{
                        display: 'grid',
                        gap: 7
                    }}
                >
                    {timeline.slice(1, 6).map(entry => (
                        <div
                            key={entry.key}
                            style={{
                                display: 'grid',
                                gridTemplateColumns:
                                    '110px minmax(0, 1fr) auto',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 10px',
                                border: `1px solid ${token.colorBorderSecondary}`,
                                borderRadius: 10,
                                background:
                                    token.colorFillQuaternary
                            }}
                        >
                            <Text
                                type="secondary"
                                style={{ fontSize: 11 }}
                            >
                                {entry.date
                                    ? dayjs(entry.date).format(
                                        'DD MMM YYYY'
                                    )
                                    : 'No date'}
                            </Text>

                            <div style={{ minWidth: 0 }}>
                                <Text
                                    strong
                                    style={{
                                        display: 'block',
                                        fontSize: 12
                                    }}
                                >
                                    {entry.channel}
                                </Text>

                                {entry.detail && (
                                    <Text
                                        type="secondary"
                                        ellipsis={{
                                            tooltip: entry.detail
                                        }}
                                        style={{
                                            display: 'block',
                                            marginTop: 1,
                                            fontSize: 11
                                        }}
                                    >
                                        {entry.detail}
                                    </Text>
                                )}
                            </div>

                            <Tag
                                color={
                                    entry.source === 'auto'
                                        ? 'purple'
                                        : 'default'
                                }
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                {entry.source === 'auto'
                                    ? 'Auto'
                                    : 'Manual'}
                            </Tag>
                        </div>
                    ))}
                </div>
            )}

            {challenges.length > 0 && (
                <Collapse
                    size="small"
                    items={challenges.map(challenge => ({
                        key: challenge.id,
                        label: (
                            <Space wrap>
                                <Text strong>
                                    {challenge.title ||
                                        'Operational challenge'}
                                </Text>

                                <Tag
                                    color={getChallengeStatusColor(
                                        challenge.status
                                    )}
                                    style={{
                                        marginInlineEnd: 0,
                                        borderRadius: 999
                                    }}
                                >
                                    {challenge.status || 'Open'}
                                </Tag>

                                <Tag
                                    style={{
                                        marginInlineEnd: 0,
                                        borderRadius: 999
                                    }}
                                >
                                    {
                                        (
                                            challenge.communicationAttempts ||
                                            []
                                        ).length
                                    }{' '}
                                    contact attempt
                                    {(challenge
                                        .communicationAttempts || [])
                                        .length === 1
                                        ? ''
                                        : 's'}
                                </Tag>
                            </Space>
                        ),
                        children: (
                            <Space
                                direction="vertical"
                                size={8}
                                style={{ width: '100%' }}
                            >
                                {challenge.details && (
                                    <Text>
                                        {challenge.details}
                                    </Text>
                                )}

                                {(
                                    challenge.communicationAttempts ||
                                    []
                                ).map((attempt, index) => (
                                    <div
                                        key={`${challenge.id}-${index}`}
                                        style={{
                                            padding: '8px 10px',
                                            borderRadius: 9,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background:
                                                token.colorFillQuaternary
                                        }}
                                    >
                                        <Text strong>
                                            {attempt.channel ||
                                                'Contact attempt'}
                                        </Text>

                                        <Text
                                            type="secondary"
                                            style={{
                                                marginLeft: 5
                                            }}
                                        >
                                            {toDate(
                                                attempt.attemptedAt
                                            )
                                                ? dayjs(
                                                    toDate(
                                                        attempt.attemptedAt
                                                    )
                                                ).format(
                                                    'DD MMM YYYY, HH:mm'
                                                )
                                                : 'Date not recorded'}
                                        </Text>

                                        {attempt.items?.length ? (
                                            <div
                                                style={{
                                                    marginTop: 4
                                                }}
                                            >
                                                Awaiting:{' '}
                                                {attempt.items.join(
                                                    ', '
                                                )}
                                            </div>
                                        ) : null}

                                        {attempt.notes ? (
                                            <div
                                                style={{
                                                    marginTop: 4
                                                }}
                                            >
                                                {attempt.notes}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}

                                {challenge.mitigationSteps
                                    ?.length ? (
                                    <Text type="secondary">
                                        Mitigation:{' '}
                                        {challenge.mitigationSteps.join(
                                            ' · '
                                        )}
                                    </Text>
                                ) : null}
                            </Space>
                        )
                    }))}
                />
            )}
        </Space>
    )
}
