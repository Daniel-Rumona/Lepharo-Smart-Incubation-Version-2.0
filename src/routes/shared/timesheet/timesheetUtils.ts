import { BranchDayHours } from '@/utils/branchOperatingHours'

export interface TimesheetEntry {
    branchId?: string
    scheduledHours?: BranchDayHours
    id?: string
    date: string
    userId: string
    checkIn?: string
    checkOut?: string
    status: 'checked_in' | 'checked_out' | 'on_break'
    location?: string
    locationLabel?: string
    latitude?: number
    longitude?: number
    locationAccuracy?: number
    locationVerified?: boolean
    locationQuality?: 'high' | 'medium' | 'low' | 'unavailable'
    detectedLocationLabel?: string
    centerMatched?: boolean
    autoClockedOut?: boolean
    autoClockedOutAt?: any
    autoClockOutReason?: string
    auditFlag?: string
    locationCaptureFailed?: boolean
    locationFailureReason?: string
    hoursWorked?: string
    lateBy?: string
    overtime?: string
    overtimeReason?: string
    overtimeRequestedAt?: string
    overtimeLocationVerified?: boolean
    overtimeApprovalStatus?: 'pending' | 'approved' | 'rejected'
    overtimeDecisionByName?: string
    overtimeDecisionNote?: string
    breaks?: { start: string; end?: string }[]
    breakMinutes?: number
}

export interface LeaveRequestEntry {
    id?: string
    employeeId: string
    type: string
    from: string
    to: string
    days?: number
    status: 'pending' | 'approved' | 'rejected'
    reason?: string
}

export const isLeaveCoveringDate = (leave: LeaveRequestEntry, dateStr: string) =>
    leave.status === 'approved' && dateStr >= leave.from && dateStr <= leave.to

export const getLeaveTypeLabel = (type: string) => {
    switch (type) {
        case 'annual':
            return 'Annual Leave'
        case 'sick':
            return 'Sick Leave'
        case 'personal':
            return 'Personal Leave'
        default:
            return type
    }
}

export const parseClockTimeToMinutes = (value?: string) => {
    if (!value || value === '-') return null

    const cleaned = value.trim()
    const match = cleaned.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i)
    if (!match) return null

    let hour = Number(match[1])
    const minute = Number(match[2])
    const meridian = match[3]?.toUpperCase()

    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return null
    }

    if (meridian) {
        if (hour < 1 || hour > 12) return null
        if (meridian === 'PM' && hour < 12) hour += 12
        if (meridian === 'AM' && hour === 12) hour = 0
    } else if (hour < 0 || hour > 23) {
        return null
    }

    return hour * 60 + minute
}

export const calculateWorkedMinutes = (checkIn?: string, checkOut?: string) => {
    const checkInMinutes = parseClockTimeToMinutes(checkIn)
    const checkOutMinutes = parseClockTimeToMinutes(checkOut)

    if (checkInMinutes === null || checkOutMinutes === null) return 0

    let totalMinutes = checkOutMinutes - checkInMinutes

    // Supports a shift that ends after midnight without turning it into zero.
    if (totalMinutes < 0) totalMinutes += 24 * 60

    return Math.max(0, totalMinutes)
}

export const parseHoursStringToMinutes = (value?: string) => {
    if (!value) return 0
    const match = /(\d+)h\s+(\d+)m/.exec(value)
    if (!match) return 0
    return Number(match[1]) * 60 + Number(match[2])
}

export const formatMinutes = (totalMinutes: number) => {
    const safe = Math.max(0, totalMinutes)
    const h = Math.floor(safe / 60)
    const m = safe % 60
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

export const diffMinutesFromTime = (from?: string, toDate: Date = new Date()) => {
    const startMinutes = parseClockTimeToMinutes(from)
    if (startMinutes === null) return 0

    const currentMinutes = toDate.getHours() * 60 + toDate.getMinutes()
    let difference = currentMinutes - startMinutes

    if (difference < 0) difference += 24 * 60

    return Math.max(0, difference)
}

export const getEntryWorkedMinutes = (row: TimesheetEntry, now = new Date()) => {
    const savedMinutes = parseHoursStringToMinutes(row.hoursWorked)
    if (savedMinutes > 0) return savedMinutes

    if (
        (row.status === 'checked_in' || row.status === 'on_break') &&
        row.checkIn
    ) {
        return diffMinutesFromTime(row.checkIn, now)
    }

    if (row.checkIn && row.checkOut && row.checkOut !== '-') {
        return calculateWorkedMinutes(row.checkIn, row.checkOut)
    }

    return 0
}

export const getEntryBreakMinutes = (row: TimesheetEntry, now = new Date()) => {
    const breaks = row.breaks || []
    return breaks.reduce((sum, b) => {
        if (b.end) return sum + calculateWorkedMinutes(b.start, b.end)
        if (row.status === 'on_break') return sum + diffMinutesFromTime(b.start, now)
        return sum
    }, 0)
}

export const dateKey = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}
