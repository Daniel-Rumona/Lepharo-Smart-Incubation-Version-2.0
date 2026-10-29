import React, { useEffect, useMemo, useState } from 'react'
import { WORK_STAGES, type SimulationResult, type WorkStage } from '@/services/digitalTwin/simulation'
import { clearDay } from '@/services/digitalTwin/goalSeek'

export const STAGE_NAME: Record<WorkStage, string> = { delivery: 'Delivery', hod: 'Head of dept. review', cc: 'Centre coordinator confirms', me: 'M&E quality check' }
/** Wide layout for desktop; a narrower, taller one on phones so the text stays readable and the chart has height. */
const WIDE = { VW: 720, VH: 236, X0: 44, W: 656, TOP: 26, BOTTOM: 196 }, NARROW = { VW: 360, VH: 300, X0: 34, W: 316, TOP: 24, BOTTOM: 262 }
function useCompact() {
    const q = '(max-width: 640px)', [c, setC] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches)
    useEffect(() => { if (!window.matchMedia) return; const m = window.matchMedia(q), on = () => setC(m.matches); on(); m.addEventListener?.('change', on); return () => m.removeEventListener?.('change', on) }, [])
    return c
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const parts = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], weekday: d.getUTCDay() } }
const short = (iso: string) => { const p = parts(iso); return `${p.day} ${p.month}` }
const long = (iso: string) => { const p = parts(iso); return `${DAYS[p.weekday]} ${p.day} ${p.month}` }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Words first: when does the backlog clear, with and without the change. */
/** With steady new work the backlog rarely reaches zero, so describe where it is heading instead. */
function trendOf(r: SimulationResult) {
    const n = r.days.length, end = r.days[n - 1].backlog, prev = r.days[Math.max(0, n - 8)].backlog, d = end - prev, tol = Math.max(1, end * 0.1)
    return { end, word: d > tol ? 'still growing' : d < -tol ? 'shrinking' : 'holding steady' }
}
/** Before any change is chosen there is only one future to describe. */
function unchangedHeadline(base: SimulationResult, inflow: number): string {
    const b = clearDay(base), weeks = Math.round(base.days.length / 7), hint = ' Pick a change above to see how it would differ.'
    if (base.days[0].backlog === 0 && b === 0) return 'Nothing is waiting to start with, so there is no backlog to clear.'
    if (b !== null) return `If nothing changes, the open interventions clear on ${short(base.days[b].date)}.${hint}`
    if (inflow > 0) { const t = trendOf(base); return `If nothing changes, the backlog is ${t.word}, ending at ${plural(t.end, 'open intervention')} after ${plural(weeks, 'week')}.${hint}` }
    return `If nothing changes, ${plural(base.backlog, 'open intervention')} are still waiting after ${plural(weeks, 'week')}.${hint}`
}
export function headline(base: SimulationResult, scen: SimulationResult, inflow = 0, changed = true): string {
    if (!changed) return unchangedHeadline(base, inflow)
    const b = clearDay(base), s = clearDay(scen), end = scen.days.length, weeks = Math.round(end / 7)
    if (inflow > 0 && !(b !== null && s !== null)) {
        const tb = trendOf(base), ts = trendOf(scen)
        const same = scen.days.every((d, i) => d.backlog === base.days[i].backlog)
        return same ? `New work keeps arriving, so the backlog is ${ts.word} and ends at ${plural(ts.end, 'open intervention')} after ${plural(weeks, 'week')}, with or without the change.`
            : `With new work arriving, if nothing changes the backlog is ${tb.word}, ending at ${plural(tb.end, 'open intervention')}. With your change it is ${ts.word}, ending at ${ts.end}.`
    }
    if (scen.days[0].backlog === 0 && base.days[0].backlog === 0) return 'Nothing is waiting to start with, so there is no backlog to clear.'
    const same = scen.days.every((d, i) => d.backlog === base.days[i].backlog)
    if (s !== null && b !== null) {
        if (same || s === b) return `The backlog clears on ${short(scen.days[s].date)} ${same ? 'whether or not you make the change' : 'either way'}, so this change does not speed it up.`
        const gap = Math.abs(b - s)
        return s < b ? `With your change the backlog clears on ${short(scen.days[s].date)}, ${plural(gap, 'day')} sooner than if nothing changes (${short(base.days[b].date)}).`
            : `With your change the backlog clears on ${short(scen.days[s].date)}, ${plural(gap, 'day')} later than if nothing changes (${short(base.days[b].date)}).`
    }
    if (s !== null) return `With your change everything clears on ${short(scen.days[s].date)}. If nothing changes, ${plural(base.backlog, 'open intervention')} are still waiting after ${plural(weeks, 'week')}.`
    if (b !== null) return `If nothing changes it clears by ${short(base.days[b].date)}, but with your change ${plural(scen.backlog, 'open intervention')} are still waiting after ${plural(weeks, 'week')}.`
    return `Neither clears within ${plural(weeks, 'week')}: ${plural(scen.backlog, 'open intervention')} still waiting with your change, ${base.backlog} if nothing changes.`
}

