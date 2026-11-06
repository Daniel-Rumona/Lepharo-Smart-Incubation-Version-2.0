import React, { useEffect, useState } from 'react'
import { Alert, Empty, Skeleton, Space, Tag, Timeline, Typography, theme } from 'antd'
import {
    AimOutlined,
    CheckSquareOutlined,
    FileExclamationOutlined,
    HistoryOutlined,
    RiseOutlined,
    TeamOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { getSessionBrief, suggestSessionFocus, type SessionBrief } from '@/services/sessionCopilotService'

const { Text, Paragraph } = Typography

const RISK_COLOUR: Record<string, string> = { Critical: 'red', High: 'volcano', Medium: 'gold', Low: 'green' }
const TREND_LABEL: Record<string, string> = { up: 'Rising since last check', down: 'Easing since last check', same: 'Steady' }

const money = (value: number | null) =>
    value === null ? '—' : `R ${Math.round(value).toLocaleString('en-ZA')}`

const signed = (value: number | null, suffix = '') =>
    value === null ? null : `${value > 0 ? '+' : ''}${value}${suffix}`

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => {
    const { token } = theme.useToken()
    return (
        <section
            style={{
                padding: '12px 14px',
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer
            }}
        >
            <Text strong style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: token.colorPrimary }}>{icon}</span>
                {title}
            </Text>
            {children}
        </section>
    )
}

const bullets = (items: string[]) => (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map(item => <li key={item} style={{ marginBottom: 2 }}>{item}</li>)}
    </ul>
)

/**
 * The prep brief for one appointment: what was agreed last time, the plan, how the
 * intervention is going, and what else is going on with the SME. Facts come from the
 * sessionBrief function; the "focus today" bullets from the assistant, when it is up.
 */
