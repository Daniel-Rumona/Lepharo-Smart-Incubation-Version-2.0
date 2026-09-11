import React from 'react'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileDoneOutlined,
    SyncOutlined
} from '@ant-design/icons'
import MetricsGrid, { type DashboardMetric } from './MetricsGrid'
import type { InterventionMetricSummary } from '@/services/interventionMetricsService'

/** The tiles that can be drilled into. Required is a target, not a record set. */
export type InterventionMetricKey = 'assigned' | 'in-progress' | 'completed'

type Props = {
    metrics: InterventionMetricSummary
    loading?: boolean
    /**
     * Called when a drillable tile is clicked. Omit to render the tiles as plain
     * figures.
     */
    onSelect?: (key: InterventionMetricKey) => void
    /**
     * Describes the active reporting window, e.g. "This month". Only the
     * assignment-derived tiles are period-scoped — Required is a standing
     * program target and says so, otherwise a narrow window makes it read as
     * though the target itself shrank.
     */
    periodLabel?: string
}

const displayValue = (value: number, loading?: boolean) => loading ? '...' : value

export const buildInterventionDashboardMetrics = (
    metrics: InterventionMetricSummary,
    loading = false,
    onSelect?: (key: InterventionMetricKey) => void,
    periodLabel?: string
): DashboardMetric[] => {
    const inPeriod = periodLabel ? periodLabel.toLowerCase() : undefined
    const drill = (key: InterventionMetricKey) =>
        onSelect ? { onClick: () => onSelect(key) } : {}

    return [
        {
            key: 'required',
            important: true,
            icon: <FileDoneOutlined style={{ fontSize: 20, color: '#1677ff' }} />,
            iconBg: 'transparent',
            title: 'Required',
            value: displayValue(metrics.totalRequired, loading),
            subtitle: 'Standing program target'
        },
        {
            key: 'assigned',
            important: true,
            icon: <ClockCircleOutlined style={{ fontSize: 20, color: '#d97706' }} />,
            iconBg: 'transparent',
            title: 'Assigned',
            value: displayValue(metrics.assigned, loading),
            subtitle: inPeriod ? `Assigned ${inPeriod}` : undefined,
            ...drill('assigned')
        },
        {
            key: 'in-progress',
            icon: <SyncOutlined style={{ fontSize: 20, color: '#722ed1' }} />,
            iconBg: 'transparent',
            title: 'In Progress',
            value: displayValue(metrics.inProgress, loading),
            subtitle: inPeriod ? `Assigned ${inPeriod}` : undefined,
            ...drill('in-progress')
        },
        {
            key: 'completed',
            icon: <CheckCircleOutlined style={{ fontSize: 20, color: '#16a34a' }} />,
            iconBg: 'transparent',
            title: 'Completed',
            value: displayValue(metrics.completed, loading),
            subtitle: inPeriod ? `Assigned ${inPeriod}` : undefined,
            ...drill('completed')
        }
    ]
}

const InterventionMetricsGrid: React.FC<Props> = ({
    metrics,
    loading = false,
    onSelect,
    periodLabel
}) => (
    <MetricsGrid
        metrics={buildInterventionDashboardMetrics(metrics, loading, onSelect, periodLabel)}
    />
)

export default InterventionMetricsGrid
