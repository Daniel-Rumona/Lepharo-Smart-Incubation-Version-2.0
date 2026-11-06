import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Slider } from 'antd'
import { CaretRightOutlined, PauseOutlined, UndoOutlined } from '@ant-design/icons'
import { useReducedMotion } from 'framer-motion'
import { WORK_STAGES, type WorkStage } from '@/services/digitalTwin/simulation'
import { useScenario } from './ScenarioState'
import { headline } from './BacklogChart'

export type SceneStation = { key: string; name: string; unit: string; count: number; late: number; note: string }
type Level = 'idle' | 'ok' | 'late' | 'slow'

const OTHERS = '#8d9bb5'
const COLOUR: Record<Level, string> = { idle: '#7388a8', ok: '#4f8dff', late: '#f0b13a', slow: '#ef5a54' }
// The four simulated teams, in the order work flows.
const MODULES: Array<{ stage: WorkStage; key: string; name: string; unit: string }> = [
    { stage: 'delivery', key: 'delivery', name: 'Delivery', unit: 'interventions' },
    { stage: 'hod', key: 'hod', name: 'Head of dept. review', unit: 'interventions' },
    { stage: 'cc', key: 'cc', name: 'Centre coordinator', unit: 'interventions' },
    { stage: 'me', key: 'me', name: 'M&E quality check', unit: 'interventions' }
]

