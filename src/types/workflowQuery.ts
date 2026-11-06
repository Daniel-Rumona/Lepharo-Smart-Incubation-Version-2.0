import type { Timestamp } from 'firebase/firestore'

export const WORKFLOW_QUERIES_COLLECTION = 'workflowQueries' as const
export const WORKFLOW_QUERY_SCHEMA_VERSION = 2 as const

export type WorkflowQueryStatus = 'open' | 'answered' | 'resolved' | 'cancelled'

export type WorkflowQueryTargetType =
    | 'assigned-intervention'
    | 'intervention'
    | 'mov'
    | 'mov-pack'
    | 'poe'
    | 'completion'

export interface WorkflowQueryActorSnapshot {
    name?: string | null
    email?: string | null
    role?: string | null
    departmentId?: string | null
    departmentName?: string | null
}

export interface WorkflowQueryTarget {
    type: WorkflowQueryTargetType
    id: string
    parentType?: WorkflowQueryTargetType | null
    parentId?: string | null
}

export interface WorkflowQueryContext {
    participantId?: string | null
    interventionId?: string | null
    interventionTitle?: string | null
    movId?: string | null
    consolidatedMovId?: string | null
    movRowId?: string | null
    departmentName?: string | null
    evidenceUrl?: string | null
    lockedInPackAtCreation?: boolean | null
    /** SME delivery disputes: what the SME says was wrong. */
    disputeCategory?: string | null
}

export interface WorkflowQueryResponse {
    message: string
    attachmentUrl?: string | null
    /** Every file attached with the answer (attachmentUrl is the first). */
    attachmentUrls?: string[]
    /** An evidence query answered with an explanation only. */
    noNewEvidence?: boolean
    /** For delivery disputes: what the facilitator did (see DisputeOutcome). */
    outcome?: string | null
    respondedById?: string | null
    respondedBy?: WorkflowQueryActorSnapshot
    respondedAt: Timestamp
}

export interface WorkflowQueryResolution {
    notes?: string | null
    attachmentUrl?: string | null
    resolvedById?: string | null
    resolvedBy?: WorkflowQueryActorSnapshot
    resolvedAt: Timestamp
}

/**
 * One step in a query's life, oldest first: the facilitator answers, the
 * person who raised it accepts or sends it back, and so on.
 */
export interface WorkflowQueryThreadEntry {
    kind: 'answered' | 'sent-back' | 'accepted' | 'closed' | 'escalated' | 'decided'
    message?: string | null
    attachmentUrls?: string[]
    noNewEvidence?: boolean
    outcome?: string | null
    byId?: string | null
    by?: WorkflowQueryActorSnapshot
    at: Timestamp
}

export interface WorkflowQueryMigrationMetadata {
    sourceCollection: 'consultantQueries'
    sourceId: string
    sourcePath: string
    migratedAt: Timestamp
    warnings: string[]
}

export interface WorkflowQuery {
    id: string
    schemaVersion: typeof WORKFLOW_QUERY_SCHEMA_VERSION
    programId: string
    type: string
    message: string
    status: WorkflowQueryStatus
    raisedById: string
    raisedBy: WorkflowQueryActorSnapshot
    resolverId: string
    resolverProfileId?: string | null
    resolver: WorkflowQueryActorSnapshot
    assignedAt: Timestamp
    target: WorkflowQueryTarget
    context: WorkflowQueryContext
    response?: WorkflowQueryResponse
    resolution?: WorkflowQueryResolution
    thread?: WorkflowQueryThreadEntry[]
    /** The latest send-back, so the facilitator sees what still needs doing. */
    lastSentBack?: { notes: string; at: Timestamp; by?: WorkflowQueryActorSnapshot } | null
    sentBackCount?: number
    /** A delivery dispute escalated to the HOD, and their decision. */
    escalation?: { to: 'hod'; at: Timestamp; byId?: string | null; by?: WorkflowQueryActorSnapshot; decision?: 'sme' | 'facilitator' | null; decisionNotes?: string | null; decidedAt?: Timestamp | null; decidedBy?: WorkflowQueryActorSnapshot } | null
    createdAt: Timestamp
    updatedAt: Timestamp
    migration?: WorkflowQueryMigrationMetadata
}

export type WorkflowQueryDocument = Omit<WorkflowQuery, 'id'>
