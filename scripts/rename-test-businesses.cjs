// Gives the two test SMEs that were both called "My Company" distinct business names,
// on every record that carries the name. Only fields that still say the old name change.
//
//   node -r ./scripts/node26-shim.cjs scripts/rename-test-businesses.cjs [--apply]
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const OLD = 'My Company'
const RENAMES = [
    { pid: 'nFpTqvOR0gSg3HgsoLMe', name: 'Karoo Agri Supplies' }, // testapplication@, Agriculture
    { pid: 'WTsiGqY4C0rlPvndMMtK', name: 'Rustenburg Mining Services' }, // bongani@, Mining
]

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()

async function rename(snap, fields, name, label, nested) {
    let changed = 0
    for (const d of snap.docs) {
        const patch = {}
        for (const f of fields) if (d.data()[f] === OLD) patch[f] = name
        if (nested && d.data().company?.name === OLD) patch['company.name'] = name
        if (!Object.keys(patch).length) continue
        changed++
        if (APPLY) await d.ref.update(patch)
    }
    console.log(`  ${label}: ${changed}/${snap.size}`)
}

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    for (const { pid, name } of RENAMES) {
        console.log(`\n${pid} -> ${name}`)
        const where = (col, field) => db.collection(col).where(field, '==', pid).get()
        const part = await db.collection('participants').doc(pid).get()
        let n = 0
        if (part.data().beneficiaryName === OLD) { n++; if (APPLY) await part.ref.update({ beneficiaryName: name }) }
        console.log(`  participants: ${n}/1`)
        await rename(await where('applications', 'participantId'), ['beneficiaryName', 'businessName', 'companyName'], name, 'applications')
        await rename(await where('assignedInterventions', 'participantId'), ['participantName', 'beneficiaryName'], name, 'assignedInterventions')
        await rename(await where('appointments', 'smeId'), ['smeName'], name, 'appointments')
        await rename(await where('movDocuments', 'participantId'), ['smmeCompanyName'], name, 'movDocuments')
        await rename(await where('gapAnalysis', 'participantId'), [], name, 'gapAnalysis', true)
        await rename(await where('outcomeFollowUps', 'participantId'), ['participantName'], name, 'outcomeFollowUps')
    }
    console.log(APPLY ? '\nDone' : '\nDry run')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
