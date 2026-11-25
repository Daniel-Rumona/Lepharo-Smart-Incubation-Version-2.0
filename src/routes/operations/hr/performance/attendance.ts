import dayjs from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

/**
 * Attendance over the last 30 days, shown in the compact as supporting
 * evidence only: it never sets or suggests a rating.
 */

type TimesheetEntry = {
    userId?: string
    date?: string
    checkOut?: string
    status?: string
    hoursWorked?: string
    lateBy?: string
}

type LeaveRequest = {
    employeeId?: string
    from?: string
    to?: string
    status?: string
}

type StaffKey = { id: string; authUid?: string }

const WINDOW_DAYS = 30

const minutesOf = (value?: string) => {
    if (!value) return 0
    const hours = Number(/(\d+)h/.exec(value)?.[1] || 0)
    const minutes = Number(/(\d+)m/.exec(value)?.[1] || 0)
    return hours * 60 + minutes
}

function businessDaysBetween(start: dayjs.Dayjs, end: dayjs.Dayjs) {
    let cursor = start.startOf('day')
    let count = 0
    while (cursor.isBefore(end, 'day') || cursor.isSame(end, 'day')) {
        const day = cursor.day()
        if (day !== 0 && day !== 6) count += 1
        cursor = cursor.add(1, 'day')
    }
    return count
}

function leaveDaysWithin(leave: LeaveRequest, start: dayjs.Dayjs, end: dayjs.Dayjs) {
    if (!leave.from || !leave.to) return 0
    const from = dayjs(leave.from).isAfter(start) ? dayjs(leave.from) : start
    const to = dayjs(leave.to).isBefore(end) ? dayjs(leave.to) : end
    if (!from.isValid() || !to.isValid() || to.isBefore(from)) return 0
    return businessDaysBetween(from, to)
}

function attendanceSignals(timesheets: TimesheetEntry[], leaves: LeaveRequest[], start: dayjs.Dayjs, end: dayjs.Dayjs) {
    const leaveDays = leaves
        .filter(leave => String(leave.status || '').toLowerCase() === 'approved')
        .reduce((sum, leave) => sum + leaveDaysWithin(leave, start, end), 0)
    const expected = Math.max(businessDaysBetween(start, end) - leaveDays, 0)
    const attended = new Set<string>()
    const late = new Set<string>()
    const completed = new Set<string>()
    timesheets.forEach(row => {
        if (!row.date) return
        attended.add(row.date)
        if (minutesOf(row.lateBy) > 0) late.add(row.date)
        if (row.checkOut || row.status === 'checked_out' || minutesOf(row.hoursWorked) > 0) completed.add(row.date)
    })
    return [
        `${attended.size}/${expected} expected days attended`,
        `${late.size} late day${late.size === 1 ? '' : 's'}`,
        `${completed.size} completed checkout${completed.size === 1 ? '' : 's'}`,
        leaveDays ? `${leaveDays} approved leave day${leaveDays === 1 ? '' : 's'} excluded` : ''
    ].filter(Boolean)
}

/** Attendance signals per staff member (keyed by users doc id) for the last 30 days. */
export async function loadAttendanceEvidence(staff: StaffKey[]): Promise<Record<string, string[]>> {
    if (!staff.length) return {}
    const end = dayjs().endOf('day')
    const start = dayjs().subtract(WINDOW_DAYS - 1, 'day').startOf('day')
    const startKey = start.format('YYYY-MM-DD')
    const endKey = end.format('YYYY-MM-DD')
    const byKey = new Map<string, StaffKey>()
    staff.forEach(person => {
        byKey.set(person.id, person)
        if (person.authUid) byKey.set(person.authUid, person)
    })

    let timesheets: TimesheetEntry[]
    try {
        const snap = await getDocs(query(collection(db, 'timesheets'), where('date', '>=', startKey), where('date', '<=', endKey)))
        timesheets = snap.docs.map(d => d.data() as TimesheetEntry)
    } catch {
        // Without access to everyone's timesheets, read each person's own.
        const perPerson = await Promise.all(
            [...byKey.keys()].map(async id => {
                const snap = await getDocs(
                    query(collection(db, 'timesheets'), where('userId', '==', id), where('date', '>=', startKey), where('date', '<=', endKey))
                )
                return snap.docs.map(d => d.data() as TimesheetEntry)
            })
        )
        timesheets = perPerson.flat()
    }
    const leaves = (await getDocs(collection(db, 'leaveRequests'))).docs.map(d => d.data() as LeaveRequest)

    const grouped = new Map<string, { timesheets: TimesheetEntry[]; leaves: LeaveRequest[] }>()
    const groupFor = (key?: string) => {
        const person = byKey.get(String(key || ''))
        if (!person) return null
        const group = grouped.get(person.id) || { timesheets: [], leaves: [] }
        grouped.set(person.id, group)
        return group
    }
    timesheets.forEach(row => groupFor(row.userId)?.timesheets.push(row))
    leaves.forEach(leave => groupFor(leave.employeeId)?.leaves.push(leave))

    return Object.fromEntries(
        staff.map(person => {
            const group = grouped.get(person.id) || { timesheets: [], leaves: [] }
            return [person.id, attendanceSignals(group.timesheets, group.leaves, start, end)]
        })
    )
}
