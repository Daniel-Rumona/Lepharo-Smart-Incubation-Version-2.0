import { memo, useEffect, useMemo, useState } from 'react'
import { Typography } from 'antd'
import {
    AppstoreFilled,
    BankFilled,
    CalendarFilled,
    FireFilled,
    PictureFilled,
    RocketFilled,
    StarFilled,
    TeamOutlined,
    TrophyFilled,
    UserAddOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import type { Dayjs } from 'dayjs'
import StoryPlayer, { BLUE, CountUp, GREEN, ORANGE, PINK, PURPLE, TEAL, type StorySlide } from './StoryPlayer'
import { buildProjectAdminStory, type Count, type ProjectAdminStory } from './projectAdminStoryData'

const { Text } = Typography

type Props = {
    dark?: boolean
    open: boolean
    /** Start gathering the data before the player is shown, e.g. during a transition. */
    preload?: boolean
    inline?: boolean
    onClose: () => void
    programId?: string | null
    programName?: string
    branchId?: string | null
    range: [Dayjs, Dayjs]
}

const rand = (value: number) =>
    value >= 1_000_000 ? `R${(value / 1_000_000).toFixed(1)}m`
        : value >= 1_000 ? `R${Math.round(value / 1_000)}k`
            : `R${Math.round(value)}`

type MonthPoint = { label: string; submitted: number; accepted: number }

/*
  The chart is its own memoised component: when the options object changes identity on a
  re-render, Highcharts replays the column animation, and the columns then flicker and
  barely show while the player is running. It also draws without animation for the same
  reason, and is sized to the screen so the slide fits without scrolling.
*/
const ApplicationsChart = memo(({ months, dark }: { months: MonthPoint[]; dark: boolean }) => {
    const options = useMemo<Highcharts.Options>(() => {
        const textColor = dark ? '#cfcaf5' : '#5b6070'
        const gridColor = dark ? 'rgba(255,255,255,.12)' : 'rgba(31,27,58,.1)'
        const height = Math.max(160, Math.min(250, window.innerHeight - 420))
        return {
            chart: { type: 'column', height, backgroundColor: 'transparent', animation: false },
            title: { text: undefined },
            credits: { enabled: false },
            exporting: { enabled: false },
            legend: { itemStyle: { color: textColor } },
            xAxis: { categories: months.map(m => m.label), labels: { style: { color: textColor } }, lineColor: gridColor },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineColor: gridColor, labels: { style: { color: textColor } } },
            plotOptions: { series: { animation: false }, column: { borderWidth: 0, borderRadius: 4 } },
            series: [
                { type: 'column', name: 'Applications', color: BLUE, data: months.map(m => m.submitted) },
                { type: 'column', name: 'Accepted', color: GREEN, data: months.map(m => m.accepted) }
            ]
        }
    }, [months, dark])
    return <HighchartsReact highcharts={Highcharts} options={options} />
})

const StatCard = ({ value, label, color, delay = 0, active }: { value: number; label: string; color: string; delay?: number; active: boolean }) => (
    <div className='rp-card rp-rise' style={{ padding: '18px 22px', minWidth: 190, animationDelay: `${delay}s` }}>
        <div className='rp-num' style={{ fontSize: 'clamp(30px,4.2vw,46px)', color }}>
            <CountUp to={value} active={active} />
        </div>
        <div style={{ marginTop: 4, color: 'var(--rp-muted)', fontWeight: 600, fontSize: 13 }}>{label}</div>
    </div>
)

