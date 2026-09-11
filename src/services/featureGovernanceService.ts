import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { FeatureGovernanceRecord } from '@/types/featureGovernance'

const records = collection(db, 'featureGovernance')

export const featureGovernanceService = {
  async list(): Promise<FeatureGovernanceRecord[]> {
    const snap = await getDocs(query(records))
    return snap.docs.map(item => ({ id: item.id, ...item.data() } as FeatureGovernanceRecord)).sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
  },
  async listPublished(): Promise<FeatureGovernanceRecord[]> {
    const snap = await getDocs(query(records))
    const items = snap.docs.map(
      item => ({ id: item.id, ...item.data() } as FeatureGovernanceRecord)
    )
    return items
      .filter(item => item.status === 'released' && item.whatsNew?.published === true)
      .sort((left, right) => {
        const leftDate = left.whatsNew?.releaseDate || left.dueDate || ''
        const rightDate = right.whatsNew?.releaseDate || right.dueDate || ''
        return rightDate.localeCompare(leftDate)
      })
  },
  async create(value: Omit<FeatureGovernanceRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    return addDoc(records, { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  },
  async update(id: string, value: Partial<FeatureGovernanceRecord>) {
    return updateDoc(doc(db, 'featureGovernance', id), { ...value, updatedAt: serverTimestamp() })
  },
  async remove(id: string) {
    return deleteDoc(doc(db, 'featureGovernance', id))
  }
}
