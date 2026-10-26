import { useId } from 'react'
import { motion } from 'framer-motion'
import type { GrowthScoreComponent } from '@twin/rules'
import { usePalette } from './palette'
import { CountUp } from './scene'

const useGlowId = () => useId().replace(/:/g, '')

/**
 * A spark that circles a ring and a pulsing light at the end of its arc. They
 * are HTML layers turned by CSS transforms, so spinning them never redraws the
 * glowing SVG arc underneath.
 */
function RingSparks({ size, radius, fraction, color, delay }: { size: number; radius: number; fraction: number; color: string; delay: number }) {
    const angle = (fraction * 360 - 90) * (Math.PI / 180)
    return (
        <>
            <span className='twin-ring-orbit' style={{ inset: 1, borderColor: color }} aria-hidden />
            <span className='twin-ring-comet' style={{ ['--r' as any]: `${radius}px`, ['--c' as any]: color, width: size, height: size }} aria-hidden>
                <i />
            </span>
            {fraction > 0.01 && (
                <motion.span
                    className='twin-ring-tip'
                    aria-hidden
                    style={{ left: size / 2 + radius * Math.cos(angle), top: size / 2 + radius * Math.sin(angle), ['--c' as any]: color }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: delay + 1.4, duration: 0.4 }}
                />
            )}
        </>
    )
}

function GlowFilter({ id, blur = 3 }: { id: string; blur?: number }) {
    return (
        <filter id={id} x='-50%' y='-50%' width='200%' height='200%'>
            <feGaussianBlur stdDeviation={blur} result='blur' />
            <feMerge>
                <feMergeNode in='blur' />
                <feMergeNode in='SourceGraphic' />
            </feMerge>
        </filter>
    )
}

/** Small glowing progress ring with a counting centre value. */
export function HoloRing({ value, max = 100, size, stroke = 8, color, sublabel }: {
    value: number
    max?: number
    size: number
    stroke?: number
    color: string
    sublabel?: string
}) {
    const glowId = useGlowId()
    const radius = (size - stroke) / 2 - 6
    const circumference = 2 * Math.PI * radius
    const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
    const centre = size / 2
    return (
        <div className='twin-ring' style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <defs><GlowFilter id={glowId} /></defs>
                <circle cx={centre} cy={centre} r={radius} fill='none' stroke={color} strokeOpacity={0.14} strokeWidth={stroke} />
                <motion.circle
                    cx={centre}
                    cy={centre}
                    r={radius}
                    fill='none'
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap='round'
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: circumference * (1 - fraction) }}
                    transition={{ duration: 1.5, ease: 'easeOut', delay: 0.5 }}
                    transform={`rotate(-90 ${centre} ${centre})`}
                    filter={`url(#${glowId})`}
                />
            </svg>
            <RingSparks size={size} radius={radius} fraction={fraction} color={color} delay={0.5} />
            <div className='twin-ring-text'>
                <div className='twin-ring-label' style={{ fontSize: Math.max(16, size * 0.24) }}><CountUp value={value} /></div>
                {sublabel && <div className='twin-ring-sublabel'>{sublabel}</div>}
            </div>
        </div>
    )
}

/** The growth score as four arcs sized by their weights (30/30/20/20). */
export function SegmentRing({ components, total, size = 150, color: colorProp }: { components: GrowthScoreComponent[]; total: number; size?: number; color?: string }) {
    const color = colorProp ?? usePalette().accent.emerald
    const glowId = useGlowId()
    const centre = size / 2
    const radius = size / 2 - 14
    const gapDegrees = 6
    const totalWeight = components.reduce((sum, item) => sum + item.maximum, 0) || 1
    const polar = (angle: number) => {
        const radians = ((angle - 90) * Math.PI) / 180
        return [centre + radius * Math.cos(radians), centre + radius * Math.sin(radians)]
    }
    const arc = (from: number, to: number) => {
        const [x1, y1] = polar(from)
        const [x2, y2] = polar(to)
        return `M ${x1} ${y1} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
    }
    let cursor = 0
    return (
        <div className='twin-ring' style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <defs><GlowFilter id={glowId} /></defs>
                {components.map((component, index) => {
                    const span = (component.maximum / totalWeight) * 360
                    const start = cursor + gapDegrees / 2
                    const end = cursor + span - gapDegrees / 2
                    cursor += span
                    const filled = start + (end - start) * (component.maximum ? component.score / component.maximum : 0)
                    return (
                        <g key={component.key}>
                            <path d={arc(start, end)} fill='none' stroke={color} strokeOpacity={0.14} strokeWidth={10} strokeLinecap='round' />
                            {filled > start + 0.5 && (
                                <motion.path
                                    d={arc(start, filled)}
                                    fill='none'
                                    stroke={color}
                                    strokeWidth={10}
                                    strokeLinecap='round'
                                    filter={`url(#${glowId})`}
                                    initial={{ pathLength: 0 }}
                                    animate={{ pathLength: 1 }}
                                    transition={{ duration: 1.1, delay: 0.5 + index * 0.18, ease: 'easeOut' }}
                                />
                            )}
                        </g>
                    )
                })}
            </svg>
            <RingSparks size={size} radius={radius} fraction={0} color={color} delay={0} />
            <div className='twin-ring-text'>
                <div className='twin-ring-label' style={{ fontSize: size * 0.24 }}><CountUp value={total} /></div>
                <div className='twin-ring-sublabel'>of 100</div>
            </div>
        </div>
    )
}

/** A labelled bar that fills with a glow and a light shimmer running along it. */
export function HoloBar({ label, value, max, detail, color = 'var(--accent)', delay = 0 }: {
    label: string
    value: number
    max: number
    detail?: string
    color?: string
    delay?: number
}) {
    const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
    return (
        <div className='twin-bar'>
            <div className='twin-bar-head'>
                <span>{label}</span>
                <span className='twin-num'>{value}<span className='twin-dim'> / {max}</span></span>
            </div>
            <div className='twin-bar-track'>
                <motion.div
                    className='twin-bar-fill'
                    style={{ background: color, boxShadow: `0 0 12px ${color}` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${fraction * 100}%` }}
                    transition={{ duration: 1.2, delay, ease: 'easeOut' }}
                />
                {fraction > 0 && (
                    <motion.span
                        className='twin-bar-spark'
                        style={{ ['--spark' as any]: color }}
                        initial={{ left: '0%', opacity: 0 }}
                        animate={{ left: `${fraction * 100}%`, opacity: 1 }}
                        transition={{ duration: 1.2, delay, ease: 'easeOut' }}
                    />
                )}
            </div>
            {detail && <div className='twin-bar-detail'>{detail}</div>}
        </div>
    )
}
