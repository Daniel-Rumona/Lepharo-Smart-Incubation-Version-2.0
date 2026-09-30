import React, { useEffect, useState } from 'react'
import { Badge, Button, DatePicker, Dropdown, Modal, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { CalendarOutlined, CheckOutlined, DownOutlined, FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import {
    currentMonthRange,
    useDashboardDateRange,
    type DashboardDateRange
} from '@/lib/useDashboardDateRange'

const { Text } = Typography
const { RangePicker } = DatePicker

type PresetKey = 'this-week' | 'this-month' | 'this-quarter' | 'ytd' | 'custom'

/**
 * Quick ranges. Built per call so a session left open overnight does not keep
 * resolving "This month" against the day the tab was opened.
 *
 * Quarter bounds are derived by hand because dayjs' quarter helpers need the
 * quarterOfYear plugin, which this app does not register — startOf('quarter')
 * returns the wrong date rather than throwing without it.
 */
const presetRange = (key: PresetKey): DashboardDateRange => {
    const now = dayjs()
    const quarterStartMonth = Math.floor(now.month() / 3) * 3

    switch (key) {
        case 'this-week':
            // startOf('week') without the isoWeek plugin is locale-dependent and
            // starts on Sunday. Deriving Monday by hand keeps this consistent
            // regardless of which pages happen to have registered the plugin.
            return [
                now.subtract((now.day() + 6) % 7, 'day').startOf('day'),
                now.subtract((now.day() + 6) % 7, 'day').add(6, 'day').endOf('day')
            ]
        case 'this-month':
            return currentMonthRange()
        case 'this-quarter':
            return [
                now.month(quarterStartMonth).startOf('month'),
                now.month(quarterStartMonth + 2).endOf('month')
            ]
        case 'ytd':
            return [now.startOf('year'), now.endOf('day')]
        default:
            return null
    }
}

const PRESET_OPTIONS: { label: string; value: Exclude<PresetKey, 'custom'> }[] = [
    { label: 'This Week', value: 'this-week' },
    { label: 'This Month', value: 'this-month' },
    { label: 'This Quarter', value: 'this-quarter' },
    { label: 'Year To Date', value: 'ytd' }
]

/** Work out which preset (if any) the active range corresponds to. */
const detectPreset = (range: DashboardDateRange): PresetKey => {
    if (!range) return 'custom'
    const match = PRESET_OPTIONS.find(({ value }) => {
        const r = presetRange(value)
        return !!r && r[0].isSame(range[0], 'day') && r[1].isSame(range[1], 'day')
    })
    return match ? match.value : 'custom'
}

/**
 * Topbar reporting-period filter.
 *
 * Shown only on dashboards that run on the shared InterventionsDashboard shell
 * — see DASHBOARDS_WITH_PERIOD_FILTER in components/layout/index.tsx. A page
 * that consumes the period without offering this control would be filtered by
 * a window its user cannot see.
 */
export const DashboardFilterControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { range, setRange, label: rangeLabel, isCustom } = useDashboardDateRange()

    const [customOpen, setCustomOpen] = useState(false)
    const [draft, setDraft] = useState<DashboardDateRange>(range)
    const activePreset = detectPreset(range)
    const label = PRESET_OPTIONS.find(opt => opt.value === activePreset)?.label ?? rangeLabel

    // Start the custom dialog from what is really applied.
    useEffect(() => {
        if (customOpen) setDraft(range ?? currentMonthRange())
    }, [customOpen, range])

    const menu: MenuProps = {
        selectedKeys: [activePreset],
        onClick: ({ key }) => {
            if (key === 'custom') {
                setCustomOpen(true)
                return
            }
            setRange(presetRange(key as PresetKey))
        },
        items: [
            ...PRESET_OPTIONS.map(opt => ({
                key: opt.value,
                label: opt.label,
                icon: activePreset === opt.value ? <CheckOutlined /> : <span style={{ width: 14, display: 'inline-block' }} />
            })),
            { type: 'divider' as const },
            {
                key: 'custom',
                label: 'Custom range…',
                icon: activePreset === 'custom' ? <CheckOutlined /> : <CalendarOutlined />
            }
        ]
    }

    return (
        <>
            <Tooltip title={`Reporting period: ${label}`}>
                <Badge dot={isCustom} offset={[-2, 4]}>
                  <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
                    <Button
                        type="text"
                        shape="round"
                        icon={<FilterOutlined />}
                        className="workspace-dashboard-filter"
                        style={{
                            height: 32,
                            paddingInline: compact ? 10 : 14,
                            // A custom range label ("01 Jan 2025 – 15 Sep 2026") runs far
                            // longer than a preset like "This month" — let the button shrink
                            // and cap it instead of forcing the topbar's segmented nav to
                            // overflow its pill.
                            flex: compact ? '0 0 auto' : '0 1 auto',
                            minWidth: 0,
                            maxWidth: compact ? undefined : 200,
                        }}
                        aria-label={`Change reporting period. Currently ${label}`}
                    >
                        {compact ? '' : (
                            <span
                                style={{
                                    display: 'inline-block',
                                    minWidth: 0,
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    verticalAlign: 'bottom',
                                }}
                            >
                                {label}
                            </span>
                        )}
                        {compact ? null : <DownOutlined style={{ fontSize: 10, marginInlineStart: 6 }} />}
                    </Button>
                  </Dropdown>
                </Badge>
            </Tooltip>

            <Modal
                open={customOpen}
                centered
                title="Custom reporting period"
                onCancel={() => setCustomOpen(false)}
                okText="Apply"
                okButtonProps={{ disabled: !draft }}
                onOk={() => {
                    setRange(draft)
                    setCustomOpen(false)
                }}
                width={440}
            >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Text type="secondary">
                        This selection stays active across dashboards until you change it again.
                    </Text>
                    <RangePicker
                        value={draft}
                        onChange={value => {
                            setDraft(value?.[0] && value?.[1] ? [value[0], value[1]] : null)
                        }}
                        format="DD MMM YYYY"
                        style={{ width: '100%' }}
                        allowClear={false}
                        placeholder={['Start date', 'End date']}
                    />
                </Space>
            </Modal>
        </>
    )
}

export default DashboardFilterControl
