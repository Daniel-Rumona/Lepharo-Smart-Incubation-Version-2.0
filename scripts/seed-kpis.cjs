// Seeds sample KPIs for four departments in the digital-twin programme
// "Incubation Foundations" (dtseed_20261009_v1_program_0), so the KPI register
// and tracker can be tried with a realistic year of history:
//   - live KPIs computed from the twin's own data (completed intervention
//     assignments and monthly SME revenue),
//   - manual KPIs with recorded actuals, and deliverables marked done/not done,
//   - two shared KPIs (one collaborative, one allocated).
// Live targets are set from what the data actually shows, scaled so periods
// land on a mix of achieved / on track / behind; the current period is left
// partly unrecorded so "To update" shows too.
//
// Dry run by default: prints what would be written and writes nothing.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-kpis.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-kpis.cjs --remove [--apply]
//
// Safety:
//  - Every document has a fixed `dtseed_kpi_…` id and carries seedTag,
//    dataOrigin: 'synthetic' and suppressNotifications: true, so re-running
//    overwrites the same documents and --remove deletes exactly these.
//  - Everything is scoped to the synthetic programme (never "all programmes"),
//    so the real SRMCDT Project's KPI pages don't show it.
//  - Manual KPIs carry no leadDepartmentId/departmentId: kpiManualUpdateReminderCron
//    finds recipients only through those, so it cannot email a real HOD about
//    them (the cron's own synthetic check is also in the source, pending deploy).
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')
const SEED_TAG = 'seed-kpis'
const PROGRAM_ID = 'dtseed_20261009_v1_program_0'
const ID = slug => `dtseed_kpi_${slug}`

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()

const DEPT = {
    finance: { id: 'Gyx2pYnOPZZ2DlGPRkZd', name: 'Financial Compliance' },
    legal: { id: '9bu8xeGsQu4O1NVV73Du', name: 'Legal Advisory Services' },
    marketing: { id: 'BOYnwuCpmRjzcJqZG6Vj', name: 'Marketing and Communication' },
    training: { id: 'FnbBdir2lWjcDaH75Bj9', name: 'Training Academy' }
}
const IV = {
    contracts: 'dtseed_20261009_v1_intervention_0',
    cashflow: 'dtseed_20261009_v1_intervention_1',
    pipeline: 'dtseed_20261009_v1_intervention_2',
    records: 'dtseed_20261009_v1_intervention_3'
}

// ---- periods ---------------------------------------------------------------
const today = new Date()
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const quarterKey = d => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
const CURRENT_MONTH = monthKey(today)
const CURRENT_QUARTER = quarterKey(today)
/** The last n month keys ending with the current month. */
const lastMonths = n => Array.from({ length: n }, (_, i) => monthKey(new Date(today.getFullYear(), today.getMonth() - (n - 1 - i), 1)))
/** The last n quarter keys ending with the current quarter. */
const lastQuarters = n => Array.from({ length: n }, (_, i) => quarterKey(new Date(today.getFullYear(), today.getMonth() - 3 * (n - 1 - i), 1)))
const periodRange = (type, key) => {
    if (type === 'quarterly') {
        const [y, q] = key.split('-Q').map(Number)
        return [new Date(y, (q - 1) * 3, 1), new Date(y, q * 3, 0, 23, 59, 59, 999)]
    }
    const [y, m] = key.split('-').map(Number)
    return [new Date(y, m - 1, 1), new Date(y, m, 0, 23, 59, 59, 999)]
}
const toDate = v => (v?.toDate ? v.toDate() : v ? new Date(v) : null)
const inPeriod = (v, type, key) => {
    const d = toDate(v)
    if (!d || isNaN(d)) return false
    const [s, e] = periodRange(type, key)
    return d >= s && d <= e
}

/**
 * Target multipliers per period, cycled: below 1 the period is achieved, above
 * it falls short. Fixed so every run produces the same mix.
 */
const MIX = [0.9, 1.25, 0.8, 1.1, 0.95, 1.4]
const scaledTarget = (actual, i, floor = 1) => Math.max(floor, Math.round(actual * MIX[i % MIX.length]))

const marks = { dataOrigin: 'synthetic', suppressNotifications: true, seedTag: SEED_TAG, seedRunId: 'dtseed_20261009_v1' }

