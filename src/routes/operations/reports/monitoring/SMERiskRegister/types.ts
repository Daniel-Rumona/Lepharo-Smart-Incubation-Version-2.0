export type Props = {
    programId?: string
    parentPadding?: number
}

export type AnyDoc = Record<string, any>

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical'
export type InactivityBucket = 'Never Serviced' | '1 Month' | '3 Months' | '6 Months' | 'Recently Serviced'
export type ServiceRecencyFilter = 'all' | 'one_month' | 'three_months' | 'six_months' | 'never_serviced'

export type DepartmentAction = {
    assignmentId: string
    interventionId?: string
    title: string
    status: string
    bottleneck: string
    cycleKey?: string | null
    consultantName?: string
    date: Date | null
    progress?: number
}

export type ServiceProgressRow = {
    key: string
    expectedTitle: string
    action?: DepartmentAction
    isExpected: boolean
    consultantName?: string
    cycleKey?: string | null
    progress?: number
    date: Date | null
}

export type CommunicationAttempt = {
    channel?: string
    attemptedAt?: any
    items?: string[]
    notes?: string
}

export type OperationalChallenge = {
    id: string
    programId?: string | null
    departmentId?: string | null
    title?: string
    details?: string
    status?: string
    dueDate?: any
    smeIds?: string[]
    mitigationSteps?: string[]
    communicationAttempts?: CommunicationAttempt[]
    createdAt?: any
    updatedAt?: any
}

export type DepartmentSummary = {
    departmentId: string
    departmentName: string
    deptConfirmed: boolean
    smmeConfirmed: boolean
    expectedInterventionIds: string[]
    expectedInterventionTitles: string[]
    servicedCount: number
    completedCount: number
    pendingCount: number
    declinedCount: number
    latestServiceDate: Date | null
    actions: DepartmentAction[]
}

export type SMERow = {
    key: string
    participantId: string
    applicationId?: string
    programId?: string

    smeName: string
    ownerName?: string
    currentGroup?: string
    status?: string
    dateJoined: Date | null

    docsCompleted: number
    docsTotal: number
    docsMissing: number
    docsPending: number
    docsQueried: number
    docsRejected: number

    expectedDepartments: DepartmentSummary[]
    servicedDepartments: DepartmentSummary[]
    missingDepartments: DepartmentSummary[]

    expectedDepartmentsCount: number
    servicedDepartmentsCount: number
    missingDepartmentsCount: number
    deptConfirmedCount: number
    smmeConfirmedCount: number
    fullyConfirmedDepartmentsCount: number

    totalExpectedInterventions: number
    totalTouches: number
    completedTouches: number
    pendingTouches: number
    declinedTouches: number
    smePendingAcceptanceCount: number
    smePendingConfirmationCount: number
    responsivenessRiskDepartments: string[]

    lastInterventionDate: Date | null
    daysSinceLastService: number | null
    inactivityBucket: InactivityBucket

    riskScore: number
    riskLevel: RiskLevel
    riskBreakdown: { label: string; delta: number }[]
    notes: string[]
    noServiceReasons: string[]
    hasAccessedSystem: boolean
    lastSystemAccessDate: Date | null
}

export type RiskScoreInputs = {
    daysSinceLastService: number | null
    hasNeverReceivedService: boolean
    docsMissing: number
    docsQueried: number
    docsRejected: number
    missingDepartmentsCount: number
    smePendingAcceptanceCount: number
    smePendingConfirmationCount: number
    declinedTouches: number
}

export type RiskScoreResult = {
    score: number
    level: RiskLevel
    breakdown: { label: string; delta: number }[]
}

export type ReminderEmailLog = {
    id: string
    type?: string
    to?: string
    subject?: string
    status?: 'sent' | 'failed'
    error?: string | null
    messageId?: string | null
    participantId?: string | null
    programId?: string | null
     | null
    createdAt: Date | null
}

export type BounceStatus = {
    to: string
    reason: string
    participantId?: string | null
    lastError?: string | null
    updatedAt: Date | null
}
