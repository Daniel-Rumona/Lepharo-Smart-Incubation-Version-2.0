import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore'
import type {
  ReportDirectoryDepartment,
  ReportDirectoryProgram,
  ReportDirectoryUser
} from '../types'

export const loadReportDepartments = async (db: Firestore): Promise<ReportDirectoryDepartment[]> => {
  const snap = await getDocs(collection(db, 'departments'))
  return snap.docs
    .map(d => ({
      id: d.id,
      name: String(d.data()?.name || d.data()?.departmentName || d.id)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const loadReportPrograms = async (db: Firestore): Promise<ReportDirectoryProgram[]> => {
  const snap = await getDocs(collection(db, 'programs'))
  return snap.docs
    .map(d => ({
      id: d.id,
      name: String(d.data()?.name || d.data()?.programName || d.data()?.title || d.id),
      status: d.data()?.status ? String(d.data().status) : undefined
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const resolveDepartmentId = (data: any): string | undefined =>
  data?.departmentId ||
  data?.assignedDepartmentId ||
  data?.assignedDepartment?.id ||
  data?.department?.id ||
  undefined

export const loadReportUsers = async (db: Firestore): Promise<ReportDirectoryUser[]> => {
  const snap = await getDocs(query(collection(db, 'users'), limit(400)))
  return snap.docs
    .map(d => {
      const data = d.data()
      return {
        id: d.id,
        name: String(data?.fullName || data?.name || data?.email || d.id),
        email: data?.email ? String(data.email) : undefined,
        role: data?.role ? String(data.role) : undefined,
        departmentId: resolveDepartmentId(data)
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
