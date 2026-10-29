import React from 'react'
import { theme } from 'antd'

/*
 * One loader, three weights, matched to how long and how blocking the wait is:
 *
 *  - Inline (default): page code-split chunks and in-page data waits. A 2px
 *    sweep across the top of the window plus a small track and label in the
 *    content area, in the user's accent colour. Both stay invisible for the
 *    first 300ms, so the common fast load shows nothing at all instead of a
 *    flash.
 *  - Overlay, solid: app-level gates ("Preparing your workspace"). The same
 *    brand moment as the sign-out screen (src/components/auth/signOutScreen.ts):
 *    the Lepharo mark turning slowly, a label, and a sweeping track in brand red.
 *  - Overlay, translucent: blocking saves. The splash over a frosted backdrop so
 *    the page the user was working on stays visible underneath.
 *
 * Pure CSS on purpose: it renders instantly, before any chunk has arrived, and
 * the 300ms delay needs no timers.
 */

const TIMING = {
    /** One rotation of the mark — matches the sign-out screen. */
    turn: 2600,
    /** One pass of a progress sweep. */
    sweep: 1500,
    /** How long an inline loader stays invisible before fading in. */
    inlineDelay: 300,
}

const STYLES = `
.dl-root {
    --dl-brand: #a6201f;
    font-family: inherit;
}
html[data-theme="dark"] .dl-root {
    --dl-brand: #f08a80;
}

/* --- Overlay / splash ---------------------------------------------------- */

.dl-overlay {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: dl-appear 160ms ease-out both;
}
.dl-translucent {
    -webkit-backdrop-filter: blur(6px) saturate(120%);
    backdrop-filter: blur(6px) saturate(120%);
}
.dl-splash {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
}
.dl-mark {
    width: 64px;
    height: 64px;
    animation: dl-turn ${TIMING.turn}ms linear infinite;
}
.dl-splash .dl-label {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
}
.dl-splash .dl-track {
    width: 160px;
}
.dl-splash .dl-bar {
    background: var(--dl-brand);
}

/* --- Inline -------------------------------------------------------------- */

.dl-inline {
    width: 100%;
    min-height: min(50vh, 420px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
}
.dl-inline-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    animation: dl-appear 200ms ease-out ${TIMING.inlineDelay}ms both;
}
.dl-inline .dl-label {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
}
.dl-inline .dl-track {
    width: 96px;
}

/* Window-top sweep: the "something is loading" signal that never moves the
   layout. Sits above the app header. */
.dl-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 1100;
    overflow: hidden;
    pointer-events: none;
    animation: dl-appear 200ms ease-out ${TIMING.inlineDelay}ms both;
}
.dl-topbar .dl-bar {
    width: 30%;
    border-radius: 0 2px 2px 0;
}

/* --- Shared track ---------------------------------------------------------- */

.dl-track {
    position: relative;
    height: 3px;
    border-radius: 999px;
    overflow: hidden;
}
.dl-bar {
    position: absolute;
    inset-block: 0;
    left: 0;
    width: 38%;
    border-radius: 999px;
    animation: dl-sweep ${TIMING.sweep}ms cubic-bezier(.65, 0, .35, 1) infinite;
}

@keyframes dl-turn { to { transform: rotate(360deg); } }
@keyframes dl-sweep {
    0%   { transform: translateX(-110%); }
    100% { transform: translateX(370%); }
}
@keyframes dl-appear {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    /* Keep the meaning, drop the movement: the mark stands still and each
       sweep becomes a static centred segment. The inline delay stays, since it
       is about not flashing, not about motion. */
    .dl-mark { animation: none; }
    .dl-bar { animation: none; left: 31%; }
    .dl-topbar .dl-bar { left: 35%; }
    .dl-overlay { animation: none; }
}
`

export const DashboardLoader: React.FC<{
    label?: string
    /** Cover the whole viewport and block interaction, for app-level gates and saves. */
    overlay?: boolean
    /**
     * Overlay only. 'translucent' frosts over the page instead of replacing it —
     * use it when the user should still see what they were working on (saves).
     */
    backdrop?: 'solid' | 'translucent'
}> = ({ label = 'Just a moment', overlay = false, backdrop = 'solid' }) => {
    const { token } = theme.useToken()

    if (overlay) {
        const translucent = backdrop === 'translucent'
        return (
            <div
                className={translucent ? 'dl-root dl-overlay dl-translucent' : 'dl-root dl-overlay'}
                role='status'
                aria-live='polite'
                aria-busy='true'
                style={{
                    color: token.colorText,
                    background: translucent
                        ? `color-mix(in srgb, ${token.colorBgLayout} 78%, transparent)`
                        : token.colorBgLayout
                }}
            >
                <style>{STYLES}</style>
                <div className='dl-splash'>
                    {/* The bare mark on a transparent ground; precached by the
                        service worker. Dropped rather than shown broken if it
                        ever fails to load. */}
                    <img
                        className='dl-mark'
                        src='/icons/mark.png'
                        alt=''
                        aria-hidden='true'
                        onError={e => e.currentTarget.remove()}
                    />
                    <p className='dl-label'>{label}</p>
                    <div className='dl-track' style={{ background: token.colorFillSecondary }}>
                        <div className='dl-bar' />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className='dl-root dl-inline' role='status' aria-live='polite' aria-busy='true'>
            <style>{STYLES}</style>
            <div className='dl-topbar' aria-hidden='true'>
                <div className='dl-bar' style={{ background: token.colorPrimary }} />
            </div>
            <div className='dl-inline-body'>
                <div className='dl-track' style={{ background: token.colorFillSecondary }}>
                    <div className='dl-bar' style={{ background: token.colorPrimary }} />
                </div>
                <p className='dl-label' style={{ color: token.colorTextSecondary }}>
                    {label}
                </p>
            </div>
        </div>
    )
}

export default DashboardLoader
