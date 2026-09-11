/**
 * Repair appointments pointing at an assignment created AFTER their session.
 *
 * Work allocated in August cannot own a session held in April. Those links make
 * one session surface under several allocations and distort
 * `tracking.sessionsLogged`, which decides who received an intervention and can
 * be issued a MOV.
 *
 *   node scripts/repair-appointment-assignment-links.mjs            # dry run
 *   node scripts/repair-appointment-assignment-links.mjs --apply    # write
 *
 * Run scripts/survey-appointment-assignment-links.mjs first; this repairs only
 * what that survey classes as `resolved`.
 *
 * SAFETY
 * - Dry run is the default. Nothing is written without --apply.
 * - --apply writes a JSON backup of every appointment it will touch before
 *   touching anything, and aborts if the backup cannot be written.
 * - Only `resolved` findings are repaired: one clear owner, being the newest
 *   allocation for that SME / intervention / sub-intervention that already
 *   existed on the session date. `ambiguous` and `unresolved` are reported and
 *   skipped - they need a human decision, not a guess.
 * - Only `assignedInterventionId` changes (plus an audit stamp). Attendance,
 *   coverage, confirmations and evidence are never touched.
 * - Re-runnable: a second run finds nothing, because the repaired links no
 *   longer postdate their session.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) {
    bufferModule.SlowBuffer = function (size) { return Buffer.allocUnsafeSlow(size) }
    bufferModule.SlowBuffer.prototype = Object.create(Buffer.prototype)
}

const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore, Timestamp } = await import('firebase-admin/firestore')

const here = path.dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')

const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()

const clean = value => String(value ?? '').trim()
const millis = value => value?.toMillis?.() ?? 0
const day = value => (value ? new Date(value).toISOString().slice(0, 10) : '(no date)')
const groupKeyOf = a => clean(a?.groupAssignmentId) || clean(a?.groupId) || clean(a?.groupKey) || '(none)'

/**
 * An allocation can only own a session it was OPEN for: created on or before
 * the session, and not already completed when the session ran. A completed
 * assignment cannot acquire new sessions - ignoring that is how a March
 * allocation closed on 27 March ended up owning a 23 April session.
 */
const wasOpenAtSession = (assignment, sessionStart) => {
    const created = millis(assignment.createdAt)
    if (!created || created > sessionStart) return false
    const closed = millis(assignment.completedAt) || millis(assignment.assigneeCompletedAt)
    return !closed || closed >= sessionStart
}

console.log(APPLY ? '=== APPLY (writes enabled) ===' : '=== DRY RUN (no writes) ===')
console.log('Reading appointments, sessions and assignments...')

const [appointmentSnap, sessionSnap, assignmentSnap] = await Promise.all([
    db.collection('appointments').get(),
    db.collection('appointmentSessions').get(),
    db.collection('assignedInterventions').get()
])
console.log(
    `appointments ${appointmentSnap.size} | sessions ${sessionSnap.size} | assignments ${assignmentSnap.size}\n`
)

const sessions = new Map(sessionSnap.docs.map(d => [d.id, d.data()]))
const assignments = new Map(assignmentSnap.docs.map(d => [d.id, d.data()]))

const byIdentity = new Map()
assignmentSnap.docs.forEach(doc => {
    const a = doc.data()
    const key = [
        clean(a.participantId) || clean(a.beneficiaryId),
        clean(a.interventionId),
        clean(a.subInterventionId)
    ].join('||')
    if (!byIdentity.has(key)) byIdentity.set(key, [])
    byIdentity.get(key).push({ id: doc.id, data: a, createdAt: millis(a.createdAt) })
})

const plan = []
const skipped = { ambiguous: [], unresolved: [] }

