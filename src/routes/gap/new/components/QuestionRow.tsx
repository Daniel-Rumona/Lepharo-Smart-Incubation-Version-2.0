import React from 'react'
import { Form, Grid, Input, Typography, theme } from 'antd'
import YesNoChoiceCard from './YesNoChoiceCard'

const { Text } = Typography

/**
 * One Yes/No question: label on its own line (so long question text always
 * wraps legibly), then the choice-card pair alongside an optional comment
 * field, wrapping to a stacked layout on narrow screens.
 */
const QuestionRow: React.FC<{
    namePath: (string | number)[]
    label: string
    disabled?: boolean
    extra?: React.ReactNode
    /** Shown under the answer, owning its own spacing (e.g. a YesFollowUp that may render nothing). */
    followUp?: React.ReactNode
}> = ({ namePath, label, disabled, extra, followUp }) => {
    const { token } = theme.useToken()
    const isMobile = !Grid.useBreakpoint().md

    return (
        <div
            style={{
                padding: '16px 0',
                borderTop: `1px solid ${token.colorBorderSecondary}`
            }}
        >
            <Text strong style={{ display: 'block', marginBottom: 10, lineHeight: 1.45 }}>
                {label}
            </Text>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {/* Capped beside the comment on wide screens; on phones, where
                    the two stack, it spans the full width like the comment. */}
                <div style={{ flex: '1 1 240px', maxWidth: isMobile ? undefined : 320 }}>
                    <Form.Item
                        name={[...namePath, 'answer']}
                        noStyle
                        rules={[{ required: true, message: 'Select Yes or No' }]}
                    >
                        <YesNoChoiceCard ariaLabel={label} disabled={disabled} />
                    </Form.Item>
                </div>

                <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                    <Form.Item name={[...namePath, 'comment']} noStyle>
                        <Input placeholder="Comment (optional)" disabled={disabled} />
                    </Form.Item>
                </div>
            </div>

            {followUp}

            {extra && <div style={{ marginTop: 12 }}>{extra}</div>}
        </div>
    )
}

export default QuestionRow
