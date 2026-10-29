import { doc, getDoc } from 'firebase/firestore'
import type SignatureCanvas from 'react-signature-canvas'
import { auth, db } from '@/firebase'

/**
 * Signing animation shared by every place a document is signed.
 *
 * A drawn signature keeps the pen strokes it was drawn with (users.signatureStrokes)
 * so it can be re-drawn live; anything else (typed, uploaded, or an older drawn
 * signature saved before strokes were kept) is revealed left to right instead.
 * users.signatureURL stays the source of truth: PDFs and older code read only that.
 */

export type SignatureMethod = 'typed' | 'drawn' | 'uploaded'

/**
 * Pen strokes in the pixel space of the saved PNG. Firestore cannot hold nested
 * arrays, so each stroke's points are flattened as x, y, t (ms from the first
 * point of the signature).
 */
export type SignatureStrokes = {
    v: 1
    width: number
    height: number
    color?: string
    strokes: { points: number[] }[]
}

type PadPoint = { x: number; y: number; time: number; color?: string }

const round1 = (value: number) => Math.round(value * 10) / 10

/** Bounds of the inked pixels: the same area trim-canvas crops to. */
const inkBounds = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) return null
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] === 0) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    if (maxX < 0) return null
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * The pad cropped to its ink, as a PNG data URL. Stands in for
 * getTrimmedCanvas(), whose trim-canvas import fails under Vite's
 * pre-bundling, and crops exactly where captureSignatureStrokes(pad, true) does.
 */
export const trimmedSignaturePng = (pad: SignatureCanvas): string => {
    const source = pad.getCanvas()
    const box = inkBounds(source)
    if (!box) throw new Error('Draw your signature before saving.')
    const canvas = document.createElement('canvas')
    canvas.width = box.width
    canvas.height = box.height
    canvas.getContext('2d')?.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
    return canvas.toDataURL('image/png')
}

/**
 * Reads the strokes off a signature pad. `trimmed` must match how the PNG was
 * made: getTrimmedCanvas() crops to the ink, toDataURL() keeps the whole pad.
 */
export const captureSignatureStrokes = (
    pad: SignatureCanvas,
    trimmed: boolean
): SignatureStrokes | null => {
    try {
        const groups = (pad.toData() as unknown as PadPoint[][]).filter(group => group?.length)
        if (!groups.length) return null
        const canvas = pad.getCanvas()
        const box = trimmed
            ? inkBounds(canvas)
            : { x: 0, y: 0, width: canvas.width, height: canvas.height }
        if (!box) return null

        const startedAt = groups[0][0].time
        return {
            v: 1,
            width: box.width,
            height: box.height,
            color: groups[0][0].color,
            strokes: groups.map(group => ({
                points: group.flatMap(point => [
                    round1(point.x - box.x),
                    round1(point.y - box.y),
                    Math.max(0, Math.round(point.time - startedAt))
                ])
            }))
        }
    } catch (error) {
        console.warn('Could not capture signature strokes.', error)
        return null
    }
}

const isStrokes = (value: any): value is SignatureStrokes =>
    Boolean(
        value &&
            value.width > 0 &&
            value.height > 0 &&
            Array.isArray(value.strokes) &&
            value.strokes.some((stroke: any) => Array.isArray(stroke?.points) && stroke.points.length >= 3)
    )

type ProfileSignature = { signatureURL: string; strokes: SignatureStrokes | null }
const profileCache = new Map<string, Promise<ProfileSignature | null>>()

/** Keeps the cache in step after the signature is replaced in this tab. */
export const rememberProfileSignature = (
    uid: string,
    signatureURL: string,
    strokes: SignatureStrokes | null
) => {
    profileCache.set(uid, Promise.resolve({ signatureURL, strokes }))
}

