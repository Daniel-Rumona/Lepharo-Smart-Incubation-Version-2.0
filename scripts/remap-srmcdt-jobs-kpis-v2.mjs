/**
 * Second remap: jobContractsCreated/jobContractsSustained no longer exist as
 * standalone source types - Jobs Created/Sustained now live back under the
 * single "metrics" source (field: jobsCreated/jobsSustained), with the
 * compute engine redirecting just those two fields to hseJobContracts.
 *
 * Dry run:
 *   node scripts/remap-srmcdt-jobs-kpis-v2.mjs
 * Commit:
 *   node scripts/remap-srmcdt-jobs-kpis-v2.mjs --commit --confirm=remap-srmcdt-jobs-kpis-v2
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const PROJECT_ID = 'lph-smart-inc'
const CONFIRMATION = 'remap-srmcdt-jobs-kpis-v2'
const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = path.join(here, 'serviceAccountKey.json')
const commit = process.argv.includes('--commit')
const confirmation = process.argv.find(v => v.startsWith('--confirm='))?.slice('--confirm='.length)

if (commit && confirmation !== CONFIRMATION) {
  throw new Error(`Commit requires --confirm=${CONFIRMATION}`)
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`Service account project is ${serviceAccount.project_id}; expected ${PROJECT_ID}`)
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const REMAP = {
  jobContractsCreated: 'jobsCreated',
  jobContractsSustained: 'jobsSustained'
}

const snap = await db.collection('kpiDefinitions').where('seedSource', '==', 'srmcdt-kpi-letters-test-seed').get()
let updated = 0

for (const doc of snap.docs) {
  const data = doc.data()
  const newField = REMAP[data.sourceType]
  if (!newField) continue

  console.log(`[${data.department}] "${data.kpiLabel}": sourceType ${data.sourceType} -> metrics, field -> ${newField}`)
  if (commit) {
    await doc.ref.update({
      sourceType: 'metrics',
      sourceCollection: 'participantMonthlyMetrics',
      field: newField,
      calculationType: 'sum',
      countMode: null,
      updatedAt: new Date()
    })
  }
  updated += 1
}

console.log(`\n${commit ? 'Updated' : 'Would update'}: ${updated} KPI(s).`)
if (!commit) console.log('Re-run with --commit --confirm=remap-srmcdt-jobs-kpis-v2 to write these.')
process.exit(0)
