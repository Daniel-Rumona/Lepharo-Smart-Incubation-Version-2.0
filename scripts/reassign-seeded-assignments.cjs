// Moves the seeded Legal assignments (seed-legal-flow.cjs) from one coordinator
// to another, including the documents that carry the assignee: appointment
// sessions and invitations, MOVs (facilitator) and outcome follow-ups.
// Only documents tied to seeded assignments (suppressNotifications: true) are touched.
//
//   node -r ./scripts/node26-shim.cjs scripts/reassign-seeded-assignments.cjs [--apply]
//
// Seeded assignments keep suppressNotifications, so no assignment email is sent.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const FROM_UID = 'NmCceqjPalRkrNelGwj7Mvw1qGR2' // testcoordinator@quantilytix.co.za
const TO_UID = 'KD1WPtLLrNcihHGYeWKAFWAKriw2' // legalcoordinator@quantilytix.co.za

const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(newKey) }).firestore()
const { Timestamp } = admin.firestore

async function update(snap, build, label) {
    console.log(`  ${label}: ${snap.size}`)
    if (!APPLY) return
    for (const d of snap.docs) await d.ref.update(build(d.data()))
}

async function main() {
    console.log(`${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    const to = (await db.collection('users').doc(TO_UID).get()).data()
    if (!to) throw new Error('target coordinator is not in the new project, run migrate-legal.cjs first')
    const assignee = { assigneeId: TO_UID, assigneeName: to.name, assigneeEmail: to.email }
    console.log(`-> ${to.name} <${to.email}>`)

    const assignments = await db.collection('assignedInterventions')
        .where('suppressNotifications', '==', true)
        .where('assigneeId', '==', FROM_UID)
        .get()
    const ids = new Set(assignments.docs.map((d) => d.id))
    await update(assignments, () => ({ ...assignee, updatedAt: Timestamp.now() }), 'assignedInterventions')

    const inSeed = (data) => ids.has(data.assignedInterventionId)
    const pick = async (collection, field) => {
        const snap = await db.collection(collection).where(field, '==', FROM_UID).get()
        return { docs: snap.docs.filter((d) => inSeed(d.data())), get size() { return this.docs.length } }
    }

    const invitations = await pick('appointments', 'assigneeId')
    // Sessions carry no assignedInterventionId; take those whose invitations are seeded.
    const sessionIds = new Set(invitations.docs.map((d) => d.data().appointmentSessionId))
    const allSessions = await db.collection('appointmentSessions').where('assigneeId', '==', FROM_UID).get()
    const sessionDocs = allSessions.docs.filter((d) => sessionIds.has(d.id))

    await update({ docs: sessionDocs, size: sessionDocs.length }, () => ({ ...assignee, updatedAt: Timestamp.now() }), 'appointmentSessions')
    await update(invitations, () => ({ ...assignee, updatedAt: Timestamp.now() }), 'appointments')

    await update(
        await pick('movDocuments', 'facilitatorId'),
        () => ({
            facilitatorId: TO_UID,
            facilitatorName: to.name,
            facilitatorEmail: to.email,
            facilitatorDigitalSignature: to.digitalSignature || '',
            facilitatorSignatureUrl: to.signatureURL || '',
            needsFacilitatorRepair: !to.signatureURL,
            updatedAt: Timestamp.now(),
        }),
        'movDocuments'
    )

    await update(await pick('outcomeFollowUps', 'assigneeId'), () => assignee, 'outcomeFollowUps')
    console.log(APPLY ? 'Done' : 'Dry run')
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
