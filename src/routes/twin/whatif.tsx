import {
    NO_CHANGE_SCENARIO,
    SIMULATED_SERVICE_IN_DAYS,
    averageOutlook,
    scenarioFromMoves,
    scenarioGrowth,
    type DigitalTwinRecord,
    type TwinMove,
    type TwinMoveKey
} from '@twin/rules'
import { usePalette } from './palette'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const MOVE_LABEL: Record<TwinMoveKey, (count: number, forSme: boolean) => string> = {
    service: () => `Deliver a service within ${SIMULATED_SERVICE_IN_DAYS} days`,
    documentsUploaded: count => `Collect ${plural(count, 'missing document')}`,
    renewExpiring: count => `Renew ${plural(count, 'expiring document')} in time`,
    documentsFixed: count => `Fix ${plural(count, 'queried or rejected document')}`,
    smeResponses: (count, forSme) => (forSme ? `Answer your ${plural(count, 'pending item')}` : `SME answers ${plural(count, 'pending item')}`),
    departmentsFollowedUp: count => `Follow up ${plural(count, 'department')} on the plan`,
    declinesResolved: count => `Resolve ${plural(count, 'declined intervention')}`,
    interventionsCompleted: count => `Complete ${plural(count, 'open intervention')}`,
    roadmapConfirmed: count => `Confirm ${plural(count, 'roadmap area')}`
}

// Enough to choose from while the whole twin stays on one screen.
const MOST_MOVES = 6

/**
 * The twin as a simulator: it has already tried every move open to this SME,
 * each on its own, and ranks them by what they do to the days ahead. Switching
 * moves on replays the time machine with them, together.
 */
export function SimulatedMoves({ record, moves, chosen, onToggle, onClear, horizonDays, forSme = false }: {
    record: DigitalTwinRecord
    moves: TwinMove[]
    chosen: TwinMoveKey[]
    onToggle: (key: TwinMoveKey) => void
    onClear: () => void
    horizonDays: number
    /** Moves the SME makes themselves are worded to them. */
    forSme?: boolean
}) {
    const palette = usePalette()
    const LEVEL = palette.level
    const baseline = averageOutlook(record, NO_CHANGE_SCENARIO, horizonDays)
    const picked = moves.filter(move => chosen.includes(move.key))
    const together = picked.length ? scenarioFromMoves(picked) : null
    const combined = together ? averageOutlook(record, together, horizonDays) : null
    const combinedGrowth = together ? scenarioGrowth(record, together).total : null
    const shown = moves.slice(0, MOST_MOVES)
    // Each bar is the move's effect against the strongest move of its kind.
    const strongestDrop = Math.max(1, ...moves.map(move => -move.scoreDelta))
    const strongestGrowth = Math.max(1, ...moves.map(move => move.growthDelta))

    if (!moves.length) {
        return <div className='twin-empty'>Nothing the twin can try would lower needs attention or lift growth for this SME.</div>
    }

    return (
        <div className='twin-moves'>
            <div className='twin-moves-summary' aria-live='polite'>
                <div>
                    <div className='twin-moves-caption'>Average needs attention · next {horizonDays} days</div>
                    <div className='twin-moves-values'>
                        <span className={`twin-moves-value ${combined ? 'is-before' : ''}`} style={{ ['--v' as any]: LEVEL[baseline.level] }}>
                            <b>{baseline.score}</b>
                            <small>{baseline.level}</small>
                        </span>
                        {combined && (
                            <>
                                <span className='twin-moves-arrow' aria-hidden>→</span>
                                <span className='twin-moves-value' style={{ ['--v' as any]: LEVEL[combined.level] }}>
                                    <b>{combined.score}</b>
                                    <small>{combined.level}</small>
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className='twin-moves-side'>
                    {combined ? (
                        <>
                            <span>
                                {plural(picked.length, 'move')} playing
                                {combinedGrowth !== null && combinedGrowth !== record.growth.total && <em>Growth {record.growth.total} → {combinedGrowth}</em>}
                            </span>
                            <button className='twin-tab twin-moves-reset' onClick={onClear}>Reset</button>
                        </>
                    ) : (
                        <span className='twin-moves-hint'>If nothing changes. Tick moves to replay the future with them.</span>
                    )}
                </div>
            </div>
            <div className='twin-moves-grid'>
                {shown.map((move, index) => {
                    const on = chosen.includes(move.key)
                    const label = MOVE_LABEL[move.key](move.amount, forSme)
                    const impact = move.scoreDelta < 0 ? -move.scoreDelta / strongestDrop : move.growthDelta / strongestGrowth
                    return (
                        <button
                            key={move.key}
                            className={`twin-move ${on ? 'is-on' : ''} ${move.scoreDelta < 0 ? '' : 'is-growth-only'}`}
                            aria-pressed={on}
                            onClick={() => onToggle(move.key)}
                            title={label}
                        >
                            <span className='twin-move-check' aria-hidden>✓</span>
                            <span className='twin-move-body'>
                                <span className='twin-move-label'>
                                    {index === 0 && <em>Best</em>}
                                    {label}
                                </span>
                                <span className='twin-move-bar'><i style={{ width: `${Math.round(impact * 100)}%` }} /></span>
                            </span>
                            <span className='twin-move-effect'>
                                {move.scoreDelta < 0 && <span className='twin-move-fig'><b>{move.scoreDelta}</b><small>attention</small></span>}
                                {move.growthDelta > 0 && <span className='twin-move-fig is-growth'><b>+{move.growthDelta}</b><small>growth</small></span>}
                            </span>
                        </button>
                    )
                })}
            </div>
            {moves.length > shown.length && (
                <div className='twin-moves-more'>{plural(moves.length - shown.length, 'smaller move')} not shown</div>
            )}
        </div>
    )
}