const loadProfileSignature = (uid: string) => {
    let pending = profileCache.get(uid)
    if (!pending) {
        pending = getDoc(doc(db, 'users', uid))
            .then(snapshot => {
                const data = snapshot.data() as any
                if (!data?.signatureURL) return null
                return {
                    signatureURL: String(data.signatureURL),
                    strokes:
                        data.signatureMethod !== 'typed' && isStrokes(data.signatureStrokes)
                            ? (data.signatureStrokes as SignatureStrokes)
                            : null
                }
            })
            .catch(error => {
                profileCache.delete(uid)
                console.warn('Could not load signature strokes.', error)
                return null
            })
        profileCache.set(uid, pending)
    }
    return pending
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, fallback: T) =>
    Promise.race([promise, new Promise<T>(resolve => window.setTimeout(() => resolve(fallback), ms))])

/**
 * The signer is always the person signed in, so their strokes come from their
 * own profile, and only when they belong to the image being shown.
 */
export const loadSignatureStrokes = async (signatureURL: string): Promise<SignatureStrokes | null> => {
    const uid = auth.currentUser?.uid
    if (!uid || !signatureURL) return null
    const profile = await withTimeout(loadProfileSignature(uid), 2500, null)
    return profile && profile.signatureURL === signatureURL ? profile.strokes : null
}

export const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

const imageReady = (img: HTMLImageElement) =>
    new Promise<boolean>(resolve => {
        if (img.complete) return resolve(img.naturalWidth > 0)
        const done = (ok: boolean) => {
            window.clearTimeout(timer)
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve(ok)
        }
        const onLoad = () => done(img.naturalWidth > 0)
        const onError = () => done(false)
        const timer = window.setTimeout(() => done(false), 8000)
        img.addEventListener('load', onLoad)
        img.addEventListener('error', onError)
    })

/** Waits (briefly) for the image to be scrolled into view, so the animation is seen. */
const inView = (img: HTMLImageElement, maxWait: number) =>
    new Promise<void>(resolve => {
        if (typeof IntersectionObserver === 'undefined') return resolve()
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.intersectionRatio >= 0.6)) done()
        }, { threshold: [0, 0.6, 1] })
        const timer = window.setTimeout(() => done(), maxWait)
        const done = () => {
            window.clearTimeout(timer)
            observer.disconnect()
            resolve()
        }
        observer.observe(img)
    })

const positionOffset =(token: string | undefined, free: number) => {
    if (!token || token === 'center') return free / 2
    if (token === 'left' || token === 'top') return 0
    if (token === 'right' || token === 'bottom') return free
    if (token.endsWith('%')) return (free * parseFloat(token)) / 100
    return parseFloat(token) || 0
}

/** Where the picture itself sits inside the img's border box, honouring object-fit. */
const contentBox = (img: HTMLImageElement) => {
    const rect = img.getBoundingClientRect()
    const style = getComputedStyle(img)
    const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    const top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
    const boxWidth = rect.width - left - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
    const boxHeight = rect.height - top - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight
    if (boxWidth <= 1 || boxHeight <= 1 || !naturalWidth || !naturalHeight) return null

    let width = boxWidth
    let height = boxHeight
    const fit = style.objectFit
    if (fit === 'contain' || fit === 'scale-down' || fit === 'cover' || fit === 'none') {
        const contain = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight)
        const scale =
            fit === 'contain'
                ? contain
                : fit === 'cover'
                  ? Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight)
                  : fit === 'none'
                    ? 1
                    : Math.min(contain, 1)
        width = naturalWidth * scale
        height = naturalHeight * scale
    }
    const [posX, posY] = (style.objectPosition || '50% 50%').split(/\s+/)
    return {
        x: left + positionOffset(posX, boxWidth - width),
        y: top + positionOffset(posY, boxHeight - height),
        width,
        height,
        elementWidth: rect.width
    }
}

type Box = NonNullable<ReturnType<typeof contentBox>>

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

