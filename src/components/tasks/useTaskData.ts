import { useEffect, useMemo, useRef, useState } from 'react'
import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    where,
    type QueryConstraint
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    isFunderRole,
    safePriority,
    safeStatus,
    type Assignable,
    type Department,
    type Person,
    type Program,
    type Task
} from './taskTypes'

/** Firestore `in` takes at most 30 values. */
const IN_LIMIT = 30

const chunk = <T,>(list: T[], size: number) => {
    const out: T[][] = []
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
    return out
}

const clean = (values: unknown[]) =>
    Array.from(new Set(values.map(v => (v == null ? '' : String(v).trim())).filter(Boolean)))

export const loadErrorText = (error: any, what: string) =>
    error?.code === 'permission-denied'
        ? `You don't have access to ${what}.`
        : `Couldn't load ${what}. Check your connection and refresh the page.`

/** Which tasks this viewer may see. Known only once departments have loaded. */
export type TaskScope =
    | { kind: 'pending' }
    | { kind: 'all' }
    | { kind: 'department'; departmentId: string }
    | { kind: 'funder'; programIds: string[] }

type CoordinatorDoc = {
    id: string
    uid?: string | null
    authUid?: string | null
    name?: string
    departmentId?: string | null
    branchId?: string | null
    assignedPrograms?: string[]
}

type UserDoc = { id: string; name?: string; displayName?: string; fullName?: string; email?: string; photoURL?: string; assignedPrograms?: string[] }

const personName = (u?: UserDoc | null) => String(u?.name || u?.displayName || u?.fullName || u?.email || '').trim()

/**
 * Everything the Team Workroom reads: the viewer's scope, their tasks (live),
 * and the lookups (departments, programmes, branches, coordinators and the
 * users they link to). Lookups are read once; only tasks are live.
 */
