import { CardSkeleton, type CardSkeletonVariant } from './CardSkeleton'
import { IconChip, MetricTile, type IconChipProps, type MetricTileProps } from './MetricTile'
import React from 'react'
import { Card, Row, Col, Space, Button, Typography, Tag, theme } from 'antd'
import type { CardProps, TagProps } from 'antd'
import { CalendarOutlined } from '@ant-design/icons'
import { useColorMode } from '@/contexts/ThemeContext'
import './metrics.css'

const { Title, Text } = Typography

/**
 * Palette for this file, derived from the active Ant Design theme.
 *
 * These cards are rendered across most dashboards, so their colours are read
 * from tokens rather than hardcoded. Borders and hover colours follow the
 * --app-* tokens, so they track the selected accent (crimson by default)
 * instead of a fixed blue.
 */
export const useMetricPalette = () => {
    const { token } = theme.useToken()
    const { isDark } = useColorMode()

    return {
        isDark,
        surface: token.colorBgContainer,
        text: token.colorText,
        /**
         * Card titles and subtitles. Light mode keeps its original value; dark
         * uses the *secondary* rung rather than tertiary, because these labels
         * are 11–12px and tertiary (42% white) only reaches ~4.4:1 on a panel.
         */
        muted: isDark ? token.colorTextSecondary : 'rgba(0,0,0,.45)',
        border: 'var(--app-border)',
        borderHover: 'var(--app-accent-border-strong)',
        chipBorder: isDark ? token.colorBorder : '#d9d9d9',
        // A soft, close shadow: cards sit just above the page. On dark a grey
        // glow reads as fog, so it goes deeper and tighter instead.
        shadow: isDark
            ? '0 6px 18px rgba(0, 0, 0, 0.35)'
            : '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -14px rgba(15, 23, 42, 0.14)',
        shadowHover: isDark
            ? '0 10px 26px rgba(0, 0, 0, 0.5)'
            : '0 1px 2px rgba(15, 23, 42, 0.05), 0 14px 30px -14px rgba(15, 23, 42, 0.22)',
        arrowIdle: isDark ? token.colorTextTertiary : 'rgba(0,0,0,.38)',
        arrowHover: 'var(--app-accent)',
        filterBarBg: isDark ? 'rgba(255, 255, 255, 0.04)' : '#fafafa',
        filterBarBorder: isDark ? token.colorBorder : '#f0f0f0',
        filterBarShadow: isDark
            ? 'inset 0 1px 2px rgba(0, 0, 0, 0.25)'
            : 'inset 0 1px 2px rgba(0,0,0,0.04)'
    }
}

export { MetricTile, IconChip } from './MetricTile'
export type { MetricTone, MetricTrend, MetricTileProps, IconChipProps } from './MetricTile'

/** ---------- MotionCard ---------- */
export type DashboardFilterBarProps = {
    children: React.ReactNode
    style?: React.CSSProperties
    className?: string
    marginBottom?: number
    padding?: number | string
    background?: string
    borderColor?: string
    borderRadius?: number
    boxShadow?: string
}

export const DashboardFilterBar: React.FC<DashboardFilterBarProps> = ({
    children,
    style,
    className,
    marginBottom = 16,
    padding = 12,
    background,
    borderColor,
    borderRadius = 10,
    boxShadow
}) => {
    const palette = useMetricPalette()

    return (
        <div
            className={className}
            style={{
                marginBottom,
                padding,
                borderRadius,
                background: background ?? palette.filterBarBg,
                border: `1px solid ${borderColor ?? palette.filterBarBorder}`,
                boxShadow: boxShadow ?? palette.filterBarShadow,
                width: '100%',
                boxSizing: 'border-box',
                minWidth: 0,
                overflowX: 'auto',
                overflowY: 'hidden',
                ...style
            }}
        >
            {children}
        </div>
    )
}

type MotionCardOwnProps = {
    filterBar?: React.ReactNode
    filterBarProps?: Omit<DashboardFilterBarProps, 'children'>
    /**
     * Replaces the card body with a Skeleton while true - e.g. while a
     * program switch is refetching this card's data. Reusable across any
     * MotionCard (metric tiles, chart/progress cards, filter bars, table
     * cards) instead of each screen rolling its own loading branch.
     */
    loading?: boolean
    /** Rows passed to the Skeleton's paragraph when `loading` is true. */
    skeletonRows?: number
    /**
     * Shape of the skeleton, so it resembles the real body: 'table', 'chart',
     * 'list', 'stats' or the default 'text'. Pass a node for a bespoke one.
     */
    skeleton?: CardSkeletonVariant | React.ReactNode
    /** Table skeleton only. */
    skeletonColumns?: number
}

type MotionCardComponent = React.FC<CardProps & MotionCardOwnProps> & {
    /** @deprecated Use IconChip from metrics/MetricTile. */
    IconChip: React.FC<IconChipProps>
    /** @deprecated Use MetricTile from metrics/MetricTile. */
    Metric: React.FC<MetricTileProps>
}

