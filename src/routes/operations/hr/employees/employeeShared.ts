import dayjs from 'dayjs'

export type EmployeeWorkerType = 'intern' | 'permanent'
export type EmployeeStatus = 'Active' | 'Inactive'

export type EmployeeRow = {
    id: string
    authUid: string
    name: string
    email?: string
    role?: string
    position: string
    workerType: EmployeeWorkerType
    startDate?: string
    endDate?: string | null
    /** Name stored on the user doc; only a fallback when the id no longer resolves. */
    storedDepartmentName?: string
    departmentId?: string | null
    branchId?: string | null
    status: EmployeeStatus
    lineManagerId?: string | null
    lineManagerSource: 'default' | 'manual'
}

export type NamedOption = { id: string; name: string }

export type TimesheetEntry = {
    id: string
    date: string
    userId: string
    checkIn?: string
    checkOut?: string
    status: 'checked_in' | 'checked_out' | 'on_break'
    location?: string
    locationLabel?: string
    locationAccuracy?: number
    autoClockedOut?: boolean
    hoursWorked?: string
    lateBy?: string
    overtime?: string
}

/** Values the add/edit form produces. */
export type EmployeeFormValues = {
    name: string
    email: string
    role?: string
    position: string
    workerType: EmployeeWorkerType
    departmentId?: string
    branchId?: string
    startDate?: dayjs.Dayjs | null
    endDate?: dayjs.Dayjs | null
    active: boolean
    /** Required when an edit turns an active login off; written to the audit log. */
    disableReason?: string
    /** '' means the automatic default. */
    lineManagerId?: string
}

/** Roles HR can create from this page, keyed by stored role. */
export const CREATABLE_ROLES: { value: string; label: string }[] = [
    { value: 'operations', label: 'Head Of Department' },
    { value: 'projectadmin', label: 'Centre Coordinator' },
    { value: 'coordinator', label: 'Coordinator' },
    { value: 'receptionist', label: 'Receptionist' },
    { value: 'employee', label: 'Employee' }
]

const ROLE_LABELS: Record<string, string> = {
    operations: 'Head Of Department',
    projectadmin: 'Centre Coordinator',
    coordinator: 'Coordinator',
    consultant: 'Coordinator',
    receptionist: 'Receptionist',
    receiptionist: 'Receptionist',
    employee: 'Employee',
    auxiliary: 'Employee',
    hr: 'HR',
    director: 'CEO'
}

export function roleLabel(role?: string): string {
    const key = String(role || '').toLowerCase()
    if (ROLE_LABELS[key]) return ROLE_LABELS[key]
    return key ? titleCase(key) : '—'
}

function titleCase(value: string) {
    return value
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

const BRANCH_ROLES = ['employee', 'auxiliary', 'projectadmin', 'coordinator', 'consultant']
const DEPARTMENT_ROLES = ['operations', 'coordinator', 'consultant']

export const roleNeedsBranch = (role?: string) => BRANCH_ROLES.includes(String(role || '').toLowerCase())
export const roleNeedsDepartment = (role?: string) =>
    DEPARTMENT_ROLES.includes(String(role || '').toLowerCase())

export function resolvePosition(role?: string, position?: string, jobTitle?: string): string {
    return String(position || '').trim() || String(jobTitle || '').trim() || roleLabel(role)
}

export const formatWorkerType = (workerType?: string) => (workerType === 'intern' ? 'Intern' : 'Permanent')

export const normalizePositionLabel = (position: string) => position.trim().replace(/\s+/g, ' ')

export const normalizePositionKey = (position: string) =>
    position
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

/** Hidden @quantilytix.co.za control logins are not real staff. */
export const isControlEmail = (email?: string) => String(email || '').toLowerCase().endsWith('@quantilytix.co.za')

export function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
    return chunks
}

export const uniqueStrings = (values: Array<string | undefined | null>) =>
    [...new Set(values.filter((v): v is string => Boolean(v)))]

/** Minutes in a duration like "2h 15m", "45m" or "3h". */
export function durationMinutes(value?: string): number {
    if (!value) return 0
    const hours = /(\d+)\s*h/.exec(value)
    const minutes = /(\d+)\s*m/.exec(value)
    return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
}

export function formatMinutes(total: number): string {
    return `${Math.floor(total / 60)}h ${total % 60}m`
}

export const toIsoDate = (value?: dayjs.Dayjs | null) => (value ? value.format('YYYY-MM-DD') : null)

export const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback
