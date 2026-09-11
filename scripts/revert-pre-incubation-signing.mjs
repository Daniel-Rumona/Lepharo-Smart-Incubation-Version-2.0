/**
 * Un-sign the Pre-Incubation Contract for one participant, so the signing flow
 * can be walked through again from a clean state.
 *
 * Signing (src/components/modals/Contracts/PreIncubationContract.tsx) leaves
 * three marks, and this removes exactly those three:
 *
 *   1. applications/{appId}.signedAgreements['pre-incubation-contract']
 *   2. 'pre-incubation-contract' inside applications/{appId}.complianceSummary.completed
 *   3. applications/{appId}/agreements/pre-incubation-contract   (subdocument)
 *
 * plus any entry for the agreement in `signedFiles`, and the
 * `signedAgreements['pre-incubation-contract'].signedFileURL` that the
 * post-signing PDF upload writes back.
 *
 *   node scripts/revert-pre-incubation-signing.mjs --name "Dante Welch"
 *   node scripts/revert-pre-incubation-signing.mjs --name "Dante Welch" --apply
 *
 * SAFETY
 * - Dry run is the default. Nothing is written without --apply.
 * - Only the pre-incubation agreement is touched. Other agreements on the same
 *   application (popia-act, gap-analysis, ...) are left exactly as they are,
 *   and only the one slug is pulled out of complianceSummary.completed.
 * - The signature image itself is NOT deleted. It lives at
 *   signatures/{uid}/... and is the signer's reusable account signature, set in
 *   account settings and shared across agreements -- deleting it would take
 *   away the very thing needed to re-sign.
 * - --apply writes a JSON backup of every document it will change, and aborts
 *   if the backup cannot be written. Restore is a plain setDoc of each entry.
 * - Aborts unless exactly one participant matches --name, so a partial or
 *   ambiguous name can never fan out across records.
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
const { getFirestore, FieldValue } = await import('firebase-admin/firestore')

const here = path.dirname(fileURLToPath(import.meta.url))
const APPLY = process.argv.includes('--apply')

const nameFlag = process.argv.indexOf('--name')
const TARGET_NAME = nameFlag >= 0 ? String(process.argv[nameFlag + 1] || '').trim() : ''
if (!TARGET_NAME) {
    console.error('Pass the participant to revert, e.g. --name "Dante Welch"')
    process.exit(1)
}

const AGREEMENT = 'pre-incubation-contract'

const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = getFirestore()

const clean = value => String(value ?? '').trim()
const norm = value => clean(value).toLowerCase()

console.log(APPLY ? '=== APPLY (writes enabled) ===' : '=== DRY RUN (no writes) ===')
console.log('target participant: %s', TARGET_NAME)
console.log('agreement         : %s\n', AGREEMENT)

// ---- Resolve the participant, and insist on exactly one ---------------------

const participantSnap = await db.collection('participants').get()
const wanted = norm(TARGET_NAME)

const participants = participantSnap.docs.filter(d => {
    const p = d.data()
    return [p.participantName, p.beneficiaryName, p.contactPerson].some(
        field => norm(field) === wanted
    )
})

if (participants.length === 0) {
    console.error(`No participant is named exactly "${TARGET_NAME}".`)
    process.exit(1)
}
if (participants.length > 1) {
    console.error(`"${TARGET_NAME}" matches ${participants.length} participants:`)
    for (const d of participants) console.error(`  participants/${d.id} <${d.data().email}>`)
    console.error('Refusing to guess.')
    process.exit(1)
}

const participant = participants[0]
console.log('participant: participants/%s <%s>', participant.id, participant.data().email)

// ---- Find their applications carrying a pre-incubation signature -----------

const applicationSnap = await db
    .collection('applications')
    .where('participantId', '==', participant.id)
    .get()

const targets = applicationSnap.docs.filter(d => {
    const a = d.data()
    return Boolean(a.signedAgreements?.[AGREEMENT])
})

const subdocs = new Map()
for (const d of applicationSnap.docs) {
    const sub = await db.doc(`applications/${d.id}/agreements/${AGREEMENT}`).get()
    if (sub.exists) subdocs.set(d.id, sub)
}

if (targets.length === 0 && subdocs.size === 0) {
    console.log('\nNothing to revert: no pre-incubation signature on any of their applications.')
    process.exit(0)
}

// ---- Report, and build the backup -----------------------------------------

const backup = {
    revertedAt: new Date().toISOString(),
    agreement: AGREEMENT,
    participant: { id: participant.id, name: clean(participant.data().participantName) },
    applications: [],
    agreementSubdocs: []
}

for (const d of applicationSnap.docs) {
    const a = d.data()
    const signed = a.signedAgreements?.[AGREEMENT]
    const sub = subdocs.get(d.id)
    if (!signed && !sub) continue

    console.log('\napplications/%s  (%s)', d.id, clean(a.applicationStatus) || 'no status')

    if (signed) {
        console.log('  will delete signedAgreements[%s]:', AGREEMENT)
        for (const [k, v] of Object.entries(signed)) {
            const shown = typeof v === 'string' && v.startsWith('http') ? '(url)' : JSON.stringify(v)
            console.log('    %s = %s', k, shown)
        }
        backup.applications.push({
            id: d.id,
            signedAgreement: signed,
            complianceCompleted: a.complianceSummary?.completed ?? null,
            signedFiles: a.signedFiles ?? null
        })
    } else {
        console.log('  signedAgreements[%s]: already absent', AGREEMENT)
    }

    const completed = Array.isArray(a.complianceSummary?.completed)
        ? a.complianceSummary.completed
        : []
    if (completed.includes(AGREEMENT)) {
        console.log('  will pull "%s" out of complianceSummary.completed', AGREEMENT)
        console.log('    before: %s', JSON.stringify(completed))
        console.log('    after : %s', JSON.stringify(completed.filter(x => x !== AGREEMENT)))
    }

    const files = Array.isArray(a.signedFiles) ? a.signedFiles : []
    const staleFiles = files.filter(f => clean(f?.agreementId) === AGREEMENT)
    if (staleFiles.length) {
        console.log('  will drop %d signedFiles entry/entries for this agreement', staleFiles.length)
    }

    const untouched = Object.keys(a.signedAgreements || {}).filter(k => k !== AGREEMENT)
    console.log('  left untouched: %s', untouched.length ? untouched.join(', ') : '(no other agreements)')

    if (sub) {
        console.log('  will delete applications/%s/agreements/%s', d.id, AGREEMENT)
        backup.agreementSubdocs.push({ applicationId: d.id, data: sub.data() })
    }
}

if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.')
    process.exit(0)
}

// ---- Apply -----------------------------------------------------------------

const backupPath = path.join(here, `pre-incubation-revert-backup-${Date.now()}.json`)
try {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8')
    console.log('\nbackup written: %s', backupPath)
} catch (error) {
    console.error('\nCould not write the backup, so nothing was changed:', error.message)
    process.exit(1)
}

let updated = 0
let deleted = 0

for (const entry of backup.applications) {
    const ref = db.doc(`applications/${entry.id}`)
    const patch = {
        [`signedAgreements.${AGREEMENT}`]: FieldValue.delete(),
        'complianceSummary.completed': FieldValue.arrayRemove(AGREEMENT)
    }

    // arrayRemove needs the exact stored object, so rewrite the trimmed list.
    const files = Array.isArray(entry.signedFiles) ? entry.signedFiles : null
    if (files && files.some(f => clean(f?.agreementId) === AGREEMENT)) {
        patch.signedFiles = files.filter(f => clean(f?.agreementId) !== AGREEMENT)
    }

    await ref.update(patch)
    updated += 1
    console.log('reverted applications/%s', entry.id)
}

for (const entry of backup.agreementSubdocs) {
    await db.doc(`applications/${entry.applicationId}/agreements/${AGREEMENT}`).delete()
    deleted += 1
    console.log('deleted  applications/%s/agreements/%s', entry.applicationId, AGREEMENT)
}

console.log('\nDone. %d application(s) updated, %d agreement subdocument(s) deleted.', updated, deleted)
console.log('The signer\'s saved account signature was not touched.')
process.exit(0)
