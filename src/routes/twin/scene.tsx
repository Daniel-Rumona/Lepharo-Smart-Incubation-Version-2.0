import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Counts up to `value` once it changes, like the readouts in the reference video. */
export function useCountUp(value: number, duration = 1400) {
    const [shown, setShown] = useState(prefersReducedMotion() ? value : 0)
    const fromRef = useRef(0)
    useEffect(() => {
        if (prefersReducedMotion()) {
            setShown(value)
            return
        }
        const from = fromRef.current
        const start = performance.now()
        let frame = 0
        const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration)
            const eased = 1 - Math.pow(1 - progress, 3)
            setShown(from + (value - from) * eased)
            if (progress < 1) frame = requestAnimationFrame(tick)
            else fromRef.current = value
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [value, duration])
    return shown
}

const IDLE_DRIFT_AFTER_MS = 20000

/**
 * Tilts a 3D scene a few degrees towards the pointer, eased each frame, then
 * sleeps once settled (rewriting these variables restyles everything under
 * them). With `idleDrift`, a scene nobody has touched for a while starts a slow
 * orbit on its own, like a looping product film, until the pointer moves again.
 */
export function useParallax<T extends HTMLElement>(options: { idleDrift?: boolean } = {}) {
    const ref = useRef<T | null>(null)
    const { idleDrift = false } = options
    useEffect(() => {
        const element = ref.current
        if (!element || prefersReducedMotion()) return
        let targetX = 0
        let targetY = 0
        let currentX = 0
        let currentY = 0
        let frame = 0
        let drifting = false
        let idleTimer = 0
        const tick = (now: number) => {
            if (drifting) {
                // A slow figure-of-eight orbit.
                targetY = Math.sin(now / 5200) * 6
                targetX = Math.sin(now / 8300) * 2.6
            }
            currentX += (targetX - currentX) * (drifting ? 0.03 : 0.08)
            currentY += (targetY - currentY) * (drifting ? 0.03 : 0.08)
            const settled = !drifting && Math.abs(targetX - currentX) < 0.01 && Math.abs(targetY - currentY) < 0.01
            if (settled) {
                currentX = targetX
                currentY = targetY
            }
            element.style.setProperty('--twin-rx', `${currentX.toFixed(2)}deg`)
            element.style.setProperty('--twin-ry', `${currentY.toFixed(2)}deg`)
            frame = settled ? 0 : requestAnimationFrame(tick)
        }
        const wake = () => {
            if (!frame) frame = requestAnimationFrame(tick)
        }
        const armIdle = () => {
            if (!idleDrift) return
            window.clearTimeout(idleTimer)
            idleTimer = window.setTimeout(() => {
                drifting = true
                wake()
            }, IDLE_DRIFT_AFTER_MS)
        }
        const onMove = (event: PointerEvent) => {
            drifting = false
            targetX = Math.round((event.clientY / window.innerHeight - 0.5) * -5 * 20) / 20
            targetY = Math.round((event.clientX / window.innerWidth - 0.5) * 7 * 20) / 20
            wake()
            armIdle()
        }
        // Touch screens have no hover: a tap also stops the orbit and settles the view.
        const onDown = () => {
            if (!drifting) return
            drifting = false
            targetX = 0
            targetY = 0
            wake()
            armIdle()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerdown', onDown)
        armIdle()
        return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerdown', onDown)
            window.clearTimeout(idleTimer)
            cancelAnimationFrame(frame)
        }
    }, [idleDrift])
    return ref
}

/**
 * Mood lighting: one glow per level, crossfaded by the `data-mood` the timeline
 * sets on `.twin-root` as it plays.
 */
export function MoodLight({ className = '' }: { className?: string }) {
    return (
        <div className={`twin-mood ${className}`} aria-hidden>
            <span className='m-low' />
            <span className='m-medium' />
            <span className='m-high' />
            <span className='m-critical' />
        </div>
    )
}

