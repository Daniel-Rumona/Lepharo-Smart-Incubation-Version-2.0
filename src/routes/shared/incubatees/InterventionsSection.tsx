import React, { useMemo } from 'react'
import { Row, Col, Space, Tag, Empty, Skeleton } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { Dayjs } from 'dayjs'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { DeptGap, INTERVENTION_BUCKETS, Intervention, InterventionBucket, SmeRow, chartDataLabels, getAssignedCompletedAt, isStrictlyCompleted, monthKeyFromValue } from './participantsData'
import { SummaryStrip } from './SummaryStrip'
import { DepartmentDrilldown } from './DepartmentDrilldown'

type InterventionsSectionProps = {
    row: SmeRow | null
    interventions: Intervention[]
    loading: boolean
    diagnosticConfirmed: boolean | null
    deptGaps: DeptGap[]
    reportingRange: [Dayjs, Dayjs]
    statusFilter: InterventionBucket | null
    onStatusFilterChange: (bucket: InterventionBucket | null) => void
    selectedDeptKey: string | null
    onSelectDept: (key: string | null) => void
    isDark: boolean
}

/** Status summary, monthly trend and department drill-down of the selected SME's interventions. */
export const InterventionsSection: React.FC<InterventionsSectionProps> = ({
    row: selectedRow,
    interventions,
    loading: interventionsLoading,
    diagnosticConfirmed,
    deptGaps,
    reportingRange,
    statusFilter: interventionStatusFilter,
    onStatusFilterChange: setInterventionStatusFilter,
    selectedDeptKey,
    onSelectDept: setSelectedDeptKey,
    isDark
}) => {
    const interventionsSummary = useMemo(() => {
        let total = interventions.length
        let completed = 0
        let inProgress = 0
        let missing = 0

        interventions.forEach(i => {
            const s = String(i.status || '').toLowerCase()
            if (s === 'completed') completed++
            else if (s === 'in-progress' || s === 'ongoing') inProgress++
            else missing++
        })

        return { total, completed, inProgress, missing }
    }, [interventions])

    const interventionMonthlyTrend = useMemo(() => {
        const startMonth = reportingRange[0].startOf('month')
        const monthCount = Math.max(1, reportingRange[1].endOf('month').diff(startMonth, 'month') + 1)
        const months = Array.from({ length: monthCount }, (_, index) => {
            const month = startMonth.add(index, 'month')
            return {
                key: month.format('YYYY-MM'),
                label: month.format('MMM YY'),
                assigned: 0,
                completed: 0
            }
        })
        const byMonth = new Map(months.map(month => [month.key, month]))

        interventions.forEach(intervention => {
            const assignedKey = monthKeyFromValue(
                intervention.assignedAt || intervention.createdAt || intervention.updatedAt
            )
            if (assignedKey && byMonth.has(assignedKey)) byMonth.get(assignedKey)!.assigned += 1

            if (isStrictlyCompleted(intervention)) {
                const completedKey = monthKeyFromValue(getAssignedCompletedAt(intervention))
                if (completedKey && byMonth.has(completedKey)) byMonth.get(completedKey)!.completed += 1
            }
        })

        const hasData = months.some(month => month.assigned > 0 || month.completed > 0)
        const options: Highcharts.Options = {
            chart: { height: 340, backgroundColor: 'transparent', spacingTop: 32 },
            title: { text: undefined },
            credits: { enabled: false },
            xAxis: { categories: months.map(month => month.label), crosshair: true },
            yAxis: { min: 0, allowDecimals: false, title: { text: 'Interventions' } },
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    dataLabels: {
                        ...chartDataLabels(isDark),
                        formatter: function () {
                            return Highcharts.numberFormat(Number(this.y || 0), 0)
                        }
                    }
                },
                column: {
                    borderRadius: 4,
                    maxPointWidth: 42
                },
                spline: {
                    lineWidth: 3,
                    marker: { enabled: true, radius: 4 }
                }
            },
            series: [
                { type: 'column', name: 'Assigned', data: months.map(month => month.assigned), color: '#1677ff' },
                { type: 'spline', name: 'Completed', data: months.map(month => month.completed), color: '#52c41a' }
            ]
        }

        return { hasData, options }
    }, [interventions, reportingRange, isDark])

    if (!selectedRow) return <Empty description='Select an SME to view interventions' />

    if (interventionsLoading) return <Skeleton active paragraph={{ rows: 8 }} />

    if (!interventions.length) return <Empty description='No interventions allocated yet for this SME.' />

    return (
        <Space direction='vertical' style={{ width: '100%' }} size='middle'>
            <SummaryStrip<InterventionBucket>
                total={interventionsSummary.total}
                totalLabel={interventionsSummary.total === 1 ? 'intervention' : 'interventions'}
                active={interventionStatusFilter}
                onToggle={setInterventionStatusFilter}
                segments={(Object.keys(INTERVENTION_BUCKETS) as InterventionBucket[]).map(key => ({
                    key,
                    label: INTERVENTION_BUCKETS[key].label,
                    color: INTERVENTION_BUCKETS[key].color,
                    count: interventionsSummary[key]
                }))}
            />

            <Row
                data-guide='sme-intervention-trends'
                gutter={[16, 16]}
                align='stretch'
            >
                <Col span={24}>
                    <MotionCard title='Intervention performance month-on-month' style={{ height: '100%' }}>
                        {interventionMonthlyTrend.hasData
                            ? <HighchartsReact highcharts={Highcharts} options={interventionMonthlyTrend.options} />
                            : <Empty description='No dated intervention activity was recorded for this period.' />}
                    </MotionCard>
                </Col>
                <Col span={24}>
                    <MotionCard
                        title='Current assignments by department'
                        style={{ height: '100%' }}
                        extra={diagnosticConfirmed === false ? <Tag color='gold'>DP not finalised</Tag> : <Tag color='green'>DP finalised</Tag>}
                    >
                        <DepartmentDrilldown
                            departments={deptGaps}
                            interventions={interventions}
                            selectedKey={selectedDeptKey}
                            onSelect={setSelectedDeptKey}
                            statusFilter={interventionStatusFilter}
                        />
                    </MotionCard>
                </Col>
            </Row>
        </Space>
    )
}
