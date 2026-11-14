import React, { useEffect, useState } from 'react'
import { Progress, Skeleton, Tag, Typography, theme } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
    loadInterventionCard,
    loadSmeCard,
    type AnswerCard,
    type InterventionCardData,
    type SmeCardData,
    type TimelineEvent
} from '@/services/answerCardData'
import { EVIDENCE_VERDICT, type EvidenceVerdict } from '@/services/evidenceCheckService'

const { Text } = Typography

const RISK_COLOUR: Record<string, string> = { Critical: 'red', High: 'volcano', Medium: 'gold', Low: 'green' }
const TREND: Record<string, string> = { up: 'rising', down: 'easing', same: 'steady' }
const MAX_EVENTS = 6

const initials = (name: string) =>
    name.replace(/\[DEMO\]/g, '').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'S'

const money = (value: number | null) => (value === null ? null : `R ${Math.round(value).toLocaleString('en-ZA')}`)

/** The shared frame: a quiet card under the answer, with one way through to the record. */
const Frame: React.FC<{ index: number; children: React.ReactNode; footer?: React.ReactNode }> = ({ index, children, footer }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    return (
        <motion.section
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: reduced ? 0 : index * 0.08, ease: 'easeOut' }}
            style={{
                width: '100%',
                maxWidth: 440,
                padding: '12px 14px',
                borderRadius: 14,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                display: 'grid',
                gap: 10
            }}
        >
            {children}
            {footer}
        </motion.section>
    )
}

const OpenLink: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => {
    const { token } = theme.useToken()
    return (
        <button
            type='button'
            onClick={onClick}
            style={{
                justifySelf: 'start',
                border: 0,
                background: 'none',
                padding: 0,
                font: 'inherit',
                fontSize: 13,
                color: token.colorPrimary,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
            }}
        >
            {label} <ArrowRightOutlined style={{ fontSize: 11 }} />
        </button>
    )
}

export const SmeCard: React.FC<{ data: SmeCardData; index: number }> = ({ data, index }) => {
    const { token } = theme.useToken()
    const navigate = useNavigate()
    const sub = [data.sector, data.place].filter(Boolean).join(' · ')
    return (
        <Frame index={index} footer={<OpenLink label='Open SME' onClick={() => navigate(`/participants?sme=${encodeURIComponent(data.id)}`)} />}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span
                    aria-hidden
                    style={{
                        width: 40,
                        height: 40,
                        flex: 'none',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 600,
                        fontSize: 14,
                        color: token.colorPrimary,
                        background: token.colorPrimaryBg
                    }}
                >
                    {initials(data.name)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <Text strong style={{ display: 'block' }} ellipsis>{data.name}</Text>
                    {sub ? <Text type='secondary' style={{ fontSize: 12 }}>{sub}</Text> : null}
                </div>
                {data.risk ? (
                    <Tag color={RISK_COLOUR[data.risk.level]} style={{ borderRadius: 999, marginInlineEnd: 0 }}>
                        {data.risk.level} risk{TREND[data.risk.trend] ? `, ${TREND[data.risk.trend]}` : ''}
                    </Tag>
                ) : null}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                {data.business ? (
                    <Fact label={`Revenue, ${dayjs(`${data.business.month}-01`).format('MMM YYYY')}`} value={money(data.business.revenue) || '—'} />
                ) : null}
                {data.business?.jobs !== null && data.business?.jobs !== undefined ? <Fact label='Staff' value={String(data.business.jobs)} /> : null}
                {data.interventions ? <Fact label='Interventions' value={`${data.interventions.active} active · ${data.interventions.completed} done`} /> : null}
            </div>
            {data.risk?.reasons.length ? (
                <Text type='secondary' style={{ fontSize: 12 }}>{data.risk.reasons.join(' · ')}</Text>
            ) : null}
        </Frame>
    )
}

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const { token } = theme.useToken()
    return (
        <div style={{ padding: '6px 8px', borderRadius: 10, background: token.colorFillQuaternary }}>
            <Text type='secondary' style={{ display: 'block', fontSize: 11 }}>{label}</Text>
            <Text strong style={{ fontSize: 13 }}>{value}</Text>
        </div>
    )
}

