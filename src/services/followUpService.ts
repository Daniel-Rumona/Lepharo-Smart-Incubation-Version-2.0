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
  limit,
  serverTimestamp,
  Timestamp,
  arrayUnion
} from 'firebase/firestore'
import { db } from '@/firebase'
import { inquiryService } from './inquiryService'

export interface FollowUp {
  id: string
  inquiryId: string
  branchId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  inquirySubject: string
  followUpType: 'Phone' | 'Email' | 'In-person' | 'Video Call'
  scheduledDate: Date
  status: 'Pending' | 'Completed' | 'Overdue' | 'Cancelled'
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  notes: string
  assignedTo: string
  assignedToName: string
  createdAt: Date
  completedAt?: Date
  updatedAt: Date
}

export interface FollowUpFormData {
  inquiryId: string
  branchId: string
  scheduledDate: Date
  followUpType: 'Phone' | 'Email' | 'In-person' | 'Video Call'
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  notes?: string
  assignedTo: string
  assignedToName: string
}

export interface FollowUpQueryParams {
  branchId?: string
  status?: 'Pending' | 'Completed' | 'Overdue' | 'Cancelled'
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent'
  assignedTo?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
}

export const followUpService = {
  // Create a new follow-up
  async createFollowUp(followUpData: FollowUpFormData): Promise<string> {
    try {
      // Validate required fields
      if (!followUpData.inquiryId || !followUpData.branchId || !followUpData.scheduledDate) {
        throw new Error('Missing required fields: inquiryId, branchId, or scheduledDate')
      }

      // Check if inquiry exists and belongs to the branch
      const inquiry = await inquiryService.getInquiryById(followUpData.inquiryId)
      if (!inquiry || inquiry.branchId !== followUpData.branchId) {
        throw new Error('Inquiry not found or does not belong to the specified branch')
      }

      // Prepare follow-up document
      const followUpDoc = {
        inquiryId: followUpData.inquiryId,
        branchId: followUpData.branchId,
        customerName: `${inquiry.contactInfo.firstName} ${inquiry.contactInfo.lastName}`,
        customerEmail: inquiry.contactInfo.email || '',
        customerPhone: inquiry.contactInfo.phone || '',
        inquirySubject: inquiry.inquiryDetails.inquiryType,
        followUpType: followUpData.followUpType,
        scheduledDate: followUpData.scheduledDate,
        status: 'Pending' as const,
        priority: followUpData.priority,
        notes: followUpData.notes || '',
        assignedTo: followUpData.assignedTo,
        assignedToName: followUpData.assignedToName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isActive: true
      }

      const docRef = await addDoc(collection(db, 'followUps'), followUpDoc)
      await updateDoc(docRef, { id: docRef.id })

      console.log('Follow-up created successfully:', docRef.id)
      return docRef.id
    } catch (error) {
      console.error('Error creating follow-up:', error)
      throw error
    }
  },

  // Get follow-ups for a branch with optional filtering
  async getFollowUpsByBranch(branchId: string, params?: FollowUpQueryParams): Promise<FollowUp[]> {
    try {
      // Use a simpler query to avoid index requirements until indexes are built
      let q = query(
        collection(db, 'followUps'),
        where('branchId', '==', branchId),
        where('isActive', '==', true)
      )

      const snapshot = await getDocs(q)
      let followUps = snapshot.docs.map(doc => {
        const data = doc.data()
        return {
          id: doc.id,
          ...data,
          scheduledDate: data.scheduledDate?.toDate(),
          createdAt: data.createdAt?.toDate(),
          completedAt: data.completedAt?.toDate(),
          updatedAt: data.updatedAt?.toDate()
        }
      }) as FollowUp[]

      // Apply client-side filtering to avoid complex index requirements
      if (params?.status) {
        followUps = followUps.filter(followUp => followUp.status === params.status)
      }

      if (params?.priority) {
        followUps = followUps.filter(followUp => followUp.priority === params.priority)
      }

      if (params?.assignedTo) {
        followUps = followUps.filter(followUp => followUp.assignedTo === params.assignedTo)
      }

      // Apply date range filter if provided
      if (params?.dateFrom || params?.dateTo) {
        followUps = followUps.filter(followUp => {
          const scheduledDate = followUp.scheduledDate
          if (params.dateFrom && scheduledDate < params.dateFrom) return false
          if (params.dateTo && scheduledDate > params.dateTo) return false
          return true
        })
      }

      // Sort by scheduled date
      followUps.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())

      // Apply limit if provided
      if (params?.limit) {
        followUps = followUps.slice(0, params.limit)
      }

      return followUps
    } catch (error) {
      console.error('Error getting follow-ups by branch:', error)
      throw error
    }
  },

  // Get follow-ups for center coordinator (exclude receptionist-assigned follow-ups)
  async getCenterCoordinatorFollowUps(branchId: string, params?: FollowUpQueryParams): Promise<FollowUp[]> {
    try {
      // Get all follow-ups for the branch
      const followUps = await this.getFollowUpsByBranch(branchId, params)

      // Filter out follow-ups assigned to receptionists
      // Center coordinators should only see follow-ups not assigned to receptionists
      const filteredFollowUps = followUps.filter(followUp => {
        // Check if the assignedTo user is a receptionist
        // We'll exclude follow-ups where assignedTo contains receptionist-related identifiers
        const assignedTo = followUp.assignedTo?.toLowerCase() || ''
        const assignedToName = followUp.assignedToName?.toLowerCase() || ''

        // Exclude if assigned to a receptionist (common receptionist identifiers)
        const isReceptionist =
          assignedTo.includes('receptionist') ||
          assignedToName.includes('receptionist') ||
          assignedTo.includes('reception') ||
          assignedToName.includes('reception') ||
          // Also exclude if the assignedTo is an email that might be a receptionist
          (assignedTo.includes('@') && (
            assignedTo.includes('reception') ||
            assignedTo.includes('front') ||
            assignedTo.includes('desk')
          ))

        return !isReceptionist
      })

      // Add overdue status calculation
      const now = new Date()
      const processedFollowUps = filteredFollowUps.map(followUp => {
        const isOverdue = followUp.status === 'Pending' &&
                         followUp.scheduledDate < now &&
                         followUp.inquiryId // Only mark as overdue if it's related to an inquiry

        return {
          ...followUp,
          status: isOverdue ? 'Overdue' as const : followUp.status
        }
      })

      return processedFollowUps
    } catch (error) {
      console.error('Error getting center coordinator follow-ups:', error)
      // Return empty array instead of throwing to prevent UI errors
      return []
    }
  },

  // Get follow-ups for receptionist (their assigned follow-ups)
  async getReceptionistFollowUps(branchId: string, assignedTo: string, params?: FollowUpQueryParams): Promise<FollowUp[]> {
    try {
      // Get follow-ups assigned to the receptionist
      const receptionistParams = {
        ...params,
        assignedTo
      }

      const followUps = await this.getFollowUpsByBranch(branchId, receptionistParams)

      // Add overdue status calculation
      const now = new Date()
      return followUps.map(followUp => {
        const isOverdue = followUp.status === 'Pending' &&
                         followUp.scheduledDate < now

        return {
          ...followUp,
          status: isOverdue ? 'Overdue' as const : followUp.status
        }
      })
    } catch (error) {
      console.error('Error getting receptionist follow-ups:', error)
      // Return empty array instead of throwing to prevent UI errors
      return []
    }
  },

  // Update follow-up status
  async updateFollowUpStatus(followUpId: string, status: 'Pending' | 'Completed' | 'Overdue' | 'Cancelled', notes?: string): Promise<void> {
    try {
      const followUpRef = doc(db, 'followUps', followUpId)
      const followUpDoc = await getDoc(followUpRef)

      if (!followUpDoc.exists()) {
        throw new Error('Follow-up not found')
      }

      const updateData: any = {
        status,
        updatedAt: serverTimestamp()
      }

      if (status === 'Completed') {
        updateData.completedAt = serverTimestamp()
      }

      if (notes) {
        updateData.notes = notes
      }

      await updateDoc(followUpRef, updateData)

      // If completing a follow-up, also update the related inquiry status
      if (status === 'Completed') {
        const followUpData = followUpDoc.data()
        try {
          await inquiryService.updateInquiryStatus(
            followUpData.inquiryId,
            'Contacted',
            followUpData.assignedTo,
            'Follow-up completed'
          )
        } catch (inquiryError) {
          console.warn('Failed to update inquiry status:', inquiryError)
          // Don't fail the follow-up update if inquiry update fails
        }
      }

      console.log('Follow-up status updated successfully:', followUpId)
    } catch (error) {
      console.error('Error updating follow-up status:', error)
      throw error
    }
  },

  // Update follow-up details
  async updateFollowUp(followUpId: string, updateData: Partial<FollowUpFormData>): Promise<void> {
    try {
      const followUpRef = doc(db, 'followUps', followUpId)
      const followUpDoc = await getDoc(followUpRef)

      if (!followUpDoc.exists()) {
        throw new Error('Follow-up not found')
      }

      const updatePayload: any = {
        updatedAt: serverTimestamp()
      }

      if (updateData.scheduledDate) {
        updatePayload.scheduledDate = updateData.scheduledDate
      }

      if (updateData.followUpType) {
        updatePayload.followUpType = updateData.followUpType
      }

      if (updateData.priority) {
        updatePayload.priority = updateData.priority
      }

      if (updateData.notes !== undefined) {
        updatePayload.notes = updateData.notes
      }

      if (updateData.assignedTo) {
        updatePayload.assignedTo = updateData.assignedTo
        updatePayload.assignedToName = updateData.assignedToName
      }

      await updateDoc(followUpRef, updatePayload)
      console.log('Follow-up updated successfully:', followUpId)
    } catch (error) {
      console.error('Error updating follow-up:', error)
      throw error
    }
  },

  // Delete follow-up (soft delete)
  async deleteFollowUp(followUpId: string): Promise<void> {
    try {
      const followUpRef = doc(db, 'followUps', followUpId)
      await updateDoc(followUpRef, {
        isActive: false,
        updatedAt: serverTimestamp()
      })
      console.log('Follow-up deleted successfully:', followUpId)
    } catch (error) {
      console.error('Error deleting follow-up:', error)
      throw error
    }
  },

  // Get follow-up statistics for dashboard
  async getFollowUpStats(branchId: string, assignedTo?: string): Promise<{
    total: number
    pending: number
    overdue: number
    completed: number
    cancelled: number
  }> {
    try {
      const params: FollowUpQueryParams = { branchId }
      if (assignedTo) {
        params.assignedTo = assignedTo
      }

      const followUps = await this.getFollowUpsByBranch(branchId, params)

      const now = new Date()
      const stats = {
        total: followUps.length,
        pending: 0,
        overdue: 0,
        completed: 0,
        cancelled: 0
      }

      followUps.forEach(followUp => {
        if (followUp.status === 'Pending') {
          if (followUp.scheduledDate < now) {
            stats.overdue++
          } else {
            stats.pending++
          }
        } else if (followUp.status === 'Completed') {
          stats.completed++
        } else if (followUp.status === 'Cancelled') {
          stats.cancelled++
        }
      })

      return stats
    } catch (error) {
      console.error('Error getting follow-up stats:', error)
      throw error
    }
  },

  // Get follow-up statistics for center coordinator (excludes receptionist-assigned follow-ups)
  async getCenterCoordinatorFollowUpStats(branchId: string): Promise<{
    total: number
    pending: number
    overdue: number
    completed: number
    cancelled: number
  }> {
    try {
      // Get center coordinator follow-ups (which already exclude receptionist-assigned ones)
      const followUps = await this.getCenterCoordinatorFollowUps(branchId)

      const now = new Date()
      const stats = {
        total: followUps.length,
        pending: 0,
        overdue: 0,
        completed: 0,
        cancelled: 0
      }

      followUps.forEach(followUp => {
        if (followUp.status === 'Pending') {
          if (followUp.scheduledDate < now) {
            stats.overdue++
          } else {
            stats.pending++
          }
        } else if (followUp.status === 'Completed') {
          stats.completed++
        } else if (followUp.status === 'Cancelled') {
          stats.cancelled++
        }
      })

      return stats
    } catch (error) {
      console.error('Error getting center coordinator follow-up stats:', error)
      return {
        total: 0,
        pending: 0,
        overdue: 0,
        completed: 0,
        cancelled: 0
      }
    }
  },

  // Create follow-ups from existing inquiries (for migration or bulk creation)
  async createFollowUpsFromInquiries(branchId: string): Promise<number> {
    try {
      const inquiries = await inquiryService.getInquiriesByBranch(branchId)
      let createdCount = 0

      for (const inquiry of inquiries) {
        // Only create follow-ups for inquiries that have follow-up data but no existing follow-up
        if (inquiry.followUp?.followUpMethod && inquiry.status !== 'Closed') {
          try {
            // Check if follow-up already exists
            const existingFollowUps = await this.getFollowUpsByBranch(branchId, {
              assignedTo: inquiry.followUp.assignedTo || inquiry.submittedBy
            })

            const followUpExists = existingFollowUps.some(fu => fu.inquiryId === inquiry.id)

            if (!followUpExists) {
              await this.createFollowUp({
                inquiryId: inquiry.id,
                branchId: inquiry.branchId,
                scheduledDate: inquiry.followUp.nextFollowUpDate || new Date(),
                followUpType: inquiry.followUp.followUpMethod,
                priority: inquiry.priority,
                notes: inquiry.followUp.notes,
                assignedTo: inquiry.followUp.assignedTo || inquiry.submittedBy,
                assignedToName: inquiry.followUp.assignedTo || inquiry.submittedBy, // This should be resolved to actual name
                companyCode
              })
              createdCount++
            }
          } catch (error) {
            console.error(`Failed to create follow-up for inquiry ${inquiry.id}:`, error)
          }
        }
      }

      console.log(`Created ${createdCount} follow-ups from inquiries`)
      return createdCount
    } catch (error) {
      console.error('Error creating follow-ups from inquiries:', error)
      throw error
    }
  }
}
