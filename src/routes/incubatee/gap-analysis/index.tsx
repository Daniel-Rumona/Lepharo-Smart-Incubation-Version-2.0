import React, { useEffect, useMemo, useState } from 'react'
import { Button, Spin } from 'antd'
import {
    CheckCircleFilled,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DownOutlined,
    ExclamationCircleFilled,
    FileSearchOutlined,
    InfoCircleOutlined
} from '@ant-design/icons'
import { Navigate, useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { resolveSmeParticipantId } from '@/services/smeIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import GAPAnalysisForm from '@/routes/gap/new/form'
import {
    SECTION_ADAPTERS,
    SECTION_ORDER,
    SectionStats,
    getGapStatus,
    getSectionStats
} from '@/routes/gap/sections'
import '../whatsapp-consent/whatsapp-consent.css'
import './gap-results.css'

const DASHBOARD_PATH = '/incubatee'
const PLAN_PATH = '/incubatee/roadmap'

type Landing =
    | { kind: 'loading' }
    | { kind: 'noParticipant' }
    | { kind: 'notStarted' }
    | { kind: 'results'; gap: any }

const toDate = (value: any) => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate() as Date
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed.toDate() : null
}

const fmtDate = (value: any) => {
    const date = toDate(value)
    return date ? dayjs(date).format('D MMMM YYYY') : null
}

/**
 * /incubatee/gap-analysis opened directly (a bookmark, a refresh, a link):
 * shows the SME's submitted GAP analysis as results, or invites them to start
 * it. Flows that send an SME here to fill it in pass router state and go
 * straight to the form instead (see GAPAnalysisFormWrapper).
 */
