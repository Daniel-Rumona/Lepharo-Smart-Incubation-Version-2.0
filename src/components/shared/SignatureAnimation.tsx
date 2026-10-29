import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import { playSignature, type SignatureStrokes } from '@/utils/signatureReplay'

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
    src: string
    /** Play the signing animation; otherwise this is a plain <img>. */
    animate?: boolean
    /** Strokes to replay. Left out, the signer's profile is checked for them. */
    strokes?: SignatureStrokes | null
    /** Called once the signature is fully shown (straight away with reduced motion). */
    onComplete?: () => void
}

/**
 * A signature image that, while `animate` is set, re-draws itself from its pen
 * strokes or, for typed and older signatures, is revealed left to right. It is
 * an ordinary <img> otherwise, so existing selectors and PDF snapshots still apply.
 */
export const SignatureAnimation: React.FC<Props> = ({
    src,
    animate = false,
    strokes,
    onComplete,
    alt = 'Signature',
    ...imgProps
}) => {
    const imgRef = useRef<HTMLImageElement | null>(null)
    const completeRef = useRef(onComplete)
    completeRef.current = onComplete

    // A layout effect, so the image is hidden before its first paint.
    useLayoutEffect(() => {
        const img = imgRef.current
        if (!animate) return
        if (!img || !src) {
            completeRef.current?.()
            return
        }
        const controller = new AbortController()
        void playSignature(img, { strokes, signal: controller.signal }).then(() => {
            if (!controller.signal.aborted) completeRef.current?.()
        })
        return () => {
            controller.abort()
            // Removed mid-animation: nothing is left to wait for. (A re-run keeps
            // the image in the page, and reports when it finishes instead.)
            queueMicrotask(() => {
                if (!img.isConnected) completeRef.current?.()
            })
        }
    }, [animate, src, strokes])

    return <img ref={imgRef} src={src} alt={alt} {...imgProps} />
}

/**
 * A small piece of paper with a signing line, for confirmations that have no
 * document on screen. It stays white in dark theme because the ink is dark.
 */
export const SignatureStage: React.FC<{
    src?: string | null
    animate?: boolean
    onComplete?: () => void
    placeholder?: React.ReactNode
    caption?: React.ReactNode
}> = ({ src, animate, onComplete, placeholder = 'Your signature appears here when you sign', caption }) => (
    // keep-light opts out of the dark theme's repainting of white inline backgrounds.
    <div
        className='keep-light'
        style={{
            background: '#fff',
            border: '1px solid #e4e7ec',
            borderRadius: 10,
            padding: '12px 16px 10px',
            color: '#667085'
        }}
    >
        <div
            style={{
                height: 76,
                display: 'flex',
                alignItems: 'flex-end',
                borderBottom: '1px solid #17202a',
                position: 'relative'
            }}
        >
            {src ? (
                <SignatureAnimation
                    src={src}
                    animate={animate}
                    onComplete={onComplete}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: 70,
                        objectFit: 'contain',
                        objectPosition: 'left bottom'
                    }}
                />
            ) : (
                <span style={{ fontSize: 13, paddingBottom: 8 }}>{placeholder}</span>
            )}
        </div>
        {caption && <div style={{ fontSize: 12, marginTop: 6 }}>{caption}</div>}
    </div>
)

/**
 * Lets a signing flow wait for the animation before it snapshots the document
 * or closes: `start()` when the signature is put on the page, pass `complete`
 * to onComplete, then `await finished()`. Never waits longer than `timeoutMs`.
 */
export const useSignaturePlayback = () => {
    const stateRef = useRef<{ done: boolean; waiting: (() => void)[] }>({ done: true, waiting: [] })

    const start = useCallback(() => {
        stateRef.current = { done: false, waiting: [] }
    }, [])

    const complete = useCallback(() => {
        const state = stateRef.current
        state.done = true
        state.waiting.splice(0).forEach(resolve => resolve())
    }, [])

    const finished = useCallback(
        (timeoutMs = 7000) =>
            new Promise<void>(resolve => {
                const state = stateRef.current
                if (state.done) return resolve()
                state.waiting.push(resolve)
                window.setTimeout(resolve, timeoutMs)
            }),
        []
    )

    return useMemo(() => ({ start, complete, finished }), [start, complete, finished])
}

/**
 * For sign-offs with no document on screen (the signature only lands in a
 * record or a server-made PDF): `sign()` shows the signature being written in
 * a small dialog while the action runs, and settles once both are done.
 * Render `element` once in the component.
 */
export const useSigningCeremony = () => {
    const [signing, setSigning] = useState<{ src: string; title: string; caption?: string } | null>(null)
    const playback = useSignaturePlayback()

    const sign = useCallback(
        async <T,>(
            src: string | null | undefined,
            action: () => Promise<T>,
            title = 'Signing',
            caption?: string
        ): Promise<T> => {
            if (!src) return action()
            playback.start()
            setSigning({ src, title, caption })
            try {
                const [result] = await Promise.all([action(), playback.finished()])
                return result
            } finally {
                setSigning(null)
            }
        },
        [playback]
    )

    const element = (
        <Modal
            open={Boolean(signing)}
            title={signing?.title}
            footer={null}
            closable={false}
            maskClosable={false}
            keyboard={false}
            centered
            destroyOnClose
            width={420}
        >
            {signing && (
                <SignatureStage
                    src={signing.src}
                    animate
                    onComplete={playback.complete}
                    caption={signing.caption}
                />
            )}
        </Modal>
    )

    return { sign, element }
}

export default SignatureAnimation
