// Seeds resources, bookings (resourceAllocations) and SME resource requests for
// the accepted SMEs in the SRMCDT project, in the new Firebase project
// (serviceAccountKey.json), so the Resources page, its Bookings/calendar view
// and request approval can be tried with realistic data. Dry run by default.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-srmcdt-resources.cjs [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-srmcdt-resources.cjs --remove [--apply]
//
// Every document uses a fixed `seed-…` id and carries `seedTag`, so re-running
// overwrites the same documents instead of duplicating them, and --remove deletes
// exactly what this script created. Dates are relative to the day it runs.
//
// The bookings never exceed a resource's capacity. A few pending requests are
// deliberately awkward so approval can be tested: one clashes with an existing
// vehicle booking and one asks for more laptops than are free.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')
const SEED_TAG = 'srmcdt-resources'

const PROGRAM_ID = 'b3qe3WAMAVw3QU64CLIY' // SRMCDT Project
const BRANCH_ID = 'yYA7BNWDc6muS0FnhiaO' // Rustenburg

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { Timestamp } = admin.firestore

// Day offset from today at a local hour, e.g. at(3, 8) = 08:00 three days from now
const at = (days, hour, minute = 0) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    d.setHours(hour, minute, 0, 0)
    return Timestamp.fromDate(d)
}

// --------------------------------------------------------------------------
// Resources

const RESOURCES = [
    { id: 'seed-res-boardroom', name: 'Boardroom', type: 'room', capacity: 12, description: 'Glass-walled meeting room with a 65" screen and whiteboard.' },
    { id: 'seed-res-training-hall', name: 'Training Hall', type: 'room', capacity: 40, description: 'Open hall for workshops and training sessions, with PA system.' },
    { id: 'seed-res-projectors', name: 'Projectors', type: 'equipment', capacity: 3, description: 'Portable HD projectors with HDMI and USB-C adapters.' },
    { id: 'seed-res-laptops', name: 'Laptops', type: 'equipment', capacity: 10, description: 'Windows laptops with Office and Sage installed.' },
    { id: 'seed-res-chairs', name: 'Folding Chairs', type: 'equipment', capacity: 60, description: 'Stackable chairs for events and market days.' },
    { id: 'seed-res-quantum', name: 'Toyota Quantum – NW 482-193', type: 'vehicle', seats: 14, description: '14-seater for site visits and group transport. Driver required.' },
    { id: 'seed-res-bakkie', name: 'Nissan NP200 Bakkie – NW 317-554', type: 'vehicle', seats: 2, description: 'Light delivery vehicle for stock runs.' },
    { id: 'seed-res-sound', name: 'Sound System', type: 'equipment', capacity: 1, status: 'maintenance', description: 'Speakers, mixer and two wireless mics. Out for repair.' },
    // Branch inventory: tracked, never booked
    { id: 'seed-res-printers', name: 'Office Printers', type: 'equipment', capacity: 2, visibility: 'internal', description: 'Colour laser printers in the admin office.' },
    { id: 'seed-res-desks', name: 'Office Desks', type: 'equipment', capacity: 15, visibility: 'internal', description: 'Staff workstations.' },
]

const SINGLE_TYPES = new Set(['vehicle'])

const resourceDoc = (r) => {
    const single = SINGLE_TYPES.has(r.type)
    const capacity = single ? 1 : r.capacity
    return {
        name: r.name,
        type: r.type,
        visibility: r.visibility || 'external',
        status: r.status || 'available',
        capacity,
        available: capacity,
        seats: single ? r.seats || null : null,
        description: r.description,
        branchId: BRANCH_ID,
        seedTag: SEED_TAG,
    }
}

// --------------------------------------------------------------------------
// Bookings. sme = application email, resolved to the accepted application.

