import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '@/firebase'
import { canUserAccessReportsHub, canUserManageTemplates } from './reportPermissions'
import type { ReportUserContext } from './types'

const resolveDepartmentId = (data: any): string | undefined =>
  data?.departmentId ||
  data?.assignedDepartmentId ||
  data?.assignedDepartment?.id ||
  data?.department?.id ||
  undefined

const resolveDepartmentName = (data: any): string | undefined =>
  data?.departmentName ||
  data?.assignedDepartmentName ||
  data?.assignedDepartment?.name ||
  data?.department?.name ||
  undefined

const resolveManagedPrograms = (data: any): string[] => {
  const values = Array.isArray(data?.managedPrograms) ? data.managedPrograms : []
  return Array.from(new Set(values.map((value: any) => String(value || '').trim()).filter(Boolean)))
}

export function useReportCurrentUser() {
  const [user, setUser] = useState<ReportUserContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async firebaseUser => {
      setLoading(true)
      setError(null)

      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        const data = snap.exists() ? snap.data() : {}
        const role = String(data?.role || '').trim().toLowerCase()

        const baseUser: ReportUserContext = {
          uid: firebaseUser.uid,
          name: data?.fullName || data?.name || firebaseUser.displayName || firebaseUser.email || 'User',
          email: data?.email || firebaseUser.email || '',
          role,
          departmentId: resolveDepartmentId(data),
          departmentName: resolveDepartmentName(data),
          isAccountManager: role === 'operations' && data?.isAccountManager === true,
          managedPrograms: resolveManagedPrograms(data),
          canAccessReportsHub: false,
          canManageTemplates: false
        }

        setUser({
          ...baseUser,
          canAccessReportsHub: canUserAccessReportsHub(baseUser),
          canManageTemplates: canUserManageTemplates(baseUser)
        })
      } catch (err: any) {
        setError(err?.message || 'Could not load report user context.')
        setUser(null)
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  return { user, loading, error }
}
