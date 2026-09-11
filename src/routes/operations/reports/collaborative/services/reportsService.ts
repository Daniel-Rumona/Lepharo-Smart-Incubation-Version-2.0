import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore'
import { REPORT_COLLECTIONS } from '../reportConfig'
import {
  buildContributorKeys,
  buildUserContributorKeys,
  canUserCreateForProgram,
  canUserManageReport,
  isAccountManager,
  isProjectAdmin
} from '../reportPermissions'
import type {
  BlockSubmissionTarget,
  CarryOverOptions,
  CreateReportInput,
  ProjectAdminMode,
  ReportActivity,
  ReportBlock,
  ReportBlockStatus,
  ReportComment,
  ReportDocument,
  ReportRevision,
  ReportTemplate,
  ReportUserContext,
  TemplateBlock
} from '../types'
import { getReportTemplate } from './reportTemplatesService'

const clone = <T,>(value: T): T => {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value))
}

const normalizeReport = (id: string, data: any): ReportDocument => ({
  id,
  templateId: data?.templateId || '',
  templateName: data?.templateName || '',
  templateSignature: data?.templateSignature || null,
  title: data?.title || 'Untitled Report',
  periodLabel: data?.periodLabel || '',
  frequency: data?.frequency || 'Quarterly',
  programId: data?.programId || null,
  programName: data?.programName || null,
  sourceReportId: data?.sourceReportId || null,
  sourceReportTitle: data?.sourceReportTitle || null,
  status: data?.status || 'draft',
  totalBlocks: Number(data?.totalBlocks || 0),
  completedBlocks: Number(data?.completedBlocks || 0),
  progressPercent: Number(data?.progressPercent || 0),
  contributorKeys: Array.isArray(data?.contributorKeys) ? data.contributorKeys : [],
  access: {
    projectAdminMode: data?.access?.projectAdminMode === 'read_only' ? 'read_only' : 'manage'
  },
  lock: {
    locked: data?.lock?.locked === true,
    lockedBy: data?.lock?.lockedBy || null,
    lockedByName: data?.lock?.lockedByName || null,
    lockedAt: data?.lock?.lockedAt,
    reason: data?.lock?.reason || null
  },
  createdAt: data?.createdAt,
  createdBy: data?.createdBy,
  createdByName: data?.createdByName,
  updatedAt: data?.updatedAt,
  updatedBy: data?.updatedBy,
  updatedByName: data?.updatedByName
})

const normalizeBlock = (id: string, data: any): ReportBlock => ({
  id,
  reportId: data?.reportId || '',
  reportTitle: data?.reportTitle || '',
  periodLabel: data?.periodLabel || '',
  templateId: data?.templateId || '',
  templateBlockId: data?.templateBlockId || '',
  sectionId: data?.sectionId || '',
  sectionTitle: data?.sectionTitle || '',
  sectionOrder: Number(data?.sectionOrder || 0),
  blockOrder: Number(data?.blockOrder || 0),
  title: data?.title || 'Untitled Block',
  contentType: data?.contentType || 'narrative',
  required: data?.required !== false,
  carryPolicy: data?.carryPolicy || 'review',
  carriedFromPeriodLabel: data?.carriedFromPeriodLabel || null,
  evidencePolicy: data?.evidencePolicy === 'required' || data?.evidencePolicy === 'optional' ? data.evidencePolicy : 'none',
  editorDepartmentIds: Array.isArray(data?.editorDepartmentIds) ? data.editorDepartmentIds : [],
  editorDepartmentNames: Array.isArray(data?.editorDepartmentNames) ? data.editorDepartmentNames : [],
  editorUserIds: Array.isArray(data?.editorUserIds) ? data.editorUserIds : [],
  editorUserNames: Array.isArray(data?.editorUserNames) ? data.editorUserNames : [],
  delegatedUserIds: Array.isArray(data?.delegatedUserIds) ? data.delegatedUserIds : [],
  delegatedUserNames: Array.isArray(data?.delegatedUserNames) ? data.delegatedUserNames : [],
  delegation: data?.delegation || null,
  contributorKeys: Array.isArray(data?.contributorKeys) ? data.contributorKeys : [],
  schema: data?.schema || {},
  sourceDocumentNodeIds: Array.isArray(data?.sourceDocumentNodeIds) ? data.sourceDocumentNodeIds : [],
  content: data?.content ?? '',
  attachments: Array.isArray(data?.attachments) ? data.attachments : [],
  status: data?.status || 'not_started',
  submittedTo: data?.submittedTo || null,
  submittedAt: data?.submittedAt,
  submittedBy: data?.submittedBy,
  submittedByName: data?.submittedByName,
  departmentReviewedAt: data?.departmentReviewedAt,
  departmentReviewedBy: data?.departmentReviewedBy,
  departmentReviewedByName: data?.departmentReviewedByName,
  approvedAt: data?.approvedAt,
  approvedBy: data?.approvedBy,
  approvedByName: data?.approvedByName,
  changeRequest: data?.changeRequest || null,
  createdAt: data?.createdAt,
  updatedAt: data?.updatedAt,
  updatedBy: data?.updatedBy,
  updatedByName: data?.updatedByName
})

