import React, { useState } from 'react'
import { Button, Space, Typography, theme } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    FileDoneOutlined,
    FormOutlined,
    ProfileOutlined
} from '@ant-design/icons'

import DashboardButton from './DashboardButton'
import { MotionCard } from '../dashboards/metrics/Header'

const { Text } = Typography

export type AttentionKind = 'completion' | 'agreement' | 'survey' | 'plan' | 'appointment'

export type AttentionAction = {
    label: string
    onClick: () => void
    /** The item's main action: drawn filled. At most one per item. */
    primary?: boolean
    danger?: boolean
    icon?: React.ReactNode
}

export type AttentionItem = {
    key: string
    kind: AttentionKind
    title: string
    /** Who / when, under the title. */
    subtitle?: string
    actions: AttentionAction[]
}

const KIND_META: Record<AttentionKind, { label: string; icon: React.ReactNode }> = {
    completion: { label: 'Completion', icon: <CheckCircleOutlined /> },
    agreement: { label: 'Agreement', icon: <FileDoneOutlined /> },
    survey: { label: 'Survey', icon: <FormOutlined /> },
    plan: { label: 'Development plan', icon: <ProfileOutlined /> },
    appointment: { label: 'Appointment', icon: <CalendarOutlined /> }
}

/** How many rows show before "Show all". */
const COLLAPSED_COUNT = 5

/**
 * Everything on the incubatee dashboard that is waiting on the SME, in one
 * list: completion confirmations, unsigned agreements and surveys, department
 * plans to confirm, and appointments to respond to. Colours come from the
 * antd theme (passed in as --na-* custom properties), so it follows the
 * colour mode and the chosen accent.
 */
export default function NeedsAttentionCard({ items }: { items: AttentionItem[] }) {
    const { token } = theme.useToken()
    const [expanded, setExpanded] = useState(false)

    const tones: Record<AttentionKind, string> = {
        completion: token.colorSuccess,
        agreement: token.colorWarning,
        survey: token.colorInfo,
        plan: token.colorPrimary,
        appointment: token.colorPrimary
    }

    const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT)
    const hidden = items.length - visible.length

    return (
        <MotionCard
            data-guide="incubatee-needs-attention"
            className="incubatee-overview-card"
            title={
                <Space size={8}>
                    <span>Needs your attention</span>
                    <span
                        className="needs-attention-count"
                        style={{ '--na-accent': token.colorPrimary } as React.CSSProperties}
                    >
                        {items.length}
                    </span>
                </Space>
            }
            styles={{ body: { padding: 0 } }}
        >
            <div
                style={{
                    '--na-line': token.colorBorderSecondary,
                    '--na-hover': token.colorFillQuaternary,
                    '--na-muted': token.colorTextSecondary
                } as React.CSSProperties}
            >
                <ul className="needs-attention-list">
                    {visible.map(item => {
                        const meta = KIND_META[item.kind]
                        return (
                            <li
                                key={item.key}
                                className="needs-attention-item"
                                style={{ '--na-tone': tones[item.kind] } as React.CSSProperties}
                            >
                                <span className="needs-attention-icon" aria-hidden="true">
                                    {meta.icon}
                                </span>
                                <div className="needs-attention-text">
                                    <span className="needs-attention-kind">{meta.label}</span>
                                    <Text strong className="needs-attention-title">
                                        {item.title}
                                    </Text>
                                    {item.subtitle ? (
                                        <span className="needs-attention-subtitle">{item.subtitle}</span>
                                    ) : null}
                                </div>
                                <div className="needs-attention-actions" data-guide="incubatee-attention-actions">
                                    {item.actions.map(action =>
                                        action.primary ? (
                                            <Button
                                                key={action.label}
                                                type="primary"
                                                size="small"
                                                icon={action.icon}
                                                onClick={action.onClick}
                                            >
                                                {action.label}
                                            </Button>
                                        ) : (
                                            <DashboardButton
                                                key={action.label}
                                                size="small"
                                                danger={action.danger}
                                                icon={action.icon}
                                                onClick={action.onClick}
                                            >
                                                {action.label}
                                            </DashboardButton>
                                        )
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
                {items.length > COLLAPSED_COUNT ? (
                    <div className="needs-attention-more">
                        <Button type="link" size="small" onClick={() => setExpanded(open => !open)}>
                            {expanded ? 'Show fewer' : `Show all ${items.length} (${hidden} more)`}
                        </Button>
                    </div>
                ) : null}
            </div>
        </MotionCard>
    )
}