/** Left-to-right ink reveal for signatures that have no strokes. */
const reveal = async (img: HTMLImageElement, box: Box, signal: AbortSignal, register: (undo: () => void) => void) => {
    const hiddenRight = box.elementWidth - box.x
    const shownRight = Math.max(0, box.elementWidth - box.x - box.width)
    img.style.clipPath = `inset(0 ${hiddenRight}px 0 0)`
    img.style.opacity = ''
    if (typeof img.animate !== 'function') return
    const animation = img.animate(
        [{ clipPath: `inset(0 ${hiddenRight}px 0 0)` }, { clipPath: `inset(0 ${shownRight}px 0 0)` }],
        {
            duration: Math.min(1600, Math.max(900, box.width * 4)),
            easing: 'cubic-bezier(.45,.05,.35,1)',
            fill: 'forwards'
        }
    )
    register(() => animation.cancel())
    await new Promise<void>(resolve => {
        animation.onfinish = () => resolve()
        animation.oncancel = () => resolve()
        signal.addEventListener('abort', () => resolve(), { once: true })
    })
}

const MAX_STROKE_GAP = 300
const MAX_DURATION = 3200
const MIN_WIDTH = 0.5
const MAX_WIDTH = 2.5

type Segment = { at: number; x: number; y: number; width: number; first: boolean; last: boolean }

/** Turns the saved strokes into a timeline, at drawing speed with pauses kept short. */
const buildTimeline = (strokes: SignatureStrokes) => {
    const segments: Segment[] = []
    let clock = 0
    let previousEnd: number | null = null
    for (const stroke of strokes.strokes) {
        const points = stroke.points
        const count = Math.floor(points.length / 3)
        if (!count) continue
        const start = points[2]
        if (previousEnd !== null) clock += Math.min(Math.max(start - previousEnd, 0), MAX_STROKE_GAP)
        let velocity = 0
        let width = (MIN_WIDTH + MAX_WIDTH) / 2
        for (let i = 0; i < count; i++) {
            const x = points[i * 3]
            const y = points[i * 3 + 1]
            let at = clock + Math.max(0, points[i * 3 + 2] - start)
            if (i > 0) {
                const previous = segments[segments.length - 1]
                // Old or synthetic data without usable timings plays at a steady pace.
                if (at <= previous.at) at = previous.at + 8
                const elapsed = at - previous.at
                const distance = Math.hypot(x - previous.x, y - previous.y)
                // Same velocity-to-width rule as signature_pad, so the ink weight matches.
                velocity = 0.7 * (distance / elapsed) + 0.3 * velocity
                width = Math.max(MAX_WIDTH / (velocity + 1), MIN_WIDTH)
            }
            segments.push({ at, x, y, width, first: i === 0, last: i === count - 1 })
        }
        clock = segments[segments.length - 1].at
        previousEnd = points[(count - 1) * 3 + 2]
    }
    const total = clock || 1
    const speed = total > MAX_DURATION ? MAX_DURATION / total : 1
    segments.forEach(segment => (segment.at *= speed))
    return { segments, duration: total * speed }
}

