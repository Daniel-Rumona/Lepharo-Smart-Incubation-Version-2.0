import React, { forwardRef } from 'react'
import { Typography } from 'antd'
import QuestionRow from './QuestionRow'

const { Title } = Typography

type QuestionGroupProps = {
    title: string
    baseKey: string
    questions: string[]
    disabled?: boolean
    extras?: (index: number) => React.ReactNode
    /** Follow-up shown under a question's answer (see YesFollowUp). */
    followUps?: (index: number) => React.ReactNode
    /** Questions that keep their slot in the saved answers but are not asked as Yes/No. */
    hidden?: number[]
    firstInStep?: boolean
}

/**
 * A sub-headed cluster of QuestionRows (e.g. "Marketing & Communication"
 * within step 0). Forwards a ref so the review screen's "Edit" links can
 * scroll straight to a specific group after jumping back into its step.
 */
const QuestionGroup = forwardRef<HTMLDivElement, QuestionGroupProps>(
    ({ title, baseKey, questions, disabled, extras, followUps, hidden, firstInStep }, ref) => {
        const base = baseKey.split('.')

        return (
            <div ref={ref} style={{ marginTop: firstInStep ? 0 : 28, scrollMarginTop: 16 }}>
                <Title level={5} style={{ marginBottom: 0 }}>
                    {title}
                </Title>

                <div>
                    {questions.map((question, index) =>
                        hidden?.includes(index) ? null : (
                            <QuestionRow
                                key={`${baseKey}-${index}`}
                                namePath={[...base, index]}
                                label={question}
                                disabled={disabled}
                                extra={extras?.(index)}
                                followUp={followUps?.(index)}
                            />
                        )
                    )}
                </div>
            </div>
        )
    }
)

QuestionGroup.displayName = 'QuestionGroup'

export default QuestionGroup
