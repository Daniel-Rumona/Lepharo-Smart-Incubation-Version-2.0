import React from 'react'
import QuestionGroup from '../components/QuestionGroup'
import YesFollowUp from '../components/YesFollowUp'
import { SETA_QUESTION_INDEX, TRAINING_NEED_FOLLOW_UPS, trainingNeedsYN } from '../questionBanks'
import type { GroupId } from '../types'

/**
 * Training needs. "Which SETA?" and what each staff level needs are asked
 * only when the question above them is answered Yes, right under it.
 */
const Step4TrainingNeeds: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <QuestionGroup
        ref={el => registerGroupRef?.('trainingNeeds', el)}
        title="SMME Training Needs"
        baseKey="trainingNeeds.yn"
        questions={trainingNeedsYN}
        disabled={disabled}
        hidden={[SETA_QUESTION_INDEX]}
        followUps={index => {
            if (index === 0) {
                return (
                    <YesFollowUp
                        answerPath={['trainingNeeds', 'yn', 0, 'answer']}
                        name={['trainingNeeds', 'setaName']}
                        label="Which SETA?"
                        placeholder="e.g. MICT SETA (optional)"
                        disabled={disabled}
                    />
                )
            }
            const need = TRAINING_NEED_FOLLOW_UPS[index]
            return need ? (
                <YesFollowUp
                    answerPath={['trainingNeeds', 'yn', index, 'answer']}
                    name={['trainingNeeds', 'categories', need.key]}
                    label={need.label}
                    placeholder="Describe the training needed"
                    required
                    multiline
                    disabled={disabled}
                />
            ) : null
        }}
        firstInStep
    />
)

export default Step4TrainingNeeds
