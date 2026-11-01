// Moves stored intervention schedules onto the one shape the app writes:
// scheduleMode + recurrence {every, unit, strict}. Phase 3 of
// docs/intervention-recurrence-consolidation-plan.md; the planning (and what
// is left alone) is in recurrence-migration-plan.cjs.
//
//   1. interventions: target fields set, old fields (recurring, assignmentMode,
//      recurrencePreset, recurrenceStrict, frequency, recurrenceFrequency)
//      removed. Nothing stated becomes an explicit once-off.
//   2. assignedInterventions: the same, from the assignment's own fields only;
//      one that states no schedule is reported. cycleKey is never touched.
//   3. diagnosticPlans.interventions[]: the plan's copies of definitions lose
//      their schedule fields; the live definition is always read instead.
//
// Records whose fields disagree, hold an unknown value, or use an interval
// the screens don't offer are left untouched and listed as needs-manual-review.
// Run order: deploy Phases 1-2, dry run, review the report, then --apply.
//
// Dry run by default. Writes a report of ids only to
// scripts/migrate-intervention-recurrence-report-<project>.json.
// The service account defaults to scripts/serviceAccountKey.json; pass --key= for
// another project. --apply needs --project=<that key's project_id>.
//
//   node -r ./scripts/node26-shim.cjs scripts/migrate-intervention-recurrence.cjs [--key=<path>]
//   node -r ./scripts/node26-shim.cjs scripts/migrate-intervention-recurrence.cjs --key=<path> --apply --project=<project_id>
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
const { planDefinition, planAssignment, planPlanCopies } = require('./recurrence-migration-plan.cjs')

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const APPLY = process.argv.includes('--apply')
const PROJECT_ARG = arg('project')
const KEY_PATH = arg('key') ? path.resolve(arg('key')) : path.join(__dirname, 'serviceAccountKey.json')
const PAGE = 500
const BATCH = 400

const key = require(KEY_PATH)
if (APPLY && PROJECT_ARG !== key.project_id) {
    throw new Error(`--apply writes to ${key.project_id}; pass --project=${key.project_id} to confirm`)
}
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { FieldValue, FieldPath } = admin.firestore

const report = {
    generatedAt: new Date().toISOString(),
    project: key.project_id,
    mode: APPLY ? 'apply' : 'dry-run',
    counts: {},
    needsManualReview: []
}
const bump = (name, by = 1) => { report.counts[name] = (report.counts[name] || 0) + by }

async function* pages(collection) {
    let last = null
    for (;;) {
        let q = db.collection(collection).orderBy(FieldPath.documentId()).limit(PAGE)
        if (last) q = q.startAfter(last)
        const snap = await q.get()
        if (snap.empty) return
        yield snap.docs
        last = snap.docs[snap.docs.length - 1]
    }
}

const writes = []
const patchOf = (plan) => ({
    ...plan.set,
    ...Object.fromEntries(plan.remove.map((field) => [field, FieldValue.delete()]))
})

function record(collection, doc, plan) {
    if (plan.action === 'none') return bump(`${collection}.unchanged`)
    if (plan.action === 'review') {
        bump(`${collection}.needsManualReview`)
        report.needsManualReview.push({ collection, id: doc.id, problems: plan.problems })
        return
    }
    bump(`${collection}.update`)
    if (plan.defaulted) bump(`${collection}.defaultedToOnceOff`)
    const mode = plan.set.scheduleMode
    if (mode) bump(`${collection}.scheduleModeSet.${mode}`)
    if (plan.remove.length) bump(`${collection}.oldFieldsRemoved`, plan.remove.length)
    writes.push({ ref: doc.ref, patch: patchOf(plan) })
}

async function main() {
    console.log(`${APPLY ? 'APPLY' : 'Dry run'} against ${key.project_id}`)

    for await (const docs of pages('interventions')) {
        for (const doc of docs) record('interventions', doc, planDefinition(doc.data()))
    }

    for await (const docs of pages('assignedInterventions')) {
        for (const doc of docs) record('assignedInterventions', doc, planAssignment(doc.data()))
    }

    for await (const docs of pages('diagnosticPlans')) {
        for (const doc of docs) {
            const plan = planPlanCopies(doc.data().interventions)
            if (plan.action === 'none') { bump('diagnosticPlans.unchanged'); continue }
            bump('diagnosticPlans.update')
            bump('diagnosticPlans.copiesStripped', plan.stripped)
            writes.push({ ref: doc.ref, patch: { interventions: plan.interventions } })
        }
    }

    report.counts.writes = writes.length
    if (APPLY) {
        for (let i = 0; i < writes.length; i += BATCH) {
            const batch = db.batch()
            writes.slice(i, i + BATCH).forEach(({ ref, patch }) => batch.update(ref, patch))
            await batch.commit()
            console.log(`  committed ${Math.min(i + BATCH, writes.length)} / ${writes.length}`)
        }
    }

    const reportPath = path.join(__dirname, `migrate-intervention-recurrence-report-${key.project_id}.json`)
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report.counts, null, 2))
    console.log(`${report.needsManualReview.length} need manual review. Report: ${path.relative(process.cwd(), reportPath)}`)
    if (!APPLY) console.log(`Dry run -- re-run with --apply --project=${key.project_id} to write`)
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
