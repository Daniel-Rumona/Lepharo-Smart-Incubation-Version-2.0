import React, { useEffect, useState } from 'react'

/**
 * ------------------------------------------------------------------
 * Why this shape
 * ------------------------------------------------------------------
 * A spinner communicates "wait" but nothing else. This keeps the same
 * job (full-screen blocking overlay, aria-busy, a tip line) but gives
 * the wait a little personality that fits the subject matter: a
 * folder character bouncing while a paper flies in and files itself -
 * literally "your documents are being sorted." Motion is one
 * orchestrated loop (bounce + squash/stretch + shadow + paper arc),
 * not several unrelated effects fighting for attention.
 *
 * Everything is inline SVG + CSS keyframes - no animation library,
 * so it drops in anywhere the old spinner did.
 * ------------------------------------------------------------------
 */

const TIPS = [
    'Please wait…',
    'Sorting the paperwork…',
    'Almost there…',
    'Filing things away…'
]

export const LoadingOverlay: React.FC<{ tip?: string }> = ({
    tip = 'Loading…'
}) => {
    const [tipIndex, setTipIndex] = useState(0)

    useEffect(() => {
        const id = setInterval(() => {
            setTipIndex(i => (i + 1) % TIPS.length)
        }, 2200)
        return () => clearInterval(id)
    }, [])

    return (
        <>
            <style>
                {`
          @keyframes folder-bounce {
            0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
            35%      { transform: translateY(-14px) scaleX(0.97) scaleY(1.04); }
            50%      { transform: translateY(-18px) scaleX(0.95) scaleY(1.06); }
            65%      { transform: translateY(-14px) scaleX(0.97) scaleY(1.04); }
            85%      { transform: translateY(0) scaleX(1.05) scaleY(0.94); }
          }
          @keyframes folder-shadow {
            0%, 100% { transform: scaleX(1); opacity: 0.28; }
            50%      { transform: scaleX(0.72); opacity: 0.16; }
          }
          @keyframes paper-fly {
            0%   { transform: translate(26px, -46px) rotate(18deg); opacity: 0; }
            15%  { opacity: 1; }
            55%  { transform: translate(2px, -6px) rotate(-4deg); opacity: 1; }
            62%  { opacity: 0; }
            100% { opacity: 0; }
          }
          @keyframes blink {
            0%, 92%, 100% { transform: scaleY(1); }
            96%           { transform: scaleY(0.1); }
          }
          @keyframes drift-up {
            0%   { transform: translateY(0) rotate(0deg); opacity: 0; }
            15%  { opacity: 0.55; }
            85%  { opacity: 0; }
            100% { transform: translateY(-70px) rotate(14deg); opacity: 0; }
          }
          @keyframes tip-fade {
            0%   { opacity: 0; transform: translateY(4px); }
            12%  { opacity: 1; transform: translateY(0); }
            88%  { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-4px); }
          }
        `}
            </style>

            <div
                aria-busy="true"
                role="status"
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 900,
                    background: 'rgba(15, 20, 30, 0.55)',
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16
                }}
            >
                <div style={{ display: 'grid', justifyItems: 'center', gap: 14, position: 'relative' }}>

                    {/* drifting background papers */}
                    <div style={{ position: 'absolute', inset: '-40px -60px', pointerEvents: 'none' }}>
                        {[
                            { left: -30, delay: 0 },
                            { left: 90, delay: 0.9 },
                            { left: 40, delay: 1.7 }
                        ].map((p, i) => (
                            <svg
                                key={i}
                                width="14"
                                height="18"
                                viewBox="0 0 14 18"
                                style={{
                                    position: 'absolute',
                                    left: p.left,
                                    bottom: 10,
                                    animation: `drift-up 3.2s ease-in-out ${p.delay}s infinite`
                                }}
                            >
                                <rect x="1" y="1" width="12" height="16" rx="1.5" fill="#ffffff" opacity="0.9" />
                                <line x1="3.5" y1="5" x2="10.5" y2="5" stroke="#c9d3e0" strokeWidth="1" />
                                <line x1="3.5" y1="8" x2="10.5" y2="8" stroke="#c9d3e0" strokeWidth="1" />
                                <line x1="3.5" y1="11" x2="8" y2="11" stroke="#c9d3e0" strokeWidth="1" />
                            </svg>
                        ))}
                    </div>

                    {/* character group: bounces as one unit */}
                    <div style={{ position: 'relative', width: 100, height: 92 }}>
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 6,
                                left: '50%',
                                width: 54,
                                height: 10,
                                marginLeft: -27,
                                borderRadius: '50%',
                                background: '#000',
                                animation: 'folder-shadow 0.9s ease-in-out infinite'
                            }}
                        />

                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                animation: 'folder-bounce 0.9s cubic-bezier(.4,0,.2,1) infinite',
                                transformOrigin: 'bottom center'
                            }}
                        >
                            <svg width="100" height="86" viewBox="0 0 100 86" style={{ overflow: 'visible' }}>
                                {/* back cover */}
                                <path d="M8 26 H60 L70 36 H92 V78 Q92 82 88 82 H12 Q8 82 8 78 Z" fill="#ffb454" />
                                {/* front cover */}
                                <path d="M6 34 H94 L88 80 Q87.3 84 83 84 H17 Q12.7 84 12 80 Z" fill="#ffd27a" />
                                {/* tab */}
                                <path d="M8 26 H40 L46 32 H8 Z" fill="#ffb454" />

                                {/* eyes */}
                                <g style={{ transformOrigin: '38px 52px', animation: 'blink 3.6s ease-in-out infinite' }}>
                                    <circle cx="38" cy="52" r="4.2" fill="#2d2a26" />
                                </g>
                                <g style={{ transformOrigin: '62px 52px', animation: 'blink 3.6s ease-in-out infinite' }}>
                                    <circle cx="62" cy="52" r="4.2" fill="#2d2a26" />
                                </g>

                                {/* smile */}
                                <path d="M42 63 Q50 69 58 63" stroke="#8a5a12" strokeWidth="2.5" fill="none" strokeLinecap="round" />

                                {/* rosy cheeks */}
                                <circle cx="27" cy="59" r="4" fill="#ff9d7a" opacity="0.55" />
                                <circle cx="73" cy="59" r="4" fill="#ff9d7a" opacity="0.55" />
                            </svg>

                            {/* incoming paper, flies in and "files" itself */}
                            <svg
                                width="20"
                                height="26"
                                viewBox="0 0 20 26"
                                style={{
                                    position: 'absolute',
                                    top: 6,
                                    right: 4,
                                    animation: 'paper-fly 1.8s ease-in infinite'
                                }}
                            >
                                <rect x="1" y="1" width="18" height="24" rx="2" fill="#ffffff" stroke="#dfe4ea" />
                                <line x1="4.5" y1="7" x2="15.5" y2="7" stroke="#c9d3e0" strokeWidth="1.4" />
                                <line x1="4.5" y1="12" x2="15.5" y2="12" stroke="#c9d3e0" strokeWidth="1.4" />
                                <line x1="4.5" y1="17" x2="11" y2="17" stroke="#c9d3e0" strokeWidth="1.4" />
                            </svg>
                        </div>
                    </div>

                    <div style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                        <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{tip}</div>
                        <div
                            key={tipIndex}
                            style={{
                                color: 'rgba(255,255,255,0.8)',
                                fontSize: 12,
                                height: 16,
                                animation: 'tip-fade 2.2s ease-in-out'
                            }}
                        >
                            {TIPS[tipIndex]}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default LoadingOverlay
