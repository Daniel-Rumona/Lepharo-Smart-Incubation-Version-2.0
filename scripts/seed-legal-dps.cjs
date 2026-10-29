// Gives selected SRMCDT SMEs a Legal Advisory Services diagnostic plan that is
// confirmed by the department and by the SME, so they appear on the Legal
// assignments page. The plan lists the Legal interventions already assigned to
// the SME (see seed-legal-flow.cjs) plus the existing compulsory item.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-legal-dps.cjs [--apply]
//
// One SME is deliberately left out so its DP can be built by hand in the app.
// Signatures are left empty. No trigger watches diagnosticPlans, so nothing is emailed.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')

const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(newKey) }).firestore()
const { Timestamp } = admin.firestore

const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY'
const LEGAL = { id: '9bu8xeGsQu4O1NVV73Du', name: 'Legal Advisory Services' }
const HOD_EMAIL = 'legal@quantilytix.co.za'

// testincubatee@ (kb7kcDbm7bejjR928VN3lHwzFrG2) is left for building by hand.
const SMES = {
    'dante@quantilytix.co.za': 'SihV5sbqxAIlQ08Dtk29',
    'testapplication@quantilytix.co.za': 'nFpTqvOR0gSg3HgsoLMe',
    'bongani@quantilytix.co.za': 'WTsiGqY4C0rlPvndMMtK',
}

async function main() {
    console.log(`${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    const hodSnap = await db.collection('users').where('email', '==', HOD_EMAIL).limit(1).get()
    if (hodSnap.empty) throw new Error(`${HOD_EMAIL} not found in the new project`)
    const hod = { id: hodSnap.docs[0].id, ...hodSnap.docs[0].data() }
    const now = Timestamp.now()

    const ivSnap = await db.collection('interventions').where('departmentId', '==', LEGAL.id).get()
    const ivById = Object.fromEntries(ivSnap.docs.map((d) => [d.id, d.data()]))

    for (const [email, pid] of Object.entries(SMES)) {
        console.log(`\n[${email}]`)
        const assigned = await db.collection('assignedInterventions')
            .where('participantId', '==', pid).where('departmentId', '==', LEGAL.id).get()
        const wanted = [...new Set(assigned.docs.map((d) => d.data().interventionId))]

        const dpSnap = await db.collection('diagnosticPlans')
            .where('participantId', '==', pid).where('programId', '==', PROGRAM_ID).get()
        const existing = dpSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0]
        const dpId = existing ? existing.id : `compulsory_${encodeURIComponent(PROGRAM_ID)}_${encodeURIComponent(pid)}`
        const items = Array.isArray(existing?.interventions) ? [...existing.interventions] : []
        const have = new Set(items.map((i) => i.id || i.interventionId))

        const added = []
        for (const id of wanted) {
            if (have.has(id) || !ivById[id]) continue
            items.push({
                source: 'Required',
                area: ivById[id].areaOfSupport || LEGAL.name,
                id,
                title: ivById[id].interventionTitle,
                departmentId: LEGAL.id,
            })
            added.push(ivById[id].interventionTitle)
        }
        console.log(`  plan ${dpId}${existing ? '' : ' (new)'}: ${items.length} interventions (+${added.length}: ${added.join('; ') || 'none'})`)

        const patch = {
            participantId: pid,
            programId: PROGRAM_ID,
            interventions: items,
            confirmedByDeptId: {
                [LEGAL.id]: {
                    confirmed: true,
                    departmentId: LEGAL.id,
                    departmentName: LEGAL.name,
                    confirmedBy: hod.id,
                    deliveryMethod: 'In-person',
                    noInterventions: false,
                    confirmedAt: now,
                },
            },
            confirmed: {
                [LEGAL.name]: {
                    confirmed: true,
                    departmentId: LEGAL.id,
                    departmentName: LEGAL.name,
                    confirmedByEmail: hod.email,
                    signatureUrl: '',
                    signedUrl: '',
                },
            },
            incubateeDepartmentConfirmationsByDeptId: {
                [LEGAL.id]: { confirmed: true, confirmedByEmail: email, confirmedAt: now, signatureUrl: '', signedUrl: '' },
            },
            updatedByDeptId: LEGAL.id,
            updatedByDeptName: LEGAL.name,
            updatedAt: now,
            ...(existing ? {} : { createdAt: now }),
        }
        if (APPLY) await db.collection('diagnosticPlans').doc(dpId).set(patch, { merge: true })
    }
    console.log(APPLY ? '\nDone' : '\nDry run')
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
