// MOV (Means of Verification) Types
// Based on MOV-example.md and intervention database requirements

import { Timestamp } from 'firebase/firestore'

/**
 * MOV Document Status Enumeration
 * Tracks the lifecycle of MOV documents from generation to completion
 */
export type MOVStatus =
  | 'generated'    // MOV document created automatically
  | 'signed'       // Facilitator and client signatures collected
  | 'verified'     // Final checker has verified the document
  | 'complete'     // MOV fully processed and archived

/**
 * Group Stage for SMME classification
 * As defined in MOV-example.md
 */
export type GroupStage = 'A' | 'B' | 'C'

/**
 * Intervention delivery methods
 * As defined in MOV-example.md
 */
export type InterventionMethod =
  | 'In-person'
  | 'Online'
  | 'Telephonic'
  | 'Other'

/**
 * Frequency of intervention delivery
 * As defined in MOV-example.md
 */
export type InterventionFrequency =
  | 'Once a month'
  | 'Every two weeks'
  | 'Weekly'
  | 'Other'

/**
 * Digital signature interface for MOV documents
 * Extensible for future digital signature implementation
 */
export interface DigitalSignature {
  signatureData?: string    // Cryptographic signature string (or encoded image if applicable)
  signedAt: Date           // Timestamp when signature was captured
  ipAddress?: string       // IP address for audit trail
  deviceInfo?: string      // Device information for security
  verified: boolean        // Whether signature has been verified
}

/**
 * Core MOV Document interface
 * Represents a complete Means of Verification document for a completed intervention
 */
export interface MOVDocument {
  // Document Identity
  id: string                           // Firestore document ID
  agreementId?: 'mov'                  // Controlled-document catalog identity
  interventionKey: string              // Legacy intervention/assignment identifier

  // Participant Information
  participantId: string                // Links to participants collection
  beneficiaryName: string              // SMME/Beneficiary name
  smmeNo?: string                      // SMME registration number
  smmeSector?: string                  // Business sector classification
  groupStage?: GroupStage              // A, B, or C classification

  // Intervention Details
  interventionTitle: string            // Type/title of intervention
  subInterventionId?: string            // Selected sub-intervention identifier
  subInterventionTitle?: string         // Selected sub-intervention title
  interventionMethod: InterventionMethod  // Delivery method
  frequencyOfIntervention?: InterventionFrequency  // How often delivered
  interventionDate: Date               // When intervention was delivered
  interventionType: string             // From intervention database

  // Facilitator Information
  facilitatorName: string              // Consultant/facilitator name
  facilitatorId: string                // Links to consultants collection
  facilitatorSignature?: DigitalSignature  // Digital signature

  // Client Information
  clientSignature?: DigitalSignature   // Beneficiary's digital signature

  // Verification Information
  finalCheckerName?: string            // M&E staff who verified
  finalCheckerId?: string              // User ID of final checker
  finalCheckerSignature?: DigitalSignature  // Final checker's signature
  dateChecked?: Date                   // When final verification occurred

  // Document Metadata
  status: MOVStatus                    // Current status of MOV document
  createdAt: Date                      // When MOV was generated
  updatedAt: Date                      // Last modification timestamp

  // Additional Context
  notes?: string                       // Any additional notes or observations
  attachments?: MOVAttachment[]        // Supporting documents
}

/**
 * MOV Attachment interface for supporting documents
 * Future enhancement for document attachments
 */
export interface MOVAttachment {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  uploadedAt: Date
  uploadedBy: string
  storageUrl: string
  description?: string
}

/**
 * MOV Creation Input interface
 * Used when generating MOV documents from intervention data
 */
export interface MOVCreationInput {
    interventionId: string
  interventionKey: string
  participantId: string
  beneficiaryName: string
  interventionTitle: string
  subInterventionId?: string
  subInterventionTitle?: string
  interventionType: string
  interventionDate: Date
  facilitatorName: string
  facilitatorId: string
  facilitatorSignature?: DigitalSignature

  // Optional participant data
  smmeNo?: string
  smmeSector?: string
  groupStage?: GroupStage
  interventionMethod?: InterventionMethod
  frequencyOfIntervention?: InterventionFrequency
}

/**
 * MOV Update Input interface
 * Used for updating MOV documents with signatures and verification
 */
export interface MOVUpdateInput {
  facilitatorSignature?: DigitalSignature
  clientSignature?: DigitalSignature
  finalCheckerName?: string
  finalCheckerId?: string
  finalCheckerSignature?: DigitalSignature
  dateChecked?: Date
  updatedAt?: Date
  status?: MOVStatus
  notes?: string
}

/**
 * MOV Query Filters interface
 * For filtering MOV documents in UI components
 */
