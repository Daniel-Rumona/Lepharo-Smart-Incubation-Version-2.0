// Links every SME login to its participant record (Phase 1 of
// docs/sme-identity-migration-plan.md): users/{uid}.participantId and
// participants/{id}.uid. What is linked is decided in sme-identity-plan.cjs.
// Also stamps requestedByUid on the SME's older resourceRequests (Phase 4 drops
// the email rule that let the SME see them), and indexes each SME's confirmed
// WhatsApp number in phoneIndex so it can sign in with it (Phase 5).
//
// Safe to re-run: only missing values are written, never overwritten, and
// logins that match no participant or several are reported and left alone.
// Nothing reads participants.uid for access yet, and users.participantId points
// at the participant the SME already owns by email, so no one's access changes.
// The users trigger (onUserLineManagerInputs) ignores participantId.
//
// Dry run by default (reads only); prints what would change and writes a report
// of ids only (no names or emails) to scripts/sme-identity-backfill-report-<project>.json.
// The service account defaults to scripts/serviceAccountKey.json; pass --key= for
// another project's key. Applying needs that key's project id named explicitly:
//
//   node -r ./scripts/node26-shim.cjs scripts/backfill-sme-identity.cjs
//   node -r ./scripts/node26-shim.cjs scripts/backfill-sme-identity.cjs --key=<path> --apply --project=<project_id>
//
// Against the emulator: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST and pass --emulator.
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')
const { planSmeIdentity, planRequestOwners, planPhoneIndex } = require('./sme-identity-plan.cjs')

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const APPLY = process.argv.includes('--apply')
const EMULATOR = process.argv.includes('--emulator')
const PROJECT_ARG = arg('project')
const KEY_PATH = arg('key') ? path.resolve(arg('key')) : path.join(__dirname, 'serviceAccountKey.json')
const BATCH = 400

function init() {
    if (EMULATOR) {
        if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('--emulator needs FIRESTORE_EMULATOR_HOST')
        const projectId = PROJECT_ARG || 'demo-sme-identity'
        const app = admin.initializeApp({ projectId })
        return { db: app.firestore(), auth: app.auth(), projectId }
    }
    const key = require(KEY_PATH)
    if (APPLY && PROJECT_ARG !== key.project_id) {
        throw new Error(`--apply writes to ${key.project_id}; pass --project=${key.project_id} to confirm`)
    }
    const app = admin.initializeApp({ credential: admin.credential.cert(key) })
    return { db: app.firestore(), auth: app.auth(), projectId: key.project_id }
}

async function loadAuthEmails(auth) {
    const emails = new Map()
    let pageToken
    do {
        const page = await auth.listUsers(1000, pageToken)
        page.users.forEach((u) => { if (u.email) emails.set(u.uid, u.email) })
        pageToken = page.pageToken
    } while (pageToken)
    return emails
}

async function load(db, auth) {
    const [userSnap, participantSnap, applicationSnap, requestSnap, indexSnap, authEmails] = await Promise.all([
        db.collection('users').select('role', 'email', 'participantId', 'whatsappConsent').get(),
        db.collection('participants').select('email', 'uid').get(),
        db.collection('applications').select('participantId').get(),
        db.collection('resourceRequests').select('requestedByUid', 'requestedByEmail').get(),
        db.collection('phoneIndex').get(),
        loadAuthEmails(auth),
    ])
    return {
        users: userSnap.docs.map((d) => ({ uid: d.id, data: d.data() })),
        participants: participantSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
        applications: applicationSnap.docs.map((d) => ({ id: d.id, participantId: String(d.get('participantId') || '').trim() })),
        requests: requestSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
        index: indexSnap.docs.map((d) => ({ id: d.id, data: d.data() })),
        authEmails,
    }
}

async function apply(db, toLink, requestPatches, phoneEntries) {
    const writes = [
        ...toLink.flatMap((l) => [
            ...(l.userPatch ? [(b) => b.update(db.doc(`users/${l.uid}`), l.userPatch)] : []),
            ...(l.participantPatch ? [(b) => b.update(db.doc(`participants/${l.participantId}`), l.participantPatch)] : []),
        ]),
        ...requestPatches.map((r) => (b) => b.update(db.doc(`resourceRequests/${r.id}`), r.patch)),
        // create, not set: a number claimed meanwhile fails the batch rather than being taken over.
        ...phoneEntries.map((e) => (b) => b.create(db.doc(`phoneIndex/${e.id}`), { ...e.data, updatedAt: admin.firestore.FieldValue.serverTimestamp() })),
    ]
    for (let i = 0; i < writes.length; i += BATCH) {
        const batch = db.batch()
        writes.slice(i, i + BATCH).forEach((w) => w(batch))
        await batch.commit()
        console.log(`  committed ${Math.min(i + BATCH, writes.length)} / ${writes.length}`)
    }
}

