import type { ActionKind, OutstandingAction, PhaseKey } from './ipm'

/**
 * One "next step" per person: of everything outstanding for them (see
 * outstandingActions in ipm.ts), the one the viewer should see first, said in
 * plain words, and where clicking it goes.
 */

export type Viewer = { uid: string; isHr: boolean; isCeo: boolean }

/** The person the step is about: who they are and who manages them. */
export type StepSubject = { uid: string; name: string; lineManagerId?: string | null; isSelf: boolean }

export type StepTarget = 'compact' | 'review' | 'check-ins' | 'calibration' | 'employees'

export type NextStep = {
    action: OutstandingAction
    text: string
    /** The viewer is the one who has to act. */
    mine: boolean
    overdue: boolean
    target: StepTarget
}

const PHASE_WORDS: Record<PhaseKey, string> = { midYear: 'mid-year', yearEnd: 'year-end' }

const STEP_WORDS: Record<ActionKind, string> = {
    'assign-manager': 'assign a line manager',
    'compact-manager': 'set up and sign the compact',
    'compact-employee': 'sign the compact',
    'compact-hr': 'check the signed compact',
    'check-in': 'hold a check-in',
    'book-review': 'book the review meeting',
    'self-assessment': 'self-assessment',
    'manager-assessment': 'manager assessment',
    'sign-review': 'sign the review',
    dispute: 'resolve the dispute',
    calibrate: 'calibrate the rating',
    validate: 'validate the rating'
}

const TARGETS: Record<ActionKind, StepTarget> = {
    'assign-manager': 'employees',
    'compact-manager': 'compact',
    'compact-employee': 'compact',
    'compact-hr': 'compact',
    'check-in': 'check-ins',
    'book-review': 'review',
    'self-assessment': 'review',
    'manager-assessment': 'review',
    'sign-review': 'review',
    dispute: 'review',
    calibrate: 'calibration',
    validate: 'calibration'
}

export function isViewersStep(action: OutstandingAction, subject: StepSubject, viewer: Viewer) {
    if (action.owner === 'employee') return subject.isSelf
    if (action.owner === 'manager') return !!viewer.uid && subject.lineManagerId === viewer.uid
    return action.owner === 'hr' ? viewer.isHr : viewer.isCeo
}

function ownerName(action: OutstandingAction, subject: StepSubject, nameOf: (uid: string) => string | undefined) {
    if (action.owner === 'employee') return subject.name
    if (action.owner === 'manager') return (subject.lineManagerId && nameOf(subject.lineManagerId)) || 'their line manager'
    return action.owner === 'hr' ? 'HR' : 'the CEO'
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The step to show: the viewer's own first, then anything overdue, then the rest in process order. */
export function nextStep(
    actions: OutstandingAction[],
    subject: StepSubject,
    viewer: Viewer,
    nameOf: (uid: string) => string | undefined
): NextStep | null {
    if (!actions.length) return null
    const mine = actions.filter(a => isViewersStep(a, subject, viewer))
    const action = mine.find(a => a.overdue) || mine[0] || actions.find(a => a.overdue) || actions[0]
    const isMine = mine.includes(action)
    const what = `${STEP_WORDS[action.kind]}${action.phase ? ` (${PHASE_WORDS[action.phase]})` : ''}`
    return {
        action,
        text: isMine ? capitalise(what) : `Waiting on ${ownerName(action, subject, nameOf)}: ${what}`,
        mine: isMine,
        overdue: !!action.overdue,
        target: TARGETS[action.kind]
    }
}
