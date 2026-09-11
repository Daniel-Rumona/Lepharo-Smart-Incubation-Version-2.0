// Pre-Incubation Document Service
// Handles legal document management, templates, and signature workflows

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  PreIncubationDocument,
  PreIncubationDocumentFirestore,
  PreIncubationDocumentStatus,
  PreIncubationDocumentType,
  SignatureRequest,
  DocumentSignature
} from '../types/preIncubationDocument'

/**
 * Pre-Incubation Document Service
 * Manages legal documents, templates, and signature workflows
 */
export class PreIncubationService {
  private static readonly COLLECTION_NAME = 'preIncubationDocuments'
  private static readonly SIGNATURE_REQUESTS_COLLECTION = 'signatureRequests'

  /**
   * Generate unique document number
   */
  private static generateDocumentNumber(documentType: PreIncubationDocumentType): string {
    const timestamp = Date.now()
    const typePrefix = documentType.toUpperCase().substring(0, 3)
    return `${typePrefix}-${timestamp}`
  }

  /**
   * Convert Firestore document to PreIncubationDocument
   */
  private static convertFromFirestore(doc: any): PreIncubationDocument {
    const data = doc.data() as PreIncubationDocumentFirestore
    return {
      ...data,
      id: doc.id,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
      lastReminderDate: data.lastReminderDate?.toDate(),
      terms: {
        ...data.terms,
        startDate: data.terms.startDate.toDate(),
        endDate: data.terms.endDate.toDate()
      }
    }
  }

  /**
   * Convert PreIncubationDocument to Firestore format
   */
  private static convertToFirestore(document: Omit<PreIncubationDocument, 'id'>): Omit<PreIncubationDocumentFirestore, 'id'> {
    return {
      ...document,
      createdAt: Timestamp.fromDate(document.createdAt),
      updatedAt: Timestamp.fromDate(document.updatedAt),
      lastReminderDate: document.lastReminderDate ? Timestamp.fromDate(document.lastReminderDate) : undefined,
      terms: {
        ...document.terms,
        startDate: Timestamp.fromDate(document.terms.startDate),
        endDate: Timestamp.fromDate(document.terms.endDate)
      }
    }
  }

  /**
   * Create a new pre-incubation document
   */
  static async createDocument(
    documentData: Omit<PreIncubationDocument, 'id' | 'documentNumber' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    try {
      const now = new Date()
      const documentNumber = this.generateDocumentNumber(documentData.documentType)

      const document: Omit<PreIncubationDocument, 'id'> = {
        ...documentData,
        documentNumber,
        createdAt: now,
        updatedAt: now
      }

      const firestoreDoc = this.convertToFirestore(document)
      const docRef = await addDoc(collection(db, this.COLLECTION_NAME), firestoreDoc)

      console.log('Pre-incubation document created:', docRef.id)
      return docRef.id
    } catch (error) {
      console.error('Error creating pre-incubation document:', error)
      throw new Error('Failed to create pre-incubation document')
    }
  }

  /**
   * Get a single pre-incubation document by ID
   */
  static async getDocument(documentId: string): Promise<PreIncubationDocument | null> {
    try {
      const docRef = doc(db, this.COLLECTION_NAME, documentId)
      const docSnap = await getDoc(docRef)

      if (!docSnap.exists()) {
        return null
      }

      return this.convertFromFirestore(docSnap)
    } catch (error) {
      console.error('Error fetching pre-incubation document:', error)
      throw new Error('Failed to fetch pre-incubation document')
    }
  }

  /**
   * Update pre-incubation document
   */
  static async updateDocument(
    documentId: string,
    updates: Partial<PreIncubationDocument>,
    userId: string
  ): Promise<void> {
    try {
      const docRef = doc(db, this.COLLECTION_NAME, documentId)

      const updateData: any = {
        ...updates,
        updatedAt: Timestamp.now(),
        lastModifiedBy: userId
      }

      // Convert dates to Timestamps if present
      if (updates.terms) {
        updateData.terms = {
          ...updates.terms,
          startDate: updates.terms.startDate ? Timestamp.fromDate(updates.terms.startDate) : undefined,
          endDate: updates.terms.endDate ? Timestamp.fromDate(updates.terms.endDate) : undefined
        }
      }

      if (updates.lastReminderDate) {
        updateData.lastReminderDate = Timestamp.fromDate(updates.lastReminderDate)
      }

      await updateDoc(docRef, updateData)
      console.log('Pre-incubation document updated:', documentId)
    } catch (error) {
      console.error('Error updating pre-incubation document:', error)
      throw new Error('Failed to update pre-incubation document')
    }
  }

  /**
   * Get documents by participant ID
   */
  static async getDocumentsByParticipant(
    participantId: string,
    documentType?: PreIncubationDocumentType
  ): Promise<PreIncubationDocument[]> {
    try {
      let q = query(
        collection(db, this.COLLECTION_NAME),
        where('participantId', '==', participantId),

      )

      if (documentType) {
        q = query(
          collection(db, this.COLLECTION_NAME),
          where('participantId', '==', participantId),

          where('documentType', '==', documentType)
        )
      }

      const querySnapshot = await getDocs(q)
      const documents = querySnapshot.docs.map(doc => {
        try {
          return this.convertFromFirestore(doc)
        } catch (conversionError) {
          console.warn('Error converting document:', doc.id, conversionError)
          return null
        }
      }).filter(doc => doc !== null) as PreIncubationDocument[]

      // Sort by createdAt in memory
      return documents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    } catch (error) {
      console.error('Error fetching participant documents:', error)
      // Return empty array instead of throwing
      return []
    }
  }

