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
import { Branch, BranchFormData } from '@/types/types'
import { defaultOperatingHours, validateOperatingHours } from '@/utils/branchOperatingHours'

export const branchService = {
  // Create a new branch
  async createBranch(branchData: BranchFormData): Promise<string> {
    try {
      const operatingHours = branchData.operatingHours || defaultOperatingHours()
      validateOperatingHours(operatingHours)
      // Check for duplicate names within the same company
      const existingQuery = query(
        collection(db, 'branches'),
        where('name', '==', branchData.name),
      )
      const existingDocs = await getDocs(existingQuery)

      if (!existingDocs.empty) {
        throw new Error(`Branch with name "${branchData.name}" already exists`)
      }

      // Convert BranchFormData to full Branch structure
      const branchDoc = {
        operatingHours,
        centreCoordinatorUserId: branchData.centreCoordinatorUserId || null,
        centreCoordinatorName: branchData.centreCoordinatorName || '',
        centreCoordinatorEmail: branchData.centreCoordinatorEmail || '',
        centreCoordinatorPhone: branchData.centreCoordinatorPhone || '',
        name: branchData.name,
        code: branchData.name.toLowerCase().replace(/\s+/g, '-'),
        location: {
          address: branchData.location,
          city: branchData.location.split(',')[1]?.trim() || branchData.location,
          province: branchData.location.split(',')[1]?.trim() || '',
          postalCode: '',
          country: 'South Africa'
        },
        contact: {
          phone: branchData.contactPhone || '',
          email: branchData.contactEmail || '',
          manager: ''
        },
        status: 'active' as const,
        capacity: {
          maxIncubatees: 100,
          currentIncubatees: 0
        },
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: 'system'
      }

      const docRef = await addDoc(collection(db, 'branches'), branchDoc)

      return docRef.id
    } catch (error) {
      console.error('Error creating branch:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to create branch')
    }
  },

  // Get all branches
  async getAllBranches(): Promise<Branch[]> {
    try {
      // Try simple query first, then add filters if needed
      const collectionRef = collection(db, 'branches')
      const querySnapshot = await getDocs(collectionRef)

      // Filter and sort on the client side to avoid index issues
      const branches = querySnapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Branch))
        .filter(branch => branch.isActive !== false) // Include branches without isActive field
        .sort((a, b) => a.name.localeCompare(b.name))

      return branches
    } catch (error) {
      console.error('Error fetching branches:', error)

      // Check if it's a permission error
      if (error instanceof Error && error.message.includes('permission')) {
        throw new Error('Permission denied: Please ensure you are logged in as a director')
      }

      // Check if it's a missing collection error
      if (error instanceof Error && error.message.includes('collection')) {
        return [] // Return empty array if collection doesn't exist yet
      }

      throw new Error(`Failed to fetch branches: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  },

  // Get branches
  async getBranches(): Promise<Branch[]> {
    try {
      const q = query(
        collection(db, 'branches'),

        where('isActive', '==', true),
        orderBy('name')
      )
      const querySnapshot = await getDocs(q)

      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Branch))
    } catch (error) {
      console.error('Error fetching branches by company:', error)
      throw new Error('Failed to fetch branches')
    }
  },

  // Get a single branch by ID
  async getBranchById(branchId: string): Promise<Branch | null> {
    try {
      const docRef = doc(db, 'branches', branchId)
      const docSnap = await getDoc(docRef)

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        } as Branch
      }

      return null
    } catch (error) {
      console.error('Error fetching branch by ID:', error)
      throw new Error('Failed to fetch branch')
    }
  },

  // Update a branch
  async updateBranch(branchId: string, updates: Partial<BranchFormData>): Promise<void> {
    try {
      if (updates.operatingHours) validateOperatingHours(updates.operatingHours)
      // If updating name, check for duplicates
      if (updates.name) {
        const existingQuery = query(
          collection(db, 'branches'),
          where('name', '==', updates.name),
        )
        const existingDocs = await getDocs(existingQuery)
        const duplicates = existingDocs.docs.filter(doc => doc.id !== branchId)

        if (duplicates.length > 0) {
          throw new Error(`Branch with name "${updates.name}" already exists`)
        }
      }

      const docRef = doc(db, 'branches', branchId)
      const { contactEmail, contactPhone, ...fields } = updates
      await updateDoc(docRef, {
        ...fields,
        ...(contactEmail !== undefined ? { 'contact.email': contactEmail } : {}),
        ...(contactPhone !== undefined ? { 'contact.phone': contactPhone } : {}),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error updating branch:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to update branch')
    }
  },

  // Soft delete a branch (mark as inactive)
  async deleteBranch(branchId: string): Promise<void> {
    try {
      // Check if any users are assigned to this branch
      const usersQuery = query(
        collection(db, 'users'),
        where('assignedBranch', '==', branchId)
      )
      const usersSnapshot = await getDocs(usersQuery)

      if (!usersSnapshot.empty) {
        const userCount = usersSnapshot.size
        throw new Error(
          `Cannot delete branch: ${userCount} user(s) are still assigned to this branch. ` +
          'Please reassign or remove these users first.'
        )
      }

      const docRef = doc(db, 'branches', branchId)
      await updateDoc(docRef, {
        isActive: false,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error deleting branch:', error)
      throw new Error(error instanceof Error ? error.message : 'Failed to delete branch')
    }
  },

  // Initialize default Lepharo branches
  async initializeLepharoBranches(): Promise<void> {
    try {
      const lepharoBranches = [
                 {
           name: 'Springs (Head Office)',
           code: 'springs-head-office',
           location: {
             address: 'Springs',
             city: 'Springs',
             province: 'Gauteng',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 11 000 0000',
             email: 'springs@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 100,
             currentIncubatees: 0
           }
         },
                 {
           name: 'Rustenburg',
           code: 'rustenburg',
           location: {
             address: 'Rustenburg',
             city: 'Rustenburg',
             province: 'North West',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 14 000 0000',
             email: 'rustenburg@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 80,
             currentIncubatees: 0
           }
         },
         {
           name: 'Mogale City',
           code: 'mogale-city',
           location: {
             address: 'Mogale City',
             city: 'Mogale City',
             province: 'Gauteng',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 11 000 0001',
             email: 'mogalecity@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 60,
             currentIncubatees: 0
           }
         },
         {
           name: 'Welkom',
           code: 'welkom',
           location: {
             address: 'Welkom',
             city: 'Welkom',
             province: 'Free State',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 57 000 0000',
             email: 'welkom@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 70,
             currentIncubatees: 0
           }
         },
         {
           name: 'Matlosana',
           code: 'matlosana',
           location: {
             address: 'Matlosana',
             city: 'Matlosana',
             province: 'North West',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 18 000 0000',
             email: 'matlosana@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 50,
             currentIncubatees: 0
           }
         },
         {
           name: 'Khutsong',
           code: 'khutsong',
           location: {
             address: 'Khutsong',
             city: 'Khutsong',
             province: 'Gauteng',
             postalCode: '',
             country: 'South Africa'
           },
           contact: {
             phone: '+27 11 000 0002',
             email: 'khutsong@lepharo.co.za',
             manager: ''
           },
           status: 'active' as const,
           capacity: {
             maxIncubatees: 40,
             currentIncubatees: 0
           }
         }
      ]

      const batch = writeBatch(db)

      for (const branchData of lepharoBranches) {
        // Check if branch already exists
        const existingQuery = query(
          collection(db, 'branches'),
          where('name', '==', branchData.name),
        )
        const existingDocs = await getDocs(existingQuery)

        if (existingDocs.empty) {
          const newDocRef = doc(collection(db, 'branches'))
          batch.set(newDocRef, {
            ...branchData,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: 'system'
          })
        }
      }

      await batch.commit()
      console.log('Lepharo branches initialized successfully')
    } catch (error) {
      console.error('Error initializing Lepharo branches:', error)
      throw new Error('Failed to initialize Lepharo branches')
    }
  }
}
