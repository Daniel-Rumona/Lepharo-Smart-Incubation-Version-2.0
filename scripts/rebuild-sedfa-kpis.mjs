/**
 * Full reset of KPI data: backs up every document in kpiDefinitions,
 * kpiTargets, kpiTargetAuditLogs, kpiTargetRevisions and
 * kpiReminderNotifications, then (only with --commit) deletes all of it and
 * recreates ONLY the 15 KPIs from the three SEDFA 2026-27 FY letters:
 *   - BMO SEDFA KPI LETTER-2026-27.pdf   -> Financial Compliance (3 KPIs)
 *   - HSE SEDFA KPI LETTER-2026-27.pdf   -> HSE (Health, Safety & Environment)
 *                                            and Labour Compliance (2 KPIs)
 *   - ROM SEDFA KPI LETTER-2026-27.pdf   -> ROM (Recruitment, Onboarding and
 *                                            Maintenance) (10 KPIs)
 *
 * The 5 numeric jobs/turnover KPIs and their Q1-Q4 targets, and the 10 ROM
 * deliverable KPIs, mirror the shape of the existing seedSource ===
 * 'srmcdt-kpi-letters-test-seed' docs already in kpiDefinitions/kpiTargets
 * (verified field-for-field against the three PDFs before writing this) -
 * same programId (SRMCDT Project), same period boundaries, same computed vs.
 * manual tracking split. This script replaces that data with a clean set
 * carrying seedSource 'sedfa-kpi-letters-2026-27' instead.
 *
 * Dry run (backup only, prints what WOULD change, writes nothing):
 *   node scripts/rebuild-sedfa-kpis.mjs
 * Commit (deletes everything in the 5 collections, writes the 15 KPIs + 20 targets):
 *   node scripts/rebuild-sedfa-kpis.mjs --commit --confirm=rebuild-sedfa-kpis
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
const CONFIRMATION = 'rebuild-sedfa-kpis'
const SEED_SOURCE = 'sedfa-kpi-letters-2026-27'
const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY' // SRMCDT Project (verified active)
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

const COLLECTIONS = ['kpiDefinitions', 'kpiTargets', 'kpiTargetAuditLogs', 'kpiTargetRevisions', 'kpiReminderNotifications']

// ---- Period boundaries (matches the existing SRMCDT seed exactly) ----
const PERIODS = {
  '2026-Q1': { seconds: 1767218400 },
  '2026-Q2': { seconds: 1774994400 },
  '2026-Q3': { seconds: 1782856800 },
  '2026-Q4': { seconds: 1790805600 }
}

const DEPARTMENTS = {
  bmo: { id: 'Gyx2pYnOPZZ2DlGPRkZd', name: 'Financial Compliance' },
  hse: { id: '3oeQlX2YjpPlZ3yeAB2m', name: 'HSE (Health, Safety & Environment) and Labour Compliance' },
  rom: { id: 'aSk06vIfzh4PFDvRxdpm', name: 'ROM (Recruitment, Onboarding and Maintenance)' }
}

const baseDefFields = dept => ({
  programId: PROGRAM_ID,
  appliesToAllPrograms: false,
  belongsToMe: true,
  sharedKpiMode: null,
  leadDepartmentId: dept.id,
  leadDepartmentName: dept.name,
  department: dept.name,
  unit: 'count',
  description: '',
  dateField: 'createdAt',
  displayKpiType: null,
  filters: [],
  numerator: null,
  denominator: null,
  contributorDepartmentIds: [],
  contributorDepartmentNames: [],
  sharedContributors: [],
  interventionIds: [],
  seedSource: SEED_SOURCE,
  active: true
})

const computedJobsKpi = (dept, kpiLabel, field, targets) => ({
  def: {
    ...baseDefFields(dept),
    kpiLabel,
    sourceType: 'metrics',
    sourceCollection: 'participantMonthlyMetrics',
    calculationType: 'sum',
    field,
    countMode: null,
    trackingMode: 'computed',
    reminderCadence: null
  },
  targets
})

const manualKpi = (dept, kpiLabel, reminderCadence, targets) => ({
  def: {
    ...baseDefFields(dept),
    kpiLabel,
    sourceType: 'applications',
    sourceCollection: 'applications',
    calculationType: 'count',
    countMode: 'records',
    field: null,
    trackingMode: 'manual',
    reminderCadence
  },
  targets
})

const KPIS = [
  // --- BMO / Financial Compliance ---
  computedJobsKpi(DEPARTMENTS.bmo, 'Direct Jobs Management accounts', 'jobsCreated', {
    '2026-Q1': 20, '2026-Q2': 20, '2026-Q3': 15, '2026-Q4': 15
  }),
  computedJobsKpi(DEPARTMENTS.bmo, 'Jobs sustained Management accounts', 'jobsSustained', {
    '2026-Q1': 20, '2026-Q2': 25, '2026-Q3': 25, '2026-Q4': 20
  }),
  manualKpi(DEPARTMENTS.bmo, 'Turnover increased by 5%', 'quarterly', {
    '2026-Q1': 5, '2026-Q2': 10, '2026-Q3': 10, '2026-Q4': 5
  }),

  // --- HSE ---
  computedJobsKpi(DEPARTMENTS.hse, 'Collection of Direct Jobs for the MSME', 'jobsCreated', {
    '2026-Q1': 20, '2026-Q2': 20, '2026-Q3': 15, '2026-Q4': 15
  }),
  computedJobsKpi(DEPARTMENTS.hse, 'Collection & confirmation of Jobs Sustained for the MSME', 'jobsSustained', {
    '2026-Q1': 20, '2026-Q2': 25, '2026-Q3': 25, '2026-Q4': 20
  }),

  // --- ROM (PICABIZ) - deliverables, monthly cadence, no numeric target ---
  manualKpi(DEPARTMENTS.rom, 'SBAT Assessment forms', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'BBBEE Compliance Support', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'CSD Compliance Support', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Group A Database Management', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Group B Database Management', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Compliance Monitoring', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Graduation Process Management', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Graduation Assessment', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Database Accuracy', 'monthly', {}),
  manualKpi(DEPARTMENTS.rom, 'Reporting', 'monthly', {})
]

// ---- 1. Backup every doc in all 5 collections (always runs) ----
const backup = {}
let totalBackedUp = 0
for (const name of COLLECTIONS) {
  const snap = await db.collection(name).get()
  backup[name] = snap.docs.map(d => ({ id: d.id, data: d.data() }))
  totalBackedUp += snap.size
  console.log(`Backed up ${snap.size} doc(s) from ${name}`)
}

const timestamp = Date.now()
const backupPath = path.join(here, `kpi-full-backup-${timestamp}.json`)
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2))
console.log(`\nBackup written: ${backupPath} (${totalBackedUp} documents total)`)

// ---- 2. Report what would change ----
const existingDefCount = backup.kpiDefinitions.length
const existingSedfaCount = backup.kpiDefinitions.filter(d => d.data.seedSource === 'srmcdt-kpi-letters-test-seed').length
console.log(`\nCurrent kpiDefinitions: ${existingDefCount} (${existingSedfaCount} already tagged as the prior SEDFA test seed)`)
console.log(`Will delete: all ${existingDefCount} kpiDefinitions, all ${backup.kpiTargets.length} kpiTargets, all ${backup.kpiTargetAuditLogs.length} kpiTargetAuditLogs, all ${backup.kpiTargetRevisions.length} kpiTargetRevisions, all ${backup.kpiReminderNotifications.length} kpiReminderNotifications`)
console.log(`Will create: ${KPIS.length} kpiDefinitions, ${KPIS.reduce((n, k) => n + Object.keys(k.targets).length, 0)} kpiTargets`)

console.log('\nNew KPI set:')
KPIS.forEach(k => {
  const targetSummary = Object.keys(k.targets).length
    ? Object.entries(k.targets).map(([p, v]) => `${p}=${v}`).join(', ')
    : 'no numeric target (deliverable)'
  console.log(`  [${k.def.department}] "${k.def.kpiLabel}" - ${k.def.trackingMode} - ${targetSummary}`)
})

if (!commit) {
  console.log('\nDry run only - nothing was deleted or created. Re-run with --commit --confirm=rebuild-sedfa-kpis to apply.')
  process.exit(0)
}

// ---- 3. Delete everything in the 5 collections ----
const deleteAll = async collectionName => {
  const snap = await db.collection(collectionName).get()
  for (let offset = 0; offset < snap.docs.length; offset += 450) {
    const batch = db.batch()
    snap.docs.slice(offset, offset + 450).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
  return snap.size
}

console.log('\nDeleting existing documents...')
for (const name of COLLECTIONS) {
  const deleted = await deleteAll(name)
  console.log(`  ${name}: deleted ${deleted}`)
}

// ---- 4. Create the 15 KPIs + their targets ----
console.log('\nCreating new KPI set...')
const now = admin.firestore.FieldValue.serverTimestamp()
let created = 0
let targetsCreated = 0

for (const kpi of KPIS) {
  const defRef = await db.collection('kpiDefinitions').add({
    ...kpi.def,
    createdAt: now,
    updatedAt: now
  })
  created += 1

  const periodEntries = Object.entries(kpi.targets)
  if (!periodEntries.length) continue

  const batch = db.batch()
  periodEntries.forEach(([periodKey, target]) => {
    const ref = db.collection('kpiTargets').doc()
    batch.set(ref, {
      kpiId: defRef.id,
      kpiLabel: kpi.def.kpiLabel,
      department: kpi.def.department,
      periodType: 'quarterly',
      periodKey,
      periodStartAt: admin.firestore.Timestamp.fromMillis(PERIODS[periodKey].seconds * 1000),
      target,
      seedSource: SEED_SOURCE,
      createdAt: now,
      updatedAt: now,
      createdBy: 'sedfa-kpi-reseed-2026-27',
      updatedBy: 'sedfa-kpi-reseed-2026-27'
    })
    targetsCreated += 1
  })
  await batch.commit()
}

console.log(`\nDone. Created ${created} kpiDefinitions and ${targetsCreated} kpiTargets.`)
console.log(`Backup remains at: ${backupPath}`)
process.exit(0)
