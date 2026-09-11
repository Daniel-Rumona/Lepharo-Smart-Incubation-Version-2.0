/**
 * Read-only survey of broken appointment -> assignment links.
 *
 * An appointment names the assignment it was booked against
 * (`assignedInterventionId`). That link is wrong when the assignment was
 * created AFTER the session was held: work allocated in August cannot own a
 * session that took place in April. Those links make one session appear under
 * several allocations, and they distort `tracking.sessionsLogged`, which is
 * what decides who received an intervention and can be issued a MOV.
 *
 * This script only reads. It writes no Firestore data and takes no --apply
 * flag; the single output is a JSON report next to this file.
 *
 *   node scripts/survey-appointment-assignment-links.mjs
 *   node scripts/survey-appointment-assignment-links.mjs --out=my-report.json
 *
 * For every bad link it looks for the assignment that should own the
 * appointment: same SME, same intervention and sub-intervention, allocated on
 * or before the session date. The newest such allocation wins, because a later
 * allocation supersedes an earlier one for the same work.
 *
 * Each finding is classified:
 *   resolved   - exactly one sensible owner. Safe to repair.
 *   ambiguous  - several equally plausible owners. Needs a human decision.
 *   unresolved - no allocation predates the session. Needs investigation.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Node 20+ dropped buffer.SlowBuffer, which a firebase-admin dependency still
// reads at import time. Shim it before that import runs.
const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) {
    bufferModule.SlowBuffer = function (size) { return Buffer.allocUnsafeSlow(size) }
    bufferModule.SlowBuffer.prototype = Object.create(Buffer.prototype)
}

const { initializeApp, cert } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')

const here = path.dirname(fileURLToPath(import.meta.url))
const outArg = process.argv.find(value => value.startsWith('--out='))
const outPath = path.join(here, outArg ? outArg.slice('--out='.length) : 'appointment-assignment-link-report.json')

const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()

const clean = value => String(value ?? '').trim()
const millis = value => value?.toMillis?.() ?? 0
const day = value => (value ? new Date(value).toISOString().slice(0, 10) : null)
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

// Index allocations by the identity an appointment can be matched on.
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

const findings = []
const summary = { checked: 0, bad: 0, resolved: 0, ambiguous: 0, unresolved: 0 }

appointmentSnap.docs.forEach(doc => {
    const appointment = doc.data()
    const session = sessions.get(clean(appointment.appointmentSessionId))
    const current = assignments.get(clean(appointment.assignedInterventionId))
    if (!session || !current) return
    summary.checked += 1

    const sessionStart = millis(session.startAt)
    const currentCreated = millis(current.createdAt)
    if (!sessionStart || !currentCreated || currentCreated <= sessionStart) return
    summary.bad += 1

    const identity = [
        clean(appointment.smeId) || clean(appointment.participantId),
        clean(appointment.interventionId),
        clean(appointment.subInterventionId)
    ].join('||')

    // Only an allocation that was open on the session day can own that session.
    const eligible = (byIdentity.get(identity) || [])
        .filter(candidate => wasOpenAtSession(candidate.data, sessionStart))
        .sort((left, right) => right.createdAt - left.createdAt)

    let verdict = 'unresolved'
    let suggested = null
    if (eligible.length === 1) {
        verdict = 'resolved'
        suggested = eligible[0]
    } else if (eligible.length > 1) {
        // The newest allocation that predates the session supersedes older
        // ones, but only call it resolved when it is a clear winner.
        const [best, next] = eligible
        verdict = best.createdAt !== next.createdAt ? 'resolved' : 'ambiguous'
        suggested = verdict === 'resolved' ? best : null
    }
    summary[verdict] += 1

    findings.push({
        verdict,
        appointmentId: doc.id,
        smeName: clean(appointment.smeName),
        sessionId: clean(appointment.appointmentSessionId),
        sessionTitle: clean(session.title),
        sessionDate: day(sessionStart),
        currentAssignmentId: clean(appointment.assignedInterventionId),
        currentAssignmentCreated: day(currentCreated),
        currentAssignmentGroup: groupKeyOf(current),
        currentAssignmentCycle: current.cycleKey ?? null,
        suggestedAssignmentId: suggested?.id ?? null,
        suggestedAssignmentCreated: suggested ? day(suggested.createdAt) : null,
        suggestedAssignmentGroup: suggested ? groupKeyOf(suggested.data) : null,
        suggestedAssignmentCycle: suggested ? suggested.data.cycleKey ?? null : null,
        eligibleCandidateCount: eligible.length,
        stampedByInAppRepair: Boolean(appointment.assignmentLinkRepairedAt)
    })
})

findings.sort(
    (left, right) =>
        String(left.sessionDate).localeCompare(String(right.sessionDate)) ||
        left.sessionId.localeCompare(right.sessionId)
)

// Sessions whose appointments are split across several allocations.
const bySession = new Map()
findings.forEach(finding => {
    if (!bySession.has(finding.sessionId)) {
        bySession.set(finding.sessionId, {
            sessionId: finding.sessionId,
            sessionDate: finding.sessionDate,
            sessionTitle: finding.sessionTitle,
            badLinks: 0,
            resolved: 0
        })
    }
    const entry = bySession.get(finding.sessionId)
    entry.badLinks += 1
    if (finding.verdict === 'resolved') entry.resolved += 1
})
const affectedSessions = [...bySession.values()].sort((a, b) => b.badLinks - a.badLinks)

console.log(`checked ${summary.checked} appointments`)
console.log(`  broken links (assignment created after the session): ${summary.bad}`)
console.log(`     resolved   - one clear owner, safe to repair : ${summary.resolved}`)
console.log(`     ambiguous  - needs a human decision          : ${summary.ambiguous}`)
console.log(`     unresolved - no allocation predates it       : ${summary.unresolved}`)
console.log(`  affected sessions: ${affectedSessions.length}\n`)

console.log('Worst affected sessions:')
affectedSessions.slice(0, 15).forEach(entry => {
    console.log(
        `  ${String(entry.badLinks).padStart(3)} bad (${String(entry.resolved).padStart(3)} resolvable)  ${entry.sessionDate}  "${entry.sessionTitle.slice(0, 46)}"`
    )
})

console.log('\nSample of resolvable findings:')
findings.filter(f => f.verdict === 'resolved').slice(0, 10).forEach(f => {
    console.log(
        `  ${f.sessionDate}  ${f.smeName.slice(0, 26).padEnd(26)}  ${f.currentAssignmentCreated} -> ${f.suggestedAssignmentCreated}`
    )
})

fs.writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, affectedSessions, findings }, null, 2),
    'utf8'
)
console.log(`\nFull report written to ${outPath}`)
console.log('This script made no changes.')
process.exit(0)