const blankContent = (block: TemplateBlock) => {
  if (block.defaultContent !== undefined) return clone(block.defaultContent)
  if (block.contentType === 'table' || block.contentType === 'kpi') return { rows: [] }
  return ''
}

export const getReportTemplateSignature = (template: ReportTemplate) => JSON.stringify({
  name: template.name,
  description: template.description || '',
  frequency: template.frequency,
  programIds: template.programIds || [],
  sourceFile: template.sourceFile ? {
    name: template.sourceFile.name,
    path: template.sourceFile.path,
    url: template.sourceFile.url,
    size: template.sourceFile.size || null
  } : null,
  sections: template.sections
})

const looksLikeOpenItem = (block: TemplateBlock) => {
  const value = block.title.toLowerCase()
  return value.includes('risk') || value.includes('issue') || value.includes('planned') || value.includes('milestone')
}

const resetKpiActuals = (content: any, carryTargets: boolean) => {
  const rows = Array.isArray(content?.rows) ? content.rows : []
  return {
    ...clone(content || {}),
    rows: rows.map((row: any) => ({
      ...row,
      target: carryTargets ? row?.target ?? '' : '',
      Target: carryTargets ? row?.Target ?? '' : '',
      achieved: '',
      Achieved: '',
      variance: '',
      Variance: '',
      comments: '',
      Comments: '',
      status: '',
      Status: ''
    }))
  }
}

const markCarriedRows = (content: any, sourcePeriod?: string) => ({
  ...clone(content || {}),
  rows: Array.isArray(content?.rows) ? content.rows.map((row: any) => ({
    ...row,
    __origin: 'carried',
    __sourcePeriod: sourcePeriod || 'Last report'
  })) : []
})

const resolveCarriedContent = ({
  templateBlock,
  previousBlock,
  options
}: {
  templateBlock: TemplateBlock
  previousBlock?: ReportBlock
  options: CarryOverOptions
}) => {
  if (!previousBlock) return blankContent(templateBlock)

  if (templateBlock.carryPolicy === 'reset') {
    if (templateBlock.contentType === 'kpi' && options.carryTargets) {
      return resetKpiActuals(previousBlock.content, true)
    }
    return blankContent(templateBlock)
  }

  if (templateBlock.contentType === 'narrative') {
    return options.carryNarrative ? clone(previousBlock.content) : blankContent(templateBlock)
  }

  if (templateBlock.contentType === 'kpi') {
    if (options.carryActuals) return markCarriedRows(previousBlock.content, previousBlock.periodLabel)
    if (options.carryTargets) return markCarriedRows(resetKpiActuals(previousBlock.content, true), previousBlock.periodLabel)
    return blankContent(templateBlock)
  }

  if (templateBlock.contentType === 'table') {
    if (templateBlock.carryPolicy === 'carry' && options.carryOpenItems) return markCarriedRows(previousBlock.content, previousBlock.periodLabel)
    if (looksLikeOpenItem(templateBlock) && options.carryOpenItems) return markCarriedRows(previousBlock.content, previousBlock.periodLabel)
    return blankContent(templateBlock)
  }

  return blankContent(templateBlock)
}

