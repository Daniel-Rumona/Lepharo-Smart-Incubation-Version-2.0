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

/** Pipeline stages as shown to users; each groups one or more statuses. */
export const PROPOSAL_STAGE_GROUPS: ReadonlyArray<{
    label: string
    statuses: ReadonlyArray<typeof PROPOSAL_STATUSES[number]>
    color: string
}> = [
    { label: 'Draft', statuses: ['Draft', 'In preparation'], color: '#64748b' },
    { label: 'Submitted', statuses: ['Submitted'], color: '#2563eb' },
    { label: 'Under review', statuses: ['Under review'], color: '#7c3aed' },
    { label: 'Accepted', statuses: ['Accepted', 'SLA signed'], color: '#059669' },
    {
        label: 'Activation',
        statuses: ['Awaiting order number', 'Implementation planning', 'Ready for activation', 'Active'],
        color: '#d97706'
    }
]

export const PROPOSAL_OWNER_TYPES = ['Individual', 'Department', 'Centre'] as const

export type ProposalCategory = typeof PROPOSAL_CATEGORIES[number]
export type ProposalOwnerType = typeof PROPOSAL_OWNER_TYPES[number]
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

/**
 * A proposal is owned by a person, a department, or a centre. For department
 * and centre owners `id` is the department or branch id; legacy owners carry
 * no `type` and are treated as individuals.
 */
export type ProposalOwner = ProposalContributor & {
    type?: ProposalOwnerType
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
    owner: ProposalOwner
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
