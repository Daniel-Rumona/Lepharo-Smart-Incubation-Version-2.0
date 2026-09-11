import React from 'react'
import { Button, Col, DatePicker, Row, Space, TimePicker, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { Timestamp } from 'firebase/firestore'

const { Text } = Typography

export type AppointmentProposalDraft = {
    id: string
    date: Dayjs | null
    startTime: Dayjs | null
    endTime: Dayjs | null
}

export const createAppointmentProposalDraft = (): AppointmentProposalDraft => ({
    id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: null,
    startTime: null,
    endTime: null
})

export const buildAppointmentRescheduleProposals = (
    drafts: AppointmentProposalDraft[]
) => {
    const startedDrafts = drafts.filter(
        draft => draft.date || draft.startTime || draft.endTime
    )

    return startedDrafts.map((draft, index) => {
        if (!draft.date || !draft.startTime || !draft.endTime) {
            throw new Error(`Complete the date, start time and end time for option ${index + 1}.`)
        }

        const start = draft.date
            .hour(draft.startTime.hour())
            .minute(draft.startTime.minute())
            .second(0)
            .millisecond(0)
        const end = draft.date
            .hour(draft.endTime.hour())
            .minute(draft.endTime.minute())
            .second(0)
            .millisecond(0)

        if (!end.isAfter(start)) {
            throw new Error(`The end time for option ${index + 1} must be after its start time.`)
        }
        if (!start.isAfter(dayjs())) {
            throw new Error(`Option ${index + 1} must be in the future.`)
        }

        return {
            id: draft.id,
            date: start.format('YYYY-MM-DD'),
            startTime: Timestamp.fromDate(start.toDate()),
            endTime: Timestamp.fromDate(end.toDate())
        }
    })
}

type Props = {
    value: AppointmentProposalDraft[]
    onChange: (value: AppointmentProposalDraft[]) => void
    maxOptions?: number
}

const AppointmentRescheduleProposalFields: React.FC<Props> = ({
    value,
    onChange,
    maxOptions = 3
}) => {
    const update = (
        id: string,
        patch: Partial<AppointmentProposalDraft>
    ) => onChange(value.map(option => option.id === id ? { ...option, ...patch } : option))

    return (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text strong>Propose alternative times (optional)</Text>
            <Text type="secondary">
                Add up to {maxOptions} suitable date and time options for the facilitator.
            </Text>

            {value.map((option, index) => (
                <Row key={option.id} gutter={[8, 8]} align="middle">
                    <Col xs={24} sm={8}>
                        <DatePicker
                            value={option.date}
                            onChange={date => update(option.id, { date })}
                            disabledDate={date => !!date && date.endOf('day').isBefore(dayjs())}
                            placeholder={`Option ${index + 1} date`}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col xs={11} sm={6}>
                        <TimePicker
                            value={option.startTime}
                            onChange={startTime => update(option.id, { startTime })}
                            format="HH:mm"
                            minuteStep={15}
                            placeholder="Start"
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col xs={11} sm={6}>
                        <TimePicker
                            value={option.endTime}
                            onChange={endTime => update(option.id, { endTime })}
                            format="HH:mm"
                            minuteStep={15}
                            placeholder="End"
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col xs={2} sm={4}>
                        <Button
                            type="text"
                            danger
                            aria-label={`Remove option ${index + 1}`}
                            icon={<DeleteOutlined />}
                            disabled={value.length === 1}
                            onClick={() => onChange(value.filter(item => item.id !== option.id))}
                        />
                    </Col>
                </Row>
            ))}

            {value.length < maxOptions ? (
                <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => onChange([...value, createAppointmentProposalDraft()])}
                >
                    Add another option
                </Button>
            ) : null}
        </Space>
    )
}

export default AppointmentRescheduleProposalFields
