import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { RiskLevel } from '@twin/rules'

export type SkylinePoint = { day: number; score: number; level: RiskLevel }
export type SkylineBeacon = { key: string; day: number; color: string }
/** A push-in request: the camera moves close to `day`, holds, then eases back. */
export type SkylineFocus = { key: number; day: number }
export type SkylineHandle = {
    place: (position: number) => void
    /** Where the top of the column under `position` sits on screen right now. */
    anchor: (position: number) => { x: number; y: number } | null
}

// A small perspective scene: world x runs along the days, y is height, z is
// depth away from the viewer. Projecting by hand (instead of CSS 3D) keeps
// every bar a crisp solid box, and lets a virtual camera move through the
// scene like a film camera: a crane up at the start, a push-in on danger.
const VIEW_H = 380
const FOCAL = 760
const HORIZON_Y = 84
const BAR_MAX = 300
const MARGIN_X = 26
const FRONT_Z = 0
const GHOST_Z = 70
const FAR_Z = 360

// Cinematography, in milliseconds.
export const INTRO_MS = 3000
const RISE_DELAY_MS = 250
const RISE_SPREAD_MS = 1500
const RISE_MS = 700
const PUSH_IN_MS = 450
const PUSH_HOLD_MS = 450
const PUSH_OUT_MS = 950
const PUSH_MS = PUSH_IN_MS + PUSH_HOLD_MS + PUSH_OUT_MS
const MORPH_MS = 750

/** Where the camera stands: looking at world x, from eye height, this far back. */
type Camera = { x: number; eyeY: number; distance: number }
type Box = { day: number; x0: number; x1: number; z0: number; z1: number; h: number; color: string }
/** Scores easing from old values to new ones after a what-if change. */
type Morph = { key: string; start: number; from: Map<number, number>; to: Map<number, number> }
/** `hold` is set once released: the camera eases back from there instead of from close up. */
type Push = { start: number; from: Camera; day: number; hold?: Camera }

const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
/** Rises slightly past the target and settles, like a column landing. */
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)
const lerpCamera = (a: Camera, b: Camera, t: number): Camera => ({
    x: lerp(a.x, b.x, t),
    eyeY: lerp(a.eyeY, b.eyeY, t),
    distance: lerp(a.distance, b.distance, t)
})

function morphedScores(morph: Morph, now: number, ms: number) {
    const t = ms > 0 ? easeInOutCubic(clamp01((now - morph.start) / ms)) : 1
    const scores = new Map<number, number>()
    morph.to.forEach((to, day) => scores.set(day, lerp(morph.from.get(day) ?? to, to, t)))
    return scores
}

const scoreKey = (points: SkylinePoint[]) => points.map(point => `${point.day}:${point.score}`).join('|')

/** Projection for a scene `viewW` units wide, seen from `camera`. */
function makeProjector(viewW: number, camera: Camera) {
    const project = (x: number, y: number, z: number): [number, number] => {
        const k = FOCAL / (z + camera.distance)
        return [viewW / 2 + (x - camera.x) * k, HORIZON_Y + (camera.eyeY - y) * k]
    }
    const poly = (points: Array<[number, number, number]>) =>
        points.map(([x, y, z]) => project(x, y, z).map(value => value.toFixed(1)).join(',')).join(' ')
    const boxFaces = (box: Box) => {
        const { x0, x1, z0, z1, h } = box
        // The side facing the camera is the one towards its line of sight.
        const sideX = (x0 + x1) / 2 < camera.x ? x1 : x0
        return {
            front: poly([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]]),
            side: poly([[sideX, 0, z0], [sideX, 0, z1], [sideX, h, z1], [sideX, h, z0]]),
            top: poly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]])
        }
    }
    return { project, poly, boxFaces }
}

const gradientId = (color: string) => `sk-${color.replace('#', '')}`

/**
 * One glowing 3D column per day on a holographic floor, with a light ribbon
 * over the bar tops, event beacons, and a scanner sheet the timeline moves
 * every frame through the `place` handle.
 *
 * Cinematography: on first show the camera cranes up and back while the
 * columns rise in a wave; a `focus` request pushes the camera in on a day and
 * eases back; when the scores change (a what-if), columns morph to their new
 * heights. A small clock redraws only while one of these is running.
 */
