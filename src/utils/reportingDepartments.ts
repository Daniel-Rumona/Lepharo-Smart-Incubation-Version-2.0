import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "@/firebase"

export type DeptRow = {
  id: string
  name: string
  isMain: boolean
  interventionsDepartment: boolean
}

export async function fetchInterventionsDepartments(): Promise<DeptRow[]> {
  const q = query(
    collection(db, "departments"),
    where("interventionsDepartment", "==", true)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const data = d.data() as any
    return {
      id: d.id,
      name: String(data?.name || "Department").trim(),
      isMain: !!data?.isMain,
      interventionsDepartment: !!data?.interventionsDepartment
    }
  })
}

// Every department, for resolving an assignment's departmentId to a name.
// Work is recorded against whichever department delivers it, which is not
// always one flagged as an interventions department (e.g. Training Academy).
export async function fetchAllDepartments(): Promise<DeptRow[]> {
  const snap = await getDocs(collection(db, "departments"))
  return snap.docs.map(d => {
    const data = d.data() as any
    return {
      id: d.id,
      name: String(data?.name || "Department").trim(),
      isMain: !!data?.isMain,
      interventionsDepartment: !!data?.interventionsDepartment
    }
  })
}
