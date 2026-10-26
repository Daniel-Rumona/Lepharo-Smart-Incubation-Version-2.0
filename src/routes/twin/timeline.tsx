import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CaretRightFilled, FastForwardOutlined, PauseOutlined, StepBackwardOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    NO_CHANGE_SCENARIO,
    computeRiskScore,
    isNoChangeScenario,
    projectionCurve,
    scenarioInputsAt,
    scenarioCurve,
    type DigitalTwinRecord,
    type RiskLevel,
    type TwinScenario
} from '@twin/rules'
import type { TwinHistoryPoint } from '@/services/digitalTwinService'
import { usePalette } from './palette'
import { CoreReactor, MoodLight, useParallax } from './scene'
import { Skyline, type SkylineFocus, type SkylineHandle, type SkylinePoint } from './skyline'
import { WhatIfControls } from './whatif'

const DAYS_PER_SECOND = 6
// A short beat between the opening shot settling and the timeline starting to roll.
const ROLL_AFTER_INTRO_MS = 350
const HOLD_AT_END_MS = 2600
const DAY_MS = 24 * 60 * 60 * 1000
const LEVEL_RANK: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 }
export type OutlookMode = 'nothing-changes' | 'what-if'

type Point = { day: number; score: number; level: RiskLevel }
type TimelineEvent = { key: string; day: number; label: string; tone: 'good' | 'bad' | 'warn' | 'info' }
type Toast = TimelineEvent & { id: number }


const dayLabel = (day: number) => (day === 0 ? 'Today' : day < 0 ? `${-day} day${day === -1 ? '' : 's'} ago` : `In ${day} day${day === 1 ? '' : 's'}`)

/**
 * The twin's centrepiece: every day as a glowing 3D column on the holographic
 * floor, saved history on the left, the next weeks on the right. It plays like
 * a video (a scanner sweeps the days and the core follows it), and staff can
 * pause, scrub, jump to events and switch to What if… to replay the future
 * under their own changes.
 */
