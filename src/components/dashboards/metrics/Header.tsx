import React from 'react'
import { Card, Row, Col, Space, Button, Typography, Tag, Skeleton, theme } from 'antd'
import type { CardProps, TagProps } from 'antd'
import { CalendarOutlined, RightOutlined } from '@ant-design/icons'
import { useColorMode } from '@/contexts/ThemeContext'

const { Title, Text } = Typography

/**
 * Palette for this file, derived from the active Ant Design theme.
 *
 * These cards are rendered across most dashboards, so their colours are read
 * from tokens rather than hardcoded — the previous pale-blue borders and
 * rgba(0,0,0,.45) labels disappeared against a dark panel.
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
        border: isDark ? 'rgba(74, 155, 255, 0.22)' : '#e6efff',
        borderHover: isDark ? 'rgba(74, 155, 255, 0.45)' : '#cfe0ff',
        chipBorder: isDark ? token.colorBorder : '#d9d9d9',
        // Light mode keeps its original lifted-card shadow; on dark a soft grey
        // glow reads as fog, so it goes deeper and tighter instead.
        shadow: isDark
            ? '0 6px 18px rgba(0, 0, 0, 0.40)'
            : '0 12px 32px rgba(0,0,0,0.10)',
        shadowHover: isDark
            ? '0 10px 26px rgba(0, 0, 0, 0.55)'
            : '0 16px 36px rgba(0,0,0,0.14)',
        arrowIdle: isDark ? token.colorTextTertiary : 'rgba(0,0,0,.38)',
        arrowHover: isDark ? '#7db4ff' : 'rgba(22,119,255,.95)',
        filterBarBg: isDark ? 'rgba(255, 255, 255, 0.04)' : '#fafafa',
        filterBarBorder: isDark ? token.colorBorder : '#f0f0f0',
        filterBarShadow: isDark
            ? 'inset 0 1px 2px rgba(0, 0, 0, 0.25)'
            : 'inset 0 1px 2px rgba(0,0,0,0.04)'
    }
}

/** ---------- IconChip ---------- */
type IconChipProps = {
    bg?: string
    icon: React.ReactNode
    size?: number
    radius?: number
    style?: React.CSSProperties
}

const IconChipBase: React.FC<IconChipProps> = ({
    bg = 'rgba(22,119,255,.12)',
    icon,
    size = 40,
    radius = 999,
    style
}) => (
    <div
        style={{
            width: size,
            height: size,
            borderRadius: radius,
            display: 'grid',
            placeItems: 'center',
            background: bg,
            flex: '0 0 auto',
            ...style
        }}
    >
        {icon}
    </div>
)

/** ---------- Metric helper ---------- */
type MetricProps = {
    icon?: React.ReactNode
    iconBg?: string
    title: React.ReactNode
    value: React.ReactNode
    subtitle?: React.ReactNode
    right?: React.ReactNode
    onClick?: () => void
    clickable?: boolean
    disabled?: boolean
    cursor?: React.CSSProperties['cursor']
    wrapperStyle?: React.CSSProperties
    loading?: boolean
}

