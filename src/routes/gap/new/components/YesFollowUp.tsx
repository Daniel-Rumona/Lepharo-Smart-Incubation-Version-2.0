import React from 'react'
import { Form, Input, theme } from 'antd'

/**
 * A field that belongs to a Yes/No question and only appears once that
 * question is answered Yes (e.g. "Which SETA?" under the levies question).
 * A text box by default; pass children for another input (a checklist, a
 * picker). Optional unless `required`, which only marks it: the form's
 * missingFollowUps check is what holds up Continue.
 */
const YesFollowUp: React.FC<{
    answerPath: (string | number)[]
    name: (string | number)[]
    label: string
    placeholder?: string
    multiline?: boolean
    disabled?: boolean
    required?: boolean
    children?: React.ReactNode
}> = ({ answerPath, name, label, placeholder, multiline, disabled, required, children }) => {
    const { token } = theme.useToken()
    const form = Form.useFormInstance()
    const answer = Form.useWatch(answerPath, form)

    if (answer !== 'Yes') return null

    return (
        <div
            style={{
                marginTop: 12,
                paddingLeft: 12,
                borderLeft: `2px solid ${token.colorSuccessBorder}`
            }}
        >
            <Form.Item label={label} name={name} required={required} style={{ marginBottom: 0 }}>
                {children ?? (multiline ? (
                    <Input.TextArea rows={3} placeholder={placeholder} disabled={disabled} />
                ) : (
                    <Input placeholder={placeholder} disabled={disabled} />
                ))}
            </Form.Item>
        </div>
    )
}

export default YesFollowUp
