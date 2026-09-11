import { Tag } from 'antd'

import { INACTIVITY_TAG_COLORS, RISK_LEVEL_COLORS } from '../riskEngine'
import type { InactivityBucket, RiskLevel } from '../types'

export function getRiskTag(level: RiskLevel) {
    return <Tag color={RISK_LEVEL_COLORS[level]}>{level}</Tag>
}

export function getInactivityTag(bucket: InactivityBucket) {
    return <Tag color={INACTIVITY_TAG_COLORS[bucket]}>{bucket}</Tag>
}
