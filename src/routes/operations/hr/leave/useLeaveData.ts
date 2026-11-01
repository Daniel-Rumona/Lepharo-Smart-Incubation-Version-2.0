import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { isStaffRole } from '@/lib/roleLabels'
import { canViewControlReportData, isQuantilytixControlEmail } from '@/utils/reportVisibility'
import { mergeSettings } from './leavePolicy'
import type { Employee, LeaveRequest, LeaveSettings } from './types'

/** Who may approve, reject, edit and assign leave: matches firestore.rules (director or HR). */
const MANAGER_ROLES = new Set(['director', 'hr', 'system_admin', 'superadmin'])

/**
 * Everything the leave management page reads: staff, their requests (live),
 * the leave policy, lookups, and whether the viewer may act on requests.
 */
export function useLeaveData() {
    const { actor } = useFullIdentity()
    const { hasRole } = useDepartmentRoles()

    const [branches, setBranches] = useState<Record<string, string>>({})
    const [departments, setDepartments] = useState<Record<string, string>>({})
    const [users, setUsers] = useState<any[]>([])
    const [requests, setRequests] = useState<LeaveRequest[]>([])
    const [settings, setSettings] = useState<LeaveSettings | null>(null)
    const [settingsDocId, setSettingsDocId] = useState<string | null>(null)
    const [loading, setLoading] = useState({ users: true, requests: true })

    const viewerEmail = actor?.email
    // Control (test) accounts stay hidden unless a control account is looking.
    const hideControl = (email?: string) => !canViewControlReportData(viewerEmail) && isQuantilytixControlEmail(email)

    const canManage =
        MANAGER_ROLES.has(String(actor?.role || '')) ||
        (actor?.role === 'operations' && hasRole(actor?.departmentId, 'hr'))

    // Lookups change rarely: one read each.
    useEffect(() => {
        const toNames = (docs: any[]) =>
            Object.fromEntries(docs.map(d => [d.id, String(d.data()?.name || d.data()?.title || d.id)]))
        getDocs(collection(db, 'branches')).then(s => setBranches(toNames(s.docs))).catch(() => undefined)
        getDocs(collection(db, 'departments')).then(s => setDepartments(toNames(s.docs))).catch(() => undefined)
    }, [])

    // The policy document. Read only: it is created when HR first saves the policy.
    useEffect(() => {
        getDocs(query(collection(db, 'system_settings'), where('type', '==', 'leave'), limit(1)))
            .then(snap => {
                setSettingsDocId(snap.empty ? null : snap.docs[0].id)
                setSettings(mergeSettings(snap.empty ? null : (snap.docs[0].data() as Partial<LeaveSettings>)))
            })
            .catch(error => {
                console.error('[leave] policy load failed', error)
                setSettings(mergeSettings(null))
            })
    }, [])

    useEffect(
        () =>
            onSnapshot(
                collection(db, 'users'),
                snap => {
                    setUsers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                    setLoading(l => ({ ...l, users: false }))
                },
                error => {
                    console.error('[leave] staff load failed', error)
                    setLoading(l => ({ ...l, users: false }))
                }
            ),
        []
    )

    useEffect(
        () =>
            onSnapshot(
                collection(db, 'leaveRequests'),
                snap => {
                    setRequests(
                        snap.docs
                            .map(d => ({ id: d.id, ...(d.data() as Omit<LeaveRequest, 'id'>) }))
                            .sort((a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''))
                    )
                    setLoading(l => ({ ...l, requests: false }))
                },
                error => {
                    console.error('[leave] requests load failed', error)
                    setLoading(l => ({ ...l, requests: false }))
                }
            ),
        []
    )

    // Active staff only (SMEs and training SMEs are not staff); a person keeps
    // both their branch and their department.
    const employees = useMemo<Employee[]>(
        () =>
            users
                .filter(u => u.active !== false && isStaffRole(u.role) && !hideControl(u.email))
                .map(u => ({
                    id: u.id,
                    name: u.name || u.displayName || u.fullName || '',
                    email: u.email || '',
                    role: u.role || '',
                    branchId: u.branchId || undefined,
                    departmentId: u.departmentId || undefined,
                    branchName: u.branchId ? branches[u.branchId] || '' : '',
                    departmentName: u.departmentId ? departments[u.departmentId] || '' : '',
                    photoURL: u.photoURL || '',
                    active: true
                }))
                .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [users, branches, departments, viewerEmail]
    )

    const visibleRequests = useMemo(
        () => requests.filter(r => !hideControl(r.employeeEmail || (r as any).email)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [requests, viewerEmail]
    )

    const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

    return {
        employees,
        employeeById,
        requests: visibleRequests,
        settings,
        settingsDocId,
        setSettings,
        setSettingsDocId,
        branches,
        departments,
        canManage,
        loading: loading.users || loading.requests || !settings
    }
}