/** Re-draws a drawn signature stroke by stroke on a canvas laid over the image. */
const replay = async (
    img: HTMLImageElement,
    box: Box,
    strokes: SignatureStrokes,
    signal: AbortSignal,
    register: (undo: () => void) => void
) => {
    const { segments, duration } = buildTimeline(strokes)
    const parent = img.parentNode
    if (!segments.length || !parent) return reveal(img, box, signal, register)

    const canvas = document.createElement('canvas')
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.ceil(box.width * ratio)
    canvas.height = Math.ceil(box.height * ratio)
    canvas.setAttribute('aria-hidden', 'true')
    Object.assign(canvas.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: '0',
        border: '0',
        padding: '0',
        pointerEvents: 'none',
        zIndex: '1',
        transition: 'opacity 180ms ease'
    })
    parent.insertBefore(canvas, img.nextSibling)
    register(() => canvas.remove())

    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(ratio, ratio)
    const scaleX = box.width / strokes.width
    const scaleY = box.height / strokes.height
    const inkScale = (scaleX + scaleY) / 2
    context.fillStyle = context.strokeStyle = strokes.color || '#111'
    context.lineCap = context.lineJoin = 'round'

    // Follows the image wherever it moves (scrolling, a modal settling) during the replay.
    const place = () => {
        const target = img.getBoundingClientRect()
        const current = canvas.getBoundingClientRect()
        canvas.style.left = `${parseFloat(canvas.style.left) + target.left + box.x - current.left}px`
        canvas.style.top = `${parseFloat(canvas.style.top) + target.top + box.y - current.top}px`
    }

    const drawUpTo = (index: number) => {
        const segment = segments[index]
        const x = segment.x * scaleX
        const y = segment.y * scaleY
        if (segment.first) {
            if (segment.last) {
                context.beginPath()
                context.arc(x, y, Math.max(((MIN_WIDTH + MAX_WIDTH) / 2) * inkScale, 0.6), 0, Math.PI * 2)
                context.fill()
            }
            return
        }
        const previous = segments[index - 1]
        context.beginPath()
        context.lineWidth = Math.max(((previous.width + segment.width) / 2) * inkScale * 1.4, 0.6)
        context.moveTo(previous.x * scaleX, previous.y * scaleY)
        context.lineTo(x, y)
        context.stroke()
    }

    place()
    await new Promise<void>(resolve => {
        let drawn = 0
        let frame = 0
        const startedAt = performance.now()
        const tick = (now: number) => {
            if (signal.aborted) return resolve()
            place()
            const elapsed = now - startedAt
            while (drawn < segments.length && segments[drawn].at <= elapsed) drawUpTo(drawn++)
            if (drawn >= segments.length || elapsed > duration + 500) return resolve()
            frame = requestAnimationFrame(tick)
        }
        signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true })
        frame = requestAnimationFrame(tick)
    })
    if (signal.aborted) return

    // Hand over to the real image so what stays on screen is exactly the saved PNG.
    img.style.transition = 'opacity 180ms ease'
    img.style.opacity = ''
    canvas.style.opacity = '0'
    await wait(200)
}

export type PlaySignatureOptions = {
    /** Strokes to replay. Left out, they are looked up on the signer's profile. */
    strokes?: SignatureStrokes | null
    signal?: AbortSignal
}

/**
 * Animates a signature <img> already in the page: hides it at once (call it
 * before the browser paints), then replays or reveals it. Resolves once the
 * image is back exactly as it was, so a PDF snapshot taken after never sees a
 * half-drawn signature. With reduced motion it resolves straight away.
 */
export const playSignature = (img: HTMLImageElement, options: PlaySignatureOptions = {}): Promise<void> => {
    if (prefersReducedMotion() || options.signal?.aborted) return Promise.resolve()

    const controller = new AbortController()
    const signal = controller.signal
    const saved = { opacity: img.style.opacity, clipPath: img.style.clipPath, transition: img.style.transition }
    const undo: (() => void)[] = []
    let restored = false
    const restore = () => {
        if (restored) return
        restored = true
        undo.forEach(step => step())
        img.style.opacity = saved.opacity
        img.style.clipPath = saved.clipPath
        img.style.transition = saved.transition
    }
    // Restored synchronously, so a replay started straight after (React strict
    // mode, a new src) hides the image again rather than being undone later.
    options.signal?.addEventListener(
        'abort',
        () => {
            controller.abort()
            restore()
        },
        { once: true }
    )

    img.style.transition = 'none'
    img.style.opacity = '0'

    return (async () => {
        try {
            const src = img.getAttribute('src') || ''
            const [strokes, loaded] = await Promise.all([
                options.strokes !== undefined ? options.strokes : loadSignatureStrokes(src),
                imageReady(img)
            ])
            if (signal.aborted || !loaded) return
            await inView(img, 1200)
            if (signal.aborted) return
            const box = contentBox(img)
            if (!box) return
            const register = (step: () => void) => undo.push(step)
            if (strokes && isStrokes(strokes)) await replay(img, box, strokes, signal, register)
            else await reveal(img, box, signal, register)
        } catch (error) {
            console.warn('Signature animation failed; showing the signature as is.', error)
        } finally {
            restore()
        }
    })()
}
