import React from 'react'
import QuestionGroup from '../components/QuestionGroup'
import { financialManagement, labourHSE } from '../questionBanks'
import type { GroupId } from '../types'

const Step1FinanceLabour: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('financialManagement', el)}
            title="SMME Financial Management"
            baseKey="financialManagement.q"
            questions={financialManagement}
            disabled={disabled}
            firstInStep
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('labourHSE', el)}
            title="Labour / HSE Compliance"
            baseKey="labourHSE"
            questions={labourHSE}
            disabled={disabled}
        />
    </>
)

export default Step1FinanceLabour
