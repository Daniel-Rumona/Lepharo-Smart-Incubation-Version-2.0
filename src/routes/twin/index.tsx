import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MotionConfig, motion } from 'framer-motion'
import { ArrowLeftOutlined, MoonOutlined, ReloadOutlined, SunOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useColorMode } from '@/contexts/ThemeContext'
import {
    SAMPLE_TWIN_ID,
    loadDigitalTwin,
    recalculateDigitalTwin,
    type DigitalTwinView
} from '@/services/digitalTwinService'
import { buildSampleTwinView } from '@/services/digitalTwinSample'
import {
    NO_CHANGE_SCENARIO,
    TWIN_STAFF_ROLES,
    isNoChangeScenario,
    scenarioGrowth,
    type TwinScenario
} from '@twin/rules'
import { HoloBar, HoloRing, SegmentRing } from './charts'
import { PALETTES, TwinPaletteContext, readStoredTwinTheme, storeTwinTheme, usePalette, type TwinTheme } from './palette'
import { CoreReactor, CountUp, HoloBackground, HoloPanel, MagicLayer, useParallax } from './scene'
import { TimelineHero, type OutlookMode } from './timeline'
import './twin.css'

const formatRand = (value: number) => `R${Math.round(value).toLocaleString('en-ZA')}`

function OriginBadge({ view }: { view: DigitalTwinView }) {
    const { record, origin, lastSavedAt } = view
    if (origin === 'sample') return <span className='twin-chip twin-chip-sample'>Sample data · not a real SME</span>
    if (origin === 'saved') {
        return <span className='twin-chip twin-chip-saved'>Saved {dayjs(record.calculatedAt).format('D MMM, HH:mm')} · rules {record.ruleVersion}</span>
    }
    return (
        <span className='twin-chip twin-chip-live'>
            Live · {dayjs(record.calculatedAt).format('HH:mm')} · rules {record.ruleVersion}
            {lastSavedAt ? ` · last saved ${dayjs(lastSavedAt).format('D MMM')}` : ' · no daily record yet'}
        </span>
    )
}

function Stat({ label, value, color, format }: { label: string; value: number; color?: string; format?: (value: number) => string }) {
    return (
        <div className='twin-stat'>
            <div className='twin-stat-value' style={color ? { color, textShadow: `0 0 12px ${color}` } : undefined}>
                <CountUp value={value} format={format} />
            </div>
            <div className='twin-stat-label'>{label}</div>
        </div>
    )
}

