import type { ReportBlock, ReportDocument, ReportTemplate, ReportUserContext } from './types'

const normalizeRole = (value?: string | null) => String(value || '').trim().toLowerCase()

export const isProjectAdmin = (user: Pick<ReportUserContext, 'role'>) =>
  normalizeRole(user.role) === 'projectadmin'

export const isOperations = (user: Pick<ReportUserContext, 'role'>) =>
  normalizeRole(user.role) === 'operations'

export const isCoordinator = (user: Pick<ReportUserContext, 'role'>) =>
  normalizeRole(user.role) === 'coordinator'

export const isAccountManager = (user: Pick<ReportUserContext, 'role' | 'isAccountManager'>) =>
  isOperations(user) && user.isAccountManager === true

export const isAccountManagerForProgram = (
  user: Pick<ReportUserContext, 'role' | 'isAccountManager' | 'managedPrograms'>,
  programId?: string | null
) => {
  if (!programId) return false
  return isAccountManager(user) && user.managedPrograms.includes(programId)
}

export const canUserAccessReportsHub = (user: ReportUserContext) =>
  isProjectAdmin(user) || (isAccountManager(user) && user.managedPrograms.length > 0)

export const canUserManageTemplates = (user: ReportUserContext) =>
  isProjectAdmin(user) || (isAccountManager(user) && user.managedPrograms.length > 0)

export const canUserManageTemplate = (user: ReportUserContext, template: Pick<ReportTemplate, 'programIds'>) => {
  if (isProjectAdmin(user)) return true
  if (!isAccountManager(user)) return false
  if (!template.programIds.length) return false
  return template.programIds.every(programId => user.managedPrograms.includes(programId))
}


export const canUserUseTemplate = (user: ReportUserContext, template: Pick<ReportTemplate, 'programIds'>) => {
  if (isProjectAdmin(user)) return true
  if (!isAccountManager(user) || !user.managedPrograms.length) return false
  if (!template.programIds.length) return true
  return template.programIds.some(programId => user.managedPrograms.includes(programId))
}

export const canUserCreateForProgram = (user: ReportUserContext, programId?: string | null) => {
  if (isProjectAdmin(user)) return true
  return isAccountManagerForProgram(user, programId)
}

export const canUserViewFullReport = (user: ReportUserContext, report: ReportDocument) => {
  if (isAccountManagerForProgram(user, report.programId)) return true
  if (isProjectAdmin(user)) return true
  return false
}

export const canUserManageReport = (user: ReportUserContext, report: ReportDocument) => {
  if (report.lock?.locked) return false

  if (isAccountManagerForProgram(user, report.programId)) return true

  if (isProjectAdmin(user)) {
    return report.access?.projectAdminMode !== 'read_only'
  }

  return false
}

export const canUserControlProjectAdminMode = (user: ReportUserContext, report: ReportDocument) =>
  isAccountManagerForProgram(user, report.programId)

export const canUserManageDepartmentBlock = (
  user: ReportUserContext,
  block: Pick<ReportBlock, 'editorDepartmentIds'>
) => isOperations(user) && !!user.departmentId && block.editorDepartmentIds.includes(user.departmentId)

export const isDelegatedContributor = (
  user: ReportUserContext,
  block: Pick<ReportBlock, 'delegatedUserIds' | 'editorUserIds'>
) => block.delegatedUserIds.includes(user.uid) || block.editorUserIds.includes(user.uid)

export const canUserViewBlock = (
  user: ReportUserContext,
  report: ReportDocument,
  block: Pick<ReportBlock, 'editorDepartmentIds' | 'editorUserIds' | 'delegatedUserIds'>
) => {
  if (canUserViewFullReport(user, report)) return true
  if (canUserManageDepartmentBlock(user, block)) return true
  if (isDelegatedContributor(user, block)) return true
  return false
}

export const canUserEditBlock = (
  user: ReportUserContext,
  report: ReportDocument,
  block: ReportBlock
) => {
  if (report.lock?.locked) return false
  if (canUserManageReport(user, report)) return block.status !== 'approved'

  if (canUserManageDepartmentBlock(user, block)) {
    return block.status !== 'approved' && !(block.status === 'submitted' && block.submittedTo === 'report_manager')
  }

  if (isDelegatedContributor(user, block)) {
    return block.status !== 'approved' && !(block.status === 'submitted')
  }

  return false
}

export const canUserDelegateBlock = (
  user: ReportUserContext,
  report: ReportDocument,
  block: ReportBlock
) => !report.lock?.locked && canUserManageDepartmentBlock(user, block) && block.status !== 'approved'

export const canUserReviewContributorSubmission = (
  user: ReportUserContext,
  block: ReportBlock
) => canUserManageDepartmentBlock(user, block)
    && block.status === 'submitted'
    && block.submittedTo === 'department'

export const canUserReviewDepartmentSubmission = (
  user: ReportUserContext,
  report: ReportDocument,
  block: ReportBlock
) => canUserManageReport(user, report)
    && block.status === 'submitted'
    && block.submittedTo === 'report_manager'

export const buildContributorKeys = (
  userIds: string[] = [],
  departmentIds: string[] = [],
  delegatedUserIds: string[] = []
) => Array.from(new Set([
  ...userIds.filter(Boolean).map(id => `user:${id}`),
  ...delegatedUserIds.filter(Boolean).map(id => `user:${id}`),
  ...departmentIds.filter(Boolean).map(id => `department:${id}`)
]))

export const buildUserContributorKeys = (user: Pick<ReportUserContext, 'uid' | 'departmentId' | 'role'>) => [
  `user:${user.uid}`,
  ...(isOperations(user) && user.departmentId ? [`department:${user.departmentId}`] : [])
]
