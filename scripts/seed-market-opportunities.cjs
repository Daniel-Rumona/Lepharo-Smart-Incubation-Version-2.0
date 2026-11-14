/**
 * Seeds market opportunities for the Incubation Foundations programme on the
 * test project, so the Market Linkage page has realistic data to match
 * against. Buyers are fictional. Re-running overwrites the same ids.
 *
 *   node scripts/seed-market-opportunities.cjs
 *
 * Matching is not pre-computed: open an opportunity and press
 * "Find matching SMEs". Some are designed to have eligible SMEs (sector,
 * B-BBEE and ownership only); others ask for documents the seeded SMEs don't
 * have yet, so the reasons show.
 */
const path = require('path')
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'))
const key = require(path.join(__dirname, 'serviceAccountKey.json'))

if (key.project_id !== 'lepharo-smart-inc') {
    console.error(`Refusing to seed ${key.project_id}: this script is for the test project only.`)
    process.exit(1)
}

const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const PROGRAM_ID = 'dtseed_20261009_v1_program_0' // Incubation Foundations
const DAY = 24 * 60 * 60 * 1000
const at = days => admin.firestore.Timestamp.fromDate(new Date(Date.now() + days * DAY))

const requirements = over => ({
    sectors: [],
    provinces: ['North West'],
    documents: [],
    maxBeeLevel: null,
    ownership: {},
    requireCsd: false,
    minStage: null,
    ...over
})

const OPPORTUNITIES = [
    {
        id: 'dtseed_ml_fresh_produce',
        title: 'Fresh vegetables for mine hostel kitchens',
        buyer: 'Bokamoso Platinum Mine',
        reference: 'BPM-RFQ-2026-114',
        summary: 'Weekly supply of fresh vegetables (cabbage, spinach, onions, potatoes) to three hostel kitchens near Rustenburg for 12 months. Local black-owned growers are preferred under the mine\'s ESD programme.',
        location: 'Rustenburg',
        value: 'R1.2 million over 12 months',
        closingDate: at(21),
        requirements: requirements({ sectors: ['Agriculture'], maxBeeLevel: 2, ownership: { black: 51 } })
    },
    {
        id: 'dtseed_ml_workwear',
        title: 'Workwear and PPE supply',
        buyer: 'Platinum Belt Construction JV',
        reference: 'PBC-2026-PPE-07',
        summary: 'Supply of overalls, safety boots, hard hats and reflective vests for 400 site workers, with quarterly top-up orders.',
        location: 'Bojanala district',
        value: 'R480 000',
        closingDate: at(14),
        requirements: requirements({ sectors: ['Manufacturing'], maxBeeLevel: 4, ownership: { black: 51 } })
    },
    {
        id: 'dtseed_ml_school_feeding',
        title: 'School feeding scheme: fresh produce',
        buyer: 'Moretele Community Schools Trust',
        reference: 'MCST-NSNP-2027',
        summary: 'Fresh produce for the nutrition programme at 18 schools. Suppliers must be CSD registered and tax compliant before award.',
        location: 'Moretele',
        value: 'R650 000 per year',
        closingDate: at(30),
        requirements: requirements({ sectors: ['Agriculture'], documents: ['Tax compliance status PIN'], requireCsd: true, maxBeeLevel: 3 })
    },
    {
        id: 'dtseed_ml_conveyor_guards',
        title: 'Steel fabrication of conveyor guards',
        buyer: 'Kgotso Agri-Processors',
        reference: 'KAP-ENG-0931',
        summary: 'Fabricate and install 60 mesh conveyor guards at the Brits processing plant. Bidders need CIDB grading and a COID letter of good standing.',
        location: 'Brits',
        value: 'R310 000',
        closingDate: at(10),
        requirements: requirements({ sectors: ['Manufacturing'], documents: ['CIDB grading 2ME', 'COID letter of good standing'], requireCsd: true })
    },
    {
        id: 'dtseed_ml_hygiene',
        title: 'Office cleaning and hygiene services',
        buyer: 'Thaba Logistics Park',
        reference: 'TLP-FM-2026-03',
        summary: 'Daily cleaning of two office blocks and monthly hygiene services (sanitary bins, pest control). Women-owned suppliers are preferred.',
        location: 'Rustenburg',
        value: 'R22 000 per month',
        closingDate: at(18),
        requirements: requirements({ maxBeeLevel: 3, ownership: { black: 51 } })
    },
    {
        id: 'dtseed_ml_supplier_day_catering',
        title: 'Catering for the annual supplier day',
        buyer: 'Lesedi Retail Group',
        reference: 'LRG-EVT-2026',
        summary: 'Lunch and refreshments for 250 guests at the supplier development day.',
        location: 'Rustenburg',
        value: 'R95 000',
        closingDate: at(-12),
        status: 'closed',
        requirements: requirements({ maxBeeLevel: 2 })
    }
]

;(async () => {
    const batch = db.batch()
    for (const { id, status, ...data } of OPPORTUNITIES) {
        batch.set(db.collection('marketOpportunities').doc(id), {
            ...data,
            programId: PROGRAM_ID,
            status: status || 'open',
            matches: [],
            matchSummary: null,
            matchedAt: null,
            invitedCount: 0,
            dataOrigin: 'synthetic',
            createdBy: 'seed-market-opportunities',
            createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - OPPORTUNITIES.length * 60 * 1000 + OPPORTUNITIES.findIndex(o => o.id === id) * 60 * 1000)),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        })
    }
    await batch.commit()
    console.log(`Seeded ${OPPORTUNITIES.length} opportunities for Incubation Foundations (${PROGRAM_ID}).`)
    process.exit(0)
})().catch(error => {
    console.error(error)
    process.exit(1)
})
