import React from 'react'
import QuestionGroup from '../components/QuestionGroup'
import { marketLinkage, qualityManagement } from '../questionBanks'
import type { GroupId } from '../types'

const Step3MarketQuality: React.FC<{
    disabled?: boolean
    registerGroupRef?: (id: GroupId, el: HTMLDivElement | null) => void
}> = ({ disabled, registerGroupRef }) => (
    <>
        <QuestionGroup
            ref={el => registerGroupRef?.('marketLinkage', el)}
            title="Market Linkage"
            baseKey="marketLinkage"
            questions={marketLinkage}
            disabled={disabled}
            firstInStep
        />
        <QuestionGroup
            ref={el => registerGroupRef?.('qualityManagement', el)}
            title="SMME Quality Management"
            baseKey="qualityManagement"
            questions={qualityManagement}
            disabled={disabled}
        />
    </>
)

export default Step3MarketQuality
