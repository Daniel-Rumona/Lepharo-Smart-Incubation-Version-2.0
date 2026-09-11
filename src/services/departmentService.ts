import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore'
import { db } from '@/firebase'
import { Department, DepartmentFormData } from '@/types/types'

export const departmentService = {
  // Create a new department
  async createDepartment(departmentData: DepartmentFormData): Promise<string> {
    try {
      // Check for duplicate names within the same company
      const existingQuery = query(
        collection(db, 'departments'),
        where('name', '==', departmentData.name),
      )
      const existingDocs = await getDocs(existingQuery)

      if (!existingDocs.empty) {
        throw new Error(`Department with name "${departmentData.name}" already exists`)
      }

      // Convert DepartmentFormData to full Department structure
      const departmentDoc = {
        name: departmentData.name,
        code: departmentData.name.toLowerCase().replace(/\s+/g, '-'),
        description: departmentData.description,
        manager: departmentData.manager || '',
        contactEmail: departmentData.contactEmail,
        isTraining: departmentData.isTraining === true,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: 'director'
      }

      const docRef = await addDoc(collection(db, 'departments'), departmentDoc)
      return docRef.id
    } catch (error) {
      console.error('Error creating department:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to create department')
    }
  },

  // Get all departments
  async getAllDepartments(): Promise<Department[]> {
    try {
      // Try simple query first, then add filters if needed
      const collectionRef = collection(db, 'departments')
      const querySnapshot = await getDocs(collectionRef)

      // Filter and sort on the client side to avoid index issues
      const departments = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Department))
        .filter(department => department.isActive !== false) // Include departments without isActive field
        .sort((a, b) => a.name.localeCompare(b.name))

      return departments
    } catch (error) {
      console.error('Error fetching departments:', error)

      // Check if it's a permission error
      if (error instanceof Error && error.message.includes('permission')) {
        throw new Error('Permission denied: Please ensure you are logged in as a director')
      }

      // Check if it's a missing collection error
      if (error instanceof Error && error.message.includes('collection')) {
        return [] // Return empty array if collection doesn't exist yet
      }

      throw new Error(`Failed to fetch departments: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  },

  // Get departments
  async getDepartments(): Promise<Department[]> {
    try {
      const q = query(
        collection(db, 'departments'),
        where('isActive', '==', true),
        orderBy('name')
      )
      const querySnapshot = await getDocs(q)

      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Department))
    } catch (error) {
      console.error('Error fetching departments by company:', error)
      throw new Error('Failed to fetch departments')
    }
  },

  // Get a single department by ID
  async getDepartmentById(departmentId: string): Promise<Department | null> {
    try {
      const docRef = doc(db, 'departments', departmentId)
      const docSnap = await getDoc(docRef)

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        } as Department
      }

      return null
    } catch (error) {
      console.error('Error fetching department by ID:', error)
      throw new Error('Failed to fetch department')
    }
  },

  // Update a department
  async updateDepartment(departmentId: string, updates: Partial<DepartmentFormData>): Promise<void> {
    try {
      // If updating name, check for duplicates
      if (updates.name) {
        const existingQuery = query(
          collection(db, 'departments'),
          where('name', '==', updates.name),
        )
        const existingDocs = await getDocs(existingQuery)
        const duplicates = existingDocs.docs.filter(doc => doc.id !== departmentId)

        if (duplicates.length > 0) {
          throw new Error(`Department with name "${updates.name}" already exists`)
        }
      }

      const docRef = doc(db, 'departments', departmentId)
      await updateDoc(docRef, {
        ...updates,
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error updating department:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to update department')
    }
  },

  // Soft delete a department (mark as inactive)
  async deleteDepartment(departmentId: string): Promise<void> {
    try {
      // Check if any users are assigned to this department
      const usersQuery = query(
        collection(db, 'users'),
        where('department', '==', departmentId)
      )
      const usersSnapshot = await getDocs(usersQuery)

      if (!usersSnapshot.empty) {
        const userCount = usersSnapshot.size
        throw new Error(
          `Cannot delete department: ${userCount} user(s) are still assigned to this department. ` +
          'Please reassign or remove these users first.'
        )
      }

      const docRef = doc(db, 'departments', departmentId)
      await updateDoc(docRef, {
        isActive: false,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error deleting department:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to delete department')
    }
  },

  // Initialize default Lepharo departments
  async initializeLepharoDepartments(): Promise<void> {
    try {
      const lepharoDepartments = [
        {
          name: 'HSE (Health, Safety & Environment) and Labour Compliance',
          code: 'hse-labour-compliance',
          description: 'Health, Safety, Environment and Labour Compliance management',
          manager: '',
          contactEmail: 'hse@lepharo.co.za'
        },
        {
          name: 'ROM (Recruitment, Onboarding and Maintenance)',
          code: 'rom',
          description: 'Recruitment, Onboarding and Maintenance of participants',
          manager: '',
          contactEmail: 'rom@lepharo.co.za'
        },
        {
          name: 'Financial Compliance',
          code: 'financial-compliance',
          description: 'Financial compliance and regulatory management',
          manager: '',
          contactEmail: 'finance@lepharo.co.za'
        },
        {
          name: 'Personal Development Services (PDS)',
          code: 'pds',
          description: 'Personal development and skills training services',
          manager: '',
          contactEmail: 'pds@lepharo.co.za'
        }
      ]

      const batch = writeBatch(db)

      for (const departmentData of lepharoDepartments) {
        // Check if department already exists
        const existingQuery = query(
          collection(db, 'departments'),
          where('name', '==', departmentData.name),
        )
        const existingDocs = await getDocs(existingQuery)

        if (existingDocs.empty) {
          const newDocRef = doc(collection(db, 'departments'))
          batch.set(newDocRef, {
            ...departmentData,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: 'system'
          })
        }
      }

      await batch.commit()
      console.log('Lepharo departments initialized successfully')
    } catch (error) {
      console.error('Error initializing Lepharo departments:', error)
      throw new Error('Failed to initialize Lepharo departments')
    }
  }
}
