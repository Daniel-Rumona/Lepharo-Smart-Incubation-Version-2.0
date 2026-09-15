import React from 'react'
import { Progress, Typography, theme } from 'antd'

const { Text } = Typography

/**
 * Slim label + "X of Y" + progress bar shown above the active step's card —
 * same convention as the onboarding flow's renderHeader(). Omitted entirely
 * on the review step (the caller just doesn't render this).
 */
const GapStepHeader: React.FC<{
    label: string
    current: number
    total: number
}> = ({ label, current, total }) => {
    const { token } = theme.useToken()
    const percent = Math.round((current / total) * 100)

    return (
        <div style={{ marginBottom: 14, flex: '0 0 auto' }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 6
                }}
            >
                <Text type="secondary" style={{ fontSize: 13 }}>
                    {label}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {current} of {total}
                </Text>
            </div>
            <Progress
                percent={percent}
                showInfo={false}
                size="small"
                strokeColor={token.colorPrimary}
                trailColor={token.colorBorderSecondary}
            />
        </div>
    )
}

export default GapStepHeader
