import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import { KpiAgreement, KpiAgreementFormData, KpiNumericTarget, KpiDeliverable } from '@/types/types'

const withTargetIds = (targets: Omit<KpiNumericTarget, 'id'>[]): KpiNumericTarget[] =>
  targets.map((target, index) => ({
    id: `target-${Date.now()}-${index}`,
    ...target
  }))

const withDeliverableIds = (deliverables: Omit<KpiDeliverable, 'id'>[]): KpiDeliverable[] =>
  deliverables.map((deliverable, index) => ({
    id: `deliverable-${Date.now()}-${index}`,
    ...deliverable
  }))

export const kpiAgreementService = {
  async createKpiAgreement(data: KpiAgreementFormData): Promise<string> {
    try {
      const kpiAgreementDoc = {
        departmentId: data.departmentId,
        departmentName: data.departmentName,
        serviceName: data.serviceName,
        formNo: data.formNo,
        revisionNo: data.revisionNo,
        effectiveDate: data.effectiveDate,
        fyLabel: data.fyLabel,
        monthlyCapacity: data.monthlyCapacity,
        numericTargets: withTargetIds(data.numericTargets),
        deliverables: withDeliverableIds(data.deliverables),
        signOff: data.signOff,
        source: data.source || null,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: data.signOff?.hod?.name || 'director'
      }

      const docRef = await addDoc(collection(db, 'kpiAgreements'), kpiAgreementDoc)
      return docRef.id
    } catch (error) {
      console.error('Error creating KPI agreement:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to create KPI agreement')
    }
  },

  async getKpiAgreements(): Promise<KpiAgreement[]> {
    try {
      const q = query(
        collection(db, 'kpiAgreements'),
        where('isActive', '==', true)
      )
      const querySnapshot = await getDocs(q)

      return querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        } as KpiAgreement))
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName))
    } catch (error) {
      console.error('Error fetching KPI agreements:', error)
      throw new Error('Failed to fetch KPI agreements')
    }
  },

  async getKpiAgreementById(id: string): Promise<KpiAgreement | null> {
    try {
      const docRef = doc(db, 'kpiAgreements', id)
      const docSnap = await getDoc(docRef)

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        } as KpiAgreement
      }

      return null
    } catch (error) {
      console.error('Error fetching KPI agreement:', error)
      throw new Error('Failed to fetch KPI agreement')
    }
  },

  async updateKpiAgreement(id: string, updates: Partial<KpiAgreementFormData>): Promise<void> {
    try {
      const { numericTargets, deliverables, ...rest } = updates
      const docRef = doc(db, 'kpiAgreements', id)
      await updateDoc(docRef, {
        ...rest,
        ...(numericTargets ? { numericTargets: withTargetIds(numericTargets) } : {}),
        ...(deliverables ? { deliverables: withDeliverableIds(deliverables) } : {}),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error updating KPI agreement:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to update KPI agreement')
    }
  },

  async deleteKpiAgreement(id: string): Promise<void> {
    try {
      const docRef = doc(db, 'kpiAgreements', id)
      await updateDoc(docRef, {
        isActive: false,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error deleting KPI agreement:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to delete KPI agreement')
    }
  }
}
