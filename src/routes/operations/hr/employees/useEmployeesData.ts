import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, type DocumentData } from 'firebase/firestore'
import { db } from '@/firebase'
import { branchService } from '@/services/branchService'
import { isStaffRole } from '@/lib/roleLabels'
import {
    chunk,
    isControlEmail,
    normalizePositionKey,
    normalizePositionLabel,
    resolvePosition,
    uniqueStrings,
    type EmployeeRow,
    type NamedOption
} from './employeeShared'

export type ActivityStats = { pendingLeave: number; onLeaveToday: number; checkedInToday: number }

const displayName = (data: DocumentData) =>
    String(data.name || data.fullName || String(data.email || '').split('@')[0] || '').trim()

function toEmployee(id: string, data: DocumentData): EmployeeRow {
    return {
        id,
        authUid: String(data.uid || data.authUid || data.userId || id),
        name: displayName(data) || id,
        email: data.email || undefined,
        role: data.role,
        position: resolvePosition(data.role, data.position, data.jobTitle),
        workerType: (data.workerType || data.employmentType) === 'intern' ? 'intern' : 'permanent',
        startDate: data.startDate || undefined,
        endDate: data.endDate || data.internEndDate || null,
        storedDepartmentName: data.departmentName || data.department || undefined,
        departmentId: data.departmentId || null,
        branchId: typeof data.assignedBranch === 'string' ? data.assignedBranch : null,
        status: data.status === 'Inactive' ? 'Inactive' : 'Active',
        lineManagerId: data.lineManagerId || null,
        lineManagerSource: data.lineManagerSource === 'manual' ? 'manual' : 'default'
    }
}

async function loadStaff() {
    const [staffSnap, directorSnap] = await Promise.all([
        getDocs(
            query(
                collection(db, 'users'),
                where('role', 'not-in', ['incubatee', 'Incubatee', 'funder', 'system_admin', 'director'])
            )
        ),
        getDocs(query(collection(db, 'users'), where('role', '==', 'director')))
    ])
    const allStaff = staffSnap.docs.map(d => toEmployee(d.id, d.data())).filter(e => isStaffRole(e.role))
    const employees = allStaff.filter(e => !isControlEmail(e.email)).sort((a, b) => a.name.localeCompare(b.name))
    const directors: NamedOption[] = directorSnap.docs.map(d => ({ id: d.id, name: displayName(d.data()) || 'CEO' }))
    // A line manager can be someone the list hides (a control login), so names cover everyone.
    const names = new Map<string, string>(allStaff.map(e => [e.id, e.name]))
    directors.forEach(d => names.set(d.id, `${d.name} (CEO)`))
    return { employees, directors, names }
}

