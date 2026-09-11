// Repair: for each set of consolidatedMOVs documents that duplicate another
// one for the same department + month + program (a double-click/double-submit
// bug in operations/movs, fixed separately in code), keep the earliest copy
// and remove the later one(s).
//
// Interventions are confirmed identical within each duplicate group (checked
// by the audit script), so nothing is lost from the kept copy. Some
// duplicates picked up their own, different workflowQueries over time (e.g.
// the HSE / 2026-03 pair) - those queries are re-pointed to the kept copy's
// id (context.consolidatedMovId) before the later copy is deleted, so no
// query history is lost.
//
// Usage:
//   node scripts/fix-duplicate-consolidated-movs.js                        (dry run)
//   node scripts/fix-duplicate-consolidated-movs.js --commit --confirm=fix-duplicate-consolidated-movs

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

if (Number(process.versions.node.split('.')[0]) >= 25) {
  const require = createRequire(import.meta.url)
  const bufferModule = require('buffer')
  if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
}

const { cert, getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const confirmed = args.includes('--confirm=fix-duplicate-consolidated-movs')
// Skip any duplicate group that needs query re-pointing (i.e. both copies
// picked up their own query history) - handle those manually/separately once
// reviewed, and only auto-resolve the clean groups.
const onlyClean = args.includes('--only-clean')
const serviceAccountArg = args.find(value => value.startsWith('--service-account='))
const serviceAccountPath = path.resolve(
  serviceAccountArg?.slice('--service-account='.length) ||
  'scripts/serviceAccountKey.json'
)
const reportPath = path.resolve('scripts/fix-duplicate-consolidated-movs-report.json')

if (commit && !confirmed) {
  throw new Error('Commit requires --confirm=fix-duplicate-consolidated-movs')
}

const account = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
const appName = 'fix-duplicate-consolidated-movs'
const app = getApps().find(item => item.name === appName) ||
  initializeApp({ credential: cert(account) }, appName)
const db = getFirestore(app)

const clean = value => String(value ?? '').trim()
const dateMs = value => {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

console.log('Fetching consolidatedMOVs and workflowQueries...')
const [packsSnap, queriesSnap] = await Promise.all([
  db.collection('consolidatedMOVs').get(),
  db.collection('workflowQueries').get()
])

const queriesByPackId = new Map()
queriesSnap.docs.forEach(document => {
  const data = document.data()
  const packId = clean(data.context?.consolidatedMovId)
  if (!packId) return
  queriesByPackId.set(packId, [...(queriesByPackId.get(packId) || []), document.id])
})

const groups = new Map()
packsSnap.docs.forEach(document => {
  const pack = document.data()
  const key = [clean(pack.department), clean(pack.month), clean(pack.programId)].join('|')
  groups.set(key, [...(groups.get(key) || []), { id: document.id, data: pack }])
})

const interventionIdsOf = pack =>
  (Array.isArray(pack.interventions) ? pack.interventions : [])
    .map(item => clean(item.id))
    .filter(Boolean)
    .sort()
    .join(',')

const plan = []
const skipped = []

for (const [key, members] of groups.entries()) {
  if (members.length < 2) continue
  const [department, month, programId] = key.split('|')
  const sorted = members.sort((a, b) => dateMs(a.data.createdAt) - dateMs(b.data.createdAt))
  const keep = sorted[0]
  const duplicates = sorted.slice(1)

  const firstSignature = interventionIdsOf(keep.data)
  const allIdentical = sorted.every(m => interventionIdsOf(m.data) === firstSignature)

  if (!allIdentical) {
    skipped.push({ department, month, programId, reason: 'Interventions differ between copies - needs manual review', memberIds: sorted.map(m => m.id) })
    continue
  }

  duplicates.forEach(duplicate => {
    const queriesToRepoint = queriesByPackId.get(duplicate.id) || []

    if (onlyClean && queriesToRepoint.length > 0) {
      skipped.push({ department, month, programId, reason: '--only-clean: needs query re-pointing, deferred', memberIds: [keep.id, duplicate.id] })
      return
    }

    plan.push({
      department,
      month,
      programId,
      keepId: keep.id,
      deleteId: duplicate.id,
      queriesToRepoint
    })
  })
}

if (commit) {
  for (const item of plan) {
    const batch = db.batch()
    item.queriesToRepoint.forEach(queryId => {
      batch.update(db.collection('workflowQueries').doc(queryId), {
        'context.consolidatedMovId': item.keepId
      })
    })
    batch.delete(db.collection('consolidatedMOVs').doc(item.deleteId))
    await batch.commit()
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: commit ? 'commit' : 'dry-run',
  scannedPacks: packsSnap.size,
  duplicatesResolved: plan.length,
  queriesRepointed: plan.reduce((sum, item) => sum + item.queriesToRepoint.length, 0),
  skippedForManualReview: skipped.length,
  plan,
  skipped
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, plan: undefined, skipped: undefined, reportPath }, null, 2))
