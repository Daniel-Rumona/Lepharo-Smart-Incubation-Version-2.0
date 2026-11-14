import React from 'react'
import { Card, Progress, Skeleton, theme } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons'
import { formatRole } from '@/lib/roleLabels'
import '@/styles/admin-overview.css'

export type AdminKpiTrend = { amount: string; direction: 'up' | 'down' | 'flat'; tone: 'good' | 'bad' | 'neutral'; text: string }

/** A figure in a soft rounded card: icon disc, large number, optional change badge and a small visual on the right. */
export const AdminKpiTile: React.FC<{
    icon: React.ReactNode
    label: string
    /** Numbers get thousands separators; text (a duration, a page name) is shown smaller, on one line. */
    value: React.ReactNode
    trend?: AdminKpiTrend
    note?: React.ReactNode
    loading?: boolean
    /** Small chart beside the figure, e.g. daily bars or a share ring. */
    visual?: React.ReactNode
    /** Slimmer card for a row of quick figures. */
    compact?: boolean
}> = ({ icon, label, value, trend, note, loading, visual, compact }) => (
    <Card className={compact ? 'admin-card admin-kpi is-compact' : 'admin-card admin-kpi'} bordered={false}>
        {loading ? (
            <Skeleton active paragraph={{ rows: 1 }} />
        ) : (
            <div className='admin-kpi-body'>
                <div className='admin-kpi-copy'>
                    <span className='admin-kpi-label'>{label}</span>
                    <div className='admin-kpi-value-line'>
                        <span className='admin-kpi-icon'>{icon}</span>
                        <span
                            className={typeof value === 'number' ? 'admin-kpi-value' : 'admin-kpi-value is-text'}
                            title={typeof value === 'string' ? value : undefined}
                        >
                            {typeof value === 'number' ? value.toLocaleString() : value}
                        </span>
                        {trend && (
                            <span className={`admin-kpi-trend is-${trend.tone}`} title={trend.text} aria-label={trend.text}>
                                {trend.direction === 'up' ? <ArrowUpOutlined /> : trend.direction === 'down' ? <ArrowDownOutlined /> : <MinusOutlined />}
                                {trend.amount}
                            </span>
                        )}
                    </div>
                    {note && <span className='admin-kpi-note'>{note}</span>}
                </div>
                {visual}
            </div>
        )}
    </Card>
)

/** Small labelled columns beside a KPI; the last one is drawn in the accent colour. */
export const AdminMiniBars: React.FC<{ bars: Array<{ key: string | number; label: string; value: number }> }> = ({ bars }) => {
    const max = Math.max(...bars.map(b => b.value), 1)
    return (
        <div className='admin-kpi-bars' aria-hidden='true'>
            {bars.map((bar, i) => (
                <div key={bar.key} className='admin-kpi-bar-col'>
                    <span
                        className={i === bars.length - 1 ? 'admin-kpi-bar is-current' : 'admin-kpi-bar'}
                        style={{ height: `${Math.max(8, (bar.value / max) * 100)}%` }}
                    />
                    <small>{bar.label}</small>
                </div>
            ))}
        </div>
    )
}

/** A value's share of a total, as a small ring beside a KPI. */
export const AdminShareRing: React.FC<{
    value: number
    total: number
    size?: number
    /** Ring colour; defaults to the accent. Pass a data colour (lib/chartColors) where red would read as bad news. */
    color?: string
}> = ({ value, total, size = 44, color }) => {
    const { token } = theme.useToken()
    const percent = total ? Math.min(100, Math.round((value / total) * 100)) : 0
    // A plain span for the label: at 100% antd would otherwise colour its own text green.
    return (
        <Progress
            type='circle'
            size={size}
            percent={percent}
            strokeWidth={10}
            strokeColor={color || token.colorPrimary}
            trailColor={color ? `color-mix(in srgb, ${color} 16%, transparent)` : token.colorPrimaryBg}
            format={() => <span className='admin-share-ring-label'>{percent}%</span>}
        />
    )
}

export const AdminRoleTag: React.FC<{ role: string }> = ({ role }) => <span className='admin-role-tag'>{formatRole(role) || 'Unknown'}</span>
