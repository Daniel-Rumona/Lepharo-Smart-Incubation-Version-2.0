import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Dropdown, Empty, Modal, Popover, Segmented, Tag, Tooltip, message } from 'antd'
import {
    CheckCircleFilled,
    CloseCircleFilled,
    EditOutlined,
    FileTextOutlined,
    LockOutlined,
    MessageOutlined,
    MoreOutlined,
    SendOutlined,
    TeamOutlined,
    ThunderboltOutlined,
    UnlockOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    BID_NEXT,
    BID_STAGE_META,
    inviteToOpportunity,
    listInterestsForOpportunity,
    lostReasonMeta,
    matchOpportunity,
    moveBid,
    setOpportunityStatus,
    stageMeta,
    type InterestStatus,
    type MatchResult,
    type Opportunity,
    type OpportunityInterest
} from '@/services/marketLinkage'
import { AwardBidModal, LostBidModal } from './BidModals'

type Props = {
    opportunity: Opportunity
    onEdit: () => void
    onChanged: () => Promise<unknown>
}

type DetailTab = 'matches' | 'pipeline' | 'details'

/** Pipeline order, furthest along first, so live bids sit at the top. */
const PIPELINE_ORDER: InterestStatus[] = ['awarded', 'submitted', 'shortlisted', 'interested', 'invited', 'lost', 'declined', 'withdrawn']

const MOVE_LABEL: Partial<Record<InterestStatus, string>> = {
    shortlisted: 'Shortlist',
    submitted: 'Mark bid submitted',
    awarded: 'Award contract…',
    lost: 'Mark as lost…',
    withdrawn: 'Withdraw'
}

export const closingLabel = (date: Date | null) => {
    if (!date) return 'No closing date'
    const days = dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day')
    const when = dayjs(date).format('D MMM YYYY')
    if (days < 0) return `Closed ${when}`
    if (days === 0) return 'Closes today'
    return `Closes ${when} · ${days} day${days === 1 ? '' : 's'} left`
}

