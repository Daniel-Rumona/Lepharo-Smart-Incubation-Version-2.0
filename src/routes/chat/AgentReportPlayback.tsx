import { useCallback, useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { createPortal } from 'react-dom'
import { message } from 'antd'
import StoryPlayer from '@/components/reports/StoryPlayer'
import ProjectAdminReportPlayer from '@/components/reports/ProjectAdminReportPlayer'
import MonitoringReportPlayer from '@/routes/operations/reports/monitoring/MonitoringReportPlayer'
import FeatureGovernanceReportPlayer from '@/routes/admin/features/ReportPlayer'
import MilestoneJourney from '@/components/milestone-journey/MilestoneJourney'
import { featureGovernanceService } from '@/services/featureGovernanceService'
import { governanceMeetingService } from '@/services/governanceMeetingService'
import type { FeatureGovernanceRecord, GovernanceMeeting } from '@/types/featureGovernance'
import { buildConsolidatedMeProgramReport } from '@/utils/buildProgramSummaryReportWithCharts'
import type { MonthlyReportData } from '@/utils/monthlyReportDocx'
import { DepartmentRoleKey, useDepartmentRoles } from '@/services/departmentRoles'

/*
  "Play report" from the agent page. Choreography, starting from the text field:
    fade    the agent's controls fade away
    shrink  the field closes in from both ends until it is a blob
    rise    the blob lifts off, leaving a trail
    ripple  rings spread out and the report opens from the blob's position
*/

export type AgentReportKind = 'project' | 'me' | 'governance' | 'journey'
type Phase = 'idle' | 'fade' | 'shrink' | 'rise' | 'ripple'

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/_/g, ' ')

/** Roles that have a report to play. */
export const getAgentReportKind = (
    user: Record<string, any> | null,
    departmentRole: DepartmentRoleKey | null
): AgentReportKind | null => {
    const role = norm(user?.role)
    if (role === 'projectadmin' || role === 'project admin') return 'project'
    if (role === 'system admin') return 'governance'
    if (role === 'operations' && departmentRole === 'monitoring') return 'me'
    // Every other operations department plays its milestone journey.
    if (role === 'operations') return 'journey'
    return null
}

export const AGENT_REPORT_LABEL: Record<AgentReportKind, string> = {
    project: 'Play the project report',
    me: 'Play the programme report',
    governance: 'Play the feature governance report',
    journey: 'Play the department journey'
}

const T_SHRINK = 320
const T_RISE = 900
const T_RIPPLE = 1600
const BLOB_SIZE = 64

type Args = {
    user: Record<string, any> | null
    kind: AgentReportKind | null
    programId?: string | null
    isAllPrograms: boolean
    isDark: boolean
}

