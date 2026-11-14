import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MotionConfig, motion } from 'framer-motion'
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useColorMode } from '@/contexts/ThemeContext'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import {
    SAMPLE_TWIN_ID,
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
import { TwinPaletteContext, twinPalette, usePalette } from './palette'
import { CoreReactor, HoloBackground, HoloPanel, MagicLayer, useParallax } from './scene'
import { TimelineHero, type OutlookMode } from './timeline'
import { SimulatedMoves } from './whatif'
import './twin.css'

/** Where the numbers came from: shown on the twin node, and in full in the footnote. */
function originOf(view: DigitalTwinView) {
    const { record, origin, lastSavedAt } = view
    if (origin === 'sample') return { short: 'Sample data', full: 'Sample SME: the documents are made up, but every score, move and outlook is worked out by the real twin rules.' }
    if (origin === 'saved') {
        const at = dayjs(record.calculatedAt).format('D MMM, HH:mm')
        return { short: `Saved ${at}`, full: `Saved record from ${at} · rules ${record.ruleVersion}.` }
    }
    const at = dayjs(record.calculatedAt).format('HH:mm')
    return {
        short: `Live · ${at}`,
        full: `Live calculation at ${at} · rules ${record.ruleVersion} · ${lastSavedAt ? `last saved ${dayjs(lastSavedAt).format('D MMM')}` : 'no daily record yet'}.`
    }
}

function DigitalTwinScreen() {
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
    // Staff only: SMEs do not open twins.
    const canOpen = isStaff

    const goBack = useCallback(() => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/')
    }, [navigate])

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        setNotice(null)
        try {
            if (isSample) {
                setView(buildSampleTwinView())
                return
            }
            setView(await loadDigitalTwin(applicationId, user))
        } catch (loadError: any) {
            const message = loadError?.message || 'The twin could not be calculated.'
            setError(message)
            // With a twin already on screen the error also shows in the header.
            setNotice(message)
        } finally {
            setLoading(false)
        }
    }, [applicationId, isSample, user])

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
                    <p>The digital twin is available to staff only.</p>
                    <div className='twin-row'>
                        <button type='button' className='twin-back' onClick={goBack}><ArrowLeftOutlined /> Back</button>
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
                                <button type='button' className='twin-back' onClick={goBack}><ArrowLeftOutlined /> Back</button>
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

    const { record, history } = shown!
    const origin = originOf(view)
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
                    <button type='button' className='twin-back' onClick={goBack}><ArrowLeftOutlined /> Back</button>
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
                        {/* The same appearance control as the sign-in screens: mode and accent. */}
                        <ThemeToggle />
                        <button className='twin-btn twin-btn-primary' onClick={recalculate} disabled={loading}>
                            <ReloadOutlined spin={loading} /> Recalculate now
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
                />

                <div className='twin-stage' ref={stageRef}>
                    <div className='twin-deck'>
                        <HoloPanel title='Live mirror' delay={0.35} accent={ACCENT.primary} accentTwo={ACCENT.strong}>
                            <TwinMirror record={record} refused={view.refused} synced={origin.short} />
                        </HoloPanel>

                        <HoloPanel
                            title='Simulated moves'
                            delay={0.45}
                            accent={ACCENT.primary}
                            accentTwo={ACCENT.strong}
                            aside={<span className='twin-tag'>Each move tried on its own</span>}
                        >
                            <SimulatedMoves
                                record={record}
                                moves={moves}
                                chosen={chosen}
                                onToggle={toggleMove}
                                onClear={() => setChosen([])}
                                horizonDays={horizon}
                            />
                        </HoloPanel>

                        <HoloPanel
                            title='Coming up'
                            delay={0.55}
                            accent={ACCENT.primary}
                            accentTwo={ACCENT.strong}
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
 * Painted in the app's own light or dark mode and accent, and follows them when
 * they change. Also honours reduced motion for every entrance animation.
 */
export default function DigitalTwinPage() {
    // The app's own light/dark mode and accent: the twin has no theme of its own, and its
    // appearance button is the app's (ThemeToggle), so a change there changes the app.
    const { mode, accent } = useColorMode()
    const palette = useMemo(() => twinPalette(mode, accent), [mode, accent])
    return (
        <MotionConfig reducedMotion='user'>
            <TwinPaletteContext.Provider value={palette}>
                <div data-twin-theme={mode}>
                    <DigitalTwinScreen />
                </div>
            </TwinPaletteContext.Provider>
        </MotionConfig>
    )
}