const MatchRow: React.FC<{ match: MatchResult; selected: boolean; onToggle: () => void; interest?: OpportunityInterest }> = ({
    match,
    selected,
    onToggle,
    interest
}) => {
    const notes = match.eligible ? match.strengths : match.gaps
    return (
        <label className={`mlx-match${selected ? ' is-selected' : ''}${interest ? ' is-invited' : ''}`}>
            <Checkbox checked={selected} onChange={onToggle} disabled={!!interest} aria-label={`Select ${match.name}`} />
            <div className='mlx-match-main'>
                <div className='mlx-match-head'>
                    <span className='mlx-match-name'>{match.name}</span>
                    <Tag color={stageMeta(match.stage).color} bordered={false}>{stageMeta(match.stage).label}</Tag>
                    {interest && <Tag color={BID_STAGE_META[interest.status].color} bordered={false}>{BID_STAGE_META[interest.status].label}</Tag>}
                </div>
                {notes.length > 0 && (
                    <ul className={`mlx-notes${match.eligible ? ' is-good' : ' is-gap'}`}>
                        {notes.map(note => (
                            <li key={note}>
                                {match.eligible ? <CheckCircleFilled /> : <CloseCircleFilled />}
                                <span>{note}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <Popover
                trigger={['hover', 'click']}
                placement='left'
                title={`Fit score ${match.score} of 100`}
                content={<FitBreakdown match={match} />}
            >
                {/* A tap here explains the score; it must not also tick the row. */}
                <button type='button' className={`mlx-fit${match.eligible ? ' is-eligible' : ''}`} onClick={e => e.preventDefault()}>
                    <strong>{match.score}</strong>
                    <span>fit</span>
                </button>
            </Popover>
        </label>
    )
}

/** How a fit score was reached. It ranks SMEs; eligibility comes from the requirements alone. */
const FitBreakdown: React.FC<{ match: MatchResult }> = ({ match }) => (
    <div className='mlx-fit-breakdown'>
        {match.scoreParts?.length ? (
            <ul>
                {match.scoreParts.map(part => (
                    <li key={part.label}>
                        <span>{part.label}</span>
                        <strong className={part.points < 0 ? 'is-negative' : undefined}>
                            {part.points > 0 ? `+${part.points}` : part.points}
                        </strong>
                    </li>
                ))}
            </ul>
        ) : (
            <p>Run the match again to see how this score was worked out.</p>
        )}
        <p className='mlx-fit-note'>
            Readiness counts most: Entry 10, Developing 35, Market Ready 60, Preferred Supplier 75. The score only
            ranks SMEs; whether one is eligible depends on the requirements.
        </p>
    </div>
)

export const OpportunityDetail: React.FC<Props> = ({ opportunity: o, onEdit, onChanged }) => {
    const reduceMotion = useReducedMotion()
    const { user } = useFullIdentity()
    const uid = String((user as any)?.uid || (user as any)?.id || '')
    const [awarding, setAwarding] = useState<OpportunityInterest | null>(null)
    const [losing, setLosing] = useState<OpportunityInterest | null>(null)
    const [tab, setTab] = useState<DetailTab>('matches')
    const [matching, setMatching] = useState(false)
    const [inviting, setInviting] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [view, setView] = useState<'eligible' | 'all'>('eligible')
    const [interests, setInterests] = useState<OpportunityInterest[]>([])

    const loadInterests = () =>
        listInterestsForOpportunity(o.id).then(setInterests).catch(e => console.error('[market-linkage] interests', e))

    useEffect(() => {
        setTab('matches')
        setSelected(new Set())
        setView('eligible')
        setInterests([])
        loadInterests()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [o.id])

    // SMEs answer in their own time, so the pipeline refreshes each time it is opened.
    useEffect(() => {
        if (tab === 'pipeline') loadInterests()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])

    const interestById = useMemo(() => new Map(interests.map(i => [i.participantId, i])), [interests])
    const eligibleCount = o.matches.filter(m => m.eligible).length
    const shown = view === 'eligible' ? o.matches.filter(m => m.eligible) : o.matches
    const closed = o.status === 'closed'
    const live = interests.filter(i => ['interested', 'shortlisted', 'submitted', 'awarded'].includes(i.status)).length
    const pipeline = [...interests].sort(
        (a, b) => PIPELINE_ORDER.indexOf(a.status) - PIPELINE_ORDER.indexOf(b.status) || a.participantName.localeCompare(b.participantName)
    )

    const move = async (interest: OpportunityInterest, to: InterestStatus) => {
        if (to === 'awarded') return setAwarding(interest)
        if (to === 'lost') return setLosing(interest)
        try {
            await moveBid(interest.id, to, uid)
            message.success(`${interest.participantName}: ${BID_STAGE_META[to].label.toLowerCase()}.`)
            await loadInterests()
        } catch (e) {
            console.error('[market-linkage] move failed', e)
            message.error('Could not update the bid.')
        }
    }

    const runMatch = async () => {
        setMatching(true)
        try {
            const matches = await matchOpportunity(o.id)
            setSelected(new Set())
            await onChanged()
            message.success(`${matches.filter(m => m.eligible).length} of ${matches.length} SMEs are eligible.`)
        } catch (e: any) {
            message.error(e?.message || 'Matching failed.')
        } finally {
            setMatching(false)
        }
    }

    const toggle = (id: string) =>
        setSelected(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })

    const invite = () => {
        const ids = [...selected]
        const ineligible = ids.filter(id => !o.matches.find(m => m.participantId === id)?.eligible).length
        Modal.confirm({
            title: `Invite ${ids.length} SME${ids.length === 1 ? '' : 's'}?`,
            content: (
                <>
                    <p>Each gets an in-app notification and an email, and a WhatsApp message if they agreed to WhatsApp. They answer on their Opportunities page.</p>
                    {ineligible > 0 && <Alert type='warning' showIcon message={`${ineligible} of them don't meet every requirement yet; their gaps are shown to them.`} />}
                </>
            ),
            okText: 'Send invitations',
            onOk: async () => {
                setInviting(true)
                try {
                    const results = await inviteToOpportunity(o.id, ids)
                    const sent = results.filter(r => r.status === 'invited')
                    message.success(`${sent.length} invited · ${sent.filter(r => r.whatsapp).length} by WhatsApp · ${sent.filter(r => r.email).length} by email`)
                    setSelected(new Set())
                    await Promise.all([loadInterests(), onChanged()])
                } catch (e: any) {
                    message.error(e?.message || 'Invitations failed.')
                } finally {
                    setInviting(false)
                }
            }
        })
    }

    const toggleStatus = async () => {
        await setOpportunityStatus(o.id, closed ? 'open' : 'closed')
        await onChanged()
        message.success(closed ? 'Opportunity reopened.' : 'Opportunity closed.')
    }

    const r = o.requirements
    const ownership = (['black', 'women', 'youth'] as const)
        .filter(k => r.ownership[k] != null)
        .map(k => `${r.ownership[k]}% ${k}-owned`)
    const requirementTags = [
        r.sectors.length ? r.sectors.join(', ') : 'Any sector',
        r.provinces.length ? r.provinces.join(', ') : 'Anywhere',
        ...(r.maxBeeLevel ? [`B-BBEE level ${r.maxBeeLevel} or better`] : []),
        ...ownership,
        ...(r.requireCsd ? ['CSD registered'] : []),
        ...(r.minStage ? [`${stageMeta(r.minStage).label} or above`] : [])
    ]

    const enter = (delay = 0) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24, ease: 'easeOut' as const, delay } }

    const matchesPane = !o.matchedAt ? (
        <div className='mlx-empty'>
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description='See which SMEs in this programme qualify, and what the others are missing.'
            >
                <Button type='primary' icon={<ThunderboltOutlined />} loading={matching} onClick={runMatch} disabled={closed}>
                    Find matching SMEs
                </Button>
            </Empty>
        </div>
    ) : (
        <div className='mlx-pane'>
            <div className='mlx-toolbar'>
                <Segmented
                    block
                    value={view}
                    onChange={v => setView(v as 'eligible' | 'all')}
                    options={[
                        { value: 'eligible', label: `Eligible (${eligibleCount})` },
                        { value: 'all', label: `All (${o.matches.length})` }
                    ]}
                />
            </div>
            {shown.length ? (
                <div className='mlx-matches'>
                    {shown.map(m => (
                        <MatchRow
                            key={m.participantId}
                            match={m}
                            selected={selected.has(m.participantId)}
                            onToggle={() => toggle(m.participantId)}
                            interest={interestById.get(m.participantId)}
                        />
                    ))}
                </div>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='No SME meets every requirement. Switch to All to see what each one is missing.'
                />
            )}
        </div>
    )

    const pipelinePane = interests.length ? (
        <div className='mlx-pane'>
            <div className='mlx-matches'>
                {pipeline.map(i => {
                    const moves = BID_NEXT[i.status]
                    const reason = lostReasonMeta(i.lostReason)
                    return (
                        <div key={i.id} className='mlx-match is-static'>
                            <div className='mlx-match-main'>
                                <div className='mlx-match-head'>
                                    <span className='mlx-match-name'>{i.participantName}</span>
                                    <Tag color={BID_STAGE_META[i.status].color} bordered={false}>{BID_STAGE_META[i.status].label}</Tag>
                                </div>
                                <div className='mlx-meta'>
                                    {[
                                        i.invitedAt && `Invited ${dayjs(i.invitedAt).format('D MMM')}`,
                                        i.respondedAt && `answered ${dayjs(i.respondedAt).format('D MMM')}`,
                                        i.stageChangedAt && `updated ${dayjs(i.stageChangedAt).format('D MMM')}`
                                    ].filter(Boolean).join(' · ')}
                                </div>
                                {i.responseNote && <div className='mlx-quote'>“{i.responseNote}”</div>}
                                {reason && (
                                    <div className='mlx-lost'>
                                        <strong>{reason.label}.</strong> {i.lostNote} <span className='ws-muted'>Suggested: {reason.support}</span>
                                    </div>
                                )}
                            </div>
                            {moves.length > 0 && !closed && (
                                <Dropdown
                                    trigger={['click']}
                                    menu={{
                                        items: moves.map(to => ({
                                            key: to,
                                            label: MOVE_LABEL[to] || BID_STAGE_META[to].label,
                                            danger: to === 'lost',
                                            onClick: () => move(i, to)
                                        }))
                                    }}
                                >
                                    <Button size='small'>Move <MoreOutlined /></Button>
                                </Dropdown>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    ) : (
        <div className='mlx-empty'>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No SMEs invited yet. Select matches and press Invite.' />
        </div>
    )

    const detailsPane = (
        <div className='ws-detail-body'>
            {o.summary && (
                <section>
                    <h4 className='ws-section-title'>Scope of work</h4>
                    <p className='ws-prose'>{o.summary}</p>
                </section>
            )}
            <section>
                <h4 className='ws-section-title'>Who can supply it</h4>
                <div className='mlx-reqs'>
                    {requirementTags.map(text => <Tag key={text} bordered={false}>{text}</Tag>)}
                </div>
            </section>
            {r.documents.length > 0 && (
                <section>
                    <h4 className='ws-section-title'>Documents valid on the closing date</h4>
                    <div className='mlx-reqs'>
                        {r.documents.map(d => <Tag key={d} color='blue' bordered={false}>{d}</Tag>)}
                    </div>
                </section>
            )}
            <section>
                <h4 className='ws-section-title'>Details</h4>
                <dl className='ws-facts'>
                    <div><dt>Buyer</dt><dd>{o.buyer || '—'}</dd></div>
                    <div><dt>Reference</dt><dd>{o.reference || '—'}</dd></div>
                    <div><dt>Value</dt><dd>{o.value || '—'}</dd></div>
                    <div><dt>Location</dt><dd>{o.location || '—'}</dd></div>
                    <div><dt>Closing date</dt><dd>{o.closingDate ? dayjs(o.closingDate).format('D MMM YYYY') : '—'}</dd></div>
                </dl>
            </section>
        </div>
    )

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${o.id}`} className='ws-detail-head mlx-head' {...enter()}>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{o.title}</h2>
                        <div className='ws-detail-sub'>{[o.buyer, o.value].filter(Boolean).join(' · ') || 'No buyer captured'}</div>
                        <div className='ws-detail-tags'>
                            <Tag color={closed ? 'default' : 'success'} bordered={false}>{closed ? 'Closed' : 'Open'}</Tag>
                            <Tag bordered={false}>{closingLabel(o.closingDate)}</Tag>
                            {o.matchSummary && (
                                <Tag color='processing' bordered={false}>{o.matchSummary.eligible} eligible of {o.matchSummary.considered}</Tag>
                            )}
                        </div>
                    </div>
                    {/* In the header so they stay in reach however far down the list you are. */}
                    <div className='mlx-head-actions'>
                        {o.matchedAt && (
                            <Tooltip title={`Matched ${dayjs(o.matchedAt).format('D MMM, HH:mm')}. Run again after records change.`}>
                                <Button icon={<ThunderboltOutlined />} loading={matching} onClick={runMatch} disabled={closed} aria-label='Match again'>
                                    <span className='mlx-btn-text'>Match again</span>
                                </Button>
                            </Tooltip>
                        )}
                        {o.matchedAt && (
                            <Button type='primary' icon={<SendOutlined />} disabled={!selected.size || closed} loading={inviting} onClick={invite}>
                                {selected.size ? `Invite ${selected.size}` : 'Invite'}
                            </Button>
                        )}
                        <Tooltip title='Edit'>
                            <Button shape='circle' icon={<EditOutlined />} onClick={onEdit} aria-label='Edit opportunity' />
                        </Tooltip>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: [
                                    {
                                        key: 'status',
                                        icon: closed ? <UnlockOutlined /> : <LockOutlined />,
                                        label: closed ? 'Reopen opportunity' : 'Close opportunity',
                                        onClick: toggleStatus
                                    }
                                ]
                            }}
                        >
                            <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' />
                        </Dropdown>
                    </div>
                </motion.header>

                <div className='ws-detail-tabs'>
                    <Segmented
                        block
                        className='mlx-tabs'
                        value={tab}
                        onChange={v => setTab(v as DetailTab)}
                        options={[
                            { value: 'matches', label: `Matches${o.matchSummary ? ` (${eligibleCount})` : ''}`, icon: <TeamOutlined /> },
                            { value: 'pipeline', label: `Pipeline${interests.length ? ` (${live})` : ''}`, icon: <MessageOutlined /> },
                            { value: 'details', label: 'Details', icon: <FileTextOutlined /> }
                        ]}
                    />
                    <div className='ws-detail-pane'>
                        <motion.div key={`${o.id}-${tab}`} {...enter(0.06)}>
                            {tab === 'matches' && matchesPane}
                            {tab === 'pipeline' && pipelinePane}
                            {tab === 'details' && detailsPane}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>

            <LostBidModal
                interest={losing}
                uid={uid}
                onClose={() => setLosing(null)}
                onSaved={() => {
                    setLosing(null)
                    loadInterests()
                }}
            />
            <AwardBidModal
                interest={awarding}
                opportunity={o}
                uid={uid}
                onClose={() => setAwarding(null)}
                onSaved={() => {
                    setAwarding(null)
                    loadInterests()
                    onChanged()
                }}
            />
        </div>
    )
}