const BarList = ({ title, rows, color = PURPLE }: { title?: string; rows: Count[]; color?: string }) => {
    const max = Math.max(...rows.map(row => row.count), 1)
    return (
        <div className='rp-card' style={{ padding: '16px 18px', textAlign: 'left' }}>
            {title && <div className='rp-kicker' style={{ marginBottom: 10, fontSize: 11 }}>{title}</div>}
            {rows.map(row => (
                <div key={row.name} style={{ marginBottom: 9 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                        <Text style={{ color: 'var(--rp-fg)' }} ellipsis>{row.name}</Text>
                        <Text style={{ color: 'var(--rp-muted)' }}>{row.count}</Text>
                    </div>
                    <div className='rp-bartrack' style={{ height: 7, marginTop: 4 }}>
                        <div className='rp-barfill rp-bar' style={{ width: `${Math.round((row.count / max) * 100)}%`, background: color }} />
                    </div>
                </div>
            ))}
        </div>
    )
}

const ProjectAdminReportPlayer = ({ dark = true, open, preload = false, inline = false, onClose, programId, programName, branchId, range }: Props) => {
    const [story, setStory] = useState<ProjectAdminStory | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!open && !preload) return
        let cancelled = false
        setLoading(true)
        setStory(null)
        buildProjectAdminStory({ programId, branchId, range })
            .then(result => { if (!cancelled) setStory(result) })
            .catch(error => console.error('[ProjectAdminReportPlayer] failed', error))
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open || preload, programId, branchId, range[0].valueOf(), range[1].valueOf()])

    const slides = useMemo<StorySlide[]>(() => {
        if (!story) return []
        const list: StorySlide[] = []
        list.push({
            key: 'intro',
            render: () => (
                <>
                    <div className='rp-pop rp-float' style={{ fontSize: 72, color: PINK }}><RocketFilled /></div>
                    <div className='rp-kicker rp-rise' style={{ animationDelay: '.2s', marginTop: 18 }}>
                        {programName || 'Programme'} · {story.periodLabel}
                    </div>
                    <h1 className='rp-title rp-rise' style={{ animationDelay: '.35s' }}>Here&apos;s how the programme is doing</h1>
                    <div className='rp-sub rp-rise' style={{ animationDelay: '.6s' }}>
                        SMEs, walk-ins, delivery, appointments, performance and the stories behind them.
                    </div>
                </>
            )
        })

        if (story.smes) {
            const { smes } = story
            list.push({
                key: 'smes',
                render: () => (
                    <>
                        <div className='rp-kicker rp-rise'>Our SMEs</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s', fontSize: 'clamp(26px,4vw,44px)' }}>
                            <CountUp to={smes.total} active={open} /> SMEs in the programme to date
                        </h2>
                        <div className='rp-cards' style={{ marginTop: 14 }}>
                            <StatCard value={smes.submittedInPeriod} label='Applications this period' color={BLUE} delay={0.15} active={open} />
                            <StatCard value={smes.acceptedInPeriod} label='Accepted this period' color={GREEN} delay={0.25} active={open} />
                        </div>
                        <div className='rp-card rp-rise' style={{ width: '100%', maxWidth: 900, marginTop: 14, padding: '10px 12px 2px', animationDelay: '.35s' }}>
                            <ApplicationsChart months={smes.months} dark={dark} />
                        </div>
                    </>
                )
            })
        }

        if (story.demographics) {
            const { demographics: d } = story
            list.push({
                key: 'demographics',
                render: () => (
                    <>
                        <div className='rp-pop' style={{ fontSize: 52, color: PURPLE }}><TeamOutlined /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 10 }}>Who is in the programme right now</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s', fontSize: 'clamp(24px,3.6vw,40px)' }}>
                            <CountUp to={d.total} active={open} /> SMEs by profile
                        </h2>
                        <div className='rp-panels rp-rise' style={{ animationDelay: '.2s' }}>
                            <BarList title='Gender' rows={d.gender} color={PINK} />
                            <BarList title='B-BBEE level' rows={d.bee} color={BLUE} />
                            <BarList title='Sector' rows={d.sector} color={GREEN} />
                            <BarList title='Ward / hub' rows={d.ward} color={ORANGE} />
                        </div>
                    </>
                )
            })
        }

        if (story.walkIns) {
            const { walkIns: w } = story
            list.push({
                key: 'walkins',
                render: () => (
                    <>
                        <div className='rp-pop' style={{ fontSize: 56, color: GREEN }}><UserAddOutlined /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 12 }}>Through our doors</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s' }}>
                            <CountUp to={w.total} active={open} /> walk-in{w.total === 1 ? '' : 's'}
                        </h2>
                        {w.total > 0 && (
                            <div className='rp-panels'>
                                <div style={{ display: 'grid', gap: 14, flex: '0 1 240px' }}>
                                    <StatCard value={w.incubated} label='Incubated SMEs' color={GREEN} delay={0.15} active={open} />
                                    <StatCard value={w.nonIncubated} label='Non-incubatees' color={BLUE} delay={0.25} active={open} />
                                </div>
                                <BarList title='What they came for' rows={w.topTypes} color={PURPLE} />
                            </div>
                        )}
                    </>
                )
            })
        }

        if (story.interventions) {
            const { interventions: i } = story
            list.push({
                key: 'interventions',
                render: () => (
                    <>
                        <div className='rp-pop' style={{ fontSize: 56, color: GREEN }}><FireFilled /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 12 }}>Delivered this period</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s' }}>
                            <CountUp to={i.total} active={open} /> interventions completed
                        </h2>
                        <div className='rp-cards'>
                            <StatCard value={i.smesReached} label='SMEs reached' color={BLUE} delay={0.15} active={open} />
                            <div className='rp-card rp-rise' style={{ padding: '18px 22px', minWidth: 190, animationDelay: '.25s' }}>
                                <div className='rp-num' style={{ fontSize: 'clamp(30px,4.2vw,46px)', color: PINK }}>{i.averagePerSme}</div>
                                <div style={{ marginTop: 4, color: 'var(--rp-muted)', fontWeight: 600, fontSize: 13 }}>Avg. interventions per SME</div>
                            </div>
                        </div>
                        {i.byDepartment.length > 0 && (
                            <div className='rp-list' style={{ maxWidth: 'min(1000px, 100%)', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', alignItems: 'start', marginTop: 20 }}>
                                {i.byDepartment.map((row, index) => (
                                    <div key={row.name} className='rp-card rp-row rp-rise' style={{ animationDelay: `${0.3 + index * 0.06}s`, flexDirection: 'column', alignItems: 'stretch' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                            <Text strong style={{ color: 'var(--rp-fg)' }}>{row.name}</Text>
                                            <Text style={{ color: 'var(--rp-muted)' }}>{row.count}</Text>
                                        </div>
                                        <div className='rp-bartrack'>
                                            <div className='rp-barfill rp-bar' style={{ width: `${Math.round((row.count / i.byDepartment[0].count) * 100)}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )
            })
        }

        if (story.appointments) {
            const a = story.appointments
            list.push({
                key: 'appointments',
                render: () => (
                    <>
                        <div className='rp-pop' style={{ fontSize: 56, color: BLUE }}><CalendarFilled /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 12 }}>Face to face and online</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s' }}>
                            <CountUp to={a.held} active={open} /> appointment{a.held === 1 ? '' : 's'} held
                        </h2>
                        <div className='rp-panels'>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, flex: '0 1 auto' }}>
                                <StatCard value={a.sessions} label='Scheduled in period' color={BLUE} delay={0.15} active={open} />
                                <StatCard value={a.attendanceRate} label='Attendance rate %' color={GREEN} delay={0.25} active={open} />
                                <div style={{ gridColumn: '1 / -1', color: 'var(--rp-muted)', fontSize: 13 }}>
                                    {a.attended} of {a.invited} invited SMEs attended
                                </div>
                            </div>
                            <BarList title='How they were delivered' rows={a.byMethod} color={TEAL} />
                        </div>
                    </>
                )
            })

            if (a.photos.length) {
                list.push({
                    key: 'photos',
                    render: () => (
                        <>
                        <div className='rp-pop' style={{ fontSize: 48, color: PINK }}><PictureFilled /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 10 }}>From the sessions</div>
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: '100%', maxWidth: 900, marginTop: 20 }}>
                            {a.photos.map((url, index) => (
                                <img
                                    key={url}
                                    src={url}
                                    alt='Session'
                                    className='rp-rise'
                                    style={{ width: '100%', height: 190, objectFit: 'cover', borderRadius: 14, animationDelay: `${0.1 + index * 0.08}s` }}
                                />
                            ))}
                        </div>
                        </>
                    )
                })
            }
        }

        if (story.performance) {
            const perf = story.performance
            const { jobs, revenue } = perf
            list.push({
                key: 'performance',
                render: () => (
                    <>
                        <div className='rp-pop' style={{ fontSize: 56, color: ORANGE }}><BankFilled /></div>
                        <div className='rp-kicker rp-rise' style={{ marginTop: 12 }}>How the SMEs are performing</div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.1s', fontSize: 'clamp(26px,4vw,44px)' }}>Jobs &amp; revenue</h2>
                        <div className='rp-sub rp-rise' style={{ animationDelay: '.2s', fontSize: 14, marginTop: 8 }}>
                            {perf.isEarlierPeriod
                                ? `Nothing reported yet for this period, so this is the latest reported: ${perf.periodLabel}`
                                : perf.periodLabel}
                        </div>
                        <div className='rp-cards'>
                            <div className='rp-card rp-rise' style={{ padding: '22px 26px', minWidth: 240, animationDelay: '.15s' }}>
                                <div className='rp-num' style={{ color: GREEN }}>
                                    {jobs ? <CountUp to={jobs.total} active={open} /> : '—'}
                                </div>
                                <div style={{ marginTop: 6, color: 'var(--rp-muted)', fontWeight: 600 }}>Jobs supported</div>
                                <div style={{ marginTop: 8, color: 'var(--rp-muted)', fontSize: 13 }}>
                                    {jobs ? `${jobs.permanent} permanent · ${jobs.temporary} temporary` : 'Jobs could not be loaded'}
                                </div>
                            </div>
                            <div className='rp-card rp-rise' style={{ padding: '22px 26px', minWidth: 240, animationDelay: '.25s' }}>
                                <div className='rp-num' style={{ color: BLUE }}>{revenue ? rand(revenue.current) : '—'}</div>
                                <div style={{ marginTop: 6, color: 'var(--rp-muted)', fontWeight: 600 }}>Reported SME revenue</div>
                                <div style={{ marginTop: 8, color: 'var(--rp-muted)', fontSize: 13 }}>
                                    {revenue
                                        ? <>
                                            {revenue.changePercent === null
                                                ? 'No earlier period to compare'
                                                : `${revenue.changePercent > 0 ? '+' : ''}${revenue.changePercent}% vs previous period`}
                                            {revenue.smesUp + revenue.smesDown > 0 && ` · ${revenue.smesUp} up, ${revenue.smesDown} down`}
                                        </>
                                        : perf.revenueUnavailable
                                            ? 'Finance data could not be reached'
                                            : 'No revenue reported yet'}
                                </div>
                            </div>
                        </div>
                    </>
                )
            })
        }

        ;(story.stories || []).forEach((item, index) => {
            list.push({
                key: `story-${index}`,
                render: () => (
                    <>
                        {item.image ? (
                            <img src={item.image} alt='' className='rp-pop' style={{ width: 'min(520px, 100%)', height: 220, objectFit: 'cover', borderRadius: 18 }} />
                        ) : (
                            <div className='rp-pop' style={{ fontSize: 56, color: PINK }}><StarFilled /></div>
                        )}
                        <div className='rp-kicker rp-rise' style={{ marginTop: 14 }}>
                            Success story{item.sme ? ` · ${item.sme}` : ''}
                        </div>
                        <h2 className='rp-title rp-rise' style={{ animationDelay: '.15s', fontSize: 'clamp(24px,3.6vw,40px)' }}>{item.title}</h2>
                        <div className='rp-sub rp-rise' style={{ animationDelay: '.3s', maxWidth: 780 }}>{item.summary}</div>
                    </>
                )
            })
        })

        list.push({
            key: 'closing',
            render: () => (
                <>
                    <div className='rp-pop rp-float' style={{ fontSize: 72, color: GREEN }}><TrophyFilled /></div>
                    <div className='rp-kicker rp-rise' style={{ marginTop: 18 }}>{story.periodLabel}</div>
                    <h1 className='rp-title rp-rise' style={{ animationDelay: '.2s' }}>That&apos;s the story so far</h1>
                    <div className='rp-sub rp-rise' style={{ animationDelay: '.4s' }}>
                        <AppstoreFilled /> Open the report tabs for the detail behind each slide.
                    </div>
                </>
            )
        })

        return list
    }, [story, open, dark, programName])

    return (
        <StoryPlayer
            dark={dark}
            open={open}
            onClose={onClose}
            slides={slides}
            loading={loading}
            ariaLabel='Project report playback'
            inline={inline}
        />
    )
}

export default ProjectAdminReportPlayer
