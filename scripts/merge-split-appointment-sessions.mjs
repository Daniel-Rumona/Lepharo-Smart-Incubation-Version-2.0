/**
 * Merge appointmentSessions documents that describe ONE real session.
 *
 * A repair pass (the `repair_v5_*` documents) split some group sessions across
 * two documents, so one delivery shows up twice in the UI - same date, same
 * time, same venue - with the invitees and the attendance divided between the
 * halves. This merges each split back into a single session.
 *
 *   node scripts/merge-split-appointment-sessions.mjs              # dry run
 *   node scripts/merge-split-appointment-sessions.mjs --apply      # write
 *   node scripts/merge-split-appointment-sessions.mjs --apply --delete-merged
 *
 * SAFETY
 * - Dry run is the default. Nothing is written without --apply.
 * - --apply writes a JSON backup of every affected document before touching
 *   anything, and refuses to continue if the backup cannot be written.
 * - A cluster is only ever merged when at least one of its documents is
 *   sessionType 'group'. Clusters made up entirely of individual sessions are
 *   reported and SKIPPED: the database legitimately holds many one-on-one
 *   sessions that share a time slot, one per SME, and those are not duplicates.
 * - Emptied session documents are left in place by default. Once no appointment
 *   points at one it is invisible to the app. Pass --delete-merged only if you
 *   also want them removed.
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

// Node 20+ removed buffer.SlowBuffer, which a transitive dependency of
// firebase-admin still reads at import time. Shim it before that import runs.
const require = createRequire(import.meta.url)
const buffer = require('buffer')
if (!buffer.SlowBuffer) {
    buffer.SlowBuffer = function (size) { return Buffer.allocUnsafeSlow(size) }
    buffer.SlowBuffer.prototype = Object.create(Buffer.prototype)
}

const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')

const here = dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')
const DELETE_MERGED = process.argv.includes('--delete-merged')

const serviceAccount = JSON.parse(
    readFileSync(join(here, 'serviceAccountKey.json'), 'utf8')
)
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const ATTENDED = ['attended', 'checked-in', 'checked-out']
const didAttend = (appointment) =>
    ATTENDED.includes(String(appointment.attendance?.status || '')) ||
    Boolean(appointment.attendance?.checkedInAt)

const iso = (timestamp) => timestamp?.toDate?.().toISOString().slice(0, 16) || '(no date)'

const loadAppointmentsBySession = async (sessionId) => {
    const snapshot = await db
        .collection('appointments')
        .where('appointmentSessionId', '==', sessionId)
        .get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
}

console.log(APPLY ? '=== APPLY (writes enabled) ===' : '=== DRY RUN (no writes) ===')

const sessionSnapshot = await db.collection('appointmentSessions').get()
console.log(`Scanned ${sessionSnapshot.size} appointmentSessions.\n`)

// One real session = same intervention, same start instant, same title, same
// group and the same person delivering it.
const clusters = new Map()
sessionSnapshot.docs.forEach((doc) => {
    const session = doc.data()
    const key = [
        session.interventionId,
        session.startAt?.toMillis?.(),
        session.title,
        session.groupKey,
        session.assigneeId
    ].join('||')
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key).push({ id: doc.id, session })
})

const duplicates = [...clusters.values()].filter((docs) => docs.length > 1)

const mergeable = []
const skipped = []
duplicates.forEach((docs) => {
    if (docs.some((entry) => entry.session.sessionType === 'group')) mergeable.push(docs)
    else skipped.push(docs)
})

if (skipped.length) {
    console.log(
        `SKIPPED - ${skipped.length} cluster(s) of individual sessions sharing a time slot.`
    )
    console.log('  These are separate one-on-one appointments, not duplicates.')
    skipped.forEach((docs) => {
        console.log(
            `   ${iso(docs[0].session.startAt)}  ${String(docs.length).padStart(3)} docs  "${docs[0].session.title}"`
        )
    })
    console.log('')
}

if (!mergeable.length) {
    console.log('Nothing to merge.')
    process.exit(0)
}

const plan = []
for (const docs of mergeable) {
    const withCounts = []
    for (const entry of docs) {
        withCounts.push({ ...entry, appointments: await loadAppointmentsBySession(entry.id) })
    }

    // Keep whichever half actually holds the session: most appointments, then
    // most recorded attendance, then id order so reruns are deterministic.
    const ordered = [...withCounts].sort(
        (left, right) =>
            right.appointments.length - left.appointments.length ||
            right.appointments.filter((a) => didAttend(a.data)).length -
                left.appointments.filter((a) => didAttend(a.data)).length ||
            left.id.localeCompare(right.id)
    )
    const canonical = ordered[0]
    const merged = ordered.slice(1)

    const allAppointments = ordered.flatMap((entry) => entry.appointments)
    const summary = {
        invitedCount: allAppointments.length,
        attendedCount: allAppointments.filter((a) => didAttend(a.data)).length,
        checkedInCount: allAppointments.filter((a) => a.data.attendance?.checkedInAt).length,
        checkedOutCount: allAppointments.filter((a) => a.data.attendance?.checkedOutAt).length
    }

    // Coverage is the record of the session having been held. If the canonical
    // half never got one, adopt a half that did rather than losing it.
    const coverageSource =
        canonical.session.coverage?.held === true
            ? canonical
            : ordered.find((entry) => entry.session.coverage?.held === true) || canonical

    plan.push({ canonical, merged, summary, coverageSource, allAppointments })
}

console.log(`MERGEABLE - ${plan.length} real session(s) split across documents:\n`)
plan.forEach(({ canonical, merged, summary, coverageSource }, index) => {
    console.log(
        `${index + 1}. ${iso(canonical.session.startAt)}  "${canonical.session.title}"  cycle=${canonical.session.cycleKey}`
    )
    console.log(
        `   KEEP    ${canonical.id}  (${canonical.session.sessionType}, ${canonical.appointments.length} appointments)`
    )
    merged.forEach((entry) => {
        console.log(
            `   MERGE   ${entry.id}  (${entry.session.sessionType}, ${entry.appointments.length} appointments) -> repoint onto ${canonical.id}`
        )
    })
    const before = canonical.session.attendanceSummary || {}
    console.log(
        `   summary invited ${before.invitedCount ?? '?'} -> ${summary.invitedCount}, attended ${before.attendedCount ?? '?'} -> ${summary.attendedCount}, checkedIn ${before.checkedInCount ?? '?'} -> ${summary.checkedInCount}, checkedOut ${before.checkedOutCount ?? '?'} -> ${summary.checkedOutCount}`
    )
    if (coverageSource.id !== canonical.id) {
        console.log(`   coverage adopted from ${coverageSource.id} (held=true)`)
    }
    console.log(
        `   ${DELETE_MERGED ? 'DELETE' : 'LEAVE '}  ${merged.length} emptied session document(s)${DELETE_MERGED ? '' : ' in place (invisible once no appointment points at them)'}`
    )
    console.log('')
})

const totals = plan.reduce(
    (acc, item) => ({
        appointments: acc.appointments + item.merged.reduce((n, e) => n + e.appointments.length, 0),
        sessions: acc.sessions + item.merged.length
    }),
    { appointments: 0, sessions: 0 }
)
console.log(
    `TOTAL: ${totals.appointments} appointment(s) repointed, ${plan.length} session(s) updated, ${totals.sessions} session(s) ${DELETE_MERGED ? 'deleted' : 'emptied but kept'}.`
)

if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.')
    process.exit(0)
}

const backupPath = join(here, `merge-split-sessions-backup-${Date.now()}.json`)
const backup = plan.map(({ canonical, merged, allAppointments }) => ({
    canonical: { id: canonical.id, session: canonical.session },
    merged: merged.map((entry) => ({ id: entry.id, session: entry.session })),
    appointments: allAppointments.map((a) => ({ id: a.id, data: a.data }))
}))
writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8')
console.log(`\nBackup written to ${backupPath}`)

let repointed = 0
for (const { canonical, merged, summary, coverageSource } of plan) {
    const batch = db.batch()

    merged.forEach((entry) => {
        entry.appointments.forEach((appointment) => {
            batch.update(db.collection('appointments').doc(appointment.id), {
                appointmentSessionId: canonical.id,
                updatedAt: new Date()
            })
            repointed += 1
        })
    })

    const update = { attendanceSummary: summary, updatedAt: new Date() }
    if (coverageSource.id !== canonical.id) update.coverage = coverageSource.session.coverage
    batch.update(db.collection('appointmentSessions').doc(canonical.id), update)

    if (DELETE_MERGED) {
        merged.forEach((entry) => {
            batch.delete(db.collection('appointmentSessions').doc(entry.id))
        })
    }

    await batch.commit()
    console.log(`Merged into ${canonical.id}`)
}

console.log(
    `\nDone. ${repointed} appointment(s) repointed across ${plan.length} session(s).`
)
process.exit(0)