export function useTaskData(programId: string | 'all') {
    const { user } = useFullIdentity()
    const role = String(user?.role || '')
    const isFunder = isFunderRole(role)
    const myUid = String(user?.uid || user?.id || '')
    const myDeptId = String(user?.departmentId || '').trim()
    const myPrograms = useMemo(
        () => clean(Array.isArray(user?.assignedPrograms) ? user!.assignedPrograms : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(user?.assignedPrograms || [])]
    )

    const [departments, setDepartments] = useState<Department[] | null>(null)
    const [programs, setPrograms] = useState<Program[]>([])
    const [branches, setBranches] = useState<Record<string, string>>({})
    const [coordinators, setCoordinators] = useState<CoordinatorDoc[] | null>(null)
    const [usersById, setUsersById] = useState<Map<string, UserDoc>>(new Map())
    const [pendingUserIds, setPendingUserIds] = useState(0)
    const [tasks, setTasks] = useState<Task[]>([])
    const [tasksLoaded, setTasksLoaded] = useState(false)
    const [deptError, setDeptError] = useState<string | null>(null)
    const [tasksError, setTasksError] = useState<string | null>(null)

    // ---- Lookups (read once) -------------------------------------------------
    useEffect(() => {
        getDocs(collection(db, 'departments'))
            .then(s =>
                setDepartments(
                    s.docs.map(d => {
                        const data = d.data() as any
                        return { id: d.id, name: String(data?.name || d.id), isMain: !!data?.isMain }
                    })
                )
            )
            .catch(e => {
                console.error('[workroom] departments load failed', e)
                setDeptError(loadErrorText(e, 'departments'))
                setDepartments([])
            })
        getDocs(collection(db, 'programs'))
            .then(s => setPrograms(s.docs.map(d => ({ id: d.id, name: String((d.data() as any)?.name || d.id) }))))
            .catch(e => console.error('[workroom] programmes load failed', e))
    }, [])

    useEffect(() => {
        if (!user || isFunder) {
            setCoordinators([])
            return
        }
        getDocs(collection(db, 'branches'))
            .then(s => setBranches(Object.fromEntries(s.docs.map(d => [d.id, String((d.data() as any)?.name || d.id)]))))
            .catch(e => console.warn('[workroom] branches load failed', e))
        getDocs(collection(db, 'coordinators'))
            .then(s => setCoordinators(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))))
            .catch(e => {
                console.error('[workroom] coordinators load failed', e)
                setCoordinators([])
            })
    }, [user, isFunder])

    // ---- Scope -----------------------------------------------------------------
    const scope = useMemo<TaskScope>(() => {
        if (!user) return { kind: 'pending' }
        if (isFunder) {
            const ids = programId !== 'all' ? myPrograms.filter(p => p === programId) : myPrograms
            return { kind: 'funder', programIds: ids }
        }
        if (!myDeptId) return { kind: 'all' }
        if (!departments) return { kind: 'pending' }
        const mine = departments.find(d => d.id === myDeptId)
        // An unknown department is treated as non-main: the narrower view.
        return mine?.isMain ? { kind: 'all' } : { kind: 'department', departmentId: myDeptId }
    }, [user, isFunder, myDeptId, departments, programId, myPrograms])

    const scopeKey = JSON.stringify(scope)

    // ---- Tasks (live) ----------------------------------------------------------
    useEffect(() => {
        setTasks([])
        setTasksLoaded(false)
        setTasksError(null)
        if (scope.kind === 'pending') return

        const programFilter: QueryConstraint[] = programId !== 'all' ? [where('programId', '==', programId)] : []
        let specs: QueryConstraint[][]
        if (scope.kind === 'funder') specs = scope.programIds.map(p => [where('programId', '==', p)])
        else if (scope.kind === 'department') specs = [[where('departmentId', '==', scope.departmentId), ...programFilter]]
        else specs = [programFilter]

        if (!specs.length) {
            setTasksLoaded(true)
            return
        }

        const parts: Array<Task[] | null> = specs.map(() => null)
        const errors: Array<string | null> = specs.map(() => null)
        const reportError = () => setTasksError(errors.find(Boolean) || null)
        const publish = () => {
            if (parts.some(p => p === null)) return
            const byId = new Map<string, Task>()
            parts.forEach(list => list!.forEach(t => byId.set(t.id, t)))
            setTasks(Array.from(byId.values()))
            setTasksLoaded(true)
        }

        const unsubs = specs.map((constraints, index) =>
            onSnapshot(
                query(collection(db, 'tasks'), ...constraints),
                snap => {
                    parts[index] = snap.docs.map(d => {
                        const data = d.data() as any
                        return {
                            id: d.id,
                            ...data,
                            title: String(data?.title || 'Untitled task'),
                            description: String(data?.description || ''),
                            priority: safePriority(data?.priority),
                            status: safeStatus(data?.status),
                            assignees: Array.isArray(data?.assignees) ? data.assignees : []
                        } as Task
                    })
                    errors[index] = null
                    reportError()
                    publish()
                },
                e => {
                    console.error('[workroom] tasks listener failed', e)
                    errors[index] = loadErrorText(e, 'these tasks')
                    reportError()
                    setTasksLoaded(true)
                }
            )
        )
        return () => unsubs.forEach(u => u())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scopeKey, programId])

    // ---- Users: only the ones coordinators and assignees link to -----------------
    const neededUserIds = useMemo(() => {
        const ids = new Set<string>()
        ;(coordinators || []).forEach(c => clean([c.uid, c.authUid, c.id]).forEach(id => ids.add(id)))
        tasks.forEach(t => (t.assignees || []).forEach(a => a?.userId && ids.add(String(a.userId).trim())))
        return Array.from(ids).filter(id => id && !id.includes('/'))
    }, [coordinators, tasks])

    const requestedRef = useRef(new Set<string>())
    useEffect(() => {
        const missing = neededUserIds.filter(id => !requestedRef.current.has(id))
        if (!missing.length) return
        missing.forEach(id => requestedRef.current.add(id))
        setPendingUserIds(n => n + 1)
        Promise.all(
            chunk(missing, IN_LIMIT).map(ids =>
                getDocs(query(collection(db, 'users'), where(documentId(), 'in', ids))).catch(e => {
                    console.warn('[workroom] user lookup failed', e)
                    return null
                })
            )
        )
            .then(snaps => {
                setUsersById(prev => {
                    const next = new Map(prev)
                    snaps.forEach(s => s?.docs.forEach(d => next.set(d.id, { id: d.id, ...(d.data() as any) })))
                    return next
                })
            })
            .finally(() => setPendingUserIds(n => n - 1))
    }, [neededUserIds])

    // ---- Coordinators joined to their users by uid --------------------------------
    const assignables = useMemo<Assignable[]>(() => {
        return (coordinators || [])
            .map(c => {
                const keys = clean([c.uid, c.authUid, c.id])
                const linkedId = keys.find(k => usersById.has(k))
                if (!linkedId) return null
                const u = usersById.get(linkedId)!
                const userPrograms = clean(Array.isArray(u.assignedPrograms) ? u.assignedPrograms : [])
                const mirrored = clean(Array.isArray(c.assignedPrograms) ? c.assignedPrograms : [])
                const branchId = c.branchId ? String(c.branchId) : null
                return {
                    userId: linkedId,
                    keys,
                    name: personName(u) || String(c.name || '').trim() || 'Unnamed coordinator',
                    photo: u.photoURL || undefined,
                    departmentId: String(c.departmentId || '').trim(),
                    branchId,
                    branchName: branchId ? branches[branchId] : undefined,
                    programIds: userPrograms.length ? userPrograms : mirrored
                } as Assignable
            })
            .filter((a): a is Assignable => !!a)
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [coordinators, usersById, branches])

    /** Display names for assignee ids (user ids, and coordinator doc ids on older tasks). */
    const people = useMemo(() => {
        const map = new Map<string, Person>()
        usersById.forEach(u => map.set(u.id, { id: u.id, name: personName(u) || 'Unnamed user', photo: u.photoURL }))
        assignables.forEach(a => a.keys.forEach(k => map.set(k, { id: a.userId, name: a.name, photo: a.photo })))
        return map
    }, [usersById, assignables])

    const deptById = useMemo(() => new Map((departments || []).map(d => [d.id, d])), [departments])
    const programById = useMemo(() => new Map(programs.map(p => [p.id, p])), [programs])

    return {
        user,
        myUid,
        isFunder,
        canEdit: !!user && !isFunder,
        scope,
        lockedDepartmentId: scope.kind === 'department' ? scope.departmentId : null,
        funderPrograms: myPrograms,
        tasks,
        departments: departments || [],
        deptById,
        programs,
        programById,
        assignables,
        assignablesLoading: coordinators === null || pendingUserIds > 0,
        people,
        loading: scope.kind === 'pending' || !tasksLoaded,
        error: tasksError || deptError
    }
}

