import React from 'react'
import QuestionGroup from '../components/QuestionGroup'
import { marketingCommunication, psychometric } from '../questionBanks'
import type { GroupId } from '../types'

const Step0MarketingPsychometric: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('marketingCommunication', el)}
            title="Marketing & Communication"
            baseKey="marketingCommunication"
            questions={marketingCommunication}
            disabled={disabled}
            firstInStep
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('psychometric', el)}
            title="Psychometric Evaluation"
            baseKey="psychometric"
            questions={psychometric}
            disabled={disabled}
        />
    </>
)

export default Step0MarketingPsychometric
