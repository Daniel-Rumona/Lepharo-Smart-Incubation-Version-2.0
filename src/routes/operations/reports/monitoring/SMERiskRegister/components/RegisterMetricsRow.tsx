import {
    AlertOutlined,
    ApartmentOutlined,
    ClockCircleOutlined,
    RiseOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { theme } from 'antd'

import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

export type RegisterMetrics = {
    total: number
    withStaffDelays: number
    notServiced: number
    critical: number
    rising: number
}

/** What a tile narrows the register to. */
export type MetricFocus = 'staff_delays' | 'not_serviced' | 'critical' | 'rising'

type Props = {
    metrics: RegisterMetrics
    activeFocus: MetricFocus | null
    /** 'all' clears the filters; picking the active tile again does too. */
    onFocusClick: (focus: MetricFocus | 'all') => void
}

export default function RegisterMetricsRow({
    metrics,
    activeFocus,
    onFocusClick
}: Props) {
    const { token } = theme.useToken()

    const activeStyle = (focus: MetricFocus) =>
        activeFocus === focus
            ? { outline: `2px solid ${token.colorPrimary}`, outlineOffset: -2, borderRadius: 16 }
            : undefined

    const cards: DashboardMetric[] = [
        {
            key: 'smes-in-view',
            title: 'SMEs in View',
            value: metrics.total,
            mobileTitle: 'SMEs',
            important: true,
            icon: <TeamOutlined />,
            tone: 'info' as const,
            onClick: () => onFocusClick('all')
        },
        {
            key: 'staff-delays',
            title: 'Staff Delays',
            value: metrics.withStaffDelays,
            mobileTitle: 'Staff delays',
            important: true,
            icon: <ApartmentOutlined />,
            tone: 'warning' as const,
            onClick: () => onFocusClick('staff_delays'),
            wrapperStyle: activeStyle('staff_delays')
        },
        {
            key: 'not-serviced',
            title: 'Not Serviced',
            value: metrics.notServiced,
            icon: <ClockCircleOutlined />,
            tone: 'info' as const,
            onClick: () => onFocusClick('not_serviced'),
            wrapperStyle: activeStyle('not_serviced')
        },
        {
            key: 'critical-risk',
            title: 'Critical Risk',
            value: metrics.critical,
            icon: <AlertOutlined />,
            tone: 'danger' as const,
            onClick: () => onFocusClick('critical'),
            wrapperStyle: activeStyle('critical')
        },
        {
            key: 'rising',
            title: 'Rising',
            value: metrics.rising,
            icon: <RiseOutlined />,
            tone: 'warning' as const,
            onClick: () => onFocusClick('rising'),
            wrapperStyle: activeStyle('rising')
        }
    ]

    return <MetricsGrid metrics={cards} />
}
