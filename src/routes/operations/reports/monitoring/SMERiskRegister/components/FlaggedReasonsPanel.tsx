import { useState } from 'react'
import {
    App,
    Button,
    Popconfirm,
    Space,
    Tag,
    Tooltip,
    Typography,
    theme
} from 'antd'
import {
    ExclamationCircleOutlined,
    MailOutlined
} from '@ant-design/icons'

import {
    sendDepartmentReminders,
    sendSmmeReminder
} from '../services/reminderService'
import type { BounceStatus, SMERow } from '../types'

const { Text } = Typography

type Props = {
    row: SMERow
    isDepartmentScopedView: boolean
    resolvedProgramId?: string
    scopedDepartmentId?: string
    scopedDepartmentName?: string
    bounceStatus?: BounceStatus
}

function ReasonRow({
    title,
    detail,
    action,
    tone = 'warning'
}: {
    title: React.ReactNode
    detail?: React.ReactNode
    action?: React.ReactNode
    tone?: 'warning' | 'error' | 'info'
}) {
    const { token } = theme.useToken()

    const palette =
        tone === 'error'
            ? {
                  border: token.colorErrorBorder,
                  background: token.colorErrorBg,
                  icon: token.colorError
              }
            : tone === 'info'
              ? {
                    border: token.colorInfoBorder,
                    background: token.colorInfoBg,
                    icon: token.colorInfo
                }
              : {
                    border: token.colorWarningBorder,
                    background: token.colorWarningBg,
                    icon: token.colorWarning
                }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns:
                    '28px minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 10,
                minHeight: 48,
                padding: '8px 10px',
                border: `1px solid ${palette.border}`,
                borderRadius: 10,
                background: palette.background
            }}
        >
            <div
                style={{
                    width: 26,
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    color: palette.icon
                }}
            >
                <ExclamationCircleOutlined />
            </div>

            <div style={{ minWidth: 0 }}>
                <Text strong>{title}</Text>
                {detail ? (
                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 2,
                            fontSize: 11
                        }}
                    >
                        {detail}
                    </Text>
                ) : null}
            </div>

            {action ? (
                <div style={{ flex: '0 0 auto' }}>
                    {action}
                </div>
            ) : null}
        </div>
    )
}

export default function FlaggedReasonsPanel({
    row,
    isDepartmentScopedView,
    resolvedProgramId,
    scopedDepartmentId,
    scopedDepartmentName,
    bounceStatus
}: Props) {
    const { message } = App.useApp()
    const [sendingReminderKey, setSendingReminderKey] =
        useState<string | null>(null)

    const pendingDepartmentReviews =
        row.expectedDepartments.filter(
            department => !department.deptConfirmed
        )

    const pendingSmmeConfirmations =
        row.expectedDepartments.filter(
            department =>
                department.deptConfirmed &&
                !department.smmeConfirmed
        )

    const handleSendDepartmentReminders = async () => {
        try {
            setSendingReminderKey('departments')

            const data = await sendDepartmentReminders({
                resolvedProgramId,
                scopedDepartmentId,
                scopedDepartmentName
            })

            message.success(
                `Department reminders sent to ${
                    data.sent || 0
                } recipient(s).`
            )
        } catch (error: any) {
            console.error(error)
            message.error(
                error?.message ||
                    'Failed to send department reminders'
            )
        } finally {
            setSendingReminderKey(null)
        }
    }

    const handleSendSmmeReminder = async (
        department: SMERow['expectedDepartments'][number]
    ) => {
        try {
            const reminderKey = `sme-${row.participantId}-${department.departmentId}`
            setSendingReminderKey(reminderKey)

            await sendSmmeReminder(
                row,
                department,
                resolvedProgramId
            )

            message.success(
                `SME reminder sent for ${department.departmentName}.`
            )
        } catch (error: any) {
            console.error(error)
            message.error(
                error?.message || 'Failed to send SME reminder'
            )
        } finally {
            setSendingReminderKey(null)
        }
    }

    const hasReasons =
        pendingDepartmentReviews.length > 0 ||
        pendingSmmeConfirmations.length > 0 ||
        row.noServiceReasons.length > 0 ||
        row.notes.length > 0

    if (!hasReasons) {
        return (
            <ReasonRow
                tone="info"
                title="No active risk flags"
                detail="No outstanding review, SME confirmation or service-delivery flag is currently recorded."
            />
        )
    }

    return (
        <Space
            direction="vertical"
            size={7}
            style={{ width: '100%' }}
        >
            {pendingDepartmentReviews.length > 0 && (
                <ReasonRow
                    title={
                        isDepartmentScopedView
                            ? 'Developmental Plan review is pending'
                            : `${pendingDepartmentReviews.length} department${
                                  pendingDepartmentReviews.length ===
                                  1
                                      ? ''
                                      : 's'
                              } still need to review the Developmental Plan`
                    }
                    detail={pendingDepartmentReviews
                        .map(
                            department =>
                                department.departmentName
                        )
                        .join(' · ')}
                    action={
                        <Popconfirm
                            title="Send department reminders?"
                            description="This emails departments with pending Developmental Plan reviews."
                            onConfirm={
                                handleSendDepartmentReminders
                            }
                            okText="Send"
                            cancelText="Cancel"
                        >
                            <Button
                                size="small"
                                shape="round"
                                icon={<MailOutlined />}
                                loading={
                                    sendingReminderKey ===
                                    'departments'
                                }
                                disabled={
                                    !!sendingReminderKey
                                }
                            >
                                {isDepartmentScopedView
                                    ? 'Remind My Department'
                                    : 'Remind Departments'}
                            </Button>
                        </Popconfirm>
                    }
                />
            )}

            {pendingSmmeConfirmations.map(
                department => (
                    <ReasonRow
                        key={`sme-reminder-${department.departmentId}`}
                        title={`${department.departmentName}: awaiting SME DP confirmation`}
                        detail="Department review is complete; SME confirmation is still required."
                        action={
                            bounceStatus ? (
                                <Tooltip title="This email previously bounced. Update the participant email before retrying.">
                                    <Button
                                        size="small"
                                        shape="round"
                                        icon={<MailOutlined />}
                                        disabled
                                        danger
                                    >
                                        Remind SME
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Popconfirm
                                    title="Send SME reminder?"
                                    description={`This emails the SME to confirm the Developmental Plan for ${department.departmentName}.`}
                                    onConfirm={() =>
                                        handleSendSmmeReminder(
                                            department
                                        )
                                    }
                                    okText="Send"
                                    cancelText="Cancel"
                                >
                                    <Button
                                        size="small"
                                        shape="round"
                                        icon={<MailOutlined />}
                                        loading={
                                            sendingReminderKey ===
                                            `sme-${row.participantId}-${department.departmentId}`
                                        }
                                        disabled={
                                            !!sendingReminderKey
                                        }
                                    >
                                        Remind SME
                                    </Button>
                                </Popconfirm>
                            )
                        }
                    />
                )
            )}

            {row.noServiceReasons.map(reason => (
                <ReasonRow
                    key={reason}
                    tone="error"
                    title={reason}
                />
            ))}

            {row.notes.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap'
                    }}
                >
                    <Text
                        type="secondary"
                        style={{ fontSize: 11 }}
                    >
                        More detail:
                    </Text>

                    {row.notes.map(note => (
                        <Tag
                            key={note}
                            style={{
                                marginInlineEnd: 0,
                                borderRadius: 999
                            }}
                        >
                            {note}
                        </Tag>
                    ))}
                </div>
            )}
        </Space>
    )
}