type Props = { baseline: SimulationResult; scenario: SimulationResult; closedDates: string[]; inflowPerWeek?: number; changed?: boolean; afterHeadline?: React.ReactNode; hideHeadline?: boolean; sideExtra?: React.ReactNode }

export function BacklogChart({ baseline, scenario, closedDates, inflowPerWeek = 0, changed = true, afterHeadline, hideHeadline = false, sideExtra }: Props) {
    const [cursor, setCursor] = useState(0), [focus, setFocus] = useState<WorkStage | null>(null), compact = useCompact()
    const { VW, VH, X0, W, TOP, BOTTOM } = compact ? NARROW : WIDE
    const days = scenario.days, last = Math.max(1, days.length - 1)
    const x = (i: number) => X0 + i / last * W
    const view = useMemo(() => {
        const peak = Math.max(1, ...days.map(d => d.backlog), ...baseline.days.map(d => d.backlog))
        const y = (v: number) => BOTTOM - v / peak * (BOTTOM - TOP)
        const tops = days.map(d => { let acc = 0; return WORK_STAGES.map(s => (acc += d.queues[s])) })
        const bands = WORK_STAGES.map((stage, k) => {
            const upper = days.map((_, i) => `${x(i)},${y(tops[i][k])}`)
            const lower = days.map((_, i) => `${x(i)},${y(k ? tops[i][k - 1] : 0)}`).reverse()
            return { stage, d: `M${upper.join(' L')} L${lower.join(' L')} Z` }
        })
        const baseLine = baseline.days.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.backlog)}`).join(' ')
        const differs = days.some((d, i) => d.backlog !== baseline.days[i].backlog)
        const off = days.map(d => { const wd = parts(d.date).weekday; return wd === 0 || wd === 6 || closedDates.includes(d.date) })
        const ticks = days.map((d, i) => ({ d, i })).filter(({ i }) => i % (compact ? 14 : 7) === 0)
        return { peak, y, bands, baseLine, differs, off, ticks }
    }, [baseline, scenario, closedDates, compact]) // eslint-disable-line react-hooks/exhaustive-deps
    const sClear = clearDay(scenario), bClear = clearDay(baseline)
    const at = Math.min(cursor, days.length - 1)
    const here = days[at], hereBase = baseline.days[at]
    const step = (next: number) => setCursor(Math.max(0, Math.min(last, next)))
    const stageMax = Math.max(1, ...WORK_STAGES.map(s => here.queues[s]))
    const diff = here.backlog - hereBase.backlog
    const slot = W / last
    const mark = (i: number, label: string, cls: string, row: number) => <g key={cls} className={`bl-mark ${cls}`}><line x1={x(i)} x2={x(i)} y1={TOP - 4} y2={BOTTOM} /><text x={Math.min(x(i) + 5, X0 + W - 4)} y={TOP + 2 + row * 13} textAnchor={x(i) > X0 + W - (compact ? 70 : 90) ? 'end' : 'start'}>{label}</text></g>

    return <div className="bl">
        {!hideHeadline && <p className="bl-headline">{headline(baseline, scenario, inflowPerWeek, changed)}</p>}
        {afterHeadline}
        <div className="bl-body">
        <svg viewBox={`0 0 ${VW} ${VH}`} role="img" tabIndex={0} aria-label="Baseline and scenario backlog over the simulation horizon, stacked by team. Use the left and right arrow keys to inspect each day."
            onKeyDown={event => { const next = event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? last : null; if (next === null) return; event.preventDefault(); step(next) }}
            onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * VW; setCursor(Math.round(Math.max(0, Math.min(1, (px - X0) / W)) * last)) }}>
            {view.off.map((off, i) => off && <rect key={i} className="bl-off" x={x(i) - slot / 2} y={TOP} width={slot} height={BOTTOM - TOP} />)}
            <rect className="bl-hover" x={Math.max(X0, x(at) - Math.max(slot, 6) / 2)} y={TOP - 4} width={Math.max(slot, 6)} height={BOTTOM - TOP + 4} rx={3} />
            <g className="bl-grid">{[0, 0.5, 1].map(f => <path key={f} d={`M${X0} ${BOTTOM - f * (BOTTOM - TOP)}H${X0 + W}`} />)}</g>
            <text className="bl-axis" x={X0 - 6} y={TOP + 4} textAnchor="end">{view.peak}</text><text className="bl-axis" x={X0 - 6} y={BOTTOM + 4} textAnchor="end">0</text>
            {view.bands.map(b => <path key={b.stage} className={`bl-band bl-${b.stage} ${focus && focus !== b.stage ? 'dim' : ''}`} d={b.d} />)}
            {view.differs && <path className="bl-baseline" d={view.baseLine} />}
            {bClear !== null && view.differs && bClear !== sClear && mark(bClear, compact ? `Before: ${short(baseline.days[bClear].date)}` : `If nothing changes: clears ${short(baseline.days[bClear].date)}`, 'base', 1)}
            {sClear !== null && sClear > 0 && mark(sClear, `Clears ${short(days[sClear].date)}`, 'scen', 0)}
            <g className="bl-today"><line x1={X0} x2={X0} y1={TOP - 4} y2={BOTTOM} /><text x={X0 + 4} y={BOTTOM - 4}>Today</text></g>
            <circle className="bl-hover-dot" cx={x(at)} cy={view.y(here.backlog)} r={4.5} />
            {view.ticks.map(({ d, i }) => <text key={d.date} className="bl-axis" x={x(i)} y={BOTTOM + 18} textAnchor={i === 0 ? 'start' : 'middle'}>{short(d.date)}</text>)}
        </svg>
        <aside className="bl-side" aria-live="polite">
            <div className="bl-date">
                <button type="button" aria-label="Previous day" disabled={at === 0} onClick={() => step(at - 1)}>‹</button>
                <strong>{long(here.date)}</strong>
                <button type="button" aria-label="Next day" disabled={at === last} onClick={() => step(at + 1)}>›</button>
            </div>
            <div className="bl-total">
                <span>{changed ? 'With your change' : 'If nothing changes'}</span>
                <b>{here.backlog}</b><small>open interventions</small>
                {view.differs && <em className={diff < 0 ? 'good' : diff > 0 ? 'bad' : ''}>If nothing changes: {hereBase.backlog}{diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}</em>}
            </div>
            {/* Each row doubles as the chart legend: the swatch matches its band, and clicking highlights it. */}
            <div className="bl-breakdown" role="group" aria-label="Waiting at each team. Click a team to highlight it in the chart.">
                {WORK_STAGES.map(s => <button key={s} type="button" className={`bl-row ${focus === s ? 'on' : ''} ${focus && focus !== s ? 'dim' : ''}`} aria-pressed={focus === s} onClick={() => setFocus(focus === s ? null : s)}>
                    <span className="bl-row-label"><i className={`bl-swatch bl-${s}`} aria-hidden="true" /><span>{STAGE_NAME[s]}</span><b>{here.queues[s]}</b></span>
                    <span className="bl-row-track"><i className={`bl-${s}`} style={{ width: `${here.queues[s] / stageMax * 100}%` }} /></span>
                </button>)}
            </div>
            {view.differs && <span className="bl-key"><i className="bl-dash" />If nothing changes</span>}
        </aside>
        {sideExtra}
        </div>
    </div>
}