// ---- definitions -----------------------------------------------------------
const baseDef = (dept, extra) => ({
    ...marks,
    programId: PROGRAM_ID,
    appliesToAllPrograms: false,
    belongsToMe: true,
    sharedKpiMode: null,
    leadDepartmentId: dept.id,
    leadDepartmentName: dept.name,
    department: dept.name,
    description: '',
    contributorDepartmentIds: [dept.id],
    contributorDepartmentNames: [dept.name],
    sharedContributors: [],
    active: true,
    deliverable: null,
    measurementIndicator: null,
    numerator: null,
    denominator: null,
    ...extra
})

const liveInterventions = (dept, interventionIds) => ({
    unit: 'count', kpiKind: 'numeric', sourceType: 'interventions', sourceCollection: 'assignedInterventions',
    countMode: 'records', dateField: 'createdAt', displayKpiType: 'total_number', calculationType: 'count',
    filters: [], field: null, interventionIds, trackingMode: 'computed', reminderCadence: null
})

const manual = (unit, cadence) => ({
    // No lead department: the reminder cron resolves recipients only from it.
    leadDepartmentId: null,
    unit, kpiKind: 'numeric', sourceType: null, sourceCollection: null, countMode: null, dateField: null,
    displayKpiType: null, calculationType: 'count', filters: [], field: null, interventionIds: [],
    trackingMode: 'manual', reminderCadence: cadence
})

const deliverable = (text, measure, cadence) => ({
    ...manual('count', cadence),
    kpiKind: 'qualitative', deliverable: text, measurementIndicator: measure
})

const shared = (lead, members, mode, ivByDept) => ({
    belongsToMe: false,
    sharedKpiMode: mode,
    leadDepartmentId: lead.id,
    leadDepartmentName: lead.name,
    department: lead.name,
    contributorDepartmentIds: members.map(m => m.id),
    contributorDepartmentNames: members.map(m => m.name),
    sharedContributors: members.map(m => ({
        departmentId: m.id,
        departmentName: m.name,
        role: m.id === lead.id ? 'lead' : 'contributor',
        ...(mode === 'collaborative' ? { requiredInterventionIds: ivByDept[m.id] || [] } : {})
    }))
})

/**
 * Each KPI: its definition, its target periods, and how each period's target
 * (and, for manual ones, actual) is decided. `live(type, key)` returns the
 * actual the app will compute, so targets can be pitched against it.
 */