export const SessionBriefPanel: React.FC<{ appointmentId: string }> = ({ appointmentId }) => {
    const { token } = theme.useToken()
    const [brief, setBrief] = useState<SessionBrief | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [focus, setFocus] = useState<string[] | null>(null)
    const [focusFailed, setFocusFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setBrief(null)
        setError(null)
        setFocus(null)
        setFocusFailed(false)
        getSessionBrief(appointmentId)
            .then(result => {
                if (cancelled) return
                setBrief(result)
                suggestSessionFocus(result)
                    .then(items => { if (!cancelled) setFocus(items) })
                    .catch(() => { if (!cancelled) setFocusFailed(true) })
            })
            .catch((reason: any) => {
                if (!cancelled) setError(reason?.message || 'The brief could not be loaded.')
            })
        return () => { cancelled = true }
    }, [appointmentId])

    if (error) return <Alert type='warning' showIcon message='No brief for this session' description={error} />
    if (!brief) return <Skeleton active paragraph={{ rows: 6 }} />

    const { history, business, risk, compliance } = brief
    const revenueChange = signed(business?.revenueChangePercent ?? null, '%')
    const jobsChange = signed(business?.jobsChange ?? null)

    return (
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
            <section
                style={{
                    padding: '12px 14px',
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorPrimaryBorder}`,
                    background: token.colorPrimaryBg
                }}
            >
                <Text strong style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AimOutlined style={{ color: token.colorPrimary }} /> Focus today
                </Text>
                {focus === null && !focusFailed ? (
                    <Skeleton active title={false} paragraph={{ rows: 2 }} />
                ) : focus?.length ? (
                    bullets(focus)
                ) : (
                    <Text type='secondary'>The assistant couldn&apos;t suggest a focus. The facts below are still current.</Text>
                )}
                <Text type='secondary' style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
                    Suggested by the assistant from the facts below.
                </Text>
            </section>

            {history.openActions.length || history.lastFocus ? (
                <Section icon={<CheckSquareOutlined />} title='Agreed last time'>
                    {history.openActions.length ? bullets(history.openActions) : null}
                    {history.lastFocus ? (
                        <Paragraph style={{ margin: history.openActions.length ? '8px 0 0' : 0 }}>
                            <Text type='secondary'>Planned next: </Text>{history.lastFocus}
                        </Paragraph>
                    ) : null}
                </Section>
            ) : null}

            {brief.session.plannedCoverage.length ? (
                <Section icon={<AimOutlined />} title='Planned for this session'>
                    {bullets(brief.session.plannedCoverage)}
                </Section>
            ) : null}

            <Section icon={<HistoryOutlined />} title={brief.intervention.title || 'This intervention'}>
                <Space size={[6, 6]} wrap style={{ marginBottom: history.previous.length ? 12 : 0 }}>
                    <Tag style={{ borderRadius: 999 }}>{history.attendedCount} of {history.plannedSessions} sessions attended</Tag>
                    {history.noShowCount ? <Tag color='orange' style={{ borderRadius: 999 }}>{history.noShowCount} no-show{history.noShowCount === 1 ? '' : 's'}</Tag> : null}
                    {brief.declinedBefore ? <Tag color='orange' style={{ borderRadius: 999 }}>Declined {brief.declinedBefore} invitation{brief.declinedBefore === 1 ? '' : 's'}</Tag> : null}
                    {brief.intervention.dueDate ? <Tag style={{ borderRadius: 999 }}>Due {dayjs(brief.intervention.dueDate).format('D MMM YYYY')}</Tag> : null}
                </Space>
                {history.previous.length ? (
                    <Timeline
                        style={{ marginBottom: -16 }}
                        items={history.previous.map(session => ({
                            color: session.held ? 'green' : 'gray',
                            children: (
                                <div>
                                    <Text strong>{dayjs(session.date).format('D MMM YYYY')}</Text>
                                    <Text type='secondary'> · {session.held ? (session.attendance === 'no_show' ? 'No-show' : 'Held') : 'Not held'}</Text>
                                    <Paragraph style={{ margin: '2px 0 0' }} ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}>
                                        {session.held ? session.summary || 'No notes recorded.' : session.reasonNotHeld || 'No reason recorded.'}
                                    </Paragraph>
                                </div>
                            )
                        }))}
                    />
                ) : (
                    <Text type='secondary'>This is the first session of this intervention.</Text>
                )}
            </Section>

            {brief.members.length > 1 ? (
                <Section icon={<TeamOutlined />} title={`Who is coming (${brief.members.length})`}>
                    <Space size={[6, 6]} wrap>
                        {brief.members.map(member => (
                            <Tag key={member.name} color={member.riskLevel ? RISK_COLOUR[member.riskLevel] : undefined} style={{ borderRadius: 999 }}>
                                {member.name}{member.riskLevel ? ` · ${member.riskLevel}` : ''}
                            </Tag>
                        ))}
                    </Space>
                </Section>
            ) : (
                <Section icon={<RiseOutlined />} title={brief.sme.name}>
                    <Space direction='vertical' size={8} style={{ width: '100%' }}>
                        {risk?.level ? (
                            <div>
                                <Tag color={RISK_COLOUR[risk.level]} style={{ borderRadius: 999 }}>{risk.level} risk</Tag>
                                {risk.trend && TREND_LABEL[risk.trend] ? <Text type='secondary'>{TREND_LABEL[risk.trend]}</Text> : null}
                                {risk.reasons.length ? <div style={{ marginTop: 4 }}>{bullets(risk.reasons)}</div> : null}
                            </div>
                        ) : null}
                        {business ? (
                            <Text>
                                {dayjs(`${business.month}-01`).format('MMM YYYY')}: revenue {money(business.revenue)}
                                {revenueChange ? <Text type='secondary'> ({revenueChange} on 3 months before)</Text> : null}
                                {business.jobs !== null ? <> · {business.jobs} staff{jobsChange ? <Text type='secondary'> ({jobsChange})</Text> : null}</> : null}
                            </Text>
                        ) : null}
                        {brief.otherInterventions.length ? (
                            <Text><Text type='secondary'>Also receiving: </Text>{brief.otherInterventions.join(', ')}</Text>
                        ) : null}
                        {!risk?.level && !business && !brief.otherInterventions.length ? (
                            <Text type='secondary'>No risk score, business figures or other support on record yet.</Text>
                        ) : null}
                    </Space>
                </Section>
            )}

            {compliance.outstanding ? (
                <Section icon={<FileExclamationOutlined />} title={`Compliance outstanding (${compliance.outstanding})`}>
                    {bullets(compliance.items)}
                    {compliance.outstanding > compliance.items.length ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>and {compliance.outstanding - compliance.items.length} more</Text>
                    ) : null}
                </Section>
            ) : null}

            {!history.previous.length && !compliance.outstanding && !risk && !business ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Not much on record yet for this SME.' />
            ) : null}

            {risk?.level === 'Critical' || risk?.level === 'High' ? (
                <Alert
                    type='warning'
                    showIcon
                    icon={<WarningOutlined />}
                    message='This SME is on the early-warning list'
                    description='Check in on how the business is doing, not just the session plan.'
                />
            ) : null}
        </Space>
    )
}

export default SessionBriefPanel
