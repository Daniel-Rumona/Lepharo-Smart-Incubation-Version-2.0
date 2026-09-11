import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import { QualityObjective, QualityObjectiveFormData, QualityObjectiveStep } from '@/types/types'

const withStepIds = (steps: Omit<QualityObjectiveStep, 'id'>[]): QualityObjectiveStep[] =>
  steps.map((step, index) => ({
    id: `step-${Date.now()}-${index}`,
    ...step
  }))

export const qualityObjectiveService = {
  // Create a new quality objective
  async createQualityObjective(data: QualityObjectiveFormData): Promise<string> {
    try {
      const qualityObjectiveDoc = {
        departmentId: data.departmentId,
        departmentName: data.departmentName,
        formNo: data.formNo,
        revisionNo: data.revisionNo,
        effectiveDate: data.effectiveDate,
        referenceNumber: data.referenceNumber,
        objectiveNumber: data.objectiveNumber,
        objectiveText: data.objectiveText,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        steps: withStepIds(data.steps),
        preparedBy: data.preparedBy,
        preparedDate: data.preparedDate,
        approvedByCEO: data.approvedByCEO,
        acknowledgedByHOD: data.acknowledgedByHOD,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: data.preparedBy || 'director'
      }

      const docRef = await addDoc(collection(db, 'qualityObjectives'), qualityObjectiveDoc)
      return docRef.id
    } catch (error) {
      console.error('Error creating quality objective:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to create quality objective')
    }
  },

  // Get all quality objectives
  async getAllQualityObjectives(): Promise<QualityObjective[]> {
    try {
      const collectionRef = collection(db, 'qualityObjectives')
      const querySnapshot = await getDocs(collectionRef)

      return querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        } as QualityObjective))
        .filter(qo => qo.isActive !== false)
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName))
    } catch (error) {
      console.error('Error fetching quality objectives:', error)
      throw new Error(`Failed to fetch quality objectives: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  },

  // Get quality objectives
  async getQualityObjectives(): Promise<QualityObjective[]> {
    try {
      const q = query(
        collection(db, 'qualityObjectives'),
        where('isActive', '==', true),
        orderBy('departmentName')
      )
      const querySnapshot = await getDocs(q)

      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as QualityObjective))
    } catch (error) {
      console.error('Error fetching quality objectives:', error)
      throw new Error('Failed to fetch quality objectives')
    }
  },

  // Get quality objectives for a single department
  async getQualityObjectivesByDepartment(departmentId: string): Promise<QualityObjective[]> {
    try {
      const q = query(
        collection(db, 'qualityObjectives'),
        where('departmentId', '==', departmentId),
        where('isActive', '==', true)
      )
      const querySnapshot = await getDocs(q)

      return querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        } as QualityObjective))
        .sort((a, b) => a.objectiveNumber - b.objectiveNumber)
    } catch (error) {
      console.error('Error fetching quality objectives by department:', error)
      throw new Error('Failed to fetch quality objectives')
    }
  },

  // Get a single quality objective by ID
  async getQualityObjectiveById(id: string): Promise<QualityObjective | null> {
    try {
      const docRef = doc(db, 'qualityObjectives', id)
      const docSnap = await getDoc(docRef)

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        } as QualityObjective
      }

      return null
    } catch (error) {
      console.error('Error fetching quality objective by ID:', error)
      throw new Error('Failed to fetch quality objective')
    }
  },

  // Update a quality objective
  async updateQualityObjective(id: string, updates: Partial<QualityObjectiveFormData>): Promise<void> {
    try {
      const { steps, ...rest } = updates
      const docRef = doc(db, 'qualityObjectives', id)
      await updateDoc(docRef, {
        ...rest,
        ...(steps ? { steps: withStepIds(steps) } : {}),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error updating quality objective:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to update quality objective')
    }
  },

  // Soft delete a quality objective
  async deleteQualityObjective(id: string): Promise<void> {
    try {
      const docRef = doc(db, 'qualityObjectives', id)
      await updateDoc(docRef, {
        isActive: false,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error deleting quality objective:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to delete quality objective')
    }
  }
}