/** Deep space, a moving 3D hex floor, flowing light ribbons and drifting particles. */
export function HoloBackground() {
    return (
        <div className='twin-bg' aria-hidden>
            <div className='twin-bg-glow' />
            <MoodLight />
            <div className='twin-aurora'>
                <span />
                <span />
                <span />
            </div>
            <div className='twin-floor'>
                <div className='twin-floor-grid' />
            </div>
            <svg className='twin-ribbons' viewBox='0 0 1600 900' preserveAspectRatio='none'>
                <defs>
                    <linearGradient id='twin-ribbon-fade' x1='0' x2='1' y1='0' y2='0'>
                        <stop offset='0%' stopColor='#22d3ee' stopOpacity='0' />
                        <stop offset='35%' stopColor='#22d3ee' stopOpacity='0.9' />
                        <stop offset='70%' stopColor='#38bdf8' stopOpacity='0.7' />
                        <stop offset='100%' stopColor='#38bdf8' stopOpacity='0' />
                    </linearGradient>
                </defs>
                {Array.from({ length: 22 }).map((_, index) => {
                    const spread = index * 7
                    return (
                        <path
                            key={index}
                            className='twin-ribbon'
                            style={{ animationDelay: `${-index * 0.45}s`, opacity: 0.12 + (index % 5) * 0.06 }}
                            d={`M-80 ${600 + spread * 0.6} C 260 ${430 + spread}, 560 ${760 - spread}, 860 ${560 + spread * 0.4} S 1380 ${360 + spread}, 1680 ${500 + spread * 0.5}`}
                        />
                    )
                })}
            </svg>
            {Array.from({ length: 48 }).map((_, index) => (
                <span
                    key={index}
                    className={`twin-particle ${index % 5 === 0 ? 'is-gold' : index % 3 === 0 ? 'is-violet' : ''}`}
                    style={{
                        left: `${(index * 37) % 100}%`,
                        top: `${(index * 53) % 100}%`,
                        animationDelay: `${-(index % 11) * 1.1}s`,
                        animationDuration: `${8 + (index % 6) * 2}s`,
                        transform: `scale(${0.6 + (index % 4) * 0.25})`
                    }}
                />
            ))}
            <div className='twin-sweep' />
            <div className='twin-vignette' />
        </div>
    )
}

/** Page-wide magic: a soft light follows the pointer, so the scene answers the person using it. */
export function MagicLayer() {
    const spotRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        if (prefersReducedMotion()) return
        let targetX = window.innerWidth / 2
        let targetY = window.innerHeight / 3
        let x = targetX
        let y = targetY
        let frame = 0
        const move = (event: PointerEvent) => {
            targetX = event.clientX
            targetY = event.clientY
        }
        // Eases the light after the pointer, then sleeps until the pointer moves again.
        const tick = () => {
            x += (targetX - x) * 0.14
            y += (targetY - y) * 0.14
            const settled = Math.abs(targetX - x) < 0.5 && Math.abs(targetY - y) < 0.5
            if (spotRef.current) spotRef.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
            frame = settled ? 0 : requestAnimationFrame(tick)
        }
        const wake = () => {
            if (!frame) frame = requestAnimationFrame(tick)
        }
        window.addEventListener('pointermove', wake)
        window.addEventListener('pointermove', move)
        frame = requestAnimationFrame(tick)
        return () => {
            window.removeEventListener('pointermove', wake)
            window.removeEventListener('pointermove', move)
            cancelAnimationFrame(frame)
        }
    }, [])
    return (
        <div className='twin-magic' aria-hidden>
            <div className='twin-bokeh'>
                {Array.from({ length: 7 }).map((_, index) => <span key={index} />)}
            </div>
            <div className='twin-grain' />
            <div className='twin-spot' ref={spotRef} />
        </div>
    )
}

/**
 * The SME's holographic core: a gyroscope of rotating rings around the
 * needs-attention score, projected from a light beam on the floor.
 */