const sortReports = (rows: ReportDocument[]) => [...rows].sort((a, b) => {
  const aMs = a.updatedAt?.toMillis?.() || 0
  const bMs = b.updatedAt?.toMillis?.() || 0
  return bMs - aMs
})

export const listenReports = (
  db: Firestore,
  onData: (reports: ReportDocument[]) => void
): Unsubscribe => onSnapshot(collection(db, REPORT_COLLECTIONS.reports), snap => {
  onData(sortReports(snap.docs.map(d => normalizeReport(d.id, d.data()))))
})

export const listenReportsForUser = (
  db: Firestore,
  user: ReportUserContext,
  onData: (reports: ReportDocument[]) => void
): Unsubscribe => {
  if (isProjectAdmin(user)) return listenReports(db, onData)

  if (!isAccountManager(user) || !user.managedPrograms.length) {
    onData([])
    return () => undefined
  }

  const rowsByProgram = new Map<string, ReportDocument[]>()
  const publish = () => {
    const merged = Array.from(new Map(
      Array.from(rowsByProgram.values()).flat().map(report => [report.id, report])
    ).values())
    onData(sortReports(merged))
  }

  const unsubscribers = user.managedPrograms.map(programId => onSnapshot(
    query(collection(db, REPORT_COLLECTIONS.reports), where('programId', '==', programId)),
    snap => {
      rowsByProgram.set(programId, snap.docs.map(d => normalizeReport(d.id, d.data())))
      publish()
    }
  ))

  return () => unsubscribers.forEach(unsubscribe => unsubscribe())
}

export const listenReport = (
  db: Firestore,
  reportId: string,
  onData: (report: ReportDocument | null) => void
): Unsubscribe => onSnapshot(doc(db, REPORT_COLLECTIONS.reports, reportId), snap => {
  onData(snap.exists() ? normalizeReport(snap.id, snap.data()) : null)
})

export const getReport = async (db: Firestore, reportId: string) => {
  const snap = await getDoc(doc(db, REPORT_COLLECTIONS.reports, reportId))
  if (!snap.exists()) throw new Error('Report not found.')
  return normalizeReport(snap.id, snap.data())
}

export const listenReportBlocks = (
  db: Firestore,
  reportId: string,
  onData: (blocks: ReportBlock[]) => void
): Unsubscribe => onSnapshot(
  query(collection(db, REPORT_COLLECTIONS.blocks), where('reportId', '==', reportId)),
  snap => {
    const rows = snap.docs
      .map(d => normalizeBlock(d.id, d.data()))
      .sort((a, b) => a.sectionOrder - b.sectionOrder || a.blockOrder - b.blockOrder)
    onData(rows)
  }
)

export const listenContributorBlocks = (
  db: Firestore,
  user: ReportUserContext,
  onData: (blocks: ReportBlock[]) => void
): Unsubscribe => {
  const keys = buildUserContributorKeys(user)
  return onSnapshot(
    query(collection(db, REPORT_COLLECTIONS.blocks), where('contributorKeys', 'array-contains-any', keys)),
    snap => {
      const rows = snap.docs
        .map(d => normalizeBlock(d.id, d.data()))
        .sort((a, b) => {
          const aMs = a.updatedAt?.toMillis?.() || 0
          const bMs = b.updatedAt?.toMillis?.() || 0
          return bMs - aMs
        })
      onData(rows)
    }
  )
}

const addActivityToBatch = ({
  db,
  batch,
  reportId,
  blockId,
  user,
  action,
  detail
}: any) => {
  const ref = doc(collection(db, REPORT_COLLECTIONS.activity))
  batch.set(ref, {
    reportId,
    blockId: blockId || null,
    action,
    detail: detail || '',
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name
  })
}

