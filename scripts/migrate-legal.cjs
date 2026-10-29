// Legal Advisory Services: gives the department's interventions the current
// outcome-driven definition (`outcomeDef`, see src/services/evidenceModel.ts),
// copies the KPI definitions they reference, and migrates the test coordinator.
// Dry run by default.
//
//   node -r ./scripts/node26-shim.cjs scripts/migrate-legal.cjs [--apply]
//
// None of these writes trigger an email or other notification.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const DEFAULT_PASSWORD = 'Password@1'

const LEGAL_DEPARTMENT_ID = '9bu8xeGsQu4O1NVV73Du'
const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY'
// Coordinators to migrate. Both are Quantilytix test accounts.
const COORDINATOR_UIDS = [
    'NmCceqjPalRkrNelGwj7Mvw1qGR2', // testcoordinator@quantilytix.co.za (moved to Legal in the new project)
    'KD1WPtLLrNcihHGYeWKAFWAKriw2', // legalcoordinator@quantilytix.co.za
]

const oldKey = require(path.join(__dirname, 'oldServiceAccountKey.json'))
const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const oldApp = admin.initializeApp({ credential: admin.credential.cert(oldKey) }, 'old')
const newApp = admin.initializeApp({ credential: admin.credential.cert(newKey) }, 'new')
const oldDb = oldApp.firestore()
const newDb = newApp.firestore()
const { Timestamp } = admin.firestore

// ── outcomeDef drafts, one per Legal intervention (HOD can refine in the Library) ──
// Mirrors OUTCOME_TYPE_DEFAULTS in src/services/evidenceModel.ts.
const TYPE_DEFAULTS = {
    capability_established: { acceptedMechanisms: ['deliverable', 'facilitator_observation'], followUpAfterDays: 60, checkAdoption: true },
    process_implemented: { acceptedMechanisms: ['deliverable', 'facilitator_observation', 'sme_self_report'], followUpAfterDays: 60, checkAdoption: true },
    compliance_achieved: { acceptedMechanisms: ['compliance_record', 'deliverable'], followUpAfterDays: 30, checkAdoption: false },
    risk_reduced: { acceptedMechanisms: ['facilitator_observation', 'assessment', 'deliverable'], followUpAfterDays: 90, checkAdoption: false },
}

const DRAFTS = {
    '2rzrrqFV7YnlS9yswk7x': { // Commercial Law Advisory
        deliverableName: 'Commercial Contract Review Memo',
        deliverableDescription: 'Written review of the SME’s customer and supplier contracts with recommended changes.',
        intendedOutcome: 'The SME trades on legally reviewed contracts and standard terms.',
        outcomeType: 'process_implemented',
        smeCheckIn: true,
    },
    '6KOjejvu2Bs2yVpW2XeM': { // Intellectual Property Advisory
        deliverableName: 'IP Protection Plan',
        deliverableDescription: 'The SME’s brand and IP assets with the registrations needed to protect them.',
        intendedOutcome: 'The SME’s brand and intellectual property is registered or formally protected.',
        outcomeType: 'compliance_achieved',
        smeCheckIn: false,
    },
    '8plZb0CPdR3U11PAcBZN': { // Labour Law Advisory
        deliverableName: 'Employment Contract Pack',
        deliverableDescription: 'Compliant employment contract templates and a basic labour-procedure guide.',
        intendedOutcome: 'The SME’s employees are on compliant employment contracts and the SME follows basic labour-law procedures.',
        outcomeType: 'compliance_achieved',
        smeCheckIn: true,
    },
    'Iod2YQ13G1xQxHsKWQDI': { // Business Law Advisory
        deliverableName: 'Business Legal Health Check Report',
        deliverableDescription: 'Report on the SME’s legal gaps with a prioritised action list.',
        intendedOutcome: 'The SME has closed the legal gaps flagged in its health check and operates on a sound legal footing.',
        outcomeType: 'risk_reduced',
        smeCheckIn: false,
    },
    'LSUNevJ7KUonfir4Hrqy': { // Business Compliance and Regulatory (PAIA / POPIA)
        deliverableName: 'PAIA and POPIA Compliance Manual',
        deliverableDescription: 'PAIA manual and POPIA policy, including the appointment of an information officer.',
        intendedOutcome: 'The SME has adopted a PAIA manual and POPIA policy and has appointed an information officer.',
        outcomeType: 'compliance_achieved',
        smeCheckIn: false,
    },
    'Y19hiSKSTLyw5H1YKfgM': { // Business Insurance Law
        deliverableName: 'Business Insurance Cover Review',
        deliverableDescription: 'Review of the SME’s key risks against its current insurance cover.',
        intendedOutcome: 'The SME holds appropriate insurance cover for its key business risks.',
        outcomeType: 'risk_reduced',
        smeCheckIn: false,
    },
    'me8r5jA3H9z3dYgLe80D': { // Debt Collection Advisory
        deliverableName: 'Debt Recovery Action Plan',
        deliverableDescription: 'Step-by-step plan and letters of demand for the SME’s overdue accounts.',
        intendedOutcome: 'The SME has a working process to recover overdue debt and has acted on its outstanding invoices.',
        outcomeType: 'process_implemented',
        smeCheckIn: true,
    },
    'ukxx7ZzY5NflPlDFcpWJ': { // Cross-Border Transaction Advisory
        deliverableName: 'Cross-Border Transaction Legal Checklist',
        deliverableDescription: 'Contract and import/export documentation checklist for the SME’s first cross-border deal.',
        intendedOutcome: 'The SME can trade across borders with compliant contracts and the right documentation.',
        outcomeType: 'capability_established',
        smeCheckIn: true,
    },
}

