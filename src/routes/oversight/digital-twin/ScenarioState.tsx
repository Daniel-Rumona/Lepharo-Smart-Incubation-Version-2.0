import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ProcessModel } from '@/services/digitalTwin/processTwin'
import { useCentreStaffing } from './useCentreStaffing'
import { buildCentreCapacity, recentFacilitators, type CentreStaffing } from '@/services/digitalTwin/centreCapacity'
import { scenarioAssumptions as buildScenario, type Levers } from '@/services/digitalTwin/goalSeek'
import { PILOT } from '@/services/digitalTwin/pilotCalibration'
import { captureSimulation, DEFAULT_ASSUMPTIONS, observedInflow, simulate, type Assumptions, type SimulationResult, type SimulationSnapshot } from '@/services/digitalTwin/simulation'

export type Run = { snapshot: SimulationSnapshot; baselineAssumptions: Assumptions; scenarioAssumptions: Assumptions; baseline: SimulationResult; scenario: SimulationResult; inputsKey: string }
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The scenario model and the levers on it, held once so the Overview scene and the Scenarios page are two views of
 * the same thing: turn a dial on the scene and the Scenarios chips, chart and numbers already show it.
 */
function useScenarioState(model: ProcessModel, scope: string) {
    const [snapshot, setSnapshot] = useState(() => captureSimulation(model, scope, Date.now()))
    const smeCount = useMemo(() => new Set(model.assignments.map(a => String(a.participantId || '')).filter(Boolean)).size, [model.assignments])
    // This programme's own last 12 weeks once there are enough of them; the pilot's rate per SME until then.
    const inflow = useMemo(() => {
        const own = observedInflow(model.assignments, Date.now())
        if (own.count >= 20) return { ...own, source: 'recent' as const }
        return { perWeek: Math.round(PILOT.newInterventionsPerSmePerWeek * smeCount * 10) / 10, count: own.count, weeks: own.weeks, source: 'pilot' as const }
    }, [model.assignments, smeCount])
    const [assumptions, setAssumptions] = useState<Assumptions>(() => ({ ...DEFAULT_ASSUMPTIONS, closedDates: [], inflowPerWeek: inflow.perWeek }))
    const [extraHours, setExtraHours] = useState(0), [extraSMEs, setExtraSMEs] = useState(0), [scenarioWindows, setScenarioWindows] = useState(DEFAULT_ASSUMPTIONS.hodWindows)
    const [extraCc, setExtraCc] = useState(0), [extraMe, setExtraMe] = useState(0)
    const [run, setRun] = useState<Run | null>(null), [error, setError] = useState('')
    const [closedText, setClosedText] = useState('')
    // Centre staff follow their centre's operating hours; operations-role staff (HOD, M&E) do not.
    const branchIds = useMemo(() => [...new Set(model.assignments.map(a => String(a.branchId || '')).filter(Boolean))], [model.assignments])
    const { centres: centreBase, error: centreError } = useCentreStaffing(branchIds, true)
    const facilitatorCounts = useMemo(() => recentFacilitators(model, Date.now()), [model])
    const [centreOn, setCentreOn] = useState(true), [share, setShare] = useState(100), [edits, setEdits] = useState<Record<string, { f?: number; c?: number }>>({})
    const centres: CentreStaffing[] = centreBase.map(c => {
        const counted = facilitatorCounts.get(c.branchId), e = edits[c.branchId] || {}
        return { ...c, facilitators: e.f ?? c.coordinators ?? counted ?? 1, facilitatorsSource: e.f !== undefined ? 'edited' : c.coordinators ? 'records' : counted ? 'sessions' : 'assumed', centreCoordinators: e.c ?? c.centreCoordinators, centreCoordinatorsSource: e.c !== undefined ? 'edited' : c.centreCoordinatorsSource }
    })
    const useCentre = centreOn && centres.length > 0
    const centreKey = JSON.stringify(centres.map(c => [c.branchId, c.facilitators, c.centreCoordinators, c.hours]))
    const capacity = useMemo(() => useCentre ? buildCentreCapacity(centres, snapshot.startAt, 26 * 7, share / 100) : undefined, [useCentre, centreKey, snapshot.startAt, share]) // eslint-disable-line react-hooks/exhaustive-deps
    const effective: Assumptions = useCentre && capacity ? { ...assumptions, deliveryHours: 0, ccHours: 0, centre: capacity, facilitators: centres.reduce((n, c) => n + c.facilitators, 0) } : assumptions
    const changed = useMemo(() => captureSimulation(model, scope, snapshot.capturedAt).id !== snapshot.id, [model, scope, snapshot])
    const set = (key: keyof Assumptions, value: any) => setAssumptions(previous => ({ ...previous, [key]: value, ...(key === 'weeks' ? { intakeWeeks: Math.min(value, previous.intakeWeeks) } : {}) }))
    const inputsKey = JSON.stringify({ assumptions, extraHours, extraSMEs, scenarioWindows, extraCc, extraMe, closedText, useCentre, share, centreKey })
    const currentLevers: Levers = { hours: extraHours, cc: extraCc, me: extraMe, hod: scenarioWindows, intake: extraSMEs }
    const parsedClosed = () => closedText.split(',').map(v => v.trim()).filter(Boolean)

    const execute = () => {
        try {
            const baselineAssumptions = { ...effective, closedDates: parsedClosed() }
            const scenarioAssumptions = buildScenario(baselineAssumptions, currentLevers)
            const baseline = simulate(snapshot, baselineAssumptions), scenario = simulate(snapshot, scenarioAssumptions)
            setRun({ snapshot, baselineAssumptions, scenarioAssumptions, baseline, scenario, inputsKey }); setError('')
        } catch (e) { setError(e instanceof Error ? e.message : 'Cannot run this scenario.'); setRun(null) }
    }
    // The model is instant, so the comparison follows the inputs. A short pause avoids recalculating on every slider tick.
    useEffect(() => { const timer = window.setTimeout(execute, reducedMotion() ? 0 : 160); return () => window.clearTimeout(timer) }, [inputsKey, snapshot]) // eslint-disable-line react-hooks/exhaustive-deps

    return {
        snapshot, setSnapshot, smeCount, inflow, assumptions, setAssumptions, set,
        extraHours, setExtraHours, extraSMEs, setExtraSMEs, scenarioWindows, setScenarioWindows, extraCc, setExtraCc, extraMe, setExtraMe,
        run, setRun, error, setError, closedText, setClosedText, centreError, centres, centreOn, setCentreOn, share, setShare, edits, setEdits,
        useCentre, centreKey, capacity, effective, changed, currentLevers, parsedClosed
    }
}

export type ScenarioState = ReturnType<typeof useScenarioState>
const Context = createContext<ScenarioState | null>(null)

export function ScenarioProvider({ model, scope, children }: { model: ProcessModel; scope: string; children: React.ReactNode }) {
    const state = useScenarioState(model, scope)
    return <Context.Provider value={state}>{children}</Context.Provider>
}

export function useScenario(): ScenarioState {
    const state = useContext(Context)
    if (!state) throw new Error('useScenario must be used inside a ScenarioProvider.')
    return state
}
