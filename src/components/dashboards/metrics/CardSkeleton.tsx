import React from 'react'
import { Skeleton } from 'antd'

export type CardSkeletonVariant = 'text' | 'table' | 'chart' | 'list' | 'stats'

type Props = {
    variant?: CardSkeletonVariant
    rows?: number
    /** Table only: number of columns. */
    columns?: number
}

const bar = (w: number | string, h = 14, radius = 4): React.CSSProperties => ({
    width: w,
    height: h,
    minWidth: 0,
    borderRadius: radius
})

/**
 * Skeleton shapes for MotionCard's `loading` prop. Each mirrors a common card
 * body so the layout does not jump when data arrives.
 */
export const CardSkeleton: React.FC<Props> = ({ variant = 'text', rows = 3, columns = 4 }) => {
    if (variant === 'table') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                    {Array.from({ length: columns }).map((_, c) => (
                        <div key={c} style={{ flex: c === 0 ? 2 : 1 }}>
                            <Skeleton.Input active size="small" block style={bar('60%', 12)} />
                        </div>
                    ))}
                </div>
                {Array.from({ length: rows }).map((_, r) => (
                    <div key={r} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        {Array.from({ length: columns }).map((_, c) => (
                            <div key={c} style={{ flex: c === 0 ? 2 : 1 }}>
                                <Skeleton.Input
                                    active
                                    size="small"
                                    block
                                    style={bar(c === 0 ? `${70 + ((r * 13) % 25)}%` : `${45 + ((r + c) * 11) % 35}%`)}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        )
    }

    if (variant === 'chart') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: rows }).map((_, r) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Skeleton.Input active size="small" style={bar(100 + (r % 3) * 16, 12)} />
                        <div style={{ flex: 1 }}>
                            <Skeleton.Input
                                active
                                size="small"
                                block
                                style={{ ...bar(`${Math.max(15, 92 - r * 14)}%`, 18), display: 'block' }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    if (variant === 'list') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Array.from({ length: rows }).map((_, r) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Skeleton.Avatar active shape="circle" size={36} />
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Skeleton.Input active size="small" style={bar(`${50 + (r % 3) * 12}%`)} />
                            <Skeleton.Input active size="small" style={bar(`${30 + (r % 2) * 10}%`, 11)} />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    if (variant === 'stats') {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Skeleton.Avatar active shape="circle" size={56} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton.Input active size="small" style={bar(80, 20)} />
                    <Skeleton.Input active size="small" style={bar(140, 12)} />
                </div>
            </div>
        )
    }

    return <Skeleton active title={false} paragraph={{ rows }} />
}

export default CardSkeleton
