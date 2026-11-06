import React, { useMemo } from 'react'
import { Button, Empty, Tooltip } from 'antd'
import { ArrowRightOutlined, WarningOutlined, CheckCircleFilled, CheckCircleOutlined } from '@ant-design/icons'
import type { ProcessModel } from '@/services/digitalTwin/processTwin'
import { summariseWaits, TARGETS_ARE_PLACEHOLDERS, WAIT_TARGET_DAYS, type WaitSummary } from '@/services/digitalTwin/twinTargets'
import { processGroups, type ProcessGroup } from './ProcessMap'

type Station = { id: string; name: string; who: string; done?: boolean; track: 'delivery' | 'evidence' }
const STATIONS: Station[] = [
    { id: 'response', name: 'Booking', who: 'SME or facilitator', track: 'delivery' },
    { id: 'delivery', name: 'Support delivered', who: 'Facilitator', track: 'delivery' },
    { id: 'confirmation', name: 'SME confirms', who: 'SME', track: 'delivery' },
    { id: 'completed', name: 'Delivery done', who: '', done: true, track: 'delivery' },
    { id: 'prepare', name: 'SME signs the MOV', who: 'SME', track: 'evidence' },
    { id: 'hod', name: 'Head of dept. approves', who: 'HOD', track: 'evidence' },
    { id: 'cc', name: 'Centre confirms work', who: 'Coordinator', track: 'evidence' },
    { id: 'me', name: 'M&E quality check', who: 'M&E', track: 'evidence' },
    { id: 'validated', name: 'Evidence validated', who: '', done: true, track: 'evidence' }
]
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`

/** ok = nothing past target (neutral); late = some interventions past target; slow = the typical intervention is past target. */
type Level = 'idle' | 'done' | 'ok' | 'late' | 'slow'
type Measured = Station & { group: ProcessGroup; count: number; wait: WaitSummary; target: number; level: Level; heat: number }

/** Plain-language picture of where work sits. Colour appears only where something is past its target. */
export function JourneyMap({ model, clock, onSelect }: { model: ProcessModel; clock: number; onSelect: (id: string) => void }) {
    const view = useMemo(() => {
        const groups = processGroups(model, clock)
        const measured: Measured[] = STATIONS.map(s => {
            const group = groups.find(g => g.id === s.id)!
            const target = WAIT_TARGET_DAYS[s.id] ?? 7
            const waiting = s.done ? [] : group.items.filter(i => i.owner !== 'None')
            const wait = summariseWaits(waiting.map(i => i.enteredAt), clock, target)
            const level: Level = s.done ? 'done' : group.items.length === 0 ? 'idle' : wait.median !== null && wait.median > target ? 'slow' : wait.pastTarget > 0 ? 'late' : 'ok'
            return { ...s, group, count: group.items.length, wait, target, level, heat: 0 }
        })
        const active = measured.filter(s => !s.done)
        const peak = Math.max(1, ...active.map(s => s.count))
        active.forEach(s => { s.heat = s.count / peak })
        // The step to look at first: most interventions past target, then most waiting.
        const bottleneck = [...active].sort((a, b) => b.wait.pastTarget - a.wait.pastTarget || b.count - a.count)[0]
        const waiting = active.reduce((n, s) => n + s.count, 0)
        const pastTarget = active.reduce((n, s) => n + s.wait.pastTarget, 0)
        const outcomes = groups.filter(g => g.lane === 'outcomes')
        const exceptions = groups.filter(g => g.hint.includes('xception') && g.items.length)
        return { measured, bottleneck: bottleneck?.count ? bottleneck : null, waiting, pastTarget, outcomes, exceptions }
    }, [model, clock])
    if (!model.items.length) return <Empty description="No intervention records match this scope." />
    const { measured, bottleneck, waiting, pastTarget, outcomes, exceptions } = view
    const track = (key: 'delivery' | 'evidence') => measured.filter(s => s.track === key)
    const achieved = outcomes.find(o => o.id === 'outcome-achieved')?.items.length || 0
    const totalOutcomes = model.followUps.length
    const tier: 'act' | 'watch' | 'calm' | 'clear' = !bottleneck ? 'clear' : bottleneck.level === 'slow' ? 'act' : pastTarget > 0 ? 'watch' : 'calm'

    const renderTrack = (key: 'delivery' | 'evidence', title: string, sub: string) => <div data-guide={`twin-track-${key}`} className={`jm-track ${key}`}>
        <div className="jm-track-head"><strong>{title}</strong><span>{sub}</span></div>
        <ol className="jm-stations">
            {track(key).map((s, i, all) => {
                const size = s.done ? 56 : 44 + Math.round(Math.sqrt(s.heat) * 40)
                const isBottleneck = tier !== 'calm' && bottleneck?.id === s.id
                const w = s.wait
                return <li key={s.id} className={`jm-item ${i === all.length - 1 ? 'last' : ''}`}>
                    <button className={`jm-station ${s.level} ${isBottleneck ? 'bottleneck' : ''}`} onClick={() => onSelect(s.id)}
                        aria-label={`${s.name}: ${plural(s.count, 'record')}${s.who ? `, waiting on ${s.who}` : ''}${w.pastTarget ? `, ${w.pastTarget} past the ${s.target}-day target` : ''}. Open list.`}>
                        <span className="jm-bubble" style={{ width: size, height: size }}>
                            {s.done && s.count > 0 && <CheckCircleFilled className="jm-tick" />}
                            <b>{s.count}</b>
                        </span>
                        <span className="jm-name">{s.name}</span>
                        <span className="jm-meta">{s.done ? 'finished' : s.count ? s.who : 'nothing waiting'}</span>
                        {!s.done && s.count > 0 && <span className="jm-meta jm-wait">{w.median === null ? 'wait unknown' : `typically ${w.median}d · longest ${w.oldest}d`}</span>}
                        {!s.done && s.count > 0 && w.pastTarget > 0 && <span className="jm-late">{w.pastTarget} past {s.target}d target</span>}
                    </button>
                    {i < all.length - 1 && <span className={`jm-link ${s.count && !s.done ? 'moving' : ''}`} aria-hidden="true" />}
                </li>
            })}
        </ol>
    </div>

    return <section className="journey-map" aria-label="Intervention process map">
        <div data-guide="twin-verdict" className={`jm-verdict ${tier}`} role="status">
            {tier === 'clear' || tier === 'calm' ? <CheckCircleOutlined className="jm-verdict-icon" /> : <WarningOutlined className="jm-verdict-icon" />}
            {!bottleneck ? <div><strong>Nothing is waiting right now.</strong><span>Every record in this scope has finished its current stage.</span></div>
                : tier === 'calm' ? <div>
                    <strong>Nothing is past its target.</strong>
                    <span>{waiting.toLocaleString('en-ZA')} open interventions are moving through. Most are at “{bottleneck.name}” ({bottleneck.count}).</span>
                </div> : <div>
                    <strong>{tier === 'act' ? `“${bottleneck.name}” is the slowest step.` : `Some work is running late at “${bottleneck.name}”.`}</strong>
                    <span>{bottleneck.wait.pastTarget} of {bottleneck.count} are past the {bottleneck.target}-day target, waiting on {bottleneck.who.toLowerCase()}{bottleneck.wait.median !== null ? `; typically ${bottleneck.wait.median} days, longest ${bottleneck.wait.oldest}` : ''}. {pastTarget.toLocaleString('en-ZA')} of {waiting.toLocaleString('en-ZA')} open interventions are past target across both tracks.</span>
                </div>}
            {bottleneck && <Button className="jm-verdict-cta" onClick={() => onSelect(bottleneck.id)}>See who is waiting <ArrowRightOutlined /></Button>}
        </div>
        <div className="jm-legend"><span><i className="ok" />On track</span><span><i className="late" />Some past target</span><span><i className="slow" />Typical item past target</span>
            <Tooltip title={TARGETS_ARE_PLACEHOLDERS ? `Placeholder targets until your team sets them: ${measured.filter(m => !m.done).map(m => `${m.name} ${m.target}d`).join(', ')}.` : 'Target days per step.'}><em className="jm-legend-note">Targets are placeholders{' '}ⓘ</em></Tooltip>
            <em>Bigger circle = more waiting. Select any circle to see who.</em></div>
        {renderTrack('delivery', '1 · Delivering support', 'Each count is an intervention')}
        <div className="jm-handoff" aria-hidden="true"><span>Proof of delivery then goes for approval</span></div>
        {renderTrack('evidence', '2 · Approving the evidence', 'Each count is a piece of proof (MOV)')}
        <div className="jm-handoff" aria-hidden="true"><span>Follow-ups ask what changed for the business</span></div>
        <div className="jm-bottom">
            <div className="jm-card" data-guide="twin-outcomes">
                <div className="jm-track-head"><strong>3 · What the SMEs reported</strong><span>{plural(totalOutcomes, 'follow-up')}</span></div>
                {totalOutcomes ? <>
                    <div className="jm-stack" role="img" aria-label={`${achieved} of ${totalOutcomes} follow-ups report the goal achieved`}>
                        {outcomes.filter(o => o.items.length).map(o => <button key={o.id} className={`seg ${o.id.replace('outcome-', '')}`} style={{ flexGrow: o.items.length }} onClick={() => onSelect(o.id)} title={`${o.label}: ${o.items.length}`}>{o.items.length}</button>)}
                    </div>
                    <ul className="jm-key">{outcomes.filter(o => o.items.length).map(o => <li key={o.id}><i className={o.id.replace('outcome-', '')} />{o.label}</li>)}</ul>
                    <p className="jm-note">These are reports, not proof of business growth.</p>
                </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No follow-ups yet" />}
            </div>
            <div className="jm-card" data-guide="twin-attention">
                <div className="jm-track-head"><strong>Needs attention</strong><span>{plural(exceptions.reduce((n, g) => n + g.items.length, 0), 'record')}</span></div>
                {exceptions.length ? <div className="jm-pills">{exceptions.map(g => <button key={g.id} onClick={() => onSelect(g.id)}><b>{g.items.length}</b>{g.label}</button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No exceptions" />}
                <p className="jm-note">Declined, cancelled, queried or rejected work that has left the normal path.</p>
            </div>
        </div>
    </section>
}