const KPIS = [
    // Financial Compliance
    { slug: 'fc_cashflow', label: 'Cash flow planning sessions completed', def: baseDef(DEPT.finance, liveInterventions(DEPT.finance, [IV.cashflow])), type: 'quarterly', periods: lastQuarters(5), source: 'interventions', ivs: [IV.cashflow] },
    { slug: 'fc_tax', label: 'SMEs with tax affairs up to date', def: baseDef(DEPT.finance, manual('count', 'monthly')), type: 'monthly', periods: lastMonths(6), manualActuals: [18, 21, 19, 24, 22, null], targets: [20, 20, 22, 22, 24, 25] },
    { slug: 'fc_report', label: 'Monthly compliance status report', def: baseDef(DEPT.finance, deliverable('Compliance status report for the programme', 'Report submitted to the programme manager', 'monthly')), type: 'monthly', periods: lastMonths(6), done: [1, 1, 0, 1, 1, null] },
    // Legal Advisory
    { slug: 'legal_contracts', label: 'Contract management sessions completed', def: baseDef(DEPT.legal, liveInterventions(DEPT.legal, [IV.contracts])), type: 'quarterly', periods: lastQuarters(5), source: 'interventions', ivs: [IV.contracts] },
    { slug: 'legal_reviews', label: 'SME contracts reviewed', def: baseDef(DEPT.legal, manual('count', 'monthly')), type: 'monthly', periods: lastMonths(6), manualActuals: [9, 12, 7, 11, 14, 6], targets: [10, 10, 10, 12, 12, 12] },
    // Marketing and Communication
    { slug: 'mkt_pipeline', label: 'Customer pipeline sessions completed', def: baseDef(DEPT.marketing, liveInterventions(DEPT.marketing, [IV.pipeline])), type: 'quarterly', periods: lastQuarters(5), source: 'interventions', ivs: [IV.pipeline] },
    { slug: 'mkt_stories', label: 'SME success stories published', def: baseDef(DEPT.marketing, manual('count', 'monthly')), type: 'monthly', periods: lastMonths(6), manualActuals: [3, 4, 2, 5, 4, null], targets: [4, 4, 4, 4, 5, 5] },
    { slug: 'mkt_campaign', label: 'Quarterly SME showcase campaign', def: baseDef(DEPT.marketing, deliverable('Showcase campaign featuring programme SMEs', 'Campaign live on at least two channels', 'quarterly')), type: 'quarterly', periods: lastQuarters(4), done: [1, 0, 1, null] },
    // Training Academy
    { slug: 'ta_records', label: 'Record keeping training completed', def: baseDef(DEPT.training, liveInterventions(DEPT.training, [IV.records])), type: 'quarterly', periods: lastQuarters(5), source: 'interventions', ivs: [IV.records] },
    { slug: 'ta_register', label: 'Training attendance register', def: baseDef(DEPT.training, deliverable('Signed attendance register for every session', 'Register uploaded within five days', 'monthly')), type: 'monthly', periods: lastMonths(6), done: [1, 1, 1, 0, 1, 1] },
    // Shared
    {
        slug: 'shared_revenue', label: 'Revenue generated by supported SMEs',
        def: baseDef(DEPT.finance, {
            ...shared(DEPT.finance, [DEPT.finance, DEPT.marketing], 'collaborative', { [DEPT.finance.id]: [IV.cashflow], [DEPT.marketing.id]: [IV.pipeline] }),
            unit: 'ZAR', kpiKind: 'numeric', sourceType: 'metrics', sourceCollection: 'participantMonthlyMetrics', countMode: null,
            dateField: 'createdAt', displayKpiType: 'total_amount', calculationType: 'sum', filters: [], field: 'revenue',
            interventionIds: [], trackingMode: 'computed', reminderCadence: null
        }),
        type: 'monthly', periods: lastMonths(7), source: 'revenue', floor: 1000, round: 1000
    },
    {
        slug: 'shared_sessions', label: 'Support sessions completed across departments',
        def: baseDef(DEPT.training, {
            ...shared(DEPT.training, [DEPT.training, DEPT.finance, DEPT.legal, DEPT.marketing], 'allocated', {}),
            ...liveInterventions(DEPT.training, Object.values(IV))
        }),
        type: 'quarterly', periods: lastQuarters(5), source: 'interventions', ivs: Object.values(IV)
    }
]

// ---- live actuals, worked out the same way the app computes them -----------
async function loadLiveData() {
    const [assignments, metrics] = await Promise.all([
        db.collection('assignedInterventions').where('programId', '==', PROGRAM_ID).get(),
        db.collection('participantMonthlyMetrics').where('programId', '==', PROGRAM_ID).get()
    ])
    const completed = assignments.docs.map(d => d.data()).filter(a => (a.assignmentStatus ?? a.status) === 'completed')
    const rows = metrics.docs.map(d => d.data())
    return {
        interventions: (ivs, type, key) => completed.filter(a => ivs.includes(a.interventionId) && inPeriod(a.completedAt || a.createdAt || a.updatedAt, type, key)).length,
        revenue: (type, key) => rows.filter(r => inPeriod(r.createdAt || r.date || r.updatedAt, type, key)).reduce((s, r) => s + Number(r.revenue || 0), 0)
    }
}

const isCurrent = (type, key) => key === (type === 'quarterly' ? CURRENT_QUARTER : CURRENT_MONTH)
const periodStartAt = (type, key) => periodRange(type, key)[0]

