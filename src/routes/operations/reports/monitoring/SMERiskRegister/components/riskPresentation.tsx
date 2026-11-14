import { Tag } from 'antd'

import { INACTIVITY_TAG_COLORS, RISK_LEVEL_COLORS, RISK_LEVEL_TINTS } from '../riskEngine'
import type { InactivityBucket, RiskLevel } from '../types'

/** A risk level: tinted, outlined and dotted in the level's colour; the words stay in text colour. */
export function getRiskTag(level: RiskLevel, suffix?: string | number) {
    return (
        <Tag
            style={{
                marginInlineEnd: 0,
                borderRadius: 999,
                borderColor: RISK_LEVEL_COLORS[level],
                background: RISK_LEVEL_TINTS[level],
                color: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
            }}
        >
            <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 999, background: RISK_LEVEL_COLORS[level] }}
            />
            {level}
            {suffix !== undefined ? ` · ${suffix}` : null}
        </Tag>
    )
}

export function getInactivityTag(bucket: InactivityBucket) {
    return <Tag color={INACTIVITY_TAG_COLORS[bucket]}>{bucket}</Tag>
}