export const createReportFromTemplate = async ({
  db,
  user,
  input
}: {
  db: Firestore
  user: ReportUserContext
  input: CreateReportInput
}) => {
  if (!canUserCreateForProgram(user, input.programId)) {
    throw new Error('You do not have report management authority for the selected programme.')
  }

  const template = await getReportTemplate(db, input.templateId)
  if (template.status !== 'active') throw new Error('This report template is archived.')

  if (input.programId && template.programIds.length && !template.programIds.includes(input.programId)) {
    throw new Error('The selected template is not configured for this programme.')
  }

  let previousReport: ReportDocument | null = null
  let previousBlocks: ReportBlock[] = []

  if (input.startMode === 'carry_over') {
    if (!input.sourceReportId) throw new Error('Select the report to carry over from.')
    previousReport = await getReport(db, input.sourceReportId)

    if (previousReport.programId !== (input.programId || null)) {
      throw new Error('Carry-over must use a previous report from the same programme.')
    }

    const previousSnap = await getDocs(
      query(collection(db, REPORT_COLLECTIONS.blocks), where('reportId', '==', input.sourceReportId))
    )
    previousBlocks = previousSnap.docs.map(d => normalizeBlock(d.id, d.data()))
  }

  const previousByTemplateBlock = new Map(previousBlocks.map(block => [block.templateBlockId, block]))
  const reportRef = doc(collection(db, REPORT_COLLECTIONS.reports))
  const batch = writeBatch(db)
  const allTemplateBlocks = template.sections.flatMap(section => section.blocks)
  const contributorKeys = Array.from(new Set(
    allTemplateBlocks.flatMap(block => buildContributorKeys(block.editorUserIds, block.editorDepartmentIds))
  ))

  batch.set(reportRef, {
    templateId: template.id,
    templateName: template.name,
    templateSignature: getReportTemplateSignature(template),
    title: input.title,
    periodLabel: input.periodLabel,
    frequency: input.frequency,
    programId: input.programId || null,
    programName: input.programName || null,
    sourceReportId: previousReport?.id || null,
    sourceReportTitle: previousReport?.title || null,
    status: 'draft',
    totalBlocks: allTemplateBlocks.length,
    completedBlocks: 0,
    progressPercent: 0,
    contributorKeys,
    access: {
      projectAdminMode: 'manage'
    },
    lock: {
      locked: false,
      lockedBy: null,
      lockedByName: null,
      lockedAt: null,
      reason: null
    },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })

  template.sections.forEach(section => {
    section.blocks.forEach((templateBlock, blockIndex) => {
      const blockRef = doc(collection(db, REPORT_COLLECTIONS.blocks))
      const previousBlock = previousByTemplateBlock.get(templateBlock.id)
      const content = input.startMode === 'carry_over'
        ? resolveCarriedContent({ templateBlock, previousBlock, options: input.carryOver })
        : blankContent(templateBlock)

      batch.set(blockRef, {
        reportId: reportRef.id,
        reportTitle: input.title,
        periodLabel: input.periodLabel,
        templateId: template.id,
        templateBlockId: templateBlock.id,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionOrder: section.order,
        blockOrder: blockIndex + 1,
        title: templateBlock.title,
        contentType: templateBlock.contentType,
        required: templateBlock.required,
        carryPolicy: templateBlock.carryPolicy,
        carriedFromPeriodLabel: previousBlock && input.startMode === 'carry_over' ? previousBlock.periodLabel : null,
        evidencePolicy: templateBlock.evidencePolicy || 'none',
        editorDepartmentIds: templateBlock.editorDepartmentIds || [],
        editorDepartmentNames: templateBlock.editorDepartmentNames || [],
        editorUserIds: templateBlock.editorUserIds || [],
        editorUserNames: templateBlock.editorUserNames || [],
        delegatedUserIds: [],
        delegatedUserNames: [],
        delegation: null,
        contributorKeys: buildContributorKeys(templateBlock.editorUserIds, templateBlock.editorDepartmentIds),
        schema: templateBlock.schema || {},
        sourceDocumentNodeIds: templateBlock.sourceDocumentNodeIds || [],
        content,
        attachments: input.startMode === 'carry_over' && input.carryOver.carryAttachments
          ? clone(previousBlock?.attachments || [])
          : [],
        status: 'not_started',
        submittedTo: null,
        changeRequest: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: user.name
      })
    })
  })

  addActivityToBatch({
    db,
    batch,
    reportId: reportRef.id,
    user,
    action: 'report_created',
    detail: input.startMode === 'carry_over'
      ? `Created from ${template.name} using carry-over from ${previousReport?.title || 'previous report'}.`
      : `Created from ${template.name}.`
  })

  await batch.commit()
  return reportRef.id
}

