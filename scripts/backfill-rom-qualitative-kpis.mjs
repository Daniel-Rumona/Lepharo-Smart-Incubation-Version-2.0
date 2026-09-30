/**
 * The 10 ROM (PICABIZ) KPIs created by rebuild-sedfa-kpis.mjs were written
 * before qualitative KPI support existed, so they only carry a kpiLabel and a
 * placeholder "manual/applications/count" shape - the actual Deliverable and
 * Measurement Indicator text from the ROM SEDFA letter was never stored.
 * This backfills kpiKind: 'qualitative' plus that text, and clears the
 * now-unused numeric placeholder fields.
 *
 * Dry run:
 *   node scripts/backfill-rom-qualitative-kpis.mjs
 * Commit:
 *   node scripts/backfill-rom-qualitative-kpis.mjs --commit --confirm=backfill-rom-qualitative-kpis
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
const CONFIRMATION = 'backfill-rom-qualitative-kpis'
const SEED_SOURCE = 'sedfa-kpi-letters-2026-27'
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

const DELIVERABLES = {
  'SBAT Assessment forms': {
    deliverable: 'Ensure all SBAT forms are accurately completed and fully captured',
    measurementIndicator: 'Number of correctly completed and verified SBAT forms submitted (aligned with jobs counted)'
  },
  'BBBEE Compliance Support': {
    deliverable: 'Monitoring and updating BBBEE compliance status for MSMEs',
    measurementIndicator: 'Number of MSMEs with updated BBBEE compliance records'
  },
  'CSD Compliance Support': {
    deliverable: 'Monitoring and updating CSD registration and compliance status',
    measurementIndicator: 'Number of MSMEs with valid and updated CSD records'
  },
  'Group A Database Management': {
    deliverable: 'Maintain a detailed Group A database with full business information and compliance status',
    measurementIndicator: 'Updated database with complete MSME profiles and compliance tracking'
  },
  'Group B Database Management': {
    deliverable: 'Maintain Group B database with compliance tracking and status updates',
    measurementIndicator: 'Updated Group B database with active compliance records'
  },
  'Compliance Monitoring': {
    deliverable: 'Track outstanding compliance documents and expiries',
    measurementIndicator: 'Monthly compliance status report submitted'
  },
  'Graduation Process Management': {
    deliverable: 'Develop and maintain movement checklist from Group A to Group B',
    measurementIndicator: 'Number of MSMEs assessed for graduation readiness'
  },
  'Graduation Assessment': {
    deliverable: 'Conduct graduation readiness assessments for qualifying MSMEs',
    measurementIndicator: 'Completed graduation checklist forms submitted'
  },
  'Database Accuracy': {
    deliverable: 'Ensure all MSME records are accurate and up to date',
    measurementIndicator: 'Percentage of verified and updated records'
  },
  'Reporting': {
    deliverable: 'Submit monthly KPI and intervention reports to stakeholders',
    measurementIndicator: 'Monthly report submitted within agreed timelines'
  }
}

const snap = await db.collection('kpiDefinitions').where('seedSource', '==', SEED_SOURCE).get()
let updated = 0

for (const doc of snap.docs) {
  const data = doc.data()
  const match = DELIVERABLES[data.kpiLabel]
  if (!match) continue

  console.log(`[${data.department}] "${data.kpiLabel}" -> kpiKind: qualitative`)
  console.log(`    Deliverable: ${match.deliverable}`)
  console.log(`    Measured by: ${match.measurementIndicator}`)

  if (commit) {
    await doc.ref.update({
      kpiKind: 'qualitative',
      deliverable: match.deliverable,
      measurementIndicator: match.measurementIndicator,
      sourceType: null,
      sourceCollection: null,
      countMode: null,
      dateField: null,
      calculationType: 'count',
      field: null,
      updatedAt: new Date()
    })
  }
  updated += 1
}

console.log(`\n${commit ? 'Updated' : 'Would update'}: ${updated} KPI(s).`)
if (!commit) console.log('Re-run with --commit --confirm=backfill-rom-qualitative-kpis to write these.')
process.exit(0)
