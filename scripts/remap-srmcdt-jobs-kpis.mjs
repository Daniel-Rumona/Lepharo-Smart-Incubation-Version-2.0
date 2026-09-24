/**
 * Repoints the 4 "jobs" KPIs seeded by seed-srmcdt-kpis.mjs (Direct Jobs /
 * Jobs Sustained, for both Financial Compliance and HSE) from the placeholder
 * 'metrics' source (participantMonthlyMetrics - empty, never written to) onto
 * the real hseJobContracts collection, using the new jobContractsCreated /
 * jobContractsSustained source types added to the KPI engine.
 *
 * A job contract is registered by HSE, but the decision to create/sustain it
 * is joint with Financial Compliance - both departments' KPIs read the same
 * underlying data.
 *
 * Dry run:
 *   node scripts/remap-srmcdt-jobs-kpis.mjs
 * Commit:
 *   node scripts/remap-srmcdt-jobs-kpis.mjs --commit --confirm=remap-srmcdt-jobs-kpis
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
const CONFIRMATION = 'remap-srmcdt-jobs-kpis'
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
  'Direct Jobs Management accounts': 'jobContractsCreated',
  'Jobs sustained Management accounts': 'jobContractsSustained',
  'Collection of Direct Jobs for the MSME': 'jobContractsCreated',
  'Collection & confirmation of Jobs Sustained for the MSME': 'jobContractsSustained'
}

const snap = await db.collection('kpiDefinitions').where('seedSource', '==', 'srmcdt-kpi-letters-test-seed').get()
let updated = 0

for (const doc of snap.docs) {
  const data = doc.data()
  const newSourceType = REMAP[data.kpiLabel]
  if (!newSourceType) continue

  console.log(`[${data.department}] "${data.kpiLabel}": sourceType ${data.sourceType} -> ${newSourceType}, sourceCollection -> hseJobContracts`)
  if (commit) {
    await doc.ref.update({
      sourceType: newSourceType,
      sourceCollection: 'hseJobContracts',
      calculationType: 'count',
      countMode: 'records',
      field: null,
      filters: [],
      updatedAt: new Date()
    })
  }
  updated += 1
}

console.log(`\n${commit ? 'Updated' : 'Would update'}: ${updated} KPI(s).`)
if (!commit) console.log('Re-run with --commit --confirm=remap-srmcdt-jobs-kpis to write these.')
process.exit(0)
