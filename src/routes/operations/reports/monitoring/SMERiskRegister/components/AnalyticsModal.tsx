import { Col, Modal, Row, Typography } from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { motion, useReducedMotion } from 'framer-motion'

import { MotionCard } from '@/components/dashboards/metrics/Header'

import type { SMERow } from '../types'
import {
    buildActivityBreakdownChartOptions,
    buildCoverageChartOptions,
    buildMissingDeptChartOptions,
    buildNeglectedChartOptions,
    type CoverageMetrics,
    type MissingDeptChartDatum
} from './charts'

const { Title, Text } = Typography

type Props = {
    open: boolean
    onClose: () => void
    isDepartmentScopedView: boolean
    departmentScopeLabel: string
    metrics: CoverageMetrics
    missingDeptChartData: MissingDeptChartDatum[]
    servicedTouchRows: SMERow[]
    neglectedRows: SMERow[]
}

export default function AnalyticsModal({
    open,
    onClose,
    isDepartmentScopedView,
    departmentScopeLabel,
    metrics,
    missingDeptChartData,
    servicedTouchRows,
    neglectedRows
}: Props) {
    const shouldReduceMotion = useReducedMotion()

    const panels = [
        {
            title: isDepartmentScopedView ? 'Service Summary' : 'Coverage Summary',
            subtitle: 'Bars run from complete (green) to critical risk (red)',
            options: buildCoverageChartOptions(metrics, isDepartmentScopedView)
        },
        {
            title: isDepartmentScopedView ? 'Services Needing Follow-Up' : 'Departments Needing Follow-Up',
            subtitle: 'Top 10 departments by number of SMEs awaiting follow-up',
            options: buildMissingDeptChartOptions(missingDeptChartData, isDepartmentScopedView)
        },
        {
            title: 'Top 10 Serviced SMEs',
            subtitle: 'Completed, pending and declined touches per SME',
            options: buildActivityBreakdownChartOptions(servicedTouchRows)
        },
        {
            title: 'SMEs Needing Service Attention',
            subtitle: 'Ranked by days since the last recorded service',
            options: buildNeglectedChartOptions(neglectedRows)
        }
    ]

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={1200}
            destroyOnClose
            title={isDepartmentScopedView ? `${departmentScopeLabel} SME Risk Analytics` : 'SME Risk Analytics'}
        >
            <Row gutter={[16, 16]}>
                {panels.map((panel, i) => (
                    <Col xs={24} xl={12} key={panel.title}>
                        <motion.div
                            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 10 }}
                            animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.06 }}
                        >
                            <MotionCard>
                                <Title level={5} style={{ marginTop: 0, marginBottom: 2 }}>
                                    {panel.title}
                                </Title>
                                <Text type="secondary" style={{ fontSize: 12 }}>{panel.subtitle}</Text>
                                <HighchartsReact highcharts={Highcharts} options={panel.options} />
                            </MotionCard>
                        </motion.div>
                    </Col>
                ))}
            </Row>
        </Modal>
    )
}
