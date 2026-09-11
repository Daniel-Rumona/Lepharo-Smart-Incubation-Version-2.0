import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore'
import { REPORT_COLLECTIONS } from '../reportConfig'
import { canUserManageTemplate, canUserUseTemplate, isAccountManager, isProjectAdmin } from '../reportPermissions'
import type { ReportTemplate, ReportUserContext, TemplateSection, TemplateFrequency } from '../types'

const normalizeTemplate = (id: string, data: any): ReportTemplate => ({
  id,
  name: data?.name || 'Untitled Template',
  description: data?.description || '',
  frequency: data?.frequency || 'Quarterly',
  status: data?.status || 'active',
  programIds: Array.isArray(data?.programIds) ? data.programIds : [],
  programNames: Array.isArray(data?.programNames) ? data.programNames : [],
  sourceFile: data?.sourceFile || null,
  documentStructure: data?.documentStructure || null,
  sections: Array.isArray(data?.sections) ? data.sections : [],
  createdAt: data?.createdAt,
  createdBy: data?.createdBy,
  createdByName: data?.createdByName,
  updatedAt: data?.updatedAt,
  updatedBy: data?.updatedBy,
  updatedByName: data?.updatedByName
})

export const listenReportTemplates = (
  db: Firestore,
  onData: (templates: ReportTemplate[]) => void
): Unsubscribe => onSnapshot(collection(db, REPORT_COLLECTIONS.templates), snap => {
  const rows = snap.docs
    .map(d => normalizeTemplate(d.id, d.data()))
    .sort((a, b) => a.name.localeCompare(b.name))
  onData(rows)
})

export const listenReportTemplatesForUser = (
  db: Firestore,
  user: ReportUserContext,
  onData: (templates: ReportTemplate[]) => void
): Unsubscribe => listenReportTemplates(db, templates => {
  if (isProjectAdmin(user)) {
    onData(templates)
    return
  }
  if (!isAccountManager(user)) {
    onData([])
    return
  }
  onData(templates.filter(template => canUserManageTemplate(user, template)))
})


export const listenUsableReportTemplatesForUser = (
  db: Firestore,
  user: ReportUserContext,
  onData: (templates: ReportTemplate[]) => void
): Unsubscribe => listenReportTemplates(db, templates => {
  onData(templates.filter(template => canUserUseTemplate(user, template)))
})

export const getReportTemplate = async (db: Firestore, templateId: string) => {
  const snap = await getDoc(doc(db, REPORT_COLLECTIONS.templates, templateId))
  if (!snap.exists()) throw new Error('Report template not found.')
  return normalizeTemplate(snap.id, snap.data())
}

const validateTemplateProgramScope = (user: ReportUserContext, programIds: string[]) => {
  if (isProjectAdmin(user)) return
  if (!isAccountManager(user)) throw new Error('Template management is restricted.')
  if (!programIds.length) throw new Error('Account Managers must assign the template to at least one managed programme.')
  if (!programIds.every(programId => user.managedPrograms.includes(programId))) {
    throw new Error('You can only configure templates for programmes in managedPrograms.')
  }
}

export const createReportTemplate = async ({
  db,
  user,
  name,
  description,
  frequency,
  programIds,
  programNames,
  sections,
  sourceFile,
  id
}: {
  db: Firestore
  user: ReportUserContext
  name: string
  description?: string
  frequency: TemplateFrequency
  programIds?: string[]
  programNames?: string[]
  sections?: TemplateSection[]
  sourceFile?: ReportTemplate['sourceFile']
  id?: string
}) => {
  validateTemplateProgramScope(user, programIds || [])
  const ref = id ? doc(db, REPORT_COLLECTIONS.templates, id) : doc(collection(db, REPORT_COLLECTIONS.templates))
  await setDoc(ref, {
    name,
    description: description || '',
    frequency,
    status: 'active',
    programIds: programIds || [],
    programNames: programNames || [],
    sourceFile: sourceFile || null,
    sections: sections || [],
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.name,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  })
  return ref.id
}

export const updateReportTemplate = async ({
  db,
  templateId,
  user,
  patch
}: {
  db: Firestore
  templateId: string
  user: ReportUserContext
  patch: Partial<Pick<ReportTemplate, 'name' | 'description' | 'frequency' | 'status' | 'programIds' | 'programNames' | 'sections' | 'sourceFile' | 'documentStructure'>>
}) => {
  const existing = await getReportTemplate(db, templateId)
  if (!canUserManageTemplate(user, existing)) throw new Error('You do not manage this template.')
  validateTemplateProgramScope(user, patch.programIds ?? existing.programIds)

  await updateDoc(doc(db, REPORT_COLLECTIONS.templates, templateId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedByName: user.name
  } as any)
}

export const archiveReportTemplate = async (db: Firestore, templateId: string, user: ReportUserContext) => {
  await updateReportTemplate({ db, templateId, user, patch: { status: 'archived' } })
}

export const activateReportTemplate = async (db: Firestore, templateId: string, user: ReportUserContext) => {
  await updateReportTemplate({ db, templateId, user, patch: { status: 'active' } })
}

export const duplicateReportTemplate = async (db: Firestore, templateId: string, user: ReportUserContext) => {
  const source = await getReportTemplate(db, templateId)
  if (!canUserManageTemplate(user, source)) throw new Error('You do not manage this template.')
  return createReportTemplate({
    db,
    user,
    name: `${source.name} Copy`,
    description: source.description,
    frequency: source.frequency,
    programIds: source.programIds,
    programNames: source.programNames,
    sections: source.sections,
    sourceFile: source.sourceFile
  })
}
