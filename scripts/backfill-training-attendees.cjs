// Backfills the multi-person Training Academy model (step 1 of
// docs/training-academy-certification-and-employees-plan.md): a director
// trainingAttendees record per trainingEnrollments doc, trainingRole /
// trainingAttendeeId on their login, and attendeeId on their existing training
// invitations. What is planned is decided in training-attendees-plan.cjs.
//
// Safe to re-run: existing attendee docs are never overwritten (create fails
// instead), and values already in place are not rewritten. No one is emailed:
// nothing listens on users or trainingAttendees, and the appointments trigger
// ignores the three attendee fields this adds.
//
// Deploy the step 1 firestore.rules before applying, so clients accept the new
// invitation fields.
//
// Dry run by default (reads only); prints what would change and writes a report
// without personal details to scripts/training-attendees-backfill-report.json.
// Applying needs the project id named explicitly:
//
//   node -r ./scripts/node26-shim.cjs scripts/backfill-training-attendees.cjs
//   node -r ./scripts/node26-shim.cjs scripts/backfill-training-attendees.cjs --apply --project=<project_id>
//
// Against the emulator: set FIRESTORE_EMULATOR_HOST and pass --emulator.
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
const { planTrainingAttendees, isTrainingInvitation } = require('./training-attendees-plan.cjs')

const APPLY = process.argv.includes('--apply')
const EMULATOR = process.argv.includes('--emulator')
const PROJECT_ARG = (process.argv.find((a) => a.startsWith('--project=')) || '').slice('--project='.length)
const BATCH = 400

function init() {
    if (EMULATOR) {
        if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('--emulator needs FIRESTORE_EMULATOR_HOST')
        const projectId = PROJECT_ARG || 'demo-training'
        return { db: admin.initializeApp({ projectId }).firestore(), projectId }
    }
    const key = require(path.join(__dirname, 'serviceAccountKey.json'))
    if (APPLY && PROJECT_ARG !== key.project_id) {
        throw new Error(`--apply writes to ${key.project_id}; pass --project=${key.project_id} to confirm`)
    }
    return { db: admin.initializeApp({ credential: admin.credential.cert(key) }).firestore(), projectId: key.project_id }
}

async function load(db) {
    const [enrollmentSnap, attendeeSnap, invitationSnap] = await Promise.all([
        db.collection('trainingEnrollments').get(),
        db.collection('trainingAttendees').select().get(),
        // Training invitations carry interventionId training_{trainingId}; filter on groupKey client-side.
        db.collection('appointments').where('interventionId', '>=', 'training_').where('interventionId', '<', 'training`').get(),
    ])
    const enrollments = enrollmentSnap.docs.map((d) => ({ id: d.id, data: d.data() }))
    const invitations = invitationSnap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter((inv) => isTrainingInvitation(inv.data))
    const uids = [...new Set(enrollments.map((e) => String(e.data.userId || '').trim()).filter(Boolean))]
    const users = new Map()
    for (let i = 0; i < uids.length; i += 100) {
        const refs = uids.slice(i, i + 100).map((uid) => db.doc(`users/${uid}`))
        const snaps = await db.getAll(...refs)
        snaps.forEach((s) => { if (s.exists) users.set(s.id, s.data()) })
    }
    return { enrollments, invitations, users, existingAttendeeIds: attendeeSnap.docs.map((d) => d.id) }
}

async function apply(db, plan) {
    const writes = [
        ...plan.attendees.map((a) => (b) => b.create(db.doc(`trainingAttendees/${a.id}`), a.data)),
        ...plan.userPatches.map((u) => (b) => b.update(db.doc(`users/${u.uid}`), u.patch)),
        ...plan.invitationPatches.map((p) => (b) => b.update(db.doc(`appointments/${p.id}`), p.patch)),
    ]
    for (let i = 0; i < writes.length; i += BATCH) {
        const batch = db.batch()
        writes.slice(i, i + BATCH).forEach((w) => w(batch))
        await batch.commit()
        console.log(`  committed ${Math.min(i + BATCH, writes.length)} / ${writes.length}`)
    }
}

async function main() {
    const { db, projectId } = init()
    console.log(`${projectId} (${APPLY ? 'APPLY' : 'dry run'})`)
    const input = await load(db)
    const plan = planTrainingAttendees({ ...input, now: new Date().toISOString() })

    console.log(`\nEnrollments: ${input.enrollments.length}   training invitations: ${input.invitations.length}`)
    console.log(`Director attendee records to create: ${plan.attendees.length} (already present: ${plan.skipped.attendeesPresent})`)
    console.log(`  of which attend sessions: ${plan.attendees.filter((a) => a.data.attends).length}`)
    console.log(`  synthetic: ${plan.attendees.filter((a) => a.data.dataOrigin === 'synthetic').length}`)
    console.log(`Logins to patch: ${plan.userPatches.length}`)
    console.log(`Invitations to attribute to the director: ${plan.invitationPatches.length}`)
    if (plan.warnings.length) {
        console.log(`\nWarnings (${plan.warnings.length}):`)
        plan.warnings.forEach((w) => console.log(`  - ${w}`))
    }

    // Ids and changed keys only: no names, emails or ID numbers in the repo.
    const report = {
        projectId,
        mode: APPLY ? 'apply' : 'dry-run',
        at: new Date().toISOString(),
        attendees: plan.attendees.map((a) => ({ id: a.id, attends: a.data.attends, hasEmail: !!a.data.email, hasUser: !!a.data.userId, synthetic: a.data.dataOrigin === 'synthetic' })),
        userPatches: plan.userPatches.map((u) => ({ uid: u.uid, enrollmentId: u.enrollmentId, keys: Object.keys(u.patch) })),
        invitationPatches: plan.invitationPatches.map((p) => ({ id: p.id, enrollmentId: p.enrollmentId })),
        warningCount: plan.warnings.length,
    }
    fs.writeFileSync(path.join(__dirname, 'training-attendees-backfill-report.json'), JSON.stringify(report, null, 2))

    if (APPLY) {
        await apply(db, plan)
        console.log('\nDone')
    } else {
        console.log('\nDry run -- nothing written. Re-run with --apply --project=<project_id> to write.')
    }
}
main().then(() => process.exit(0), (e) => { console.error(e.message || e); process.exit(1) })
