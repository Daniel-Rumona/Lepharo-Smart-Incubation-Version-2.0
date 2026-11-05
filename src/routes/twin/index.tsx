import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MotionConfig, motion } from 'framer-motion'
import { ArrowLeftOutlined, MoonOutlined, ReloadOutlined, SunOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useColorMode } from '@/contexts/ThemeContext'
import {
    MY_TWIN_ID,
    SAMPLE_TWIN_ID,
    findMyApplicationIds,
    loadDigitalTwin,
    recalculateDigitalTwin,
    type DigitalTwinView
} from '@/services/digitalTwinService'
import { buildSampleTwinView } from '@/services/digitalTwinSample'
import {
    TWIN_STAFF_ROLES,
    outlookHorizonDays,
    scenarioCurve,
    scenarioFromMoves,
    simulateMoves,
    type TwinMoveKey
} from '@twin/rules'
import { ComingUp } from './comingup'
import { TwinMirror } from './mirror'
import { PALETTES, TwinPaletteContext, readStoredTwinTheme, storeTwinTheme, usePalette, type TwinTheme } from './palette'
import { CoreReactor, HoloBackground, HoloPanel, MagicLayer, useParallax } from './scene'
import { TimelineHero, type OutlookMode } from './timeline'
import { SimulatedMoves } from './whatif'
import './twin.css'

