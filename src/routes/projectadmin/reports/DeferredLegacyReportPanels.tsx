import React from 'react'
import { Button, Col, Empty, Row } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { MotionCard } from '@/components/dashboards/metrics/Header'

type DeferredPanel = {
    key: 'onboardedVsSigned' | 'outstandingDocs' | 'dps'
    title: string
    hasData: boolean
    options: Highcharts.Options
    span?: number
}

export type DeferredLegacyReportPanelsProps = {
    panels: DeferredPanel[]
    onExpand: (key: DeferredPanel['key']) => void
}

/**
 * Held outside the active Project Admin report while its reporting intent is
 * redesigned. It deliberately has no route-level usage at present.
 */
export const DeferredLegacyReportPanels: React.FC<DeferredLegacyReportPanelsProps> = ({
    panels,
    onExpand
}) => (
    <Row gutter={[16, 16]}>
        {panels.map(panel => (
            <Col key={panel.key} xs={24} lg={panel.span || 12}>
                <MotionCard
                    title={panel.title}
                    extra={
                        <Button
                            size='small'
                            icon={<ExpandOutlined />}
                            onClick={() => onExpand(panel.key)}
                        >
                            Expand
                        </Button>
                    }
                >
                    {panel.hasData ? (
                        <HighchartsReact highcharts={Highcharts} options={panel.options} />
                    ) : (
                        <div style={{ height: (panel.options.chart as any)?.height || 300, display: 'grid', placeItems: 'center' }}>
                            <Empty description='No data in selected range' />
                        </div>
                    )}
                </MotionCard>
            </Col>
        ))}
    </Row>
)

export default DeferredLegacyReportPanels