export function CoreReactor({ score, level, color, caption, live = false, unit = 'needs attention · of 100' }: {
    score: number
    level: string
    color: string
    caption: ReactNode
    /** Follows a playing timeline: shows each value at once instead of counting up to it. */
    live?: boolean
    unit?: string
}) {
    const size = 300
    const radius = 112
    const circumference = 2 * Math.PI * radius
    const fraction = Math.max(0, Math.min(1, score / 100))
    const counted = useCountUp(score, 1800)
    const shown = live ? score : counted

    return (
        <div className='twin-core' style={{ ['--core-color' as any]: color }}>
            {/* A shock ring each time the level changes. */}
            <motion.div
                key={level}
                className='twin-core-flash'
                initial={{ opacity: 0.9, scale: 0.55 }}
                animate={{ opacity: 0, scale: 1.35 }}
                transition={{ duration: 1.1, ease: 'easeOut' }}
            />
            <div className='twin-core-beam' />
            <div className='twin-core-base'>
                <span />
                <span />
                <span />
            </div>
            <div className='twin-gyro'>
                <div className='twin-gyro-ring g1' />
                <div className='twin-gyro-ring g2' />
                <div className='twin-gyro-ring g3' />
                <div className='twin-gyro-ring g4' />
            </div>
            {/* Spinning parts sit on their own layers so the glowing dial is not redrawn as they turn. */}
            <svg className='twin-core-ticks' width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
                <g style={{ stroke: color }}>
                    {Array.from({ length: 72 }).map((_, index) => {
                        const angle = (index / 72) * Math.PI * 2
                        const inner = index % 6 === 0 ? 130 : 134
                        return (
                            <line
                                key={index}
                                x1={size / 2 + Math.cos(angle) * inner}
                                y1={size / 2 + Math.sin(angle) * inner}
                                x2={size / 2 + Math.cos(angle) * 140}
                                y2={size / 2 + Math.sin(angle) * 140}
                            />
                        )
                    })}
                </g>
            </svg>
            <svg className='twin-core-inner' width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
                <circle cx={size / 2} cy={size / 2} r={88} fill='none' stroke={color} strokeWidth={1} strokeDasharray='3 7' />
            </svg>
            <svg className='twin-core-dial' width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={radius} fill='none' stroke={color} strokeOpacity={0.12} strokeWidth={14} />
                {/* The glow is a wide faint stroke under the arc, not a blur filter:
                    the arc moves every day during playback and filters redraw on the CPU. */}
                {[{ width: 30, opacity: 0.18 }, { width: 21, opacity: 0.3 }, { width: 14, opacity: 1 }].map(layer => (
                    <motion.circle
                        key={layer.width}
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill='none'
                        stroke={color}
                        strokeOpacity={layer.opacity}
                        strokeWidth={layer.width}
                        strokeLinecap='round'
                        strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset: circumference * (1 - fraction) }}
                        transition={live ? { duration: 0.3, ease: 'easeOut' } : { duration: 1.8, ease: 'easeOut', delay: 0.4 }}
                        transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    />
                ))}
            </svg>
            <div className='twin-core-readout'>
                <div className='twin-core-value'>{Math.round(shown)}</div>
                <div className='twin-core-of'>{unit}</div>
                <div className='twin-core-level'>{level}</div>
                <div className='twin-core-caption'>{caption}</div>
            </div>
        </div>
    )
}

/**
 * A holographic glass panel in its own colour. It holds still: the time
 * machine above is where the twin moves.
 */
export function HoloPanel({ title, delay = 0, className = '', children, aside, accent, accentTwo }: {
    title: string
    delay?: number
    className?: string
    children: ReactNode
    aside?: ReactNode
    /** The panel's own colour: title, border, corners and highlights. */
    accent?: string
    /** Second colour for the title. */
    accentTwo?: string
}) {
    return (
        <motion.section
            className={`twin-panel ${className}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay }}
            style={{
                ...(accent ? { ['--accent' as any]: accent } : {}),
                ...(accentTwo ? { ['--accent-2' as any]: accentTwo } : {})
            }}
        >
            <div className='twin-panel-inner'>
                <header className='twin-panel-head'>
                    <h2>{title}</h2>
                    {aside}
                </header>
                {children}
            </div>
        </motion.section>
    )
}
