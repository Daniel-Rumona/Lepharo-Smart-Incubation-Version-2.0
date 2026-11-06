import { Typography, theme } from 'antd'

const { Text } = Typography

export type StripSegment<K extends string> = { key: K; label: string; count: number; color: string }

// One slim card in place of a row of metric tiles: a total, a proportional bar and
// a clickable chip per non-zero status. Clicking a chip filters; clicking it again clears.
export function SummaryStrip<K extends string>({
    total,
    totalLabel,
    segments,
    active,
    onToggle
}: {
    total: number
    totalLabel: string
    segments: StripSegment<K>[]
    active: K | null
    onToggle: (key: K | null) => void
}) {
    const { token } = theme.useToken()
    const visible = segments.filter(segment => segment.count > 0)

    return (
        <div
            style={{
                padding: '10px 14px',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 10,
                background: token.colorBgContainer
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
                <Text strong style={{ whiteSpace: 'nowrap' }}>{total} {totalLabel}</Text>
                <div
                    style={{
                        flex: '1 1 160px',
                        minWidth: 120,
                        display: 'flex',
                        height: 8,
                        borderRadius: 4,
                        overflow: 'hidden',
                        background: token.colorFillSecondary
                    }}
                >
                    {visible.map(segment => (
                        <div
                            key={segment.key}
                            style={{
                                width: `${(segment.count / (total || 1)) * 100}%`,
                                background: segment.color,
                                opacity: active && active !== segment.key ? 0.3 : 1,
                                transition: 'opacity 0.2s ease'
                            }}
                        />
                    ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {visible.map(segment => {
                        const isActive = active === segment.key
                        return (
                            <button
                                key={segment.key}
                                type='button'
                                aria-pressed={isActive}
                                onClick={() => onToggle(isActive ? null : segment.key)}
                                style={{
                                    font: 'inherit',
                                    fontSize: 12,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '2px 10px',
                                    borderRadius: 999,
                                    cursor: 'pointer',
                                    color: token.colorText,
                                    border: `1px solid ${isActive ? segment.color : token.colorBorderSecondary}`,
                                    background: isActive ? `${segment.color}1f` : 'transparent'
                                }}
                            >
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: segment.color }} />
                                <b>{segment.count}</b>
                                <span style={{ opacity: 0.75 }}>{segment.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
