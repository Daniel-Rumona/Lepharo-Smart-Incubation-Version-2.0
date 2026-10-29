import { useMemo, useSyncExternalStore } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    DepartmentLike,
    DepartmentRoleKey,
    DepartmentRoleMap,
    departmentHasRole,
    departmentIdForRole,
    departmentNameOf,
    getDepartmentRole,
    normalizeDepartmentRoles
} from './departmentRoleLogic'

export * from './departmentRoleLogic'

export const DEPARTMENT_ROLES_DOC = doc(db, 'systemSettings', 'departmentRoles')

export type DepartmentRecord = DepartmentLike & { isActive?: boolean; [key: string]: any }

type Snapshot = {
    roles: DepartmentRoleMap
    departments: DepartmentRecord[]
    loading: boolean
}

// One live listener per collection for the whole app; every hook shares it.
let state: Snapshot = { roles: {}, departments: [], loading: true }
let started = false
let rolesLoaded = false
let departmentsLoaded = false
const listeners = new Set<() => void>()

const emit = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch }
    state.loading = !(rolesLoaded && departmentsLoaded)
    listeners.forEach(listener => listener())
}

const start = () => {
    if (started) return
    started = true
    onSnapshot(
        DEPARTMENT_ROLES_DOC,
        snapshot => {
            rolesLoaded = true
            emit({ roles: normalizeDepartmentRoles(snapshot.data()) })
        },
        error => {
            console.warn('Could not load department roles', error)
            rolesLoaded = true
            emit({})
        }
    )
    onSnapshot(
        collection(db, 'departments'),
        snapshot => {
            departmentsLoaded = true
            emit({
                departments: snapshot.docs
                    .map(item => ({ id: item.id, ...(item.data() as any) }) as DepartmentRecord)
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            })
        },
        error => {
            console.warn('Could not load departments', error)
            departmentsLoaded = true
            emit({})
        }
    )
}

const subscribe = (listener: () => void) => {
    start()
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/**
 * Live department list and role map, with helpers that resolve a department
 * id to its role or display name. Sub-departments inherit their parent's role.
 */
export const useDepartmentRoles = () => {
    const snapshot = useSyncExternalStore(subscribe, () => state)
    return useMemo(() => {
        const { roles, departments, loading } = snapshot
        return {
            roles,
            departments,
            loading,
            roleOf: (departmentId?: string | null) => getDepartmentRole(departmentId, roles, departments),
            hasRole: (departmentId: string | null | undefined, role: DepartmentRoleKey) =>
                departmentHasRole(departmentId, role, roles, departments),
            idForRole: (role: DepartmentRoleKey) => departmentIdForRole(role, roles),
            nameOf: (departmentId?: string | null, fallback?: string) =>
                departmentNameOf(departmentId, departments, fallback)
        }
    }, [snapshot])
}

/** One-off load for code that is not a component. */
export const loadDepartmentRoles = async (): Promise<{ roles: DepartmentRoleMap; departments: DepartmentRecord[] }> => {
    if (!state.loading) return { roles: state.roles, departments: state.departments }
    const [rolesSnap, departmentsSnap] = await Promise.all([
        getDoc(DEPARTMENT_ROLES_DOC),
        getDocs(collection(db, 'departments'))
    ])
    return {
        roles: normalizeDepartmentRoles(rolesSnap.data()),
        departments: departmentsSnap.docs.map(item => ({ id: item.id, ...(item.data() as any) }) as DepartmentRecord)
    }
}

export const saveDepartmentRoles = (roles: DepartmentRoleMap, updatedByName: string) =>
    setDoc(DEPARTMENT_ROLES_DOC, { ...normalizeDepartmentRoles(roles), updatedAt: serverTimestamp(), updatedByName })
