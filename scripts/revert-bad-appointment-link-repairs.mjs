/**
 * Undo link repairs that landed on an ALREADY-COMPLETED allocation.
 *
 * The first run of repair-appointment-assignment-links.mjs asked only whether
 * an allocation was created before the session. It never asked whether the
 * allocation was still open. A March allocation completed on 27 March was
 * therefore allowed to take ownership of a 23 April session, which is
 * impossible: completed work cannot acquire new sessions.
 *
 * This restores those appointments to the assignment they pointed at before
 * that repair, read from `assignmentLinkCorrectedFrom` on each document. They
 * go back to being reported as broken-but-original, and the corrected rule in
 * the survey now classes them `unresolved` rather than inventing an owner.
 *
 *   node scripts/revert-bad-appointment-link-repairs.mjs          # dry run
 *   node scripts/revert-bad-appointment-link-repairs.mjs --apply  # write
 *
 * SAFETY
 * - Dry run is the default. Nothing is written without --apply.
 * - Only appointments stamped `assignmentLinkCorrectedAt` are considered, so it
 *   can never touch a link this repair did not create.
 * - Of those, only ones now sitting on an allocation that was already completed
 *   when the session ran are reverted. Correct repairs are left alone.
 * - --apply writes a JSON backup first and aborts if it cannot.
 * - Only `assignedInterventionId` changes, plus clearing the repair stamps.
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
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore')

const here = path.dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')

const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()

const clean = value => String(value ?? '').trim()
const millis = value => value?.toMillis?.() ?? 0
const day = value => (value ? new Date(value).toISOString().slice(0, 10) : '(no date)')

console.log(APPLY ? '=== APPLY (writes enabled) ===' : '=== DRY RUN (no writes) ===')

const [appointmentSnap, sessionSnap, assignmentSnap] = await Promise.all([
    db.collection('appointments').get(),
    db.collection('appointmentSessions').get(),
    db.collection('assignedInterventions').get()
])
const sessions = new Map(sessionSnap.docs.map(d => [d.id, d.data()]))
const assignments = new Map(assignmentSnap.docs.map(d => [d.id, d.data()]))

const plan = []
let repairedTotal = 0
let keptCorrect = 0

appointmentSnap.docs.forEach(doc => {
    const appointment = doc.data()
    if (!appointment.assignmentLinkCorrectedAt) return
    repairedTotal += 1

    const session = sessions.get(clean(appointment.appointmentSessionId))
    const current = assignments.get(clean(appointment.assignedInterventionId))
    const original = clean(appointment.assignmentLinkCorrectedFrom)
    if (!session || !current || !original) return

    const sessionStart = millis(session.startAt)
    const closed = millis(current.completedAt) || millis(current.assigneeCompletedAt)
    if (!closed || !sessionStart || closed >= sessionStart) {
        keptCorrect += 1
        return
    }

    plan.push({
        appointmentId: doc.id,
        appointmentData: appointment,
        smeName: clean(appointment.smeName),
        sessionTitle: clean(session.title),
        sessionDate: day(sessionStart),
        wrongId: clean(appointment.assignedInterventionId),
        wrongClosedOn: day(closed),
        restoreId: original
    })
})

console.log(`\nappointments this repair moved      : ${repairedTotal}`)
console.log(`  correct, left alone               : ${keptCorrect}`)
console.log(`  on a CLOSED allocation, to revert : ${plan.length}\n`)

if (!plan.length) {
    console.log('Nothing to revert.')
    process.exit(0)
}

console.log('Planned reverts:')
plan.slice(0, 25).forEach(item => {
    console.log(
        `  ${item.sessionDate}  ${item.smeName.slice(0, 30).padEnd(30)} "${item.sessionTitle.slice(0, 34)}"  allocation closed ${item.wrongClosedOn}`
    )
})
if (plan.length > 25) console.log(`  ... and ${plan.length - 25} more`)

console.log(`\nTOTAL: ${plan.length} appointment(s) restored to their original assignment.`)

if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.')
    process.exit(0)
}

const backupPath = path.join(here, `appointment-link-revert-backup-${Date.now()}.json`)
fs.writeFileSync(
    backupPath,
    JSON.stringify(
        plan.map(item => ({
            appointmentId: item.appointmentId,
            before: item.appointmentData,
            restoredAssignedInterventionId: item.restoreId
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
            assignedInterventionId: item.restoreId,
            assignmentLinkCorrectedAt: FieldValue.delete(),
            assignmentLinkCorrectedFrom: FieldValue.delete(),
            assignmentLinkRevertedAt: Timestamp.now(),
            updatedAt: Timestamp.now()
        })
    })
    await batch.commit()
    written += chunk.length
    console.log(`  committed ${written} of ${plan.length}`)
}

console.log(`\nDone. ${written} appointment link(s) restored.`)
process.exit(0)