const statusWeight: Record<ReportBlockStatus, number> = {
  not_started: 0,
  draft: 35,
  changes_requested: 50,
  submitted: 80,
  approved: 100
}

export const recalculateReportProgress = async (db: Firestore, reportId: string) => {
  const snap = await getDocs(query(collection(db, REPORT_COLLECTIONS.blocks), where('reportId', '==', reportId)))
  const blocks = snap.docs.map(d => normalizeBlock(d.id, d.data()))
  const total = blocks.length
  const approved = blocks.filter(block => block.status === 'approved').length
  const progress = total
    ? Math.round(blocks.reduce((sum, block) => sum + statusWeight[block.status], 0) / total)
    : 0

  let status: ReportDocument['status'] = 'draft'
  if (total > 0 && approved === total) status = 'approved'
  else if (blocks.some(block => block.status === 'submitted' && block.submittedTo === 'report_manager')) status = 'review'
  else if (blocks.some(block => block.status !== 'not_started')) status = 'in_progress'

  await updateDoc(doc(db, REPORT_COLLECTIONS.reports, reportId), {
    totalBlocks: total,
    completedBlocks: approved,
    progressPercent: progress,
    status,
    updatedAt: serverTimestamp()
  })
}

export const saveReportBlock = async ({
  db,
  block,
  user,
  content,
  summary = 'Saved block changes.'
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  content: any
  summary?: string
}) => {
  const blockRef = doc(db, REPORT_COLLECTIONS.blocks, block.id)
  const revisionRef = doc(collection(blockRef, 'revisions'))
  const activityRef = doc(collection(db, REPORT_COLLECTIONS.activity))
  const reportRef = doc(db, REPORT_COLLECTIONS.reports, block.reportId)
  const batch = writeBatch(db)

  batch.set(revisionRef, {
    status: block.status === 'not_started' ? 'draft' : block.status,
    content: clone(content),
    summary,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name
  })

  batch.update(blockRef, {
    content: clone(content),
    status: block.status === 'not_started' ? 'draft' : block.status,
    changeRequest: block.status === 'changes_requested' ? null : block.changeRequest || null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })

  batch.set(activityRef, {
    reportId: block.reportId,
    blockId: block.id,
    action: 'block_saved',
    detail: `${block.title} updated.`,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name
  })

  batch.update(reportRef, {
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })

  await batch.commit()
  await recalculateReportProgress(db, block.reportId)
}

