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