async function main() {
    const { db, auth, projectId } = init()
    console.log(`${projectId} (${APPLY ? 'APPLY' : 'dry run'})`)
    const input = await load(db, auth)
    const { smeUserCount, outcomes, emailMismatches } = planSmeIdentity(input)
    const requestOwners = planRequestOwners(input)
    const phoneIndex = planPhoneIndex(input)

    // Applications are not changed in Phase 1; these feed Phase 2/3.
    const participantIds = new Set(input.participants.map((p) => p.id))
    const appsWithoutParticipant = input.applications.filter((a) => !a.participantId).map((a) => a.id)
    const appsWithMissingParticipant = input.applications.filter((a) => a.participantId && !participantIds.has(a.participantId)).map((a) => a.id)

    const count = (k) => outcomes[k].length
    console.log(`\nSME logins (incubatee): ${smeUserCount}   participants: ${input.participants.length}`)
    console.log(`Already linked: ${count('alreadyLinked')}`)
    console.log(`To link: ${count('toLink')}`)
    ;['usersParticipantId', 'participantUid', 'email'].forEach((s) =>
        console.log(`  via ${s}: ${outcomes.toLink.filter((l) => l.source === s).length}`))
    console.log(`\nLeft alone (need a look before Phase 4):`)
    console.log(`  no participant with that email: ${count('noParticipant')}`)
    console.log(`  no email on the login: ${count('noEmail')}`)
    console.log(`  several participants match: ${count('ambiguous')}`)
    console.log(`  participant linked to another login: ${count('participantLinkedToOtherUser')}`)
    console.log(`  participant claimed by several logins: ${count('participantClaimedByMultipleUsers')}`)
    console.log(`  users.participantId points at a missing participant: ${count('linkedToMissingParticipant')}`)
    console.log(`\nAuth email differs from users doc email: ${emailMismatches.length}`)
    console.log(`Applications without participantId: ${appsWithoutParticipant.length}`)
    console.log(`Applications whose participant is missing: ${appsWithMissingParticipant.length}`)
    console.log(`Resource requests to stamp with requestedByUid: ${requestOwners.patches.length} (no single SME login for: ${requestOwners.unmatched})`)
    console.log(`Phone sign-in numbers to index: ${phoneIndex.entries.length} (shared by several SMEs: ${phoneIndex.shared.length}, already another login's: ${phoneIndex.taken.length})`)

    // Ids only: no names or emails in the repo.
    const report = {
        projectId,
        mode: APPLY ? 'apply' : 'dry-run',
        at: new Date().toISOString(),
        smeUserCount,
        participantCount: input.participants.length,
        toLink: outcomes.toLink.map(({ uid, participantId, source, userPatch, participantPatch }) => ({
            uid, participantId, source, setsUserParticipantId: !!userPatch, setsParticipantUid: !!participantPatch,
        })),
        alreadyLinkedCount: count('alreadyLinked'),
        noParticipant: outcomes.noParticipant,
        noEmail: outcomes.noEmail,
        ambiguous: outcomes.ambiguous,
        participantLinkedToOtherUser: outcomes.participantLinkedToOtherUser,
        participantClaimedByMultipleUsers: outcomes.participantClaimedByMultipleUsers,
        linkedToMissingParticipant: outcomes.linkedToMissingParticipant,
        emailMismatches,
        applicationsWithoutParticipantId: appsWithoutParticipant,
        applicationsWithMissingParticipant: appsWithMissingParticipant,
        resourceRequestOwners: requestOwners.patches.map((r) => ({ id: r.id, uid: r.patch.requestedByUid })),
        resourceRequestsUnmatched: requestOwners.unmatched,
        // Numbers are personal data: counts and uids only.
        phoneIndexEntries: phoneIndex.entries.map((e) => ({ uid: e.data.uid })),
        phoneNumbersShared: phoneIndex.shared.map((s) => ({ uids: s.uids })),
        phoneNumbersTaken: phoneIndex.taken,
    }
    const reportPath = path.join(__dirname, `sme-identity-backfill-report-${projectId}.json`)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\nReport: ${path.relative(process.cwd(), reportPath)}`)

    if (APPLY) {
        await apply(db, outcomes.toLink, requestOwners.patches, phoneIndex.entries)
        console.log('\nDone')
    } else {
        console.log(`\nDry run -- nothing written. Re-run with --apply --project=${projectId} to write.`)
    }
}
main().then(() => process.exit(0), (e) => { console.error(e.message || e); process.exit(1) })
