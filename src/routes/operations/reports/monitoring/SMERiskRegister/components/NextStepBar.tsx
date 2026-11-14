import { useMemo } from 'react'
import { Button, Tooltip, Typography, theme } from 'antd'
import { BulbOutlined, OpenAIOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

import { useChatSession } from '@/routes/chat/ChatSessionContext'
import { useDepartmentRoles } from '@/services/departmentRoles'
import type { DepartmentRoleKey } from '@/services/departmentRoles'
import { suggestNextStep } from '../../../../../../../functions/src/smeRiskLogic'
import type { SMERow } from '../types'

const { Text } = Typography

// Reasons that describe the baseline rather than a problem to act on.
export const isActionableReason = (item: SMERow['riskBreakdown'][number]) =>
    item.delta > 0 &&
    item.label !== 'Recently serviced' &&
    !item.label.startsWith('New SME') &&
    !item.label.startsWith('Capped')

/** The suggested next step for one SME, who is best placed to take it, and a hand-off to the assistant. */
export default function NextStepBar({ row }: { row: SMERow }) {
    const { token } = theme.useToken()
    const navigate = useNavigate()
    const { startMessage } = useChatSession()
    const { idForRole, nameOf } = useDepartmentRoles()

    const suggestion = useMemo(
        () =>
            suggestNextStep({
                score: row.riskScore,
                level: row.riskLevel,
                breakdown: row.riskBreakdown
            }),
        [row]
    )

    if (!suggestion) return null

    const reasons = row.riskBreakdown
        .filter(isActionableReason)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 3)

    const departmentId = suggestion.departmentRole
        ? idForRole(suggestion.departmentRole as DepartmentRoleKey)
        : null
    const owner = departmentId ? nameOf(departmentId) : "The SME's coordinator"

    const askAssistant = () => {
        // About this one SME only. Avoid phrasing like "who needs me", which asks for the programme-wide attention list.
        const sent = startMessage(
            `Help me act on ${row.smeName} (participant id ${row.participantId}). ` +
            `It is ${row.riskLevel} risk (${row.riskScore}/100) because: ` +
            `${reasons.map(reason => reason.label).join('; ')}. ` +
            `The register suggests this next step: ${suggestion.text} ` +
            'If you can prepare that, or the closest thing you can do for it, prepare it for me to confirm. ' +
            'If you cannot, say so plainly and tell me how to do it myself.'
        )
        if (sent) navigate('/chat')
    }

    return (
        <div
            style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${token.colorPrimaryBorder}`,
                background: token.colorPrimaryBg
            }}
        >
            <BulbOutlined style={{ color: token.colorPrimary, fontSize: 16, flex: '0 0 auto' }} />
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <Text strong style={{ fontSize: 13 }}>
                    Next step: {suggestion.text}
                </Text>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {owner}
                    {row.staffDelayDepartments.length
                        ? ` · also waiting on staff: ${row.staffDelayDepartments.join(', ')}`
                        : ''}
                </Text>
            </div>
            <Tooltip title="The assistant prepares the next step for you to confirm">
                <Button size="small" shape="round" icon={<OpenAIOutlined />} onClick={askAssistant}>
                    Ask assistant
                </Button>
            </Tooltip>
        </div>
    )
}
