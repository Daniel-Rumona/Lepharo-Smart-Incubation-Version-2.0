import React, { useEffect, useMemo, useState } from 'react'
import { theme } from 'antd'

type Props = {
    open: boolean
    onClose: () => void
    /** Accessible name. There is no visible header: the page brings its own close control. */
    ariaLabel?: string
    /** Screen point the page ripples out from, usually the button that opened it. */
    origin?: { x: number; y: number } | null
    /** Already inside a reveal animation (the agent page), so skip our own. */
    inline?: boolean
    children: React.ReactNode
}

const css = `
@keyframes fsr-reveal { from { clip-path: circle(0px at var(--fsr-x) var(--fsr-y)); } to { clip-path: circle(var(--fsr-r) at var(--fsr-x) var(--fsr-y)); } }
@keyframes fsr-hide { from { clip-path: circle(var(--fsr-r) at var(--fsr-x) var(--fsr-y)); } to { clip-path: circle(0px at var(--fsr-x) var(--fsr-y)); } }
@keyframes fsr-fadein { from { opacity:0; } to { opacity:1; } }
@keyframes fsr-wave { 0% { transform: translate(-50%,-50%) scale(0); opacity:.85; } 100% { transform: translate(-50%,-50%) scale(1); opacity:0; } }
.fsr-root { position:fixed; inset:0; z-index:2000; display:flex; flex-direction:column; }
.fsr-root.fsr-enter { animation: fsr-reveal .9s cubic-bezier(.22,.8,.2,1) both; }
.fsr-root.fsr-exit { animation: fsr-hide .5s cubic-bezier(.55,0,.75,.35) both; pointer-events:none; }
.fsr-opening .fsr-body { animation: fsr-fadein .55s .3s both; }
.fsr-body { flex:1 1 auto; min-height:0; overflow-y:auto; }
/* Close buttons inside a full-screen page stay red when hovered or focused. */
.fsr-root .ant-btn-dangerous.mj-close:hover, .fsr-root .ant-btn-dangerous.mj-close:focus-visible { color:#ff7875 !important; border-color:#ff7875 !important; background: rgba(255,77,79,.12) !important; }
.fsr-waves { position:fixed; inset:0; z-index:2001; pointer-events:none; overflow:hidden; }
.fsr-waves i { position:absolute; left:var(--fsr-x); top:var(--fsr-y); width:calc(var(--fsr-r) * 2); height:calc(var(--fsr-r) * 2); border-radius:50%;
  border:2px solid var(--app-accent, #1677ff); box-shadow: 0 0 40px rgba(22,119,255,.25), inset 0 0 40px rgba(22,119,255,.15);
  animation: fsr-wave 1.1s cubic-bezier(.22,.8,.2,1) both; }
.fsr-waves i:nth-child(2) { opacity:.7; animation-delay:.14s; }
.fsr-waves i:nth-child(3) { opacity:.5; animation-delay:.28s; }
@media (prefers-reduced-motion: reduce) {
  .fsr-root.fsr-enter { animation: fsr-fadein .25s both; }
  .fsr-root.fsr-exit { animation: none; opacity:0; }
  .fsr-opening .fsr-body { animation: none; }
  .fsr-waves { display:none; }
}
`

/**
 * Full-screen page that ripples open from where it was triggered and ripples
 * closed again. The page behind it does not scroll or show its scrollbar.
 */
export const FullscreenReveal: React.FC<Props> = ({ open, onClose, ariaLabel, origin, inline = false, children }) => {
    const { token } = theme.useToken()
    const [mounted, setMounted] = useState(open)
    const [opening, setOpening] = useState(false)

    useEffect(() => {
        if (!open) return
        const html = document.documentElement
        const body = document.body
        const previous = { html: html.style.overflow, body: body.style.overflow }
        html.style.overflow = 'hidden'
        body.style.overflow = 'hidden'
        return () => {
            html.style.overflow = previous.html
            body.style.overflow = previous.body
        }
    }, [open])

    useEffect(() => {
        if (inline) {
            setMounted(open)
            return
        }
        if (open) {
            setMounted(true)
            setOpening(true)
            const settle = setTimeout(() => setOpening(false), 1300)
            return () => clearTimeout(settle)
        }
        const unmount = setTimeout(() => setMounted(false), 520)
        return () => clearTimeout(unmount)
    }, [open, inline])

    useEffect(() => {
        if (!open) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    // Where the ripple starts and how far it must travel to cover the page.
    const geo = useMemo(() => {
        const w = window.innerWidth
        const h = window.innerHeight
        const x = origin?.x ?? w / 2
        const y = origin?.y ?? h / 2
        return { x, y, r: Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 16 }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, origin])

    if (!mounted) return null

    const vars = {
        '--fsr-x': `${geo.x}px`,
        '--fsr-y': `${geo.y}px`,
        '--fsr-r': `${geo.r}px`
    } as React.CSSProperties

    return (
        <>
            <style>{css}</style>
            <div
                className={`fsr-root ${inline ? '' : open ? 'fsr-enter' : 'fsr-exit'} ${opening && !inline ? 'fsr-opening' : ''}`}
                role='dialog'
                aria-label={ariaLabel}
                style={{ ...vars, background: token.colorBgContainer, color: token.colorText }}
            >
                <div className='fsr-body'>{children}</div>
            </div>
            {!inline && opening && open ? (
                <div className='fsr-waves' aria-hidden style={vars}>
                    <i />
                    <i />
                    <i />
                </div>
            ) : null}
        </>
    )
}

export default FullscreenReveal
