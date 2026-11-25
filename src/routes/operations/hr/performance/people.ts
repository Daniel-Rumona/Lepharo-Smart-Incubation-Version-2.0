import dayjs from 'dayjs'
import { checkInCadence, reviewStage } from './ipm'
import type {
    CheckIn,
    CompactContent,
    EnhancementPlan,
    ItemRating,
    OutstandingAction,
    PerformanceCycle,
    PhaseKey,
    ReviewRecord,
    ReviewStage,
    Signoff
} from './ipm'
import type { NextStep } from './nextStep'

export type StaffMember = {
    id: string
    authUid?: string
    name?: string
    email?: string
    role?: string
    position?: string
    department?: string
    departmentId?: string | null
    branchId?: string | null
    status?: string
    lineManagerId?: string | null
}

export type LegacyCompact = {
    phase?: string
    ratings?: Record<string, ItemRating>
    overallSelfComment?: string
    overallManagerComment?: string
    createdAtText?: string
}

export type PerformanceCompact = CompactContent & {
    id: string
    signoff?: Signoff
    /** The employee's auth uid (employeeId on records that predate it). */
    employeeId: string
    cycleId?: string
    financialYear?: string
    status?: string
    createdAt?: unknown
    /** Saved before cycles existed; only used to seed a new compact. */
    legacy?: LegacyCompact
}

/** A staff member with everything the page shows about them in the selected cycle. */
export type Person = StaffMember & {
    uid: string
    isSelf: boolean
    canManage: boolean
    compact?: PerformanceCompact
    records: Partial<Record<PhaseKey, ReviewRecord>>
    /** The annual rating after calibration, or null while unrated. */
    score: number | null
    checkIns: CheckIn[]
    plans: EnhancementPlan[]
    actions: OutstandingAction[]
    step: NextStep | null
}

const ROLE_LABELS: Record<string, string> = {
    operations: 'Head of Department',
    projectadmin: 'Centre Coordinator',
    coordinator: 'Coordinator',
    receptionist: 'Receptionist',
    employee: 'Employee',
    auxiliary: 'Auxiliary',
    hr: 'HR',
    director: 'CEO'
}

export const cleanRole = (role?: string) => String(role || '').toLowerCase().replace(/\s+/g, '')

/** Position and role, without repeating the same word twice. */
export const roleLine = (person: Pick<StaffMember, 'position' | 'role'>) =>
    [person.position, ROLE_LABELS[cleanRole(person.role)] || person.role]
        .filter((v): v is string => !!v)
        .filter((v, i, all) => all.findIndex(other => other.toLowerCase() === v.toLowerCase()) === i)
        .join(' · ')

export const initialsOf = (name?: string) => {
    const parts = String(name || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
    return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
}

const STAGE_TEXT: Record<ReviewStage, string> = {
    self: 'Self-assessment',
    manager: 'Manager assessing',
    discussion: 'To discuss and sign',
    disputed: 'Disputed',
    calibration: 'With HR',
    validation: 'Awaiting CEO',
    validated: 'Final'
}

/** Where a review stands, or when its window opens. */
export function reviewText(cycle: PerformanceCycle, phase: PhaseKey, record?: ReviewRecord | null, today = dayjs().format('YYYY-MM-DD')) {
    const window = cycle.windows[phase]
    if (today < window.from && !record) return `Opens ${dayjs(window.from).format('D MMM')}`
    return STAGE_TEXT[reviewStage(record)]
}

export function checkInText(checkIns: Pick<CheckIn, 'date'>[], today = dayjs().format('YYYY-MM-DD')) {
    const cadence = checkInCadence(checkIns.map(c => c.date), today)
    if (!cadence.lastDate) return { text: 'None yet', due: cadence.due }
    return { text: cadence.daysSince === 0 ? 'Today' : `${cadence.daysSince} days ago`, due: cadence.due }
}
