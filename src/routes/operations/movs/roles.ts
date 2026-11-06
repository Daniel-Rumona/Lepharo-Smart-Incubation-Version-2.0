import type { MovStatus, PackStage } from './movData'

/**
 * Everyone who works on MOVs uses the same workspace; the role decides what
 * they see first and what they can do:
 *   facilitator  their own MOVs: add evidence, answer queries
 *   hod          the department's MOVs: approve, query, decide disputes, submit monthly packs
 *   cc           the programme's monthly packs: query, then confirm
 *   me           the programme's monthly packs: query, check each MOV, then validate
 */
export type MovRole = 'facilitator' | 'hod' | 'cc' | 'me'

type RoleConfig = {
    /** MOVs, monthly packs, or both. */
    views: ('movs' | 'packs')[]
    /** The status shown first. */
    firstMovStatus: MovStatus | 'all'
    firstPackStage: PackStage | 'all'
    movLabels: Partial<Record<MovStatus, string>>
    packLabels: Partial<Record<PackStage, string>>
    emptyMovs: string
    emptyPacks: string
}

export const ROLE_CONFIG: Record<MovRole, RoleConfig> = {
    facilitator: {
        views: ['movs'],
        firstMovStatus: 'queried',
        firstPackStage: 'all',
        movLabels: { queried: 'Needs your answer', review: 'With the HOD' },
        packLabels: {},
        emptyMovs: 'No MOVs need your answer.',
        emptyPacks: ''
    },
    hod: {
        views: ['movs', 'packs'],
        firstMovStatus: 'review',
        firstPackStage: 'all',
        movLabels: {},
        packLabels: {},
        emptyMovs: 'Nothing to review right now.',
        emptyPacks: 'No monthly packs submitted yet.'
    },
    cc: {
        views: ['packs'],
        firstMovStatus: 'all',
        firstPackStage: 'cc',
        movLabels: {},
        packLabels: { cc: 'To confirm', me: 'With M&E' },
        emptyMovs: '',
        emptyPacks: 'No monthly packs have been submitted for this programme yet.'
    },
    me: {
        views: ['packs'],
        firstMovStatus: 'all',
        firstPackStage: 'me',
        movLabels: {},
        packLabels: { cc: 'With the CC', me: 'To validate' },
        emptyMovs: '',
        emptyPacks: 'No monthly packs have been submitted for this programme yet.'
    }
}

/**
 * Which stage of the pack a query belongs to: raised by the CC, or by M&E.
 * An operations user in M&E is M&E, not a department HOD.
 */
export const queryStage = (q: any, isMonitoringDepartment: (departmentId?: string | null) => boolean): 'cc' | 'me' | null => {
    const role = String(q?.raisedByRole || q?.raisedBy?.role || '').toLowerCase()
    if (role === 'projectadmin') return 'cc'
    if (q?.context?.packStage === 'me' || isMonitoringDepartment(q?.raisedBy?.departmentId)) return 'me'
    return null
}
