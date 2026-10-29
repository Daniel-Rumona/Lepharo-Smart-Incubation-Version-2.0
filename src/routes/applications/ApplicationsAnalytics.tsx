import React, { useMemo } from 'react'
import { Empty, Modal } from 'antd'
import { STATUS_META, type Application } from './applicationData'
import type { MetricTone } from '@/components/dashboards/metrics/MetricTile'

type Props = {
    open: boolean
    onClose: () => void
    /** Exactly what the list shows, so the numbers match the filters on screen. */
    applications: Application[]
    showHub: boolean
}

type Row = { label: string; count: number; tone?: MetricTone }

const STATUS_TONE: Record<string, MetricTone> = { pending: 'warning', accepted: 'success', rejected: 'danger' }

const countBy = (apps: Application[], key: (a: Application) => string): Row[] => {
    const map = new Map<string, number>()
    apps.forEach(a => {
        const k = key(a).trim() || 'Not specified'
        map.set(k, (map.get(k) || 0) + 1)
    })
    return Array.from(map, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

const Distribution: React.FC<{ title: string; rows: Row[]; total: number }> = ({ title, rows, total }) => (
    <section className='apx-dist'>
        <h4>{title}</h4>
        {rows.map(r => {
            const share = total ? Math.round((r.count / total) * 100) : 0
            return (
                <div key={r.label} className={`apx-dist-row qtx-tone-${r.tone || 'accent'}`}>
                    <span className='apx-dist-label' title={r.label}>
                        {r.label}
                    </span>
                    <span className='apx-dist-track' aria-hidden='true'>
                        <span className='apx-dist-fill' style={{ width: `${share}%`, display: 'block' }} />
                    </span>
                    <span className='apx-dist-value'>
                        {r.count} · {share}%
                    </span>
                </div>
            )
        })}
    </section>
)

/** Breakdowns of the filtered applications; every bar is a share of the same total. */
export const ApplicationsAnalytics: React.FC<Props> = ({ open, onClose, applications, showHub }) => {
    const total = applications.length
    const groups = useMemo(
        () => [
            {
                title: 'Status',
                rows: countBy(applications, a => STATUS_META[a.applicationStatus].label).map(r => ({
                    ...r,
                    tone: STATUS_TONE[r.label.toLowerCase()]
                }))
            },
            { title: 'Gender', rows: countBy(applications, a => a.gender) },
            { title: 'Age group', rows: countBy(applications, a => a.ageGroup) },
            ...(showHub ? [{ title: 'Hub', rows: countBy(applications, a => a.hub) }] : [])
        ],
        [applications, showHub]
    )

    return (
        <Modal
            title={`Analytics · ${total} application${total === 1 ? '' : 's'}`}
            open={open}
            onCancel={onClose}
            footer={null}
            width={760}
            centered
        >
            {total === 0 ? (
                <Empty description='No applications match the current filters' />
            ) : (
                <div className='apx-analytics'>
                    {groups.map(g => (
                        <Distribution key={g.title} title={g.title} rows={g.rows} total={total} />
                    ))}
                </div>
            )}
        </Modal>
    )
}
