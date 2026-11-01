import dayjs from 'dayjs'
import { isSouthAfricanPublicHoliday } from '@/utils/southAfricanPublicHolidays'

export type LeaveType =
    | 'annual'
    | 'sick'
    | 'family'
    | 'study'
    | 'maternity'
    | 'parental'
    | 'personal' // legacy safety

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export type LeaveRequest = {
    id: string
    employeeId: string
    employeeEmail?: string
    employeeName?: string
    employeePhoto?: string

    type: LeaveType
    reason: string
    from: string // 'YYYY-MM-DD'
    to: string // 'YYYY-MM-DD'
    days: number
    status: LeaveStatus
    appliedDate: string // 'YYYY-MM-DD'
    approvedBy?: string
    approvedDate?: string
    rejectionReason?: string
}

export type LeaveSettings = {
    type: 'leave'

    caps: {
        annual: number
        sick: { per12: number; per24: number }
        family: number
        study: number
        maternity: number
        parental: number
    }
    sickProofAfterDays: number
    autoApproveHalfDay: boolean
    blackoutDates: string[] // 'YYYY-MM-DD'
}

export type Employee = {
    id: string // uid
    name?: string
    email?: string
    role?: string
    branchId?: string
    departmentId?: string
    branchName?: string
    departmentName?: string
    photoURL?: string

    active?: boolean
}

/**
 * Leave days between two dates, both included: working days only, so
 * weekends and South African public holidays aren't taken from the balance.
 */
export const countLeaveDays = (fromISO: string, toISO: string) => {
    const end = dayjs(toISO)
    let count = 0
    for (let d = dayjs(fromISO).startOf('day'); !d.isAfter(end, 'day'); d = d.add(1, 'day')) {
        const weekday = d.day()
        if (weekday !== 0 && weekday !== 6 && !isSouthAfricanPublicHoliday(d.toDate())) count += 1
    }
    return count
}

export const typeLabel = (t: LeaveType) =>
    t === 'annual'
        ? 'Annual'
        : t === 'sick'
            ? 'Sick'
            : t === 'family'
                ? 'Family'
                : t === 'study'
                    ? 'Study'
                    : t === 'maternity'
                        ? 'Maternity'
                        : t === 'parental'
                            ? 'Parental'
                            : 'Personal'
