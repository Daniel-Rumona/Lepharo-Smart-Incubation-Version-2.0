import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Switch, InputNumber, Modal, Segmented, Slider, Tooltip } from 'antd'
import { CheckCircleFilled, ClockCircleOutlined, ExperimentOutlined, ReloadOutlined, SettingOutlined, TeamOutlined, UndoOutlined, CalendarOutlined, LineChartOutlined, StopOutlined, UserAddOutlined, AuditOutlined, AimOutlined, SafetyCertificateOutlined, InfoCircleOutlined, SlidersOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { ProcessModel } from '@/services/digitalTwin/processTwin'
import { BacklogChart } from './BacklogChart'
import { ProjectionSummary } from './ProjectionSummary'
import { buildFacts } from '@/services/digitalTwin/projectionSummary'
import { useScenario } from './ScenarioState'
import { useCentreStaffing } from './useCentreStaffing'
import { buildCentreCapacity, describeHours, recentFacilitators, weeklyOpenHours, type CentreStaffing } from '@/services/digitalTwin/centreCapacity'
import { scenarioAssumptions as buildScenario, suggestForGoal, type GoalSuggestion, type Levers } from '@/services/digitalTwin/goalSeek'
import { PILOT, newSmeInterventionsBy } from '@/services/digitalTwin/pilotCalibration'
import { parseScenarioIntent, type ScenarioIntent } from '@/services/digitalTwin/scenarioIntent'
import { askScenarioIntent } from '@/services/digitalTwin/scenarioIntentApi'
import { captureSimulation, DEFAULT_ASSUMPTIONS, observedDelivery, observedInflow, simulate, type Assumptions, type SimulationResult, type SimulationSnapshot } from '@/services/digitalTwin/simulation'

type Run = { snapshot: SimulationSnapshot; baselineAssumptions: Assumptions; scenarioAssumptions: Assumptions; baseline: SimulationResult; scenario: SimulationResult; inputsKey: string }
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`

type Lever = { key: 'hours' | 'review' | 'intake' | 'cc' | 'me'; sliderMax: number; icon: React.ReactNode; title: string; short: string; plain: string; unit: string; min: number; max: number; label: string }

export function ScenarioPanel({ model, scope }: { model: ProcessModel; scope: string }) {
    // The scenario model and its levers are shared with the Overview scene; this page adds the editing UI around them.
    const { snapshot, setSnapshot, smeCount, inflow, assumptions, setAssumptions, set, extraHours, setExtraHours, extraSMEs, setExtraSMEs, scenarioWindows, setScenarioWindows, extraCc, setExtraCc, extraMe, setExtraMe,
        run, setRun, error, setError, closedText, setClosedText, centreError, centres, centreOn, setCentreOn, share, setShare, setEdits, useCentre, effective, changed, currentLevers, parsedClosed } = useScenario()
    const [settingsOpen, setSettingsOpen] = useState(false), [assumptionsOpen, setAssumptionsOpen] = useState(false)
    const [goalOpen, setGoalOpen] = useState(false)
    const [goalDate, setGoalDate] = useState(''), [goal, setGoal] = useState<GoalSuggestion | null>(null)
    const [intentText, setIntentText] = useState(''), [intentNote, setIntentNote] = useState<ScenarioIntent | null>(null), [intentBusy, setIntentBusy] = useState(false)
    const sourceLabel: Record<string, string> = { records: 'from staff records', sessions: 'counted from recent sessions', users: 'from staff records', assumed: 'assumed, please check', edited: 'edited by you' }

    const clearChanges = () => { setExtraHours(0); setExtraCc(0); setExtraMe(0); setExtraSMEs(0); setScenarioWindows(assumptions.hodWindows) }
    const levers: Array<Lever & { value: number; onChange: (v: number) => void; active: boolean; chip: string }> = [
        { key: 'hours', sliderMax: 40, icon: <ClockCircleOutlined />, title: 'More facilitator time', short: 'Facilitator time', plain: 'Facilitators deliver more sessions each week.', unit: 'extra hours a week', min: 0, max: 160, label: 'Extra facilitator hours per week', value: extraHours, onChange: setExtraHours, active: extraHours > 0, chip: `+${extraHours} h/wk` },
        { key: 'review', sliderMax: 5, icon: <AuditOutlined />, title: 'Review evidence more often', short: 'HOD review', plain: 'The head of department reviews proof of delivery on more days.', unit: 'review days a week', min: 0, max: 5, label: 'Scenario HOD review windows', value: scenarioWindows, onChange: setScenarioWindows, active: scenarioWindows !== assumptions.hodWindows, chip: `${scenarioWindows}× a week` },
        { key: 'intake', sliderMax: 100, icon: <UserAddOutlined />, title: 'New SMEs joining', short: 'New SMEs', plain: `New SMEs join in weekly batches. Each brings interventions from about ${PILOT.departmentsPerSme} departments, opened gradually: about ${Math.round(newSmeInterventionsBy(28))} in the first month and ${Math.round(newSmeInterventionsBy(182))} within six months (measured in the pilot).`, unit: 'new SMEs', min: 0, max: 300, label: 'Additional SMEs', value: extraSMEs, onChange: setExtraSMEs, active: extraSMEs > 0, chip: `+${extraSMEs} SMEs` },
        { key: 'cc', sliderMax: 20, icon: <TeamOutlined />, title: 'More coordinator time', short: 'Coordinator time', plain: 'The centre coordinator has more time to confirm the pack work was carried out.', unit: 'extra hours a week', min: 0, max: 100, label: 'Extra centre coordinator hours per week', value: extraCc, onChange: setExtraCc, active: extraCc > 0, chip: `+${extraCc} h/wk` },
        { key: 'me', sliderMax: 20, icon: <SafetyCertificateOutlined />, title: 'More M&E time', short: 'M&E time', plain: 'M&E has more time for its quality (ISO / QMS) validation.', unit: 'extra hours a week', min: 0, max: 100, label: 'Extra M&E hours per week', value: extraMe, onChange: setExtraMe, active: extraMe > 0, chip: `+${extraMe} h/wk` }
    ]

    // A sentence becomes lever settings. Only the levers it mentions change; people are turned into hours using the centres' opening hours.
    const describe = async (event: React.FormEvent) => {
        event.preventDefault()
        const text = intentText.trim(); if (!text || intentBusy) return
        const openHours = centres.length ? centres.reduce((n, c) => n + weeklyOpenHours(c.hours), 0) / centres.length : 40
        const context = { hoursPerCentreStaff: Math.round(openHours * share / 100 * 10) / 10, hoursPerMe: 40, hodWindows: assumptions.hodWindows }
        setIntentBusy(true)
        // The assistant reads it when it can; the built-in rules take over when it is unavailable.
        let intent: ScenarioIntent
        try { intent = await askScenarioIntent(text, context) } catch { intent = parseScenarioIntent(text, context) }
        const l = intent.levers
        if (l.hours !== undefined) setExtraHours(l.hours)
        if (l.cc !== undefined) setExtraCc(l.cc)
        if (l.me !== undefined) setExtraMe(l.me)
        if (l.hod !== undefined) setScenarioWindows(l.hod)
        if (l.intake !== undefined) setExtraSMEs(l.intake)
        if (intent.weeks !== undefined) set('weeks', intent.weeks)
        setIntentNote(intent); setIntentText(''); setIntentBusy(false)
    }

    const DAY = 86400000
    const dateAt = (i: number) => new Date(snapshot.startAt + i * DAY + 7200000).toISOString().slice(0, 10)
    const dayOf = (iso: string) => Math.round((Date.parse(iso + 'T00:00:00+02:00') - snapshot.startAt) / DAY)
    const goalValue = goalDate || dateAt(14)
    const goalLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const runGoal = () => {
        try { setGoal(suggestForGoal(snapshot, { ...effective, closedDates: parsedClosed() }, currentLevers, dayOf(goalValue))) } catch (e) { setError(e instanceof Error ? e.message : 'Cannot work this out.') }
    }
    const applyGoal = (l: Levers) => {
        setExtraHours(l.hours); setExtraCc(l.cc); setExtraMe(l.me); setScenarioWindows(l.hod)
        const needWeeks = Math.ceil((dayOf(goalValue) + 1) / 7)
        if (needWeeks > assumptions.weeks) set('weeks', Math.min(26, needWeeks))
        setGoal(null); setGoalOpen(false)
    }
    const addedText = (added: Partial<Levers>) => [
        added.hours ? `+${added.hours} facilitator hours a week` : '', added.cc ? `+${added.cc} coordinator hours a week` : '', added.me ? `+${added.me} M&E hours a week` : '',
        added.hod ? `${added.hod} more head-of-department review ${added.hod === 1 ? 'day' : 'days'} a week` : ''
    ].filter(Boolean).join(', ')
    const recorded = useMemo(() => observedDelivery(model.sessions, Date.now()), [model.sessions])
    const workItems = snapshot.units.reduce((n, u) => n + u.members, 0)
    const leftOut = Object.values(snapshot.excluded).reduce((a, b) => a + b, 0)
    // Where each lever starts today, so the popover reads "from this to that". With centre hours on,
    // delivery and coordinator time come from staff × opening hours × share, and the lever adds on top.
    const centreHours = (pick: (c: CentreStaffing) => number) => Math.round(centres.reduce((n, c) => n + pick(c) * weeklyOpenHours(c.hours), 0) * share / 100)
    const todayHours = { delivery: useCentre ? centreHours(c => c.facilitators) : assumptions.deliveryHours, cc: useCentre ? centreHours(c => c.centreCoordinators) : assumptions.ccHours }
    const hoursText = (n: number) => `${n.toLocaleString('en-ZA')} h a week`
    const fromTo: Record<Lever['key'], { from: string; to: string }> = {
        hours: { from: hoursText(todayHours.delivery), to: hoursText(todayHours.delivery + extraHours) },
        review: { from: `${assumptions.hodWindows} ${assumptions.hodWindows === 1 ? 'day' : 'days'} a week`, to: `${scenarioWindows} ${scenarioWindows === 1 ? 'day' : 'days'} a week` },
        intake: { from: plural(workItems, 'open intervention'), to: extraSMEs > 0 ? `${workItems.toLocaleString('en-ZA')} + about ${Math.round(extraSMEs * newSmeInterventionsBy(84)).toLocaleString('en-ZA')} more within 12 weeks` : plural(workItems, 'open intervention') },
        cc: { from: hoursText(todayHours.cc), to: hoursText(todayHours.cc + extraCc) },
        me: { from: hoursText(assumptions.meHours), to: hoursText(assumptions.meHours + extraMe) }
    }

    const goalEditor = <div className="sc-goal sc-pop">
        <label className="sc-goal-date"><span>I want everything cleared by</span>
            <input type="date" aria-label="Goal date" value={goalValue} min={dateAt(0)} max={dateAt(26 * 7 - 1)} onChange={e => { setGoalDate(e.target.value); setGoal(null) }} /></label>
        <Button type="primary" block shape="round" icon={<AimOutlined />} onClick={runGoal}>Suggest a change</Button>
        {goal?.status === 'already' && <div className="sc-goal-result ok" role="status"><strong>Already on track.</strong><span>{goal.clearDay !== null ? `Your current choices clear everything by ${goalLabel(dateAt(goal.clearDay))}.` : `Your current choices already keep up with new work by ${goalLabel(goalValue)}: ${goal.waiting} open interventions waiting, the fewest possible.`}</span></div>}
        {goal?.status === 'found' && <div className="sc-goal-result" role="status"><strong>To clear everything by {goalLabel(goalValue)}</strong><span>{addedText(goal.added)}. {goal.clearDay !== null ? `That clears it on ${goalLabel(dateAt(goal.clearDay))}.` : `That keeps up with new work: ${goal.waiting} open interventions waiting on ${goalLabel(goalValue)}, the fewest possible.`}</span><Button size="small" type="primary" shape="round" onClick={() => applyGoal(goal.levers)}>Apply these</Button></div>}
        {goal?.status === 'unreachable' && <div className="sc-goal-result warn" role="status"><strong>Not reachable by {goalLabel(goalValue)} with these levers.</strong><span>{plural(goal.stillWaiting, 'open intervention')} would still be waiting. Some work may only arrive later, capacity is capped, or the sessions-per-intervention-per-day limit in the settings is the constraint.</span></div>}
        {goal?.status === 'too_far' && <div className="sc-goal-result warn" role="status"><strong>Pick a date from today up to 26 weeks ahead.</strong></div>}
        <p className="sc-hint">Only team capacity is changed. Extra SMEs and your starting settings stay as they are. This finds a change that works in the model, not a proven minimum.</p>
    </div>

    const anyActive = levers.some(l => l.active)
    const changeTexts = [extraHours ? `+${extraHours} facilitator hours a week` : '', extraCc ? `+${extraCc} coordinator hours a week` : '', extraMe ? `+${extraMe} M&E hours a week` : '',
        scenarioWindows !== assumptions.hodWindows ? `head-of-department review ${scenarioWindows} ${scenarioWindows === 1 ? 'day' : 'days'} a week` : '', extraSMEs ? `${extraSMEs} new SMEs` : ''].filter(Boolean)
    const facts = run ? buildFacts(run.baseline, run.scenario, changeTexts, run.scenarioAssumptions.weeks) : null
    return <section className="sc sc-two" aria-label="Scenario projection">
        <div className="sc-left" data-guide="twin-run">
            <div className="sc-left-head" data-guide="twin-levers"><strong>Your change</strong><Button size="small" type="text" icon={<UndoOutlined />} disabled={!anyActive} onClick={clearChanges}>Reset</Button></div>
            <div className="sc-dials" role="group" aria-label="What would you change?">
                {levers.map(l => <div key={l.key} className={`sc-dial ${l.active ? 'on' : ''}`}>
                    <div className="sc-dial-head"><span className="sc-dial-icon" aria-hidden="true">{l.icon}</span><strong>{l.title}</strong>
                        <InputNumber size="small" aria-label={l.label} min={l.min} max={l.max} value={l.value} onChange={v => l.onChange(v ?? 0)} /></div>
                    <Slider aria-label={`${l.label} slider`} min={l.min} max={l.sliderMax} value={Math.min(l.value, l.sliderMax)} onChange={l.onChange} />
                    <div className="sc-dial-sub"><span>{l.unit}</span><span className={l.active ? 'on' : ''}>{fromTo[l.key].from} → {fromTo[l.key].to}</span></div>
                </div>)}
            </div>
            <label className="sc-horizon"><span>Look ahead</span><Segmented size="small" aria-label="Weeks ahead" value={[4, 8, 12, 26].includes(assumptions.weeks) ? assumptions.weeks : undefined} onChange={v => set('weeks', v as number)} options={[4, 8, 12, 26].map(v => ({ value: v, label: `${v} wk` }))} /></label>

            <form className="sc-ask" onSubmit={describe} data-guide="twin-describe">
                <div className="sc-ask-field">
                    <ThunderboltOutlined aria-hidden="true" />
                    <input aria-label="Describe a change" value={intentText} disabled={intentBusy} onChange={e => setIntentText(e.target.value)} placeholder="Describe a change, e.g. “add 2 centre coordinators”" />
                    <button type="submit" className="sc-ask-send" aria-label="Apply this change" disabled={!intentText.trim() || intentBusy}><SendOutlined /></button>
                </div>
                {intentBusy && <p className="sc-ask-note" role="status">Reading your change…</p>}
                {!intentBusy && intentNote && <p className="sc-ask-note" role="status">
                    {intentNote.understood.length ? <>Applied: {intentNote.understood.join(' · ')}.</> : <>I could not find a change in that. Try hours, people, review days or new SMEs, for example “8 more facilitator hours”.</>}
                    {intentNote.ignored.length > 0 && <span className="warn"> Not used: {intentNote.ignored.join('; ')}.</span>}
                    {intentNote.reader === 'rules' && <span className="src"> Read with the built-in reader because the assistant was not available.</span>}
                </p>}
            </form>

            <div className="sc-goal-wrap" data-guide="twin-goal">
                <Button block shape="round" icon={<AimOutlined />} aria-expanded={goalOpen} onClick={() => setGoalOpen(o => !o)}>Set a goal</Button>
                {goalOpen && goalEditor}
            </div>

            <div className="sc-left-meta" data-guide="twin-baseline">
                <Tooltip title={`${plural(leftOut, 'record')} left out because they are not ready to move on. Click to refresh with the latest records.`}>
                    <button type="button" className="sc-chip plain" onClick={() => { setSnapshot(captureSimulation(model, scope, Date.now())); setRun(null) }}>
                        <ReloadOutlined /><span>{plural(workItems, 'open intervention')}</span>
                    </button>
                </Tooltip>
                <button type="button" className="sc-chip plain" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog"><SettingOutlined /><span>Settings</span></button>
                <Tooltip title="What this model assumes"><button type="button" className="sc-chip plain icon" aria-label="What this model assumes" onClick={() => setAssumptionsOpen(true)}><InfoCircleOutlined /></button></Tooltip>
            </div>
        </div>

        <div className="sc-right" data-guide="twin-results">
            {changed && <Alert type="info" showIcon message="Live work has changed. Your captured starting point is unchanged; refresh it to include the latest records." />}
            {error && <Alert type="error" message={error} showIcon />}
            <div className="twin-chart sc-card sc-chart">
                {run && facts ? <BacklogChart baseline={run.baseline} scenario={run.scenario} closedDates={run.baselineAssumptions.closedDates} inflowPerWeek={run.baselineAssumptions.inflowPerWeek} changed={anyActive} hideHeadline
                    sideExtra={<ProjectionSummary facts={facts} />} />
                    : <div className="sc-empty-chart"><ExperimentOutlined /><span>Preparing the projection…</span></div>}
            </div>
        </div>

        <Modal
            title={<div className="sc-modal-title"><SettingOutlined /><div><strong>Horizon and starting capacity</strong><span>These numbers apply to both sides of the comparison.</span></div></div>}
            open={settingsOpen} onCancel={() => setSettingsOpen(false)} width={680} className="sc-settings-modal" destroyOnClose={false}
            footer={<div className="sc-modal-footer">
                <Button type="text" icon={<UndoOutlined />} onClick={() => { setAssumptions({ ...DEFAULT_ASSUMPTIONS, closedDates: [], inflowPerWeek: inflow.perWeek }); setClosedText(''); setCentreOn(true); setShare(100); setEdits({}) }}>Reset to defaults</Button>
                <Button type="primary" shape="round" onClick={() => setSettingsOpen(false)}>Done</Button>
            </div>}>
            <div className="sc-adv">
                <section className="sc-sec">
                    <header><CalendarOutlined /><strong>How far ahead?</strong></header>
                    <Segmented block aria-label="Horizon in weeks" value={[4, 8, 12, 26].includes(assumptions.weeks) ? assumptions.weeks : undefined} onChange={v => set('weeks', v as number)} options={[4, 8, 12, 26].map(v => ({ value: v, label: `${v} weeks` }))} />
                    <label className="sc-row"><span><b>Custom length</b><small>Any whole number from 1 to 26</small></span><span className="sc-input"><InputNumber size="small" aria-label="Horizon (weeks)" min={1} max={26} value={assumptions.weeks} onChange={value => set('weeks', value ?? 1)} /><i>weeks</i></span></label>
                </section>

                <section className="sc-sec" data-guide="twin-inflow">
                    <header><UserAddOutlined /><strong>Starting point</strong></header>
                    <p className="sc-hint">{plural(workItems, 'open intervention')} to simulate. {plural(leftOut, 'record')} left out: not ready to move on.</p>
                    <label className="sc-row"><span><b>Expect new work to keep arriving</b>
                        <small>{inflow.perWeek === 0 && assumptions.inflowPerWeek === 0 ? 'No new interventions in the last 12 weeks.' : assumptions.inflowPerWeek > 0 ? `About ${assumptions.inflowPerWeek} new interventions a week${assumptions.inflowPerWeek !== inflow.perWeek ? ' (edited below)' : inflow.source === 'recent' ? ` (average of the last ${inflow.weeks} weeks)` : ` (the pilot's rate of ${PILOT.newInterventionsPerSmePerWeek} per SME per week across ${smeCount} SMEs, until this programme has enough history of its own)`}.` : `Off. ${inflow.source === 'recent' ? `The last ${inflow.weeks} weeks averaged ${inflow.perWeek} a week` : `The pilot's rate would be ${inflow.perWeek} a week`}.`}</small></span>
                        <Switch aria-label="Expect new work to keep arriving" checked={assumptions.inflowPerWeek > 0} disabled={inflow.perWeek === 0 && assumptions.inflowPerWeek === 0} onChange={on => set('inflowPerWeek', on ? (inflow.perWeek || 1) : 0)} /></label>
                </section>

                <section className="sc-sec" data-guide="twin-centre-capacity">
                    <header><TeamOutlined /><strong>Centre capacity</strong></header>
                    <label className="sc-row"><span><b>Use each centre’s operating hours</b><small>Coordinators and centre coordinators (projectadmin role) work their centre’s opening hours. Operations-role staff, such as the head of department and M&amp;E, do not, so their time stays under Reviews below.</small></span><Switch aria-label="Use centre operating hours" checked={useCentre} disabled={!centres.length} onChange={setCentreOn} /></label>
                    {centres.length ? <>
                        {centres.map(c => <div key={c.branchId} className="sc-centre">
                            <div className="sc-centre-head"><strong>{c.name}</strong><small>{describeHours(c.hours)} · {weeklyOpenHours(c.hours)} h a week{c.hoursConfigured ? '' : ' (standard week: this centre has no hours set)'}</small></div>
                            <div className="sc-centre-fields">
                                <label>Coordinators<InputNumber size="small" aria-label={`Coordinators at ${c.name}`} min={0} max={50} value={c.facilitators} onChange={v => setEdits(p => ({ ...p, [c.branchId]: { ...p[c.branchId], f: v ?? 0 } }))} /><i>{sourceLabel[c.facilitatorsSource]}</i></label>
                                <label>Centre coordinators<InputNumber size="small" aria-label={`Centre coordinators at ${c.name}`} min={0} max={50} value={c.centreCoordinators} onChange={v => setEdits(p => ({ ...p, [c.branchId]: { ...p[c.branchId], c: v ?? 0 } }))} /><i>{sourceLabel[c.centreCoordinatorsSource]}</i></label>
                            </div>
                        </div>)}
                        <label className="sc-row"><span><b>Share of that time spent on this work</b><small>Opening hours are availability. If they also do other work, lower this.</small></span><span className="sc-input"><InputNumber size="small" aria-label="Share of time on this work" min={5} max={100} value={share} onChange={v => setShare(v ?? 100)} /><i>%</i></span></label>
                    </> : <p className="sc-hint">{centreError || 'No centre operating hours were found for this scope, so the hours under Delivery and Reviews are used.'}</p>}
                </section>

                <section className="sc-sec recorded">
                    <header><LineChartOutlined /><strong>Recorded from appointments</strong></header>
                    {recorded ? <>
                        <div className="sc-tiles">
                            <div><b>{recorded.sessions}</b><span>sessions in {recorded.weeks} weeks</span></div>
                            <div><b>{recorded.medianMinutes}<small> min</small></b><span>typical length</span></div>
                            <div><b>{recorded.avgHoursPerWeek}<small> h</small></b><span>average per week</span></div>
                            <div><b>{recorded.peakHoursPerWeek}<small> h</small></b><span>busiest week</span></div>
                        </div>
                        <Button block icon={<CheckCircleFilled />} onClick={() => setAssumptions(prev => ({ ...prev, serviceMinutes: Math.max(1, Math.min(480, recorded.medianMinutes)), ...(useCentre ? {} : { deliveryHours: Math.max(0, Math.min(240, Math.ceil(recorded.peakHoursPerWeek))) }) }))}>{useCentre ? 'Use the typical session length' : 'Use these for delivery'}</Button>
                        <p className="sc-hint">Hours used show what was achieved, not what was possible, so the busiest week is the closest guide to capacity. Review times are not recorded anywhere yet, so the review figures below stay as placeholders.</p>
                    </> : <p className="sc-hint">Not enough completed sessions in the last 12 weeks to work this out. Review times are not recorded anywhere yet, so every figure here is a placeholder.</p>}
                </section>

                {([
                    [<TeamOutlined key="d" />, 'Delivery', [['Facilitator hours', 'deliveryHours', 0, 240, 'h / week', 'Total delivery time available across facilitators'], ['Session length', 'serviceMinutes', 1, 480, 'min', 'Time one delivery session takes'], ['Sessions per facilitator per day', 'sessionsPerFacilitatorPerDay', 1, 20, 'sessions', 'Most sessions one facilitator runs in a day (pilot: usually up to 4). Applies when centre hours are used'], ['Days between sessions of one intervention', 'daysBetweenSessions', 1, 60, 'days', 'Earliest next session after one is held (pilot median: 7)']]],
                    [<AuditOutlined key="r" />, 'Reviews', [['Head of department windows', 'hodWindows', 0, 5, 'days / week', 'Days each week the HOD reviews evidence'], ['Time per HOD window', 'hodWindowMinutes', 0, 480, 'min', 'Review time available on each of those days'], ['Time per evidence review', 'reviewMinutes', 1, 240, 'min', 'Time to review one piece of proof'], ['Centre coordinator hours', 'ccHours', 0, 200, 'h / week', 'Coordinator review time'], ['M&E hours', 'meHours', 0, 200, 'h / week', 'Validation time']]],
                    [<UserAddOutlined key="n" />, 'New work', [['Expected new interventions', 'inflowPerWeek', 0, 200, 'per week', 'Steady weekly flow of newly assigned interventions. Starts from this programme’s last 12 weeks, or the pilot’s rate until there is enough history'], ['Intake spread', 'intakeWeeks', 1, 26, 'weeks', 'New SMEs from the lever join in weekly batches over this period']]]
                ] as Array<[React.ReactNode, string, Array<[string, keyof Assumptions, number, number, string, string]>]>).map(([icon, group, fields]) => <section key={group} className="sc-sec" data-sec={group.toLowerCase()}>
                    <header>{icon}<strong>{group}</strong></header>
                    {fields.filter(([, key]) => !(useCentre && (key === 'deliveryHours' || key === 'ccHours'))).map(([title, key, lo, hi, unit, hint]) =>
                        <label key={key} className="sc-row"><span><b>{title}</b><small>{hint}</small></span><span className="sc-input"><InputNumber size="small" aria-label={title} min={lo} max={hi} value={assumptions[key] as number} onChange={value => set(key, value ?? lo)} /><i>{unit}</i></span></label>)}
                </section>)}

                <section className="sc-sec">
                    <header><StopOutlined /><strong>Closed dates</strong></header>
                    <label className="sc-row stack"><span><b>Days with no capacity</b><small>Public holidays or shutdowns, as YYYY-MM-DD separated by commas</small></span><Input.TextArea aria-label="Closed dates" rows={2} value={closedText} onChange={e => setClosedText(e.target.value)} placeholder="2026-12-16, 2026-12-25" /></label>
                </section>
            </div>
        </Modal>

        <Modal title="What this model assumes" open={assumptionsOpen} onCancel={() => setAssumptionsOpen(false)} footer={<Button type="primary" shape="round" onClick={() => setAssumptionsOpen(false)}>Done</Button>} width={680} className="sc-settings-modal">
            <div className="twin-model-notes">
                <p><b>What it compares.</b> “If nothing changes” runs the work that is open today, plus expected new work if that is switched on, with today’s team hours. “With your change” runs the same work after the levers you chose. The chart counts <b>open interventions</b>: an intervention for one SME that has been assigned and is not yet fully validated, whether it is waiting for delivery or its evidence is waiting for review.</p>
                <p><b>Teams and calendar.</b> Capacity is pooled for the selected scope. When centre hours are in use, delivery and centre-coordinator capacity come from each centre’s own operating hours (people × that day’s opening hours × the share of time spent on this work), including Saturdays and public-holiday rules where the centre has set them. Coordinators and centre coordinators are counted from the staff records (active, attached to the centre), falling back to sessions in the last 12 weeks, or an assumed 1. Head-of-department and M&amp;E staff are operations-role users and stay on the weekly hours in the settings. Otherwise delivery operates Monday–Friday in UTC+2. Head-of-department review windows are spread across the working week, ending on Friday; coordinator and M&amp;E hours are spread evenly across working days. Closed dates remove all capacity. Work carries over when a day has too little time, and each handoff takes at least one calendar day.</p>
                <p><b>Sessions.</b> An intervention needs one or more sessions: its planned sessions, and for new work the mix on this programme’s recent assignments, or the pilot’s (about 1.5 on average, with about a third needing more than one). After a session, the next waits at least the number of days set in the settings (the pilot’s median was 7). A shared sitting serves every SME in it and counts once. Each facilitator runs a limited number of sessions a day (the pilot’s upper range was about 4), and extra facilitator hours add sessions on top. In the pilot, two sessions of one SME’s intervention on the same day were rare (under 1%), while several SMEs often had the same intervention on the same day, so there is no limit per intervention. After delivery, each SME’s evidence goes through head-of-department review, then the centre coordinator’s confirmation that the work was carried out, then M&amp;E’s quality validation (ISO / QMS). Packs are not modelled as monthly batches, so month-end timing is not represented.</p>
                <p><b>New SMEs.</b> The lever adds SMEs in weekly batches. In the pilot a new SME’s interventions, across about six departments, were opened gradually: about 7 within a month and 11 within six months. They open along that curve and then stop; recurring cycles for existing SMEs are covered by “expected new work”.</p>
                <p><b>Left out.</b> Only delivery-ready work and review-ready evidence enter the starting point. Pending responses, rework, cancellations and missing evidence are excluded, not assumed approved. No rework probability, department prerequisites, shared-staff allocation or business-outcome effect is predicted. Runs are local and bounded to 26 weeks and 5,000 open interventions. No assignments, approvals or notifications are written.</p>
                <ul>{Object.entries(snapshot.excluded).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul></div>
        </Modal>
    </section>
}
