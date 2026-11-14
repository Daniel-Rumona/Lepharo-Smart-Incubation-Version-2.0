import React, { useEffect, useState } from 'react'
import { Popover, theme } from 'antd'
import { CoffeeOutlined, EyeOutlined, SendOutlined } from '@ant-design/icons'
import { DailyBriefCard } from './DailyBriefCard'
import { WatchesList } from './WatchesList'
import { ChasersList } from './ChasersList'
import { listMyWatches } from '@/services/watchService'
import { listMyChasers, waitingOnYou } from '@/services/chaserService'

type Props = {
    uid: string
    digestOn: boolean
    onAsk: (question: string) => void
    /** May start chasers (the Control Tower's reminder roles). */
    canChase?: boolean
}

/**
 * The morning brief and the person's watches as two small chips on the Data Assistant's welcome
 * screen, each opening in a popover, so the welcome screen stays on one page with the composer in view.
 * Watches and chasers are made by asking in the chat, so their chips only appear once the person has one.
 */
export const AssistantChips: React.FC<Props> = ({ uid, digestOn, onAsk, canChase }) => {
    const { token } = theme.useToken()
    const [open, setOpen] = useState<'brief' | 'watches' | 'chasers' | null>(null)
    const [running, setRunning] = useState<number | null>(null)
    const [chasing, setChasing] = useState<{ running: number; needYou: number } | null>(null)
    // Bumped when the chasers list changes something, so the chip's count follows at once.
    const [changes, setChanges] = useState(0)
    const [digest, setDigest] = useState(digestOn)
    useEffect(() => setDigest(digestOn), [digestOn])

    useEffect(() => {
        listMyWatches()
            .then(watches => setRunning(watches.filter(watch => watch.status === 'active').length))
            .catch(() => setRunning(null))
        if (!canChase) return
        listMyChasers()
            .then(chasers => {
                const active = chasers.filter(chaser => chaser.status === 'active')
                setChasing({ running: active.length, needYou: active.filter(chaser => waitingOnYou(chaser).length).length })
            })
            .catch(() => setChasing(null))
    }, [uid, open, canChase, changes])

    const ask = (question: string) => {
        setOpen(null)
        onAsk(question)
    }

    const chip = (active: boolean): React.CSSProperties => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 999,
        border: `1px solid ${active ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        background: active ? token.colorPrimaryBg : token.colorBgContainer,
        color: token.colorText,
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer'
    })
    const note: React.CSSProperties = { color: token.colorTextSecondary }
    const toggle = (key: 'brief' | 'watches' | 'chasers') => (next: boolean) => setOpen(next ? key : null)

    return (
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <Popover
                trigger='click'
                placement='bottom'
                open={open === 'brief'}
                onOpenChange={toggle('brief')}
                destroyTooltipOnHide
                content={<DailyBriefCard uid={uid} digestOn={digest} onAsk={ask} embedded onDigestChange={setDigest} />}
            >
                <button type='button' style={chip(open === 'brief')} aria-expanded={open === 'brief'}>
                    <CoffeeOutlined style={{ color: token.colorPrimary }} aria-hidden />
                    Morning brief <span style={note}>· {digest ? 'on' : 'off'}</span>
                </button>
            </Popover>
            {running ? <Popover
                trigger='click'
                placement='bottom'
                open={open === 'watches'}
                onOpenChange={toggle('watches')}
                destroyTooltipOnHide
                content={<WatchesList onAsk={ask} embedded />}
            >
                <button type='button' style={chip(open === 'watches')} aria-expanded={open === 'watches'}>
                    <EyeOutlined style={{ color: token.colorPrimary }} aria-hidden />
                    Watches <span style={note}>· {running} running</span>
                </button>
            </Popover> : null}
            {chasing?.running ? <Popover
                trigger='click'
                placement='bottom'
                open={open === 'chasers'}
                onOpenChange={toggle('chasers')}
                destroyTooltipOnHide
                content={<ChasersList onChange={() => setChanges(count => count + 1)} />}
            >
                <button type='button' style={chip(open === 'chasers' || chasing.needYou > 0)} aria-expanded={open === 'chasers'}>
                    <SendOutlined style={{ color: chasing.needYou ? token.colorWarning : token.colorPrimary }} aria-hidden />
                    Chasers <span style={note}>· {chasing.needYou ? `${chasing.needYou} need${chasing.needYou === 1 ? 's' : ''} you` : `${chasing.running} running`}</span>
                </button>
            </Popover> : null}
        </div>
    )
}

export default AssistantChips
