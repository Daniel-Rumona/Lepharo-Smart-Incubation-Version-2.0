import {
    collection,
    getDocs,
    query,
    where,
    documentId
} from 'firebase/firestore'
import { db } from '@/firebase'

export type AttendanceScopedEmployee = {
    id: string
    authUid?: string
    uid?: string
    name?: string
    email?: string
    role?: string
    department?: string
    departmentId?: string
    assignedBranch?: string
    position?: string
}

type CurrentUser = {
    uid?: string
    email?: string
    role?: string

    departmentId?: string
    department?: string
    assignedBranch?: string
}

const getUserBranchId = (user?: CurrentUser | null) =>
    typeof user?.assignedBranch === 'string' ? user.assignedBranch.trim() : ''

const normalizeRole = (role?: string) => (role || '').trim().toLowerCase()

const isQuantilytixControlEmail = (email?: string) =>
    !!email && email.toLowerCase().endsWith('@quantilytix.co.za')

const canSeeDirectors = (currentUser?: CurrentUser | null) => {
    const role = normalizeRole(currentUser?.role)
    return role === 'admin' || role === 'director'
}

const canSeeControlAccounts = (currentUser?: CurrentUser | null) =>
    normalizeRole(currentUser?.role) === 'admin'

const applyVisibilityPostFilter = (
    rows: AttendanceScopedEmployee[],
    currentUser?: CurrentUser | null
) => {
    let next = [...rows]

    if (!canSeeControlAccounts(currentUser)) {
        next = next.filter(row => !isQuantilytixControlEmail(row.email))
    }

    if (!canSeeDirectors(currentUser)) {
        next = next.filter(row => normalizeRole(row.role) !== 'director')
    }

    return next
}

const mapUserDoc = (docSnap: any): AttendanceScopedEmployee => {
    const data = docSnap.data() || {}

    return {
        id: docSnap.id,
        authUid: data.uid || data.authUid || data.userId || docSnap.id,
        uid: data.uid || data.authUid || data.userId || docSnap.id,
        name: data.name || data.fullName || data.email?.split('@')[0] || '',
        email: data.email || '',
        role: data.role || '',
        department: data.department || data.departmentName || '',
        departmentId: data.departmentId || '',
        assignedBranch:
            typeof data.assignedBranch === 'string'
                ? data.assignedBranch.trim()
                : '',
        position: data.position || data.jobTitle || ''
    }
}

const dedupeEmployees = (rows: AttendanceScopedEmployee[]) => {
    const map = new Map<string, AttendanceScopedEmployee>()

    rows.forEach(row => {
        const key = row.authUid || row.uid || row.id
        if (!key) return
        map.set(key, row)
    })

    return [...map.values()]
}

async function getDepartmentIsMain(departmentId?: string): Promise<boolean> {
    if (!departmentId) return false

    const snap = await getDocs(
        query(collection(db, 'departments'), where(documentId(), '==', departmentId))
    )

    if (snap.empty) return false

    const dept = snap.docs[0].data() as any
    return !!dept?.isMain
}

async function fetchUsers() {
    const snap = await getDocs(
        query(collection(db, 'users'))
    )
    return snap.docs.map(mapUserDoc)
}

async function fetchUsersAndBranch(branchId: string) {
    const snap = await getDocs(
        query(
            collection(db, 'users'),
            where('assignedBranch', '==', branchId)
        )
    )
    return snap.docs.map(mapUserDoc)
}


async function fetchUsersAndDepartment(departmentId: string) {
    const snap = await getDocs(
        query(
            collection(db, 'users'),
            where('departmentId', '==', departmentId)
        )
    )
    return snap.docs.map(mapUserDoc)
}

export async function resolveAttendanceVisibleEmployees(
    currentUser: CurrentUser | null | undefined
): Promise<AttendanceScopedEmployee[]> {
    if (!currentUser?.role) return []

    const role = normalizeRole(currentUser.role)
    const branchId = getUserBranchId(currentUser)
    const departmentId = currentUser.departmentId || ''

    // ADMIN: can see everything, including control accounts
    if (role === 'admin') {
        const rows = await fetchUsers()
        return dedupeEmployees(rows)
    }

    // DIRECTOR: can see everything in company, but control accounts hidden
    if (role === 'director') {
        const rows = await fetchUsers()
        return applyVisibilityPostFilter(dedupeEmployees(rows), currentUser)
    }

    // PROJECT ADMIN:
    // - team is branch-scoped using users.assignedBranch only
    // - current staff roles: coordinator, receptionist, employee
    if (role === 'projectadmin') {
        if (!branchId) return []

        const branchUsers = await fetchUsersAndBranch(branchId)
        const scoped = branchUsers.filter(u => {
            const userRole = normalizeRole(u.role)
            return ['coordinator', 'receptionist', 'employee'].includes(userRole)
        })

        return applyVisibilityPostFilter(dedupeEmployees(scoped), currentUser)
    }

    // OPERATIONS:
    // - if department is main => everyone in company except control accounts
    // - if not main => coordinators + employees of same department
    if (role === 'operations') {
        const isMain = await getDepartmentIsMain(departmentId)

        if (isMain) {
            const rows = await fetchUsers()
            return applyVisibilityPostFilter(dedupeEmployees(rows), currentUser)
        }

        const deptUsers = departmentId
            ? await fetchUsersAndDepartment(departmentId)
            : []

        const scoped = deptUsers.filter(u => {
            const userRole = normalizeRole(u.role)
            return userRole === 'coordinator' || userRole === 'employee'
        })

        return applyVisibilityPostFilter(dedupeEmployees(scoped), currentUser)
    }

    return applyVisibilityPostFilter([], currentUser)
}
