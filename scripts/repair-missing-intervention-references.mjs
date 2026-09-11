/**
 * Repairs open assignments whose interventionId no longer resolves.
 *
 * A repair is eligible when exactly one live definition matches department and
 * title, or when every assignment under the deleted ID has one consistent
 * department/title identity and the original definition can be restored.
 * Linked appointments, sessions, group deliveries and MOVs are updated only
 * through exact assignment links. Assignment-specific orphan uploads can be
 * recovered into resources.
 *
 * Dry run:
 *   node scripts/repair-missing-intervention-references.mjs [--recover-assignment=<id>]
 * Commit:
 *   node scripts/repair-missing-intervention-references.mjs --commit --confirm=repair-missing-intervention-references [--recover-assignment=<id>]
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const PROJECT_ID = 'lph-smart-inc'
const STORAGE_BUCKET = 'lph-smart-inc.firebasestorage.app'
const CONFIRMATION = 'repair-missing-intervention-references'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const commit = process.argv.includes('--commit')
const confirmation = process.argv.find(value => value.startsWith('--confirm='))?.slice('--confirm='.length)
const recoveryAssignmentIds = new Set(process.argv
  .filter(value => value.startsWith('--recover-assignment='))
  .map(value => cleanArg(value.slice('--recover-assignment='.length)))
  .filter(Boolean))

function cleanArg(value) {
  return String(value ?? '').trim()
}

if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
if (commit && confirmation !== CONFIRMATION) {
  throw new Error(`Commit requires --confirm=${CONFIRMATION}`)
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`Service account project is ${serviceAccount.project_id}; expected ${PROJECT_ID}`)
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET
})
const db = admin.firestore()
const bucket = admin.storage().bucket()
const Timestamp = admin.firestore.Timestamp

const clean = value => String(value ?? '').trim()
const normalized = value => clean(value).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
const definitionKey = value => `${normalized(value?.departmentId)}|${normalized(value?.interventionTitle)}`
const isOpen = value => {
  const assignment = normalized(value?.assignmentStatus)
  const assignee = normalized(value?.assigneeCompletionStatus)
  const participant = normalized(value?.participantCompletionStatus)
  return !['completed', 'cancelled', 'needs reassignment'].includes(assignment) &&
    assignee !== 'completed' && participant !== 'confirmed'
}
const fileLabel = name => decodeURIComponent(clean(name).split('/').pop() || 'Evidence file')
  .replace(/^[0-9a-f-]{20,}_\d+_/i, '')
  .replace(/^\d+_[0-9a-f-]{20,}_/i, '')
const resourceLink = value => clean(value?.link || value?.url || value?.href)

function candidateRecurrence(definition) {
  const patch = {}
  for (const field of ['recurrence', 'recurrenceFrequency', 'recurrencePreset', 'frequency', 'recurring']) {
    if (definition[field] !== undefined && definition[field] !== null) patch[field] = definition[field]
  }
  return patch
}

async function linkedQuery(collectionName, field, value) {
  const snapshot = await db.collection(collectionName).where(field, '==', value).get()
  return snapshot.docs.map(document => ({ id: document.id, ref: document.ref, data: document.data() }))
}

async function evidenceInventory(targetAssignmentIds) {
  const byAssignment = new Map()
  if (targetAssignmentIds.size === 0) return byAssignment
  const roots = [
    { prefix: 'intervention-evidence/', assignmentIndex: 3 },
    { prefix: 'poes/', assignmentIndex: 2 }
  ]
  for (const rootPrefix of roots) {
    const [files] = await bucket.getFiles({ prefix: rootPrefix.prefix })
    for (const file of files) {
      const assignmentId = clean(file.name.split('/')[rootPrefix.assignmentIndex])
      if (!targetAssignmentIds.has(assignmentId)) continue
      const [metadata] = await file.getMetadata()
      const token = clean(metadata?.metadata?.firebaseStorageDownloadTokens).split(',')[0]
      if (!token || Number(metadata.size || 0) <= 0) continue
      const link = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(file.name)}?alt=media&token=${encodeURIComponent(token)}`
      const item = {
        name: file.name,
        size: Number(metadata.size || 0),
        timeCreated: metadata.timeCreated || null,
        resource: { type: 'poe', label: fileLabel(file.name), originalName: fileLabel(file.name), link }
      }
      const list = byAssignment.get(assignmentId) || []
      list.push(item)
      byAssignment.set(assignmentId, list)
    }
  }
  return new Map([...byAssignment].map(([assignmentId, files]) => [
    assignmentId,
    [...new Map(files.map(file => [file.resource.link, file])).values()]
  ]))
}

const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const backupDir = path.join(root, 'backups', `missing-intervention-reference-repair-${stamp}`)
const reportPath = path.join(backupDir, 'report.json')

const [assignmentSnapshot, definitionSnapshot] = await Promise.all([
  db.collection('assignedInterventions').get(),
  db.collection('interventions').get()
])
const definitions = new Map(definitionSnapshot.docs.map(document => [document.id, { id: document.id, ...document.data() }]))
const definitionsByKey = new Map()
for (const definition of definitions.values()) {
  const key = definitionKey(definition)
  const list = definitionsByKey.get(key) || []
  list.push(definition)
  definitionsByKey.set(key, list)
}
const assignments = new Map(assignmentSnapshot.docs.map(document => [document.id, { id: document.id, ref: document.ref, data: document.data() }]))
const invalidOpenAssignments = [...assignments.values()].filter(({ data }) =>
  isOpen(data) && !definitions.has(clean(data.interventionId))
)

const eligible = []
const skipped = []
const definitionsToRestore = new Map()

function restoredDefinitionFor(assignment) {
  const oldId = clean(assignment.data.interventionId)
  if (!oldId) return null
  if (definitionsToRestore.has(oldId)) return definitionsToRestore.get(oldId)

  const history = [...assignments.values()].filter(item => clean(item.data.interventionId) === oldId)
  const historicalKeys = new Set(history.map(item => definitionKey(item.data)).filter(Boolean))
  if (historicalKeys.size !== 1 || !historicalKeys.has(definitionKey(assignment.data))) return null

  const recurrence = history.map(item => item.data.recurrence).find(Boolean) || null
  const recurring = history.some(item => normalized(item.data.scheduleMode) === 'recurring' || item.data.recurring === true || Boolean(item.data.recurrence))
  const subInterventions = [...new Map(history
    .filter(item => clean(item.data.subInterventionId))
    .map(item => [clean(item.data.subInterventionId), {
      id: clean(item.data.subInterventionId),
      title: clean(item.data.subInterventionTitle) || clean(item.data.subInterventionId)
    }])).values()]
  const frequency = recurring && recurrence?.unit === 'month' && Number(recurrence?.every || 1) === 1 ? 'monthly' : 'as-needed'
  const representative = assignment.data
  const definition = {
    id: oldId,
    interventionTitle: clean(representative.interventionTitle),
    areaOfSupport: clean(representative.areaOfSupport),
    departmentId: clean(representative.departmentId),
    compulsory: false,
    assignmentMode: recurring ? 'recurring' : 'once-off',
    recurring,
    recurrencePreset: frequency,
    recurrence,
    recurrenceStrict: Boolean(recurrence?.strict),
    recurrenceEnd: null,
    frequency,
    recurrenceFrequency: frequency === 'as-needed' ? 'other' : frequency,
    hasSubInterventions: subInterventions.length > 0,
    subInterventions,
    definitionVersion: 1,
    ...(subInterventions.length ? {} : {
      defaultPlannedSessions: Math.max(1, ...history.map(item => Number(item.data.plannedSessions || 1)))
    }),
    restoredFromDeletedDefinition: true,
    restoredFromAssignmentIds: history.map(item => item.id),
    restoredAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdAt: Timestamp.now()
  }
  definitionsToRestore.set(oldId, definition)
  definitions.set(oldId, definition)
  return definition
}

for (const assignment of invalidOpenAssignments) {
  const candidates = definitionsByKey.get(definitionKey(assignment.data)) || []
  const restored = candidates.length === 0 ? restoredDefinitionFor(assignment) : null
  if (candidates.length !== 1 && !restored) {
    skipped.push({
      assignmentId: assignment.id,
      oldInterventionId: clean(assignment.data.interventionId) || null,
      interventionTitle: clean(assignment.data.interventionTitle),
      departmentId: clean(assignment.data.departmentId),
      reason: candidates.length ? 'ambiguous-current-definition' : 'no-current-definition',
      candidateIds: candidates.map(candidate => candidate.id)
    })
    continue
  }
  eligible.push({ assignment, candidate: candidates[0] || restored })
}

const candidateByAssignmentId = new Map(eligible.map(item => [item.assignment.id, item.candidate]))
const evidenceByAssignment = await evidenceInventory(new Set([
  ...eligible.map(item => item.assignment.id),
  ...recoveryAssignmentIds
]))
const changes = []
const backupByPath = new Map()
const orphanFiles = []
const sessionIds = new Set()

const remember = record => {
  if (record?.ref && !backupByPath.has(record.ref.path)) {
    backupByPath.set(record.ref.path, { path: record.ref.path, data: record.data })
  }
}

for (const definition of definitionsToRestore.values()) {
  const ref = db.collection('interventions').doc(definition.id)
  backupByPath.set(ref.path, { path: ref.path, exists: false, data: null })
  const { id, ...payload } = definition
  changes.push({
    type: 'definition', operation: 'create', path: ref.path, ref, patch: payload,
    oldId: null, newId: id
  })
}

for (const { assignment, candidate } of eligible) {
  remember(assignment)
  const oldId = clean(assignment.data.interventionId) || null
  const uploads = evidenceByAssignment.get(assignment.id) || []
  orphanFiles.push(...uploads.map(upload => ({ assignmentId: assignment.id, ...upload })))
  const existingResources = Array.isArray(assignment.data.resources) ? assignment.data.resources : []
  const linked = new Set(existingResources.map(resourceLink).filter(Boolean))
  const recovered = uploads.map(upload => upload.resource).filter(resource => !linked.has(resource.link))
  const nextResources = [...existingResources, ...recovered]
  const progressUpdates = Array.isArray(assignment.data.progressUpdates) ? assignment.data.progressUpdates : []
  const assignmentPatch = {
    interventionId: candidate.id,
    interventionTitle: candidate.interventionTitle,
    definitionVersion: Number(candidate.definitionVersion || 1),
    definitionSnapshot: {
      ...(assignment.data.definitionSnapshot || {}),
      version: Number(candidate.definitionVersion || 1),
      interventionId: candidate.id,
      interventionTitle: candidate.interventionTitle,
      subInterventionId: assignment.data.subInterventionId || null,
      subInterventionTitle: assignment.data.subInterventionTitle || null,
      capturedAt: assignment.data.definitionSnapshot?.capturedAt || Timestamp.now()
    },
    ...candidateRecurrence(candidate),
    ...(recovered.length ? {
      resources: nextResources,
      progressUpdates: [...progressUpdates, {
        type: 'evidence-recovered',
        source: 'intervention-reference-repair',
        note: 'Recovered POE uploaded before the intervention reference was repaired',
        by: 'system-repair',
        createdAt: Timestamp.now(),
        resources: recovered,
        computedProgress: Number(assignment.data.computedProgress || 0)
      }]
    } : {}),
    interventionReferenceRepair: {
      fromInterventionId: oldId,
      toInterventionId: candidate.id,
      reason: definitionsToRestore.has(oldId)
        ? 'restored-deleted-definition-from-consistent-assignment-history'
        : 'missing-definition-exact-department-title-match',
      repairedAt: Timestamp.now()
    },
    updatedAt: Timestamp.now()
  }
  changes.push({ type: 'assignment', path: assignment.ref.path, ref: assignment.ref, patch: assignmentPatch, oldId, newId: candidate.id, recoveredEvidence: recovered.length })

  const [appointments, movs] = await Promise.all([
    linkedQuery('appointments', 'assignedInterventionId', assignment.id),
    linkedQuery('movDocuments', 'assignedInterventionId', assignment.id)
  ])
  for (const appointment of appointments) {
    remember(appointment)
    if (appointment.data.appointmentSessionId) sessionIds.add(clean(appointment.data.appointmentSessionId))
    changes.push({
      type: 'appointment', path: appointment.ref.path, ref: appointment.ref,
      patch: {
        interventionId: candidate.id,
        interventionTitle: candidate.interventionTitle,
        subInterventionId: assignment.data.subInterventionId || null,
        subInterventionTitle: assignment.data.subInterventionTitle || null,
        interventionReferenceRepairedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }, oldId: clean(appointment.data.interventionId) || null, newId: candidate.id
    })
  }
  for (const mov of movs) {
    remember(mov)
    changes.push({
      type: 'mov', path: mov.ref.path, ref: mov.ref,
      patch: {
        interventionId: candidate.id,
        interventionTitle: candidate.interventionTitle,
        ...candidateRecurrence(candidate),
        interventionReferenceRepairedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }, oldId: clean(mov.data.interventionId) || null, newId: candidate.id
    })
  }
  const groupKey = clean(assignment.data.groupKey)
  if (groupKey) {
    const ref = db.collection('groupInterventionDeliveries').doc(encodeURIComponent(groupKey))
    const snapshot = await ref.get()
    if (snapshot.exists) {
      const groupAssignments = [...assignments.values()].filter(item => clean(item.data.groupKey) === groupKey)
      const resolvedIds = new Set(groupAssignments.map(item => candidateByAssignmentId.get(item.id)?.id || clean(item.data.interventionId)).filter(Boolean))
      if (resolvedIds.size === 1 && resolvedIds.has(candidate.id)) {
        const record = { id: snapshot.id, ref, data: snapshot.data() }
        remember(record)
        changes.push({ type: 'groupDelivery', path: ref.path, ref, patch: {
          interventionId: candidate.id,
          interventionTitle: candidate.interventionTitle,
          interventionReferenceRepairedAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }, oldId: clean(snapshot.data().interventionId) || null, newId: candidate.id })
      } else {
        skipped.push({ assignmentId: assignment.id, groupKey, reason: 'group-members-resolve-to-different-definitions', candidateIds: [...resolvedIds] })
      }
    }
  }
}


const eligibleIds = new Set(eligible.map(item => item.assignment.id))
for (const assignmentId of recoveryAssignmentIds) {
  if (eligibleIds.has(assignmentId)) continue
  const assignment = assignments.get(assignmentId)
  if (!assignment) {
    skipped.push({ assignmentId, reason: 'requested-evidence-recovery-assignment-missing' })
    continue
  }
  const currentDefinitionId = clean(assignment.data.interventionId)
  if (!isOpen(assignment.data) || !definitions.has(currentDefinitionId)) {
    skipped.push({ assignmentId, reason: 'requested-evidence-recovery-requires-open-valid-assignment' })
    continue
  }
  const uploads = evidenceByAssignment.get(assignment.id) || []
  orphanFiles.push(...uploads.map(upload => ({ assignmentId: assignment.id, ...upload })))
  const existingResources = Array.isArray(assignment.data.resources) ? assignment.data.resources : []
  const linked = new Set(existingResources.map(resourceLink).filter(Boolean))
  const recovered = uploads.map(upload => upload.resource).filter(resource => !linked.has(resource.link))
  if (!recovered.length) continue
  remember(assignment)
  changes.push({
    type: 'assignmentEvidence', path: assignment.ref.path, ref: assignment.ref,
    patch: {
      resources: [...existingResources, ...recovered],
      progressUpdates: [...(Array.isArray(assignment.data.progressUpdates) ? assignment.data.progressUpdates : []), {
        type: 'evidence-recovered',
        source: 'intervention-reference-repair',
        note: 'Recovered POE uploaded before the intervention reference was repaired',
        by: 'system-repair',
        createdAt: Timestamp.now(),
        resources: recovered,
        computedProgress: Number(assignment.data.computedProgress || 0)
      }],
      evidenceRecoveredAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    oldId: currentDefinitionId,
    newId: currentDefinitionId,
    recoveredEvidence: recovered.length
  })
}

for (const sessionId of sessionIds) {
  if (!sessionId) continue
  const ref = db.collection('appointmentSessions').doc(sessionId)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    skipped.push({ sessionId, reason: 'linked-session-missing' })
    continue
  }
  const invitationSnapshot = await db.collection('appointments').where('appointmentSessionId', '==', sessionId).get()
  const resolvedIds = new Set()
  for (const invitation of invitationSnapshot.docs) {
    const assignmentId = clean(invitation.data().assignedInterventionId)
    const assignment = assignments.get(assignmentId)
    const resolved = candidateByAssignmentId.get(assignmentId)?.id || clean(assignment?.data.interventionId) || clean(invitation.data().interventionId)
    if (resolved) resolvedIds.add(resolved)
  }
  if (resolvedIds.size !== 1) {
    skipped.push({ sessionId, reason: 'session-invitations-resolve-to-different-definitions', candidateIds: [...resolvedIds] })
    continue
  }
  const newId = [...resolvedIds][0]
  const candidate = definitions.get(newId)
  if (!candidate) {
    skipped.push({ sessionId, reason: 'session-candidate-definition-missing', candidateIds: [newId] })
    continue
  }
  const record = { id: snapshot.id, ref, data: snapshot.data() }
  remember(record)
  changes.push({ type: 'appointmentSession', path: ref.path, ref, patch: {
    interventionId: candidate.id,
    interventionTitle: candidate.interventionTitle,
    interventionReferenceRepairedAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  }, oldId: clean(snapshot.data().interventionId) || null, newId: candidate.id })
}

const dedupedChanges = [...new Map(changes.map(change => [change.path, change])).values()]
fs.mkdirSync(backupDir, { recursive: true })
fs.writeFileSync(path.join(backupDir, 'documents-before.json'), JSON.stringify([...backupByPath.values()], null, 2))
fs.writeFileSync(path.join(backupDir, 'orphan-storage-files.json'), JSON.stringify(orphanFiles, null, 2))

if (commit) {
  for (let index = 0; index < dedupedChanges.length; index += 300) {
    const batch = db.batch()
    dedupedChanges.slice(index, index + 300).forEach(change => {
      if (change.operation === 'create') batch.create(change.ref, change.patch)
      else batch.update(change.ref, change.patch)
    })
    await batch.commit()
  }
}

const verification = []
if (commit) {
  for (const change of dedupedChanges) {
    const snapshot = await change.ref.get()
    verification.push({
      path: change.path,
      exists: snapshot.exists,
      interventionId: change.type === 'definition' ? snapshot.id : clean(snapshot.data()?.interventionId) || null,
      expectedInterventionId: change.newId,
      valid: snapshot.exists && (change.type === 'definition' ? snapshot.id === change.newId : clean(snapshot.data()?.interventionId) === change.newId),
      resourceCount: Array.isArray(snapshot.data()?.resources) ? snapshot.data().resources.length : undefined
    })
  }
  if (verification.some(item => !item.valid)) throw new Error('Post-write verification failed; inspect the generated report and backup.')
}

const report = {
  generatedAt,
  projectId: PROJECT_ID,
  mode: commit ? 'commit' : 'dry-run',
  scannedAssignments: assignmentSnapshot.size,
  liveDefinitions: definitionSnapshot.size,
  invalidOpenAssignments: invalidOpenAssignments.length,
  eligibleAssignments: eligible.length,
  restoredDefinitions: definitionsToRestore.size,
  requestedEvidenceRecoveryAssignments: [...recoveryAssignmentIds],
  skipped,
  changes: dedupedChanges.map(change => ({
    type: change.type,
    path: change.path,
    oldInterventionId: change.oldId,
    newInterventionId: change.newId,
    recoveredEvidence: change.recoveredEvidence || 0
  })),
  orphanFiles: orphanFiles.map(file => ({ assignmentId: file.assignmentId, name: file.name, size: file.size, timeCreated: file.timeCreated })),
  verification,
  backupDir
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await admin.app().delete()
