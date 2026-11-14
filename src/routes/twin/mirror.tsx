import dayjs from 'dayjs'
import {
    MIRROR_FRESH_DAYS,
    MIRROR_STALE_DAYS,
    mirrorFreshness,
    type DigitalTwinRecord,
    type MirrorFeedKey,
    type MirrorFreshness
} from '@twin/rules'
import type { TwinOptionalSource } from '@/services/digitalTwinService'
import { usePalette } from './palette'

const FEEDS: Record<MirrorFeedKey, { label: string; unit: [string, string] }> = {
    interventions: { label: 'Interventions', unit: ['record', 'records'] },
    documents: { label: 'Compliance documents', unit: ['required', 'required'] },
    plan: { label: 'Developmental plan', unit: ['area', 'areas'] },
    evidence: { label: 'MOV evidence', unit: ['file', 'files'] },
    contact: { label: 'Contact log', unit: ['contact', 'contacts'] },
    business: { label: 'Business data', unit: ['report', 'reports'] }
}

// The feeds built from records an SME may not read.
const REFUSED_WITH: Partial<Record<MirrorFeedKey, TwinOptionalSource[]>> = {
    contact: ['challenges', 'reminderEmails'],
    business: ['monthlyMetrics', 'jobContracts']
}

const FRESHNESS_TEXT: Record<MirrorFreshness, string> = {
    fresh: `Changed within ${MIRROR_FRESH_DAYS} days`,
    ageing: `No change for over ${MIRROR_FRESH_DAYS} days`,
    stale: `No change for over ${MIRROR_STALE_DAYS} days`,
    unknown: 'No dated change on record'
}

const sinceLabel = (iso: string | null, now: Date) => {
    if (!iso) return 'no date'
    const days = dayjs(now).startOf('day').diff(dayjs(iso).startOf('day'), 'day')
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 30) return `${days} days ago`
    return dayjs(iso).format('D MMM YYYY')
}

const ROW_HEIGHT = 26

/**
 * How the twin stays a twin: every record it reads flows into it, each feed lit
 * by how recently it changed. A quiet feed means the work it mirrors has stopped.
 */
export function TwinMirror({ record, refused, synced }: { record: DigitalTwinRecord; refused: TwinOptionalSource[]; synced: string }) {
    const palette = usePalette()
    const now = new Date(record.calculatedAt)
    const feeds = record.mirror ?? []
    const blocked = new Set(refused)
    const colorOf: Record<MirrorFreshness, string> = {
        fresh: palette.level.Low,
        ageing: palette.level.Medium,
        stale: palette.level.High,
        unknown: palette.past
    }
    const height = Math.max(1, feeds.length) * ROW_HEIGHT

    if (!feeds.length) return <div className='twin-empty'>This saved record was made before the twin kept its mirror.</div>

    return (
        <div className='twin-mirror'>
            <ul className='twin-mirror-feeds'>
                {feeds.map(feed => {
                    const hidden = (REFUSED_WITH[feed.key] ?? []).some(source => blocked.has(source))
                    const freshness = mirrorFreshness(feed.lastChange, now)
                    const [one, many] = FEEDS[feed.key].unit
                    return (
                        <li
                            key={feed.key}
                            className={`twin-mirror-feed is-${hidden ? 'hidden' : freshness}`}
                            style={{ ['--feed' as any]: colorOf[freshness] }}
                            title={hidden ? 'Shown to programme staff' : FRESHNESS_TEXT[freshness]}
                        >
                            <i aria-hidden />
                            <span className='twin-mirror-name'>{FEEDS[feed.key].label}</span>
                            <span className='twin-mirror-when'>
                                {hidden ? 'staff only' : <>{sinceLabel(feed.lastChange, now)}<small>{feed.records} {feed.records === 1 ? one : many}</small></>}
                            </span>
                        </li>
                    )
                })}
            </ul>
            {/* Each feed's light runs into the twin; quiet feeds flow slowly, unknown ones not at all. */}
            <svg className='twin-mirror-wires' viewBox={`0 0 60 ${height}`} preserveAspectRatio='none' aria-hidden>
                {feeds.map((feed, index) => {
                    const hidden = (REFUSED_WITH[feed.key] ?? []).some(source => blocked.has(source))
                    const freshness = mirrorFreshness(feed.lastChange, now)
                    const y = index * ROW_HEIGHT + ROW_HEIGHT / 2
                    const d = `M0 ${y} C 30 ${y}, 30 ${height / 2}, 60 ${height / 2}`
                    return (
                        <g key={feed.key} className={`twin-mirror-wire is-${hidden ? 'hidden' : freshness}`} style={{ ['--feed' as any]: colorOf[freshness] }}>
                            <path d={d} className='twin-mirror-wire-track' />
                            {!hidden && freshness !== 'unknown' && <path d={d} className='twin-mirror-wire-flow' style={{ animationDelay: `${-index * 0.35}s` }} />}
                        </g>
                    )
                })}
            </svg>
            <div className='twin-mirror-node'>
                <div className='twin-mirror-core' aria-hidden>
                    <span />
                    <span />
                </div>
                <div className='twin-mirror-node-label'>Twin</div>
                <div className='twin-mirror-node-sync'>{synced}</div>
            </div>
        </div>
    )
}
