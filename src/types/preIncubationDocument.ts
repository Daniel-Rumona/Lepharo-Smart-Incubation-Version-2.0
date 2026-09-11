// Pre-Incubation Agreement Document Types
// Handles legal documents and contracts for M&E verification

import { Timestamp } from 'firebase/firestore'
import { DigitalSignature } from './mov'

/**
 * Pre-Incubation Document Status
 */
export type PreIncubationDocumentStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_signature'
  | 'partially_signed'
  | 'fully_signed'
  | 'active'
  | 'expired'
  | 'terminated'
  | 'archived'

/**
 * Pre-Incubation Document Type
 */
export type PreIncubationDocumentType =
  | 'pre_incubation_agreement'
  | 'confidentiality_agreement'
  | 'non_circumvention_agreement'
  | 'assessment_form'
  | 'legal_addendum'
  | 'amendment'

/**
 * Agreement Party Information
 */
export interface AgreementParty {
  name: string
  registrationNumber?: string
  type: 'incubator' | 'incubatee' | 'third_party'
  representativeName: string
  representativeTitle: string
  representativeId?: string
  physicalAddress: string
  postalAddress?: string
  emailAddress: string
  phoneNumber: string
  authorizedSignatory: boolean
  witnessRequired: boolean
  participantId?: string
  userId?: string
}

/**
 * Agreement Terms and Conditions
 */
export interface AgreementTerms {
  startDate: Date
  endDate: Date
  durationMonths: number
  purpose: string
  scopeDescription: string
  assessmentCriteria: string[]
  businessSector: string
  businessStage: string
  productsServices: string
  confidentialityPeriod: number
  nonCircumventionPeriod: number
  governingLaw: string
  disputeResolution: string
  specialConditions?: string[]
  terminationConditions: string[]
}

/**
 * Document Signature Information
 */
export interface DocumentSignature extends DigitalSignature {
  signatoryName: string
  signatoryTitle: string
  signatoryId?: string
  partyType: 'incubator' | 'incubatee' | 'witness'
  signatureMethod: 'digital' | 'wet_signature' | 'electronic'
  signatureLocation?: string
  witnessName?: string
  witnessSignature?: DigitalSignature
  isLegallyBinding: boolean
  verificationStatus: 'pending' | 'verified' | 'rejected'
  verificationNotes?: string
}

/**
 * Core Pre-Incubation Document Interface
 */
export interface PreIncubationDocument {
  id: string
  documentNumber: string
  documentType: PreIncubationDocumentType
  title: string
  description?: string
  version: string
  templateId?: string
  parties: AgreementParty[]
  incubatorParty: AgreementParty
  incubateeParty: AgreementParty
  terms: AgreementTerms
  signatures: DocumentSignature[]
  requiredSignatures: number
  status: PreIncubationDocumentStatus
  isActive: boolean
  isExpired: boolean
  legalBinding: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  lastModifiedBy: string
  documentUrl?: string
  participantId: string
  expirationNotificationSent: boolean
  remindersSent: number
  lastReminderDate?: Date
  notes?: string
  internalReference?: string
}

/**
 * Document Template Interface
 */
export interface DocumentTemplate {
  id: string
  name: string
  description: string
  documentType: PreIncubationDocumentType
  version: string
  templateContent: string
  legallyApproved: boolean
  approvedBy?: string
  approvalDate?: Date
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  usageCount: number
  lastUsed?: Date
}

/**
 * Signature Request Interface
 */
export interface SignatureRequest {
  documentId: string
  requestId: string
  signatoryEmail: string
  signatoryName: string
  signatoryRole: string
  partyType: 'incubator' | 'incubatee' | 'witness'
  requestedAt: Date
  requestedBy: string
  dueDate?: Date
  status: 'pending' | 'signed' | 'declined' | 'expired'
  signedAt?: Date
  declinedAt?: Date
  declineReason?: string
}

/**
 * Constants for Pre-Incubation Document operations
 */
export const PRE_INCUBATION_STATUS_LABELS: Record<PreIncubationDocumentStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  pending_signature: 'Pending Signature',
  partially_signed: 'Partially Signed',
  fully_signed: 'Fully Signed',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
  archived: 'Archived'
}

export const PRE_INCUBATION_STATUS_COLORS: Record<PreIncubationDocumentStatus, string> = {
  draft: 'default',
  pending_review: 'orange',
  pending_signature: 'blue',
  partially_signed: 'cyan',
  fully_signed: 'green',
  active: 'success',
  expired: 'error',
  terminated: 'error',
  archived: 'default'
}

export const DOCUMENT_TYPE_LABELS: Record<PreIncubationDocumentType, string> = {
  pre_incubation_agreement: 'Pre-Incubation Agreement',
  confidentiality_agreement: 'Confidentiality Agreement',
  non_circumvention_agreement: 'Non-Circumvention Agreement',
  assessment_form: 'Assessment Form',
  legal_addendum: 'Legal Addendum',
  amendment: 'Amendment'
}

/**
 * Type guards for runtime type checking
 */
export const isValidPreIncubationStatus = (status: string): status is PreIncubationDocumentStatus => {
  return [
    'draft', 'pending_review', 'pending_signature', 'partially_signed',
    'fully_signed', 'active', 'expired', 'terminated', 'archived'
  ].includes(status)
}

export const isValidDocumentType = (type: string): type is PreIncubationDocumentType => {
  return [
    'pre_incubation_agreement', 'confidentiality_agreement', 'non_circumvention_agreement',
    'assessment_form', 'legal_addendum', 'amendment'
  ].includes(type)
}

/**
 * Firestore document converter type
 */
export interface PreIncubationDocumentFirestore extends Omit<PreIncubationDocument,
  'createdAt' | 'updatedAt' | 'terms' | 'lastReminderDate'> {
  createdAt: Timestamp
  updatedAt: Timestamp
  lastReminderDate?: Timestamp
  terms: Omit<AgreementTerms, 'startDate' | 'endDate'> & {
    startDate: Timestamp
    endDate: Timestamp
  }
}
