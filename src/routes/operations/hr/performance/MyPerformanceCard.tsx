import React from 'react'
import { Button, Card, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { ArrowRightOutlined, CheckCircleFilled, CommentOutlined, FileTextOutlined, WarningOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/hooks/useIsMobile'
import { compactStatus, compactStatusMeta, ratingColor, ratingLabel, type PerformanceCycle } from './ipm'
import { checkInText, reviewText, type Person } from './people'

const { Text, Title } = Typography

/**
 * The employee's own view: where they are in the year, the one thing to do
 * next, and their rating. No tables or filters.
 */
export const MyPerformanceCard: React.FC<{
    person: Person
    cycle: PerformanceCycle
    lineManagerName?: string
    onStep: (person: Person) => void
    onOpenCompact: (person: Person) => void
    onOpenCheckIns: (person: Person) => void
    onOpenPlan: (person: Person) => void
}> = ({ person, cycle, lineManagerName, onStep, onOpenCompact, onOpenCheckIns, onOpenPlan }) => {
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const step = person.step
    const checkIn = checkInText(person.checkIns)
    const status = person.compact ? compactStatus(person.compact.signoff) : null
    const agreed = status === 'agreed' || status === 'hr-checked'

    const journey = [
        { label: 'Compact', value: person.compact ? compactStatusMeta(status || undefined).label : 'Not started', done: agreed },
        { label: 'Last check-in', value: checkIn.text, warn: agreed && checkIn.due },
        { label: 'Mid-year review', value: reviewText(cycle, 'midYear', person.records.midYear), done: !!person.records.midYear?.validation },
        { label: 'Year-end review', value: reviewText(cycle, 'yearEnd', person.records.yearEnd), done: !!person.records.yearEnd?.validation }
    ]

    return (
        <Card style={{ borderRadius: 16 }} styles={{ body: { padding: isMobile ? 16 : 24 } }}>
            <Space direction='vertical' size={18} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <Title level={4} style={{ margin: 0 }}>
                            My performance
                        </Title>
                        <Text type='secondary'>
                            {cycle.label}
                            {lineManagerName ? ` · Line manager: ${lineManagerName}` : ' · No line manager set yet'}
                        </Text>
                    </div>
                    {person.score !== null ? (
                        <Tag color={ratingColor(person.score)} style={{ margin: 0, borderRadius: 999, padding: '4px 12px', fontSize: 14, height: 'fit-content' }}>
                            {person.score.toFixed(2)} · {ratingLabel(person.score)}
                        </Tag>
                    ) : (
                        <Tag style={{ margin: 0, borderRadius: 999, padding: '4px 12px', height: 'fit-content' }}>Not rated yet</Tag>
                    )}
                </div>

                <div
                    style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        background: step?.mine ? token.colorPrimaryBg : token.colorFillQuaternary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap'
                    }}
                >
                    <Space size={10} align='start'>
                        {step ? (
                            step.overdue ? (
                                <WarningOutlined style={{ color: token.colorError, fontSize: 18, marginTop: 2 }} />
                            ) : (
                                <ArrowRightOutlined style={{ color: token.colorPrimary, fontSize: 18, marginTop: 2 }} />
                            )
                        ) : (
                            <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 18, marginTop: 2 }} />
                        )}
                        <div>
                            <Text type='secondary' style={{ fontSize: 12, display: 'block' }}>
                                {step?.mine ? (step.overdue ? 'Your next step · overdue' : 'Your next step') : 'Next step'}
                            </Text>
                            <Text strong>{step ? step.text : 'You are up to date.'}</Text>
                        </div>
                    </Space>
                    {step?.mine && step.target !== 'calibration' && step.target !== 'employees' ? (
                        <Button type='primary' onClick={() => onStep(person)} block={isMobile}>
                            Do it now
                        </Button>
                    ) : null}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
                    {journey.map(item => (
                        <div key={item.label} style={{ padding: '10px 12px', borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}` }}>
                            <Text type='secondary' style={{ fontSize: 12, display: 'block' }}>
                                {item.label}
                            </Text>
                            <Text strong style={{ color: item.warn ? token.colorError : item.done ? token.colorSuccess : undefined }}>
                                {item.value}
                            </Text>
                        </div>
                    ))}
                </div>

                <Space wrap>
                    <Tooltip title={person.compact ? '' : 'Your line manager has not started your compact yet.'}>
                        <Button icon={<FileTextOutlined />} disabled={!person.compact} onClick={() => onOpenCompact(person)}>
                            My compact
                        </Button>
                    </Tooltip>
                    <Button icon={<CommentOutlined />} onClick={() => onOpenCheckIns(person)}>
                        Check-ins
                    </Button>
                    {person.plans.length ? (
                        <Button icon={<WarningOutlined />} onClick={() => onOpenPlan(person)}>
                            Enhancement plan
                        </Button>
                    ) : null}
                </Space>
            </Space>
        </Card>
    )
}
