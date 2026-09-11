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
    startAfter,
    serverTimestamp,
    Timestamp,
    DocumentSnapshot,
    arrayUnion
  } from 'firebase/firestore'
  import { db } from '@/firebase'
  import {
    Inquiry,
    InquiryFormData,
    InquiryQueryParams,
    InquiryStatus,
    StatusHistoryEntry,
    CommunicationEntry,
    InquiryAnalytics,
    ReceptionistDashboardData
  } from '@/types/inquiry'
  import { followUpService } from './followUpService'

  export const inquiryService = {
    // Create a new inquiry
    async createInquiry(
      inquiryData: InquiryFormData,
      branchId: string,
      submittedBy: string,

    ): Promise<string> {
      try {
        // Validate required contact info (email or phone)
        if (!inquiryData.contactInfo.email && !inquiryData.contactInfo.phone) {
          throw new Error('Either email or phone number is required')
        }

        // Validate services of interest limit
        if (inquiryData.inquiryDetails.servicesOfInterest &&
            inquiryData.inquiryDetails.servicesOfInterest.length > 5) {
          throw new Error('Maximum 5 services of interest can be selected')
        }

        // Create initial status history entry
        const initialStatusHistory: StatusHistoryEntry = {
          status: 'New',
          changedAt: new Date(),
          changedBy: submittedBy,
          notes: 'Inquiry created'
        }

        // Prepare inquiry document
        const inquiryDoc = {
          branchId,
          submittedBy,
          submittedAt: serverTimestamp(),
          status: 'New' as InquiryStatus,
          priority: inquiryData.priority,
          classification: inquiryData.classification || 'General',
          source: inquiryData.source,
          contactInfo: inquiryData.contactInfo,
          inquiryDetails: inquiryData.inquiryDetails,
          followUp: inquiryData.followUp || null,
          statusHistory: [initialStatusHistory],
          tags: inquiryData.tags || [],
          programId: inquiryData.programId || null,
          programName: inquiryData.programName || null,
          sourceType: inquiryData.sourceType || (inquiryData.programId ? 'Incubatee' : 'Non-Incubatee'),
          updatedAt: serverTimestamp(),
          isActive: true
        }

        const docRef = await addDoc(collection(db, 'inquiries'), inquiryDoc)
        console.log('Inquiry created successfully:', docRef.id)

        // Create follow-up if follow-up data is provided
        if (inquiryData.followUp?.followUpMethod) {
          try {
            await followUpService.createFollowUp({
              inquiryId: docRef.id,
              branchId,
              scheduledDate: inquiryData.followUp.nextFollowUpDate || new Date(),
              followUpType: inquiryData.followUp.followUpMethod,
              priority: inquiryData.priority,
              notes: inquiryData.followUp.notes,
              assignedTo: inquiryData.followUp.assignedTo || submittedBy,
              assignedToName: inquiryData.followUp.assignedTo || submittedBy, // This should be resolved to actual name
            })
            console.log('Follow-up created successfully for inquiry:', docRef.id)
          } catch (followUpError) {
            console.error('Failed to create follow-up for inquiry:', docRef.id, followUpError)
            // Don't fail the inquiry creation if follow-up creation fails
          }
        }

        return docRef.id
      } catch (error) {
        console.error('Error creating inquiry:', error)
        throw new Error(error instanceof Error ? error.message : 'Failed to create inquiry')
      }
    },

    // Get inquiries with filtering and pagination
    async getInquiries(params: InquiryQueryParams = {}): Promise<Inquiry[]> {
      try {
        console.log('InquiryService: getInquiries called with params:', params)

        let inquiryQuery = query(collection(db, 'inquiries'))
        console.log('InquiryService: Base query created')

        // Apply filters
        if (params.branchId) {
          console.log('InquiryService: Adding branchId filter:', params.branchId)
          inquiryQuery = query(inquiryQuery, where('branchId', '==', params.branchId))
        }
        if (params.status) {
          console.log('InquiryService: Adding status filter:', params.status)
          inquiryQuery = query(inquiryQuery, where('status', '==', params.status))
        }
        if (params.priority) {
          console.log('InquiryService: Adding priority filter:', params.priority)
          inquiryQuery = query(inquiryQuery, where('priority', '==', params.priority))
        }
        if (params.source) {
          console.log('InquiryService: Adding source filter:', params.source)
          inquiryQuery = query(inquiryQuery, where('source', '==', params.source))
        }
        if (params.submittedBy) {
          console.log('InquiryService: Adding submittedBy filter:', params.submittedBy)
          inquiryQuery = query(inquiryQuery, where('submittedBy', '==', params.submittedBy))
        }

        // Skip complex filters to avoid index requirements - handle client-side instead
        console.log('InquiryService: Using simple query without complex filters to avoid index requirements')
        // Will filter isActive and sort by submittedAt client-side

        // Add limit if specified
        if (params.limit) {
          console.log('InquiryService: Adding limit:', params.limit)
          inquiryQuery = query(inquiryQuery, limit(params.limit))
        }

        console.log('InquiryService: Executing Firestore query...')
        const querySnapshot = await getDocs(inquiryQuery)
        console.log('InquiryService: Query executed successfully, docs count:', querySnapshot.size)

        const results = querySnapshot.docs.map(doc => {
          const data = doc.data()
          return {
            id: doc.id,
            ...data,
            submittedAt: data.submittedAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            followUp: data.followUp ? {
              ...data.followUp,
              nextFollowUpDate: data.followUp.nextFollowUpDate?.toDate()
            } : undefined,
            statusHistory: data.statusHistory?.map((entry: any) => ({
              ...entry,
              changedAt: entry.changedAt?.toDate() || new Date()
            })) || []
          } as Inquiry
        })

        console.log('InquiryService: Raw results before filtering:', results.length, 'inquiries')

        // Client-side filtering and sorting to avoid index requirements
        let filteredResults = results
          .filter(inquiry => inquiry.isActive !== false) // Filter out soft-deleted items
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()) // Sort by submittedAt desc

        // Apply limit after client-side operations if specified
        if (params.limit && filteredResults.length > params.limit) {
          filteredResults = filteredResults.slice(0, params.limit)
        }

        console.log('InquiryService: Final filtered/sorted results:', filteredResults.length, 'inquiries')
        return filteredResults
      } catch (error) {
        console.error('InquiryService: Detailed error in getInquiries:', error)
        console.error('InquiryService: Error name:', error instanceof Error ? error.name : 'Unknown')
        console.error('InquiryService: Error message:', error instanceof Error ? error.message : 'Unknown')
        console.error('InquiryService: Error code:', (error as any)?.code)
        console.error('InquiryService: Full error object:', error)
        throw new Error(`Failed to fetch inquiries: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    },

    // Get inquiries for a specific branch (receptionist/center coordinator view)
    async getBranchInquiries(branchId: string, params: InquiryQueryParams = {}): Promise<Inquiry[]> {
      console.log('InquiryService: getBranchInquiries called with branchId:', branchId, 'params:', params)
      const result = await this.getInquiries({ ...params, branchId })
      console.log('InquiryService: getBranchInquiries returning', result.length, 'inquiries')
      return result
    },

    // Alias method for consistency with component usage
    async getInquiriesByBranch(branchId: string, params: InquiryQueryParams = {}): Promise<Inquiry[]> {
      return this.getBranchInquiries(branchId, params)
    },

    // Get a single inquiry by ID
    async getInquiryById(inquiryId: string): Promise<Inquiry | null> {
      try {
        const docRef = doc(db, 'inquiries', inquiryId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const data = docSnap.data()
          return {
            id: docSnap.id,
            ...data,
            submittedAt: data.submittedAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
            followUp: data.followUp ? {
              ...data.followUp,
              nextFollowUpDate: data.followUp.nextFollowUpDate?.toDate()
            } : undefined,
            statusHistory: data.statusHistory?.map((entry: any) => ({
              ...entry,
              changedAt: entry.changedAt?.toDate() || new Date()
            })) || []
          } as Inquiry
        }

        return null
      } catch (error) {
        console.error('Error fetching inquiry by ID:', error)
        throw new Error('Failed to fetch inquiry')
      }
    },

    // Update an inquiry
    async updateInquiry(inquiryId: string, updates: Partial<InquiryFormData>): Promise<void> {
      try {
        // Validate if updating services of interest
        if (updates.inquiryDetails?.servicesOfInterest &&
            updates.inquiryDetails.servicesOfInterest.length > 5) {
          throw new Error('Maximum 5 services of interest can be selected')
        }

        const docRef = doc(db, 'inquiries', inquiryId)
        await updateDoc(docRef, {
          ...updates,
          updatedAt: serverTimestamp()
        })
      } catch (error) {
        console.error('Error updating inquiry:', error)
        throw new Error(error instanceof Error ? error.message : 'Failed to update inquiry')
      }
    },

    // Transfer inquiry ownership to receptionist (allows updates within existing Firestore rules)
    async transferOwnershipToReceptionist(inquiryId: string, receptionistId: string): Promise<void> {
      try {
        console.log('Transferring ownership to receptionist:', { inquiryId, receptionistId })

        const currentInquiry = await this.getInquiryById(inquiryId)
        if (!currentInquiry) {
          throw new Error('Inquiry not found')
        }

        // Only transfer if not already owned by this receptionist
        if (currentInquiry.submittedBy !== receptionistId) {
          const docRef = doc(db, 'inquiries', inquiryId)
          await updateDoc(docRef, {
            submittedBy: receptionistId, // Transfer ownership to receptionist
            originalSubmittedBy: currentInquiry.submittedBy, // Keep track of original submitter
            updatedAt: serverTimestamp()
          })

          console.log('Ownership transferred successfully')
        } else {
          console.log('Receptionist already owns this inquiry')
        }
      } catch (error) {
        console.error('Error transferring ownership:', error)
        throw new Error(error instanceof Error ? error.message : 'Failed to transfer ownership')
      }
    },

    // Update inquiry status (simplified - works with updated Firestore rules)
    async updateInquiryStatus(
      inquiryId: string,
      newStatus: InquiryStatus,
      changedBy: string,
      notes?: string
    ): Promise<void> {
      try {
        console.log('updateInquiryStatus called:', { inquiryId, newStatus, changedBy, notes })

        // Get current inquiry to update status history
        console.log('Fetching current inquiry...')
        const currentInquiry = await this.getInquiryById(inquiryId)
        if (!currentInquiry) {
          console.error('Inquiry not found for ID:', inquiryId)
          throw new Error('Inquiry not found')
        }

        console.log('Current inquiry found:', { id: currentInquiry.id, currentStatus: currentInquiry.status })

        // Create new status history entry
        const statusEntry: StatusHistoryEntry = {
          status: newStatus,
          changedAt: new Date(),
          changedBy,
          ...(notes ? { notes } : {})
        }

        console.log('Creating status entry:', statusEntry)

        // Update status history
        const updatedStatusHistory = [
          ...(currentInquiry.statusHistory || []),
          statusEntry
        ].map(entry =>
          Object.fromEntries(
            Object.entries(entry).filter(([, value]) => value !== undefined)
          )
        )

        console.log('Updating Firestore document with new status...')
        const docRef = doc(db, 'inquiries', inquiryId)
        await updateDoc(docRef, {
          status: newStatus,
          statusHistory: updatedStatusHistory,
          updatedAt: serverTimestamp()
        })

        console.log('Status updated successfully in Firestore')
      } catch (error) {
        console.error('Error updating inquiry status:', error)
        if (error instanceof Error) {
          console.error('Error details:', { name: error.name, message: error.message, stack: error.stack })
        }
        throw new Error(error instanceof Error ? error.message : 'Failed to update inquiry status')
      }
    },

    // Soft delete an inquiry
    async deleteInquiry(inquiryId: string): Promise<void> {
      try {
        const docRef = doc(db, 'inquiries', inquiryId)
        await updateDoc(docRef, {
          isActive: false,
          updatedAt: serverTimestamp()
        })
      } catch (error) {
        console.error('Error deleting inquiry:', error)
        throw new Error('Failed to delete inquiry')
      }
    },

    // Get dashboard data for receptionist
    async getReceptionistDashboard(
      branchId: string,
      submittedBy?: string,
      programId?: string
    ): Promise<ReceptionistDashboardData> {
      try {
        console.log('InquiryService: getReceptionistDashboard called with branchId:', branchId, 'submittedBy:', submittedBy)

        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

        // Get all branch inquiries for calculations
        console.log('InquiryService: Fetching branch inquiries...')
        const branchInquiries = await this.getBranchInquiries(branchId)
        // General/non-incubatee inquiries have no programId. Keep them visible
        // in every program scope while program-linked inquiries follow the selector.
        const allInquiries = programId
          ? branchInquiries.filter(inquiry =>
              !inquiry.programId || inquiry.programId === programId
            )
          : branchInquiries
        console.log('InquiryService: Retrieved', allInquiries.length, 'inquiries for branch')

        // Filter by submitter if specified (for individual receptionist stats)
        const myInquiries = submittedBy
          ? allInquiries.filter(inquiry => inquiry.submittedBy === submittedBy)
          : allInquiries

        console.log('InquiryService: My inquiries count:', myInquiries.length)

        // Calculate metrics
        const todayInquiries = allInquiries.filter(
          inquiry => inquiry.submittedAt >= today
        ).length

        const weekInquiries = allInquiries.filter(
          inquiry => inquiry.submittedAt >= weekAgo
        ).length

        const monthInquiries = allInquiries.filter(
          inquiry => inquiry.submittedAt >= monthAgo
        ).length

        // Get pending follow-ups
        const pendingFollowUps = allInquiries.filter(
          inquiry => inquiry.followUp?.nextFollowUpDate &&
                    inquiry.followUp.nextFollowUpDate <= now &&
                    inquiry.status !== 'Closed'
        ).length

        // The dashboard component paginates these in groups of three.
        const recentInquiries = allInquiries
          .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())

        // Get urgent inquiries
        const urgentInquiries = allInquiries.filter(
          inquiry => inquiry.priority === 'Urgent' && inquiry.status !== 'Closed'
        )

        // Calculate personal stats
        const convertedInquiries = myInquiries.filter(
          inquiry => inquiry.status === 'Converted'
        ).length

        const conversionRate = myInquiries.length > 0
          ? (convertedInquiries / myInquiries.length) * 100
          : 0

        // Calculate average response time (placeholder calculation)
        const averageResponseTime = 24 // hours - would need more complex calculation

        const dashboardData = {
          todayInquiries,
          weekInquiries,
          monthInquiries,
          pendingFollowUps,
          recentInquiries,
          urgentInquiries,
          myStats: {
            totalSubmitted: myInquiries.length,
            conversionRate,
            averageResponseTime
          }
        }

        console.log('InquiryService: Dashboard data prepared:', dashboardData)
        return dashboardData
      } catch (error) {
        console.error('InquiryService: Error fetching receptionist dashboard:', error)

        // Provide more specific error information
        if (error instanceof Error) {
          throw new Error(`Dashboard fetch failed: ${error.message}`)
        } else {
          throw new Error('Failed to fetch dashboard data due to unknown error')
        }
      }
    },

    // Add communication to inquiry
    async addCommunication(inquiryId: string, communication: Omit<CommunicationEntry, 'id' | 'sentAt'>): Promise<void> {
      try {
        const docRef = doc(db, 'inquiries', inquiryId)

        const newCommunication: CommunicationEntry = {
          id: Date.now().toString(), // Simple ID generation
          sentAt: new Date(),
          ...communication
        }

        const updates: Record<string, any> = {
          communications: arrayUnion(newCommunication),
          updatedAt: serverTimestamp()
        }

        // A staff-sent communication counts as acknowledging the inquiry.
        const currentInquiry = await this.getInquiryById(inquiryId)
        if (currentInquiry && !currentInquiry.acknowledgedAt) {
          updates.acknowledgedAt = serverTimestamp()
          updates.acknowledgedBy = communication.sentBy
        }

        await updateDoc(docRef, updates)
      } catch (error) {
        console.error('Error adding communication:', error)
        throw new Error('Failed to add communication')
      }
    },

    // Mark an inquiry as acknowledged by staff (e.g. opening its detail view).
    // No-op if it's already been acknowledged, so the original acknowledger sticks.
    async acknowledgeInquiry(inquiryId: string, userId: string): Promise<void> {
      try {
        const currentInquiry = await this.getInquiryById(inquiryId)
        if (!currentInquiry || currentInquiry.acknowledgedAt) return

        const docRef = doc(db, 'inquiries', inquiryId)
        await updateDoc(docRef, {
          acknowledgedAt: serverTimestamp(),
          acknowledgedBy: userId
        })
      } catch (error) {
        console.error('Error acknowledging inquiry:', error)
        throw new Error('Failed to acknowledge inquiry')
      }
    },

    // Get inquiry analytics for a branch
    async getBranchAnalytics(branchId: string, dateRange?: { from: Date; to: Date }): Promise<InquiryAnalytics> {
      try {
        let inquiries = await this.getBranchInquiries(branchId)

        // Filter by date range if provided
        if (dateRange) {
          inquiries = inquiries.filter(
            inquiry => inquiry.submittedAt >= dateRange.from &&
                      inquiry.submittedAt <= dateRange.to
          )
        }

        // Calculate analytics
        const totalInquiries = inquiries.length

        // Group by status
        const inquiriesByStatus = inquiries.reduce((acc, inquiry) => {
          acc[inquiry.status] = (acc[inquiry.status] || 0) + 1
          return acc
        }, {} as Record<InquiryStatus, number>)

        // Group by source
        const inquiriesBySource = inquiries.reduce((acc, inquiry) => {
          acc[inquiry.source] = (acc[inquiry.source] || 0) + 1
          return acc
        }, {} as any)

        // Group by type
        const inquiriesByType = inquiries.reduce((acc, inquiry) => {
          acc[inquiry.inquiryDetails.inquiryType] = (acc[inquiry.inquiryDetails.inquiryType] || 0) + 1
          return acc
        }, {} as any)

        // Group by priority
        const inquiriesByPriority = inquiries.reduce((acc, inquiry) => {
          acc[inquiry.priority] = (acc[inquiry.priority] || 0) + 1
          return acc
        }, {} as any)

        // Calculate conversion rate
        const convertedCount = inquiriesByStatus['Converted'] || 0
        const conversionRate = totalInquiries > 0 ? (convertedCount / totalInquiries) * 100 : 0

        // Calculate average response time (placeholder)
        const averageResponseTime = 24

        // Generate trend data (daily counts for last 30 days)
        const trendData = this.generateTrendData(inquiries, 30)

        return {
          totalInquiries,
          inquiriesByStatus,
          inquiriesBySource,
          inquiriesByType,
          inquiriesByPriority,
          conversionRate,
          averageResponseTime,
          trendData
        }
      } catch (error) {
        console.error('Error generating analytics:', error)
        throw new Error('Failed to generate analytics')
      }
    },

    // Helper function to generate trend data
    generateTrendData(inquiries: Inquiry[], days: number) {
      const now = new Date()
      const trendData = []

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
        const dateString = date.toISOString().split('T')[0]

        const count = inquiries.filter(inquiry => {
          const inquiryDate = inquiry.submittedAt.toISOString().split('T')[0]
          return inquiryDate === dateString
        }).length

        trendData.push({ date: dateString, count })
      }

      return trendData
    }
  }