const BOOKINGS = [
    { id: 'seed-bk-01', resource: 'seed-res-boardroom', sme: 'dante@quantilytix.co.za', qty: 8, start: at(0, 9), end: at(0, 12), purpose: 'Investor pitch rehearsal', status: 'scheduled' },
    { id: 'seed-bk-02', resource: 'seed-res-training-hall', sme: 'testapplication@quantilytix.co.za', qty: 25, start: at(3, 8), end: at(3, 16), purpose: 'Staff food-safety training', status: 'scheduled' },
    { id: 'seed-bk-03', resource: 'seed-res-projectors', sme: 'testapplication@quantilytix.co.za', qty: 1, start: at(3, 8), end: at(3, 16), purpose: 'Projector for food-safety training', status: 'scheduled' },
    { id: 'seed-bk-04', resource: 'seed-res-chairs', sme: 'bongani@quantilytix.co.za', qty: 30, start: at(5, 7), end: at(6, 18), purpose: 'Community supplier day', status: 'scheduled' },
    // Overlaps seed-bk-04 on day 6: 30 + 20 = 50 of 60 chairs
    { id: 'seed-bk-05', resource: 'seed-res-chairs', sme: 'testincubatee@quantilytix.co.za', qty: 20, start: at(6, 8), end: at(6, 17), purpose: 'Product launch event', status: 'scheduled' },
    { id: 'seed-bk-06', resource: 'seed-res-quantum', sme: 'bongani@quantilytix.co.za', qty: 1, start: at(1, 6), end: at(2, 20), purpose: 'Site visits to Mogwase suppliers', status: 'scheduled' },
    { id: 'seed-bk-07', resource: 'seed-res-quantum', sme: 'dante@quantilytix.co.za', qty: 1, start: at(-7, 7), end: at(-6, 18), purpose: 'Trade show in Pretoria', status: 'completed' },
    // In progress: 4 of 10 laptops out for two weeks
    { id: 'seed-bk-08', resource: 'seed-res-laptops', sme: 'testincubatee@quantilytix.co.za', qty: 4, start: at(-2, 9), end: at(12, 17), purpose: 'Bookkeeping short course', status: 'scheduled' },
    { id: 'seed-bk-09', resource: 'seed-res-bakkie', sme: 'testapplication@quantilytix.co.za', qty: 1, start: at(-4, 8), end: at(-4, 17), purpose: 'Stock delivery to Phokeng', status: 'cancelled' },
    { id: 'seed-bk-10', resource: 'seed-res-boardroom', sme: 'testincubatee@quantilytix.co.za', qty: 6, start: at(8, 14), end: at(8, 16), purpose: 'Quarterly board meeting', status: 'scheduled' },
    // Created by approving seed-req-05
    { id: 'seed-bk-11', resource: 'seed-res-bakkie', sme: 'dante@quantilytix.co.za', qty: 1, start: at(9, 8), end: at(9, 17), purpose: 'Collect packaging stock from Brits', status: 'scheduled' },
]

// --------------------------------------------------------------------------
// SME requests. Carries the fields the current SME form writes (reason,
// duration, urgency, deliveryMethod, neededByDate, requestedAt) plus the ones
// the planned approval flow needs (requestType, dates, quantity, applicationId).

const REQUESTS = [
    { id: 'seed-req-01', resource: 'seed-res-training-hall', sme: 'dante@quantilytix.co.za', qty: 30, start: at(10, 8), end: at(10, 16), duration: '1 day', reason: 'Customer workshop for our new product range', urgency: 'Medium', delivery: 'Pick-up', status: 'pending', requestedAt: at(-1, 10) },
    // Clashes with seed-bk-06 (Quantum is out on days 1–2)
    { id: 'seed-req-02', resource: 'seed-res-quantum', sme: 'testincubatee@quantilytix.co.za', qty: 1, start: at(2, 8), end: at(2, 17), duration: '1 day', reason: 'Transport for staff to the Rustenburg market day', urgency: 'High', delivery: 'Pick-up', status: 'pending', requestedAt: at(-1, 14) },
    { id: 'seed-req-03', resource: 'seed-res-projectors', sme: 'bongani@quantilytix.co.za', qty: 2, start: at(4, 9), end: at(4, 13), duration: '4 hours', reason: 'Safety induction presentations for new contractors', urgency: 'High', delivery: 'Pick-up', status: 'pending', requestedAt: at(0, 8) },
    // Only 6 laptops are free while seed-bk-08 is running
    { id: 'seed-req-04', resource: 'seed-res-laptops', sme: 'testapplication@quantilytix.co.za', qty: 8, start: at(5, 8), end: at(7, 17), duration: '3 days', reason: 'Digital marketing training for the sales team', urgency: 'Medium', delivery: 'Delivery', status: 'pending', requestedAt: at(-2, 11) },
    { id: 'seed-req-05', resource: 'seed-res-bakkie', sme: 'dante@quantilytix.co.za', qty: 1, start: at(9, 8), end: at(9, 17), duration: '1 day', reason: 'Collect packaging stock from Brits', urgency: 'Low', delivery: 'Pick-up', status: 'approved', requestedAt: at(-3, 9), bookingId: 'seed-bk-11' },
    { id: 'seed-req-06', resource: 'seed-res-sound', sme: 'testapplication@quantilytix.co.za', qty: 1, start: at(6, 9), end: at(6, 15), duration: '1 day', reason: 'Sound for the farmers day', urgency: 'Medium', delivery: 'Delivery', status: 'rejected', requestedAt: at(-5, 15), declineReason: 'The sound system is out for repair until next month.' },
    { id: 'seed-req-07', resource: 'seed-res-chairs', sme: 'bongani@quantilytix.co.za', qty: 15, start: at(12, 7), end: at(12, 15), duration: '1 day', reason: 'Seating for the contractor open day', urgency: 'Low', delivery: 'Delivery', status: 'pending', requestedAt: at(0, 9) },
]

