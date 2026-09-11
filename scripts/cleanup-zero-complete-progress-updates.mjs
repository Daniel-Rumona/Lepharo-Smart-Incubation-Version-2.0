/**
 * Removes the contradictory legacy progress event "Complete" at 0%.
 *
 * Dry-run by default:
 *   node scripts/cleanup-zero-complete-progress-updates.mjs
 * Apply the cleanup:
 *   node scripts/cleanup-zero-complete-progress-updates.mjs --write
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

const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const writeMode = process.argv.includes('--write')
const reportPath = path.join(here, 'zero-complete-progress-cleanup-report.json')
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = admin.firestore()
const clean = value => String(value ?? '').trim().toLowerCase()
const updates = value => Array.isArray(value) ? value : []
const isMalformed = update =>
  Number(update?.computedProgress ?? update?.progress ?? update?.deliveryWorkProgress ?? 0) <= 0 &&
  /^(complete|completed|intervention completed)$/.test(clean(update?.note)) &&
  !updates(update?.resources).some(resource => clean(resource?.link))
const dateMs = value => value?.toDate?.()?.getTime?.() || (typeof value?.seconds === 'number' ? Number(value.seconds) * 1000 : new Date(value || 0).getTime())
const completionKey = update => {
  const progress = Number(update?.computedProgress ?? update?.progress ?? update?.deliveryWorkProgress ?? 0)
  const ms = dateMs(update?.createdAt)
  if (progress < 100 || !Number.isFinite(ms) || !ms) return null
  const minute = Math.floor(ms / 60000)
  return `${minute}:${clean(update?.note || 'progress updated')}`
}

const snapshot = await db.collection('assignedInterventions').get()
const changes = []
for (const document of snapshot.docs) {
  const data = document.data()
  const current = updates(data.progressUpdates)
  const seenCompletions = new Set()
  const removed = []
  const retained = []
  current.forEach(update => {
    const key = completionKey(update)
    if (isMalformed(update) || (key && seenCompletions.has(key))) removed.push(update)
    else {
      if (key) seenCompletions.add(key)
      retained.push(update)
    }
  })
  if (!removed.length) continue
  changes.push({
    id: document.id,
    removed: removed.map(update => ({ note: update.note, computedProgress: update.computedProgress, createdAt: update.createdAt }))
  })
  if (writeMode) {
    await document.ref.update({
      progressUpdates: retained,
      updatedAt: admin.firestore.Timestamp.now()
    })
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: writeMode ? 'write' : 'dry-run',
  scannedAssignments: snapshot.size,
  affectedAssignments: changes.length,
  removedUpdates: changes.reduce((count, change) => count + change.removed.length, 0),
  changes
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, reportPath }, null, 2))
