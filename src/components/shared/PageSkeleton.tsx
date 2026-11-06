import React from 'react'
import { Col, Row, Skeleton } from 'antd'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import MetricsGrid from '@/components/dashboards/metrics/MetricsGrid'

type Props = {
    /**
     * 'analytics': tiles + two chart cards + table. 'list': tiles + table. 'cards': grid of cards.
     * 'split': master-detail - a narrow stacked list beside a wide details panel.
     */
    variant?: 'analytics' | 'list' | 'cards' | 'single' | 'split'
    /** Number of metric tiles. */
    tiles?: number
}

const SplitListSkeleton: React.FC = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
            <div
                key={i}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 12,
                    border: '1px solid rgba(128, 128, 128, 0.18)',
                    borderRadius: 8
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Skeleton.Avatar active size={44} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Skeleton.Input active size='small' style={{ width: 140, minWidth: 0, height: 16 }} />
                        <Skeleton.Input active size='small' style={{ width: 90, minWidth: 0, height: 12 }} />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <Skeleton.Button active size='small' style={{ width: 64, minWidth: 0 }} />
                    <Skeleton.Button active size='small' style={{ width: 72, minWidth: 0 }} />
                </div>
            </div>
        ))}
    </div>
)

const SplitDetailSkeleton: React.FC = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Skeleton.Avatar active size={56} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton.Input active size='small' style={{ width: 220, minWidth: 0, height: 20 }} />
                    <Skeleton.Input active size='small' style={{ width: 300, minWidth: 0, height: 12 }} />
                </div>
            </div>
            <Skeleton.Button active style={{ width: 400, maxWidth: '100%', minWidth: 0, borderRadius: 12 }} />
        </div>
        <Skeleton active title={false} paragraph={{ rows: 8 }} />
    </div>
)

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

        {variant === 'split' ? (
            <Row gutter={[16, 16]}>
                <Col xs={24} xl={7}>
                    <MotionCard loading skeleton={<SplitListSkeleton />} />
                </Col>
                <Col xs={24} xl={17}>
                    <MotionCard loading skeleton={<SplitDetailSkeleton />} />
                </Col>
            </Row>
        ) : variant === 'cards' ? (
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
