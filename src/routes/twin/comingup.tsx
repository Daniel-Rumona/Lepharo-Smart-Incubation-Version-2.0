import dayjs from 'dayjs'
import type { DigitalTwinRecord, RiskLevel, TwinScenario } from '@twin/rules'
import { usePalette } from './palette'
import { dayLabel, outlookEvents, type TimelineEvent } from './timeline'

// Enough to read at a glance while the whole twin stays on one screen.
const MOST_EVENTS = 5

/**
 * The twin's forecast as a list: what happens on the days ahead, as things
 * stand or with the moves picked, and where that leaves the SME. Every line
 * jumps the time machine to its day.
 */
export function ComingUp({ record, curve, scenario, onJump }: {
    record: DigitalTwinRecord
    /** Needs attention for each day ahead, with the picked moves if any. */
    curve: Array<{ day: number; score: number; level: RiskLevel }>
    /** The picked moves, or null for "if nothing changes". */
    scenario: TwinScenario | null
    onJump: (day: number) => void
}) {
    const palette = usePalette()
    const TONE: Record<TimelineEvent['tone'], string> = {
        good: palette.whatIf,
        bad: palette.level.Critical,
        warn: palette.level.Medium,
        info: palette.past
    }
    const events = outlookEvents(record, curve, scenario)
    const shown = events.slice(0, MOST_EVENTS)
    const end = curve[curve.length - 1]
    const start = dayjs(record.calculatedAt)

    return (
        <div className='twin-coming'>
            {events.length ? (
                <ol className='twin-coming-list'>
                    {shown.map(event => (
                        <li key={event.key}>
                            <button className='twin-coming-item' style={{ ['--tone' as any]: TONE[event.tone] }} onClick={() => onJump(event.day)}>
                                <i aria-hidden />
                                <span className='twin-coming-when'>
                                    {dayLabel(event.day)}
                                    <small>{start.add(event.day, 'day').format('ddd D MMM')}</small>
                                </span>
                                <span className='twin-coming-what'>{event.label}</span>
                            </button>
                        </li>
                    ))}
                </ol>
            ) : (
                <div className='twin-empty'>Nothing dated in the next {end.day} days.</div>
            )}
            {events.length > shown.length && (
                <div className='twin-coming-more'>{events.length - shown.length} more on the time machine</div>
            )}
            <button className='twin-coming-end' style={{ ['--tone' as any]: palette.level[end.level] }} onClick={() => onJump(end.day)}>
                <span>Where it lands · {start.add(end.day, 'day').format('D MMM')}</span>
                <b>{end.score} {end.level}</b>
            </button>
        </div>
    )
}
