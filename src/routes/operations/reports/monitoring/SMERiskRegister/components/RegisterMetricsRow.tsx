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
            icon: <TeamOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)'
        },
        {
            key: 'needs-action',
            title: isDepartmentScopedView ? 'Needs Action' : 'With Gaps',
            value: metrics.withMissing,
            subtitle: isDepartmentScopedView ? 'My department needs action' : 'Departments still need follow-up',
            mobileTitle: 'Needs action',
            important: true,
            icon: <ApartmentOutlined style={{ color: '#faad14' }} />,
            iconBg: 'rgba(250,173,20,.12)'
        },
        {
            key: 'not-serviced',
            title: 'Not Serviced',
            value: metrics.notServiced,
            subtitle: isDepartmentScopedView ? 'No delivery by my department' : 'No delivery for confirmed services',
            icon: <ClockCircleOutlined style={{ color: '#722ed1' }} />,
            iconBg: 'rgba(114,46,209,.12)'
        },
        {
            key: 'critical-risk',
            title: 'Critical Risk',
            value: metrics.critical,
            subtitle: 'Immediate attention',
            icon: <AlertOutlined style={{ color: '#ff4d4f' }} />,
            iconBg: 'rgba(255,77,79,.12)'
        }
    ]

    return <MetricsGrid metrics={cards} />
}
