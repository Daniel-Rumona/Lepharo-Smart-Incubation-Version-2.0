export type QA = { answer?: string; comment?: string }

export type StepMeta = { short: string; description: string; subpoints?: string[] }

export type GroupId =
    | 'marketingCommunication'
    | 'psychometric'
    | 'financialManagement'
    | 'labourHSE'
    | 'wellness'
    | 'legal'
    | 'marketLinkage'
    | 'qualityManagement'
    | 'trainingNeeds'

export type GroupMeta = {
    id: GroupId
    title: string
    step: number
    questionCount: number
}

export type FlowDirection = 'forward' | 'backward'