  /**
   * Get all documents for a company with pagination
   */
  static async getAllDocuments(
    limitCount: number = 50,
    documentType?: PreIncubationDocumentType,
    status?: PreIncubationDocumentStatus
  ): Promise<PreIncubationDocument[]> {
    try {
      // Start with basic query
      let q = query(
        collection(db, this.COLLECTION_NAME),

        limit(limitCount)
      )

      // Add document type filter if provided
      if (documentType) {
        q = query(
          collection(db, this.COLLECTION_NAME),

          where('documentType', '==', documentType),
          limit(limitCount)
        )
      }

      // Add status filter if provided
      if (status) {
        if (documentType) {
          q = query(
            collection(db, this.COLLECTION_NAME),

            where('documentType', '==', documentType),
            where('status', '==', status),
            limit(limitCount)
          )
        } else {
          q = query(
            collection(db, this.COLLECTION_NAME),

            where('status', '==', status),
            limit(limitCount)
          )
        }
      }

      const querySnapshot = await getDocs(q)
      const documents = querySnapshot.docs.map(doc => {
        try {
          return this.convertFromFirestore(doc)
        } catch (conversionError) {
          console.warn('Error converting document:', doc.id, conversionError)
          return null
        }
      }).filter(doc => doc !== null) as PreIncubationDocument[]

      // Sort by createdAt in memory since we removed orderBy to avoid index issues
      return documents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    } catch (error) {
      console.error('Error fetching all documents:', error)
      // Return empty array instead of throwing to prevent UI from breaking
      return []
    }
  }

  /**
   * Add signature to document
   */
  static async addSignature(
    documentId: string,
    signature: DocumentSignature,
    userId: string
  ): Promise<void> {
    try {
      const document = await this.getDocument(documentId)
      if (!document) {
        throw new Error('Document not found')
      }

      const updatedSignatures = [...document.signatures, signature]
      const fullySignedCount = updatedSignatures.filter(sig => sig.verificationStatus === 'verified').length

      let newStatus = document.status
      if (fullySignedCount === document.requiredSignatures) {
        newStatus = 'fully_signed'
      } else if (fullySignedCount > 0) {
        newStatus = 'partially_signed'
      }

      const updates: Partial<PreIncubationDocument> = {
        signatures: updatedSignatures,
        status: newStatus
      }

      await this.updateDocument(documentId, updates, userId)
    } catch (error) {
      console.error('Error adding signature:', error)
      throw new Error('Failed to add signature')
    }
  }

  /**
   * Get document statistics summary
   */
  static async getDocumentsSummary(): Promise<{
    total: number
    byStatus: Record<PreIncubationDocumentStatus, number>
    byType: Record<PreIncubationDocumentType, number>
    expiringCount: number
  }> {
    try {
      const documents = await this.getAllDocuments(1000)

      const summary = {
        total: documents.length,
        byStatus: {} as Record<PreIncubationDocumentStatus, number>,
        byType: {} as Record<PreIncubationDocumentType, number>,
        expiringCount: 0
      }

      // If no documents, return empty summary
      if (documents.length === 0) {
        return summary
      }

      // Calculate expiring soon (within 30 days)
      const thirtyDaysFromNow = new Date()
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

      for (const document of documents) {
        // Count by status
        summary.byStatus[document.status] = (summary.byStatus[document.status] || 0) + 1

        // Count by type
        summary.byType[document.documentType] = (summary.byType[document.documentType] || 0) + 1

        // Count expiring soon
        if (document.isActive && document.terms.endDate <= thirtyDaysFromNow) {
          summary.expiringCount++
        }
      }

      return summary
    } catch (error) {
      console.error('Error getting documents summary:', error)
      // Return empty summary instead of throwing
      return {
        total: 0,
        byStatus: {} as Record<PreIncubationDocumentStatus, number>,
        byType: {} as Record<PreIncubationDocumentType, number>,
        expiringCount: 0
      }
    }
  }

  /**
   * Search documents by text
   */
  static async searchDocuments(
    searchTerm: string,
    limitCount: number = 20
  ): Promise<PreIncubationDocument[]> {
    try {
      const documents = await this.getAllDocuments(500)

      if (documents.length === 0) {
        return []
      }

      const searchTermLower = searchTerm.toLowerCase()

      return documents.filter(doc => {
        try {
          return (
            doc.title.toLowerCase().includes(searchTermLower) ||
            doc.documentNumber.toLowerCase().includes(searchTermLower) ||
            doc.incubateeParty.name.toLowerCase().includes(searchTermLower) ||
            doc.terms.purpose.toLowerCase().includes(searchTermLower) ||
            (doc.description && doc.description.toLowerCase().includes(searchTermLower))
          )
        } catch (filterError) {
          console.warn('Error filtering document:', doc.id, filterError)
          return false
        }
      }).slice(0, limitCount)
    } catch (error) {
      console.error('Error searching documents:', error)
      // Return empty array instead of throwing
      return []
    }
  }
}

export default PreIncubationService