async function build() {
    const live = await loadLiveData()
    const now = new Date()
    const defs = []
    const targets = []
    const audits = []
    const summary = []

    for (const k of KPIS) {
        defs.push({ id: ID(k.slug), data: { ...k.def, kpiLabel: k.label, createdAt: new Date(now.getFullYear() - 1, now.getMonth(), 1), updatedAt: now } })
        const lines = []
        k.periods.forEach((key, i) => {
            let target = null
            let actual
            if (k.source) {
                const value = k.source === 'revenue' ? live.revenue(k.type, key) : live.interventions(k.ivs, k.type, key)
                // The current period has little data yet, so its target follows the previous one.
                const basis = isCurrent(k.type, key) ? (targets.filter(t => t.data.kpiId === ID(k.slug)).pop()?.data.target || value) : value
                if (!basis) { lines.push(`${key}: no data, no target`); return }
                target = scaledTarget(basis, i, k.floor || 1)
                if (k.round) target = Math.round(target / k.round) * k.round
                lines.push(`${key}: live ${value} → target ${target}`)
            } else if (k.done) {
                target = 1
                const d = k.done[i]
                // An unrecorded deliverable period has no target document at all (as in the app).
                if (d == null) { lines.push(`${key}: not recorded`); return }
                actual = d
                lines.push(`${key}: ${d ? 'done' : 'not done'}`)
            } else {
                target = k.targets[i]
                actual = k.manualActuals[i]
                lines.push(`${key}: target ${target}, actual ${actual ?? 'not recorded'}`)
            }
            const id = `${ID(k.slug)}_${key}`
            targets.push({
                id,
                data: {
                    ...marks,
                    kpiId: ID(k.slug),
                    kpiLabel: k.label,
                    department: k.def.department,
                    periodType: k.type,
                    periodKey: key,
                    periodStartAt: periodStartAt(k.type, key),
                    target,
                    ...(actual !== undefined && actual !== null
                        ? { actual, actualUpdatedBy: 'system', actualUpdatedAt: now }
                        : {}),
                    createdAt: now,
                    updatedAt: now,
                    createdBy: 'system',
                    updatedBy: 'system'
                }
            })
            audits.push({
                id: `${id}_created`,
                data: {
                    ...marks,
                    kpiId: ID(k.slug),
                    kpiLabel: k.label,
                    department: k.def.department,
                    targetDocId: id,
                    action: 'created',
                    periodType: k.type,
                    periodKey: key,
                    oldTarget: null,
                    newTarget: target,
                    changeReason: 'Sample target for the demo programme',
                    changedBy: 'system',
                    changedAt: now
                }
            })
        })
        summary.push(`${k.def.department} · ${k.label} [${k.def.trackingMode}${k.def.kpiKind === 'qualitative' ? ', deliverable' : ''}${k.def.sharedKpiMode ? `, shared ${k.def.sharedKpiMode}` : ''}]\n    ${lines.join('\n    ')}`)
    }
    return { defs, targets, audits, summary }
}

async function commit(writes) {
    for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch()
        writes.slice(i, i + 400).forEach(w => w(batch))
        await batch.commit()
    }
}

async function main() {
    if (REMOVE) {
        const found = []
        for (const c of ['kpiDefinitions', 'kpiTargets', 'kpiTargetAuditLogs']) {
            const snap = await db.collection(c).where('seedTag', '==', SEED_TAG).get()
            snap.docs.forEach(d => found.push(d.ref))
            console.log(`${c}: ${snap.size} seeded document(s)`)
        }
        if (!APPLY) return console.log('\nDry run. Re-run with --remove --apply to delete them.')
        await commit(found.map(ref => batch => batch.delete(ref)))
        return console.log(`Deleted ${found.length} document(s).`)
    }

    const { defs, targets, audits, summary } = await build()
    console.log(summary.join('\n\n'))
    console.log(`\n${defs.length} KPIs, ${targets.length} targets, ${audits.length} audit entries in ${PROGRAM_ID}.`)

    // Never overwrite a document this script didn't create.
    for (const [c, list] of [['kpiDefinitions', defs], ['kpiTargets', targets], ['kpiTargetAuditLogs', audits]]) {
        const refs = list.map(x => db.collection(c).doc(x.id))
        const snaps = refs.length ? await db.getAll(...refs) : []
        const foreign = snaps.filter(s => s.exists && s.data().seedTag !== SEED_TAG)
        if (foreign.length) throw new Error(`${c}: ${foreign.length} id(s) already used by other records — aborting.`)
    }

    if (!APPLY) return console.log('Dry run. Re-run with --apply to write.')
    await commit([
        ...defs.map(x => batch => batch.set(db.collection('kpiDefinitions').doc(x.id), x.data)),
        ...targets.map(x => batch => batch.set(db.collection('kpiTargets').doc(x.id), x.data)),
        ...audits.map(x => batch => batch.set(db.collection('kpiTargetAuditLogs').doc(x.id), x.data))
    ])
    console.log('Written.')
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
