/**
 * Migrate historical POE data into assignedInterventions.resources and remove
 * deprecated assignment fields. interventionsDatabase is read-only source data
 * for the migration; this script never writes to that collection.
 *
 * Dry-run by default:
 *   node scripts/sync-intervention-records.mjs
 * Apply changes:
 *   node scripts/sync-intervention-records.mjs --write
 *
 * The service-account key is never committed. Set SERVICE_ACCOUNT_KEY to its
 * path, or use scripts/serviceAccountKey.json locally.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// buffer-equal-constant-time (pulled in by older Firebase dependencies) still
// references buffer.SlowBuffer. Node 26 removed that alias, so restore it
// before loading firebase-admin. This is only a compatibility alias; it does
// not alter Buffer behaviour.
const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const writeMode = process.argv.includes('--write')
const reportPath = path.join(here, 'intervention-record-sync-report.json')

if (!fs.existsSync(keyPath)) {
  throw new Error(`Service account key not found: ${keyPath}`)
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

const text = value => String(value ?? '').trim()
const first = (...values) => values.find(value => value !== undefined && value !== null && text(value) !== '')
const asArray = value => Array.isArray(value) ? value : []
const resourceUrl = item => typeof item === 'string' ? item : item?.link || item?.url || item?.href || ''

function mergeResources(...records) {
  const byUrl = new Map()
  records.flatMap(record => [
    ...asArray(record?.resources),
    ...asArray(record?.progressUpdates).flatMap(update => asArray(update?.resources))
  ]).forEach(item => {
    const link = resourceUrl(item)
    if (!link) return
    byUrl.set(link, typeof item === 'string' ? { link } : { ...item, link })
  })
  return [...byUrl.values()]
}

function primaryPoe(...records) {
  const resources = mergeResources(...records)
  const direct = records.flatMap(record => [
    record?.poeFileUrl,
    record?.proofOfExecutionUrl,
    record?.poeUrl,
    record?.evidenceUrl,
    record?.movPoeUrl,
    record?.movFileUrl
  ])
  return first(...direct, ...resources.map(resourceUrl)) || null
}

function canonicalPatch(assignment, delivery) {
  const resources = mergeResources(assignment, delivery)
  const poe = primaryPoe(assignment, delivery)
  const normalizedResources = resources.slice()
  if (poe && !normalizedResources.some(resource => resource.link === poe)) {
    normalizedResources.push({ type: 'poe', label: 'Proof of Execution', link: poe })
  }

  // Resources is the sole managed evidence field. Other legacy POE aliases
  // are deliberately removed from assignments during this migration.
  return { resources: normalizedResources, schemaVersion: 3 }
}

function comparable(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.toISOString()
  return value
}

function changedFields(current, patch) {
  const changed = {}
  for (const [key, value] of Object.entries(patch)) {
    const left = JSON.stringify(comparable(current?.[key]))
    const right = JSON.stringify(comparable(value))
    if (left !== right) changed[key] = value
  }
  return changed
}

function reportValue(value) {
  if (value && typeof value === 'object' && value._methodName === 'FieldValue.delete') return '(deleted)'
  if (value && typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(reportValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reportValue(item)]))
  }
  return value
}

function describeChanges(current, patch) {
  return Object.fromEntries(
    Object.entries(patch).map(([field, after]) => {
      const before = field === 'tracking.documentsUploaded'
        ? current?.tracking?.documentsUploaded
        : current?.[field]
      return [field, {
      before: before === undefined ? '(missing)' : reportValue(before),
      after: field === 'tracking.documentsUploaded' ? '(deleted)' : reportValue(after)
      }]
    })
  )
}

function addDeleteIfPresent(patch, assignment, field) {
  if (field === 'tracking.documentsUploaded') {
    if (assignment?.tracking && Object.hasOwn(assignment.tracking, 'documentsUploaded')) {
      patch[field] = FieldValue.delete()
    }
    return
  }
  if (Object.hasOwn(assignment || {}, field)) patch[field] = FieldValue.delete()
}

async function run() {
  const assignments = await db.collection('assignedInterventions').get()
  // Legacy delivery records are read only so their POEs can be moved into the
  // assignment's single managed resources field.
  const deliveries = await db.collection('interventionsDatabase').get()
  const deliveryByAssigned = new Map()

  deliveries.docs.forEach(doc => {
    const data = doc.data()
    const key = text(data.assignedInterventionId)
    if (!key) return
    const list = deliveryByAssigned.get(key) || []
    list.push(doc)
    deliveryByAssigned.set(key, list)
  })

  const report = {
    generatedAt: new Date().toISOString(),
    mode: writeMode ? 'write' : 'dry-run',
    scannedAssignments: assignments.size,
    scannedDeliveryRecords: deliveries.size,
    changedAssignments: 0,
    changedDeliveryRecords: 0,
    createdDeliveryRecords: 0,
    duplicateDeliveryLinks: 0,
    errors: [],
    changes: []
  }

  let pendingBatch = writeMode ? db.batch() : null
  let pendingWrites = 0

  for (const assignmentDoc of assignments.docs) {
    const assignedId = assignmentDoc.id
    const assignment = assignmentDoc.data()
    const linked = deliveryByAssigned.get(assignedId) || []
    let primary = linked[0] || null

    if (!primary && text(assignment.interventionsDatabaseId)) {
      const candidate = await db.collection('interventionsDatabase').doc(text(assignment.interventionsDatabaseId)).get()
      if (candidate.exists) primary = candidate
    }

    const databaseId = primary?.id || null
    const delivery = primary?.data() || null
    const cleanup = { ...canonicalPatch(assignment, delivery) }
    ;[
      'interventionsDatabaseId',
      'databaseInterventionId',
      'poeFileUrl',
      'proofOfExecutionUrl',
      'poeUrl',
      'evidenceUrl',
      'tracking.documentsUploaded'
    ].forEach(field => addDeleteIfPresent(cleanup, assignment, field))
    const assignmentPatch = changedFields(assignment, cleanup)

    if (Object.keys(assignmentPatch).length) {
      report.changes.push({
        assignedInterventionId: assignedId,
        databaseInterventionId: databaseId,
        assignmentChanges: describeChanges(assignment, assignmentPatch),
        sourceDeliveryRecord: databaseId
      })
    }

    if (linked.length > 1) report.duplicateDeliveryLinks += linked.length - 1
    if (!writeMode || !Object.keys(assignmentPatch).length) continue
    pendingBatch.update(assignmentDoc.ref, { ...assignmentPatch, updatedAt: FieldValue.serverTimestamp() })
    report.changedAssignments += 1
    pendingWrites += 1
    // Firestore batches have a 500-operation limit. Keep some headroom.
    if (pendingWrites >= 400) {
      try {
        await pendingBatch.commit()
        pendingBatch = db.batch()
        pendingWrites = 0
      } catch (error) {
        report.errors.push({ assignedInterventionId: assignedId, message: error?.message || String(error) })
        pendingBatch = db.batch()
        pendingWrites = 0
      }
    }
  }

  if (writeMode && pendingWrites > 0) {
    try {
      await pendingBatch.commit()
    } catch (error) {
      report.errors.push({ message: error?.message || String(error) })
    }
  }

  report.plannedChanges = report.changes.length
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    mode: report.mode,
    scannedAssignments: report.scannedAssignments,
    scannedDeliveryRecords: report.scannedDeliveryRecords,
    plannedChanges: report.plannedChanges,
    changedAssignments: report.changedAssignments,
    changedDeliveryRecords: report.changedDeliveryRecords,
    duplicateDeliveryLinks: report.duplicateDeliveryLinks,
    errors: report.errors.length,
    reportPath
  }, null, 2))
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
