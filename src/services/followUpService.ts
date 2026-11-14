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
import { sendNotification } from '@/utils/sendNotification'

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
  assignedToEmail?: string
  createdAt: Date
  completedAt?: Date
  updatedAt: Date
  /** What came of it, written when it is marked done. */
  outcome?: string
  completedBy?: string
  completedByName?: string
  /** Who works it: the branch's reception desk. assignedTo only records who logged it. */
  owner?: 'reception'
  createdVia?: 'portal' | 'reception'
  /**
   * The department coordinators it is escalated to, while they hold it. Empty
   * once it is handed back or taken back. The rules give these people access.
   */
  escalatedToUids?: string[]
  escalation?: FollowUpEscalation
}

export interface FollowUpEscalation {
  departmentId: string
  departmentName: string
  note: string
  byUid: string
  byName: string
  at?: Date
  recipients: { uid: string; name: string }[]
  status: 'open' | 'returned' | 'taken-back'
  /** Copied from the inquiry, which department coordinators cannot open. */
  company?: string
  description?: string
  returnNote?: string
  returnedByName?: string
  returnedAt?: Date
}

const toDateOrUndefined = (value: any) => (typeof value?.toDate === 'function' ? value.toDate() : value || undefined)

/** A follow-up doc, with its timestamps as Dates. */
const toFollowUp = (id: string, data: any): FollowUp => ({
  id,
  ...data,
  scheduledDate: toDateOrUndefined(data.scheduledDate),
  createdAt: toDateOrUndefined(data.createdAt),
  completedAt: toDateOrUndefined(data.completedAt),
  updatedAt: toDateOrUndefined(data.updatedAt),
  ...(data.escalation && {
    escalation: {
      ...data.escalation,
      at: toDateOrUndefined(data.escalation.at),
      returnedAt: toDateOrUndefined(data.escalation.returnedAt)
    }
  })
})

export interface FollowUpFormData {
  inquiryId: string
  branchId: string
  scheduledDate: Date
  followUpType: 'Phone' | 'Email' | 'In-person' | 'Video Call'
  priority: 'Low' | 'Medium' | 'High' | 'Urgent'
  notes?: string
  assignedTo: string
  assignedToName: string
  assignedToEmail?: string
  owner?: 'reception'
  createdVia?: 'portal' | 'reception'
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
        assignedToEmail: followUpData.assignedToEmail || '',
        owner: followUpData.owner || 'reception',
        createdVia: followUpData.createdVia || 'reception',
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
      let followUps = snapshot.docs.map(doc => toFollowUp(doc.id, doc.data()))

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

      // Sort by scheduled date (undated ones last, rather than failing the whole list)
      followUps.sort((a, b) => (a.scheduledDate?.getTime() ?? Infinity) - (b.scheduledDate?.getTime() ?? Infinity))

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

  /** One inquiry's follow-ups, earliest due first: what its detail view shows and acts on. */
  async getFollowUpsForInquiry(inquiryId: string): Promise<FollowUp[]> {
    const snap = await getDocs(query(collection(db, 'followUps'), where('inquiryId', '==', inquiryId)))
    return snap.docs
      .filter(d => d.data().isActive !== false)
      .map(d => toFollowUp(d.id, d.data()))
      .sort((a, b) => (a.scheduledDate?.getTime() ?? Infinity) - (b.scheduledDate?.getTime() ?? Infinity))
  },

