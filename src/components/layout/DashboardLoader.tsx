import React from 'react'

const STYLES = `
@keyframes dl-ring {
    0%   { transform: scale(0.35); opacity: 0.7; }
    100% { transform: scale(1.25); opacity: 0; }
}
@keyframes dl-orbit {
    to { transform: rotate(360deg); }
}
@keyframes dl-core {
    0%, 100% { transform: scale(0.85); box-shadow: 0 0 0 0 rgba(31,157,143,0.45); }
    50%      { transform: scale(1.05); box-shadow: 0 0 22px 6px rgba(31,157,143,0.35); }
}
@keyframes dl-text {
    0%, 100% { opacity: 0.45; letter-spacing: 0.04em; }
    50%      { opacity: 0.95; letter-spacing: 0.08em; }
}
@keyframes dl-bar {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
    .dl-anim { animation-duration: 6s !important; }
}
`

const ACCENT = '#1f9d8f'
const ACCENT_2 = '#5b8def'

/**
 * Single, shared loading animation for dashboard entry. Used by both the route
 * code-split fallback and the department switcher so the user sees ONE
 * continuous loader instead of a series of different spinners.
 * Pure CSS on purpose: it renders instantly, before any chunk has arrived.
 */
export const DashboardLoader: React.FC<{ label?: string; minHeight?: number | string }> = ({
    label = 'Preparing your dashboard',
    minHeight = '70vh'
}) => (
    <div
        role='status'
        aria-live='polite'
        style={{
            minHeight,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 28
        }}
    >
        <style>{STYLES}</style>

        <div style={{ position: 'relative', width: 120, height: 120 }}>
            {[0, 1, 2].map(i => (
                <span
                    key={i}
                    className='dl-anim'
                    style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: '50%',
                        border: `2px solid ${ACCENT}`,
                        animation: `dl-ring 2.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.8}s infinite`
                    }}
                />
            ))}

            <span
                className='dl-anim'
                style={{
                    position: 'absolute',
                    inset: 8,
                    animation: 'dl-orbit 1.8s linear infinite'
                }}
            >
                <span
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: '50%',
                        width: 10,
                        height: 10,
                        marginLeft: -5,
                        borderRadius: '50%',
                        background: ACCENT_2,
                        boxShadow: `0 0 10px ${ACCENT_2}`
                    }}
                />
            </span>

            <span
                className='dl-anim'
                style={{
                    position: 'absolute',
                    inset: 8,
                    animation: 'dl-orbit 2.8s linear infinite reverse'
                }}
            >
                <span
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: '50%',
                        width: 7,
                        height: 7,
                        marginLeft: -3.5,
                        borderRadius: '50%',
                        background: ACCENT,
                        opacity: 0.8
                    }}
                />
            </span>

            <span
                className='dl-anim'
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: 26,
                    height: 26,
                    margin: -13,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})`,
                    animation: 'dl-core 1.6s ease-in-out infinite'
                }}
            />
        </div>

        <div style={{ textAlign: 'center' }}>
            <div
                className='dl-anim'
                style={{ fontWeight: 600, fontSize: 14, animation: 'dl-text 2s ease-in-out infinite' }}
            >
                {label}
            </div>
            <div
                style={{
                    position: 'relative',
                    width: 140,
                    height: 3,
                    margin: '12px auto 0',
                    borderRadius: 2,
                    overflow: 'hidden',
                    background: 'rgba(128,128,128,0.2)'
                }}
            >
                <span
                    className='dl-anim'
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: '100%',
                        width: '40%',
                        borderRadius: 2,
                        background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})`,
                        animation: 'dl-bar 1.4s ease-in-out infinite'
                    }}
                />
            </div>
        </div>
    </div>
)

export default DashboardLoader
