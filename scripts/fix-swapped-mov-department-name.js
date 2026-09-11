// One-off repair: 10 MOVs created by Lungile Ngobeni for the "Marketing
// Skills Module" intervention (facilitator Mahlodi Makoko) have
// departmentName and areaOfSupport swapped - departmentName was set to
// "Training Academy" (an area-of-support label) instead of the real
// department name resolved from departmentId ("NVC (New Venture Creation)"),
// while areaOfSupport ended up holding the correct department name instead.
// This makes the MOVs invisible to operations/movs, which filters strictly
// on departmentName, even though they show up fine on coordinator/movs
// (which scopes by facilitator identity instead).
//
// This script finds every movDocuments record whose departmentId resolves
// (via the departments collection) to a name that does NOT match its stored
// departmentName, and swaps departmentName/areaOfSupport back so
// departmentName matches the department the MOV is actually filed under.
//
// Usage:
//   node scripts/fix-swapped-mov-department-name.js                        (dry run)
//   node scripts/fix-swapped-mov-department-name.js --commit --confirm=fix-swapped-mov-department-name

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
const confirmed = args.includes('--confirm=fix-swapped-mov-department-name')
const serviceAccountArg = args.find(value => value.startsWith('--service-account='))
const serviceAccountPath = path.resolve(
  serviceAccountArg?.slice('--service-account='.length) ||
  'scripts/serviceAccountKey.json'
)
const reportPath = path.resolve('scripts/fix-swapped-mov-department-name-report.json')

if (commit && !confirmed) {
  throw new Error('Commit requires --confirm=fix-swapped-mov-department-name')
}

const account = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
const appName = 'fix-swapped-mov-department-name'
const app = getApps().find(item => item.name === appName) ||
  initializeApp({ credential: cert(account) }, appName)
const db = getFirestore(app)

const clean = value => String(value ?? '').trim()

console.log('Fetching movDocuments and departments...')
const [movsSnap, deptsSnap] = await Promise.all([
  db.collection('movDocuments').get(),
  db.collection('departments').get()
])
const deptNameById = new Map(deptsSnap.docs.map(item => [item.id, item.data().name]))

const planned = []

movsSnap.docs.forEach(document => {
  const mov = document.data()
  const departmentId = clean(mov.departmentId)
  if (!departmentId) return

  const realName = deptNameById.get(departmentId)
  if (!realName) return

  const storedName = clean(mov.departmentName)
  if (storedName === clean(realName)) return

  // Only auto-fix the specific swap pattern we've confirmed: the current
  // areaOfSupport already holds the correct department name, so swapping is
  // safe. Anything else gets flagged but left untouched for manual review.
  const isConfirmedSwap = clean(mov.areaOfSupport) === clean(realName)

  planned.push({
    id: document.id,
    smmeCompanyName: mov.smmeCompanyName || null,
    interventionTitle: mov.interventionTitle || null,
    createdByName: mov.createdByName || null,
    facilitatorName: mov.facilitatorName || null,
    departmentId,
    from: { departmentName: mov.departmentName || null, areaOfSupport: mov.areaOfSupport || null },
    to: isConfirmedSwap
      ? { departmentName: realName, areaOfSupport: mov.departmentName || null }
      : null,
    action: isConfirmedSwap ? 'swap' : 'needs-manual-review'
  })
})

const toApply = planned.filter(item => item.action === 'swap')

if (commit) {
  for (let offset = 0; offset < toApply.length; offset += 400) {
    const batch = db.batch()
    toApply.slice(offset, offset + 400).forEach(item => {
      batch.update(db.collection('movDocuments').doc(item.id), {
        departmentName: item.to.departmentName,
        areaOfSupport: item.to.areaOfSupport
      })
    })
    await batch.commit()
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: commit ? 'commit' : 'dry-run',
  scannedMovs: movsSnap.size,
  mismatchedDepartmentName: planned.length,
  autoFixed: toApply.length,
  needsManualReview: planned.length - toApply.length,
  changes: planned
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, changes: undefined, reportPath }, null, 2))
