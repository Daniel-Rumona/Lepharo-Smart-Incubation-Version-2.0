import type { FeatureGovernanceRecord } from '@/types/featureGovernance'

/*
 * Who may see and change a feature record (featureGovernance). firestore.rules
 * enforces the same model; keep the two in step.
 *
 * - The governance owner sees and edits everything, and is the only person who
 *   assigns or shares a record.
 * - Anyone else sees only records they logged, were assigned, or were shared.
 *   The person who logged a record edits and deletes it; assignees update its
 *   delivery (status, progress, dates); people it is shared with only view it.
 */

/** The main admin. firestore.rules repeats this address in isGovernanceOwner(). */
export const GOVERNANCE_OWNER_EMAIL = 'daniel@quantilytix.co.za'

export const isGovernanceOwnerEmail = (email?: string | null) =>
    String(email || '').trim().toLowerCase() === GOVERNANCE_OWNER_EMAIL

export type FeatureAccess = 'owner' | 'creator' | 'assignee' | 'viewer' | 'none'

export const featureAccessFor = (
    record: Pick<FeatureGovernanceRecord, 'createdBy' | 'assigneeIds' | 'viewerIds'>,
    uid: string | undefined,
    isOwner: boolean
): FeatureAccess => {
    if (isOwner) return 'owner'
    if (!uid) return 'none'
    if (record.createdBy === uid) return 'creator'
    if (record.assigneeIds?.includes(uid)) return 'assignee'
    if (record.viewerIds?.includes(uid)) return 'viewer'
    return 'none'
}

/** Everyone a record is visible to besides the owner: one array, so "records I can see" is a single query. */
export const accessIdsFor = (createdBy: string | undefined, assigneeIds: string[] = [], viewerIds: string[] = []) =>
    [...new Set([createdBy, ...assigneeIds, ...viewerIds].filter((id): id is string => !!id))]

/** The fields an assignee may change; firestore.rules allows exactly these. */
export const ASSIGNEE_FIELDS = ['status', 'progress', 'completedAt', 'dueDate', 'updatedAt'] as const
