export type ReportStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'archived'
export type ReportBlockStatus = 'not_started' | 'draft' | 'changes_requested' | 'submitted' | 'approved'
export type ReportContentType = 'narrative' | 'kpi' | 'table' | 'static'
export type TemplateFrequency = 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual' | 'Ad Hoc'
export type CarryPolicy = 'carry' | 'review' | 'reset'
export type EvidencePolicy = 'none' | 'optional' | 'required'
export type ProjectAdminMode = 'manage' | 'read_only'
export type BlockSubmissionTarget = 'department' | 'report_manager' | null

export type ReportDirectoryDepartment = {
  id: string
  name: string
}

export type ReportDirectoryUser = {
  id: string
  name: string
  email?: string
  role?: string
  departmentId?: string
  departmentName?: string
}

export type ReportDirectoryProgram = {
  id: string
  name: string
  status?: string
}

export type ReportUserContext = {
  uid: string
  name: string
  email: string
  role: string
  departmentId?: string
  departmentName?: string
  isAccountManager: boolean
  managedPrograms: string[]
  canAccessReportsHub: boolean
  canManageTemplates: boolean
}

export type TemplateBlockSchema = {
  columns?: string[]
  indicatorLabel?: string
}

export type ExtractedDocumentNode = {
  id: string
  kind: 'paragraph' | 'table'
  text: string
  style?: string
  list?: boolean
  rows?: Record<string, Record<string, { text: string; colSpan?: number; rowSpan?: number }>>
}

export type ExtractedDocumentStructure = {
  version: 1
  extractedAt: string
  paragraphs: number
  tables: number
  images: number
  headers: number
  footers: number
  styles: string[]
  nodes: ExtractedDocumentNode[]
}

export type TemplateBlock = {
  id: string
  title: string
  contentType: ReportContentType
  required: boolean
  carryPolicy: CarryPolicy
  evidencePolicy?: EvidencePolicy
  editorDepartmentIds: string[]
  editorDepartmentNames?: string[]
  editorUserIds: string[]
  editorUserNames?: string[]
  schema?: TemplateBlockSchema
  defaultContent?: any
  sourceDocumentNodeIds?: string[]
}

export type TemplateSection = {
  id: string
  title: string
  order: number
  blocks: TemplateBlock[]
}

export type ReportTemplate = {
  id: string
  name: string
  description?: string
  frequency: TemplateFrequency
  status: 'active' | 'archived'
  programIds: string[]
  programNames?: string[]
  sourceFile?: {
    name: string
    path: string
    url: string
    size?: number
  } | null
  documentStructure?: ExtractedDocumentStructure | null
  sections: TemplateSection[]
  createdAt?: any
  createdBy?: string
  createdByName?: string
  updatedAt?: any
  updatedBy?: string
  updatedByName?: string
}

export type ReportAccess = {
  projectAdminMode: ProjectAdminMode
}

export type ReportLock = {
  locked: boolean
  lockedBy?: string | null
  lockedByName?: string | null
  lockedAt?: any
  reason?: string | null
}

export type ReportDocument = {
  id: string
  templateId: string
  templateName: string
  templateSignature?: string | null
  title: string
  periodLabel: string
  frequency: TemplateFrequency
  frequency: TemplateFrequency
  programId?: string | null
  programName?: string | null
  sourceReportId?: string | null
  sourceReportTitle?: string | null
  status: ReportStatus
  totalBlocks: number
  completedBlocks: number
  progressPercent: number
  contributorKeys: string[]
  access: ReportAccess
  lock: ReportLock
  createdAt?: any
  createdBy?: string
  createdByName?: string
  updatedAt?: any
  updatedBy?: string
  updatedByName?: string
}

export type ReportBlock = {
  id: string
  reportId: string
  reportTitle: string
  periodLabel: string
  templateId: string
  templateBlockId: string
  sectionId: string
  sectionTitle: string
  sectionOrder: number
  blockOrder: number
  title: string
  contentType: ReportContentType
  required: boolean
  carryPolicy: CarryPolicy
  carriedFromPeriodLabel?: string | null
  evidencePolicy: EvidencePolicy

  // Template-level ownership. For normal operations users this is the HOD/department scope.
  editorDepartmentIds: string[]
  editorDepartmentNames?: string[]

  // Optional fixed contributors configured on the template.
  editorUserIds: string[]
  editorUserNames?: string[]

  // Runtime delegation performed by an operations/HOD user.
  delegatedUserIds: string[]
  delegatedUserNames?: string[]
  delegation?: {
    delegatedBy: string
    delegatedByName: string
    delegatedAt?: any
  } | null

  contributorKeys: string[]
  schema?: TemplateBlockSchema
  sourceDocumentNodeIds?: string[]
  content: any
  attachments?: Array<{
    name: string
    path: string
    url: string
    size?: number
    uploadedAt?: any
    uploadedBy?: string
    uploadedByName?: string
  }>

  status: ReportBlockStatus
  submittedTo?: BlockSubmissionTarget
  submittedAt?: any
  submittedBy?: string
  submittedByName?: string

  departmentReviewedAt?: any
  departmentReviewedBy?: string
  departmentReviewedByName?: string

  approvedAt?: any
  approvedBy?: string
  approvedByName?: string

  changeRequest?: {
    reason: string
    target?: 'contributor' | 'department'
    requestedAt?: any
    requestedBy?: string
    requestedByName?: string
  } | null

  createdAt?: any
  updatedAt?: any
  updatedBy?: string
  updatedByName?: string
}

export type CarryOverOptions = {
  carryNarrative: boolean
  carryOpenItems: boolean
  carryTargets: boolean
  carryActuals: boolean
  carryAttachments: boolean
}

export type CreateReportInput = {
  templateId: string
  title: string
  periodLabel: string
  programId?: string | null
  programName?: string | null
  startMode: 'fresh' | 'carry_over'
  sourceReportId?: string | null
  carryOver: CarryOverOptions
}

export type ReportComment = {
  id: string
  text: string
  createdAt?: any
  createdBy: string
  createdByName: string
}

export type ReportRevision = {
  id: string
  status: ReportBlockStatus
  content: any
  createdAt?: any
  createdBy: string
  createdByName: string
  summary?: string
}

export type ReportActivity = {
  id: string
  reportId: string
  blockId?: string | null
  action: string
  detail?: string
  createdAt?: any
  createdBy: string
  createdByName: string
}
