// How the receptionist's inquiries list groups statuses, and what it says about
// each inquiry's follow-up, decided in one place (and tested).

import { dueLabel, followUpBucket, isEscalatedOpen, isOpenFollowUp } from './followUpBuckets'

export type InquiryTab = 'open' | 'new' | 'closed' | 'all'

/** Every inquiry status, in the order a receptionist meets them. */
export const INQUIRY_STATUSES = ['New', 'In Progress', 'Contacted', 'Converted', 'Resolved', 'Closed', 'Lost'] as const

/** Still being worked: a first reply or more is still owed. */
export const OPEN_STATUSES = ['New', 'In Progress', 'Contacted']
/** Finished, whichever way it went. */
export const CLOSED_STATUSES = ['Converted', 'Resolved', 'Closed', 'Lost']

/**
 * Which tabs an inquiry appears under. Every status lands in Open or Closed;
 * one this list does not know is treated as open, so it is never hidden.
 */
export function inquiryInTab(status: string, tab: InquiryTab): boolean {
    if (tab === 'all') return true
    if (tab === 'new') return status === 'New'
    const closed = CLOSED_STATUSES.includes(status)
    return tab === 'closed' ? closed : !closed
}

type ListFollowUp = {
    inquiryId: string
    status: string
    scheduledDate?: Date | null
    escalatedToUids?: string[] | null
    escalation?: { departmentName?: string } | null
}

export type InquiryFollowUpState = {
    label: string
    tone: 'overdue' | 'today' | 'upcoming' | 'escalated'
}

/**
 * The follow-up line for each inquiry with an open follow-up: "With Legal
 * Advisory" while a department holds it, otherwise when it is due. With
 * several open, the most pressing one shows (an escalation, then the earliest).
 */
export function followUpStateByInquiry(followUps: ListFollowUp[], now: Date): Map<string, InquiryFollowUpState> {
    const best = new Map<string, ListFollowUp>()
    const rank = (f: ListFollowUp) => (isEscalatedOpen(f) ? -Infinity : f.scheduledDate?.getTime() ?? Infinity)
    followUps.filter(isOpenFollowUp).forEach(f => {
        const current = best.get(f.inquiryId)
        if (!current || rank(f) < rank(current)) best.set(f.inquiryId, f)
    })

    const states = new Map<string, InquiryFollowUpState>()
    best.forEach((f, inquiryId) => {
        if (isEscalatedOpen(f)) {
            states.set(inquiryId, { label: `With ${f.escalation?.departmentName || 'a department'}`, tone: 'escalated' })
            return
        }
        const bucket = followUpBucket(f, now)
        states.set(inquiryId, {
            label: dueLabel(f.scheduledDate, now),
            tone: bucket === 'overdue' ? 'overdue' : bucket === 'today' ? 'today' : 'upcoming'
        })
    })
    return states
}