export const Skyline = forwardRef<SkylineHandle, {
    frames: SkylinePoint[]
    ghost: SkylinePoint[] | null
    pastDays: number
    day: number
    colorFor: (point: SkylinePoint) => string
    scannerColor: string
    beacons: SkylineBeacon[]
    onSeek: (day: number) => void
    /** Stage width over height, so the scene fills phones and wide screens alike. */
    aspect?: number
    /** False honours reduced motion: no opening shot, push-ins or morphing. */
    motion?: boolean
    /** A new key pushes the camera in; null sends it back early. */
    focus?: SkylineFocus | null
    /** Called once the opening shot has finished (at once without motion). */
    onIntroDone?: () => void
    /** Called after every redraw, so anything pinned to the scene can follow the camera. */
    onCameraMove?: () => void
}>(function Skyline(props, ref) {
    const {
        frames, ghost, pastDays, day, colorFor, scannerColor, beacons, onSeek,
        aspect = 3.7, motion = true, focus = null, onIntroDone, onCameraMove
    } = props
    const viewW = Math.round(Math.max(600, Math.min(1700, VIEW_H * aspect)))
    const count = Math.max(1, frames.length)
    const slot = (viewW - MARGIN_X * 2) / count
    const width = Math.max(2.5, slot * 0.56)
    const depth = Math.min(16, width)
    const centreX = (value: number) => MARGIN_X + (value + pastDays + 0.5) * slot
    const height = (score: number) => Math.max(2, (score / 100) * BAR_MAX)

    /* ------------------------------------------------ animation clock */
    const [, setClock] = useState(0)
    const [introStart] = useState(() => performance.now())
    const introPending = useRef(motion)
    const frameRef = useRef(0)
    const pushRef = useRef<Push | null>(null)
    const lastFocusKey = useRef<number | null>(focus?.key ?? null)
    const morphRef = useRef<Morph | null>(null)
    const ghostMorphRef = useRef<Morph | null>(null)
    const callbacks = useRef({ onIntroDone, onCameraMove })
    callbacks.current = { onIntroDone, onCameraMove }

    const busy = (at: number) =>
        introPending.current ||
        (!!pushRef.current && at - pushRef.current.start < PUSH_MS) ||
        (!!morphRef.current && at - morphRef.current.start < MORPH_MS) ||
        (!!ghostMorphRef.current && at - ghostMorphRef.current.start < MORPH_MS)
    const busyRef = useRef(busy)
    busyRef.current = busy

    // After each render: if something has started moving, run the clock until it stops.
    useEffect(() => {
        if (frameRef.current || !busy(performance.now())) return
        const step = (at: number) => {
            frameRef.current = 0
            if (introPending.current && at - introStart >= INTRO_MS) {
                introPending.current = false
                callbacks.current.onIntroDone?.()
            }
            setClock(at)
            if (busyRef.current(at)) frameRef.current = requestAnimationFrame(step)
        }
        frameRef.current = requestAnimationFrame(step)
    })
    useEffect(() => {
        if (!motion) callbacks.current.onIntroDone?.()
        return () => {
            cancelAnimationFrame(frameRef.current)
            // Forget the cancelled frame, or a remount (StrictMode mounts twice in
            // development) would think the clock is still running and never restart it.
            frameRef.current = 0
        }
    }, [])

    /* ------------------------------------------------ this frame */
    const now = performance.now()
    const introT = motion ? clamp01((now - introStart) / INTRO_MS) : 1
    const introActive = introT < 1
    // Just after the opening shot, columns ease into their played and ahead states.
    const settling = motion && !introActive && now - introStart < INTRO_MS + 1200

    // Scores morph to new values when a what-if changes them.
    const frontKey = scoreKey(frames)
    if (!morphRef.current || morphRef.current.key !== frontKey) {
        const to = new Map(frames.map(point => [point.day, point.score] as [number, number]))
        const previous = morphRef.current
        // A different set of days (more history, another SME) is a redraw, not a morph.
        const sameDays = !!previous && previous.to.size === to.size && [...to.keys()].every(key => previous.to.has(key))
        morphRef.current = {
            key: frontKey,
            start: motion && sameDays ? now : -Infinity,
            from: sameDays ? morphedScores(previous!, now, MORPH_MS) : to,
            to
        }
    }
    const scores = morphedScores(morphRef.current, now, motion ? MORPH_MS : 0)

    // The "if nothing changes" ghosts rise from the floor when a what-if begins.
    if (!ghost) {
        ghostMorphRef.current = null
    } else {
        const key = scoreKey(ghost)
        if (!ghostMorphRef.current || ghostMorphRef.current.key !== key) {
            const to = new Map(ghost.map(point => [point.day, point.score] as [number, number]))
            ghostMorphRef.current = {
                key,
                start: motion ? now : -Infinity,
                from: ghostMorphRef.current
                    ? morphedScores(ghostMorphRef.current, now, MORPH_MS)
                    : new Map(ghost.map(point => [point.day, 0] as [number, number])),
                to
            }
        }
    }
    const ghostScores = ghostMorphRef.current ? morphedScores(ghostMorphRef.current, now, motion ? MORPH_MS : 0) : null

    // Camera: the opening crane shot, then the resting position, with push-ins on top.
    const rest: Camera = { x: viewW / 2, eyeY: 270, distance: 760 }
    const horizonDays = Math.max(0, count - pastDays - 1)
    const openingDay = pastDays > 0 ? -Math.round(pastDays * 0.55) : Math.round(horizonDays * 0.25)
    const opening: Camera = { x: centreX(openingDay), eyeY: 70, distance: 330 }
    const base = introActive ? lerpCamera(opening, rest, easeInOutCubic(introT)) : rest
    // A push-in: close on the day, hold, then ease back to where the camera rests.
    const pushed = (push: Push): Camera | null => {
        const elapsed = now - push.start
        const close: Camera = push.hold ?? { x: centreX(push.day), eyeY: 215, distance: 470 }
        if (elapsed < PUSH_IN_MS) return lerpCamera(push.from, close, easeOutCubic(elapsed / PUSH_IN_MS))
        if (elapsed < PUSH_IN_MS + PUSH_HOLD_MS) return close
        if (elapsed < PUSH_MS) return lerpCamera(close, base, easeInOutCubic((elapsed - PUSH_IN_MS - PUSH_HOLD_MS) / PUSH_OUT_MS))
        return null
    }
    let camera = base
    if (pushRef.current) {
        const moved = pushed(pushRef.current)
        if (moved) camera = moved
        else pushRef.current = null
    }
    // A new request starts from wherever the camera is now, even mid push-in.
    if (focus && focus.key !== lastFocusKey.current) {
        lastFocusKey.current = focus.key
        if (motion && !introActive) pushRef.current = { start: now, from: camera, day: focus.day }
    }
    // Focus withdrawn (the timeline jumped away): ease straight back from where the camera is.
    if (!focus && pushRef.current && !pushRef.current.hold) {
        pushRef.current = { ...pushRef.current, start: now - PUSH_IN_MS - PUSH_HOLD_MS, hold: camera }
    }
    const { project, poly, boxFaces } = makeProjector(viewW, camera)

    // The opening wave: each column rises in turn, left to right.
    const riseOf = (index: number) => {
        if (!introActive) return 1
        const startsAt = RISE_DELAY_MS + (count > 1 ? (index / (count - 1)) * RISE_SPREAD_MS : 0)
        const t = clamp01((now - introStart - startsAt) / RISE_MS)
        return t <= 0 ? 0 : easeOutBack(t)
    }
    const indexOf = (value: number) => Math.max(0, Math.min(count - 1, Math.round(value) + pastDays))
    const shownHeight = (index: number) => {
        const point = frames[index]
        return point ? height(scores.get(point.day) ?? point.score) * riseOf(index) : 0
    }

    /* ------------------------------------------------ handle */
    const sheetRef = useRef<SVGPolygonElement | null>(null)
    const overlayRef = useRef<SVGSVGElement | null>(null)
    const lineRef = useRef<SVGLineElement | null>(null)
    const lastPosition = useRef<number | null>(null)
    const place = (position: number) => {
        lastPosition.current = position
        const x = centreX(position)
        sheetRef.current?.setAttribute('points', poly([[x, 0, FRONT_Z - 14], [x, 0, FAR_Z], [x, BAR_MAX + 30, FAR_Z], [x, BAR_MAX + 30, FRONT_Z - 14]]))
        const [ax, ay] = project(x, 0, FRONT_Z - 14)
        const [bx, by] = project(x, 0, FAR_Z)
        lineRef.current?.setAttribute('x1', String(ax))
        lineRef.current?.setAttribute('y1', String(ay))
        lineRef.current?.setAttribute('x2', String(bx))
        lineRef.current?.setAttribute('y2', String(by))
    }
    useImperativeHandle(ref, () => ({
        place,
        anchor: (position: number) => {
            const matrix = overlayRef.current?.getScreenCTM()
            if (!matrix) return null
            const [x, y] = project(centreX(position), shownHeight(indexOf(position)) + 6, FRONT_Z)
            const point = new DOMPoint(x, y).matrixTransform(matrix)
            return { x: point.x, y: point.y }
        }
    }))
    // The camera may have moved: keep the scanner and anything pinned to the scene on it.
    useLayoutEffect(() => {
        if (lastPosition.current !== null) place(lastPosition.current)
        callbacks.current.onCameraMove?.()
    })

    /* ------------------------------------------------ geometry */
    // Painter's order: outer bars first, so side faces turned to the camera sit on top.
    const paintOrder = (boxes: Box[]) =>
        [...boxes].sort((a, b) => Math.abs(b.x0 + width / 2 - camera.x) - Math.abs(a.x0 + width / 2 - camera.x))

    const frontBoxes = paintOrder(frames.map((point, index) => ({
        day: point.day,
        x0: centreX(point.day) - width / 2,
        x1: centreX(point.day) + width / 2,
        z0: FRONT_Z,
        z1: FRONT_Z + depth,
        h: shownHeight(index),
        color: colorFor(point)
    })))

    const ghostBoxes = ghost && ghostScores ? paintOrder(ghost.map(point => ({
        day: point.day,
        x0: centreX(point.day) - width / 2,
        x1: centreX(point.day) + width / 2,
        z0: GHOST_Z,
        z1: GHOST_Z + depth,
        h: height(ghostScores.get(point.day) ?? point.score),
        color: colorFor({ ...point, day: Math.min(0, point.day) })
    }))) : []

    const palette = Array.from(new Set([...frontBoxes, ...ghostBoxes].map(box => box.color)))
    const ribbon = frames
        .map((point, index) => project(centreX(point.day), shownHeight(index) + 6, FRONT_Z).map(value => value.toFixed(1)).join(','))
        .join(' ')
    const currentIndex = frames.findIndex(point => point.day === day)
    const current = currentIndex >= 0 ? frames[currentIndex] : null
    const currentTop = current ? project(centreX(current.day), shownHeight(currentIndex) + 18, FRONT_Z) : null
    const [todayX, todayY] = project(centreX(0), 0, FRONT_Z - 14)

    const floorLines: Array<[number, number, number, number]> = []
    for (let z = FRONT_Z - 14; z <= FAR_Z; z += 38) {
        const [x1, y1] = project(-400, 0, z)
        const [x2, y2] = project(viewW + 400, 0, z)
        floorLines.push([x1, y1, x2, y2])
    }
    for (let x = -400; x <= viewW + 400; x += 50) {
        const [x1, y1] = project(x, 0, FRONT_Z - 14)
        const [x2, y2] = project(x, 0, FAR_Z)
        floorLines.push([x1, y1, x2, y2])
    }

    const renderBox = (box: Box, className: string) => {
        const faces = boxFaces(box)
        return (
            <g key={`${className}-${box.day}`} className={className} onClick={() => onSeek(box.day)}>
                <polygon points={faces.side} fill={box.color} fillOpacity={0.32} />
                <polygon points={faces.front} fill={`url(#${gradientId(box.color)})`} />
                <polygon points={faces.top} fill={box.color} className='sk-top' />
            </g>
        )
    }

    return (
        <>
            <svg
                className={`tl-skyline ${introActive ? 'is-intro' : ''} ${settling ? 'is-settling' : ''}`}
                viewBox={`0 0 ${viewW} ${VIEW_H}`}
                preserveAspectRatio='xMidYMax meet'
                aria-hidden
            >
                <defs>
                    {palette.map(color => (
                        <linearGradient key={color} id={gradientId(color)} x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor={color} stopOpacity='1' />
                            <stop offset='100%' stopColor={color} stopOpacity='0.12' />
                        </linearGradient>
                    ))}
                    <linearGradient id='sk-sheet' x1='0' y1='1' x2='0' y2='0'>
                        <stop offset='0%' stopColor={scannerColor} stopOpacity='0.75' />
                        <stop offset='100%' stopColor={scannerColor} stopOpacity='0' />
                    </linearGradient>
                </defs>

                {/* The floor's glow is the stage's mood light, behind this picture. */}
                <g className='sk-floor'>
                    {floorLines.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />)}
                </g>
                <polygon
                    className='sk-future'
                    points={poly([[centreX(0) - slot / 2, 0, FRONT_Z - 14], [viewW - MARGIN_X + 10, 0, FRONT_Z - 14], [viewW - MARGIN_X + 10, 0, FAR_Z], [centreX(0) - slot / 2, 0, FAR_Z]])}
                />

                <g className='sk-ghosts'>{ghostBoxes.map(box => renderBox(box, 'sk-bar sk-ghost'))}</g>

                {/* No blanket blur filter: SVG filters redraw on the CPU. Only the current day glows. */}
                <g>
                    {frontBoxes.map(box => renderBox(
                        box,
                        `sk-bar ${box.day === day ? 'is-current' : box.day > day ? 'is-ahead' : 'is-played'}`
                    ))}
                </g>
            </svg>
            {/* Everything that moves each frame lives on this light overlay, so the
                glowing columns underneath only redraw when the day or camera changes. */}
            <svg
                ref={overlayRef}
                className={`tl-skyline tl-skyline-overlay ${introActive ? 'is-intro' : ''}`}
                viewBox={`0 0 ${viewW} ${VIEW_H}`}
                preserveAspectRatio='xMidYMax meet'
                aria-hidden
            >
                {beacons.map(beacon => {
                    const x = centreX(beacon.day)
                    const [bx, by] = project(x, 0, FRONT_Z - 8)
                    const [tx, ty] = project(x, BAR_MAX + 22, FRONT_Z - 8)
                    return (
                        <g key={beacon.key} className='sk-beacon' style={{ ['--beacon' as any]: beacon.color }}>
                            <line x1={bx} y1={by} x2={tx} y2={ty} />
                            <polygon points={`${tx},${ty - 6} ${tx + 5},${ty} ${tx},${ty + 6} ${tx - 5},${ty}`} />
                        </g>
                    )
                })}
                <polyline className='sk-ribbon' points={ribbon} />
                <polygon ref={sheetRef} className='sk-sheet' fill='url(#sk-sheet)' points='' />
                <line ref={lineRef} className='sk-scan-line' stroke={scannerColor} />

                <g className='sk-today'>
                    <line x1={todayX} y1={todayY} x2={todayX} y2={todayY - BAR_MAX - 30} />
                    <text x={todayX} y={todayY + 14} textAnchor='middle'>TODAY</text>
                </g>
                {current && currentTop && (
                    <text className='sk-value' x={currentTop[0]} y={currentTop[1]} textAnchor='middle' style={{ fill: colorFor(current) }}>
                        {Math.round(scores.get(current.day) ?? current.score)}
                    </text>
                )}
            </svg>
        </>
    )
})
