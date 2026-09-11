import React, { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'
import { CloseOutlined, LeftOutlined, PauseOutlined, CaretRightOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

const DEFAULT_DURATION = 4500
const PROGRESS_STEP_MS = 50

export interface StorySlide {
    key: string
    interactive?: boolean
    pauseOnEnter?: boolean
    duration?: number
    background: string
    render: () => React.ReactNode
}

interface StoryViewerProps {
    slides: StorySlide[]
    height?: number
    onExit?: () => void
}

const StoryViewer: React.FC<StoryViewerProps> = ({ slides, height = 480, onExit }) => {
    const shouldReduceMotion = useReducedMotion()
    const [index, setIndex] = useState(0)
    const [direction, setDirection] = useState(1)
    const [progress, setProgress] = useState(0)
    const [hovering, setHovering] = useState(false)
    const [manuallyPaused, setManuallyPaused] = useState(false)
    const [slidePaused, setSlidePaused] = useState(false)
    const [finished, setFinished] = useState(false)

    const slide = slides[index]
    const duration = slide?.duration ?? DEFAULT_DURATION
    const paused = hovering || manuallyPaused || slidePaused

    useEffect(() => { setSlidePaused(Boolean(slide?.pauseOnEnter)) }, [slide?.key, slide?.pauseOnEnter])

    const goTo = useCallback(
        (next: number, dir: number) => {
            if (next < 0) return
            if (next >= slides.length) {
                setFinished(true)
                setProgress(100)
                return
            }
            setDirection(dir)
            setIndex(next)
            setProgress(0)
        },
        [slides.length]
    )

    const restart = useCallback(() => {
        setDirection(1)
        setIndex(0)
        setProgress(0)
        setFinished(false)
        setManuallyPaused(false)
    }, [])

    useEffect(() => {
        if (paused || finished || shouldReduceMotion) return
        const id = setInterval(() => {
            setProgress(p => {
                const next = p + (PROGRESS_STEP_MS / duration) * 100
                if (next >= 100) {
                    goTo(index + 1, 1)
                    return 100
                }
                return next
            })
        }, PROGRESS_STEP_MS)
        return () => clearInterval(id)
    }, [index, paused, finished, duration, goTo, shouldReduceMotion])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') goTo(index + 1, 1)
            if (e.key === 'ArrowLeft') goTo(index - 1, -1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [index, goTo])

    if (!slide && !finished) return null

    const activeSlide = slides[Math.min(index, slides.length - 1)]

    return (
        <div
            style={{
                position: 'relative',
                height,
                borderRadius: 16,
                overflow: 'hidden',
                userSelect: 'none'
            }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            tabIndex={0}
        >
            <AnimatePresence custom={direction} initial={false}>
                <motion.div
                    key={activeSlide.key}
                    custom={direction}
                    initial={shouldReduceMotion ? undefined : { opacity: 0, x: direction * 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, x: direction * -40 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    style={{
                        position: 'absolute',
                        zIndex: activeSlide.interactive ? 2 : 0,
                        inset: 0,
                        background: activeSlide.background,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '48px 32px',
                        color: '#fff',
                        textAlign: 'center'
                    }}
                >
                    {activeSlide.render()}
                </motion.div>
            </AnimatePresence>

            <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', gap: 4, zIndex: 3 }}>
                {slides.map((s, i) => (
                    <div key={s.key} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.35)', overflow: 'hidden' }}>
                        <div
                            style={{
                                height: '100%',
                                background: '#fff',
                                width: `${i < index || finished ? 100 : i === index ? progress : 0}%`,
                                transition: i === index ? 'none' : 'width .2s ease'
                            }}
                        />
                    </div>
                ))}
            </div>

            <div style={{ position: 'absolute', top: 20, right: 12, display: 'flex', gap: 6, zIndex: 3 }}>
                <Button
                    shape='circle'
                    size='small'
                    ghost
                    aria-label={manuallyPaused || slidePaused ? 'Play story' : 'Pause story'}
                    icon={manuallyPaused || slidePaused ? <CaretRightOutlined /> : <PauseOutlined />}
                    onClick={() => {
                        if (manuallyPaused || slidePaused) {
                            setManuallyPaused(false)
                            setSlidePaused(false)
                        } else setManuallyPaused(true)
                    }}
                    style={{ borderColor: 'rgba(255,255,255,0.6)' }}
                />
                {onExit && (
                    <Button
                        shape='circle'
                        size='small'
                        ghost
                        icon={<CloseOutlined />}
                        onClick={onExit}
                        style={{ borderColor: 'rgba(255,255,255,0.6)' }}
                    />
                )}
            </div>

            <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 1 }}>
                <div style={{ flex: 35, cursor: index > 0 ? 'pointer' : 'default' }} onClick={() => goTo(index - 1, -1)} />
                <div style={{ flex: 65, cursor: 'pointer' }} onClick={() => goTo(index + 1, 1)} />
            </div>

            {index > 0 && !finished && (
                <Button
                    shape='circle'
                    icon={<LeftOutlined />}
                    onClick={() => goTo(index - 1, -1)}
                    style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 3, opacity: 0.85 }}
                />
            )}
            {!finished && (
                <Button
                    shape='circle'
                    icon={<RightOutlined />}
                    onClick={() => goTo(index + 1, 1)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 3, opacity: 0.85 }}
                />
            )}

            {finished && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 4,
                        background: 'rgba(0,0,0,0.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 16
                    }}
                >
                    <div style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>You're all caught up</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <Button icon={<ReloadOutlined />} onClick={restart}>
                            Replay
                        </Button>
                        {onExit && (
                            <Button type='primary' onClick={onExit}>
                                Back to full view
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default StoryViewer
