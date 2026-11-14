import { Alert, Collapse, Space, Tag, Typography, theme } from 'antd'
import dayjs from 'dayjs'

import { getChallengeStatusColor, toDate } from '../riskEngine'
import type {
    BounceStatus,
    CommunicationAttempt,
    OperationalChallenge,
    ReminderEmailLog,
    SMERow
} from '../types'

const { Text } = Typography

type Props = {
    row: SMERow
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

/** One SME's contact history: manual attempts, automated reminders and linked operational challenges. */
export default function CommunicationPanel({
    row,
    getSMEChallenges,
    getCommunicationAttempts,
    getReminderEmails,
    getBounceStatus
}: Props) {
    const { token } = theme.useToken()

    const challenges = getSMEChallenges(row.participantId)

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