export function useAgentReportPlayback({ user, kind, programId, isAllPrograms, isDark }: Args) {
    const [phase, setPhase] = useState<Phase>('idle')
    const [playing, setPlaying] = useState(false)
    const [meData, setMeData] = useState<MonthlyReportData | null>(null)
    const [govData, setGovData] = useState<{ records: FeatureGovernanceRecord[]; meetings: GovernanceMeeting[] } | null>(null)
    const [origin, setOrigin] = useState<{ rect: DOMRect; html: string } | null>(null)
    const timers = useRef<number[]>([])
    const { idForRole, nameOf } = useDepartmentRoles()
    const monitoringDepartmentName = nameOf(idForRole('monitoring'), 'M&E')
    const blobRef = useRef<HTMLDivElement | null>(null)

    const clearTimers = () => {
        timers.current.forEach(id => window.clearTimeout(id))
        timers.current = []
    }
    useEffect(() => clearTimers, [])

    const range: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs().startOf('month'), dayjs().endOf('month')]
    const govRangeLabel = `This month: ${range[0].format('DD MMM YYYY')} - ${range[1].format('DD MMM YYYY')}`

    const start = useCallback((composer: HTMLElement | null) => {
        if (!kind || phase !== 'idle' || !composer) return

        setOrigin({ rect: composer.getBoundingClientRect(), html: composer.innerHTML })
        setMeData(null)
        setGovData(null)
        setPhase('fade')

        // The M&E report is built while the animation plays, so nothing shows a loader.
        if (kind === 'me') {
            buildConsolidatedMeProgramReport({
                programId: isAllPrograms ? undefined : programId,
                reportTitleDepartmentName: `${monitoringDepartmentName} (Consolidated)`,
                period: { month: range[0].month() + 1, year: range[0].year(), spanMonths: 1 },
                meta: { preparedBy: user?.name || user?.email || '—' }
            })
                .then(setMeData)
                .catch(error => {
                    console.error('[AgentReportPlayback] report failed', error)
                    message.error('The report could not be built.')
                })
        }

        // Same for the feature governance report: it is read while the animation plays.
        if (kind === 'governance') {
            Promise.all([featureGovernanceService.list(), governanceMeetingService.list()])
                .then(([records, meetings]) => setGovData({ records, meetings }))
                .catch(error => {
                    console.error('[AgentReportPlayback] governance report failed', error)
                    message.error('The report could not be built.')
                })
        }

        timers.current = [
            window.setTimeout(() => setPhase('shrink'), T_SHRINK),
            window.setTimeout(() => setPhase('rise'), T_RISE),
            window.setTimeout(() => { setPhase('ripple'); setPlaying(true) }, T_RIPPLE)
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, phase, programId, isAllPrograms, user, monitoringDepartmentName])

    const close = useCallback(() => {
        clearTimers()
        setPlaying(false)
        setPhase('idle')
        setOrigin(null)
    }, [])

    // ---- blob animation, driven by the phase ----
    useEffect(() => {
        const blob = blobRef.current
        if (!blob || !origin) return
        const { rect } = origin
        const cx = rect.left + rect.width / 2
        const startCy = rect.top + rect.height / 2
        const targetCy = Math.max(window.innerHeight * 0.36, BLOB_SIZE)

        if (phase === 'shrink') {
            blob.animate(
                [
                    { left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, top: `${rect.top}px`, borderRadius: getComputedStyle(blob).borderRadius },
                    { left: `${cx - BLOB_SIZE / 2}px`, width: `${BLOB_SIZE}px`, height: `${BLOB_SIZE}px`, top: `${startCy - BLOB_SIZE / 2}px`, borderRadius: `${BLOB_SIZE / 2}px` }
                ],
                { duration: T_RISE - T_SHRINK - 80, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }
            )
        }
        if (phase === 'rise') {
            blob.animate(
                [
                    { top: `${startCy - BLOB_SIZE / 2}px`, transform: 'scale(1)' },
                    { top: `${startCy - BLOB_SIZE / 2 + 10}px`, transform: 'scale(1.1, .85)', offset: 0.15 },
                    { top: `${targetCy - BLOB_SIZE / 2}px`, transform: 'scale(.9, 1.15)', offset: 0.85 },
                    { top: `${targetCy - BLOB_SIZE / 2}px`, transform: 'scale(1)' }
                ],
                { duration: T_RIPPLE - T_RISE - 60, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }
            )
        }
        if (phase === 'ripple') {
            blob.animate(
                [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(2.4)' }],
                { duration: 700, easing: 'ease-out', fill: 'forwards' }
            )
        }
    }, [phase, origin])

    const overlayNode = origin && phase !== 'idle' ? (() => {
        const { rect, html } = origin
        const cx = rect.left + rect.width / 2
        const startCy = rect.top + rect.height / 2
        const targetCy = Math.max(window.innerHeight * 0.36, BLOB_SIZE)
        const rising = phase === 'rise' || phase === 'ripple'
        const diagonal = Math.hypot(window.innerWidth, window.innerHeight)

        return (
            <>
                <style>{`
                    @keyframes ar-trail { from { opacity:.55; transform: scale(1);} to { opacity:0; transform: scale(.25);} }
                    @keyframes ar-streak { 0% { transform: scaleY(0); opacity:.7;} 60% { transform: scaleY(1); opacity:.55;} 100% { transform: scaleY(1); opacity:0;} }
                    @keyframes ar-ring { from { transform: scale(1); opacity:.7;} to { transform: scale(var(--ar-scale)); opacity:0;} }
                    @keyframes ar-reveal { from { clip-path: circle(0px at var(--ar-x) var(--ar-y)); } to { clip-path: circle(var(--ar-r) at var(--ar-x) var(--ar-y)); } }
                    .ar-blob-closing > * { opacity: 0; transition: opacity .18s ease; }
                    .ar-blob { transition: background .35s ease, border-color .35s ease, box-shadow .35s ease; }
                    @media (prefers-reduced-motion: reduce) { .ar-motion { animation-duration: 1ms !important; } }
                `}</style>

                <div style={{ position: 'fixed', inset: 0, zIndex: 1990, pointerEvents: 'none' }}>
                    {/* the text field, closing in to a blob */}
                    <div
                        ref={blobRef}
                        className={`chat-input-wrap ar-blob ${phase === 'fade' ? '' : 'ar-blob-closing'}`}
                        dangerouslySetInnerHTML={{ __html: html }}
                        style={{
                            position: 'fixed',
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height,
                            margin: 0,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                            ...(phase === 'fade' ? {} : {
                                background: 'var(--app-accent, #1677ff)',
                                borderColor: 'transparent',
                                boxShadow: rising ? '0 0 36px var(--app-accent, #1677ff)' : undefined
                            })
                        }}
                    />

                    {/* streak and trail left as it lifts off */}
                    {rising && (
                        <>
                            <div
                                className='ar-motion'
                                style={{
                                    position: 'fixed',
                                    left: cx - BLOB_SIZE * 0.3,
                                    top: targetCy,
                                    width: BLOB_SIZE * 0.6,
                                    height: startCy - targetCy,
                                    borderRadius: BLOB_SIZE,
                                    background: 'linear-gradient(to top, var(--app-accent, #1677ff), transparent)',
                                    transformOrigin: 'bottom',
                                    animation: `ar-streak ${T_RIPPLE - T_RISE + 300}ms ease-out forwards`
                                }}
                            />
                            {Array.from({ length: 6 }, (_, index) => (
                                <div
                                    key={index}
                                    className='ar-motion'
                                    style={{
                                        position: 'fixed',
                                        left: cx - BLOB_SIZE / 2,
                                        width: BLOB_SIZE,
                                        height: BLOB_SIZE,
                                        borderRadius: '50%',
                                        background: 'var(--app-accent, #1677ff)',
                                        top: startCy - BLOB_SIZE / 2 - ((startCy - targetCy) * (index + 1)) / 7,
                                        opacity: 0,
                                        animation: `ar-trail ${520}ms ease-out ${index * 70}ms both`
                                    }}
                                />
                            ))}
                        </>
                    )}

                    {/* ripples as the report comes in */}
                    {phase === 'ripple' && [0, 140, 280].map(delay => (
                        <div
                            key={delay}
                            className='ar-motion'
                            style={{
                                position: 'fixed',
                                left: cx - BLOB_SIZE / 2,
                                top: targetCy - BLOB_SIZE / 2,
                                width: BLOB_SIZE,
                                height: BLOB_SIZE,
                                borderRadius: '50%',
                                border: '2px solid var(--app-accent, #1677ff)',
                                ['--ar-scale' as any]: (diagonal / BLOB_SIZE) * 1.3,
                                animation: `ar-ring 1100ms cubic-bezier(.2,.7,.3,1) ${delay}ms both`
                            }}
                        />
                    ))}
                </div>

                {/* the report, opening from the blob's position */}
                <div
                    className='ar-motion'
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 2000,
                        pointerEvents: playing ? undefined : 'none',
                        ['--ar-x' as any]: `${cx}px`,
                        ['--ar-y' as any]: `${targetCy}px`,
                        ['--ar-r' as any]: `${diagonal}px`,
                        clipPath: playing ? undefined : `circle(0px at ${cx}px ${targetCy}px)`,
                        animation: playing ? 'ar-reveal 1000ms cubic-bezier(.3,.6,.2,1) both' : undefined
                    }}
                >
                    {kind === 'project' && (
                        <ProjectAdminReportPlayer
                            dark={isDark}
                            open={playing}
                            preload
                            inline
                            onClose={close}
                            programId={isAllPrograms ? null : programId}
                            branchId={user?.assignedBranch}
                            range={range}
                        />
                    )}
                    {kind === 'me' && playing && (meData
                        ? <MonitoringReportPlayer dark={isDark} open onClose={close} inline data={meData} rangeLabel={`${range[0].format('D MMM YYYY')} – ${range[1].format('D MMM YYYY')}`} />
                        : <StoryPlayer dark={isDark} open onClose={close} slides={[]} loading inline />)}
                    {/* The journey loads its own data, so it is mounted for the whole animation and opens when it ends. */}
                    {kind === 'journey' && (
                        <MilestoneJourney
                            scope='operations'
                            departmentId={user?.departmentId}
                            programId={isAllPrograms ? null : programId}
                            controlled={{ open: playing, onClose: close, inline: true }}
                        />
                    )}
                    {kind === 'governance' && playing && (govData
                        ? (
                            <FeatureGovernanceReportPlayer
                                dark={isDark}
                                open
                                inline
                                onClose={close}
                                records={govData.records}
                                meetings={govData.meetings}
                                rangeLabel={govRangeLabel}
                                startDate={range[0].format('YYYY-MM-DD')}
                                endDate={range[1].format('YYYY-MM-DD')}
                            />
                        )
                        : <StoryPlayer dark={isDark} open onClose={close} slides={[]} loading inline />)}
                </div>
            </>
        )
    })() : null

    // Straight into <body>, so the agent page's own layout can never sit over the transition.
    const overlay = overlayNode ? createPortal(overlayNode, document.body) : null

    return { phase, start, overlay, active: phase !== 'idle' }
}
