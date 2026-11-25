import React from 'react'
import { Typography, theme } from 'antd'
import dayjs from 'dayjs'
import type { PerformanceCycle } from './ipm'

const { Text } = Typography

const WINDOWS = [
    { key: 'compacting', label: 'Compacting' },
    { key: 'midYear', label: 'Mid-year review' },
    { key: 'yearEnd', label: 'Year-end review' }
] as const

const range = (from: string, to: string) =>
    dayjs(from).isSame(dayjs(to), 'month') ? dayjs(from).format('MMM YYYY') : `${dayjs(from).format('D MMM')} – ${dayjs(to).format('D MMM YYYY')}`

/** The cycle's three windows as one slim strip, with where today falls. */
export const CycleTimeline: React.FC<{ cycle: PerformanceCycle }> = ({ cycle }) => {
    const { token } = theme.useToken()
    const today = dayjs().format('YYYY-MM-DD')
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {WINDOWS.map(({ key, label }) => {
                const window = cycle.windows[key]
                const state = today > window.to ? 'done' : today >= window.from ? 'now' : 'later'
                const color = state === 'now' ? token.colorPrimary : state === 'done' ? token.colorSuccess : token.colorTextQuaternary
                return (
                    <div
                        key={key}
                        style={{
                            flex: '1 1 150px',
                            padding: '6px 10px',
                            borderRadius: 10,
                            borderTop: `3px solid ${color}`,
                            background: state === 'now' ? token.colorPrimaryBg : token.colorFillQuaternary
                        }}
                    >
                        <Text strong={state === 'now'} style={{ fontSize: 12, display: 'block' }}>
                            {label}
                            {state === 'now' ? ' · now' : state === 'done' ? ' · done' : ''}
                        </Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {range(window.from, window.to)}
                        </Text>
                    </div>
                )
            })}
        </div>
    )
}
