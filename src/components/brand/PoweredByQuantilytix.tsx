import React from 'react'
import './PoweredByQuantilytix.css'

/**
 * The Quantilytix "Q" mark: a magnifying glass (lens ring + handle) inside an
 * outer circle that opens around the handle without touching it. Proportions
 * are measured from QuantilytixO.png, whose pixels these coordinates are. One
 * user-space gradient is shared by all three strokes, so the colour sweeps
 * across the whole mark rather than restarting on each piece.
 */
const Q_CX = 885
const Q_CY = 863
const Q_STROKE = 128
const Q_LENS_R = 464
const Q_RING_R = 710
const Q_HANDLE_ANGLE = 42 // degrees, clockwise from 3 o'clock
const Q_GAP = 17 // half-angle of the outer circle's opening around the handle
const qPoint = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [Q_CX + r * Math.cos(a), Q_CY + r * Math.sin(a)].map(n => Math.round(n))
}
const [qArcStartX, qArcStartY] = qPoint(Q_RING_R, Q_HANDLE_ANGLE + Q_GAP)
const [qArcEndX, qArcEndY] = qPoint(Q_RING_R, Q_HANDLE_ANGLE - Q_GAP)
const [qHandleX1, qHandleY1] = qPoint(Q_LENS_R, Q_HANDLE_ANGLE)
const [qHandleX2, qHandleY2] = qPoint(822, Q_HANDLE_ANGLE)

export const QuantilytixQ: React.FC<{ className?: string }> = ({ className = 'qb-q' }) => {
    const id = React.useId().replace(/:/g, '')
    return (
        <svg className={className} viewBox='100 80 1580 1580' aria-hidden='true' focusable='false'>
            <defs>
                <linearGradient id={`${id}g`} gradientUnits='userSpaceOnUse' x1='100' y1='1660' x2='1680' y2='80'>
                    <stop offset='0' className='qb-q-s0' />
                    <stop offset='0.42' className='qb-q-s1' />
                    <stop offset='0.72' className='qb-q-s2' />
                    <stop offset='1' className='qb-q-s3' />
                </linearGradient>
            </defs>
            <g fill='none' stroke={`url(#${id}g)`} strokeWidth={Q_STROKE} strokeLinecap='round'>
                {/* Outer circle, open around the handle (long way round, clockwise). */}
                <path d={`M${qArcStartX} ${qArcStartY}A${Q_RING_R} ${Q_RING_R} 0 1 1 ${qArcEndX} ${qArcEndY}`} />
                <circle cx={Q_CX} cy={Q_CY} r={Q_LENS_R} />
                <line x1={qHandleX1} y1={qHandleY1} x2={qHandleX2} y2={qHandleY2} strokeWidth={Q_STROKE * 1.25} />
            </g>
        </svg>
    )
}

/** "Powered by [Q]uantilytix", with the mark standing in for the first letter. */
export const PoweredByQuantilytix: React.FC<{ className?: string }> = ({ className }) => (
    <span className={className ? `qb-powered ${className}` : 'qb-powered'}>
        Powered by{' '}
        <span className='qb-name'>
            <QuantilytixQ />
            <span className='qb-sr-only'>Q</span>uantilytix
        </span>
    </span>
)

export default PoweredByQuantilytix