/** Where the numbers came from: shown on the twin node, and in full in the footnote. */
function originOf(view: DigitalTwinView, forSme: boolean) {
    const { record, origin, lastSavedAt } = view
    if (origin === 'sample') return { short: 'Sample data', full: 'Sample SME: the documents are made up, but every score, move and outlook is worked out by the real twin rules.' }
    if (origin === 'saved') {
        const at = dayjs(record.calculatedAt).format('D MMM, HH:mm')
        return { short: `Saved ${at}`, full: `Saved record from ${at} · rules ${record.ruleVersion}.` }
    }
    const at = dayjs(record.calculatedAt).format('HH:mm')
    if (forSme) return { short: `Live · ${at}`, full: `Live · updated ${at}.` }
    return {
        short: `Live · ${at}`,
        full: `Live calculation at ${at} · rules ${record.ruleVersion} · ${lastSavedAt ? `last saved ${dayjs(lastSavedAt).format('D MMM')}` : 'no daily record yet'}.`
    }
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
    // Moves picked in the simulated moves panel; any pick puts the time machine in what-if.
    const [chosen, setChosen] = useState<TwinMoveKey[]>([])
    // A day picked in the Coming up panel for the time machine to jump to.
    const [jump, setJump] = useState<{ day: number; key: number } | null>(null)
    // HODs of departments that see their own services in the Risk Register see the
    // same here first, and can switch to the whole SME.
    const [wholeSme, setWholeSme] = useState(false)
    const stageRef = useParallax<HTMLDivElement>()

    // The view on screen, and every move the twin can simulate for it.
    const shown = view ? (view.department && !wholeSme ? view.department : view) : null
    const horizon = shown ? outlookHorizonDays(shown.record) : 0
    const moves = useMemo(() => (shown ? simulateMoves(shown.record, horizon) : []), [shown, horizon])
    const scenario = useMemo(() => scenarioFromMoves(moves.filter(move => chosen.includes(move.key))), [moves, chosen])
    const outlookMode: OutlookMode = chosen.length ? 'what-if' : 'nothing-changes'

    const isSample = applicationId === SAMPLE_TWIN_ID
    const isStaff = !!user && TWIN_STAFF_ROLES.includes(user.role)
    // Every SME sees their own twin; the sample is for staff.
    const isSme = !!user && user.role === 'incubatee'
    const canOpen = isStaff || (isSme && !isSample)

    const goBack = useCallback(() => {
        if (window.history.length > 1) navigate(-1)
        else navigate(isSme ? '/incubatee' : '/')
    }, [navigate, isSme])
    const openMine = useCallback(() => navigate(`/twin/${MY_TWIN_ID}`, { replace: true }), [navigate])

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        setNotice(null)
        try {
            if (isSample) {
                setView(buildSampleTwinView())
                return
            }
            let id = applicationId
            // An SME opens only their own applications, whatever id is in the address.
            if (isSme) {
                const mine = await findMyApplicationIds(user)
                if (!mine.length) throw new Error('Your digital twin appears once you have applied to a programme.')
                if (id === MY_TWIN_ID) id = mine[0]
                else if (!mine.includes(id)) throw new Error('You can only open your own digital twin.')
            }
            setView(await loadDigitalTwin(id, user))
        } catch (loadError: any) {
            const message = loadError?.message || 'The twin could not be calculated.'
            setError(message)
            // With a twin already on screen (an SME's Refresh) the error shows in the header.
            setNotice(message)
        } finally {
            setLoading(false)
        }
    }, [applicationId, isSample, isSme, user])

    const recalculate = useCallback(async () => {
        if (isSample) {
            setView(buildSampleTwinView())
            return
        }
        setLoading(true)
        setNotice(null)
        try {
            const result = await recalculateDigitalTwin(applicationId, user)
            setView(result.view)
            setNotice(result.saved
                ? 'Recalculated and saved as today’s record.'
                : 'Recalculated in this browser. Saving needs the twin Cloud Functions deployed.')
        } catch (recalcError: any) {
            setNotice(recalcError?.message || 'Recalculation failed.')
        } finally {
            setLoading(false)
        }
    }, [applicationId, isSample, user])

    useEffect(() => {
        if (identityLoading || !canOpen) return
        load()
    }, [identityLoading, canOpen, load])

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') goBack()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [goBack])

    if (!identityLoading && !canOpen) {
        return (
            <div className='twin-root'>
                <HoloBackground />
                <div className='twin-state'>
                    <p>{isSme ? 'The sample twin is for staff. Your own twin shows your real records.' : 'The digital twin is available to staff, and to each SME for their own business.'}</p>
                    <div className='twin-row'>
                        <button className='twin-btn' onClick={goBack}><ArrowLeftOutlined /> Back</button>
                        {isSme && <button className='twin-btn' onClick={openMine}>Open my digital twin</button>}
                    </div>
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
                                {isSme && applicationId !== MY_TWIN_ID && <button className='twin-btn' onClick={openMine}>Open my digital twin</button>}
                            </div>
                        </>
                    ) : (
                        <CoreReactor score={0} level='Building twin' color={palette.idle} caption='Reading delivery, evidence, compliance and plan records…' />
                    )}
                </div>
            </div>
        )
    }

    const { record, history } = shown!
    const origin = originOf(view, isSme)
    const chooseView = (whole: boolean) => {
        setWholeSme(whole)
        setChosen([])
    }
    // "What if…" starts from the best move; "If nothing changes" clears the picks.
    const changeMode = (mode: OutlookMode) => {
        if (mode === 'nothing-changes') setChosen([])
        else if (!chosen.length && moves[0]) setChosen([moves[0].key])
    }
    const toggleMove = (key: TwinMoveKey) =>
        setChosen(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))

    return (
        <div className='twin-root'>
            <HoloBackground />
            <MagicLayer />
            <div className='twin-scanline' aria-hidden />
            <div className='twin-shell'>
                <motion.header className='twin-top' initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
                    <button className='twin-btn' onClick={goBack} aria-label='Back'><ArrowLeftOutlined /> Back</button>
                    {/* One line: group and programme in front of the name, then whose view it is. */}
                    <div className='twin-title'>
                        <div className='twin-chips'>
                            <span className='twin-chip'>
                                {record.profile.group === 'Graduated' ? 'Graduated' : <>Group <strong>{record.profile.group}</strong></>}
                            </span>
                            {record.programName && <span className='twin-chip'>{record.programName}</span>}
                        </div>
                        <h1 title={record.smeName}>{record.smeName}</h1>
                        {view.department && (
                            <div className='twin-tabs twin-tabs-inline twin-scope' role='tablist' aria-label='Whose view of this SME'>
                                <button role='tab' aria-selected={!wholeSme} className={`twin-tab ${wholeSme ? '' : 'is-active'}`} onClick={() => chooseView(false)}>
                                    {view.department.record.scope?.departmentName}
                                </button>
                                <button role='tab' aria-selected={wholeSme} className={`twin-tab ${wholeSme ? 'is-active' : ''}`} onClick={() => chooseView(true)}>
                                    Whole SME
                                </button>
                            </div>
                        )}
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
                        {/* Saving a record is the server's job for staff; an SME just reads their records again. */}
                        <button className='twin-btn twin-btn-primary' onClick={isSme ? load : recalculate} disabled={loading}>
                            <ReloadOutlined spin={loading} /> {isSme ? 'Refresh' : 'Recalculate now'}
                        </button>
                    </div>
                </motion.header>

                <TimelineHero
                    record={record}
                    history={history}
                    mode={outlookMode}
                    onModeChange={changeMode}
                    scenario={scenario}
                    jumpTo={jump}
                    forSme={isSme}
                />

                <div className='twin-stage' ref={stageRef}>
                    <div className='twin-deck'>
                        <HoloPanel title='Live mirror' delay={0.35} accent={ACCENT.emerald} accentTwo={ACCENT.champagne}>
                            <TwinMirror record={record} refused={view.refused} synced={origin.short} />
                        </HoloPanel>

                        <HoloPanel
                            title='Simulated moves'
                            delay={0.45}
                            accent={ACCENT.violet}
                            accentTwo={ACCENT.orchid}
                            aside={<span className='twin-tag'>Each move tried on its own</span>}
                        >
                            <SimulatedMoves
                                record={record}
                                moves={moves}
                                chosen={chosen}
                                onToggle={toggleMove}
                                onClear={() => setChosen([])}
                                horizonDays={horizon}
                                forSme={isSme}
                            />
                        </HoloPanel>

                        <HoloPanel
                            title='Coming up'
                            delay={0.55}
                            accent={ACCENT.champagne}
                            accentTwo={ACCENT.rose}
                            aside={<span className={`twin-tag ${chosen.length ? 'twin-tag-whatif' : ''}`}>{chosen.length ? 'With your moves' : 'If nothing changes'}</span>}
                        >
                            <ComingUp
                                record={record}
                                curve={scenarioCurve(record, scenario, horizon)}
                                scenario={chosen.length ? scenario : null}
                                onJump={day => setJump(current => ({ day, key: (current?.key ?? 0) + 1 }))}
                            />
                        </HoloPanel>
                    </div>
                </div>

                <div className='twin-footnote'>{origin.full} Press Esc to close.</div>
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
