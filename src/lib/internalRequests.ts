import { Timestamp } from 'firebase/firestore'

// Internal purchase requests: staff ask for something to be bought or hired
// (requestType 'internal' in `resourceRequests`), and IHF moves it through
// approval, quotation, invoice and payment. Labels and colours match IHF's
// own page so a stage reads the same everywhere.

export interface StageEntry {
  stage: string
  timestamp?: unknown
  actor?: string
  note?: string
}

export interface InternalRequest {
  id: string
  resourceId?: string | null
  resourceName: string
  purpose: string
  quantity?: number
  neededBy?: unknown
  status: string
  progress?: StageEntry[]
  createdAt?: unknown
  requestedBy?: string
  requestedByName?: string
  requestedFrom?: string
  // Set by finance when it rejects the request
  rejectionReason?: string
}

const STAGES: Record<string, { label: string; color: string }> = {
  pending_purchase_approval: { label: 'Awaiting Purchase Approval', color: 'default' },
  awaiting_purchase_approval: { label: 'Awaiting Purchase Approval', color: 'default' },
  pending_quotation: { label: 'Pending Quotation', color: 'gold' },
  quotation_submitted: { label: 'Quotation Submitted', color: 'processing' },
  pending_finance_review: { label: 'Pending Finance Review', color: 'processing' },
  quotation_approved: { label: 'Quotation Approved', color: 'green' },
  invoice_requested: { label: 'Invoice Requested', color: 'orange' },
  invoice_uploaded: { label: 'Invoice Uploaded', color: 'blue' },
  invoice_approved: { label: 'Invoice Approved', color: 'geekblue' },
  invoice_rejected: { label: 'Invoice Rejected', color: 'volcano' },
  ceo_approval: { label: 'Pending CEO Approval', color: 'purple' },
  pending_ceo_approval: { label: 'Pending CEO Approval', color: 'purple' },
  approved_final: { label: 'Final Approval Granted', color: 'cyan' },
  paid: { label: 'Paid', color: 'success' },
  completed: { label: 'Completed', color: 'success' },
  rejected: { label: 'Rejected', color: 'red' }
}

const startCase = (s: string) =>
  s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bCeo\b/g, 'CEO')

export const stageInfo = (stage?: string) =>
  (stage && STAGES[stage]) || { label: stage ? startCase(stage) : '—', color: 'default' }

export type StageGroup = 'in_progress' | 'completed' | 'rejected'

export const stageGroup = (status?: string): StageGroup =>
  status === 'completed' || status === 'paid'
    ? 'completed'
    : status === 'rejected'
      ? 'rejected'
      : 'in_progress'

// Timestamps, {seconds} objects and ISO strings (neededBy is stored as one)
export const toDay = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value === 'object' && value && 'seconds' in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000)
  }
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? null : d
}

// Ad-hoc requests (catering, tent hire) aren't tied to a catalogue resource
export const isAdhoc = (request: Pick<InternalRequest, 'resourceId'>) => !request.resourceId
