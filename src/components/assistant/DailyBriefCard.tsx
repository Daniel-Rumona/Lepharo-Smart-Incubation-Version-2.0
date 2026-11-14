import React, { useEffect, useState } from 'react'
import { Button, Skeleton, Switch, Typography, message, theme } from 'antd'
import { ArrowRightOutlined, CoffeeOutlined, MessageOutlined, ReloadOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { buildMyBrief, getTodaysBrief, setDailyDigest, type Brief } from '@/services/dailyBriefService'

const { Text } = Typography

type Props = {
    uid: string
    /** From the person's users/ record; changes here are written back to it. */
    digestOn: boolean
    /** Asks the assistant about an item, from the brief. */
    onAsk: (question: string) => void
    /** Inside a popover (AssistantChips): no frame of its own. */
    embedded?: boolean
    onDigestChange?: (on: boolean) => void
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (date: string) => {
    const day = new Date(`${date}T12:00:00Z`)
    return `${DAYS[day.getUTCDay()]}, ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`
}

/**
 * The morning brief on the Data Assistant's welcome screen. With digest on it shows today's brief
 * (built on the spot if the morning run hasn't made one yet); with it off, a one-line offer to
 * switch to one brief instead of separate reminder emails.
 */
export const DailyBriefCard: React.FC<Props> = ({ uid, digestOn, onAsk, embedded, onDigestChange }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    const navigate = useNavigate()
    const [on, setOn] = useState(digestOn)
    const [saving, setSaving] = useState(false)
    const [brief, setBrief] = useState<Brief | null>(null)
    const [loading, setLoading] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => setOn(digestOn), [digestOn])

    const load = async (fresh = false) => {
        setLoading(true)
        setFailed(false)
        try {
            // The morning run's brief if there is one; otherwise build it from what is waiting now.
            const stored = fresh ? null : await getTodaysBrief(uid).catch(() => null)
            setBrief(stored || await buildMyBrief())
        } catch (error) {
            console.warn('Daily brief could not load', error)
            setBrief(null)
            setFailed(true)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (on && uid) void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [on, uid])

    const toggle = async (next: boolean) => {
        setSaving(true)
        try {
            await setDailyDigest(uid, next)
            setOn(next)
            onDigestChange?.(next)
            message.success(next
                ? 'Daily digest is on. Reminders now come in one brief each weekday morning.'
                : 'Daily digest is off. Reminders will be emailed as they happen again.')
        } catch {
            message.error('That setting could not be saved. Try again.')
        } finally {
            setSaving(false)
        }
    }

    const frame: React.CSSProperties = embedded ? { width: 'min(420px, 86vw)', textAlign: 'left' } : {
        width: 'min(640px, 100%)',
        margin: '14px auto 0',
        padding: '14px 16px',
        borderRadius: 16,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        textAlign: 'left'
    }

    if (!on) {
        return (
            <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ ...frame, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <CoffeeOutlined style={{ fontSize: 18, color: token.colorPrimary }} aria-hidden />
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>Get one morning brief instead of reminder emails</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>MOV and development plan reminders arrive together each weekday at 09:30, here and in one email.</Text>
                </div>
                <Switch checked={false} loading={saving} onChange={toggle} aria-label='Turn on daily digest' />
            </motion.div>
        )
    }

    return (
        <motion.section initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={frame} aria-label='Your daily brief'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <CoffeeOutlined style={{ fontSize: 18, color: token.colorPrimary }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>Your brief{brief ? ` · ${longDate(brief.date)}` : ''}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {brief && brief.total ? `${brief.total} thing${brief.total === 1 ? '' : 's'} from your reminders and notifications` : 'Reminders and notifications, together'}
                    </Text>
                </div>
                <Button size='small' type='text' icon={<ReloadOutlined />} loading={loading} onClick={() => void load(true)} aria-label='Refresh the brief' />
                <Switch size='small' checked loading={saving} onChange={toggle} aria-label='Daily digest' />
            </div>

            {loading && !brief ? (
                <Skeleton active title={false} paragraph={{ rows: 3 }} />
            ) : failed ? (
                <Text type='secondary'>
                    Your brief couldn't load right now.{' '}
                    <Button type='link' size='small' style={{ padding: 0 }} onClick={() => void load(true)}>Try again</Button>
                </Text>
            ) : !brief || !brief.total ? (
                <Text type='secondary'>All clear: nothing from your reminders or notifications needs you right now.</Text>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    {brief.sections.map(section => (
                        <div key={section.key}>
                            <Text type='secondary' style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{section.title}</Text>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                                {section.items.map(item => (
                                    <li key={`${item.title}-${item.link}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <button
                                                type='button'
                                                onClick={() => (/^https?:\/\//.test(item.link) ? window.open(item.link, '_blank', 'noopener') : navigate(item.link))}
                                                style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: token.colorText, cursor: 'pointer', textAlign: 'left' }}
                                            >
                                                {item.title} <ArrowRightOutlined style={{ fontSize: 10, color: token.colorPrimary }} />
                                            </button>
                                            {item.detail ? <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>{item.detail}</Text> : null}
                                        </div>
                                        <Button
                                            size='small'
                                            type='text'
                                            icon={<MessageOutlined />}
                                            onClick={() => onAsk(`Tell me more about this from my brief: ${item.title}${item.detail ? ` (${item.detail})` : ''}`)}
                                            aria-label={`Ask about ${item.title}`}
                                            title='Ask the assistant'
                                        />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </motion.section>
    )
}

export default DailyBriefCard
