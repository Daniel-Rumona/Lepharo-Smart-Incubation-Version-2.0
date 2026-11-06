import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Slider, Space, Tooltip } from 'antd'
import { CaretRightOutlined, InfoCircleOutlined, PauseOutlined, RedoOutlined } from '@ant-design/icons'
import { buildHistory, historyFrame, stepDurations, CHANNELS, CHANNEL_LABELS, HISTORY_NODES, HISTORY_PARENT, type HistoryEvent, type HistoryNode, type StepDuration } from '@/services/digitalTwin/history'
import type { ProcessModel, TwinRow } from '@/services/digitalTwin/processTwin'

const STEP_NAMES: Record<HistoryNode, string> = { assigned: 'Assigned', attended: 'Session attended', delivery: 'Support delivered', confirmed: 'SME confirmed', approved: 'HOD approved evidence', validated: 'M&E validated evidence', outcome: 'Outcome assessed' }
const SENTENCES: Record<HistoryNode, string> = { assigned: 'was assigned support', attended: 'attended a session', delivery: 'had support recorded as delivered', confirmed: 'confirmed the support took place', approved: 'had evidence approved by the head of department', validated: 'had evidence validated by M&E', outcome: 'gave a follow-up answer' }
const day = (at: number) => new Date(at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const sentence = (e: HistoryEvent) => e.node === 'outcome' && e.label ? e.label : e.node === 'attended' && e.label.includes('(') ? 'attended a session ' + e.label.slice(e.label.indexOf('(')).toLowerCase() : SENTENCES[e.node]

const ROUTE_CLASS: Record<string, string> = { in_person: 'inperson', virtual: 'virtual', telephonic: 'phone' }
const FORK_Y = [15.4, 50, 84.6]

function Fork({ side, channels, justChannel }: { side: 'out' | 'in'; channels: Record<string, number>; justChannel: string | null }) {
    return <svg className={`hv-fork ${side}`} viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden="true">
        {CHANNELS.map((c, i) => <path key={c} vectorEffect="non-scaling-stroke" className={`${ROUTE_CLASS[c]} ${channels[c] ? 'on' : ''} ${justChannel === c ? 'just' : ''}`} d={`M0 50 C20 50 20 ${FORK_Y[i]} 40 ${FORK_Y[i]}`} />)}
    </svg>
}

/** Assignment -> one of three attendance routes -> support delivered. Routes can overlap: one assignment may use several. */
function SessionBranches({ attended, channels, total, justChannel, duration }: { attended: number; channels: Record<string, number>; total: number; justChannel: string | null; duration?: StepDuration }) {
    const other = channels.other || 0
    return <div className="hv-branch" data-guide="twin-history-routes">
        <div className="hv-branch-title"><Tooltip title={duration ? `Typically ${duration.medianDays} days after assignment` : undefined}><strong>Session attended</strong></Tooltip><span>{attended} of {total} assignments</span></div>
        <Fork side="out" channels={channels} justChannel={justChannel} />
        <div className="hv-routes">
            {CHANNELS.map(c => <div key={c} className={`hv-route ${ROUTE_CLASS[c]} ${channels[c] ? 'on' : ''} ${justChannel === c ? 'just' : ''}`} aria-label={`${CHANNEL_LABELS[c]}: ${channels[c]} assignments so far`}>
                <span className="hv-route-name">{CHANNEL_LABELS[c]}</span>
                <b>{channels[c]}</b>
                <span className="hv-route-bar" aria-hidden="true"><i style={{ width: `${total ? Math.round(channels[c] / total * 100) : 0}%` }} /></span>
            </div>)}
        </div>
        <Fork side="in" channels={channels} justChannel={justChannel} />
        {other > 0 && <p className="hv-branch-note">+{other} hybrid or method not recorded</p>}
    </div>
}

/** Replays dated milestones. Counts are cumulative: assignments that have reached each step so far. */
export function HistoryPlayback({ model, authored, active }: { model: ProcessModel; authored: TwinRow[]; active: boolean }) {
    const latest = useMemo(() => buildHistory(model, authored, Date.now()), [model, authored])
    const [history, setHistory] = useState(latest)
    // Opens on the finished picture; restart replays from the beginning.
    const [position, setPosition] = useState(latest.events.length), [playing, setPlaying] = useState(false)
    useEffect(() => { if (!active) setPlaying(false) }, [active])
    // Newly recorded milestones are picked up automatically, but never while a replay is running.
    const signature = `${latest.events.length}:${latest.events.at(-1)?.id || ''}`
    useEffect(() => {
        if (playing) return
        if (`${history.events.length}:${history.events.at(-1)?.id || ''}` === signature) return
        const wasAtEnd = position >= history.events.length
        setHistory(latest)
        setPosition(wasAtEnd ? latest.events.length : Math.min(position, latest.events.length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature, playing])
    const frame = useMemo(() => historyFrame(history.events, position), [history, position])
    const durations = useMemo(() => stepDurations(history.events), [history])
    useEffect(() => { if (!playing) return; const timer = window.setInterval(() => setPosition(v => Math.min(history.events.length, v + 1)), 600); return () => clearInterval(timer) }, [playing, history.events.length])
    useEffect(() => { if (position >= history.events.length) setPlaying(false) }, [position, history.events.length])
    const total = history.totalAssignments
    const current = frame.current
    const lastAt = history.events.at(-1)?.at

    return <section className="twin-history history-v2" aria-label="History playback">
        <div className="hv-head">
            <div><strong>Replay how work moved</strong>
                <Tooltip title={<>Each circle counts distinct assignments that have <em>reached</em> that step by the date shown. It is a running total, not how many are waiting there. The three session routes can overlap, because one assignment may be attended in more than one way. {history.coveredAssignments} of {total} assignments have dated milestones; {history.invalid} invalid and {history.future} future dates were left out.{history.attendedUndated > 0 && <> {history.attendedUndated} attended sessions have no check-in time and are not placed on the timeline.</>}</>}>
                    <button type="button" className="hv-info" aria-label="How to read this"><InfoCircleOutlined /></button>
                </Tooltip>
            </div>
            <Space align="center" data-guide="twin-history-controls">
                {history.events.length > 0 && <>
                    <Tooltip title={playing ? 'Pause' : 'Play history'}><Button className="hv-play" shape="circle" type="primary" aria-label={playing ? 'Pause' : 'Play history'} icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={() => { if (position >= history.events.length) setPosition(0); setPlaying(!playing) }} /></Tooltip>
                    <Tooltip title="Start over"><Button className="hv-reset" shape="circle" aria-label="Start over" icon={<RedoOutlined />} onClick={() => { setPlaying(false); setPosition(0) }} /></Tooltip>
                </>}
            </Space>
        </div>
        {!history.events.length ? <Empty description="No dated milestones in this scope yet." /> : <>
            <div className="hv-sentence" data-guide="twin-history-summary"><p role="status">{current
                ? <><b>{frame.counts.assigned}</b> of {total} assignments created · <b>{frame.counts.validated}</b> validated by M&amp;E</>
                : <>Nothing has happened yet. {total} assignments will appear as they are recorded.</>}</p>
                <div className="hv-date" aria-live="polite"><small>{current ? 'Date shown' : 'Starts'}</small><strong>{day(current ? current.at : history.events[0].at)}</strong></div></div>
            <ol className="hv-steps" data-guide="twin-history-steps">
                {HISTORY_NODES.map((node, i) => {
                    if (node === 'attended') return <li key={node} className="hv-branch-item">
                        <SessionBranches attended={frame.counts.attended} channels={frame.channels} total={total} justChannel={current?.node === 'attended' ? current.channel || 'other' : null} duration={durations.attended} />
                    </li>
                    const count = frame.counts[node], share = total ? count / total : 0
                    const size = 44 + Math.round(Math.sqrt(share) * 36)
                    const just = current?.node === node
                    const level = count === 0 ? 'idle' : 'ok'
                    const parent = HISTORY_PARENT[node] ?? HISTORY_NODES[i - 1]
                    return <React.Fragment key={node}>
                        {node === 'outcome' && <li className="hv-divider" aria-hidden="true"><span>Reported separately</span></li>}
                        <li className={`hv-item ${node === 'outcome' ? 'hv-separate' : ''}`}>
                            <Tooltip title={durations[node] ? `Typically ${durations[node]!.medianDays} days after ${STEP_NAMES[parent].toLowerCase()}` : undefined}>
                                <div className={`jm-station ${level} ${just ? 'just' : ''}`} aria-label={`${STEP_NAMES[node]}: ${count} of ${total} assignments so far`}>
                                    <span className="jm-bubble" style={{ width: size, height: size }}><b>{count}</b></span>
                                    <span className="jm-name">{STEP_NAMES[node]}</span>
                                    <span className="hv-bar" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
                                    <span className="jm-meta">{Math.round(share * 100)}% of assignments</span>
                                </div>
                            </Tooltip>
                            {i < HISTORY_NODES.length - 1 && node !== 'assigned' && HISTORY_NODES[i + 1] !== 'outcome' && <span className={`jm-link ${just ? 'moving' : ''}`} aria-hidden="true" />}
                        </li>
                    </React.Fragment>
                })}
            </ol>
            <div className="hv-scrub">
                <Slider aria-label="History event position" min={0} max={history.events.length} value={position} onChange={v => { setPlaying(false); setPosition(v) }} tooltip={{ formatter: v => v ? day(history.events[Math.min(v, history.events.length) - 1].at) : 'Start' }} />
                <div className="hv-axis"><span>{day(history.events[0].at)}</span><span>{lastAt ? day(lastAt) : ''}</span></div>
            </div>
        </>}
    </section>
}
