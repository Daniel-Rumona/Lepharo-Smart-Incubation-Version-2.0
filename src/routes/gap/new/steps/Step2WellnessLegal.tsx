import React from 'react'
import { Checkbox, Select } from 'antd'
import QuestionGroup from '../components/QuestionGroup'
import YesFollowUp from '../components/YesFollowUp'
import {
    LEGAL_AREAS_QUESTION_INDEX,
    WELLNESS_PROGRAMMES_QUESTION_INDEX,
    legal,
    legalAreas,
    wellness,
    wellnessProgrammes
} from '../questionBanks'
import type { GroupId } from '../types'

/**
 * Wellness and legal. Which programmes are in place, and which legal areas
 * they need help with, are asked only when the question above is answered
 * Yes, right under it.
 */
const Step2WellnessLegal: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('wellness', el)}
            title="SMME Wellness"
            baseKey="wellness.q"
            questions={wellness}
            disabled={disabled}
            firstInStep
            followUps={index =>
                index === WELLNESS_PROGRAMMES_QUESTION_INDEX ? (
                    <YesFollowUp
                        answerPath={['wellness', 'q', index, 'answer']}
                        name={['wellness', 'programmes']}
                        label="Which programmes do you have?"
                        required
                    >
                        <Checkbox.Group
                            options={wellnessProgrammes}
                            disabled={disabled}
                            style={{ display: 'grid', gap: 8 }}
                        />
                    </YesFollowUp>
                ) : null
            }
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('legal', el)}
            title="SMME Legal"
            baseKey="legal.q"
            questions={legal}
            disabled={disabled}
            followUps={index =>
                index === LEGAL_AREAS_QUESTION_INDEX ? (
                    <YesFollowUp
                        answerPath={['legal', 'q', index, 'answer']}
                        name={['legal', 'areas']}
                        label="Which areas do you need help with?"
                        required
                    >
                        <Select
                            mode="multiple"
                            allowClear
                            placeholder="Select legal areas"
                            options={legalAreas.map(area => ({ value: area, label: area }))}
                            disabled={disabled}
                        />
                    </YesFollowUp>
                ) : null
            }
        />
    </>
)

export default Step2WellnessLegal
