import React from 'react'
import { Skeleton } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined, RightOutlined } from '@ant-design/icons'
import './metrics.css'

/*
 * MetricTile — the one metric tile for every dashboard: icon chip, label,
 * value (with an optional trend pill) and subtitle. Lay several out with
 * MetricsGrid; use it directly for one-off rows. MotionCard.Metric and
 * MotionCard.IconChip are deprecated aliases of MetricTile and IconChip.
 */

/**
 * Semantic colour for an icon chip or trend, resolved from the theme in both
 * colour modes. 'accent' follows the selected accent palette.
 */
export type MetricTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'

/** ---------- IconChip ---------- */
export type IconChipProps = {
    /** Explicit background. Ignored when `tone` is set. */
    bg?: string
    tone?: MetricTone
    icon: React.ReactNode
    size?: number
    radius?: number
    style?: React.CSSProperties
}

export const IconChip: React.FC<IconChipProps> = ({
    bg,
    tone,
    icon,
    size = 40,
    radius = 999,
    style
}) => {
    // With neither a tone nor a background, fall back to the accent tone.
    const resolvedTone = tone ?? (bg ? undefined : 'accent')

    return (
        <div
            className={resolvedTone ? `qtx-chip qtx-tone-${resolvedTone}` : 'qtx-chip'}
            style={{
                width: size,
                height: size,
                borderRadius: radius,
                fontSize: Math.round(size * 0.42),
                ...(resolvedTone ? null : { background: bg }),
                ...style
            }}
        >
            {icon}
        </div>
    )
}

/** ---------- Metric helper ---------- */
export type MetricTrend = {
    /** The change itself, e.g. '+12%' or '3'. */
    value: React.ReactNode
    direction: 'up' | 'down' | 'flat'
    /**
     * Which direction is good news. Defaults to 'up'; pass 'down' for metrics
     * where a fall is an improvement (overdue items, risks, costs).
     */
    positive?: 'up' | 'down'
    /** Optional context after the value, e.g. 'vs last month'. */
    label?: React.ReactNode
}

export type MetricTileProps = {
    icon?: React.ReactNode
    /** Semantic chip colour, resolved from the theme. Defaults to 'accent'. */
    tone?: MetricTone
    title: React.ReactNode
    value: React.ReactNode
    subtitle?: React.ReactNode
    /** Change versus a previous period, shown beside the value. */
    trend?: MetricTrend
    right?: React.ReactNode
    onClick?: () => void
    clickable?: boolean
    disabled?: boolean
    cursor?: React.CSSProperties['cursor']
    wrapperStyle?: React.CSSProperties
    loading?: boolean
    /** Tighter padding and type, for phones and dense grids. */
    compact?: boolean
    /** Shorter title shown instead of `title` when `compact`, so phones get real words, not an ellipsis. */
    mobileTitle?: React.ReactNode
    /** Shorter subtitle shown instead of `subtitle` when `compact`. */
    mobileSubtitle?: React.ReactNode
}

const TrendPill: React.FC<{ trend: MetricTrend }> = ({ trend }) => {
    const good = trend.positive ?? 'up'
    const tone: MetricTone =
        trend.direction === 'flat' ? 'neutral' : trend.direction === good ? 'success' : 'danger'
    const Arrow =
        trend.direction === 'up' ? ArrowUpOutlined : trend.direction === 'down' ? ArrowDownOutlined : MinusOutlined

    return (
        <span className={`qtx-metric-trend qtx-tone-${tone}`}>
            <Arrow style={{ fontSize: 9 }} aria-hidden='true' />
            {trend.value}
            {trend.label ? <span className='qtx-metric-trend-label'>{trend.label}</span> : null}
        </span>
    )
}

export const MetricTile: React.FC<MetricTileProps> = ({
    icon,
    tone,
    title,
    value,
    subtitle,
    trend,
    right,
    onClick,
    clickable = Boolean(onClick),
    disabled = false,
    cursor,
    wrapperStyle,
    loading = false,
    compact = false,
    mobileTitle,
    mobileSubtitle
}) => {
    const isClickable = clickable && !!onClick && !disabled && !loading
    const shownTitle = compact && mobileTitle !== undefined ? mobileTitle : title
    const shownSubtitle = compact && mobileSubtitle !== undefined ? mobileSubtitle : subtitle

    // Hover/focus visuals live in metrics.css (:hover / :focus-visible), not
    // JS state, so a tile can never get "stuck" highlighted. Border, shadow
    // and transform must stay out of the inline style for the same reason:
    // inline beats the stylesheet. `wrapperStyle` (used by callers to mark an
    // active/selected tile) is still spread last, so it wins where it sets them.
    const className = [
        'qtx-metric-tile',
        isClickable && 'qtx-metric-tile--clickable',
        disabled && 'qtx-metric-tile--disabled',
        compact && 'qtx-metric-tile--compact'
    ]
        .filter(Boolean)
        .join(' ')

    return (
        <div
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={isClickable ? onClick : undefined}
            onKeyDown={
                isClickable
                    ? e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            // Space would otherwise also scroll the page.
                            e.preventDefault()
                            onClick?.()
                        }
                    }
                    : undefined
            }
            className={className}
            style={{ ...(cursor ? { cursor } : null), ...wrapperStyle }}
        >
            {icon ? (
                <IconChip
                    size={compact ? 32 : 40}
                    radius={compact ? 10 : 12}
                    tone={tone}
                    icon={icon}
                />
            ) : null}

            <div className='qtx-metric-body'>
                <div className='qtx-metric-title'>{shownTitle}</div>
                {loading ? (
                    // Icon and title are known up front, so only the parts that
                    // depend on data are skeletons - the tile keeps its real
                    // shape and nothing shifts when the numbers arrive.
                    <>
                        <Skeleton.Input
                            active
                            size='small'
                            style={{ width: 48, minWidth: 0, height: 22, display: 'block', marginBlock: 3 }}
                        />
                        {shownSubtitle ? (
                            <Skeleton.Input
                                active
                                size='small'
                                style={{ width: 120, minWidth: 0, height: 11, display: 'block' }}
                            />
                        ) : null}
                    </>
                ) : (
                    <>
                        <div className='qtx-metric-value-row'>
                            <span className='qtx-metric-value'>{value}</span>
                            {trend ? <TrendPill trend={trend} /> : null}
                        </div>
                        {shownSubtitle ? <div className='qtx-metric-subtitle'>{shownSubtitle}</div> : null}
                    </>
                )}
            </div>

            {!loading && (right || isClickable) ? (
                <div style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {right}
                    {isClickable ? (
                        <span aria-hidden='true' className='qtx-metric-chevron'>
                            <RightOutlined />
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default MetricTile
