import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { FeatureGovernanceRecord } from '@/types/featureGovernance'
import { accessIdsFor, isGovernanceOwnerEmail } from '@/config/featureGovernanceAccess'

const records = collection(db, 'featureGovernance')

const byUpdated = (items: FeatureGovernanceRecord[]) =>
  items.sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))

export const featureGovernanceService = {
  /**
   * The records the signed-in account may see (config/featureGovernanceAccess.ts): all of
   * them for the governance owner, otherwise only those it logged, was assigned or shared.
   * Read from the auth account, not "view as", because that is what firestore.rules checks.
   */
  async list(): Promise<FeatureGovernanceRecord[]> {
    const account = auth.currentUser
    if (!account) return []
    const snap = await getDocs(
      isGovernanceOwnerEmail(account.email)
        ? query(records)
        : query(records, where('accessIds', 'array-contains', account.uid))
    )
    return byUpdated(snap.docs.map(item => ({ id: item.id, ...item.data() } as FeatureGovernanceRecord)))
  },
  /** Released features announced in What's New; the only records every signed-in user may read. */
  async listPublished(): Promise<FeatureGovernanceRecord[]> {
    const snap = await getDocs(
      query(records, where('status', '==', 'released'), where('whatsNew.published', '==', true))
    )
    return snap.docs
      .map(item => ({ id: item.id, ...item.data() } as FeatureGovernanceRecord))
      .sort((left, right) => {
        const leftDate = left.whatsNew?.releaseDate || left.dueDate || ''
        const rightDate = right.whatsNew?.releaseDate || right.dueDate || ''
        return rightDate.localeCompare(leftDate)
      })
  },
  async create(value: Omit<FeatureGovernanceRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const assigneeIds = value.assigneeIds || []
    const viewerIds = value.viewerIds || []
    return addDoc(records, {
      ...value,
      assigneeIds,
      viewerIds,
      accessIds: accessIdsFor(value.createdBy, assigneeIds, viewerIds),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  },
  async update(id: string, value: Partial<FeatureGovernanceRecord>) {
    return updateDoc(doc(db, 'featureGovernance', id), { ...value, updatedAt: serverTimestamp() })
  },
  /** Owner only: who works on a record and who may see it. */
  async setAccess(record: Pick<FeatureGovernanceRecord, 'id' | 'createdBy'>, assigneeIds: string[], viewerIds: string[]) {
    // Someone both assigned and shared is just assigned.
    const viewers = viewerIds.filter(id => !assigneeIds.includes(id))
    return updateDoc(doc(db, 'featureGovernance', record.id), {
      assigneeIds,
      viewerIds: viewers,
      accessIds: accessIdsFor(record.createdBy, assigneeIds, viewers),
      updatedAt: serverTimestamp()
    })
  },
  async remove(id: string) {
    return deleteDoc(doc(db, 'featureGovernance', id))
  }
}
