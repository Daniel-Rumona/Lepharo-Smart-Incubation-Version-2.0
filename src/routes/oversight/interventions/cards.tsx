import React from 'react'
import { Progress, Tag, Typography, theme } from 'antd'
import { ArrowRightOutlined, CarryOutOutlined, ClockCircleOutlined, FileProtectOutlined } from '@ant-design/icons'
import type { CoverageRow, StuckItem } from '@/services/interventionTower'
import { BLUE, MiniStack, type ChartInk } from './charts'

const { Text } = Typography

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export const severityColor = (severity: number) => (severity >= 3 ? 'red' : severity >= 1.5 ? 'orange' : 'gold')

/** Soft tinted chip behind an icon, matching the system's metric tiles. */
export const IconChip: React.FC<{ color: string; bg: string; children: React.ReactNode; size?: number }> = ({ color, bg, children, size = 36 }) => (
    <div style={{ width: size, height: size, borderRadius: 12, display: 'grid', placeItems: 'center', background: bg, color, flex: '0 0 auto', fontSize: size * 0.45 }}>
        {children}
    </div>
)

export const ACCENT = {
    blue: { color: '#1677ff', bg: 'rgba(22,119,255,.12)' },
    purple: { color: '#722ed1', bg: 'rgba(114,46,209,.12)' },
    green: { color: '#52c41a', bg: 'rgba(82,196,26,.12)' },
    orange: { color: '#fa8c16', bg: 'rgba(250,140,22,.12)' },
    red: { color: '#ff4d4f', bg: 'rgba(255,77,79,.12)' }
} as const

const KIND = {
    delivery: { icon: <CarryOutOutlined />, accent: ACCENT.orange },
    evidence: { icon: <FileProtectOutlined />, accent: ACCENT.purple }
}

/** One compact row for "needs attention first" lists. */
export const StuckRow: React.FC<{ item: StuckItem; onClick?: () => void }> = ({ item, onClick }) => {
    const { token } = theme.useToken()
    const kind = KIND[item.kind]
    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 12,
                background: token.colorFillQuaternary,
                cursor: onClick ? 'pointer' : 'default'
            }}
        >
            <IconChip color={kind.accent.color} bg={kind.accent.bg}>{kind.icon}</IconChip>
            <div style={{ minWidth: 0, flex: 1 }}>
                <Text strong ellipsis style={{ display: 'block', fontSize: 13 }}>{item.reason}</Text>
                <Text type="secondary" ellipsis style={{ display: 'block', fontSize: 12 }}>
                    {item.participantName} - {item.interventionTitle}
                </Text>
            </div>
            <Tag bordered={false} style={{ margin: 0, borderRadius: 999 }}>{item.owner}</Tag>
            <Tag bordered={false} color={severityColor(item.severity)} icon={<ClockCircleOutlined />} style={{ margin: 0, borderRadius: 999 }}>
                {item.days}d
            </Tag>
        </div>
    )
}

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, color: tone }}>{value}</div>
        <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
    </div>
)

/** Chain legend: only the steps that actually have items, so it never becomes noise. */
export const movSegments = (mov: CoverageRow['mov']) => [
    { label: 'Awaiting HOD', value: mov.awaitingHod, color: BLUE[250] },
    { label: 'In pack, awaiting CC', value: mov.inPack, color: BLUE[350] },
    { label: 'Awaiting M&E', value: mov.awaitingMe, color: BLUE[500] },
    { label: 'Validated', value: mov.validated, color: BLUE[600] },
    { label: 'Queried', value: mov.queried, color: '#e34948' }
]

const MovLegend: React.FC<{ mov: CoverageRow['mov'] }> = ({ mov }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 6 }}>
        {movSegments(mov)
            .filter(s => s.value > 0)
            .map(s => (
                <span key={s.label} style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />
                    <Text type="secondary" style={{ fontSize: 11 }}>{s.label} {s.value}</Text>
                </span>
            ))}
    </div>
)

/**
 * Coverage card: one department or one intervention. Click opens the drill-down.
 * Same anatomy as the Intervention Demand cards (title, ring, summary strip) so
 * the two screens read as one product.
 */
export const CoverageCard: React.FC<{
    row: CoverageRow
    title: string
    subtitle: string
    ink: ChartInk
    onClick?: () => void
}> = ({ row, title, subtitle, ink, onClick }) => {
    const { token } = theme.useToken()
    const rate = pct(row.summary.completed, row.summary.assigned)
    const [hover, setHover] = React.useState(false)
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                width: '100%',
                padding: 16,
                borderRadius: 16,
                border: `1px solid ${hover && onClick ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                boxShadow: hover && onClick ? token.boxShadowSecondary : 'none',
                transform: hover && onClick ? 'translateY(-2px)' : 'none',
                transition: 'all .2s ease',
                cursor: onClick ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                gap: 12
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <Text strong ellipsis={{ tooltip: title }} style={{ display: 'block', fontSize: 15 }}>{title}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>
                </div>
                <Progress
                    type="circle"
                    size={52}
                    percent={rate}
                    strokeWidth={9}
                    strokeColor={BLUE[450]}
                    format={p => <Text strong style={{ fontSize: 11 }}>{p}%</Text>}
                />
            </div>

            <div style={{ display: 'flex', padding: '8px 4px', borderRadius: 12, background: token.colorFillQuaternary }}>
                <Stat label="Assigned" value={row.summary.assigned} />
                <Stat label="Completed" value={row.summary.completed} />
                <Stat label="In progress" value={row.summary.inDelivery + row.summary.awaitingSme} />
                <Stat label="Stuck" value={row.stuck} tone={row.stuck ? ACCENT.red.color : undefined} />
            </div>

            <div>
                <Text type="secondary" style={{ fontSize: 11 }}>MOV evidence chain</Text>
                <div style={{ marginTop: 6 }}>
                    <MiniStack ink={ink} segments={movSegments(row.mov)} />
                </div>
                {row.mov.total > 0 && <MovLegend mov={row.mov} />}
            </div>

            {onClick && (
                <div style={{ marginTop: 'auto', color: token.colorPrimary, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    View details <ArrowRightOutlined />
                </div>
            )}
        </div>
    )
}
