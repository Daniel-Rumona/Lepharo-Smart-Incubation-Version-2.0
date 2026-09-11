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
}

export interface WorkflowQueryResponse {
    message: string
    attachmentUrl?: string | null
    respondedById?: string | null
    respondedBy?: WorkflowQueryActorSnapshot
    respondedAt: Timestamp
}

export interface WorkflowQueryResolution {
    notes?: string | null
    resolvedById?: string | null
    resolvedBy?: WorkflowQueryActorSnapshot
    resolvedAt: Timestamp
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
    createdAt: Timestamp
    updatedAt: Timestamp
    migration?: WorkflowQueryMigrationMetadata
}

export type WorkflowQueryDocument = Omit<WorkflowQuery, 'id'>
