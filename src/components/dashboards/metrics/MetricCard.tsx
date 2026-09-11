import React from 'react'
import { MotionCard, useMetricPalette } from './Header'

export interface MetricCardProps {
    icon?: React.ReactNode
    iconBg?: string
    title: React.ReactNode
    value: React.ReactNode
    subtitle?: React.ReactNode
    /** Shorter title used instead of `title` when `compact` is true, so mobile shows real words instead of an ellipsis. */
    mobileTitle?: React.ReactNode
    /** Shorter subtitle used instead of `subtitle` when `compact` is true. */
    mobileSubtitle?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    /** Tightens padding/sizing for narrow (mobile) layouts. */
    compact?: boolean
    /** Fully suppress the subtitle instead of truncating it. */
    hideSubtitle?: boolean
    /** Shows a skeleton in place of the icon/title/value/subtitle. */
    loading?: boolean
    /** Extra styles on the tile wrapper - e.g. to highlight an active filter. */
    wrapperStyle?: React.CSSProperties
}

/**
 * A single metric tile: icon + title + value + optional subtitle.
 * Independent of Header.tsx's MotionCard.Metric so mobile-specific
 * truncation logic here can evolve without touching that shared API.
 */
export const MetricCard: React.FC<MetricCardProps> = ({
    icon,
    iconBg,
    title,
    value,
    subtitle,
    mobileTitle,
    mobileSubtitle,
    onClick,
    disabled = false,
    compact = false,
    hideSubtitle = false
}) => {
    const palette = useMetricPalette()
    const clickable = !!onClick && !disabled
    const displayTitle = compact && mobileTitle !== undefined ? mobileTitle : title
    const displaySubtitle = compact && mobileSubtitle !== undefined ? mobileSubtitle : subtitle
    const showSubtitle = !!displaySubtitle && !hideSubtitle

    return (
        <MotionCard
            onClick={clickable ? onClick : undefined}
            onKeyDown={
                clickable
                    ? (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') onClick?.()
                    }
                    : undefined
            }
            styles={{ body: { padding: compact ? 12 : 16 } }}
            style={{
                opacity: disabled ? 0.6 : 1,
                cursor: clickable ? 'pointer' : 'default',
                height: '100%'
            }}
        >
            <div
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: compact ? 8 : 12,
                    minWidth: 0,
                    outline: 'none'
                }}
            >
                {icon ? (
                    <div
                        style={{
                            width: compact ? 32 : 40,
                            height: compact ? 32 : 40,
                            borderRadius: compact ? 10 : 12,
                            display: 'grid',
                            placeItems: 'center',
                            background: iconBg || 'rgba(22,119,255,.12)',
                            flex: '0 0 auto',
                            fontSize: compact ? 15 : 18
                        }}
                    >
                        {icon}
                    </div>
                ) : null}

                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div
                        style={{
                            fontSize: compact ? 11 : 13,
                            color: palette.muted,
                            lineHeight: 1.25,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                        title={typeof displayTitle === 'string' ? displayTitle : undefined}
                    >
                        {displayTitle}
                    </div>

                    <div
                        style={{
                            fontSize: compact ? 18 : 24,
                            fontWeight: 700,
                            color: palette.text,
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                    >
                        {value}
                    </div>

                    {showSubtitle ? (
                        <div
                            style={{
                                marginTop: 4,
                                fontSize: compact ? 11 : 12,
                                color: palette.muted,
                                lineHeight: 1.25,
                                display: '-webkit-box',
                                WebkitLineClamp: compact ? 1 : 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                            }}
                            title={typeof displaySubtitle === 'string' ? displaySubtitle : undefined}
                        >
                            {displaySubtitle}
                        </div>
                    ) : null}
                </div>
            </div>
        </MotionCard>
    )
}

export default MetricCard
