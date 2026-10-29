import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'

// SME requests to book an external resource. They share the `resourceRequests`
// collection with internal purchase requests, which always carry
// requestType 'internal' and a `progress` trail. SME requests are marked
// 'external'; ones made before that field existed have no type at all.

export type RequestStatus = 'pending' | 'approved' | 'declined'

export interface SmeResourceRequest {
  id: string
  resourceId: string
  resourceName?: string
  requestType?: string
  applicationId?: string
  participantId?: string | null
  requestedBy?: string
  requestedByEmail?: string
  quantity?: number
  // Start/end are set by the current SME form; older requests only have a
  // free-text duration and a needed-by date
  startTime?: unknown
  endTime?: unknown
  neededByDate?: unknown
  duration?: string
  reason?: string
  purpose?: string
  urgency?: string
  deliveryMethod?: string
  status: string
  requestedAt?: unknown
  createdAt?: unknown
  bookingId?: string
  declineReason?: string
}

export const isSmeRequest = (data: { requestType?: unknown; progress?: unknown }) =>
  data.requestType === 'external' || (!data.requestType && !Array.isArray(data.progress))

// The old admin page stored declines as 'rejected'
export const requestStatus = (request: Pick<SmeResourceRequest, 'status'>): RequestStatus => {
  const s = String(request.status || 'pending').trim().toLowerCase()
  if (s === 'approved') return 'approved'
  if (s === 'declined' || s === 'rejected') return 'declined'
  return 'pending'
}

export const REQUEST_STATUS_INFO: Record<RequestStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'orange' },
  approved: { label: 'Approved', color: 'green' },
  declined: { label: 'Declined', color: 'red' }
}

export const requestReason = (request: SmeResourceRequest) =>
  request.reason || request.purpose || ''

export const fetchSmeRequests = async (): Promise<SmeResourceRequest[]> => {
  const snapshot = await getDocs(collection(db, 'resourceRequests'))
  return snapshot.docs
    .filter(d => isSmeRequest(d.data()))
    .map(d => ({ id: d.id, ...d.data() }) as SmeResourceRequest)
}

export const markRequestApproved = (requestId: string, bookingId: string) =>
  updateDoc(doc(db, 'resourceRequests', requestId), {
    status: 'approved',
    bookingId,
    decidedAt: serverTimestamp()
  })

export const markRequestDeclined = (requestId: string, reason: string) =>
  updateDoc(doc(db, 'resourceRequests', requestId), {
    status: 'declined',
    declineReason: reason.trim(),
    decidedAt: serverTimestamp()
  })
