/**
 * Registers the BMO / HSE / ROM SEDFA KPI letters as real KPIs under the
 * SRMCDT Project, so the new unified Add-KPI flow and the Tracker page's
 * manual-entry card can be exercised with real data.
 *
 * Quarters are backdated onto calendar Q1..Q4 of the current year (Q1 =
 * January) rather than the letters' own FY2026-27 labelling, so some
 * periods land in the past/current instead of the future.
 *
 * Mapping (per the AI source-mapping rules the Add KPI flow itself uses):
 *   - "Direct/Collection of Direct Jobs" -> metrics.jobsCreated, summed (computed)
 *   - "Jobs sustained/Collection & confirmation of Jobs Sustained" -> metrics.jobsSustained, summed (computed)
 *   - "Turnover increased by 5%" -> no growth-threshold calc type exists yet -> manual
 *   - All 10 ROM deliverable rows -> checked against ROM's real intervention
 *     titles (Compliance Document Verification, Gap Analysis, Group A
 *     checklist to move SMME to Group B, Maintenance, SMME Onboarding
 *     Induction) - none is an unambiguous match, so all stay manual rather
 *     than guess. ROM's letter gives no numeric targets, so no kpiTargets
 *     rows are created for them either - only the manual-KPI card should
 *     show "no target set" for these.
 *
 * Dry run:
 *   node scripts/seed-srmcdt-kpis.mjs
 * Commit:
 *   node scripts/seed-srmcdt-kpis.mjs --commit --confirm=seed-srmcdt-kpis
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
const CONFIRMATION = 'seed-srmcdt-kpis'
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

const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY' // SRMCDT Project
const DEPARTMENTS = {
  financialCompliance: { id: 'Gyx2pYnOPZZ2DlGPRkZd', name: 'Financial Compliance' },
  hse: { id: '3oeQlX2YjpPlZ3yeAB2m', name: 'HSE (Health, Safety & Environment) and Labour Compliance' },
  rom: { id: 'aSk06vIfzh4PFDvRxdpm', name: 'ROM (Recruitment, Onboarding and Maintenance)' }
}

const YEAR = new Date().getFullYear()
const quarterKey = q => `${YEAR}-Q${q}`
const quarterStart = q => new Date(YEAR, (q - 1) * 3, 1)
const SEED_MARKER = 'srmcdt-kpi-letters-test-seed'

/** @typedef {{ label: string, department: keyof typeof DEPARTMENTS, computed: null | { field: 'jobsCreated'|'jobsSustained' }, quarters: number[] | null, reminderCadence: 'quarterly'|'monthly' }} Candidate */

/** @type {Candidate[]} */
const candidates = [
  // BMO letter - Financial Compliance Services
  { label: 'Direct Jobs Management accounts', department: 'financialCompliance', computed: { field: 'jobsCreated' }, quarters: [20, 20, 15, 15], reminderCadence: 'quarterly' },
  { label: 'Jobs sustained Management accounts', department: 'financialCompliance', computed: { field: 'jobsSustained' }, quarters: [20, 25, 25, 20], reminderCadence: 'quarterly' },
  { label: 'Turnover increased by 5%', department: 'financialCompliance', computed: null, quarters: [5, 10, 10, 5], reminderCadence: 'quarterly' },

  // HSE letter - Health, Safety & Environment Service
  { label: 'Collection of Direct Jobs for the MSME', department: 'hse', computed: { field: 'jobsCreated' }, quarters: [20, 20, 15, 15], reminderCadence: 'quarterly' },
  { label: 'Collection & confirmation of Jobs Sustained for the MSME', department: 'hse', computed: { field: 'jobsSustained' }, quarters: [20, 25, 25, 20], reminderCadence: 'quarterly' },

  // ROM letter - Recruitment, Onboarding and Maintenance Service (PICABIZ) - no numeric targets given
  { label: 'SBAT Assessment forms', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'BBBEE Compliance Support', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'CSD Compliance Support', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Group A Database Management', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Group B Database Management', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Compliance Monitoring', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Graduation Process Management', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Graduation Assessment', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Database Accuracy', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' },
  { label: 'Reporting', department: 'rom', computed: null, quarters: null, reminderCadence: 'monthly' }
]

const now = new Date()
let kpisPlanned = 0
let targetsPlanned = 0
const batch = db.batch()

for (const candidate of candidates) {
  const dept = DEPARTMENTS[candidate.department]
  const isComputed = !!candidate.computed

  const kpiPayload = {
    programId: PROGRAM_ID,
    appliesToAllPrograms: false,
    belongsToMe: true,
    sharedKpiMode: null,
    leadDepartmentId: dept.id,
    leadDepartmentName: dept.name,
    department: dept.name,
    kpiLabel: candidate.label,
    unit: 'count',
    description: '',
    sourceType: isComputed ? 'metrics' : 'applications',
    sourceCollection: isComputed ? 'participantMonthlyMetrics' : 'applications',
    countMode: isComputed ? null : 'records',
    dateField: 'createdAt',
    displayKpiType: null,
    calculationType: isComputed ? 'sum' : 'count',
    filters: [],
    field: isComputed ? candidate.computed.field : null,
    numerator: null,
    denominator: null,
    contributorDepartmentIds: [],
    contributorDepartmentNames: [],
    sharedContributors: [],
    interventionIds: [],
    trackingMode: isComputed ? 'computed' : 'manual',
    reminderCadence: isComputed ? null : candidate.reminderCadence,
    seedSource: SEED_MARKER,
    createdAt: now,
    updatedAt: now,
    active: true
  }

  const kpiRef = db.collection('kpiDefinitions').doc()
  kpisPlanned += 1
  console.log(`[KPI] ${dept.name} :: ${candidate.label} -> ${isComputed ? `computed (metrics.${candidate.computed.field}, sum)` : 'manual'}`)
  if (commit) batch.set(kpiRef, kpiPayload)

  if (candidate.quarters) {
    candidate.quarters.forEach((value, index) => {
      if (!value) return
      const q = index + 1
      const periodKey = quarterKey(q)
      const targetRef = db.collection('kpiTargets').doc()
      targetsPlanned += 1
      console.log(`   [target] ${periodKey}: ${value}`)
      if (commit) {
        batch.set(targetRef, {
          kpiId: kpiRef.id,
          kpiLabel: candidate.label,
          department: dept.name,
          periodType: 'quarterly',
          periodKey,
          periodStartAt: quarterStart(q),
          target: value,
          seedSource: SEED_MARKER,
          createdAt: now,
          updatedAt: now,
          createdBy: 'kpi-seed-script',
          updatedBy: 'kpi-seed-script'
        })
        batch.set(db.collection('kpiTargetAuditLogs').doc(), {
          kpiId: kpiRef.id,
          targetDocId: targetRef.id,
          kpiLabel: candidate.label,
          department: dept.name,
          periodType: 'quarterly',
          periodKey,
          action: 'created',
          oldTarget: null,
          newTarget: value,
          changeReason: 'Imported from SEDFA KPI letter (test seed, backdated to calendar year)',
          changedAt: now,
          changedBy: 'kpi-seed-script',
          revisionId: null,
          approvedBy: null,
          approvedAt: null
        })
      }
    })
  }
}

console.log(`\n${commit ? 'Committing' : 'Dry run - would create'}: ${kpisPlanned} KPI definitions, ${targetsPlanned} target rows.`)

if (commit) {
  await batch.commit()
  console.log('Done.')
} else {
  console.log('Re-run with --commit --confirm=seed-srmcdt-kpis to write these.')
}

process.exit(0)
