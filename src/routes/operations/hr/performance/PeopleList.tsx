import React from 'react'
import { Avatar, Button, Dropdown, Empty, Space, Table, Tag, Tooltip, Typography, theme } from 'antd'
import { CommentOutlined, FileTextOutlined, MoreOutlined, WarningOutlined } from '@ant-design/icons'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ratingColor, ratingLabel } from './ipm'
import { initialsOf, roleLine, type Person } from './people'

const { Text } = Typography

type Handlers = {
    onStep: (person: Person) => void
    onOpenCompact: (person: Person) => void
    onOpenCheckIns: (person: Person) => void
    onOpenPlan: (person: Person) => void
}

/** Staff (for HR) or a manager's team: who they are, their rating, and the one next step. */
export const PeopleList: React.FC<
    Handlers & {
        people: Person[]
        showLineManager: boolean
        nameOf: (uid?: string | null) => string | undefined
        emptyText: string
        pageSize?: number
    }
> = ({ people, showLineManager, nameOf, emptyText, pageSize = 10, onStep, onOpenCompact, onOpenCheckIns, onOpenPlan }) => {
    const isMobile = useIsMobile()
    const { token } = theme.useToken()

    const rating = (person: Person) =>
        person.score !== null ? (
            <Tooltip title={ratingLabel(person.score)}>
                <Tag color={ratingColor(person.score)} style={{ borderRadius: 999, margin: 0 }}>
                    {person.score.toFixed(2)}
                </Tag>
            </Tooltip>
        ) : (
            <Text type='secondary'>Not rated</Text>
        )

    const step = (person: Person) => {
        if (!person.step) {
            return person.compact ? <Text type='success'>Up to date</Text> : <Text type='secondary'>—</Text>
        }
        const { text, mine, overdue } = person.step
        return (
            <Space size={6} wrap>
                <Button
                    type='link'
                    size='small'
                    onClick={() => onStep(person)}
                    style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left', fontWeight: mine ? 600 : 400, color: mine ? undefined : token.colorText }}
                >
                    {text}
                </Button>
                {overdue ? (
                    <Tag color='red' style={{ borderRadius: 999, margin: 0 }}>
                        Overdue
                    </Tag>
                ) : null}
            </Space>
        )
    }

    const lineManager = (person: Person) =>
        person.lineManagerId ? nameOf(person.lineManagerId) || <Text type='secondary'>Unknown</Text> : <Text type='secondary'>Not set</Text>

    const actions = (person: Person, compactLabel: string) => {
        if (!person.isSelf && !person.canManage) return null
        const selfWithoutCompact = person.isSelf && !person.compact
        return (
            <Space size={6}>
                <Tooltip title={selfWithoutCompact ? 'Your line manager has not started your compact yet.' : ''}>
                    <Button shape='round' icon={<FileTextOutlined />} disabled={selfWithoutCompact} onClick={() => onOpenCompact(person)}>
                        {compactLabel}
                    </Button>
                </Tooltip>
                <Dropdown
                    trigger={['click']}
                    menu={{
                        items: [
                            { key: 'checkins', icon: <CommentOutlined />, label: 'Check-ins', onClick: () => onOpenCheckIns(person) },
                            ...(person.canManage || person.plans.length
                                ? [{ key: 'plan', icon: <WarningOutlined />, label: 'Enhancement plan', onClick: () => onOpenPlan(person) }]
                                : [])
                        ]
                    }}
                >
                    <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' />
                </Dropdown>
            </Space>
        )
    }

    if (isMobile) {
        return (
            <MobileCardList
                data={people}
                getKey={person => person.id}
                emptyText={emptyText}
                pageSize={pageSize}
                renderCard={(person: Person) => ({
                    title: (
                        <Space size={6}>
                            {person.name || '—'}
                            {person.isSelf ? <Tag color='purple' style={{ borderRadius: 999, margin: 0 }}>You</Tag> : null}
                        </Space>
                    ),
                    subtitle: [roleLine(person), person.department].filter(Boolean).join(' · ') || undefined,
                    badge: rating(person),
                    fields: [
                        { label: 'Next step', value: step(person) },
                        ...(showLineManager ? [{ label: 'Line manager', value: lineManager(person) }] : [])
                    ],
                    actions: [<React.Fragment key='actions'>{actions(person, 'Compact')}</React.Fragment>]
                })}
            />
        )
    }

    return (
        <Table
            rowKey='id'
            dataSource={people}
            pagination={people.length > pageSize ? { pageSize, showSizeChanger: false } : false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} /> }}
            columns={[
                {
                    title: 'Employee',
                    key: 'employee',
                    render: (_: unknown, person: Person) => (
                        <Space size={12}>
                            <Avatar style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}>{initialsOf(person.name || person.email)}</Avatar>
                            <Space direction='vertical' size={0}>
                                <Space size={6}>
                                    <Text strong>{person.name || '—'}</Text>
                                    {person.isSelf ? <Tag color='purple' style={{ borderRadius: 999, margin: 0 }}>You</Tag> : null}
                                </Space>
                                <Text type='secondary' style={{ fontSize: 12 }}>
                                    {[roleLine(person), person.department].filter(Boolean).join(' · ')}
                                </Text>
                            </Space>
                        </Space>
                    )
                },
                ...(showLineManager
                    ? [{ title: 'Line manager', key: 'lineManager', width: 180, render: (_: unknown, person: Person) => lineManager(person) }]
                    : []),
                { title: 'Rating', key: 'rating', width: 100, render: (_: unknown, person: Person) => rating(person) },
                { title: 'Next step', key: 'step', render: (_: unknown, person: Person) => step(person) },
                { title: '', key: 'actions', width: 170, align: 'right' as const, render: (_: unknown, person: Person) => actions(person, 'Compact') }
            ]}
        />
    )
}
