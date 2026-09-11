import React from 'react'
import { Progress, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

/**
 * The one-question-at-a-time shell used by both the builder's preview modal and
 * the SME response page, so the two can't drift apart visually.
 *
 * Purely presentational: it owns no answer state and no navigation. The caller
 * decides what the control is (`children`) and what the buttons do (`footer`),
 * because the preview throws answers away while the response page validates,
 * uploads files and writes to Firestore.
 */

export type SurveyFrameField = {
    id: string
    type: string
    label: string
    required?: boolean
    description?: string
}

type SurveyQuestionFrameProps = {
    /** Zero-based position among questions (headings excluded). */
    index: number
    total: number
    field: SurveyFrameField
    /** Nearest preceding heading, shown as the section eyebrow. */
    sectionLabel?: string
    /** The input control for this question. */
    children: React.ReactNode
    /** Navigation / submit row, rendered under a divider. */
    footer?: React.ReactNode
    /** Optional note under the control (e.g. the prefill explanation). */
    extra?: React.ReactNode
    /** Answered-count progress. Omit to hide the bar. */
    answeredCount?: number
    /** Rendered above the question — survey title, tags, etc. */
    header?: React.ReactNode
}

const SurveyQuestionFrame: React.FC<SurveyQuestionFrameProps> = ({
    index,
    total,
    field,
    sectionLabel,
    children,
    footer,
    extra,
    answeredCount,
    header
}) => {
    const { token } = theme.useToken()
    const progress =
        total > 0 && answeredCount !== undefined
            ? Math.round((answeredCount / total) * 100)
            : undefined

    return (
        <>
            {header || progress !== undefined ? (
                <div
                    style={{
                        padding: '20px 24px 0'
                    }}
                >
                    {header}

                    {progress !== undefined ? (
                        <>
                            <Space size={6} wrap style={{ marginTop: 4 }}>
                                <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                                    {total} {total === 1 ? 'Question' : 'Questions'}
                                </Tag>
                                <Tag
                                    color='blue'
                                    style={{ marginInlineEnd: 0, borderRadius: 999 }}
                                >
                                    {answeredCount} Answered
                                </Tag>
                            </Space>

                            <Progress
                                percent={progress}
                                showInfo={false}
                                size='small'
                                style={{ marginTop: 16 }}
                            />
                        </>
                    ) : null}
                </div>
            ) : null}

            {/* QUESTION */}
            <div
                style={{
                    minHeight: 330,
                    padding: '30px 32px 34px'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 26
                    }}
                >
                    <Text
                        style={{
                            fontSize: 28,
                            lineHeight: 1,
                            fontWeight: 700,
                            color: token.colorTextTertiary
                        }}
                    >
                        {String(index + 1).padStart(2, '0')}
                    </Text>

                    <Text type='secondary'>
                        Question {index + 1} of {total}
                    </Text>
                </div>

                {sectionLabel ? (
                    <Text
                        type='secondary'
                        style={{
                            display: 'block',
                            marginBottom: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em'
                        }}
                    >
                        {sectionLabel}
                    </Text>
                ) : null}

                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        marginBottom: 20
                    }}
                >
                    <Title level={3} style={{ margin: 0, fontSize: 22 }}>
                        {field.label || 'Untitled question'}
                    </Title>

                    {field.required ? (
                        <Text type='danger' style={{ fontSize: 20 }}>
                            *
                        </Text>
                    ) : null}

                    {field.description ? (
                        <Tooltip title={field.description}>
                            <InfoCircleOutlined
                                style={{
                                    color: token.colorTextTertiary,
                                    cursor: 'help'
                                }}
                            />
                        </Tooltip>
                    ) : null}
                </div>

                <div style={{ maxWidth: 620 }}>{children}</div>

                {extra ? <div style={{ marginTop: 10 }}>{extra}</div> : null}

                {field.description ? (
                    <Text
                        type='secondary'
                        style={{
                            display: 'block',
                            marginTop: 10,
                            fontSize: 12
                        }}
                    >
                        {field.description}
                    </Text>
                ) : null}
            </div>

            {footer ? (
                <div
                    style={{
                        padding: '16px 24px',
                        borderTop: `1px solid ${token.colorBorderSecondary}`
                    }}
                >
                    {footer}
                </div>
            ) : null}
        </>
    )
}

export default SurveyQuestionFrame

/** Nearest heading above `fieldId` in the full field list, if any. */
export const findSectionLabel = (
    fields: Array<{ id: string; type: string; label: string }>,
    fieldId: string
): string | undefined => {
    const position = fields.findIndex(f => f.id === fieldId)
    if (position <= 0) return undefined
    return [...fields]
        .slice(0, position)
        .reverse()
        .find(f => f.type === 'heading')?.label
}
