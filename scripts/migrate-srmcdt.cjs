// Copies the SRMCDT program, the interventions catalogue and the Quantilytix test
// SMEs (participant + application + gap analysis) from the old Firebase project
// (oldServiceAccountKey.json) into the new one (serviceAccountKey.json), filling
// any missing details so diagnostic plans, assignments and appointments can be
// tried end to end. Dry run by default.
//
//   node -r ./scripts/node26-shim.cjs scripts/migrate-srmcdt.cjs [--apply] [--overwrite]
//
// Existing documents in the new project are skipped unless --overwrite is given.
// Existing values are never replaced by seed defaults; only missing ones are filled.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const OVERWRITE = process.argv.includes('--overwrite')

const PROGRAM = {
    id: 'b3qe3WAMAVw3QU64CLIY',
    name: 'SRMCDT Project',
    code: 'SPX',
}
const BRANCH = { id: 'yYA7BNWDc6muS0FnhiaO', name: 'Rustenburg', code: 'rustenburg' }
const REVIEWER = { uid: 'rs5mCKT4sDUCq4K61M0qRckoa5s1', email: 'daniel@quantilytix.co.za' }
// A program's coordinator is its project admin ("Center Coordinator" in the UI).
const CENTER_COORDINATOR_UIDS = ['GdOeVMD3NhfsfkPIKhTuCA1fQ0B3'] // ccrusternberg@quantilytix.co.za

// accepted: false => stays an applicant (status untouched, only re-pointed at SRMCDT).
const SMES = [
    { email: 'sme@quantilytix.co.za', accepted: false },
    { email: 'dante@quantilytix.co.za', accepted: true },
    { email: 'testapplication@quantilytix.co.za', accepted: true },
    { email: 'testincubatee@quantilytix.co.za', accepted: true },
    { email: 'bongani@quantilytix.co.za', accepted: true },
]

const oldKey = require(path.join(__dirname, 'oldServiceAccountKey.json'))
const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const oldDb = admin.initializeApp({ credential: admin.credential.cert(oldKey) }, 'old').firestore()
const newDb = admin.initializeApp({ credential: admin.credential.cert(newKey) }, 'new').firestore()
const { Timestamp } = admin.firestore

const blank = (v) => v === undefined || v === null || v === ''
const stripLegacy = (data) => {
    const { companyCode, ...rest } = data
    return rest
}
// Fill only keys that are missing in `base`.
const fill = (base, defaults) => {
    const out = { ...base }
    for (const [k, v] of Object.entries(defaults)) if (blank(out[k])) out[k] = v
    return out
}

async function put(ref, data, label) {
    const exists = (await newDb.doc(ref).get()).exists
    if (exists && !OVERWRITE) {
        console.log(`  skip  ${label} (already in new project)`)
        return
    }
    console.log(`  ${APPLY ? 'write' : 'would write'} ${label}${exists ? ' (overwrite)' : ''}`)
    if (APPLY) await newDb.doc(ref).set(data)
}

async function copyCollectionDoc(col, id, mutate = (d) => d) {
    const snap = await oldDb.collection(col).doc(id).get()
    if (!snap.exists) return console.log(`  MISSING in old project: ${col}/${id}`)
    await put(`${col}/${id}`, mutate(stripLegacy(snap.data())), `${col}/${id}`)
}

async function copyInterventions() {
    const snap = await oldDb.collection('interventions').get()
    console.log(`\n[interventions] ${snap.size} docs`)
    let written = 0
    for (const d of snap.docs) {
        const ref = `interventions/${d.id}`
        const exists = (await newDb.doc(ref).get()).exists
        if (exists && !OVERWRITE) continue
        written++
        if (APPLY) await newDb.doc(ref).set(stripLegacy(d.data()))
    }
    console.log(`  ${APPLY ? 'wrote' : 'would write'} ${written}, skipped ${snap.size - written}`)
}

async function findOne(col, field, value) {
    const s = await oldDb.collection(col).where(field, '==', value).limit(1).get()
    return s.empty ? null : s.docs[0]
}

