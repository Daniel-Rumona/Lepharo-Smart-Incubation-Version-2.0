import React, { useEffect, useState } from 'react'
import { Badge, Button, DatePicker, Modal, Segmented, Space, Tooltip, Typography } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import {
    currentMonthRange,
    useDashboardDateRange,
    type DashboardDateRange
} from '@/lib/useDashboardDateRange'

const { Text } = Typography
const { RangePicker } = DatePicker

type PresetKey =
    | 'today'
    | 'this-week'
    | 'this-month'
    | 'last-month'
    | 'last-30'
    | 'this-quarter'
    | 'ytd'
    | 'all'
    | 'custom'

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
        case 'today':
            return [now.startOf('day'), now.endOf('day')]
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
        case 'last-month':
            return [
                now.subtract(1, 'month').startOf('month'),
                now.subtract(1, 'month').endOf('month')
            ]
        case 'last-30':
            return [now.subtract(29, 'day').startOf('day'), now.endOf('day')]
        case 'this-quarter':
            return [
                now.month(quarterStartMonth).startOf('month'),
                now.month(quarterStartMonth + 2).endOf('month')
            ]
        case 'ytd':
            return [now.startOf('year'), now.endOf('day')]
        case 'all':
        default:
            return null
    }
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
    const { range, setRange, label, isCustom } = useDashboardDateRange()

    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<DashboardDateRange>(range)
    const [preset, setPreset] = useState<PresetKey>('this-month')

    // Reset the draft each time the dialog opens so a cancelled edit does not
    // linger into the next one.
    useEffect(() => {
        if (open) setDraft(range)
    }, [open, range])

    const applyPreset = (key: PresetKey) => {
        setPreset(key)
        if (key !== 'custom') setDraft(presetRange(key))
    }

    return (
        <>
            <Tooltip title={`Reporting period: ${label}`}>
                <Badge dot={isCustom} offset={[-2, 4]}>
                    <Button
                        type="text"
                        shape="round"
                        icon={<FilterOutlined />}
                        onClick={() => setOpen(true)}
                        className="workspace-dashboard-filter"
                        style={{ height: 32, paddingInline: compact ? 10 : 14, flex: '0 0 auto' }}
                        aria-label={`Change reporting period. Currently ${label}`}
                    >
                        {compact ? '' : label}
                    </Button>
                </Badge>
            </Tooltip>

            <Modal
                open={open}
                centered
                title="Reporting period"
                onCancel={() => setOpen(false)}
                okText="Apply"
                onOk={() => {
                    setRange(draft)
                    setOpen(false)
                }}
                width={520}
            >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Text type="secondary">
                        Dashboards show the current month by default. This selection stays
                        active across dashboards until you change it again.
                    </Text>

                    <Segmented
                        block
                        value={preset}
                        onChange={value => applyPreset(value as PresetKey)}
                        options={[
                            { label: 'Today', value: 'today' },
                            { label: 'This week', value: 'this-week' },
                            { label: 'This month', value: 'this-month' }
                        ]}
                    />

                    <Segmented
                        block
                        value={preset}
                        onChange={value => applyPreset(value as PresetKey)}
                        options={[
                            { label: 'Last month', value: 'last-month' },
                            { label: 'Last 30 days', value: 'last-30' }
                        ]}
                    />

                    <Segmented
                        block
                        value={preset}
                        onChange={value => applyPreset(value as PresetKey)}
                        options={[
                            { label: 'This quarter', value: 'this-quarter' },
                            { label: 'Year to date', value: 'ytd' },
                            { label: 'All time', value: 'all' }
                        ]}
                    />

                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>
                            Or pick an exact range
                        </Text>
                        <RangePicker
                            value={draft}
                            onChange={value => {
                                setPreset('custom')
                                setDraft(value?.[0] && value?.[1] ? [value[0], value[1]] : null)
                            }}
                            format="DD MMM YYYY"
                            style={{ width: '100%' }}
                            allowClear
                            placeholder={['All time', 'All time']}
                        />
                    </div>

                    <Text type="secondary">
                        Selected: <Text strong>{draft ? `${draft[0].format('DD MMM YYYY')} – ${draft[1].format('DD MMM YYYY')}` : 'All time'}</Text>
                    </Text>
                </Space>
            </Modal>
        </>
    )
}

export default DashboardFilterControl