export function TimelineHero({ record, history, mode, onModeChange, scenario, onScenarioChange }: {
    record: DigitalTwinRecord
    history: TwinHistoryPoint[]
    mode: OutlookMode
    onModeChange: (mode: OutlookMode) => void
    scenario: TwinScenario
    onScenarioChange: (scenario: TwinScenario) => void
}) {
    const reduceMotion = useReducedMotion()
    const palette = usePalette()
    const PAST_COLOR = palette.past
    const WHAT_IF_COLOR = palette.whatIf
    const LEVEL_COLOR = palette.level
    // Event tones: good news in the what-if colour, history in lilac.
    const TONE_COLOR: Record<TimelineEvent['tone'], string> = {
        good: WHAT_IF_COLOR,
        bad: LEVEL_COLOR.Critical,
        warn: LEVEL_COLOR.Medium,
        info: PAST_COLOR
    }
    // The 3D stage follows the pointer and, left alone, slowly orbits on its own.
    const stageRef = useParallax<HTMLDivElement>({ idleDrift: true })
    const heroRef = useRef<HTMLElement | null>(null)
    const coreRef = useRef<HTMLDivElement | null>(null)
    const beamRefs = useRef<Array<SVGPathElement | null>>([])
    const [aspect, setAspect] = useState(3.7)
    useEffect(() => {
        const element = stageRef.current
        if (!element || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect
            if (width && height) setAspect(Math.round((width / height) * 10) / 10)
        })
        observer.observe(element)
        return () => observer.disconnect()
    }, [stageRef])
    const horizon = record.outlook.horizons[record.outlook.horizons.length - 1]?.days ?? 40
    const pastDays = Math.min(45, Math.max(0, history.length - 1))
    const start = useMemo(() => new Date(record.calculatedAt), [record.calculatedAt])

    const activeScenario = mode === 'what-if' ? scenario : null
    const baseline = useMemo(() => projectionCurve(record, horizon), [record, horizon])
    const whatIf = useMemo(
        () => (activeScenario && !isNoChangeScenario(activeScenario) ? scenarioCurve(record, activeScenario, horizon) : null),
        [record, activeScenario, horizon]
    )

    // One point per day: saved history up to yesterday, then today and ahead.
    const frames: Point[] = useMemo(() => {
        const past = history.slice(-(pastDays + 1), -1).map((point, index) => ({
            day: index - pastDays,
            score: point.needsAttention,
            level: point.level
        }))
        return [...past, ...(whatIf ?? baseline)]
    }, [history, pastDays, whatIf, baseline])
    const count = frames.length
    const frameAt = useCallback((day: number) => frames[Math.max(0, Math.min(count - 1, day + pastDays))], [frames, count, pastDays])

    const events: TimelineEvent[] = useMemo(() => {
        const list: TimelineEvent[] = []
        const curve = whatIf ?? baseline
        for (let day = 1; day < curve.length; day += 1) {
            const before = curve[day - 1].level
            const after = curve[day].level
            if (before !== after) {
                const worse = LEVEL_RANK[after] > LEVEL_RANK[before]
                list.push({ key: `level-${day}`, day, label: `${worse ? 'Rises' : 'Falls'} to ${after}`, tone: worse ? 'bad' : 'good' })
            }
        }
        const furthest = record.outlook.horizons[record.outlook.horizons.length - 1]
        const toDay = (iso: string) => Math.max(1, Math.ceil((new Date(iso).getTime() - start.getTime()) / DAY_MS))
        furthest?.dueInterventions.forEach(item => list.push({ key: `due-${item.title}-${item.dueDate}`, day: toDay(item.dueDate), label: `Due: ${item.title}`, tone: 'warn' }))
        furthest?.expiringDocuments.forEach(item => list.push({
            key: `doc-${item.title}-${item.expiry}`,
            day: toDay(item.expiry),
            label: activeScenario?.renewExpiring ? `Renewed in time: ${item.title}` : `Expires: ${item.title}`,
            tone: activeScenario?.renewExpiring ? 'good' : 'warn'
        }))
        if (whatIf && activeScenario?.serviceInDays !== null && activeScenario?.serviceInDays !== undefined) {
            list.push({ key: 'service', day: activeScenario.serviceInDays, label: 'Service delivered', tone: 'good' })
        }
        for (let index = 1; index < frames.length && frames[index].day < 0; index += 1) {
            if (frames[index].level !== frames[index - 1].level) {
                list.push({ key: `past-${frames[index].day}`, day: frames[index].day, label: `Became ${frames[index].level}`, tone: 'info' })
            }
        }
        return list.filter(item => item.day >= -pastDays && item.day <= horizon).sort((a, b) => a.day - b.day)
    }, [whatIf, baseline, record, start, activeScenario, frames, pastDays, horizon])

    /* ------------------------------------------------ playback */
    const [day, setDay] = useState(reduceMotion ? 0 : -pastDays)
    const [playing, setPlaying] = useState(!reduceMotion)
    const [speed, setSpeed] = useState(1)
    const [toasts, setToasts] = useState<Toast[]>([])
    const position = useRef(day)
    // The day the alarm last looked at. A seek moves it too, so a jump is never a crossing.
    const alarmDay = useRef(day)
    // Where the camera is pushed in on danger; a jump elsewhere sends it back.
    const [focus, setFocus] = useState<SkylineFocus | null>(null)
    const skylineRef = useRef<SkylineHandle | null>(null)
    // The timeline rolls once the opening shot has finished; the beam appears then too.
    const rollFrom = useRef<number | null>(null)
    const [introDone, setIntroDone] = useState(false)
    const handleIntroDone = useCallback(() => {
        rollFrom.current = performance.now() + ROLL_AFTER_INTRO_MS
        setIntroDone(true)
    }, [])

    // A stream of light from the column under the scanner into the score dial.
    const placeBeam = useCallback((value: number) => {
        const hero = heroRef.current?.getBoundingClientRect()
        const dial = coreRef.current?.querySelector('.twin-core')?.getBoundingClientRect()
        const from = skylineRef.current?.anchor(value)
        if (!hero || !dial || !from) return
        const x1 = from.x - hero.left
        const y1 = from.y - hero.top
        const x2 = dial.left + dial.width / 2 - hero.left
        const y2 = dial.top + dial.width / 2 - hero.top
        const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${(y1 - 90).toFixed(1)} ${(x2 + 180).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
        beamRefs.current.forEach(path => path?.setAttribute('d', d))
    }, [])
    const followCamera = useCallback(() => placeBeam(position.current), [placeBeam])

    const placeScanner = useCallback((value: number) => {
        skylineRef.current?.place(value)
        placeBeam(value)
    }, [placeBeam])

    const seek = useCallback((target: number, keepPlaying = false) => {
        const clamped = Math.max(-pastDays, Math.min(horizon, target))
        position.current = clamped
        alarmDay.current = clamped
        setFocus(null)
        placeScanner(clamped)
        setDay(clamped)
        if (!keepPlaying) setPlaying(false)
    }, [pastDays, horizon, placeScanner])

    useEffect(() => placeScanner(position.current), [placeScanner, count, pastDays])
    useEffect(() => {
        let frame = 0
        const refresh = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
                frame = 0
                placeBeam(position.current)
            })
        }
        window.addEventListener('pointermove', refresh)
        window.addEventListener('resize', refresh)
        const timer = window.setInterval(refresh, 120)
        return () => {
            window.removeEventListener('pointermove', refresh)
            window.removeEventListener('resize', refresh)
            window.clearInterval(timer)
            cancelAnimationFrame(frame)
        }
    }, [placeBeam])

    useEffect(() => {
        if (!playing) return
        let last = performance.now()
        let holdUntil = 0
        let frame = 0
        const tick = (now: number) => {
            const elapsed = (now - last) / 1000
            last = now
            if (rollFrom.current === null || now < rollFrom.current) {
                frame = requestAnimationFrame(tick)
                return
            }
            if (holdUntil) {
                if (now >= holdUntil) {
                    holdUntil = 0
                    position.current = -pastDays
                }
            } else {
                position.current += elapsed * DAYS_PER_SECOND * speed
                if (position.current >= horizon) {
                    position.current = horizon
                    holdUntil = now + HOLD_AT_END_MS
                }
            }
            placeScanner(position.current)
            const rounded = Math.round(position.current)
            setDay(previous => (previous === rounded ? previous : rounded))
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [playing, speed, pastDays, horizon, placeScanner])

    // Changing a what-if lever replays the future so its effect plays out.
    const scenarioKey = JSON.stringify(activeScenario)
    const lastScenarioKey = useRef(scenarioKey)
    useEffect(() => {
        if (lastScenarioKey.current === scenarioKey) return
        lastScenarioKey.current = scenarioKey
        seek(0, true)
        if (!reduceMotion) setPlaying(true)
    }, [scenarioKey, seek, reduceMotion])

    // The whole screen flashes when the playing timeline crosses into High or Critical.
    // The camera pushes in on the same day as the flash. Only the scanner moving on a
    // day or so counts: a jump (a seek, the replay after a what-if change, the loop
    // back to the start) is not a crossing, and both days are read from the same curve.
    const [alarm, setAlarm] = useState<{ id: number; color: string } | null>(null)
    useEffect(() => {
        const previous = alarmDay.current
        alarmDay.current = day
        const step = day - previous
        if (!playing || reduceMotion || step < 1 || step > 3) return
        const level = frameAt(day).level
        if (LEVEL_RANK[level] > LEVEL_RANK[frameAt(previous).level] && (level === 'High' || level === 'Critical')) {
            const id = Date.now()
            setAlarm({ id, color: LEVEL_COLOR[level] })
            setFocus({ key: id, day })
        }
    }, [day, playing, frameAt, reduceMotion, LEVEL_COLOR])

    // Pop up each event as the playing scanner reaches it.
    const toastId = useRef(0)
    useEffect(() => {
        if (!playing) return
        const hits = events.filter(event => event.day === day)
        if (!hits.length) return
        const fresh = hits.map(event => ({ ...event, id: ++toastId.current }))
        setToasts(current => [...current, ...fresh].slice(-3))
        const timer = window.setTimeout(() => {
            setToasts(current => current.filter(toast => !fresh.some(item => item.id === toast.id)))
        }, 2800)
        return () => window.clearTimeout(timer)
    }, [day, playing, events])

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === ' ' || event.key === 'k') {
            event.preventDefault()
            setPlaying(value => !value)
        } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            seek(day + 1)
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            seek(day - 1)
        }
    }

    /* ------------------------------------------------ render */
    // Columns always show their risk level, in both modes, so a what-if never
    // makes a Critical day look safe. Saved history stays lilac.
    const colorFor = useCallback(
        (point: SkylinePoint) => (point.day < 0 ? PAST_COLOR : LEVEL_COLOR[point.level]),
        [PAST_COLOR, LEVEL_COLOR]
    )
    const current = frameAt(day)
    const currentColor = day < 0 ? PAST_COLOR : LEVEL_COLOR[current.level]
    // Only the label says what-if, in the what-if colour.
    const phaseColor = day > 0 && whatIf ? WHAT_IF_COLOR : currentColor
    const coreColor = LEVEL_COLOR[current.level]
    // Mood lighting: the whole scene takes the colour of the level on screen.
    useEffect(() => {
        heroRef.current?.closest<HTMLElement>('.twin-root')?.setAttribute('data-mood', current.level)
    }, [current.level])
    const phase = day < 0 ? 'Saved history' : day === 0 ? (whatIf ? 'Now, with your changes' : 'Now') : whatIf ? 'What if' : 'If nothing changes'
    const date = dayjs(start).add(day, 'day')
    const pct = (value: number) => `${((value + pastDays) / Math.max(1, pastDays + horizon)) * 100}%`
    const ticks = [-pastDays, 0, ...record.outlook.horizons.map(item => item.days)].filter((value, index, list) => list.indexOf(value) === index)
    const ghost = whatIf ? baseline : null
    // Why the score is what it is on the day shown (saved days keep only their score).
    const reasons = day >= 0 ? computeRiskScore(scenarioInputsAt(record, activeScenario ?? NO_CHANGE_SCENARIO, day)).breakdown : null
    const status = record.outlook.status
    const statusColor = status.label === 'Needs attention'
        ? LEVEL_COLOR.Critical
        : status.label === 'Mitigation in progress' ? palette.accent.violet : palette.accent.emerald

    return (
        <section ref={heroRef} className='tl-hero' tabIndex={0} onKeyDown={onKeyDown} aria-label='Needs-attention timeline. Space plays or pauses, arrow keys step a day.'>
            <svg className={`tl-beam ${introDone ? '' : 'is-waiting'}`} aria-hidden style={{ ['--tl-color' as any]: currentColor }}>
                <path ref={element => { beamRefs.current[0] = element }} className='tl-beam-glow' />
                <path ref={element => { beamRefs.current[1] = element }} className='tl-beam-core' />
            </svg>
            {alarm && <div key={alarm.id} className='tl-alarm' style={{ ['--alarm' as any]: alarm.color }} aria-hidden />}
            <div className='tl-core' ref={coreRef}>
                <CoreReactor
                    score={current.score}
                    level={current.level}
                    color={coreColor}
                    live
                    caption={<>{dayLabel(day)}<br />{date.format('ddd D MMM YYYY')}</>}
                />
                <div className='tl-why'>
                    <div className='tl-why-label'>{reasons ? `Why ${current.score} ${day === 0 ? 'today' : dayLabel(day).toLowerCase()}` : 'Saved score for that day'}</div>
                    {reasons && (
                        <div className='tl-reasons'>
                            {reasons.map(reason => (
                                <span key={reason.label} className='tl-reason'>
                                    {reason.label}<b>{reason.delta > 0 ? `+${reason.delta}` : reason.delta}</b>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className='tl-next' style={{ ['--status' as any]: statusColor }}>
                    <div className='tl-next-head'>
                        <span>Next action</span>
                        <span className='tl-status'>{status.label}</span>
                    </div>
                    <div className='tl-next-text'>{record.outlook.nextAction}</div>
                </div>
            </div>

            <div className='tl-main'>
                <div className='tl-head'>
                    <div className='tl-readout' style={{ ['--tl-color' as any]: currentColor }}>
                        <div className='tl-phase' style={{ color: phaseColor, textShadow: `0 0 10px ${phaseColor}` }}>{phase}</div>
                        <div className='tl-day'>{dayLabel(day)}</div>
                        <div className='tl-date'>{date.format('dddd D MMMM YYYY')}</div>
                    </div>
                    <div className='twin-tabs twin-tabs-inline tl-tabs' role='tablist' aria-label='Outlook mode'>
                        <button role='tab' aria-selected={mode === 'nothing-changes'} className={`twin-tab ${mode === 'nothing-changes' ? 'is-active' : ''}`}
                            onClick={() => onModeChange('nothing-changes')}>
                            If nothing changes
                        </button>
                        <button role='tab' aria-selected={mode === 'what-if'} className={`twin-tab twin-tab-whatif ${mode === 'what-if' ? 'is-active' : ''}`}
                            onClick={() => onModeChange('what-if')}>
                            What if…
                        </button>
                    </div>
                </div>

                <div className='tl-stage' ref={stageRef}>
                    {/* The floor under the columns is lit in the colour of the day's level. */}
                    <MoodLight className='tl-mood' />
                    <Skyline
                        ref={skylineRef}
                        frames={frames}
                        ghost={ghost}
                        pastDays={pastDays}
                        day={day}
                        colorFor={colorFor}
                        scannerColor={currentColor}
                        beacons={events.filter(event => event.day !== 0).map(event => ({ key: event.key, day: event.day, color: TONE_COLOR[event.tone] }))}
                        onSeek={seek}
                        aspect={aspect}
                        motion={!reduceMotion}
                        focus={focus}
                        onIntroDone={handleIntroDone}
                        onCameraMove={followCamera}
                    />

                    <div className='tl-toasts' aria-live='polite'>
                        <AnimatePresence>
                            {toasts.map(toast => (
                                <motion.div
                                    key={toast.id}
                                    className='tl-toast'
                                    style={{ ['--tone' as any]: TONE_COLOR[toast.tone] }}
                                    initial={{ opacity: 0, x: 40, scale: 0.9 }}
                                    animate={{ opacity: 1, x: 0, scale: 1 }}
                                    exit={{ opacity: 0, x: 30 }}
                                    transition={{ duration: 0.35 }}
                                >
                                    <span>{dayLabel(toast.day)}</span>
                                    {toast.label}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>

                <div className='tl-controls'>
                    <button className='tl-play' onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pause' : 'Play'}>
                        {playing ? <PauseOutlined /> : <CaretRightFilled />}
                    </button>
                    <button className='twin-btn tl-small' onClick={() => { seek(-pastDays, true); setPlaying(true) }} aria-label='Play from the start'>
                        <StepBackwardOutlined />
                    </button>
                    <button className='twin-btn tl-small' onClick={() => seek(0)}>Today</button>
                    <button className='twin-btn tl-small' onClick={() => setSpeed(value => (value >= 4 ? 1 : value * 2))} aria-label='Playback speed'>
                        <FastForwardOutlined /> {speed}×
                    </button>

                    <div className='tl-scrub'>
                        <div className='tl-scrub-track'>
                            <div className='tl-scrub-fill' style={{ width: pct(day), background: currentColor }} />
                            <div className='tl-scrub-today' style={{ left: pct(0) }} />
                            <div className='tl-scrub-thumb' style={{ left: pct(day), ['--tl-color' as any]: currentColor }} />
                            {events.map(event => (
                                <button
                                    key={event.key}
                                    className='tl-marker'
                                    style={{ left: pct(event.day), ['--tone' as any]: TONE_COLOR[event.tone] }}
                                    onClick={() => seek(event.day)}
                                    title={`${dayLabel(event.day)}: ${event.label}`}
                                    aria-label={`${dayLabel(event.day)}: ${event.label}`}
                                />
                            ))}
                        </div>
                        <input
                            className='tl-range'
                            type='range'
                            min={-pastDays}
                            max={horizon}
                            step={1}
                            value={day}
                            onChange={event => seek(Number(event.target.value))}
                            aria-label='Day on the timeline'
                            aria-valuetext={`${dayLabel(day)}, score ${current.score} ${current.level}`}
                        />
                        <div className='tl-ticks'>
                            {ticks.map(value => (
                                <span key={value} style={{ left: pct(value) }} className={value === 0 ? 'is-today' : ''}>
                                    {value === 0 ? 'Today' : value < 0 ? `${-value}d ago` : `+${value}d`}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {mode === 'what-if' && (
                    <motion.div className='tl-whatif-wrap' initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.4 }}>
                        <WhatIfControls record={record} scenario={scenario} onChange={onScenarioChange} horizonDays={horizon} />
                    </motion.div>
                )}
            </div>
        </section>
    )
}
