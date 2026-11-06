import React, { useState } from 'react'
import { Button, Tag, Typography, theme } from 'antd'
import { ArrowRightOutlined, AimOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

/** One SME that needs the person, from ai-backend/attention_list.py. */
export type AttentionItem = {
    participantId: string
    name: string
    level: string | null
    points: number
    why: string[]
    nextStep: string
}
export type Attention = { items: AttentionItem[]; total: number }

export const normaliseAttention = (raw: unknown): Attention | null => {
    const value = raw as Attention | null
    if (!value || !Array.isArray(value.items) || !value.items.length) return null
    const items = value.items.filter(item => item && typeof item.participantId === 'string' && typeof item.nextStep === 'string')
    return items.length ? { items, total: Number(value.total) || items.length } : null
}

const RISK_COLOUR: Record<string, string> = { Critical: 'red', High: 'volcano', Medium: 'gold' }
const SHOWN = 5

/**
 * "Which SMEs need me this week?" as one ranked list under the reply: each SME with why it is
 * there (risk, weak evidence, overdue work, no session) and the one thing to do next.
 */
export const AttentionList: React.FC<{ attention: Attention }> = ({ attention }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    const navigate = useNavigate()
    const [showAll, setShowAll] = useState(false)
    const items = showAll ? attention.items : attention.items.slice(0, SHOWN)
    const more = attention.total - attention.items.length

    return (
        <motion.section
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            aria-label='SMEs that need you'
            style={{
                width: '100%',
                maxWidth: 560,
                padding: '12px 14px',
                borderRadius: 14,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                display: 'grid',
                gap: 10
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AimOutlined style={{ color: token.colorPrimary }} aria-hidden />
                <Text strong style={{ flex: 1 }}>Needs you</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>Most pressing first</Text>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {items.map((item, index) => (
                    <motion.li
                        key={item.participantId}
                        initial={reduced ? false : { opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.18, delay: reduced ? 0 : 0.05 * index }}
                        style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 8, alignItems: 'start' }}
                    >
                        <Text type='secondary' style={{ fontVariantNumeric: 'tabular-nums', paddingTop: 1 }}>{index + 1}.</Text>
                        <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <button
                                    type='button'
                                    onClick={() => navigate(`/participants?sme=${encodeURIComponent(item.participantId)}`)}
                                    style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: token.colorText, cursor: 'pointer', textAlign: 'left' }}
                                >
                                    {item.name}
                                </button>
                                {item.level ? <Tag color={RISK_COLOUR[item.level]} style={{ marginInlineEnd: 0 }}>{item.level}</Tag> : null}
                            </div>
                            {item.why.length ? (
                                <Text type='secondary' style={{ fontSize: 12 }}>{item.why.join(' · ')}</Text>
                            ) : null}
                            <Text style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
                                <ArrowRightOutlined style={{ fontSize: 11, color: token.colorPrimary }} aria-hidden />
                                <span>{item.nextStep}</span>
                            </Text>
                        </div>
                    </motion.li>
                ))}
            </ol>
            {attention.items.length > SHOWN && !showAll ? (
                <Button type='link' size='small' style={{ justifySelf: 'start', padding: 0 }} onClick={() => setShowAll(true)}>
                    Show {attention.items.length - SHOWN} more
                </Button>
            ) : null}
            {more > 0 && (showAll || attention.items.length <= SHOWN) ? (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    And {more} more with smaller issues; ask about a programme or SME to see them.
                </Text>
            ) : null}
        </motion.section>
    )
}

export default AttentionList