export type TaskData = ReturnType<typeof useTaskData>

// ---- Interventions -------------------------------------------------------------

export const interventionTitleOf = (x: any) =>
    (typeof x?.title === 'string' && x.title.trim()) ||
    (typeof x?.interventionTitle === 'string' && x.interventionTitle.trim()) ||
    (typeof x?.name === 'string' && x.name.trim()) ||
    (typeof x?.code === 'string' && x.code.trim()) ||
    'Untitled intervention'

export type InterventionOption = { value: string; label: string }

/** Interventions a task in this department can link to. */
export async function fetchInterventionsForDept(departmentId: string): Promise<InterventionOption[]> {
    const snap = await getDocs(
        query(collection(db, 'interventions'), where('departmentId', '==', departmentId), limit(100))
    )
    return snap.docs
        .map(d => ({ value: d.id, label: interventionTitleOf(d.data()) }))
        .sort((a, b) => a.label.localeCompare(b.label))
}

const titleCache = new Map<string, Promise<string | null>>()

/** One intervention's title, read once per id; null when it can't be read. */
export function fetchInterventionTitle(id: string): Promise<string | null> {
    if (!titleCache.has(id)) {
        titleCache.set(
            id,
            getDoc(doc(db, 'interventions', id))
                .then(s => (s.exists() ? interventionTitleOf(s.data()) : null))
                .catch(() => null)
        )
    }
    return titleCache.get(id)!
}