// Same result as buildOutcomeDef() in src/services/evidenceModel.ts for a
// manual entry with a check-back (followUpRequired: true).
function buildOutcomeDef(d) {
    const defaults = TYPE_DEFAULTS[d.outcomeType]
    return {
        origin: 'ai_suggested',
        deliverable: { name: d.deliverableName, description: d.deliverableDescription, required: true },
        intendedOutcome: d.intendedOutcome,
        outcomeType: d.outcomeType,
        acceptedMechanisms: defaults.acceptedMechanisms,
        checkAdoption: defaults.checkAdoption,
        followUp: { required: true, smeCheckIn: d.smeCheckIn === true },
        followUpAfterDays: defaults.followUpAfterDays,
    }
}

const stripLegacy = ({ companyCode, ...rest }) => rest

async function legalInterventions() {
    const snap = await oldDb.collection('interventions').where('departmentId', '==', LEGAL_DEPARTMENT_ID).get()
    console.log(`\n[interventions] ${snap.size} Legal interventions in old project`)
    const kpiIds = new Set()
    for (const d of snap.docs) {
        const data = stripLegacy(d.data())
        ;(data.kpiIds || []).forEach((k) => kpiIds.add(k))
        const draft = DRAFTS[d.id]
        if (!draft) {
            console.log(`  no outcome draft for ${d.id} ${data.interventionTitle}, copied unchanged`)
            if (APPLY) await newDb.collection('interventions').doc(d.id).set(data)
            continue
        }
        const outcomeDef = buildOutcomeDef(draft)
        const next = {
            ...data,
            id: d.id,
            outcomeDef,
            definitionVersion: Math.max(1, Number(data.definitionVersion || 0)) + 1,
            updatedAt: Timestamp.now(),
        }
        console.log(`  ${APPLY ? 'write' : 'would write'} ${d.id} ${data.interventionTitle}`)
        console.log(`       deliverable: ${outcomeDef.deliverable.name} | ${outcomeDef.outcomeType} | check-back ${outcomeDef.followUpAfterDays}d${outcomeDef.followUp.smeCheckIn ? ' + SME' : ''}`)
        if (APPLY) await newDb.collection('interventions').doc(d.id).set(next)
    }
    return kpiIds
}

async function kpiDefinitions(ids) {
    console.log(`\n[kpiDefinitions] ${ids.size} referenced by Legal interventions`)
    for (const id of ids) {
        const snap = await oldDb.collection('kpiDefinitions').doc(id).get()
        if (!snap.exists) {
            console.log(`  MISSING in old project: ${id}`)
            continue
        }
        console.log(`  ${APPLY ? 'write' : 'would write'} kpiDefinitions/${id} ${snap.data().name || snap.data().title || ''}`)
        if (APPLY) await newDb.collection('kpiDefinitions').doc(id).set(stripLegacy(snap.data()))
    }
}

async function migrateCoordinator(COORDINATOR_UID) {
    const uSnap = await oldDb.collection('users').doc(COORDINATOR_UID).get()
    const cSnap = await oldDb.collection('coordinators').doc(COORDINATOR_UID).get()
    if (!uSnap.exists) return console.log(`  ${COORDINATOR_UID} not found in old project`)
    const u = stripLegacy(uSnap.data())
    // The old coordinators may also point at programs that are not migrated.
    const programs = [PROGRAM_ID]
    // Both coordinators belong to Legal in the new project.
    const dept = { departmentId: LEGAL_DEPARTMENT_ID, departmentName: 'Legal Advisory Services' }
    const user = { ...u, ...dept, role: 'coordinator', assignedPrograms: programs }
    const coordinator = cSnap.exists ? { ...stripLegacy(cSnap.data()), ...dept, assignedPrograms: programs } : null
    console.log(`  ${u.name} <${u.email}> dept=${dept.departmentName} branch=${u.assignedBranch} -> programs [SRMCDT]`)
    if (!APPLY) return console.log('  would create Auth user, users doc and coordinators doc')
    const oldAuth = await oldApp.auth().getUser(COORDINATOR_UID).catch(() => null)
    await newApp.auth().createUser({
        uid: COORDINATOR_UID,
        email: u.email,
        emailVerified: oldAuth ? oldAuth.emailVerified : true,
        displayName: u.name,
        password: DEFAULT_PASSWORD,
        disabled: oldAuth ? oldAuth.disabled : false,
    }).catch((e) => { if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e })
    await newDb.collection('users').doc(COORDINATOR_UID).set(user)
    if (coordinator) await newDb.collection('coordinators').doc(COORDINATOR_UID).set(coordinator)
    console.log('  written')
}

async function coordinators() {
    console.log('\n[coordinators]')
    for (const uid of COORDINATOR_UIDS) await migrateCoordinator(uid)
}

// --coordinators-only skips the interventions and KPI definitions, which are
// already migrated (re-running them would bump definitionVersion again).
async function main() {
    console.log(`${oldKey.project_id} -> ${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    if (!process.argv.includes('--coordinators-only')) {
        const kpiIds = await legalInterventions()
        await kpiDefinitions(kpiIds)
    }
    await coordinators()
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
