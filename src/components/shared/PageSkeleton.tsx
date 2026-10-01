import React from 'react'
import { Col, Row } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import MetricsGrid from '@/components/dashboards/metrics/MetricsGrid'

type Props = {
    /** 'analytics': tiles + two chart cards + table. 'list': tiles + table. 'cards': grid of cards. */
    variant?: 'analytics' | 'list' | 'cards' | 'single'
    /** Number of metric tiles. */
    tiles?: number
}

/**
 * Whole-page skeleton for pages whose body is one big loading branch, so
 * there is no single card to pass `loading` to. Built from the same MotionCard
 * skeletons, so it looks like the pages it stands in for.
 */
export const PageSkeleton: React.FC<Props> = ({ variant = 'analytics', tiles = 4 }) => (
    <div aria-busy='true' role='status'>
        {variant === 'single' ? (
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <MotionCard loading skeleton='list' skeletonRows={4} />
            </div>
        ) : null}
        {variant === 'analytics' || variant === 'list' ? (
            <MetricsGrid
                metrics={Array.from({ length: tiles }).map((_, i) => ({
                    key: `sk-${i}`,
                    title: '',
                    value: '',
                    subtitle: '',
                    loading: true
                }))}
            />
        ) : null}

        {variant === 'analytics' ? (
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <MotionCard loading skeleton='chart' skeletonRows={6} />
                </Col>
                <Col xs={24} lg={12}>
                    <MotionCard loading skeleton='chart' skeletonRows={6} />
                </Col>
            </Row>
        ) : null}

        {variant === 'cards' ? (
            <Row gutter={[16, 16]}>
                {Array.from({ length: 6 }).map((_, i) => (
                    <Col xs={24} md={12} xl={8} key={i}>
                        <MotionCard loading skeleton='list' skeletonRows={3} />
                    </Col>
                ))}
            </Row>
        ) : variant === 'single' ? null : (
            <div style={{ marginTop: 16 }}>
                <MotionCard loading skeleton='table' skeletonRows={6} skeletonColumns={5} />
            </div>
        )}
    </div>
)

export default PageSkeleton