export const InterventionCard: React.FC<{ data: InterventionCardData; index: number }> = ({ data, index }) => {
    const { token } = theme.useToken()
    const navigate = useNavigate()
    const toneColour: Record<TimelineEvent['tone'], string> = {
        done: token.colorSuccess,
        missed: token.colorError,
        waiting: token.colorWarning,
        planned: token.colorTextQuaternary
    }
    const hidden = Math.max(0, data.events.length - MAX_EVENTS)
    const events = data.events.slice(hidden)
    const evidence = data.evidence && data.evidence in EVIDENCE_VERDICT ? EVIDENCE_VERDICT[data.evidence as EvidenceVerdict] : null
    return (
        <Frame
            index={index}
            footer={data.participantId ? <OpenLink label='Open SME' onClick={() => navigate(`/participants?sme=${encodeURIComponent(data.participantId)}`)} /> : null}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>{data.title}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {[data.smeName, data.dueDate ? `due ${dayjs(data.dueDate).format('D MMM YYYY')}` : null].filter(Boolean).join(' · ')}
                    </Text>
                </div>
                {evidence ? <Tag style={{ borderRadius: 999, marginInlineEnd: 0 }}>{evidence.label}</Tag> : null}
            </div>
            {data.progress !== null ? (
                <Progress percent={Math.round(data.progress)} size='small' showInfo strokeColor={token.colorPrimary} style={{ margin: 0 }} />
            ) : null}
            {events.length ? (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}>
                    {hidden ? (
                        <li style={{ fontSize: 12, color: token.colorTextTertiary, paddingLeft: 20, marginBottom: 4 }}>
                            {hidden} earlier event{hidden === 1 ? '' : 's'}
                        </li>
                    ) : null}
                    {events.map((event, position) => (
                        <li key={event.key} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 8, alignItems: 'start', position: 'relative', paddingBottom: position === events.length - 1 ? 0 : 8 }}>
                            {position < events.length - 1 ? (
                                <span aria-hidden style={{ position: 'absolute', left: 5, top: 12, bottom: 0, width: 2, background: token.colorBorderSecondary }} />
                            ) : null}
                            <span aria-hidden style={{ width: 12, height: 12, marginTop: 4, borderRadius: '50%', background: toneColour[event.tone], boxShadow: `0 0 0 3px ${token.colorBgContainer}`, position: 'relative' }} />
                            <Text style={{ fontSize: 13 }}>{event.label}</Text>
                            <Text type='secondary' style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{event.at ? dayjs(event.at).format('D MMM') : ''}</Text>
                        </li>
                    ))}
                </ol>
            ) : null}
        </Frame>
    )
}

/** Loads one card; a record the viewer can't read, or that no longer exists, shows nothing. */
const CardSlot: React.FC<{ card: AnswerCard; index: number }> = ({ card, index }) => {
    const [state, setState] = useState<{ loading: boolean; sme?: SmeCardData | null; intervention?: InterventionCardData | null }>({ loading: true })
    useEffect(() => {
        let cancelled = false
        const load = card.type === 'sme'
            ? loadSmeCard(card.id).then(sme => ({ loading: false, sme }))
            : loadInterventionCard(card.id).then(intervention => ({ loading: false, intervention }))
        load.catch(() => ({ loading: false })).then(next => { if (!cancelled) setState(next) })
        return () => { cancelled = true }
    }, [card.type, card.id])

    if (state.loading) {
        return (
            <div style={{ width: '100%', maxWidth: 440 }}>
                <Skeleton active avatar={card.type === 'sme'} paragraph={{ rows: 2 }} title={{ width: '50%' }} />
            </div>
        )
    }
    if (state.sme) return <SmeCard data={state.sme} index={index} />
    if (state.intervention) return <InterventionCard data={state.intervention} index={index} />
    return null
}

/** The cards an answer is about, under the reply. */
export const AnswerCards: React.FC<{ cards: AnswerCard[] }> = ({ cards }) => {
    if (!cards.length) return null
    return (
        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
            {cards.map((card, index) => <CardSlot key={`${card.type}-${card.id}`} card={card} index={index} />)}
        </div>
    )
}

export default AnswerCards
