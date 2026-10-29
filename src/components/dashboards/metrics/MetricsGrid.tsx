import React from 'react'
import { Row, Col, Grid } from 'antd'
import type { RowProps } from 'antd'
import { MetricTile, type MetricTileProps } from './MetricTile'

const { useBreakpoint } = Grid

export interface DashboardMetric extends Omit<MetricTileProps, 'compact'> {
    /** Stable identifier, also used as the React key. */
    key: string
    /**
     * Marks this metric as one of the ones worth surfacing on mobile.
     * On phones only `important` metrics are shown, two per row.
     * If none are marked important, the first two metrics are used as a fallback.
     */
    important?: boolean
    /**
     * Force-hide the subtitle on mobile instead of truncating it to one line.
     * Defaults to false — subtitles are kept but clamped so they never
     * overflow the (narrower) mobile card.
     */
    hideSubtitleOnMobile?: boolean
}

export interface MetricsGridProps {
    metrics: DashboardMetric[]
    gutter?: RowProps['gutter']
    /** Override the desktop column span (out of 24) instead of the auto layout. */
    desktopSpan?: number
    /**
     * Tiles per row on mobile. 3 fits a short summary row (e.g. Total /
     * Pending / Confirmed) by dropping the icons and tightening the gutter so
     * every tile keeps the same size - pair it with short `mobileTitle`s.
     */
    mobileColumns?: 2 | 3
}

const desktopSpanFor = (count: number) => {
    if (count <= 1) return 24
    if (count === 2) return 12
    if (count === 3) return 8
    if (count === 4) return 6
    // Five operational metrics should remain a single, compact row rather
    // than pushing the fifth card below the primary four.
    return 4
}

/**
 * Map-driven, responsive row of MetricTiles.
 * Desktop: every metric renders, auto-spanned across the row.
 * Mobile: only metrics flagged `important` render, two per row,
 * with subtitles clamped to a single line so text can't blow out the card.
 */
export const MetricsGrid: React.FC<MetricsGridProps> = ({
    metrics,
    gutter = [16, 16],
    desktopSpan,
    mobileColumns = 2
}) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const visibleMetrics = isMobile
        ? (() => {
            const important = metrics.filter(m => m.important)
            return important.length ? important : metrics.slice(0, 2)
        })()
        : metrics

    const threeUp = isMobile && mobileColumns === 3
    const span = desktopSpan ?? desktopSpanFor(metrics.length)
    const useFluidDesktopColumns = !isMobile && !desktopSpan && metrics.length === 5

    return (
        <Row gutter={threeUp ? [8, 8] : gutter}>
            {visibleMetrics.map(metric => {
                const {
                    key,
                    important,
                    hideSubtitleOnMobile = false,
                    ...tileProps
                } = metric

                return (
                    <Col
                        key={key}
                        xs={threeUp ? 8 : 12}
                        md={useFluidDesktopColumns ? undefined : span}
                        flex={useFluidDesktopColumns ? '1 1 0' : undefined}
                        style={useFluidDesktopColumns ? { minWidth: 0, maxWidth: 'none' } : undefined}
                    >
                        {/* The tile is its own bordered surface; wrapping it in a
                            card as well drew two borders around one number. */}
                        <div className='qtx-motion-card' style={{ height: '100%' }}>
                            {/* Compact on phones, which also swaps in mobileTitle /
                                mobileSubtitle where a metric provides them. */}
                            <MetricTile
                                {...tileProps}
                                compact={isMobile}
                                icon={threeUp ? undefined : tileProps.icon}
                                subtitle={isMobile && hideSubtitleOnMobile ? undefined : tileProps.subtitle}
                                mobileSubtitle={hideSubtitleOnMobile ? undefined : tileProps.mobileSubtitle}
                            />
                        </div>
                    </Col>
                )
            })}
        </Row>
    )
}

export default MetricsGrid
