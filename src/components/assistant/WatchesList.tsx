import React, { useEffect, useState } from 'react'
import { Button, Popconfirm, Typography, message, theme } from 'antd'
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { checkWatchNow, endWatch, listMyWatches, type Watch } from '@/services/watchService'

const { Text } = Typography

const EXAMPLE = 'Tell me when any SME goes High risk with no session booked'
const STATUS_TEXT: Record<Watch['status'], string> = { active: '', done: 'Done', ended: 'Ended', expired: 'Expired' }
const RECENT_DAYS = 14

/**
 * The person's watches on the Data Assistant's welcome screen: what each is watching, the last
 * thing it found, and a way to end it. With none yet, one line on how to ask for one.
 */
export const WatchesList: React.FC<{ onAsk: (question: string) => void; refreshKey?: number; embedded?: boolean }> = ({ onAsk, refreshKey, embedded }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    const navigate = useNavigate()
    const [watches, setWatches] = useState<Watch[] | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    const load = () => listMyWatches().then(setWatches).catch(() => setWatches([]))
    useEffect(() => { void load() }, [refreshKey])

    // Running watches, plus ones that finished recently so their result isn't lost.
    const shown = (watches || []).filter(watch =>
        watch.status === 'active' || (watch.firings[0] && dayjs().diff(watch.firings[0].at, 'day') <= RECENT_DAYS))

    const end = async (id: string) => {
        setBusy(id)
        try {
            await endWatch(id)
            await load()
        } catch {
            message.error('That watch could not be ended. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const check = async (id: string) => {
        setBusy(id)
        try {
            const result = await checkWatchNow(id)
            message.info(result.fired ? 'Found something: it is in your notifications.' : 'Nothing new right now.')
            await load()
        } catch {
            message.error('That watch could not be checked. Try again.')
        } finally {
            setBusy(null)
        }
    }

    if (watches === null) return null

    // Inside a popover (AssistantChips) it has no frame of its own.
    const frame: React.CSSProperties = embedded ? { width: 'min(420px, 86vw)', textAlign: 'left' } : {
        width: 'min(640px, 100%)',
        margin: '10px auto 0',
        padding: '12px 16px',
        borderRadius: 16,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        textAlign: 'left'
    }

    if (!shown.length) {
        return (
            <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ ...frame, display: 'flex', alignItems: 'center', gap: 12 }}>
                <EyeOutlined style={{ fontSize: 18, color: token.colorPrimary }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ display: 'block' }}>Ask me to watch something</Text>
                    <button
                        type='button'
                        onClick={() => onAsk(EXAMPLE)}
                        style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 12, color: token.colorTextSecondary, cursor: 'pointer', textAlign: 'left' }}
                    >
                        “{EXAMPLE}” — I check every morning and tell you when it happens.
                    </button>
                </div>
            </motion.div>
        )
    }

    return (
        <motion.section initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={frame} aria-label='Your watches'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <EyeOutlined style={{ fontSize: 18, color: token.colorPrimary }} aria-hidden />
                <Text strong style={{ flex: 1 }}>Your watches</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>Checked every morning</Text>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {shown.map(watch => {
                    const last = watch.firings[0]
                    return (
                        <li key={watch.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ display: 'block' }}>
                                    {watch.description}
                                    {STATUS_TEXT[watch.status] ? <Text type='secondary'> · {STATUS_TEXT[watch.status]}</Text> : null}
                                </Text>
                                {last ? (
                                    <button
                                        type='button'
                                        onClick={() => navigate(last.link || '/')}
                                        style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 12, color: token.colorPrimary, cursor: 'pointer', textAlign: 'left' }}
                                    >
                                        {dayjs(last.at).format('D MMM')}: {last.title.replace(/^Watch: /, '')}
                                    </button>
                                ) : (
                                    <Text type='secondary' style={{ display: 'block', fontSize: 12 }}>
                                        Nothing yet{watch.endsAt ? ` · runs until ${dayjs(watch.endsAt).format('D MMM')}` : ''}
                                    </Text>
                                )}
                            </div>
                            {watch.status === 'active' ? (
                                <>
                                    <Button size='small' type='text' icon={<ReloadOutlined />} loading={busy === watch.id} onClick={() => void check(watch.id)} aria-label='Check now' title='Check now' />
                                    <Popconfirm title='End this watch?' okText='End it' cancelText='Keep' onConfirm={() => end(watch.id)}>
                                        <Button size='small' type='text' disabled={busy === watch.id}>End</Button>
                                    </Popconfirm>
                                </>
                            ) : null}
                        </li>
                    )
                })}
            </ul>
        </motion.section>
    )
}

export default WatchesList
