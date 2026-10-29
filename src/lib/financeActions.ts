import { addDoc, collection, doc, Timestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { sendNotification } from '@/utils/sendNotification'

// Finance's actions on internal purchase requests and department MOV packs,
// shared by the In-house Finance Dashboard and the Resource Requests page.
//
// Request workflow (finance's steps in caps):
//   Awaiting purchase approval → Pending quotation → Quotation submitted
//   (or Pending finance review, when Purchases escalates it)
//   → APPROVE QUOTE (amount required) → Invoice requested
//   → Invoice uploaded → APPROVE & PAY (proof of payment) → Completed
// Finance can reject at either of its two steps, with a reason.

export const QUOTE_STAGES = ['quotation_submitted', 'pending_finance_review']
export const INVOICE_STAGE = 'invoice_uploaded'
export const FINANCE_ACTION_STAGES = [...QUOTE_STAGES, INVOICE_STAGE]
export const PAID_STAGES = ['invoice_approved', 'completed']

export type FinanceStep = 'quote' | 'invoice'

export const financeStepFor = (status?: string): FinanceStep | undefined =>
  status && QUOTE_STAGES.includes(status)
    ? 'quote'
    : status === INVOICE_STAGE
      ? 'invoice'
      : undefined

export const FINANCE_STEP_LABEL: Record<FinanceStep, string> = {
  quote: 'Approve quotation',
  invoice: 'Approve invoice & pay'
}

export interface FinanceUser {
  uid?: string
  name?: string
  fullName?: string
  role?: string
  email?: string
}

interface StageEntry {
  stage: string
  timestamp?: unknown
  actor?: string
  note?: string
}

export interface FinanceRequestLike {
  id: string
  status?: string
  progress?: StageEntry[]
  resourceName?: string
  description?: string
  quantity?: number
  amount?: number
  requestType?: string
  branch?: string
  requestedFrom?: string
  quotationUrl?: string
  invoiceUrl?: string
  popUrl?: string
}

export interface MovPackLike {
  id: string
  department?: string
  month?: string
  totalItems?: number
  invoice?: { name?: string; url?: string }
  // Head of department who submitted the pack, and so attaches its invoice
  hodUid?: string
}

const actorName = (user?: FinanceUser | null) => user?.fullName || user?.name || 'Finance'

const decidedBy = (user?: FinanceUser | null) => ({
  uid: user?.uid || '',
  name: user?.fullName || user?.name || '',
  role: user?.role || '',
  email: user?.email || ''
})

export const uploadFinanceFile = async (file: File, pathBase: string) => {
  const safe = file.name.replace(/\s+/g, '_')
  const fileRef = ref(getStorage(), `${pathBase}/${Date.now()}_${safe}`)
  await uploadBytes(fileRef, file)
  return { name: file.name, url: await getDownloadURL(fileRef), path: fileRef.fullPath }
}

const trail = (request: FinanceRequestLike, stages: string[], user?: FinanceUser | null, note?: string) => {
  const now = Timestamp.now()
  return [
    ...(request.progress || []),
    ...stages.map((stage, i) => ({
      stage,
      timestamp: now,
      // The follow-on stage is automatic, so only the decision carries the person
      actor: i === 0 ? actorName(user) : 'System',
      ...(i === 0 && note ? { note } : {})
    }))
  ]
}

// Accepting the quote records the agreed amount and goes straight on to
// requesting the supplier's invoice (previously nothing moved it past here)
export const approveQuotation = async (
  request: FinanceRequestLike,
  values: { amount: number; notes?: string },
  user?: FinanceUser | null
) => {
  await updateDoc(doc(db, 'resourceRequests', request.id), {
    status: 'invoice_requested',
    amount: values.amount,
    quotationApprovedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    progress: trail(request, ['quotation_approved', 'invoice_requested'], user, values.notes)
  })
}

// Approving the invoice is the payment: proof of payment is attached, the
// request completes, and an `invoices` record is kept for consolidated views
export const approveInvoice = async (
  request: FinanceRequestLike,
  values: { amount?: number; notes?: string; popFile?: File | null },
  user?: FinanceUser | null
) => {
  let popUrl = request.popUrl || null
  if (values.popFile) {
    const meta = await uploadFinanceFile(
      values.popFile,
      `invoices/${request.requestedFrom || request.branch || 'branch'}/${dayjs().format('YYYY-MM')}`
    )
    popUrl = meta.url
  }
  if (!popUrl) throw new Error('Proof of payment is required to approve an invoice.')

  const amount = values.amount ?? request.amount
  const now = Timestamp.now()

  await updateDoc(doc(db, 'resourceRequests', request.id), {
    status: 'completed',
    popUrl,
    ...(typeof amount === 'number' ? { amount } : {}),
    paidAt: now,
    updatedAt: now,
    progress: trail(request, ['invoice_approved', 'completed'], user, values.notes)
  })

  await addDoc(collection(db, 'invoices'), {
    invoiceType: 'resource_request',
    branch: request.branch || null,
    branchId: request.requestedFrom || null,
    requestType: request.requestType || null,
    resourceName: request.resourceName || null,
    description: request.description || null,
    quantity: request.quantity ?? null,
    source: { collection: 'resourceRequests', id: request.id },
    invoiceUrl: request.invoiceUrl || null,
    popUrl,
    amount: typeof amount === 'number' ? amount : null,
    notes: values.notes || null,
    status: 'approved',
    month: dayjs().format('YYYY-MM'),
    approvedAt: now,
    approvedBy: decidedBy(user)
  })
}

export const rejectRequest = async (
  request: FinanceRequestLike,
  reason: string,
  user?: FinanceUser | null
) => {
  await updateDoc(doc(db, 'resourceRequests', request.id), {
    status: 'rejected',
    rejectionReason: reason.trim(),
    updatedAt: Timestamp.now(),
    progress: trail(request, ['rejected'], user, reason.trim())
  })
}

// Same record the Departmental Invoices page writes, so both stay in step
export const decidePack = async (
  pack: MovPackLike,
  decision: 'approved' | 'rejected',
  values: { reason?: string; amount?: number; notes?: string; popFile?: File | null },
  user?: FinanceUser | null
) => {
  const popAttachment =
    decision === 'approved' && values.popFile
      ? await uploadFinanceFile(
        values.popFile,
        `invoices/${pack.department}/${dayjs(pack.month).format('YYYY-MM')}`
      )
      : null

  await addDoc(collection(db, 'invoices'), {
    decision,
    ...(decision === 'rejected'
      ? { reason: values.reason?.trim() || null }
      : {
        popAttachment,
        amount: values.amount ?? null,
        paidDate: null,
        notes: values.notes || null,
        type: 'department_invoice'
      }),
    department: pack.department || null,
    month: pack.month || null,
    packId: pack.id,
    items: pack.totalItems || 0,
    invoice: pack.invoice?.url
      ? { name: pack.invoice.name || 'Invoice', url: pack.invoice.url }
      : null,
    decidedAt: new Date(),
    decidedBy: decidedBy(user)
  })
}

// A confirmed pack without an invoice can't be approved or rejected yet, so
// finance asks the head of department who submitted it to attach one. The
// request is recorded on the pack so it isn't asked again unnoticed.
export const requestPackInvoice = async (pack: MovPackLike, user?: FinanceUser | null) => {
  if (!pack.hodUid) {
    throw new Error('No head of department is recorded on this pack to ask.')
  }
  const month = pack.month ? dayjs(pack.month).format('MMMM YYYY') : 'this period'
  await updateDoc(doc(db, 'consolidatedMOVs', pack.id), {
    invoiceRequestedAt: Timestamp.now(),
    invoiceRequestedBy: decidedBy(user)
  })
  await sendNotification({
    type: 'mov_invoice_requested',
    message: `Finance needs the invoice for the ${pack.department || 'department'} MOV pack (${month}). Please attach it so it can be paid.`,
    recipientRoles: [],
    recipientIds: [pack.hodUid],
    link: '/operations/movs',
    actionTarget: { collection: 'consolidatedMOVs', docId: pack.id }
  })
}