function DigitalTwinScreen({ theme, onToggleTheme }: { theme: TwinTheme; onToggleTheme: () => void }) {
    const palette = usePalette()
    const ACCENT = palette.accent
    const LEVEL = palette.level
    const { applicationId = '' } = useParams()
    const navigate = useNavigate()
    const { user, loading: identityLoading } = useFullIdentity()
    const [view, setView] = useState<DigitalTwinView | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [notice, setNotice] = useState<string | null>(null)
    const [outlookMode, setOutlookMode] = useState<OutlookMode>('nothing-changes')
    const [scenario, setScenario] = useState<TwinScenario>(NO_CHANGE_SCENARIO)
    const stageRef = useParallax<HTMLDivElement>()

    const isSample = applicationId === SAMPLE_TWIN_ID
    const isStaff = !!user && TWIN_STAFF_ROLES.includes(user.role)

    const goBack = useCallback(() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/')
    }, [navigate])

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setView(isSample ? buildSampleTwinView() : await loadDigitalTwin(applicationId))
        } catch (loadError: any) {
            setError(loadError?.message || 'The twin could not be calculated.')
        } finally {
            setLoading(false)
        }
    }, [applicationId, isSample])

    const recalculate = useCallback(async () => {
        if (isSample) {
            setView(buildSampleTwinView())
            return
        }
        setLoading(true)
        setNotice(null)
        try {
            const result = await recalculateDigitalTwin(applicationId)
            setView(result.view)
            setNotice(result.saved
                ? 'Recalculated and saved as today’s record.'
                : 'Recalculated in this browser. Saving needs the twin Cloud Functions deployed.')
        } catch (recalcError: any) {
            setNotice(recalcError?.message || 'Recalculation failed.')
        } finally {
            setLoading(false)
        }
    }, [applicationId, isSample])

    useEffect(() => {
        if (identityLoading || !isStaff) return
        load()
    }, [identityLoading, isStaff, load])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') goBack()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [goBack])

    if (!identityLoading && !isStaff) {
        return (
            <div className='twin-root'>
                <HoloBackground />
                <div className='twin-state'>
                    <p>The digital twin is available to staff only.</p>
                    <button className='twin-btn' onClick={goBack}><ArrowLeftOutlined /> Back</button>
                </div>
            </div>
        )
    }

    if (!view) {
        return (
            <div className='twin-root'>
                <HoloBackground />
                <div className='twin-state'>
                    {error ? (
                        <>
                            <p>{error}</p>
                            <div className='twin-row'>
                                <button className='twin-btn' onClick={goBack}><ArrowLeftOutlined /> Back</button>
                                <button className='twin-btn' onClick={load}><ReloadOutlined /> Try again</button>
                            </div>
                        </>
                    ) : (
                        <CoreReactor score={0} level='Building twin' color={palette.idle} caption='Reading delivery, evidence, compliance and plan records…' />
                    )}
                </div>
            </div>
        )
    }

    const { record, history } = view
    const { business, compliance, evidence, delivery, plan } = record

    // What-if: the growth panel shows what the levers would do to the score.
    const activeScenario = outlookMode === 'what-if' ? scenario : NO_CHANGE_SCENARIO
    const whatIfActive = !isNoChangeScenario(activeScenario)
    const whatIfGrowth = whatIfActive ? scenarioGrowth(record, activeScenario) : null

    return (
        <div className='twin-root'>
            <HoloBackground />
            <MagicLayer />
            <div className='twin-scanline' aria-hidden />
            <div className='twin-shell'>
                <motion.header className='twin-top' initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
                    <button className='twin-btn' onClick={goBack} aria-label='Back'><ArrowLeftOutlined /> Back</button>
                    <div className='twin-title'>
                        <div className='twin-kicker'>Digital twin</div>
                        <h1 title={record.smeName}>{record.smeName}</h1>
                        <div className='twin-chips'>
                            <span className='twin-chip'>
                                {record.profile.group === 'Graduated' ? 'Graduated' : <>Group <strong>{record.profile.group}</strong></>}
                            </span>
                            {record.programName && <span className='twin-chip'>{record.programName}</span>}
                            {record.profile.sector && <span className='twin-chip'>{record.profile.sector}</span>}
                            {record.ownerName && <span className='twin-chip'>{record.ownerName}</span>}
                            <OriginBadge view={view} />
                        </div>
                    </div>
                    <div className='twin-actions'>
                        {notice && <span className='twin-notice'>{notice}</span>}
                        <button
                            className='twin-btn twin-theme-toggle'
                            onClick={onToggleTheme}
                            aria-label={theme === 'dark' ? 'Switch the twin to light mode' : 'Switch the twin to dark mode'}
                        >
                            {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />} {theme === 'dark' ? 'Light' : 'Dark'}
                        </button>
                        <button className='twin-btn twin-btn-primary' onClick={recalculate} disabled={loading}>
                            <ReloadOutlined spin={loading} /> Recalculate now
                        </button>
                    </div>
                </motion.header>

                <TimelineHero
                    record={record}
                    history={history}
                    mode={outlookMode}
                    onModeChange={setOutlookMode}
                    scenario={scenario}
                    onScenarioChange={setScenario}
                />

                <div className='twin-stage' ref={stageRef}>
                    <div className='twin-deck'>
                        <div className='twin-wing twin-wing-left'>
                            <HoloPanel
                                title='Growth score'
                                delay={0.35}
                                accent={ACCENT.emerald}
                                accentTwo={ACCENT.champagne}
                                aside={whatIfGrowth && whatIfGrowth.total !== record.growth.total
                                    ? <span className='twin-tag twin-tag-whatif'>What if: {whatIfGrowth.total} · {whatIfGrowth.band}</span>
                                    : <span className='twin-tag'>{record.growth.band}</span>}
                            >
                                <div className='twin-ring-row'>
                                    <SegmentRing components={record.growth.components} total={record.growth.total} size={124} />
                                    <div className='twin-ring-side'>
                                        {record.growth.components.map((component, index) => (
                                            <HoloBar
                                                key={component.key}
                                                label={component.label}
                                                value={component.score}
                                                max={component.maximum}
                                                detail={component.detail}
                                                color={ACCENT.emerald}
                                                delay={0.6 + index * 0.12}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </HoloPanel>

                            <HoloPanel title='Evidence and compliance' delay={0.5} accent={ACCENT.violet} accentTwo={ACCENT.orchid}>
                                <div className='twin-duo'>
                                    <div className='twin-duo-item'>
                                        <div className='twin-duo-title'>MOV evidence approved</div>
                                        <HoloRing value={evidence.approved} max={evidence.total} size={86} color={ACCENT.violet} sublabel={`of ${evidence.total}`} />
                                        <ul className='twin-list'>
                                            <li><span>Waiting on SME</span><b>{evidence.awaitingSme}</b></li>
                                            <li><span>Waiting on HOD</span><b>{evidence.awaitingHod}</b></li>
                                            <li><span>Draft</span><b>{evidence.draft}</b></li>
                                        </ul>
                                    </div>
                                    <div className='twin-duo-item'>
                                        <div className='twin-duo-title'>Compliance documents valid</div>
                                        <HoloRing value={compliance.covered} max={compliance.total} size={86} color={ACCENT.orchid} sublabel={`of ${compliance.total}`} />
                                        <ul className='twin-list'>
                                            <li><span>Missing</span><b>{compliance.missing}</b></li>
                                            <li><span>Expired</span><b>{compliance.expired}</b></li>
                                            <li><span>Expiring soon</span><b>{compliance.expiringSoon}</b></li>
                                            <li><span>Plan areas</span><b>{plan.finalConfirmed ? 'Final' : `${plan.smeConfirmed}/${plan.departments}`}</b></li>
                                        </ul>
                                    </div>
                                </div>
                            </HoloPanel>
                        </div>

                        <div className='twin-wing twin-wing-right'>
                            <HoloPanel title='Delivery' delay={0.45} accent={ACCENT.orchid} accentTwo={ACCENT.lilac}>
                                <div className='twin-stats'>
                                    <Stat label='Assigned' value={delivery.total} />
                                    <Stat label='Completed' value={delivery.completed} color={ACCENT.emerald} />
                                    <Stat label='Open' value={delivery.open} color={ACCENT.lilac} />
                                    <Stat label='Overdue' value={delivery.overdue} color={delivery.overdue ? LEVEL.High : undefined} />
                                    <Stat label='Waiting on SME' value={delivery.waitingOnSme} color={delivery.waitingOnSme ? LEVEL.Medium : undefined} />
                                    <Stat label='Declined' value={delivery.declined} color={delivery.declined ? LEVEL.Critical : undefined} />
                                </div>
                                {delivery.total === 0 && <div className='twin-empty'>No interventions assigned in this programme yet.</div>}
                            </HoloPanel>

                            <HoloPanel title='Business results' delay={0.65} accent={ACCENT.champagne} accentTwo={ACCENT.rose}>
                                <div className='twin-stats twin-stats-2'>
                                    <div className='twin-stat'>
                                        <div className='twin-stat-value'>
                                            {business.revenue ? <CountUp value={business.revenue.monthly} format={formatRand} /> : '—'}
                                        </div>
                                        <div className='twin-stat-label'>
                                            {business.revenue ? `Monthly revenue · ${business.revenue.source}` : 'Revenue not captured yet'}
                                        </div>
                                    </div>
                                    <div className='twin-stat'>
                                        <div className='twin-stat-value'>{business.headcount ? <CountUp value={business.headcount.total} /> : '—'}</div>
                                        <div className='twin-stat-label'>
                                            {business.headcount ? `Headcount · ${business.headcount.period}` : 'Headcount not captured yet'}
                                        </div>
                                    </div>
                                    <Stat label='Jobs sustained' value={business.jobsSustained} />
                                    <Stat label='Jobs created · 12 months' value={business.jobsCreatedLast12Months} />
                                </div>
                            </HoloPanel>
                        </div>
                    </div>
                </div>

                <div className='twin-footnote'>
                    {view.origin === 'sample'
                        ? 'Sample SME: the documents are made up, but every score and outlook is worked out by the real twin rules. Press Esc to close.'
                        : 'Rules produce every number; the outlook only moves known dates forward, as if nothing changes. Press Esc to close.'}
                </div>
            </div>
        </div>
    )
}

/**
 * Starts in the app's own light or dark mode; the viewer can switch the twin on
 * its own and that choice is remembered. Also honours reduced motion for every
 * entrance animation.
 */
export default function DigitalTwinPage() {
    const { mode } = useColorMode()
    const [theme, setTheme] = useState<TwinTheme>(() => readStoredTwinTheme() ?? (mode === 'light' ? 'light' : 'dark'))
    const toggleTheme = () => setTheme(current => {
        const next = current === 'dark' ? 'light' : 'dark'
        storeTwinTheme(next)
        return next
    })
    return (
        <MotionConfig reducedMotion='user'>
            <TwinPaletteContext.Provider value={PALETTES[theme]}>
                <div data-twin-theme={theme}>
                    <DigitalTwinScreen theme={theme} onToggleTheme={toggleTheme} />
                </div>
            </TwinPaletteContext.Provider>
        </MotionConfig>
    )
}
