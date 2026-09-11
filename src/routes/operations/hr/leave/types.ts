import dayjs from 'dayjs'

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

export const countDaysInclusive = (fromISO: string, toISO: string) =>
    Math.max(1, dayjs(toISO).diff(dayjs(fromISO), 'day') + 1)

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