export const MotionCard: MotionCardComponent = ({
    children,
    style,
    filterBar,
    filterBarProps,
    loading = false,
    skeletonRows = 3,
    skeleton = 'text',
    skeletonColumns,
    ...rest
}) => {
    const palette = useMetricPalette()

    const cardStyle: React.CSSProperties = {
        boxShadow: palette.shadow,
        transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
        borderRadius: 14,
        border: `1px solid ${palette.border}`
    }

    return (
        // The entrance animation lives in metrics.css (one keyframes rule for
        // the whole app, not one <style> tag per card).
        <div className='qtx-motion-card'>
            <Card {...rest} style={{ ...cardStyle, ...(style || {}) }}>
                {loading ? (
                    typeof skeleton === 'string' ? (
                        <CardSkeleton
                            variant={skeleton as CardSkeletonVariant}
                            rows={skeletonRows}
                            columns={skeletonColumns}
                        />
                    ) : (
                        skeleton
                    )
                ) : (
                    <>
                        {filterBar && (
                            <DashboardFilterBar {...filterBarProps}>
                                {filterBar}
                            </DashboardFilterBar>
                        )}

                        {children}
                    </>
                )}
            </Card>
        </div>
    )
}

// Deprecated aliases, kept so any remaining callers keep working.
MotionCard.IconChip = IconChip
MotionCard.Metric = MetricTile


/** ---------- header card ---------- */
type SubtitleTag =
    | string
    | {
        label: React.ReactNode
        color?: TagProps['color']
        icon?: React.ReactNode
        props?: Omit<TagProps, 'color' | 'icon' | 'children'>
    }

type HeaderCardProps = {
    title: React.ReactNode
    titleIcon?: React.ReactNode
    titleTag?: SubtitleTag
    subtitle?: React.ReactNode
    subtitleTags?: SubtitleTag[]
    onAddEvent?: () => void
    onOpenCalendar?: () => void
    openCalendarLabel?: string
    extraRight?: React.ReactNode
    background?: string
    cardProps?: CardProps
}

const renderTag = (t: SubtitleTag, key: React.Key) => {
    if (typeof t === 'string') {
        return (
            <Tag key={key} style={{ borderRadius: 999 }}>
                {t}
            </Tag>
        )
    }

    return (
        <Tag
            key={key}
            color={t.color}
            icon={t.icon}
            style={{ borderRadius: 999 }}
            {...(t.props || {})}
        >
            {t.label}
        </Tag>
    )
}

export const DashboardHeaderCard: React.FC<HeaderCardProps> = ({
    title,
    titleIcon,
    titleTag,
    subtitle,
    subtitleTags = [],
    onAddEvent,
    onOpenCalendar,
    openCalendarLabel = 'Open Calendar',
    extraRight,
    background = 'linear-gradient(120deg, #102a43 0%, #176b87 100%)',
    cardProps
}) => {
    const {
        style: cardOverrideStyle,
        styles: cardOverrideStyles,
        ...remainingCardProps
    } = cardProps || {}

    return (
        <MotionCard
            {...remainingCardProps}
            styles={{
                ...cardOverrideStyles,
                body: {
                    padding: '14px 20px',
                    ...(cardOverrideStyles?.body || {})
                }
            }}
            style={{
                background,
                marginBottom: 20,
                cursor: 'default',
                border: 'none',
                borderRadius: 18,
                overflow: 'hidden',
                boxShadow: '0 16px 38px rgba(16,42,67,.18)',
                position: 'relative',
                ...cardOverrideStyle
            }}
        >
            <div style={{ position: 'absolute', width: 170, height: 170, borderRadius: '50%', background: 'rgba(255,255,255,.06)', right: -55, top: -92, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', width: 86, height: 86, borderRadius: '50%', background: 'rgba(126,226,168,.08)', right: 145, bottom: -58, pointerEvents: 'none' }} />
            <Row align="middle" justify="space-between" gutter={[12, 12]} wrap style={{ position: 'relative', minHeight: 46 }}>
                <Col flex="auto">
                    <Space align="center" size={12} wrap>
                        {titleIcon && <IconChip size={38} radius={999} bg='rgba(126,226,168,.14)' icon={<span style={{ display: 'inline-flex', fontSize: 20, color: '#7ee2a8' }}>{titleIcon}</span>} />}
                        <Title level={3} style={{ margin: 0, color: '#fff', lineHeight: 1.15 }}>
                            {title}
                        </Title>
                        {titleTag ? renderTag(titleTag, 'titleTag') : null}
                    </Space>

                    {(subtitle || subtitleTags.length > 0) && (
                        <div style={{ marginTop: 3 }}>
                            <Space size={8} wrap>
                                {subtitle && <Text style={{ color: 'rgba(255,255,255,.76)' }}>{subtitle}</Text>}
                                {subtitleTags.map((t, idx) => renderTag(t, idx))}
                            </Space>
                        </div>
                    )}
                </Col>

                <Col>
                    <Space wrap>
                        {onOpenCalendar && (
                            <Button
                                icon={<CalendarOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onOpenCalendar()
                                }}
                            >
                                {openCalendarLabel}
                            </Button>
                        )}

                        {extraRight ? <span>{extraRight}</span> : null}
                    </Space>
                </Col>
            </Row>
        </MotionCard>
    )
}