const MetricBase: React.FC<MetricProps> = ({
    icon,
    iconBg,
    title,
    value,
    subtitle,
    right,
    onClick,
    clickable = Boolean(onClick),
    disabled = false,
    cursor,
    wrapperStyle,
    loading = false
}) => {
    const isClickable = clickable && !!onClick && !disabled && !loading
    const palette = useMetricPalette()

    // Hover/focus visuals (border, shadow, lift) are pure CSS (:hover /
    // :focus-visible), not JS-tracked state: a div[tabIndex] doesn't reliably
    // fire mouseleave/blur in every case, which left a previously-active
    // tile's border "stuck" until it was hovered again. CSS always reflects
    // the real cursor/focus position, so it can't get stuck.
    //
    // Crucially, border/boxShadow/transform must NOT be set inline here:
    // inline styles always beat stylesheet rules (even :hover ones), so an
    // inline value would make the CSS below dead code. They're driven
    // entirely by the CSS variables + class rules instead. `wrapperStyle`
    // (used by many callers to inline an "active/selected" border) still
    // works as before, since it's spread last and inline still wins over
    // the stylesheet for whichever sub-properties it sets.
    const style = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        minWidth: 0,
        padding: '11px 12px',
        borderRadius: 10,
        background: palette.surface,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        cursor: loading ? 'default' : disabled ? 'not-allowed' : cursor || (isClickable ? 'pointer' : 'default'),
        userSelect: isClickable ? 'none' : undefined,
        opacity: disabled ? 0.6 : 1,
        outline: 'none',
        '--qtx-metric-border': palette.border,
        '--qtx-metric-shadow': palette.shadow,
        '--qtx-metric-border-hover': palette.borderHover,
        '--qtx-metric-shadow-hover': palette.shadowHover,
        '--qtx-metric-chip-border-hover': palette.borderHover,
        '--qtx-metric-arrow-hover': palette.arrowHover,
        ...wrapperStyle
    }

    return (
        <div
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={isClickable ? onClick : undefined}
            onKeyDown={
                isClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') onClick?.()
                    }
                    : undefined
            }
            className={isClickable ? 'qtx-metric-tile qtx-metric-tile--clickable' : 'qtx-metric-tile'}
            style={style as React.CSSProperties}
        >
            <Space size={10} align="center" style={{ minWidth: 0, flex: '1 1 auto' }}>
                {loading ? (
                    <Skeleton.Avatar active shape="circle" size={34} />
                ) : icon ? (
                    <IconChipBase size={36} radius={999} bg={iconBg} icon={icon} />
                ) : null}

                <div
                    style={{
                        minWidth: 0,
                        marginLeft: 14,
                        flex: '1 1 auto'
                    }}
                >
                    {loading ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <Skeleton.Input active size="small" style={{ width: 110, height: 14 }} />
                            <Skeleton.Input active size="small" style={{ width: 42, height: 21 }} />
                            {subtitle ? (
                                <Skeleton.Input active size="small" style={{ width: 128, height: 12 }} />
                            ) : null}
                        </div>
                    ) : (
                        <>
                            <div
                                style={{
                                    fontSize: 12,
                                    color: palette.muted,
                                    lineHeight: 1.15,
                                    overflowWrap: 'normal',
                                    wordBreak: 'normal'
                                }}
                            >
                                {title}
                            </div>
                            <div
                                style={{
                                    fontSize: 20,
                                    fontWeight: 700,
                                    color: palette.text,
                                    lineHeight: 1.1,
                                    overflowWrap: 'normal',
                                    wordBreak: 'normal'
                                }}
                            >
                                {value}
                            </div>
                            {subtitle ? (
                                <div
                                    style={{
                                        marginTop: 2,
                                        fontSize: 11,
                                        color: palette.muted,
                                        lineHeight: 1.15,
                                        overflowWrap: 'normal',
                                        wordBreak: 'normal'
                                    }}
                                >
                                    {subtitle}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </Space>

            {!loading && (right || clickable) ? (
                <div
                    style={{
                        flex: '0 0 auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                    }}
                >
                    {right}
                    {clickable ? (
                        <span
                            aria-hidden="true"
                            className="qtx-metric-chevron"
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: `1px solid ${palette.chipBorder}`,
                                background: palette.surface,
                                transition: 'all .2s ease'
                            }}
                        >
                            <RightOutlined
                                className="qtx-metric-arrow"
                                style={{
                                    fontSize: 11,
                                    color: palette.arrowIdle,
                                    transform: 'translateX(0)',
                                    transition: 'color .2s ease, transform .2s ease'
                                }}
                            />
                        </span>
                    ) : null}
                </div>
            ) : null}

            <style>{`
                .qtx-metric-tile {
                    border: 1px solid var(--qtx-metric-border);
                    box-shadow: var(--qtx-metric-shadow);
                    transform: translateY(0);
                }
                .qtx-metric-tile--clickable:hover,
                .qtx-metric-tile--clickable:focus-visible {
                    border-color: var(--qtx-metric-border-hover);
                    box-shadow: var(--qtx-metric-shadow-hover);
                    transform: translateY(-2px);
                }
                .qtx-metric-tile--clickable:hover .qtx-metric-chevron,
                .qtx-metric-tile--clickable:focus-visible .qtx-metric-chevron {
                    border-color: var(--qtx-metric-chip-border-hover);
                    background: rgba(22,119,255,.06);
                }
                .qtx-metric-tile--clickable:hover .qtx-metric-arrow,
                .qtx-metric-tile--clickable:focus-visible .qtx-metric-arrow {
                    color: var(--qtx-metric-arrow-hover);
                    transform: translateX(1px);
                }
            `}</style>
        </div>
    )
}

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
}

type MotionCardComponent = React.FC<CardProps & MotionCardOwnProps> & {
    IconChip: React.FC<IconChipProps>
    Metric: React.FC<MetricProps>
}

export const MotionCard: MotionCardComponent = ({
    children,
    style,
    filterBar,
    filterBarProps,
    loading = false,
    skeletonRows = 3,
    ...rest
}) => {
    const palette = useMetricPalette()

    const cardStyle: React.CSSProperties = {
        boxShadow: palette.shadow,
        transition: 'all 0.3s ease',
        borderRadius: 14,
        border: `1px solid ${palette.border}`,
        backdropFilter: 'blur(3px)'
    }

    return (
        <div
            style={{
                transform: 'translateY(10px)',
                opacity: 0,
                animation: 'enter .35s ease forwards'
            }}
        >
            <Card {...rest} style={{ ...cardStyle, ...(style || {}) }}>
                {loading ? (
                    <Skeleton active title={false} paragraph={{ rows: skeletonRows }} />
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

            <style>{`
        @keyframes enter {
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
        </div>
    )
}

MotionCard.IconChip = IconChipBase
MotionCard.Metric = MetricBase

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
                        {titleIcon && <IconChipBase size={38} radius={999} bg='rgba(126,226,168,.14)' icon={<span style={{ display: 'inline-flex', fontSize: 20, color: '#7ee2a8' }}>{titleIcon}</span>} />}
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
