import React, { useEffect, useMemo, useState } from 'react'
import { Button, Empty, InputNumber, Skeleton, Tag } from 'antd'
import { AimOutlined, CheckCircleOutlined, CloseCircleOutlined, SaveOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { STATUS_META, formatValue, periodLabel, type KpiRow, type TrendPoint } from './trackerModel'
import { ProgressRing } from './TrackerList'

type Props = {
    row: KpiRow
    trend: TrendPoint[]
    trendLoading: boolean
    saving: boolean
    onRecordActual: (value: number) => void
    onRecordDone: (done: boolean) => void
    isDark: boolean
}

/** The selected KPI for the period: progress against target, the update it needs, and its recent periods. */
export const TrackerDetail: React.FC<Props> = ({ row, trend, trendLoading, saving, onRecordActual, onRecordDone, isDark }) => {
    const reduceMotion = useReducedMotion()
    const enter = reduceMotion
        ? {}
        : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.26, ease: 'easeOut' as const } }
    const { def } = row
    const meta = STATUS_META[row.status]
    const deliverable = def.kpiKind === 'qualitative'
    const manual = def.trackingMode === 'manual'
    const period = periodLabel(row.periodType, row.periodKey)
    const inProgress = row.elapsed > 0 && row.elapsed < 1

    const [draft, setDraft] = useState<number | null>(row.actual)
    useEffect(() => setDraft(row.actual), [row.def.id, row.periodKey, row.actual])

    const gap = row.target != null && row.actual != null ? row.target - row.actual : null

    // What the numbers mean, in one sentence.
    const verdict = (() => {
        if (deliverable) return row.actual == null ? `Not recorded for ${period} yet.` : row.actual >= 1 ? `Done for ${period}.` : `Marked not done for ${period}.`
        if (row.status === 'no-target') return `No target is set for ${period}, so progress can't be judged.`
        if (row.actual == null) return `The actual for ${period} hasn't been recorded yet.`
        if (row.status === 'achieved') return `Target reached${row.actual > (row.target || 0) ? `, ${formatValue(def.unit, row.actual - (row.target || 0))} over` : ''}.`
        if (!inProgress) return `${period} ended ${formatValue(def.unit, gap)} short of the target.`
        const pace = row.expected != null ? `about ${formatValue(def.unit, Math.round(row.expected))} by now at an even pace` : ''
        return row.status === 'on-track'
            ? `On pace — ${pace}. ${formatValue(def.unit, gap)} to go.`
            : `Behind pace — ${pace}. ${formatValue(def.unit, gap)} to go.`
    })()

    const chart = useMemo<Highcharts.Options | null>(() => {
        if (deliverable || trend.length < 2) return null
        const ink = isDark
            ? { actual: '#3987e5', target: '#9a9890', text: 'rgba(255,255,255,0.88)', muted: '#9a9890', grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.16)' }
            : { actual: '#2a78d6', target: '#7a7873', text: '#1f2937', muted: '#7a7873', grid: '#ecebe6', axis: '#d4d2cb' }
        const fmt = (v: number) => formatValue(def.unit, v)
        // Axis ticks stay short: R 250k, 1.2m.
        const compact = (v: number) => {
            const n = Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}m` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : String(Math.round(v))
            return def.unit === 'ZAR' ? `R ${n}` : def.unit === 'percent' ? `${n}%` : n
        }
        return {
            chart: { height: 220, backgroundColor: 'transparent', spacing: [12, 4, 4, 4], style: { fontFamily: 'inherit' } },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { enabled: true, align: 'right', verticalAlign: 'top', itemStyle: { color: ink.muted, fontSize: '11px', fontWeight: '600' }, symbolRadius: 2 },
            xAxis: { categories: trend.map(p => p.label), lineColor: ink.axis, tickLength: 0, labels: { style: { color: ink.muted, fontSize: '11px' } } },
            yAxis: { title: { text: undefined }, min: 0, gridLineColor: ink.grid, labels: { style: { color: ink.muted, fontSize: '11px' }, formatter: function () { return compact(Number(this.value)) } } },
            tooltip: {
                shared: true,
                backgroundColor: isDark ? '#2e3238' : '#ffffff',
                borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.10)',
                borderRadius: 10,
                shadow: false,
                style: { color: ink.text, fontSize: '12px' },
                formatter: function () {
                    const p = trend[this.points?.[0]?.index ?? 0]
                    const pct = p.actual != null && p.target ? ` (${Math.round((p.actual / p.target) * 100)}%)` : ''
                    return `<b>${p.label}</b><br/>Actual: <b>${p.actual == null ? 'Not recorded' : fmt(p.actual)}</b>${pct}<br/>Target: ${fmt(p.target)}`
                }
            },
            plotOptions: { series: { animation: { duration: 500 } }, column: { borderRadius: 4, pointPadding: 0.12, groupPadding: 0.18 } },
            series: [
                {
                    type: 'column',
                    name: 'Actual',
                    color: ink.actual,
                    data: trend.map((p, i) => i === trend.length - 1 && p.actual != null
                        ? { y: p.actual, dataLabels: { enabled: true, format: fmt(p.actual), style: { color: ink.text, fontSize: '11px', fontWeight: '700', textOutline: 'none' } } }
                        : p.actual)
                },
                {
                    type: 'line',
                    name: 'Target',
                    color: ink.target,
                    dashStyle: 'ShortDash',
                    lineWidth: 2,
                    marker: { enabled: true, symbol: 'circle', radius: 3 },
                    data: trend.map(p => p.target)
                }
            ]
        }
    }, [trend, deliverable, isDark, def.unit])

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${def.id}`} className='ws-detail-head' {...enter}>
                    <ProgressRing row={row} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{def.kpiLabel}</h2>
                        <div className='ws-detail-sub'>{def.department} · {period}</div>
                        <div className='ws-detail-tags'>
                            <span className={`trk-status qtx-tone-${meta.tone}`}>{meta.label}</span>
                            <Tag bordered={false} className={`kpr-tag ${manual ? 'is-manual' : 'is-live'}`}>{manual ? 'Manual' : 'Live'}</Tag>
                        </div>
                    </div>
                </motion.header>

                <motion.div key={`body-${def.id}-${row.periodKey}`} className='trk-detail-body' {...enter}>
                    {!deliverable && (
                        <section className='trk-progress'>
                            <div className='trk-progress-figures'>
                                <div>
                                    <div className='trk-progress-label'>Actual</div>
                                    <div className='trk-progress-value'>{formatValue(def.unit, row.actual)}</div>
                                </div>
                                <div className='trk-progress-target'>
                                    <div className='trk-progress-label'>Target</div>
                                    <div className='trk-progress-value is-muted'>{formatValue(def.unit, row.target)}</div>
                                </div>
                            </div>
                            {row.target != null && (
                                <div className={`trk-bar qtx-tone-${meta.tone}`} role='img' aria-label={`${row.percent ?? 0}% of target`}>
                                    <span className='trk-bar-fill' style={{ width: `${Math.min(row.percent ?? 0, 100)}%` }} />
                                    {inProgress && row.expected != null && (
                                        <span className='trk-bar-pace' style={{ left: `${Math.min(row.elapsed * 100, 100)}%` }} title='Where an even pace would be today' />
                                    )}
                                </div>
                            )}
                            <p className='trk-verdict'>{verdict}</p>
                        </section>
                    )}

                    {deliverable && (
                        <section className='trk-progress'>
                            <div className='trk-progress-label'>Deliverable</div>
                            <div className='trk-deliverable'>{def.deliverable || def.kpiLabel}</div>
                            {def.measurementIndicator && <div className='trk-measure'>Measured by: {def.measurementIndicator}</div>}
                            <p className='trk-verdict'>{verdict}</p>
                        </section>
                    )}

                    {/* The one update this KPI needs, if any. */}
                    {deliverable ? (
                        <section>
                            <h3 className='ws-section-title'>Record {period}</h3>
                            <div className='trk-actions'>
                                <Button
                                    type={row.actual != null && row.actual >= 1 ? 'primary' : 'default'}
                                    icon={<CheckCircleOutlined />}
                                    loading={saving}
                                    onClick={() => onRecordDone(true)}
                                >
                                    Done
                                </Button>
                                <Button
                                    danger={row.actual === 0}
                                    icon={<CloseCircleOutlined />}
                                    loading={saving}
                                    onClick={() => onRecordDone(false)}
                                >
                                    Not done
                                </Button>
                            </div>
                        </section>
                    ) : row.status === 'no-target' ? (
                        <section>
                            <Link to={`/kpis/setup?kpi=${encodeURIComponent(def.id)}&targets=1`}>
                                <Button block type='primary' icon={<AimOutlined />}>Plan targets for this KPI</Button>
                            </Link>
                        </section>
                    ) : manual ? (
                        <section>
                            <h3 className='ws-section-title'>{row.actual == null ? `Record the actual for ${period}` : `Update the actual for ${period}`}</h3>
                            <div className='trk-actions'>
                                <InputNumber
                                    className='trk-actual-input'
                                    min={0}
                                    value={draft}
                                    onChange={value => setDraft(value == null ? null : Number(value))}
                                    onPressEnter={() => draft != null && draft !== row.actual && onRecordActual(draft)}
                                    prefix={def.unit === 'ZAR' ? 'R' : undefined}
                                    suffix={def.unit === 'percent' ? '%' : undefined}
                                    aria-label='Actual value'
                                />
                                <Button
                                    type='primary'
                                    icon={<SaveOutlined />}
                                    loading={saving}
                                    disabled={draft == null || draft === row.actual}
                                    onClick={() => draft != null && onRecordActual(draft)}
                                >
                                    Save
                                </Button>
                            </div>
                        </section>
                    ) : null}

                    {!deliverable && (
                        <section>
                            <h3 className='ws-section-title'>Recent periods</h3>
                            {trendLoading ? (
                                <Skeleton active paragraph={{ rows: 4 }} title={false} />
                            ) : chart ? (
                                <HighchartsReact highcharts={Highcharts} options={chart} />
                            ) : (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='A trend appears once two or more periods have targets.' />
                            )}
                        </section>
                    )}
                </motion.div>
            </MotionCard>
        </div>
    )
}