// --------------------------------------------------------------------------

async function loadSmes() {
    const snap = await db
        .collection('applications')
        .where('programId', '==', PROGRAM_ID)
        .get()
    const byEmail = new Map()
    snap.docs.forEach((d) => {
        const a = d.data()
        if (String(a.applicationStatus || '').trim() !== 'accepted') return
        byEmail.set(String(a.email || '').toLowerCase(), {
            applicationId: d.id,
            participantId: a.participantId || null,
            name: a.businessName || a.beneficiaryName || 'SME',
            email: String(a.email || '').toLowerCase(),
        })
    })
    return byEmail
}

const resourceName = (id) => RESOURCES.find((r) => r.id === id).name

function sme(smes, email) {
    const found = smes.get(email)
    if (!found) throw new Error(`No accepted SRMCDT application for ${email}`)
    return found
}

// Guard against seeding an impossible schedule: peak concurrent use per resource
function checkCapacity() {
    for (const r of RESOURCES) {
        const cap = SINGLE_TYPES.has(r.type) ? 1 : r.capacity
        const held = BOOKINGS.filter(
            (b) => b.resource === r.id && ['scheduled', 'active'].includes(b.status)
        )
        const events = held.flatMap((b) => [
            [b.start.toMillis(), b.qty],
            [b.end.toMillis(), -b.qty],
        ])
        events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        let cur = 0
        for (const [, d] of events) {
            cur += d
            if (cur > cap) throw new Error(`Seed bookings overbook ${r.name}: ${cur} > ${cap}`)
        }
    }
}

async function removeSeeded() {
    for (const col of ['resourceRequests', 'resourceAllocations', 'resources']) {
        const snap = await db.collection(col).where('seedTag', '==', SEED_TAG).get()
        console.log(`[${col}] ${snap.size} seeded docs`)
        for (const d of snap.docs) {
            console.log(`  ${APPLY ? 'delete' : 'would delete'} ${col}/${d.id}`)
            if (APPLY) await d.ref.delete()
        }
    }
}

async function seed() {
    checkCapacity()
    const smes = await loadSmes()
    console.log(`Accepted SRMCDT SMEs: ${[...smes.values()].map((s) => s.name).join(', ')}`)

    const writes = []

    for (const r of RESOURCES) {
        writes.push([`resources/${r.id}`, resourceDoc(r), `${r.name} (${r.visibility || 'external'})`])
    }

    for (const b of BOOKINGS) {
        const s = sme(smes, b.sme)
        writes.push([
            `resourceAllocations/${b.id}`,
            {
                resourceId: b.resource,
                allocatedToApplicationId: s.applicationId,
                allocatedToName: s.name,
                allocatedToEmail: s.email,
                participantId: s.participantId,
                purpose: b.purpose,
                startTime: b.start,
                endTime: b.end,
                quantity: b.qty,
                status: b.status,
                seedTag: SEED_TAG,
            },
            `${resourceName(b.resource)} → ${s.name} ×${b.qty} [${b.status}]`,
        ])
    }

    for (const q of REQUESTS) {
        const s = sme(smes, q.sme)
        const data = {
            requestType: 'external',
            resourceId: q.resource,
            resourceName: resourceName(q.resource),
            applicationId: s.applicationId,
            participantId: s.participantId,
            programId: PROGRAM_ID,
            branchId: BRANCH_ID,
            requestedBy: s.name,
            requestedByEmail: s.email,
            quantity: q.qty,
            startTime: q.start,
            endTime: q.end,
            neededByDate: q.start,
            duration: q.duration,
            reason: q.reason,
            purpose: q.reason,
            urgency: q.urgency,
            deliveryMethod: q.delivery,
            status: q.status,
            requestedAt: q.requestedAt,
            createdAt: q.requestedAt,
            seedTag: SEED_TAG,
        }
        if (q.bookingId) data.bookingId = q.bookingId
        if (q.declineReason) data.declineReason = q.declineReason
        writes.push([
            `resourceRequests/${q.id}`,
            data,
            `${s.name} wants ${resourceName(q.resource)} ×${q.qty} [${q.status}]`,
        ])
    }

    for (const [ref, data, label] of writes) {
        const exists = (await db.doc(ref).get()).exists
        console.log(`  ${APPLY ? 'write' : 'would write'} ${ref}${exists ? ' (overwrite)' : ''}  ${label}`)
        if (APPLY) await db.doc(ref).set(data)
    }
    console.log(`\n${writes.length} documents ${APPLY ? 'written' : 'to write (dry run, pass --apply)'}`)
}

;(REMOVE ? removeSeeded() : seed())
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