appointmentSnap.docs.forEach(doc => {
    const appointment = doc.data()
    const session = sessions.get(clean(appointment.appointmentSessionId))
    const current = assignments.get(clean(appointment.assignedInterventionId))
    if (!session || !current) return

    const sessionStart = millis(session.startAt)
    const currentCreated = millis(current.createdAt)
    if (!sessionStart || !currentCreated || currentCreated <= sessionStart) return

    const identity = [
        clean(appointment.smeId) || clean(appointment.participantId),
        clean(appointment.interventionId),
        clean(appointment.subInterventionId)
    ].join('||')

    const eligible = (byIdentity.get(identity) || [])
        .filter(candidate => wasOpenAtSession(candidate.data, sessionStart))
        .sort((left, right) => right.createdAt - left.createdAt)

    const entry = {
        appointmentId: doc.id,
        appointmentData: appointment,
        smeName: clean(appointment.smeName),
        sessionTitle: clean(session.title),
        sessionDate: day(sessionStart),
        fromId: clean(appointment.assignedInterventionId),
        fromCreated: day(currentCreated),
        fromGroup: groupKeyOf(current)
    }

    if (!eligible.length) {
        skipped.unresolved.push(entry)
        return
    }
    const [best, next] = eligible
    if (next && next.createdAt === best.createdAt) {
        skipped.ambiguous.push({ ...entry, candidates: eligible.map(c => c.id) })
        return
    }
    plan.push({
        ...entry,
        toId: best.id,
        toCreated: day(best.createdAt),
        toGroup: groupKeyOf(best.data)
    })
})

console.log(`Repairable links : ${plan.length}`)
console.log(`Skipped ambiguous: ${skipped.ambiguous.length}`)
console.log(`Skipped unresolved (no allocation predates the session): ${skipped.unresolved.length}\n`)

if (skipped.unresolved.length) {
    const bySession = new Map()
    skipped.unresolved.forEach(e => {
        const key = `${e.sessionDate}  ${e.sessionTitle.slice(0, 44)}`
        bySession.set(key, (bySession.get(key) || 0) + 1)
    })
    console.log('Left alone - needs a human decision:')
    ;[...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .forEach(([key, n]) => console.log(`  ${String(n).padStart(3)}  ${key}`))
    console.log('')
}

if (!plan.length) {
    console.log('Nothing to repair.')
    process.exit(0)
}

const bySession = new Map()
plan.forEach(item => {
    const key = `${item.sessionDate}  ${item.sessionTitle.slice(0, 44)}`
    if (!bySession.has(key)) bySession.set(key, [])
    bySession.get(key).push(item)
})

console.log('Planned repairs, by session:')
;[...bySession.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([key, items]) => {
        console.log(`\n  ${key}   (${items.length} appointment${items.length === 1 ? '' : 's'})`)
        items.slice(0, 6).forEach(item => {
            console.log(
                `     ${item.smeName.slice(0, 30).padEnd(30)} allocation ${item.fromCreated} -> ${item.toCreated}`
            )
        })
        if (items.length > 6) console.log(`     ... and ${items.length - 6} more`)
    })

console.log(`\nTOTAL: ${plan.length} appointment(s) would be re-pointed. No other field changes.`)

if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.')
    process.exit(0)
}

const backupPath = path.join(here, `appointment-link-repair-backup-${Date.now()}.json`)
fs.writeFileSync(
    backupPath,
    JSON.stringify(
        plan.map(item => ({
            appointmentId: item.appointmentId,
            before: item.appointmentData,
            newAssignedInterventionId: item.toId
        })),
        null,
        2
    ),
    'utf8'
)
console.log(`\nBackup written to ${backupPath}`)

let written = 0
for (let index = 0; index < plan.length; index += 400) {
    const chunk = plan.slice(index, index + 400)
    const batch = db.batch()
    chunk.forEach(item => {
        batch.update(db.collection('appointments').doc(item.appointmentId), {
            assignedInterventionId: item.toId,
            assignmentLinkCorrectedAt: Timestamp.now(),
            assignmentLinkCorrectedFrom: item.fromId,
            updatedAt: Timestamp.now()
        })
    })
    await batch.commit()
    written += chunk.length
    console.log(`  committed ${written} of ${plan.length}`)
}

console.log(`\nDone. ${written} appointment link(s) corrected.`)
console.log('Reload the allocated interventions page so sessionsLogged recomputes.')
process.exit(0)