const updateBlockReviewState = async ({
  db,
  block,
  user,
  patch,
  action,
  detail
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  patch: Record<string, any>
  action: string
  detail: string
}) => {
  const batch = writeBatch(db)
  batch.update(doc(db, REPORT_COLLECTIONS.blocks, block.id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
  addActivityToBatch({ db, batch, reportId: block.reportId, blockId: block.id, user, action, detail })
  await batch.commit()
  await recalculateReportProgress(db, block.reportId)
}

export const submitReportBlock = async ({
  db,
  block,
  user,
  target
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  target: Exclude<BlockSubmissionTarget, null>
}) => updateBlockReviewState({
  db,
  block,
  user,
  patch: {
    status: 'submitted',
    submittedTo: target,
    submittedAt: serverTimestamp(),
    submittedBy: user.uid,
    submittedByName: user.name,
    changeRequest: null
  },
  action: target === 'department' ? 'submitted_to_department' : 'submitted_to_report_manager',
  detail: target === 'department'
    ? `${block.title} submitted to the department HOD for review.`
    : `${block.title} submitted to the report manager for review.`
})

export const acceptCoordinatorSubmission = async ({
  db,
  block,
  user
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
}) => updateBlockReviewState({
  db,
  block,
  user,
  patch: {
    status: 'submitted',
    submittedTo: 'report_manager',
    departmentReviewedAt: serverTimestamp(),
    departmentReviewedBy: user.uid,
    departmentReviewedByName: user.name,
    changeRequest: null
  },
  action: 'department_review_complete',
  detail: `${block.title} accepted by the HOD and submitted to the report manager.`
})

export const approveReportBlock = async ({
  db,
  block,
  user
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
}) => updateBlockReviewState({
  db,
  block,
  user,
  patch: {
    status: 'approved',
    submittedTo: null,
    approvedAt: serverTimestamp(),
    approvedBy: user.uid,
    approvedByName: user.name,
    changeRequest: null
  },
  action: 'approved',
  detail: `${block.title} approved.`
})

export const requestReportBlockChanges = async ({
  db,
  block,
  user,
  reason,
  target
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  reason: string
  target: 'contributor' | 'department'
}) => updateBlockReviewState({
  db,
  block,
  user,
  patch: {
    status: 'changes_requested',
    submittedTo: null,
    changeRequest: {
      reason: reason || 'Changes requested.',
      target,
      requestedAt: serverTimestamp(),
      requestedBy: user.uid,
      requestedByName: user.name
    }
  },
  action: 'changes_requested',
  detail: reason
})

// Compatibility wrapper for any existing Phase 2 call sites.
export const changeReportBlockStatus = async ({
  db,
  block,
  user,
  status,
  reason
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  status: ReportBlockStatus
  reason?: string
}) => {
  if (status === 'approved') return approveReportBlock({ db, block, user })
  if (status === 'submitted') return submitReportBlock({ db, block, user, target: 'report_manager' })
  if (status === 'changes_requested') {
    return requestReportBlockChanges({ db, block, user, reason: reason || 'Changes requested.', target: 'department' })
  }

  return updateBlockReviewState({
    db,
    block,
    user,
    patch: { status },
    action: status,
    detail: `${block.title}: ${status.replace(/_/g, ' ')}`
  })
}

export const delegateReportBlock = async ({
  db,
  block,
  user,
  contributorIds,
  contributorNames
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  contributorIds: string[]
  contributorNames: string[]
}) => {
  const ids = Array.from(new Set(contributorIds.filter(Boolean)))
  const names = contributorNames.filter(Boolean)

  await updateBlockReviewState({
    db,
    block,
    user,
    patch: {
      delegatedUserIds: ids,
      delegatedUserNames: names,
      delegation: ids.length ? {
        delegatedBy: user.uid,
        delegatedByName: user.name,
        delegatedAt: serverTimestamp()
      } : null,
      contributorKeys: buildContributorKeys(block.editorUserIds, block.editorDepartmentIds, ids)
    },
    action: ids.length ? 'contributors_delegated' : 'contributors_removed',
    detail: ids.length
      ? `${block.title} delegated to ${names.join(', ')}.`
      : `Delegated contributors removed from ${block.title}.`
  })

  // Keep report-level contributor metadata aware of delegated users so client-side
  // Phase 2 progress refreshes can remain scoped. Removed users may remain in this
  // metadata, but block-level access is still governed by reportBlocks.
  if (ids.length) {
    await updateDoc(doc(db, REPORT_COLLECTIONS.reports, block.reportId), {
      contributorKeys: arrayUnion(...ids.map(id => `user:${id}`)),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      updatedByName: user.name
    })
  }
}

export const updateReportProjectAdminMode = async ({
  db,
  report,
  user,
  mode
}: {
  db: Firestore
  report: ReportDocument
  user: ReportUserContext
  mode: ProjectAdminMode
}) => {
  const batch = writeBatch(db)
  batch.update(doc(db, REPORT_COLLECTIONS.reports, report.id), {
    'access.projectAdminMode': mode,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
  addActivityToBatch({
    db,
    batch,
    reportId: report.id,
    user,
    action: 'projectadmin_access_changed',
    detail: `Center Coordinator access changed to ${mode === 'read_only' ? 'read only' : 'full control'}.`
  })
  await batch.commit()
}

/**
 * Applies the latest template structure to an existing report without replacing
 * entered block content, review state, comments, revisions, or delegations.
 */
export const syncReportWithTemplate = async ({
  db,
  report,
  user
}: {
  db: Firestore
  report: ReportDocument
  user: ReportUserContext
}) => {
  if (!canUserManageReport(user, report)) throw new Error('You do not have permission to update this report.')

  const template = await getReportTemplate(db, report.templateId)
  const existingSnap = await getDocs(query(collection(db, REPORT_COLLECTIONS.blocks), where('reportId', '==', report.id)))
  const existingBlocks = existingSnap.docs.map(item => normalizeBlock(item.id, item.data()))
  const existingByTemplateBlockId = new Map(existingBlocks.map(block => [block.templateBlockId, block]))
  const templateBlocks = template.sections.flatMap(section => section.blocks.map((block, index) => ({ section, block, index })))
  const reportRef = doc(db, REPORT_COLLECTIONS.reports, report.id)
  const batch = writeBatch(db)

  templateBlocks.forEach(({ section, block: templateBlock, index }) => {
    const existing = existingByTemplateBlockId.get(templateBlock.id)
    const contributorKeys = buildContributorKeys(
      templateBlock.editorUserIds,
      templateBlock.editorDepartmentIds,
      existing?.delegatedUserIds || []
    )
    const patch = {
      reportId: report.id,
      reportTitle: report.title,
      periodLabel: report.periodLabel,
      templateId: template.id,
      templateBlockId: templateBlock.id,
      sectionId: section.id,
      sectionTitle: section.title,
      sectionOrder: section.order,
      blockOrder: index + 1,
      title: templateBlock.title,
      contentType: templateBlock.contentType,
      required: templateBlock.required,
      carryPolicy: templateBlock.carryPolicy,
      evidencePolicy: templateBlock.evidencePolicy || 'none',
      editorDepartmentIds: templateBlock.editorDepartmentIds || [],
      editorDepartmentNames: templateBlock.editorDepartmentNames || [],
      editorUserIds: templateBlock.editorUserIds || [],
      editorUserNames: templateBlock.editorUserNames || [],
      contributorKeys,
      schema: templateBlock.schema || {},
      sourceDocumentNodeIds: templateBlock.sourceDocumentNodeIds || [],
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      updatedByName: user.name
    }

    if (existing) {
      batch.update(doc(db, REPORT_COLLECTIONS.blocks, existing.id), patch)
      return
    }

    batch.set(doc(collection(db, REPORT_COLLECTIONS.blocks)), {
      ...patch,
      delegatedUserIds: [],
      delegatedUserNames: [],
      delegation: null,
      content: blankContent(templateBlock),
      attachments: [],
      status: 'not_started',
      submittedTo: null,
      changeRequest: null,
      createdAt: serverTimestamp()
    })
  })

  batch.update(reportRef, {
    templateName: template.name,
    templateSignature: getReportTemplateSignature(template),
    frequency: template.frequency,
    contributorKeys: Array.from(new Set(templateBlocks.flatMap(({ block }) => buildContributorKeys(block.editorUserIds, block.editorDepartmentIds)))),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
  addActivityToBatch({
    db,
    batch,
    reportId: report.id,
    user,
    action: 'template_synchronised',
    detail: `Applied the latest ${template.name} template configuration. Existing content and workflow history were preserved.`
  })
  await batch.commit()
  await recalculateReportProgress(db, report.id)
}

export const deleteReport = async ({
  db,
  report,
  user
}: {
  db: Firestore
  report: ReportDocument
  user: ReportUserContext
}) => {
  if (!canUserManageReport(user, report)) throw new Error('You do not have permission to delete this report.')

  const [blocksSnap, activitySnap] = await Promise.all([
    getDocs(query(collection(db, REPORT_COLLECTIONS.blocks), where('reportId', '==', report.id))),
    getDocs(query(collection(db, REPORT_COLLECTIONS.activity), where('reportId', '==', report.id)))
  ])

  await Promise.all(blocksSnap.docs.flatMap(async block => {
    const [comments, revisions] = await Promise.all([
      getDocs(collection(block.ref, 'comments')),
      getDocs(collection(block.ref, 'revisions'))
    ])
    await Promise.all([...comments.docs, ...revisions.docs].map(item => deleteDoc(item.ref)))
    await deleteDoc(block.ref)
  }))
  await Promise.all(activitySnap.docs.map(item => deleteDoc(item.ref)))
  await deleteDoc(doc(db, REPORT_COLLECTIONS.reports, report.id))
}

export const updateReportLock = async ({
  db,
  report,
  user,
  locked,
  reason
}: {
  db: Firestore
  report: ReportDocument
  user: ReportUserContext
  locked: boolean
  reason?: string
}) => {
  const batch = writeBatch(db)
  batch.update(doc(db, REPORT_COLLECTIONS.reports, report.id), {
    lock: locked ? {
      locked: true,
      lockedBy: user.uid,
      lockedByName: user.name,
      lockedAt: serverTimestamp(),
      reason: reason || 'Report locked by Account Manager.'
    } : {
      locked: false,
      lockedBy: null,
      lockedByName: null,
      lockedAt: null,
      reason: null
    },
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
  addActivityToBatch({
    db,
    batch,
    reportId: report.id,
    user,
    action: locked ? 'report_locked' : 'report_unlocked',
    detail: locked ? (reason || 'Report locked by Account Manager.') : 'Report unlocked.'
  })
  await batch.commit()
}

export const addReportBlockAttachmentMetadata = async ({
  db,
  block,
  user,
  attachment
}: {
  db: Firestore
  block: ReportBlock
  user: ReportUserContext
  attachment: { name: string; path: string; url: string; size?: number }
}) => {
  await updateDoc(doc(db, REPORT_COLLECTIONS.blocks, block.id), {
    attachments: arrayUnion({
      ...attachment,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.uid,
      uploadedByName: user.name
    }),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
}

export const addReportComment = async (
  db: Firestore,
  blockId: string,
  user: ReportUserContext,
  text: string
) => {
  const blockRef = doc(db, REPORT_COLLECTIONS.blocks, blockId)
  await addDoc(collection(blockRef, 'comments'), {
    text: text.trim(),
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name
  })
}

export const listenReportComments = (
  db: Firestore,
  blockId: string,
  onData: (comments: ReportComment[]) => void
): Unsubscribe => {
  const blockRef = doc(db, REPORT_COLLECTIONS.blocks, blockId)
  return onSnapshot(collection(blockRef, 'comments'), snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReportComment[]
    rows.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
    onData(rows)
  })
}

export const listenReportRevisions = (
  db: Firestore,
  blockId: string,
  onData: (revisions: ReportRevision[]) => void
): Unsubscribe => {
  const blockRef = doc(db, REPORT_COLLECTIONS.blocks, blockId)
  return onSnapshot(collection(blockRef, 'revisions'), snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReportRevision[]
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    onData(rows)
  })
}

export const listenReportActivity = (
  db: Firestore,
  reportId: string,
  onData: (activity: ReportActivity[]) => void
): Unsubscribe => onSnapshot(
  query(collection(db, REPORT_COLLECTIONS.activity), where('reportId', '==', reportId)),
  snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ReportActivity[]
    rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    onData(rows)
  }
)

export const listPreviousReportsForTemplate = async (
  db: Firestore,
  templateId: string,
  user?: ReportUserContext,
  programId?: string | null
) => {
  if (user && isAccountManager(user) && !isProjectAdmin(user)) {
    if (!programId || !user.managedPrograms.includes(programId)) return []
    const snap = await getDocs(query(collection(db, REPORT_COLLECTIONS.reports), where('programId', '==', programId)))
    return snap.docs
      .map(d => normalizeReport(d.id, d.data()))
      .filter(report => report.templateId === templateId)
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
  }

  const snap = await getDocs(query(collection(db, REPORT_COLLECTIONS.reports), where('templateId', '==', templateId)))
  return snap.docs
    .map(d => normalizeReport(d.id, d.data()))
    .filter(report => !programId || report.programId === programId)
    .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
}

export const createEmptyTemplateStructure = (template: ReportTemplate) => template.sections.map(section => ({
  ...section,
  blocks: section.blocks.map(block => ({ ...block, defaultContent: blankContent(block) }))
}))