  // Get follow-ups for a center coordinator: everything at their centre, reception's included.
  async getCenterCoordinatorFollowUps(branchId: string, params?: FollowUpQueryParams): Promise<FollowUp[]> {
    try {
      const followUps = await this.getFollowUpsByBranch(branchId, params)

      // Add overdue status calculation
      const now = new Date()
      const processedFollowUps = followUps.map(followUp => {
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

  /**
   * Mark a follow-up done with what came of it, and optionally book the next one
   * for the same inquiry. The outcome is kept apart from the original notes, and
   * the inquiry moves to Contacted, as updateFollowUpStatus does.
   */
  async completeFollowUp(
    followUp: FollowUp,
    outcome: string,
    completedBy: { uid: string; name: string; email?: string },
    next?: { scheduledDate: Date; followUpType: FollowUp['followUpType']; notes?: string }
  ): Promise<string | null> {
    await updateDoc(doc(db, 'followUps', followUp.id), {
      status: 'Completed',
      outcome: outcome.trim(),
      completedAt: serverTimestamp(),
      completedBy: completedBy.uid,
      completedByName: completedBy.name,
      updatedAt: serverTimestamp()
    })

    try {
      await inquiryService.updateInquiryStatus(followUp.inquiryId, 'Contacted', completedBy.uid, 'Follow-up completed')
    } catch (inquiryError) {
      console.warn('Failed to update inquiry status:', inquiryError)
    }

    if (!next) return null
    return this.createFollowUp({
      inquiryId: followUp.inquiryId,
      branchId: followUp.branchId,
      scheduledDate: next.scheduledDate,
      followUpType: next.followUpType,
      priority: followUp.priority,
      notes: next.notes || '',
      assignedTo: completedBy.uid,
      assignedToName: completedBy.name,
      assignedToEmail: completedBy.email || ''
    })
  },

  /**
   * The coordinators of a department who should get an escalation from this
   * branch: the department's coordinators at the branch, or, when it has none
   * there, the department's coordinators at any branch. Departments are matched
   * by id only.
   */
  async findDepartmentCoordinators(departmentId: string, branchId: string): Promise<{ uid: string; name: string }[]> {
    const snap = await getDocs(
      query(collection(db, 'users'), where('role', '==', 'coordinator'), where('departmentId', '==', departmentId))
    )
    const active = snap.docs.filter(d => String(d.data().status || 'Active').toLowerCase() !== 'inactive')
    const atBranch = active.filter(d => d.data().assignedBranch === branchId || d.data().branchId === branchId)
    return (atBranch.length ? atBranch : active).map(d => ({
      uid: d.id,
      name: String(d.data().name || d.data().email || 'Coordinator')
    }))
  },

  /**
   * Hand a follow-up to a department's coordinators. They are notified and can
   * see it (the rules key on escalatedToUids); reception keeps it under Escalated.
   * Throws 'no_coordinator' when the department has no coordinator anywhere.
   */
  async escalateFollowUp(
    followUp: FollowUp,
    department: { id: string; name: string },
    note: string,
    by: { uid: string; name: string }
  ): Promise<{ uid: string; name: string }[]> {
    const recipients = await this.findDepartmentCoordinators(department.id, followUp.branchId)
    if (!recipients.length) throw new Error('no_coordinator')

    // The coordinators cannot open the inquiry itself, so the details they need travel with it.
    const inquiry = await inquiryService.getInquiryById(followUp.inquiryId).catch(() => null)

    await updateDoc(doc(db, 'followUps', followUp.id), {
      escalatedToUids: recipients.map(r => r.uid),
      escalation: {
        departmentId: department.id,
        departmentName: department.name,
        note: note.trim(),
        byUid: by.uid,
        byName: by.name,
        at: serverTimestamp(),
        recipients,
        status: 'open',
        company: inquiry?.contactInfo?.company || '',
        description: inquiry?.inquiryDetails?.description || ''
      },
      updatedAt: serverTimestamp()
    })

    await sendNotification({
      type: 'follow-up-escalated',
      recipientIds: recipients.map(r => r.uid),
      message: `${by.name} escalated a follow-up to ${department.name}: ${followUp.customerName}${note.trim() ? ` — "${note.trim()}"` : ''}`,
      link: '/coordinator/follow-ups',
      actionTarget: { collection: 'followUps', docId: followUp.id }
    })
    return recipients
  },

  /** Reception takes an escalated follow-up back before the department has finished it. */
  async takeBackFollowUp(followUp: FollowUp): Promise<void> {
    await updateDoc(doc(db, 'followUps', followUp.id), {
      escalatedToUids: [],
      'escalation.status': 'taken-back',
      updatedAt: serverTimestamp()
    })
  },

  /** A department coordinator hands an escalated follow-up back to reception, with a note. */
  async handBackFollowUp(followUp: FollowUp, note: string, by: { uid: string; name: string }): Promise<void> {
    await updateDoc(doc(db, 'followUps', followUp.id), {
      escalatedToUids: [],
      'escalation.status': 'returned',
      'escalation.returnNote': note.trim(),
      'escalation.returnedByName': by.name,
      'escalation.returnedAt': serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    const reception = await getDocs(
      query(collection(db, 'users'), where('role', '==', 'receptionist'), where('assignedBranch', '==', followUp.branchId))
    ).catch(() => null)
    const ids = reception ? reception.docs.map(d => d.id) : []
    if (ids.length) {
      await sendNotification({
        type: 'follow-up-returned',
        recipientIds: ids,
        message: `${by.name} handed back the follow-up for ${followUp.customerName}: "${note.trim()}"`,
        link: '/receptionist/follow-ups',
        actionTarget: { collection: 'followUps', docId: followUp.id }
      })
    }
  },

  /**
   * Follow-ups escalated to this coordinator, open or finished. Marking one done
   * keeps its escalatedToUids, so finished ones stay listed; handing back or
   * reception taking it back empties it, and it leaves this list.
   */
  async getEscalatedToMe(uid: string): Promise<FollowUp[]> {
    const snap = await getDocs(query(collection(db, 'followUps'), where('escalatedToUids', 'array-contains', uid)))
    return snap.docs
      .filter(d => d.data().isActive !== false)
      .map(d => toFollowUp(d.id, d.data()))
      .sort((a, b) => (a.scheduledDate?.getTime() ?? Infinity) - (b.scheduledDate?.getTime() ?? Infinity))
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
        if (updateData.assignedToEmail !== undefined) {
          updatePayload.assignedToEmail = updateData.assignedToEmail
        }
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

  // Get follow-up statistics for a center coordinator: everything at their centre
  async getCenterCoordinatorFollowUpStats(branchId: string): Promise<{
    total: number
    pending: number
    overdue: number
    completed: number
    cancelled: number
  }> {
    try {
      const followUps = await this.getCenterCoordinatorFollowUps(branchId)

      const now = new Date()
      const stats = {
        total: followUps.length,
        pending: 0,
        overdue: 0,
        completed: 0,
        cancelled: 0
      }

      // getCenterCoordinatorFollowUps has already relabelled past pending ones "Overdue".
      followUps.forEach(followUp => {
        if (followUp.status === 'Overdue' || (followUp.status === 'Pending' && followUp.scheduledDate < now)) {
          stats.overdue++
        } else if (followUp.status === 'Pending') {
          stats.pending++
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
