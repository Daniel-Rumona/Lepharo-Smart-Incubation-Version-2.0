import {
    AlertOutlined,
    ApartmentOutlined,
    ClockCircleOutlined,
    TeamOutlined
} from '@ant-design/icons'

import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

export type RegisterMetrics = {
    total: number
    fullyCovered: number
    withMissing: number
    notServiced: number
    critical: number
    totalTouches: number
}

type Props = {
    metrics: RegisterMetrics
    isDepartmentScopedView: boolean
    departmentScopeLabel: string
}

export default function RegisterMetricsRow({ metrics, isDepartmentScopedView, departmentScopeLabel }: Props) {
    const cards: DashboardMetric[] = [
        {
            key: 'smes-in-view',
            title: 'SMEs in View',
            value: metrics.total,
            subtitle: isDepartmentScopedView ? departmentScopeLabel : 'Consolidated register',
            mobileTitle: 'SMEs',
            important: true,
            icon: <TeamOutlined />,
            tone: 'info' as const
        },
        {
            key: 'needs-action',
            title: isDepartmentScopedView ? 'Needs Action' : 'With Gaps',
            value: metrics.withMissing,
            subtitle: isDepartmentScopedView ? 'My department needs action' : 'Departments still need follow-up',
            mobileTitle: 'Needs action',
            important: true,
            icon: <ApartmentOutlined />,
            tone: 'warning' as const
        },
        {
            key: 'not-serviced',
            title: 'Not Serviced',
            value: metrics.notServiced,
            subtitle: isDepartmentScopedView ? 'No delivery by my department' : 'No delivery for confirmed services',
            icon: <ClockCircleOutlined />,
            tone: 'info' as const
        },
        {
            key: 'critical-risk',
            title: 'Critical Risk',
            value: metrics.critical,
            subtitle: 'Immediate attention',
            icon: <AlertOutlined />,
            tone: 'danger' as const
        }
    ]

    return <MetricsGrid metrics={cards} />
}