async function migrateSme(spec, index, danteGap) {
    const email = spec.email
    console.log(`\n[${email}] ${spec.accepted ? 'accepted' : 'applicant (stays pending)'}`)
    const user = await findOne('users', 'email', email)
    if (!user) return console.log('  no user in old project, skipping')
    const uid = user.id
    const name = user.data().name || email.split('@')[0]

    const pDoc = await findOne('participants', 'email', email)
    const aDoc = await findOne('applications', 'email', email)
    const pid = pDoc ? pDoc.id : uid
    const aid = aDoc ? aDoc.id : uid
    const gDoc = pDoc ? await findOne('gapAnalysis', 'participantId', pid) : null
    console.log(
        `  found: participant=${pDoc ? pid : 'none (will create)'} application=${aDoc ? aid : 'none (will create)'} gap=${gDoc ? gDoc.id : 'none'}`
    )

    const pOld = pDoc ? stripLegacy(pDoc.data()) : {}
    const aOld = aDoc ? stripLegacy(aDoc.data()) : {}
    const company = aOld.beneficiaryName || pOld.beneficiaryName || aOld.companyName || `${name} (Pty) Ltd`
    const now = Timestamp.now()
    const acceptedAt = aOld.acceptedAt || now
    const smmeNo = `${PROGRAM.code}-${BRANCH.code}-${String(901 + index).padStart(3, '0')}`

    // Always re-point at SRMCDT.
    const membership = {
        programId: PROGRAM.id,
        programName: PROGRAM.name,
        programCode: PROGRAM.code,
        branchId: BRANCH.id,
        branchName: BRANCH.name,
        branchCode: BRANCH.code,
    }

    let participant = { ...pOld, ...membership }
    let application = { ...aOld, ...membership, participantId: pid }

    if (spec.accepted) {
        participant = fill(participant, {
            uid,
            participantName: name,
            beneficiaryName: company,
            email,
            gender: 'Male',
            idNumber: '8612026417182',
            phone: '0738983097',
            sector: 'Manufacturing',
            natureOfBusiness: 'Test enterprise seeded to try diagnostic plans, assignments and appointments.',
            beeLevel: 2,
            youthOwnedPercent: 40,
            femaleOwnedPercent: 30,
            blackOwnedPercent: 100,
            dateOfRegistration: Timestamp.fromDate(new Date('2022-01-01T00:00:00Z')),
            yearsOfTrading: 4,
            registrationNumber: '2022/000123/07',
            businessAddress: '131 Rick Turner Road',
            city: 'Rustenburg',
            postalCode: '0299',
            province: 'North West',
            hub: 'Rustenburg',
            location: 'Urban',
            setup: true,
            gapAnalysisStatus: 'Completed',
            gapSubmittedAt: now,
            applicationId: aid,
            applicationStatus: 'accepted',
            smmeNo,
            smmeNoGeneratedAt: now,
            headcountHistory: {
                annual: { 2024: { permanent: 2, temporary: 1, total: 3 }, 2025: { permanent: 3, temporary: 1, total: 4 } },
                monthly: {},
            },
            revenueHistory: { annual: { 2024: 250000, 2025: 400000 }, monthly: {} },
            metricsMigrationVersion: 'metric-history-yyyy-mm-v3',
            metricsMigratedAt: now,
            createdAt: now,
            updatedAt: now,
        })
        participant.applicationStatus = 'accepted'
        participant.applicationId = participant.applicationId || aid

        application = fill(application, {
            applicantEmail: email,
            applicantName: name,
            beneficiaryName: company,
            businessName: company,
            companyName: company,
            email,
            phone: participant.phone,
            gender: participant.gender,
            ageGroup: 'Adult',
            stage: 'Startup',
            province: participant.province,
            hub: participant.hub,
            motivation: 'Seed application to try diagnostic plans, assignments and appointments.',
            challenges: 'Access to markets and funding',
            challengeItems: ['Access to markets', 'Access to funding'],
            submittedAt: now,
            acceptedAt,
            decision: { status: 'accepted', decidedAt: acceptedAt, decidedBy: REVIEWER },
            gapAnalysisStatus: 'Completed',
            gapSubmittedAt: participant.gapSubmittedAt,
            gapGroup: 'A',
            groupHistory: [
                { from: null, to: 'A', reason: 'Initial onboarding placement', date: acceptedAt, by: email, docs: [], requirementsMet: [] },
            ],
            complianceScore: '100',
            complianceDocuments: [],
            complianceSummary: { required: [], completed: [] },
            needsMOA: false,
            moaSigned: true,
            moaStatus: 'Completed',
            smmeNo: participant.smmeNo,
            interventions: { participationRate: 0, required: [], completed: [], assigned: [] },
            createdAt: now,
            updatedAt: now,
        })
        application.applicationStatus = 'accepted' // normalise e.g. "accepted " with a trailing space
        application.acceptedAt = application.acceptedAt || acceptedAt
        participant.smmeNo = participant.smmeNo || application.smmeNo
    }

    await put(`participants/${pid}`, participant, `participants/${pid}`)
    await put(`applications/${aid}`, application, `applications/${aid}`)

    if (!spec.accepted) return console.log('  (no gap analysis touched for applicant)')

    // Gap analysis: keep what exists, add the ROM review/confirmation the app looks for.
    const romReview = {
        status: 'Confirmed',
        confirmedAt: now,
        reviewerName: 'System Admin',
        reviewerEmail: REVIEWER.email,
        comment: 'Seed confirmation',
    }
    let gap
    let gid
    if (gDoc) {
        gid = gDoc.id
        gap = fill({ ...stripLegacy(gDoc.data()), participantId: pid }, { confirmationStatus: 'Confirmed', romReview })
    } else {
        gid = pid
        gap = {
            participantId: pid,
            formVersion: danteGap.formVersion,
            sections: danteGap.sections,
            company: {
                name: company,
                email,
                region: participant.province,
                contact: participant.phone,
                dateOfEngagement: now,
            },
            signatures: { smmeNameSurname: name, smmeCryptoSignature: '', smmeSignatureUrl: '' },
            submittedAt: now,
            confirmationStatus: 'Confirmed',
            romReview,
        }
    }
    await put(`gapAnalysis/${gid}`, gap, `gapAnalysis/${gid}`)
}

async function main() {
    console.log(`${oldKey.project_id} -> ${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'}${OVERWRITE ? ', overwrite' : ''})`)

    console.log('\n[program]')
    await copyCollectionDoc('programs', PROGRAM.id, (d) => ({ ...d, assignedCoordinators: CENTER_COORDINATOR_UIDS }))

    await copyInterventions()

    // Test answers used to seed the gap analysis for SMEs that have none.
    const danteUser = await findOne('users', 'email', 'dante@quantilytix.co.za')
    const dantePart = danteUser && (await findOne('participants', 'email', 'dante@quantilytix.co.za'))
    const danteGapDoc = dantePart && (await findOne('gapAnalysis', 'participantId', dantePart.id))
    if (!danteGapDoc) throw new Error('dante gap analysis (seed template) not found in old project')
    const danteGap = danteGapDoc.data()

    for (let i = 0; i < SMES.length; i++) await migrateSme(SMES[i], i, danteGap)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
