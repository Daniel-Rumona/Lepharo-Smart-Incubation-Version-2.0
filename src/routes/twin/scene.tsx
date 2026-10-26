import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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

export function CountUp({ value, decimals = 0, format }: { value: number; decimals?: number; format?: (value: number) => string }) {
    const shown = useCountUp(value)
    return <>{format ? format(shown) : shown.toFixed(decimals)}</>
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
            <div className='twin-streaks'>
                {Array.from({ length: 7 }).map((_, index) => (
                    <span
                        key={index}
                        style={{
                            top: `${8 + index * 13}%`,
                            animationDelay: `${index * 2.3}s`,
                            animationDuration: `${9 + (index % 3) * 3}s`
                        }}
                    />
                ))}
            </div>
            <div className='twin-sweep' />
            <div className='twin-vignette' />
        </div>
    )
}

/**
 * Page-wide magic: a soft light follows the pointer and every click throws a
 * burst of sparks, so the whole scene answers the person using it.
 */
export function MagicLayer() {
    const spotRef = useRef<HTMLDivElement | null>(null)
    const [bursts, setBursts] = useState<Array<{ id: number; x: number; y: number }>>([])
    useEffect(() => {
        if (prefersReducedMotion()) return
        let targetX = window.innerWidth / 2
        let targetY = window.innerHeight / 3
        let x = targetX
        let y = targetY
        let frame = 0
        let nextId = 0
        const move = (event: PointerEvent) => {
            targetX = event.clientX
            targetY = event.clientY
        }
        const down = (event: PointerEvent) => {
            const id = ++nextId
            setBursts(current => [...current.slice(-4), { id, x: event.clientX, y: event.clientY }])
            window.setTimeout(() => setBursts(current => current.filter(item => item.id !== id)), 900)
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
        window.addEventListener('pointerdown', down)
        frame = requestAnimationFrame(tick)
        return () => {
            window.removeEventListener('pointermove', wake)
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerdown', down)
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
            {bursts.map(burst => (
                <div key={burst.id} className='twin-burst' style={{ left: burst.x, top: burst.y }}>
                    <i />
                    {Array.from({ length: 12 }).map((_, index) => (
                        <span key={index} style={{ ['--a' as any]: `${index * 30}deg` }} />
                    ))}
                </div>
            ))}
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
 * A floating holographic panel: it materialises when scrolled into view, bobs
 * gently, tilts towards the pointer with a moving glare, and a light runs
 * around its border.
 */
export function HoloPanel({ title, delay = 0, className = '', children, aside, accent, accentTwo }: {
    title: string
    delay?: number
    className?: string
    children: ReactNode
    aside?: ReactNode
    /** The panel's own colour: title foil, border light, corners, glare and bars. */
    accent?: string
    /** Second foil colour for the title. */
    accentTwo?: string
}) {
    const tiltRef = useRef<HTMLDivElement | null>(null)
    // The cursor light takes on the colour of the panel it is over.
    const onPointerEnter = () => {
        if (accent) tiltRef.current?.closest<HTMLElement>('.twin-root')?.style.setProperty('--spot', accent)
    }
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const element = tiltRef.current
        if (!element || prefersReducedMotion()) return
        const rect = element.getBoundingClientRect()
        const px = (event.clientX - rect.left) / rect.width
        const py = (event.clientY - rect.top) / rect.height
        element.style.setProperty('--tx', `${((0.5 - py) * 7).toFixed(2)}deg`)
        element.style.setProperty('--ty', `${((px - 0.5) * 9).toFixed(2)}deg`)
        element.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`)
        element.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
    }
    const onPointerLeave = () => {
        tiltRef.current?.style.setProperty('--tx', '0deg')
        tiltRef.current?.style.setProperty('--ty', '0deg')
        tiltRef.current?.closest<HTMLElement>('.twin-root')?.style.removeProperty('--spot')
    }
    return (
        <motion.section
            className={`twin-panel ${className}`}
            initial='hidden'
            whileInView='shown'
            viewport={{ once: true, amount: 0.15 }}
            variants={{
                hidden: { opacity: 0, y: 50, rotateX: -24, filter: 'blur(10px)' },
                shown: { opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)', transition: { duration: 1, delay, ease: [0.16, 1, 0.3, 1] } }
            }}
            style={{
                ['--bob-delay' as any]: `${-delay * 3}s`,
                ...(accent ? { ['--accent' as any]: accent } : {}),
                ...(accentTwo ? { ['--accent-2' as any]: accentTwo } : {})
            }}
        >
            {/* The clip wipe lives on an inner layer: a fully clipped section would never count as in view. */}
            <motion.div
                className='twin-panel-tilt'
                ref={tiltRef}
                onPointerMove={onPointerMove}
                onPointerEnter={onPointerEnter}
                onPointerLeave={onPointerLeave}
                variants={{
                    hidden: { clipPath: 'inset(-10% -10% 110% -10%)' },
                    // Once revealed the clip is dropped: a live clip on a moving layer is costly.
                    shown: {
                        clipPath: 'inset(-10% -10% -10% -10%)',
                        transitionEnd: { clipPath: 'none' },
                        transition: { duration: 1.1, delay: delay + 0.1, ease: [0.16, 1, 0.3, 1] }
                    }
                }}
            >
                {/* The bright edge of the reveal, like a hologram being printed line by line. */}
                <motion.span
                    className='twin-panel-print'
                    aria-hidden
                    variants={{
                        hidden: { top: '0%', opacity: 0 },
                        shown: { top: ['0%', '100%'], opacity: [1, 1, 0], transition: { duration: 1.1, delay: delay + 0.1, ease: [0.16, 1, 0.3, 1] } }
                    }}
                />
                <div className='twin-panel-inner'>
                    <span className='twin-panel-border' aria-hidden />
                    <span className='twin-panel-glare' aria-hidden />
                    <header className='twin-panel-head'>
                        <h2>{title}</h2>
                        {aside}
                    </header>
                    {children}
                </div>
            </motion.div>
        </motion.section>
    )
}
