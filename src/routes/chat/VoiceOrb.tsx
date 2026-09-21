import React, { useEffect, useRef } from 'react'
import './voice-orb.css'

export type VoiceOrbMode = 'idle' | 'listening' | 'thinking' | 'speaking'

interface VoiceOrbProps {
    mode: VoiceOrbMode
    size?: number
    className?: string
}

const LAYER_BASE_DURATIONS = [7, 9, 11]

// Drives the orb's "liveliness" purely from a simulated amplitude — there is
// no real audio signal yet (ElevenLabs isn't wired in). Each mode has its own
// waveform shape so listening/thinking/speaking read as visually distinct
// states; once real playback/mic levels exist, swap the per-mode math below
// for an AnalyserNode reading and the rest of the component is unchanged.
export const VoiceOrb: React.FC<VoiceOrbProps> = ({ mode, size = 220, className }) => {
    const scaleRef = useRef<HTMLDivElement | null>(null)
    const glowRef = useRef<HTMLDivElement | null>(null)
    const layerRefs = useRef<Array<HTMLDivElement | null>>([])
    const modeRef = useRef(mode)
    const tickRef = useRef(0)
    const noiseRef = useRef(0)

    useEffect(() => {
        modeRef.current = mode
    }, [mode])

    useEffect(() => {
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        let frameId: number

        const tick = () => {
            tickRef.current += 1
            const t = tickRef.current
            let amplitude = 0.03
            let speed = 0.6

            switch (modeRef.current) {
                case 'listening': {
                    noiseRef.current += (Math.random() - 0.5) * 0.08
                    noiseRef.current = Math.max(-1, Math.min(1, noiseRef.current * 0.9))
                    amplitude = 0.08 + Math.abs(noiseRef.current) * 0.12
                    speed = 1.4
                    break
                }
                case 'thinking': {
                    amplitude = 0.05 + Math.sin(t * 0.05) * 0.02
                    speed = 1
                    break
                }
                case 'speaking': {
                    const wave = Math.sin(t * 0.15) * 0.5 + Math.sin(t * 0.37) * 0.3 + Math.sin(t * 0.61) * 0.2
                    amplitude = 0.14 + Math.abs(wave) * 0.16
                    speed = 2.2
                    break
                }
                default: {
                    amplitude = 0.03 + Math.sin(t * 0.02) * 0.01
                    speed = 0.6
                }
            }

            if (prefersReducedMotion) {
                amplitude = 0.02
                speed = 0.4
            }

            if (scaleRef.current) {
                scaleRef.current.style.transform = `scale(${(1 + amplitude).toFixed(4)})`
            }
            if (glowRef.current) {
                glowRef.current.style.opacity = String(Math.min(1, 0.4 + amplitude * 1.5))
            }
            layerRefs.current.forEach((el, index) => {
                if (!el) return
                el.style.animationDuration = `${(LAYER_BASE_DURATIONS[index] / speed).toFixed(2)}s`
            })

            frameId = requestAnimationFrame(tick)
        }

        frameId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frameId)
    }, [])

    return (
        <div className={`voice-orb ${className || ''}`} style={{ width: size, height: size }} data-mode={mode}>
            <div className='voice-orb-glow' ref={glowRef} />
            <div className='voice-orb-scale' ref={scaleRef}>
                <div className='voice-orb-layer voice-orb-layer-1' ref={el => { layerRefs.current[0] = el }} />
                <div className='voice-orb-layer voice-orb-layer-2' ref={el => { layerRefs.current[1] = el }} />
                <div className='voice-orb-layer voice-orb-layer-3' ref={el => { layerRefs.current[2] = el }} />
            </div>
        </div>
    )
}

export default VoiceOrb