async function loadDepartments(): Promise<NamedOption[]> {
    const snap = await getDocs(collection(db, 'departments'))
    return snap.docs
        .map(d => ({ id: d.id, name: String(d.data().name || d.data().departmentName || '').trim(), active: d.data().isActive !== false }))
        .filter(dep => dep.active && dep.name)
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

async function loadBranches(): Promise<NamedOption[]> {
    const branches = await branchService.getAllBranches()
    return branches
        .map(branch => ({ id: branch.id, name: String(branch.name || '').trim() }))
        .filter(branch => branch.name)
        .sort((a, b) => a.name.localeCompare(b.name))
}

async function loadPositions(): Promise<string[]> {
    const snap = await getDocs(query(collection(db, 'hrPositions'), where('active', '==', true)))
    return snap.docs.map(d => normalizePositionLabel(String(d.data().label || ''))).filter(Boolean)
}

/** Leave and attendance figures for the listed staff only. */
async function loadActivity(staffIds: string[]): Promise<ActivityStats> {
    const today = dayjs().format('YYYY-MM-DD')
    const ids = new Set(staffIds)

    const leaveSnap = await getDocs(collection(db, 'leaveRequests'))
    const leaves = leaveSnap.docs.map(d => d.data()).filter(l => ids.has(String(l.employeeId || '')))
    const pendingLeave = leaves.filter(l => String(l.status || '').toLowerCase() === 'pending').length
    const onLeaveToday = new Set(
        leaves
            .filter(l => String(l.status || '').toLowerCase() === 'approved' && l.from && l.to)
            .filter(l => l.from <= today && today <= l.to)
            .map(l => String(l.employeeId))
    ).size

    const checkedIn = new Set<string>()
    const snaps = await Promise.all(
        chunk(staffIds, 30).map(group =>
            getDocs(query(collection(db, 'timesheets'), where('date', '==', today), where('userId', 'in', group)))
        )
    )
    snaps.forEach(snap =>
        snap.docs.forEach(d => {
            const entry = d.data()
            if (entry.checkIn && entry.checkIn !== '-') checkedIn.add(String(entry.userId))
        })
    )

    return { pendingLeave, onLeaveToday, checkedInToday: checkedIn.size }
}

export function useEmployeesData() {
    const [employees, setEmployees] = useState<EmployeeRow[]>([])
    const [directors, setDirectors] = useState<NamedOption[]>([])
    const [personNames, setPersonNames] = useState<Map<string, string>>(() => new Map())
    const [departments, setDepartments] = useState<NamedOption[]>([])
    const [branches, setBranches] = useState<NamedOption[]>([])
    const [savedPositions, setSavedPositions] = useState<string[]>([])
    const [lookupsLoading, setLookupsLoading] = useState(true)
    /** First load only; later reloads use `refreshing` so the table stays on screen. */
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activity, setActivity] = useState<ActivityStats | null>(null)
    const [activityLoading, setActivityLoading] = useState(false)

    const reloadActivity = useCallback(async (rows: EmployeeRow[]) => {
        setActivityLoading(true)
        try {
            setActivity(await loadActivity(uniqueStrings(rows.flatMap(e => [e.authUid, e.id]))))
        } catch (err) {
            console.warn('[EmployeesPage] leave/attendance figures skipped:', err)
            setActivity(null)
        } finally {
            setActivityLoading(false)
        }
    }, [])

    const reload = useCallback(async () => {
        setRefreshing(true)
        try {
            const result = await loadStaff()
            setEmployees(result.employees)
            setDirectors(result.directors)
            setPersonNames(result.names)
            setError(null)
            void reloadActivity(result.employees)
        } catch (err) {
            console.error('[EmployeesPage] staff load failed:', err)
            setError('Could not load staff. Check your connection and try again.')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [reloadActivity])

    useEffect(() => {
        void reload()
        Promise.allSettled([loadDepartments(), loadBranches(), loadPositions()]).then(
            ([deps, brs, positions]) => {
                if (deps.status === 'fulfilled') setDepartments(deps.value)
                else console.error('[EmployeesPage] departments failed:', deps.reason)
                if (brs.status === 'fulfilled') setBranches(brs.value)
                else console.error('[EmployeesPage] branches failed:', brs.reason)
                if (positions.status === 'fulfilled') setSavedPositions(positions.value)
                setLookupsLoading(false)
            }
        )
    }, [reload])

    /** Remember a position for the picker; skips the write when it is already saved. */
    const savePosition = useCallback(
        async (position: string) => {
            const label = normalizePositionLabel(position)
            const key = normalizePositionKey(label)
            if (!key || savedPositions.some(p => p.toLowerCase() === label.toLowerCase())) return
            try {
                await setDoc(
                    doc(db, 'hrPositions', key),
                    { key, label, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
                    { merge: true }
                )
                setSavedPositions(prev => [...prev, label])
            } catch (err) {
                console.warn('[EmployeesPage] position not saved to the picker:', err)
            }
        },
        [savedPositions]
    )

    return {
        employees,
        directors,
        personNames,
        departments,
        branches,
        savedPositions,
        lookupsLoading,
        loading,
        refreshing,
        error,
        activity,
        activityLoading,
        reload,
        reloadActivity: () => reloadActivity(employees),
        savePosition
    }
}
