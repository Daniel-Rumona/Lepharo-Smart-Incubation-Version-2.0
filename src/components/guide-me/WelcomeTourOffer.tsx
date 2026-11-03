import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Typography, theme } from 'antd'
import { CompassOutlined } from '@ant-design/icons'
import { useWelcomeTour, type WelcomeTourKind } from './welcomeTour'

const { Text } = Typography

const COPY: Record<WelcomeTourKind, { title: string; body: string }> = {
    sme: {
        title: 'New here? Take a two-minute tour',
        body: 'See where your interventions, appointments, business numbers and documents live, and what needs you.'
    },
    applicant: {
        title: 'New here? See how applying works',
        body: 'A one-minute tour of finding a programme, your business profile, tracking applications and asking us questions.'
    }
}

// Below this card width the actions stack under the text instead of beside it.
const STACK_BELOW = 560

type WelcomeTourCardProps = {
    kind: WelcomeTourKind
    /** 0 for a fresh start; otherwise the page the tour stopped on. */
    resumeStop: number
    stopCount: number
    onStart: () => void
    onLater: () => void
    onDismiss: () => void
}

/** The look of the offer, apart from the tour state, so it can be previewed. */
export const WelcomeTourCard = ({ kind, resumeStop, stopCount, onStart, onLater, onDismiss }: WelcomeTourCardProps) => {
    const { token } = theme.useToken()
    const ref = useRef<HTMLDivElement>(null)
    const [stacked, setStacked] = useState(false)

    // Sized by the card, not the window: it sits in narrow columns too. Measured
    // before the first paint, so a narrow card never flashes the wide layout.
    useLayoutEffect(() => {
        const element = ref.current
        if (!element) return
        setStacked(element.clientWidth < STACK_BELOW)
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => setStacked(element.clientWidth < STACK_BELOW))
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    const resuming = resumeStop > 0

    const startButton = (
        <Button
            type='primary'
            icon={<CompassOutlined />}
            block={stacked}
            onClick={onStart}
        >
            {resuming ? 'Continue tour' : 'Start tour'}
        </Button>
    )
    const quietButtons = (
        <>
            <Button type='text' size='small' onClick={onLater} style={{ color: token.colorTextSecondary }}>
                Later
            </Button>
            <Button type='text' size='small' onClick={onDismiss} style={{ color: token.colorTextSecondary }}>
                Don&apos;t show again
            </Button>
        </>
    )

    return (
        <div
            ref={ref}
            role='region'
            aria-label='Welcome tour'
            style={{
                display: 'flex',
                flexDirection: stacked ? 'column' : 'row',
                alignItems: stacked ? 'stretch' : 'center',
                gap: stacked ? 14 : 20,
                padding: stacked ? 16 : '16px 20px',
                borderRadius: 14,
                border: `1px solid ${token.colorPrimaryBorder}`,
                background: token.colorPrimaryBg
            }}
        >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                <span
                    aria-hidden
                    style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 40,
                        height: 40,
                        flex: '0 0 auto',
                        borderRadius: 12,
                        fontSize: 20,
                        color: token.colorPrimary,
                        background: token.colorBgContainer
                    }}
                >
                    <CompassOutlined />
                </span>
                <div style={{ minWidth: 0 }}>
                    <Text strong style={{ display: 'block', fontSize: 15, lineHeight: 1.4 }}>
                        {resuming ? 'Carry on with your tour' : COPY[kind].title}
                    </Text>
                    <Text type='secondary' style={{ display: 'block', marginTop: 2, lineHeight: 1.5 }}>
                        {resuming
                            ? `You stopped at page ${resumeStop + 1} of ${stopCount}. Pick up where you left off.`
                            : COPY[kind].body}
                    </Text>
                </div>
            </div>

            {stacked ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {startButton}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Button block onClick={onLater}>Later</Button>
                        <Button block onClick={onDismiss}>Don&apos;t show again</Button>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
                    {quietButtons}
                    <span style={{ width: 8 }} />
                    {startButton}
                </div>
            )}
        </div>
    )
}

/** The card offering a newcomer the welcome tour for where they are, or the rest of it. */
export const WelcomeTourOffer = ({ kind }: { kind: WelcomeTourKind }) => {
    const tour = useWelcomeTour(kind)
    if (!tour.available || !tour.shouldOffer) return null
    return (
        <WelcomeTourCard
            kind={kind}
            resumeStop={tour.resumeStop}
            stopCount={tour.stopCount}
            onStart={() => tour.start(tour.resumeStop)}
            onLater={tour.remindLater}
            onDismiss={tour.dismiss}
        />
    )
}

export default WelcomeTourOffer
