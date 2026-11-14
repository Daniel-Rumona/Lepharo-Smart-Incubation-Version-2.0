import dayjs, { type Dayjs } from 'dayjs'
import type { Timestamp } from 'firebase/firestore'

/**
 * Team Workroom task model. Field names, status values and the assignee shape
 * are shared with the coordinator's own page (CoordinatorTaskUpdate.tsx), so
 * keep them compatible.
 */
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type Status = 'todo' | 'in_progress' | 'done' | 'cancelled'

export type Assignment = {
    userId: string
    branchId?: string | null
    departmentId?: string | null
}

export type TaskDoc = {
    title: string
    description: string
    programId: string
    departmentId: string
    priority: Priority
    status: Status
    startAt?: Timestamp | null
    dueAt?: Timestamp | null
    createdAt?: any
    updatedAt?: any
    createdBy?: string
    assignees?: Assignment[]
    interventionId?: string | null
    /** Copy of the linked intervention's title, for viewers who can't read interventions. */
    interventionTitle?: string | null
    completedAt?: any
    archived?: boolean
    archivedAt?: any
    archivedBy?: string | null
    /** Written by coordinators on their own page. */
    progressPercent?: number
    coordinatorUpdates?: unknown[]
    currentBottleneck?: string | null
}

export type Task = TaskDoc & { id: string }

export type Program = { id: string; name: string }
export type Department = { id: string; name: string; isMain?: boolean }

/** A coordinator who can be assigned: their coordinators doc joined to their user by uid. */
export type Assignable = {
    /** The user's id (auth uid): what assignees[].userId stores. */
    userId: string
    /** Every id the coordinator is known by, to recognise older assignee entries. */
    keys: string[]
    name: string
    photo?: string
    departmentId: string
    branchId: string | null
    branchName?: string
    programIds: string[]
}

export type Person = { id: string; name: string; photo?: string }

export const STATUS_META: Record<Status, { label: string; color: string }> = {
    todo: { label: 'To do', color: 'default' },
    in_progress: { label: 'In progress', color: 'processing' },
    done: { label: 'Done', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'error' }
}

export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done', 'cancelled']

export const PRIORITY_META: Record<Priority, { label: string; color: string; rank: number }> = {
    urgent: { label: 'Urgent', color: 'red', rank: 0 },
    high: { label: 'High', color: 'orange', rank: 1 },
    medium: { label: 'Medium', color: 'blue', rank: 2 },
    low: { label: 'Low', color: 'green', rank: 3 }
}

export const PRIORITY_ORDER: Priority[] = ['urgent', 'high', 'medium', 'low']

export const safePriority = (p?: unknown): Priority => {
    const v = typeof p === 'string' ? p.toLowerCase().trim() : ''
    return (v in PRIORITY_META ? v : 'medium') as Priority
}

export const safeStatus = (s?: unknown): Status => {
    const v = typeof s === 'string' ? s.toLowerCase().trim() : ''
    return (v in STATUS_META ? v : 'todo') as Status
}

export const asDate = (x: any): Date | null => {
    if (!x) return null
    if (typeof x.toDate === 'function') return x.toDate()
    if (x instanceof Date) return x
    if (typeof x === 'number') return new Date(x)
    if (typeof x === 'string') {
        const d = new Date(x)
        return isNaN(d.getTime()) ? null : d
    }
    if (x.seconds != null) return new Date(x.seconds * 1000)
    return null
}

export const asDayjs = (x: any): Dayjs | null => {
    const d = asDate(x)
    return d ? dayjs(d) : null
}

export const isOpen = (t: Pick<Task, 'status'>) => t.status === 'todo' || t.status === 'in_progress'

/**
 * Due dates are date-only: a task is overdue only once its due day has ended,
 * so "due today" is never overdue.
 */
export const isOverdue = (t: Pick<Task, 'status' | 'dueAt'>, now: Dayjs = dayjs()) => {
    const due = asDayjs(t.dueAt)
    return !!due && isOpen(t) && now.isAfter(due.endOf('day'))
}

/** Whole calendar days past the due day (1 the day after it). */
export const overdueDays = (t: Pick<Task, 'dueAt'>, now: Dayjs = dayjs()) => {
    const due = asDayjs(t.dueAt)
    if (!due) return 0
    return Math.max(0, Math.floor(now.startOf('day').diff(due.startOf('day'), 'day')))
}

/** Short due-state text for an open task: "Overdue by 3 days", "Due today", "Due in 2 days". */
export const dueState = (t: Task, now: Dayjs = dayjs()): { text: string; color: string } | null => {
    const due = asDayjs(t.dueAt)
    if (!due || !isOpen(t)) return null
    if (isOverdue(t, now)) {
        const n = overdueDays(t, now)
        return { text: `Overdue by ${n} day${n === 1 ? '' : 's'}`, color: 'red' }
    }
    const left = due.startOf('day').diff(now.startOf('day'), 'day')
    if (left === 0) return { text: 'Due today', color: 'orange' }
    if (left === 1) return { text: 'Due tomorrow', color: 'gold' }
    return { text: `Due in ${left} days`, color: left <= 3 ? 'gold' : 'default' }
}

export const formatDay = (x: any) => {
    const d = asDayjs(x)
    return d ? d.format('D MMM YYYY') : '—'
}

/** When the task was finished: completedAt, else (older records) its last update. */
export const completedOn = (t: Task) => asDayjs(t.completedAt) || (t.status === 'done' ? asDayjs(t.updatedAt) : null)

/** A coordinator has started on it: they logged progress or an update. */
export const wasStarted = (t: Task) =>
    (typeof t.progressPercent === 'number' && t.progressPercent > 0) ||
    (Array.isArray(t.coordinatorUpdates) && t.coordinatorUpdates.length > 0)

export const isFunderRole = (role?: string) => {
    const r = String(role || '').toLowerCase().trim()
    return r === 'funder' || r === 'government'
}