const GapAnalysisLanding: React.FC = () => {
    const navigate = useNavigate()
    const { user, loading: identityLoading } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const email = String(user?.email || '')
    const linkedParticipantId = String(user?.participantId || '')

    const [landing, setLanding] = useState<Landing>({ kind: 'loading' })
    const [started, setStarted] = useState(false)

    useEffect(() => {
        if (!user) return
        let cancelled = false
        const load = async () => {
            try {
                // The SME's linked participant; email only until it is linked.
                const participantId = await resolveSmeParticipantId({ participantId: linkedParticipantId, email })
                if (!participantId) {
                    if (!cancelled) setLanding({ kind: 'noParticipant' })
                    return
                }
                const gapSnap = await getDocs(
                    query(collection(db, 'gapAnalysis'), where('participantId', '==', participantId))
                )
                const records = gapSnap.docs
                    .map(d => ({ id: d.id, ...(d.data() as any) }))
                    .sort(
                        (a, b) =>
                            (toDate(b.submittedAt)?.getTime() || 0) -
                            (toDate(a.submittedAt)?.getTime() || 0)
                    )
                // The one for the programme they are in now, else their latest.
                const gap =
                    (activeProgramId !== 'all' &&
                        records.find(r => String(r.programId || '') === String(activeProgramId))) ||
                    records[0]
                if (!cancelled) setLanding(gap ? { kind: 'results', gap } : { kind: 'notStarted' })
            } catch (error) {
                console.error('Failed to load GAP analysis:', error)
                if (!cancelled) setLanding({ kind: 'notStarted' })
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [user, email, linkedParticipantId, activeProgramId])

    if (!identityLoading && !user) return <Navigate to='/login' replace />
    if (started) return <GAPAnalysisForm />

    if (landing.kind === 'loading') {
        return (
            <div className='wc gr-loading'>
                <Spin size='large' />
            </div>
        )
    }

    return (
        <div className='wc'>
            <div className='wc-bg' aria-hidden='true'>
                <span className='wc-glow wc-glow-a' />
                <span className='wc-glow wc-glow-b' />
            </div>

            <header className='wc-top'>
                <img className='wc-logo' src='/assets/images/lepharo.png' alt='Lepharo' />
                <ThemeToggle />
            </header>

            <main className='wc-main'>
                {landing.kind === 'results' ? (
                    <GapResults gap={landing.gap} onPlan={() => navigate(PLAN_PATH)} onHome={() => navigate(DASHBOARD_PATH)} />
                ) : landing.kind === 'notStarted' ? (
                    <section className='wc-card gr-card' aria-labelledby='gr-title'>
                        <span className='gr-badge' aria-hidden='true'>
                            <FileSearchOutlined />
                        </span>
                        <h1 id='gr-title' className='wc-title'>
                            Your GAP analysis
                        </h1>
                        <p className='gr-lead'>
                            A short set of yes/no questions about your business: finances, compliance,
                            marketing, quality and training. Your answers show where you are strong and
                            where Lepharo can help, and they shape your development plan.
                        </p>
                        <ul className='gr-facts'>
                            <li><ClockCircleOutlined /> About 10 minutes, in 5 short steps</li>
                            <li><CheckCircleOutlined /> You review every answer before you sign</li>
                        </ul>
                        <div className='gr-actions'>
                            <Button type='primary' size='large' onClick={() => setStarted(true)}>
                                Start my GAP analysis
                            </Button>
                            <Button type='text' onClick={() => navigate(DASHBOARD_PATH)}>
                                Not now
                            </Button>
                        </div>
                    </section>
                ) : (
                    <section className='wc-card gr-card' aria-labelledby='gr-title'>
                        <span className='gr-badge' aria-hidden='true'>
                            <InfoCircleOutlined />
                        </span>
                        <h1 id='gr-title' className='wc-title'>
                            No GAP analysis yet
                        </h1>
                        <p className='gr-lead'>
                            The GAP analysis opens once your application has been accepted into a programme.
                            We'll let you know when it's ready for you.
                        </p>
                        <div className='gr-actions'>
                            <Button type='primary' size='large' onClick={() => navigate(DASHBOARD_PATH)}>
                                Go to dashboard
                            </Button>
                        </div>
                    </section>
                )}
            </main>

            <footer className='wc-foot'>
                <span>© {new Date().getFullYear()} Lepharo Smart Incubation</span>
                <PoweredByQuantilytix />
            </footer>
        </div>
    )
}

/** The submitted analysis, read back as strengths and gaps per area. */
export const GapResults: React.FC<{ gap: any; onPlan: () => void; onHome: () => void }> = ({ gap, onPlan, onHome }) => {
    const stats = useMemo(
        () =>
            SECTION_ORDER.map(key => getSectionStats(gap, key))
                .filter(s => s.total > 0)
                // Areas needing the most help first.
                .sort((a, b) => b.no + b.blank - (a.no + a.blank)),
        [gap]
    )
    const [openKey, setOpenKey] = useState<string | null>(null)

    const inPlace = stats.reduce((sum, s) => sum + s.yes, 0)
    const gaps = stats.reduce((sum, s) => sum + s.no + s.blank, 0)
    const scored = inPlace + gaps
    const pct = scored ? Math.round((inPlace / scored) * 100) : 0

    const confirmed = getGapStatus(gap) === 'Confirmed'
    const submitted = fmtDate(gap?.submittedAt)
    const reviewed = fmtDate(gap?.romReview?.confirmedAt)

    return (
        <section className='wc-card gr-card gr-results' aria-labelledby='gr-title'>
            <span className='gr-badge' aria-hidden='true'>
                <CheckCircleOutlined />
            </span>
            <h1 id='gr-title' className='wc-title'>
                Your GAP analysis results
            </h1>
            <p className='gr-lead'>
                {submitted ? `Submitted on ${submitted}. ` : ''}
                {confirmed
                    ? `Reviewed by Lepharo${reviewed ? ` on ${reviewed}` : ''}.`
                    : 'Lepharo is reviewing your answers.'}
            </p>

            <div className='gr-summary'>
                <div className='gr-score'>
                    <strong>{pct}%</strong>
                    <span>already in place</span>
                    <div className='gr-bar' aria-hidden='true'>
                        <i className='gr-bar-yes' style={{ flex: inPlace }} />
                        <i className='gr-bar-gap' style={{ flex: gaps }} />
                    </div>
                </div>
                <div className='gr-tile gr-tile-yes'>
                    <strong>{inPlace}</strong>
                    <span>Strengths</span>
                </div>
                <div className='gr-tile gr-tile-gap'>
                    <strong>{gaps}</strong>
                    <span>Areas to work on</span>
                </div>
            </div>

            <h2 className='gr-heading'>By area</h2>
            <div className='gr-sections'>
                {stats.map(s => (
                    <SectionRow
                        key={s.key}
                        gap={gap}
                        stats={s}
                        open={openKey === s.key}
                        onToggle={() => setOpenKey(openKey === s.key ? null : s.key)}
                    />
                ))}
            </div>

            <div className='gr-next'>
                <strong>What happens next</strong>
                <p>
                    {confirmed
                        ? 'Departments use the areas to work on to plan support for you. Your development plan shows what they have planned.'
                        : 'Once Lepharo has reviewed your answers, departments use the areas to work on to plan support for you in your development plan.'}
                </p>
            </div>

            <div className='gr-actions'>
                <Button type='primary' size='large' onClick={onPlan}>
                    View my development plan
                </Button>
                <Button type='text' onClick={onHome}>
                    Go to dashboard
                </Button>
            </div>
        </section>
    )
}

const SectionRow: React.FC<{
    gap: any
    stats: SectionStats
    open: boolean
    onToggle: () => void
}> = ({ gap, stats, open, onToggle }) => {
    const gapCount = stats.no + stats.blank
    const adapter = SECTION_ADAPTERS[stats.key]
    const answers = adapter.getQA(gap)
    const items = stats.states
        .map((state, index) => ({ state, index }))
        .filter(item => item.state === 'no' || item.state === 'blank')
    const panelId = `gr-panel-${stats.key}`

    return (
        <div className={`gr-section${open ? ' gr-section-open' : ''}`}>
            <button
                type='button'
                className='gr-section-head'
                onClick={onToggle}
                disabled={!gapCount}
                aria-expanded={gapCount ? open : undefined}
                aria-controls={gapCount ? panelId : undefined}
            >
                <span className='gr-section-title'>
                    <strong>{stats.title}</strong>
                    <span className='gr-mini' aria-hidden='true'>
                        <i className='gr-bar-yes' style={{ flex: stats.yes }} />
                        <i className='gr-bar-gap' style={{ flex: gapCount }} />
                    </span>
                </span>
                {gapCount ? (
                    <span className='gr-pill gr-pill-gap'>
                        {gapCount} to work on
                    </span>
                ) : (
                    <span className='gr-pill gr-pill-yes'>
                        <CheckCircleFilled /> All in place
                    </span>
                )}
                {gapCount > 0 && <DownOutlined className='gr-chevron' />}
            </button>

            {open && gapCount > 0 && (
                <ul id={panelId} className='gr-items'>
                    {items.map(({ state, index }) => (
                        <li key={index}>
                            <ExclamationCircleFilled className='gr-item-icon' />
                            <span>
                                {adapter.qText[index]}
                                <small>
                                    {state === 'blank'
                                        ? 'Not answered'
                                        : `You answered: ${answers?.[index]?.answer}`}
                                </small>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export default GapAnalysisLanding
