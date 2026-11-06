import React, { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Modal, Progress, Skeleton, Space, Tag, Typography, message } from 'antd'
import { CheckOutlined, CloseOutlined, FileDoneOutlined, ShopOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { resolveIncubateeParticipantId } from '@/services/devPlanConfirmationService'
import {
    BID_STAGE_META,
    contractTotals,
    formatRand,
    isMilestoneOverdue,
    listMyContracts,
    listMyInterests,
    lostReasonMeta,
    respondToOpportunity,
    type OpportunityInterest,
    type SupplyContract
} from '@/services/marketLinkage'

const { Text, Paragraph, Title } = Typography

const MILESTONE_LABEL = { pending: 'To deliver', delivered: 'Delivered, awaiting payment', paid: 'Paid' } as const

/** Opportunities Lepharo has matched this SME to, where each bid stands, and contracts won. */
const SmeOpportunitiesPage: React.FC = () => {
    const { user } = useFullIdentity()
    const [interests, setInterests] = useState<OpportunityInterest[] | null>(null)
    const [contracts, setContracts] = useState<SupplyContract[]>([])
    const [busy, setBusy] = useState<string>()

    const load = async () => {
        try {
            const participantId = await resolveIncubateeParticipantId(user as any)
            const [mine, won] = participantId
                ? await Promise.all([listMyInterests(participantId), listMyContracts(participantId)])
                : [[], []]
            setInterests(mine)
            setContracts(won)
        } catch (e) {
            console.error('[opportunities] load failed', e)
            setInterests([])
            message.error('Could not load your opportunities.')
        }
    }

    useEffect(() => {
        if (user) load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.email, user?.participantId])

    const answer = (interest: OpportunityInterest, status: 'interested' | 'declined') => {
        let note = ''
        Modal.confirm({
            title: status === 'interested' ? 'Tell Lepharo you are interested?' : 'Pass on this opportunity?',
            content: (
                <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    maxLength={500}
                    placeholder={status === 'interested' ? 'Anything we should know? (optional)' : 'Why not this one? (optional)'}
                    onChange={e => { note = e.target.value }}
                />
            ),
            okText: status === 'interested' ? "I'm interested" : 'Not this time',
            onOk: async () => {
                setBusy(interest.id)
                try {
                    await respondToOpportunity(interest.id, status, note)
                    message.success(status === 'interested' ? 'Thanks, the Market Linkages team will be in touch.' : 'Thanks for letting us know.')
                    await load()
                } catch (e) {
                    console.error('[opportunities] respond failed', e)
                    message.error('Could not save your answer. Please try again.')
                } finally {
                    setBusy(undefined)
                }
            }
        })
    }

    return (
        <div style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
            <Helmet>
                <title>Opportunities</title>
            </Helmet>
            <Title level={4} style={{ marginTop: 0 }}><ShopOutlined /> Opportunities</Title>
            <Paragraph type='secondary'>
                Tenders and buyer requests Lepharo has matched your business to. Let us know which ones you want to go for.
            </Paragraph>

            {interests === null ? (
                <Skeleton active paragraph={{ rows: 5 }} />
            ) : interests.length === 0 ? (
                <Card><Empty description='No opportunities yet. Keep your compliance documents current so you match more often.' /></Card>
            ) : (
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    {interests.map(i => {
                        const o = i.opportunity
                        const closed = !!o.closingDate && dayjs(o.closingDate).endOf('day').isBefore(dayjs())
                        const meta = { label: BID_STAGE_META[i.status].smeLabel, color: BID_STAGE_META[i.status].color }
                        const reason = lostReasonMeta(i.lostReason)
                        return (
                            <Card key={i.id} size='small'>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                    <Text strong style={{ fontSize: 16 }}>{o.title}</Text>
                                    <Tag color={meta.color}>{meta.label}</Tag>
                                </div>
                                <Text type='secondary'>
                                    {[o.buyer, o.value, o.location, o.closingDate && `Closes ${dayjs(o.closingDate).format('D MMM YYYY')}`].filter(Boolean).join(' · ')}
                                </Text>
                                {o.summary && <Paragraph style={{ marginTop: 8, marginBottom: 8 }}>{o.summary}</Paragraph>}
                                {o.documents.length > 0 && (
                                    <div style={{ marginBottom: 8 }}>
                                        <Text type='secondary'>You will need: </Text>
                                        {o.documents.map(d => <Tag key={d} bordered={false}>{d}</Tag>)}
                                    </div>
                                )}
                                {reason && (
                                    <Alert
                                        type='info'
                                        showIcon
                                        style={{ marginBottom: 8 }}
                                        message={`Why it wasn't successful: ${reason.label}`}
                                        description={
                                            <>
                                                {i.lostNote && <div>{i.lostNote}</div>}
                                                <div>Next time: {reason.support}. Ask the Market Linkages team about it.</div>
                                            </>
                                        }
                                    />
                                )}
                                {i.status === 'awarded' && (
                                    <Alert type='success' showIcon style={{ marginBottom: 8 }} message='You won this contract. Its milestones are under My contracts below.' />
                                )}
                                {['invited', 'interested'].includes(i.status) && i.match && !i.match.eligible && i.match.gaps.length > 0 && (
                                    <Alert
                                        type='warning'
                                        showIcon
                                        style={{ marginBottom: 8 }}
                                        message='Sort these out to qualify'
                                        description={<ul style={{ margin: 0, paddingLeft: 18 }}>{i.match.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
                                    />
                                )}
                                {i.status === 'invited' && !closed ? (
                                    <Space wrap>
                                        <Button type='primary' icon={<CheckOutlined />} loading={busy === i.id} onClick={() => answer(i, 'interested')}>
                                            I'm interested
                                        </Button>
                                        <Button icon={<CloseOutlined />} disabled={busy === i.id} onClick={() => answer(i, 'declined')}>
                                            Not this time
                                        </Button>
                                    </Space>
                                ) : closed && i.status === 'invited' ? (
                                    <Text type='secondary'>This opportunity has closed.</Text>
                                ) : null}
                            </Card>
                        )
                    })}
                </Space>
            )}

            {contracts.length > 0 && (
                <>
                    <Title level={5} style={{ marginTop: 24 }}><FileDoneOutlined /> My contracts</Title>
                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                        {contracts.map(c => {
                            const t = contractTotals(c)
                            return (
                                <Card key={c.id} size='small'>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                        <Text strong style={{ fontSize: 16 }}>{c.title}</Text>
                                        <Tag color={c.status === 'active' ? 'processing' : c.status === 'completed' ? 'success' : 'default'}>
                                            {c.status === 'active' ? 'Active' : c.status === 'completed' ? 'Completed' : 'Terminated'}
                                        </Tag>
                                    </div>
                                    <Text type='secondary'>
                                        {[c.buyer, formatRand(c.value), c.endDate && `Ends ${dayjs(c.endDate).format('D MMM YYYY')}`].filter(Boolean).join(' · ')}
                                    </Text>
                                    <Progress
                                        style={{ margin: '8px 0' }}
                                        percent={c.value ? Math.round((t.delivered / c.value) * 100) : 0}
                                        success={{ percent: c.value ? Math.round((t.paid / c.value) * 100) : 0 }}
                                        format={() => `${formatRand(t.paid)} paid`}
                                    />
                                    {c.milestones.map(m => (
                                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                                            <span>
                                                {m.title}
                                                {m.dueDate && <Text type={isMilestoneOverdue(m) ? 'danger' : 'secondary'}> · due {dayjs(m.dueDate).format('D MMM')}</Text>}
                                            </span>
                                            <span>
                                                <Text type='secondary'>{formatRand(m.amount)} </Text>
                                                <Tag bordered={false} color={m.status === 'paid' ? 'success' : m.status === 'delivered' ? 'blue' : 'default'}>
                                                    {MILESTONE_LABEL[m.status]}
                                                </Tag>
                                            </span>
                                        </div>
                                    ))}
                                </Card>
                            )
                        })}
                    </Space>
                </>
            )}
        </div>
    )
}

export default SmeOpportunitiesPage
