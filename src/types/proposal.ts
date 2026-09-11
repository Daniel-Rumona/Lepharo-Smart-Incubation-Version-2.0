import type { Timestamp } from 'firebase/firestore'

export const PROPOSAL_CATEGORIES = [
    'Strategic',
    'RFQ',
    'RFP',
    'Tender',
    'Unsolicited'
] as const

export const PROPOSAL_SCOPES = [
    'National',
    'Provincial',
    'Centre-specific',
    'Municipality',
    'Private company'
] as const

export const PROPOSAL_STATUSES = [
    'Draft',
    'In preparation',
    'Submitted',
    'Under review',
    'Accepted',
    'SLA signed',
    'Awaiting order number',
    'Implementation planning',
    'Ready for activation',
    'Active',
    'Rejected',
    'Archived'
] as const

export type ProposalCategory = typeof PROPOSAL_CATEGORIES[number]
export type ProposalScope = typeof PROPOSAL_SCOPES[number]
export type ProposalStatus = typeof PROPOSAL_STATUSES[number]

export type ProposalReference = {
    id: string
    name: string
    province?: string | null
}

export type ProposalContributor = {
    id?: string | null
    name: string
    role: string
    email?: string | null
}

export type ProposalDocument = {
    id: string
    name: string
    category: string
    url: string
    storagePath: string
    size?: number | null
    contentType?: string | null
    version?: number
    status?: string
    uploadedAt?: Timestamp | Date | string | null
    uploadedBy?: ProposalContributor | null
}

export type ProposalHistoryEntry = {
    id: string
    action: string
    note?: string | null
    fromStatus?: ProposalStatus | null
    toStatus?: ProposalStatus | null
    createdAt?: Timestamp | Date | string | null
    createdBy?: ProposalContributor | null
}

export type Proposal = {
    id: string
    proposalNumber: string

    title: string
    clientName: string
    clientContact?: string | null
    clientEmail?: string | null
    category: ProposalCategory
    scope: ProposalScope
    province?: string | null
    allCentres?: boolean
    allDepartments?: boolean
    estimatedValue: number
    currency: 'ZAR'
    status: ProposalStatus
    description?: string | null
    originator: ProposalContributor
    owner: ProposalContributor
    contributors: ProposalContributor[]
    centres: ProposalReference[]
    departments: ProposalReference[]
    proposedDate?: Timestamp | Date | string | null
    submissionDeadline?: Timestamp | Date | string | null
    acceptedAt?: Timestamp | Date | string | null
    createdAt?: Timestamp | Date | string | null
    updatedAt?: Timestamp | Date | string | null
    createdBy?: ProposalContributor | null
    updatedBy?: ProposalContributor | null
    isArchived?: boolean
    legacy?: {
        branchId?: string | null
        funder?: string | null
        proposalDocUrl?: string | null
        proposalDocPath?: string | null
    }
}

export type ProposalInput = Omit<
    Proposal,
    | 'id'
    | 'proposalNumber'
    | 'currency'
    | 'createdAt'
    | 'updatedAt'
    | 'createdBy'
    | 'updatedBy'
    | 'legacy'
>

export type ProposalActor = {
    id: string
    name: string
    email?: string | null
    role?: string | null

    branchId?: string | null
}
