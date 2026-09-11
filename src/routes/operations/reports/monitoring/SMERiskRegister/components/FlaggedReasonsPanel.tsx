import { useState } from 'react'
import { Alert, App, Button, Collapse, Popconfirm, Space, Tooltip, Typography } from 'antd'
import { MailOutlined } from '@ant-design/icons'

import { sendDepartmentReminders, sendSmmeReminder } from '../services/reminderService'
import type { BounceStatus, SMERow } from '../types'

const { Title, Text } = Typography

type Props = {
    row: SMERow
    isDepartmentScopedView: boolean
    resolvedProgramId?: string
    scopedDepartmentId?: string
    scopedDepartmentName?: string
    bounceStatus?: BounceStatus
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
    const [sendingReminderKey, setSendingReminderKey] = useState<string | null>(null)

    const handleSendDepartmentReminders = async () => {
        try {
            setSendingReminderKey('departments')
            const data = await sendDepartmentReminders({ resolvedProgramId, scopedDepartmentId, scopedDepartmentName })
            message.success(`Department reminders sent to ${data.sent || 0} recipient(s).`)
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Failed to send department reminders')
        } finally {
            setSendingReminderKey(null)
        }
    }

    const handleSendSmmeReminder = async (department: SMERow['expectedDepartments'][number]) => {
        try {
            const reminderKey = `sme-${row.participantId}-${department.departmentId}`
            setSendingReminderKey(reminderKey)
            await sendSmmeReminder(row, department, resolvedProgramId)
            message.success(`SME reminder sent for ${department.departmentName}.`)
        } catch (error: any) {
            console.error(error)
            message.error(error?.message || 'Failed to send SME reminder')
        } finally {
            setSendingReminderKey(null)
        }
    }

    return (
        <>
            <Title level={5} style={{ marginTop: 0 }}>Why this SME is flagged</Title>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {row.expectedDepartments.some(dep => !dep.deptConfirmed) && (
                    <Alert
                        type="warning"
                        showIcon
                        message={isDepartmentScopedView
                            ? 'Awaiting my department’s Developmental Plan review.'
                            : 'Awaiting department review of the Developmental Plan.'}
                        description={
                            <Space direction="vertical" size={8}>
                                <Text>
                                    {row.expectedDepartments
                                        .filter(dep => !dep.deptConfirmed)
                                        .map(dep => dep.departmentName)
                                        .join(', ')}
                                </Text>
                                <Popconfirm
                                    title="Send department reminders?"
                                    description="This emails departments with pending Developmental Plan reviews."
                                    onConfirm={handleSendDepartmentReminders}
                                    okText="Send"
                                    cancelText="Cancel"
                                >
                                    <Button
                                        size="small"
                                        icon={<MailOutlined />}
                                        loading={sendingReminderKey === 'departments'}
                                        disabled={!!sendingReminderKey}
                                    >
                                        {isDepartmentScopedView ? 'Remind My Department' : 'Remind Departments'}
                                    </Button>
                                </Popconfirm>
                            </Space>
                        }
                    />
                )}

                {row.expectedDepartments
                    .filter(dep => dep.deptConfirmed && !dep.smmeConfirmed)
                    .map(dep => (
                        <Alert
                            key={`sme-reminder-${dep.departmentId}`}
                            type="warning"
                            showIcon
                            message={`${dep.departmentName}: awaiting SME DP confirmation`}
                            description={
                                bounceStatus ? (
                                    <Tooltip title="This email previously bounced (invalid recipient). Update the participant's email before retrying.">
                                        <Button size="small" icon={<MailOutlined />} disabled danger>
                                            Remind SME
                                        </Button>
                                    </Tooltip>
                                ) : (
                                    <Popconfirm
                                        title="Send SME reminder?"
                                        description={`This emails the SME to confirm the Developmental Plan for ${dep.departmentName}.`}
                                        onConfirm={() => handleSendSmmeReminder(dep)}
                                        okText="Send"
                                        cancelText="Cancel"
                                    >
                                        <Button
                                            size="small"
                                            icon={<MailOutlined />}
                                            loading={sendingReminderKey === `sme-${row.participantId}-${dep.departmentId}`}
                                            disabled={!!sendingReminderKey}
                                        >
                                            Remind SME
                                        </Button>
                                    </Popconfirm>
                                )
                            }
                        />
                    ))}

                {row.noServiceReasons.map(reason => (
                    <Alert key={reason} type="error" showIcon message={reason} />
                ))}

                {row.notes.length > 0 && (
                    <Collapse
                        ghost
                        size="small"
                        items={[{
                            key: 'notes',
                            label: <Text type="secondary">{row.notes.length} more detail{row.notes.length === 1 ? '' : 's'}</Text>,
                            children: (
                                <Space direction="vertical" size={4}>
                                    {row.notes.map(note => (
                                        <Text key={note} type="secondary" style={{ fontSize: 12 }}>• {note}</Text>
                                    ))}
                                </Space>
                            )
                        }]}
                    />
                )}
            </Space>
        </>
    )
}