export interface MOVQueryFilters {
  participantId?: string
  facilitatorId?: string
  status?: MOVStatus
  groupStage?: GroupStage
  interventionMethod?: InterventionMethod
  dateFrom?: Date
  dateTo?: Date
  searchTerm?: string
}

/**
 * MOV Summary interface
 * For displaying aggregated MOV statistics
 */
export interface MOVSummary {
  totalMOVs: number
  byStatus: Record<MOVStatus, number>
  byGroupStage: Record<GroupStage, number>
  byInterventionMethod: Record<InterventionMethod, number>
  recentMOVs: MOVDocument[]
  pendingVerification: number
}

/**
 * Firestore document converter types
 * For proper Firestore timestamp handling
 */
export interface MOVDocumentFirestore extends Omit<MOVDocument, 'createdAt' | 'updatedAt' | 'interventionDate' | 'dateChecked'> {
  createdAt: Timestamp
  updatedAt: Timestamp
  interventionDate: Timestamp
  dateChecked?: Timestamp
}

/**
 * Constants for MOV operations
 */
export const MOV_STATUS_LABELS: Record<MOVStatus, string> = {
  generated: 'Generated',
  signed: 'Signed',
  verified: 'Verified',
  complete: 'Complete'
}

export const MOV_STATUS_COLORS: Record<MOVStatus, string> = {
  generated: 'orange',
  signed: 'blue',
  verified: 'purple',
  complete: 'green'
}

export const GROUP_STAGE_LABELS: Record<GroupStage, string> = {
  A: 'Group A',
  B: 'Group B',
  C: 'Group C'
}

export const INTERVENTION_METHOD_LABELS: Record<InterventionMethod, string> = {
  'In-person': 'In-person',
  'Online': 'Online',
  'Telephonic': 'Telephonic',
  'Other': 'Other'
}

/**
 * Type guards for runtime type checking
 */
export const isValidMOVStatus = (status: string): status is MOVStatus => {
  return ['generated', 'signed', 'verified', 'complete'].includes(status)
}

export const isValidGroupStage = (stage: string): stage is GroupStage => {
  return ['A', 'B', 'C'].includes(stage)
}

export const isValidInterventionMethod = (method: string): method is InterventionMethod => {
  return ['In-person', 'Online', 'Telephonic', 'Other'].includes(method)
}

export type MovDoc = {
    id: string

    departmentName?: string
    status: 'awaiting_smme' | 'signed' | 'approved' | 'queried' | 'rejected'
    beneficiaryId?: string
    smmeId?: string
    participantId?: string // canonical foreign key going forward - smmeId/beneficiaryId are legacy aliases
    smmeSignatureUrl?: string
    smmeDigitalSignature?: string
    smmeCompanyName?: string
    smmeName?: string
    facilitatorId?: string
    facilitatorName?: string
    facilitatorSignatureUrl?: string
    facilitatorDigitalSignature?: string
    signatureURL?: string // legacy image
    digitalSignature?: string // legacy hash
    interventionId?: string
    interventionTitle?: string
    interventionDate?: any
    interventionsList?: Array<{ title: string; date: any; signature?: string }>
    officeAreaName?: string
    periodStart?: any // Timestamp | Date
    periodEnd?: any // Timestamp | Date
    smmeNo?: string // e.g. SPR2009/233707/08GA
    smmeSector?: string
    gapGroup?: 'A' | 'B' | 'C'
    kpiServiced?: string
    // Intervention method — normalize to booleans
    methodInPerson?: boolean
    methodOnline?: boolean
    methodTelephonic?: boolean
    methodOther?: string
    // Frequency (normalize one of)
    frequency?: 'as-needed' | 'monthly' | 'biweekly' | 'weekly'
    formHeading?: string // e.g. "CONFIRMATION SHEET FOR RECEIVING BDS (MOV)"
    formNo?: string // e.g. "LEP-SPJ QMS 057.1 F"
    revisionNo?: string // e.g. "4"
    effectiveDateText?: string // e.g. "01 June 2024"
    logoUrl?: string // optional per-dept logo
  }

  export type ConsolidatedPack = {
    id: string

    department: string
    month: string // YYYY-MM
    range?: { from: any; to: any }
    totalItems?: number
    status?: string
    approvals?: Array<{ step: string; name?: string; role?: string; date?: any }>
    createdAt?: any
    hodName?: string
    hodUid?: string
    hodSignatureUrl?: string
    hodDigitalSignature?: string
    invoiceAttachment?:
      | { name?: string; url?: string; path?: string }
      | string
      | null
    // legacy snapshots we will render as-is
    interventions?: any[]
    interventionsSnapshot?: any[]
  }

  export function chunk<T> (arr: readonly T[], size = 10): T[][] {
    if (size <= 0) return []
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size))
    }
    return out
  }
