import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'

import { db } from '@/firebase'
import type { ResourceRequest } from '@/types/resources'

type ResourceRequestFilters = {
  requestedBy?: string
  status?: string
}

const toDate = (
  value: any,
  fallback?: Date
): Date | undefined => {
  if (!value) return fallback

  if (value instanceof Date) {
    return value
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate()
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? fallback
    : parsed
}

const mapResourceRequest = (
  id: string,
  data: Record<string, any>
): ResourceRequest => ({
  id,
  ...data,

  createdAt:
    toDate(data.createdAt, new Date()) ??
    new Date(),

  updatedAt:
    toDate(data.updatedAt),

  approvedAt:
    toDate(data.approvedAt),

  rejectedAt:
    toDate(data.rejectedAt)
}) as ResourceRequest

export const resourceRequestService = {
  /**
   * Get resource requests with optional
   * in-memory filtering.
   */
  async getResourceRequests(
    filters?: ResourceRequestFilters
  ): Promise<ResourceRequest[]> {
    try {
      const snapshot = await getDocs(
        collection(db, 'resourceRequests')
      )

      let requests = snapshot.docs.map(
        documentSnapshot =>
          mapResourceRequest(
            documentSnapshot.id,
            documentSnapshot.data()
          )
      )

      if (filters?.requestedBy) {
        requests = requests.filter(
          request =>
            request.requestedBy ===
            filters.requestedBy
        )
      }

      if (filters?.status) {
        requests = requests.filter(
          request =>
            request.status ===
            filters.status
        )
      }

      return requests.sort(
        (first, second) => {
          const firstDate =
            first.createdAt instanceof Date
              ? first.createdAt
              : new Date(first.createdAt)

          const secondDate =
            second.createdAt instanceof Date
              ? second.createdAt
              : new Date(second.createdAt)

          return (
            secondDate.getTime() -
            firstDate.getTime()
          )
        }
      )
    } catch (error) {
      console.error(
        'Error fetching resource requests:',
        error
      )

      throw new Error(
        'Failed to fetch resource requests'
      )
    }
  },

  /**
   * Get one resource request.
   */
  async getResourceRequestById(
    requestId: string
  ): Promise<ResourceRequest | null> {
    try {
      const snapshot = await getDoc(
        doc(
          db,
          'resourceRequests',
          requestId
        )
      )

      if (!snapshot.exists()) {
        return null
      }

      return mapResourceRequest(
        snapshot.id,
        snapshot.data()
      )
    } catch (error) {
      console.error(
        'Error fetching resource request:',
        error
      )

      throw new Error(
        'Failed to fetch resource request'
      )
    }
  },

  /**
   * Create a resource request.
   */
  async createResourceRequest(
    requestData: Omit<
      ResourceRequest,
      'id' | 'createdAt'
    >,
    userEmail: string
  ): Promise<string> {
    try {
      const newRequest = {
        ...requestData,

        requestedBy: userEmail,

        status: 'pending',

        createdAt: serverTimestamp()
      }

      const documentRef = await addDoc(
        collection(
          db,
          'resourceRequests'
        ),
        newRequest
      )

      return documentRef.id
    } catch (error) {
      console.error(
        'Error creating resource request:',
        error
      )

      throw new Error(
        'Failed to create resource request'
      )
    }
  },

  /**
   * Update a resource request.
   */
  async updateResourceRequest(
    requestId: string,
    updates: Partial<ResourceRequest>
  ): Promise<void> {
    try {
      await updateDoc(
        doc(
          db,
          'resourceRequests',
          requestId
        ),
        {
          ...updates,
          updatedAt: serverTimestamp()
        }
      )
    } catch (error) {
      console.error(
        'Error updating resource request:',
        error
      )

      throw new Error(
        'Failed to update resource request'
      )
    }
  },

  /**
   * Delete a resource request.
   */
  async deleteResourceRequest(
    requestId: string
  ): Promise<void> {
    try {
      await deleteDoc(
        doc(
          db,
          'resourceRequests',
          requestId
        )
      )
    } catch (error) {
      console.error(
        'Error deleting resource request:',
        error
      )

      throw new Error(
        'Failed to delete resource request'
      )
    }
  },

  /**
   * Approve a resource request.
   */
  async approveResourceRequest(
    requestId: string,
    approvedBy: string
  ): Promise<void> {
    try {
      await updateDoc(
        doc(
          db,
          'resourceRequests',
          requestId
        ),
        {
          status: 'approved',
          approvedAt: serverTimestamp(),
          approvedBy,
          updatedAt: serverTimestamp()
        }
      )
    } catch (error) {
      console.error(
        'Error approving resource request:',
        error
      )

      throw new Error(
        'Failed to approve resource request'
      )
    }
  },

  /**
   * Reject a resource request.
   */
  async rejectResourceRequest(
    requestId: string,
    rejectedBy: string,
    rejectionReason?: string
  ): Promise<void> {
    try {
      await updateDoc(
        doc(
          db,
          'resourceRequests',
          requestId
        ),
        {
          status: 'rejected',
          rejectedAt: serverTimestamp(),
          rejectedBy,
          rejectionReason:
            rejectionReason || null,
          updatedAt: serverTimestamp()
        }
      )
    } catch (error) {
      console.error(
        'Error rejecting resource request:',
        error
      )

      throw new Error(
        'Failed to reject resource request'
      )
    }
  },

  /**
   * Get requests visible to a role.
   */
  async getResourceRequestsByRole(
    userRole: string,
    userEmail: string
  ): Promise<ResourceRequest[]> {
    try {
      const role = String(
        userRole || ''
      )
        .trim()
        .toLowerCase()

      if (
        role === 'projectadmin' ||
        role === 'project_admin'
      ) {
        return this.getResourceRequests({
          requestedBy: userEmail
        })
      }

      if (
        role === 'director' ||
        role === 'admin' ||
        role === 'system_admin' ||
        role === 'superadmin'
      ) {
        return this.getResourceRequests()
      }

      return []
    } catch (error) {
      console.error(
        'Error fetching resource requests by role:',
        error
      )

      throw new Error(
        'Failed to fetch resource requests'
      )
    }
  },

  /**
   * Get requests awaiting approval.
   */
  async getPendingRequests(): Promise<
    ResourceRequest[]
  > {
    try {
      return this.getResourceRequests({
        status: 'pending'
      })
    } catch (error) {
      console.error(
        'Error fetching pending requests:',
        error
      )

      throw new Error(
        'Failed to fetch pending requests'
      )
    }
  },

  /**
   * Get request counts for the current role.
   */
  async getRequestStatistics(
    userRole: string,
    userEmail: string
  ): Promise<{
    total: number
    pending: number
    approved: number
    rejected: number
  }> {
    try {
      const requests =
        await this.getResourceRequestsByRole(
          userRole,
          userEmail
        )

      return {
        total: requests.length,

        pending: requests.filter(
          request =>
            request.status === 'pending'
        ).length,

        approved: requests.filter(
          request =>
            request.status === 'approved'
        ).length,

        rejected: requests.filter(
          request =>
            request.status === 'rejected'
        ).length
      }
    } catch (error) {
      console.error(
        'Error fetching request statistics:',
        error
      )

      throw new Error(
        'Failed to fetch request statistics'
      )
    }
  }
}
