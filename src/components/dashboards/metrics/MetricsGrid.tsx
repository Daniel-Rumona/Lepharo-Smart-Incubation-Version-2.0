import React from 'react'
import { Row, Col, Grid } from 'antd'
import type { RowProps } from 'antd'
import type { MetricCardProps } from './MetricCard'
import { MotionCard } from './Header'

const { useBreakpoint } = Grid

export interface DashboardMetric extends Omit<MetricCardProps, 'compact' | 'hideSubtitle'> {
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
}

const desktopSpanFor = (count: number) => {
    if (count <= 1) return 24
    if (count === 2) return 12
    if (count === 3) return 8
    if (count === 4) return 6
    return 6
}

/**
 * Map-driven, responsive metrics row using the shared MotionCard.Metric
 * presentation.
 * Desktop: every metric renders, auto-spanned across the row.
 * Mobile: only metrics flagged `important` render, two per row,
 * with subtitles clamped to a single line so text can't blow out the card.
 */
export const MetricsGrid: React.FC<MetricsGridProps> = ({
    metrics,
    gutter = [16, 16],
    desktopSpan
}) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const visibleMetrics = isMobile
        ? (() => {
            const important = metrics.filter(m => m.important)
            return important.length ? important : metrics.slice(0, 2)
        })()
        : metrics

    const span = desktopSpan ?? desktopSpanFor(metrics.length)

    return (
        <Row gutter={gutter}>
            {visibleMetrics.map(metric => {
                const {
                    key,
                    important,
                    hideSubtitleOnMobile = false,
                    mobileTitle,
                    mobileSubtitle,
                    ...cardProps
                } = metric

                const displayTitle = isMobile && mobileTitle !== undefined ? mobileTitle : cardProps.title
                const displaySubtitle = isMobile && mobileSubtitle !== undefined ? mobileSubtitle : cardProps.subtitle

                return (
                    <Col key={key} xs={12} md={span}>
                        <MotionCard styles={{ body: { padding: 0 } }}>
                            <MotionCard.Metric
                                {...cardProps}
                                title={displayTitle}
                                subtitle={isMobile && hideSubtitleOnMobile ? undefined : displaySubtitle}
                            />
                        </MotionCard>
                    </Col>
                )
            })}
        </Row>
    )
}

export default MetricsGrid