/** A small isometric cube: three faces. Positions are on a local grid; (gx, gy) across, gz up. */
const CUBE_W = 11, CUBE_H = 12
const iso = (gx: number, gy: number, gz: number) => ({ x: (gx - gy) * CUBE_W, y: (gx + gy) * CUBE_W * 0.5 - gz * CUBE_H })
const pt = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`
function Cube({ gx, gy, gz, colour }: { gx: number; gy: number; gz: number; colour: string }) {
    const a = (dx: number, dy: number, dz: number) => iso(gx + dx, gy + dy, gz + dz)
    return <g>
        <polygon points={[a(0, 1, 0), a(1, 1, 0), a(1, 1, 1), a(0, 1, 1)].map(pt).join(' ')} style={{ fill: `color-mix(in srgb, ${colour} 64%, var(--ts-shade))` }} />
        <polygon points={[a(1, 0, 0), a(1, 1, 0), a(1, 1, 1), a(1, 0, 1)].map(pt).join(' ')} style={{ fill: `color-mix(in srgb, ${colour} 42%, var(--ts-shade))` }} />
        <polygon points={[a(0, 0, 1), a(1, 0, 1), a(1, 1, 1), a(0, 1, 1)].map(pt).join(' ')} style={{ fill: `color-mix(in srgb, ${colour} 78%, var(--ts-lite))` }} />
    </g>
}
/** A pile of cubes, 3 x 3 per layer; the first `grey` cubes are the records the model does not move. Drawn back to front. */
function Pile({ cubes, colour, grey = 0 }: { cubes: number; colour: string; grey?: number }) {
    const items = Array.from({ length: cubes }, (_, i) => ({ i, gz: Math.floor(i / 9), gx: (i % 9) % 3, gy: Math.floor((i % 9) / 3) })).sort((p, q) => p.gz - q.gz || (p.gx + p.gy) - (q.gx + q.gy))
    return <g>{items.map(c => <Cube key={c.i} gx={c.gx - 1.5} gy={c.gy - 1.5} gz={c.gz} colour={c.i < grey ? OTHERS : colour} />)}</g>
}

const addDay = (iso: string) => new Date(Date.parse(iso + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)

// Arch layout: x positions are fractions of the page width, so the teams spread across whatever width there is; y positions are pixels.
/** The row with the view buttons and the critical notice is hidden for now. Set this to true, or put 'show' in localStorage under 'twinTopRow', to bring it back. */
const TOP_ROW_VISIBLE = false
const showTopRow = () => { if (TOP_ROW_VISIBLE) return true; try { return window.localStorage.getItem('twinTopRow') === 'show' } catch { return false } }
/** What each team's count means today, in that team's own words. */
const READY: Record<string, string> = { delivery: 'due to deliver', hod: 'to approve', cc: 'to validate', me: 'to check' }
const ARCH_H = 498, WIDE_FROM = 900
const AX = { delivery: .115, smes: .2, hod: .42, core: .5, cc: .755, me: .885 } as const
const AY = { top: 195, side: 300, core: 300, topCard: 58, sideCard: 405 } as const

/**
 * The programme as a living model. The core is the programme; the four teams sit on an arch around it, each with a pile of
 * cubes for the work waiting there and a card with a dial. Drag a dial and the model re-runs at once: piles, flow and the core
 * change, with the "if nothing changes" value kept beside them. The slider moves through the simulated weeks.
 * On a wide page the arch spreads across the whole width; on a narrow one the teams become a two-column grid. Follows the site's theme.
 */
export function TwinScene({ outside, onSeeAll, peek, notice, nav, deliveryRecords, deliveryOwners, smes }: { outside: SceneStation[]; onSeeAll: () => void; peek: Record<string, { total: number; lines: string[] }>; notice?: React.ReactNode; nav?: React.ReactNode; deliveryRecords: number; deliveryOwners: Record<string, number>; smes: { count: number } }) {
    const reduced = useReducedMotion()
    const s = useScenario()
    const run = s.run
    const rootRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1200 : window.innerWidth)
    const [step, setStep] = useState(0), [playing, setPlaying] = useState(false)
    const frames = run ? run.scenario.days.length : 0   // frame 0 is today's starting position; frame k is the start of day k
    useEffect(() => {
        const el = rootRef.current; if (!el) return
        const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
        measure()
        if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }
        const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect()
    }, [])
    useEffect(() => { if (step > frames) setStep(frames) }, [step, frames])
    useEffect(() => {
        if (!playing || !run) return
        const timer = window.setInterval(() => setStep(k => { if (k >= frames) { setPlaying(false); return k } return k + 1 }), 90)
        return () => window.clearInterval(timer)
    }, [playing, run, frames])

    // Where each team's queue starts: the work that is ready today, straight from the captured starting point.
    const start = useMemo(() => {
        const queues: Record<WorkStage, number> = { delivery: 0, hod: 0, cc: 0, me: 0 }
        let later = 0
        for (const u of run?.snapshot.units || []) { if (u.releaseDay <= 0) queues[u.stage] += u.members; else later += u.members }
        // Delivery records the model does not move. Each waits on the owner its own record names: the SME, or the facilitator.
        const modelDelivery = (run?.snapshot.units || []).filter(u => u.stage === 'delivery').reduce((n, u) => n + u.members, 0)
        // The model's own Delivery units are all facilitator work, so take them off the facilitator count to leave only the records it does not move.
        const owners: Record<string, number> = { ...deliveryOwners }
        if (owners.Facilitator !== undefined) owners.Facilitator = Math.max(0, owners.Facilitator - modelDelivery)
        // Records waiting on an SME belong to the SMEs card, so Delivery keeps only the ones that wait on someone else (in practice the facilitator).
        const othersTotal = Math.max(0, deliveryRecords - modelDelivery), smeOwned = Math.min(othersTotal, owners.SME || 0)
        const names = Object.entries(owners).filter(([who, c]) => who !== 'SME' && c > 0).map(([who]) => who === 'Facilitator' ? 'facilitators' : who === 'HOD' ? 'the head of department' : who)
        return { queues, backlog: WORK_STAGES.reduce((n, st) => n + queues[st], 0), later, others: othersTotal - smeOwned, waitingOn: names.join(' and ') }
    }, [run, deliveryRecords, deliveryOwners])
    // One cube stands for the same number of units everywhere, so piles stay comparable while scrubbing.
    const unit = useMemo(() => {
        if (!run) return 1
        let peak = Math.max(1, smes.count, start.queues.delivery + start.others, ...WORK_STAGES.map(st => start.queues[st]))
        for (const r of [run.baseline, run.scenario]) for (const d of r.days) for (const st of WORK_STAGES) peak = Math.max(peak, d.queues[st] + (st === 'delivery' ? start.others : 0))
        return Math.max(1, Math.ceil(peak / 36))
    }, [run, start])

    const top = showTopRow() ? <div className="ts-top"><div className="ts-nav">{nav}</div>{notice && <div className="ts-notice">{notice}</div>}</div> : null
    if (!run) return <div className="ts-root" ref={rootRef}>{top}<div className="ts-wait" role="status">Preparing the model…</div></div>

    // Frame 0 is the same in both runs: the starting position is real, so no dial can change it.
    const pick = (r: typeof run.baseline, k: number) => k === 0 ? { backlog: start.backlog, queues: start.queues } : r.days[k - 1]
    const k = Math.min(step, frames), now = pick(run.scenario, k), was = pick(run.baseline, k)
    const dateOf = (i: number) => i < frames ? run.scenario.days[i].date : addDay(run.scenario.days[frames - 1].date)
    const dateText = (i: number) => new Date(dateOf(i) + 'T12:00:00Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const active = s.extraHours > 0 || s.extraCc > 0 || s.extraMe > 0 || s.extraSMEs > 0 || s.scenarioWindows !== s.assumptions.hodWindows
    const pressure = (stage: WorkStage): Level => { const q = now.queues[stage], q0 = start.queues[stage]; return q === 0 ? 'idle' : q > q0 * 1.25 + 2 ? 'slow' : q > q0 ? 'late' : 'ok' }
    const cleared = start.backlog ? Math.max(0, Math.min(1, 1 - now.backlog / start.backlog)) : 1
    const R = 62, circ = 2 * Math.PI * (R + 6)
    const diff = now.backlog - was.backlog
    const leftOut = Object.values(run.snapshot.excluded).reduce((a, b) => a + b, 0)
    const dial = (stage: WorkStage) => stage === 'delivery'
        ? { label: 'More facilitator time', value: s.extraHours, min: 0, max: 40, set: s.setExtraHours, shown: (v: number) => `+${v} h/wk` }
        : stage === 'hod' ? { label: 'Review days a week', value: s.scenarioWindows, min: 0, max: 5, set: s.setScenarioWindows, shown: (v: number) => `${v} ${v === 1 ? 'day' : 'days'}` }
            : stage === 'cc' ? { label: 'More coordinator time', value: s.extraCc, min: 0, max: 20, set: s.setExtraCc, shown: (v: number) => `+${v} h/wk` }
                : { label: 'More M&E time', value: s.extraMe, min: 0, max: 20, set: s.setExtraMe, shown: (v: number) => `+${v} h/wk` }
    const reset = () => { s.setExtraHours(0); s.setExtraCc(0); s.setExtraMe(0); s.setExtraSMEs(0); s.setScenarioWindows(s.assumptions.hodWindows) }
    const wide = width >= WIDE_FROM

    // What a team shows, in either layout.
    const facts = (m: typeof MODULES[number]) => {
        const q = now.queues[m.stage], base = was.queues[m.stage], level = pressure(m.stage), delta = q - base
        const others = m.stage === 'delivery' ? start.others : 0, greyCubes = Math.min(36, Math.ceil(others / unit))
        return { q, base, level, delta, others, greyCubes, cubes: Math.min(36, greyCubes + Math.ceil(q / unit)), ghost: Math.min(36, greyCubes + Math.ceil(base / unit)) }
    }
    const pile = (m: typeof MODULES[number], px: number, py: number, scale = 1) => {
        const f = facts(m)
        return <g key={m.key} className={`ts-module ${f.level}`} role="img" aria-label={`${m.name}: ${f.q} ${m.unit} waiting in the model`} transform={`translate(${px} ${py}) scale(${scale})`}>
                <ellipse cx={0} cy={22} rx={62} ry={26} className="ts-pad" style={{ stroke: COLOUR[f.level] }} />
                {active && f.ghost !== f.cubes && <g style={{ opacity: .35 }}><Pile cubes={f.ghost} colour="#9fb7dc" grey={f.greyCubes} /></g>}
                <Pile cubes={f.cubes} colour={COLOUR[f.level]} grey={f.greyCubes} />
        </g>
    }
    const cardBody = (m: typeof MODULES[number]) => {
        const f = facts(m), x = dial(m.stage)
        return <>
            <header><i style={{ background: COLOUR[f.level] }} aria-hidden="true" /><span>{m.name}</span></header>
            <div className="ts-num"><b>{f.q}</b><small>{k === 0 ? READY[m.stage] : `by ${dateText(k)}`}</small></div>
            <p className="ts-sub">{active && f.delta !== 0 ? <span className={f.delta < 0 ? 'good' : 'bad'}>{f.delta < 0 ? '▼' : '▲'} {Math.abs(f.delta)} {f.delta < 0 ? 'fewer' : 'more'} than if nothing changes</span> : k === 0 && m.stage === 'delivery' && start.later ? `${start.later} more scheduled for later days` : '\u00a0'}</p>
            {f.others > 0 && <p className="ts-sub ts-others"><i aria-hidden="true" />{f.others} more waiting on {start.waitingOn || 'others'}</p>}
            <label className="ts-dial"><span>{x.label}<b>{x.shown(x.value)}</b></span>
                <Slider aria-label={x.label} min={x.min} max={x.max} value={x.value} onChange={v => x.set(v)} tooltip={{ open: false }} /></label>
        </>
    }
    // The SMEs: everyone waiting on an SME, in one place. The model has no SME response time, so there is no dial.
    const smesCubes = Math.min(36, Math.ceil(smes.count / unit))
    const smesPile = (px: number, py: number, scale = 1) => <g key="smes" className="ts-smes-pile" role="img" aria-label={`SMEs: ${smes.count} records waiting on them`} transform={`translate(${px} ${py}) scale(${scale})`}>
        <ellipse cx={0} cy={22} rx={62} ry={26} className="ts-pad" style={{ stroke: OTHERS }} /><Pile cubes={smesCubes} colour={OTHERS} grey={smesCubes} />
    </g>
    const smesCard = (style?: React.CSSProperties) => <div key="smes-card" className="ts-card ts-smes" style={style}>
        <header><i style={{ background: OTHERS }} aria-hidden="true" /><span>SMEs</span></header>
        <div className="ts-num"><b>{smes.count}</b><small>waiting on SMEs</small></div>
        <p className="ts-sub">to confirm completion and sign</p>
        <p className="ts-sub ts-note">not in the model</p>
    </div>
    const coreArt = <>
        <defs>
            <radialGradient id="ts-core" cx="50%" cy="42%" r="60%"><stop offset="0" style={{ stopColor: 'var(--ts-core1)' }} /><stop offset=".45" style={{ stopColor: 'var(--ts-core2)' }} /><stop offset="1" style={{ stopColor: 'var(--ts-core3)' }} /></radialGradient>
            <filter id="ts-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
    </>
    const orb = <>
        <g className="ts-core-orbit"><ellipse rx={118} ry={36} className="ts-ring r1" /><ellipse rx={150} ry={46} className="ts-ring r2" /></g>
        <ellipse cx={0} cy={84} rx={86} ry={20} className="ts-core-shadow" />
        <circle r={R + 14} className="ts-core-halo" filter="url(#ts-blur)" style={{ fill: COLOUR[cleared > .66 ? 'ok' : cleared > .33 ? 'late' : 'slow'] }} />
        <circle r={R} fill="url(#ts-core)" />
        <circle r={R + 6} className="ts-core-track" />
        <circle r={R + 6} className="ts-core-arc" strokeDasharray={circ} strokeDashoffset={circ * (1 - cleared)} transform="rotate(-90)" />
    </>
    const coreText = <div className="ts-core-text"><b>{now.backlog}</b><span>interventions open</span><small>{k === 0 ? 'today' : `by ${dateText(k)}`}</small></div>
    const coreDelta = <div className="ts-core-delta">
        {active && diff !== 0 ? <>If nothing changes: <b>{was.backlog}</b><em className={diff < 0 ? 'good' : 'bad'}> ({diff > 0 ? '+' : ''}{diff})</em></> : active ? <>Same as if nothing changes: <b>{was.backlog}</b></> : null}
    </div>
    const pill = (o: SceneStation, style?: React.CSSProperties) => <button key={o.key} type="button" className={`ts-outside ${o.key}`} style={style} onClick={onSeeAll} aria-label={`${o.name}: ${o.count} ${o.unit}${o.late ? `, ${o.late} late` : ''}. See it in Current state.`}><span>{o.name}</span><b>{o.count}</b><small>{o.unit} · not in the model</small></button>
    const intake = (style?: React.CSSProperties) => <div className="ts-card ts-intake" style={style}>
        <label className="ts-dial"><span>New SMEs joining<b>{s.extraSMEs ? `+${s.extraSMEs}` : 'none'}</b></span>
            <Slider aria-label="New SMEs joining" min={0} max={100} value={s.extraSMEs} onChange={v => s.setExtraSMEs(v)} tooltip={{ open: false }} /></label>
    </div>

    // ---- wide: the arch spreads across the whole width ----
    const W = Math.max(width, WIDE_FROM), px = (f: number) => f * W
    const flow = `M${px(AX.delivery)} ${AY.side} Q${px(AX.delivery) + 8} ${AY.top} ${px(AX.smes)} ${AY.top} L${px(AX.cc)} ${AY.top} Q${px(AX.me) - 8} ${AY.top} ${px(AX.me)} ${AY.side}`
    const archX: Record<string, number> = { delivery: AX.delivery, hod: AX.hod, cc: AX.cc, me: AX.me }
    const arch = <div className="ts-stage" style={{ height: ARCH_H }}>
        <svg className="ts-svg" width={W} height={ARCH_H} viewBox={`0 0 ${W} ${ARCH_H}`} aria-hidden="false" role="group" aria-label="The programme model">
            {coreArt}
            <ellipse className="ts-floor" cx={px(AX.core)} cy={385} rx={W * .47} ry={118} />
            <path d={flow} className="ts-flow-glow" filter="url(#ts-blur)" />
            <path d={flow} className="ts-flow" />
            {!reduced && [0, 1, 2, 3, 4].map(i => <circle key={i} r={4.5} className="ts-packet"><animateMotion dur="10s" begin={`${-i * 2}s`} repeatCount="indefinite" path={flow} /></circle>)}
            <line className="ts-tether" x1={px(AX.core)} y1={AY.core - 40} x2={px(AX.smes)} y2={AY.top + 18} />
            {MODULES.map(m => <line key={m.key} className="ts-tether" x1={px(AX.core)} y1={AY.core - 40} x2={px(archX[m.key])} y2={(m.stage === 'hod' || m.stage === 'cc' ? AY.top : AY.side) + 18} />)}
            <g transform={`translate(${px(AX.core)} ${AY.core})`}>{orb}</g>
            {smesPile(px(AX.smes), AY.top)}
            {MODULES.map(m => pile(m, px(archX[m.key]), m.stage === 'hod' || m.stage === 'cc' ? AY.top : AY.side))}
        </svg>
        <div className="ts-core-text-pos" style={{ left: px(AX.core), top: AY.core }}>{coreText}</div>
        <div className="ts-pos" style={{ left: px(AX.core), top: AY.core + 118 }}>{coreDelta}</div>
        {smesCard({ position: 'absolute', transform: 'translate(-50%,-50%)', left: px(AX.smes), top: AY.topCard })}
        {MODULES.map(m => <div key={m.key} className={`ts-card ts-pos ${facts(m).level}`} style={{ left: px(archX[m.key]), top: m.stage === 'hod' || m.stage === 'cc' ? AY.topCard : AY.sideCard }}>{cardBody(m)}</div>)}
        {outside[0] && pill(outside[0], { position: 'absolute', transform: 'translate(-50%,-50%)', left: px(.665), top: 392 })}
        {intake({ position: 'absolute', transform: 'translate(-50%,-50%)', left: px(AX.core), top: 468 })}
    </div>

    // ---- narrow: two columns, each team with its own small pile ----
    const grid = <div className="ts-grid">
        <div className="ts-core">
            <svg viewBox="-170 -96 340 192" aria-hidden="true">{coreArt}{orb}</svg>
            {coreText}
        </div>
        {coreDelta}
        <div className="ts-cols">
            {MODULES.flatMap((m, i) => [<div key={m.key} className="ts-col">
                <svg className="ts-pile" viewBox="-90 -110 180 150" role="group" aria-label={m.name}>{pile(m, 0, 0)}</svg>
                <div className={`ts-card ${facts(m).level}`}>{cardBody(m)}</div>
            </div>, ...(i === 0 ? [<div key="smes" className="ts-col"><svg className="ts-pile" viewBox="-90 -110 180 150" role="group" aria-label="SMEs">{smesPile(0, 0)}</svg>{smesCard()}</div>] : [])])}
        </div>
        <div className="ts-strip">{outside[0] && pill(outside[0])}{intake()}</div>
    </div>

    return <div className="ts-root" ref={rootRef} data-guide="twin-overview-model">
        {top}
        {wide ? arch : grid}
        <div className="ts-time">
            <Button shape="circle" type="primary" aria-label={playing ? 'Pause' : 'Play the next weeks'} icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={() => { if (k >= frames) setStep(0); setPlaying(p => !p) }} />
            <div className="ts-slide">
                <Slider aria-label="Days ahead" min={0} max={frames} value={k} onChange={v => { setPlaying(false); setStep(v) }} tooltip={{ formatter: v => (v === undefined ? '' : v === 0 ? 'Today' : dateText(v)) }} />
                <div className="ts-axis"><span>Today</span><span>{dateText(frames)} · {s.assumptions.weeks} weeks ahead</span></div>
            </div>
            <Button shape="round" size="small" icon={<UndoOutlined />} disabled={!active} onClick={reset}>Reset dials</Button>
        </div>
        <p className="ts-headline">{headline(run.baseline, run.scenario, run.baselineAssumptions.inflowPerWeek, active)}
        </p>
    </div>
}
