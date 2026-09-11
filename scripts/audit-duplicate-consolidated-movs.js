// Read-only audit: finds consolidatedMOVs (the department/month "pack"
// submitted to M&E) documents that duplicate another one for the same
// department + month + program - almost always caused by a double
// click/double submit on the "Save & Submit to M&E" button, since there was
// no dedup guard or submit-lock on that flow (fixed separately in
// operations/movs/index.tsx).
//
// For each duplicate pair this reports which workflowQueries reference each
// copy (via context.consolidatedMovId) and whether their intervention lists
// are identical, so a human can decide which copy to keep before deleting
// anything - this script makes no writes.
//
// Usage:
//   node scripts/audit-duplicate-consolidated-movs.js [--service-account=path]

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
const serviceAccountArg = args.find(value => value.startsWith('--service-account='))
const serviceAccountPath = path.resolve(
  serviceAccountArg?.slice('--service-account='.length) ||
  'scripts/serviceAccountKey.json'
)
const reportPath = path.resolve('scripts/duplicate-consolidated-movs-report.json')

const account = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
const appName = 'audit-duplicate-consolidated-movs'
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
const iso = value => { const ms = dateMs(value); return ms ? new Date(ms).toISOString() : null }

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

const duplicateGroups = Array.from(groups.entries())
  .filter(([, members]) => members.length > 1)
  .map(([key, members]) => {
    const [department, month, programId] = key.split('|')
    const sorted = members.sort((a, b) => dateMs(a.data.createdAt) - dateMs(b.data.createdAt))
    const interventionIdsOf = pack =>
      (Array.isArray(pack.interventions) ? pack.interventions : [])
        .map(item => clean(item.id))
        .filter(Boolean)
        .sort()
        .join(',')
    const firstSignature = interventionIdsOf(sorted[0].data)
    const identicalInterventions = sorted.every(m => interventionIdsOf(m.data) === firstSignature)

    return {
      department,
      month,
      programId,
      count: sorted.length,
      identicalInterventions,
      copies: sorted.map((member, index) => ({
        id: member.id,
        createdAt: iso(member.data.createdAt),
        status: member.data.status || null,
        totalItems: member.data.totalItems ?? null,
        approvalsCount: Array.isArray(member.data.approvals) ? member.data.approvals.length : 0,
        hasInvoiceAttachment: !!member.data.invoiceAttachment,
        linkedWorkflowQueries: queriesByPackId.get(member.id) || [],
        likelyOriginal: index === 0
      }))
    }
  })
  .sort((a, b) => b.count - a.count)

const report = {
  generatedAt: new Date().toISOString(),
  projectId: account.project_id,
  scannedPacks: packsSnap.size,
  scannedQueries: queriesSnap.size,
  duplicateGroupCount: duplicateGroups.length,
  duplicateDocumentCount: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
  groupsWithLinkedQueriesOnNonOriginal: duplicateGroups.filter(group =>
    group.copies.some(copy => !copy.likelyOriginal && copy.linkedWorkflowQueries.length > 0)
  ).length,
  duplicateGroups
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, duplicateGroups: undefined, reportPath }, null, 2))
